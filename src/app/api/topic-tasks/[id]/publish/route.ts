import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { taskHasPreparedContent } from "@/services/topic-task-pipeline";
import { getTopicTaskPublishReadiness } from "@/lib/topic-task-publish-readiness";
import { getTopicTaskContentReadiness } from "@/lib/topic-task-content-readiness";

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

type PublishMode = "now" | "schedule";

interface PublishRequestBody {
  publishMode?: PublishMode;
  scheduledDate?: string; // YYYY-MM-DD
}

interface ScheduledDateNormalizationResult {
  requestedDate: string;
  effectiveDate: Date;
  effectiveDateInput: string;
  adjustedFromPast: boolean;
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateInputInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = map.get("year") || "0000";
  const month = map.get("month") || "00";
  const day = map.get("day") || "00";
  return `${year}-${month}-${day}`;
}

function formatLogStamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function normalizeScheduledDate(raw: string): ScheduledDateNormalizationResult {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("예약발행일은 YYYY-MM-DD 형식으로 입력하세요.");
  }

  const [yearText, monthText, dayText] = trimmed.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("예약발행일 형식이 올바르지 않습니다.");
  }

  const requestedDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    requestedDate.getUTCFullYear() !== year ||
    requestedDate.getUTCMonth() !== month - 1 ||
    requestedDate.getUTCDate() !== day
  ) {
    throw new Error("존재하지 않는 날짜입니다.");
  }

  const now = new Date();
  const todayKey = formatDateInputInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  let effectiveDateInput = trimmed;
  let adjustedFromPast = false;

  if (trimmed <= todayKey) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    effectiveDateInput = formatDateInput(tomorrow);
    adjustedFromPast = true;
  }

  const effectiveDate = new Date(`${effectiveDateInput}T00:00:00.000Z`);
  if (Number.isNaN(effectiveDate.getTime())) {
    throw new Error("예약발행일 계산 중 오류가 발생했습니다.");
  }

  return {
    requestedDate: trimmed,
    effectiveDate,
    effectiveDateInput,
    adjustedFromPast,
  };
}

// POST: 발행 시작
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let taskId: string | null = null;
  let statusUpdated = false;

  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const updateError = requireNoPendingDesktopUpdate();
    if (updateError) {
      return updateError;
    }

    let body: PublishRequestBody;
    try {
      body = (await request.json()) as PublishRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "요청 본문(JSON)을 읽지 못했습니다. 발행 모드를 다시 선택해 주세요." },
        { status: 400 }
      );
    }

    if (body.publishMode !== "now" && body.publishMode !== "schedule") {
      return NextResponse.json(
        { success: false, error: "publishMode는 now 또는 schedule 이어야 합니다." },
        { status: 400 }
      );
    }

    const publishMode: PublishMode = body.publishMode;
    let scheduleInfo: ScheduledDateNormalizationResult | null = null;
    if (publishMode === "schedule") {
      try {
        scheduleInfo = normalizeScheduledDate(body.scheduledDate ?? "");
      } catch (validationError: unknown) {
        return NextResponse.json(
          { success: false, error: getErrorMessage(validationError) },
          { status: 400 }
        );
      }
    } else if (body.scheduledDate) {
      return NextResponse.json(
        { success: false, error: "즉시 발행(now)에서는 scheduledDate를 함께 보낼 수 없습니다." },
        { status: 400 }
      );
    }

    const { id } = await params;
    taskId = id;

    const task = await prisma.topicPostTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: "태스크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (task.status === "PUBLISHING") {
      return NextResponse.json(
        { success: false, error: "이미 발행이 진행 중입니다." },
        { status: 409 }
      );
    }

    if (!taskHasPreparedContent(task)) {
      return NextResponse.json(
        {
          success: false,
          error: "발행 전에 prepare 단계가 완료되어야 합니다. 먼저 주제글 준비를 다시 실행하세요.",
        },
        { status: 409 }
      );
    }

    if (task.selectedDraftId) {
      const draftImages = await prisma.topicDraftImage.findMany({
        where: { draftId: task.selectedDraftId },
        select: { localPath: true, provider: true, role: true },
      });
      const publishReadiness = getTopicTaskPublishReadiness({
        status: task.status,
        selectedDraftId: task.selectedDraftId,
        preparedContentJson: task.preparedContentJson,
        preparedImages: draftImages,
      });

      if (!publishReadiness.canPublish) {
        return NextResponse.json(
          {
            success: false,
            error: publishReadiness.reason || "발행 준비 상태를 다시 확인해 주세요.",
          },
          { status: 409 },
        );
      }

      const contentReadiness = getTopicTaskContentReadiness({
        topic: task.topic,
        keywords: task.keywords,
        type: task.type,
        topicCraftCategory: task.topicCraftCategory,
        preparedContentJson: task.preparedContentJson,
      });

      if (!contentReadiness.canPublish) {
        return NextResponse.json(
          {
            success: false,
            error: contentReadiness.reason || "준비된 본문 품질을 다시 확인해 주세요.",
          },
          { status: 409 },
        );
      }
    }

    // 상태를 발행중으로 변경
    await prisma.topicPostTask.update({
      where: { id },
      data: {
        status: "PUBLISHING",
        pipelineStage: "PUBLISHING",
        errorMessage: null,
        ...(publishMode === "schedule" && scheduleInfo
          ? { scheduledPublishAt: scheduleInfo.effectiveDate }
          : {}),
      },
    });
    statusUpdated = true;

    // 발행 스크립트 실행 (백그라운드)
    const scriptPath = path.join(process.cwd(), "scripts", "topic-agent.ts");
    const scriptArgs = [`--task-id=${id}`];
    if (publishMode === "schedule" && scheduleInfo) {
      scriptArgs.push("--publish-mode=schedule", `--scheduled-date=${scheduleInfo.effectiveDateInput}`);
    }

    const publishLogDir = path.join(process.cwd(), "logs", "publish");
    fs.mkdirSync(publishLogDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-topic-${id}.log`;
    const logFilePath = path.join(publishLogDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");
    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] topic publish request id=${id} mode=${publishMode}${
        scheduleInfo ? ` date=${scheduleInfo.effectiveDateInput}` : ""
      }\n`
    );

    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath, ...scriptArgs], {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", logFd, logFd],
        shell: false,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
    } finally {
      fs.closeSync(logFd);
    }

    if (!child.pid) {
      throw new Error("발행 프로세스를 시작하지 못했습니다.");
    }

    child.on("error", (spawnError) => {
      const spawnErrorMessage = getErrorMessage(spawnError);
      void prisma.topicPostTask
        .updateMany({
          where: { id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            pipelineStage: "FAILED",
            errorMessage: `발행 프로세스 시작 실패: ${spawnErrorMessage}`,
          },
        })
        .catch(() => {});
    });

    child.on("exit", (code, signal) => {
      if (code === 0) return;

      const exitDetail = `code=${code ?? "null"}, signal=${signal ?? "null"}`;
      void prisma.topicPostTask
        .updateMany({
          where: { id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            pipelineStage: "FAILED",
            errorMessage: `발행 프로세스가 비정상 종료되었습니다(${exitDetail}). 로그: ${logFileRelativePath}`,
          },
        })
        .catch(() => {});
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message:
        publishMode === "schedule"
          ? "예약 발행이 시작되었습니다."
          : "발행이 시작되었습니다.",
      data: {
        id,
        status: "PUBLISHING",
        publishMode,
        ...(scheduleInfo
          ? {
              requestedScheduledDate: scheduleInfo.requestedDate,
              effectiveScheduledDate: scheduleInfo.effectiveDateInput,
              adjustedFromPast: scheduleInfo.adjustedFromPast,
            }
          : {}),
        logFile: logFileRelativePath,
      },
    });
  } catch (error: unknown) {
    console.error("발행 시작 실패:", error);

    if (statusUpdated && taskId) {
      await prisma.topicPostTask
        .update({
          where: { id: taskId },
          data: {
            status: "FAILED",
            pipelineStage: "FAILED",
            errorMessage: getErrorMessage(error),
          },
        })
        .catch(() => {});
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

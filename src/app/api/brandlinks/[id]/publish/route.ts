import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { buildCaptureRequiredPayload } from "@/lib/brandconnect-kind";
import { resolveConnectContract } from "@/lib/connect-contract-store";
import { getBrandPostPackageManifestPath, readBrandPostPackage } from "@/lib/brand-post-package";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAutomationEnabled,
  readChatGptBrowserSessionSummary,
} from "@/lib/chatgpt-browser-automation";

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
  let linkId: string | null = null;
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
    linkId = id;
    
    const link = await prisma.brandLink.findUnique({
      where: { id },
    });

    if (!link) {
      return NextResponse.json(
        { success: false, error: "링크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (link.connectKind === "TRAVEL") {
      const contract = resolveConnectContract("travel", link.sourceUrl);
      if (contract.captureRequired) {
        return NextResponse.json(
          { success: false, error: buildCaptureRequiredPayload(contract) },
          { status: 501 }
        );
      }
    }

    if (link.status === "DRAFTING") {
      return NextResponse.json(
        { success: false, error: "현재 초안을 작성 중입니다. 완료 후 발행해 주세요." },
        { status: 409 }
      );
    }

    if (link.status === "PUBLISHING") {
      return NextResponse.json(
        { success: false, error: "이미 발행이 진행 중입니다." },
        { status: 409 }
      );
    }

    const preparedPackage = readBrandPostPackage(id);
    if (preparedPackage && !preparedPackage.approvedAt) {
      return NextResponse.json(
        { success: false, error: "고품질 초안을 먼저 확인하고 승인해 주세요." },
        { status: 409 }
      );
    }
    if (
      preparedPackage &&
      preparedPackage.generationSource !== "AI" &&
      preparedPackage.generationSource !== "PREPARED_APPROVED"
    ) {
      return NextResponse.json(
        { success: false, error: "현재 초안의 생성 출처를 확인할 수 없습니다. 글을 다시 준비해 주세요." },
        { status: 409 },
      );
    }

    // Gemini 는 제거됐다. openai(기본) 또는 codex 만 유효하며 키 확인은 OpenAI 키 기준이다.
    const agentAiProvider = (process.env.AI_PROVIDER || "openai").toLowerCase() === "codex" ? "codex" : "openai";
    const hasProviderKey = Boolean(process.env.OPENAI_API_KEY?.trim());
    const useBrowserChatGpt = !preparedPackage && !hasProviderKey && isChatGptBrowserAutomationEnabled();
    if (!preparedPackage && !hasProviderKey && !useBrowserChatGpt) {
      return NextResponse.json(
        { success: false, error: "발행 전에 ChatGPT에서 초안을 만들고 확인해 주세요." },
        { status: 409 },
      );
    }
    if (useBrowserChatGpt) {
      const chatgptSession = readChatGptBrowserSessionSummary();
      if (!chatgptSession.isValid) {
        return NextResponse.json(
          { success: false, code: "CHATGPT_BROWSER_LOGIN_REQUIRED", error: chatgptSession.error },
          { status: 409 },
        );
      }
    }

    // 상태를 발행중으로 변경
    const publishClaim = await prisma.brandLink.updateMany({
      where: { id, status: link.status },
      data: { 
        status: "PUBLISHING",
        errorMessage: null,
        ...(publishMode === "schedule" && scheduleInfo
          ? { scheduledPublishAt: scheduleInfo.effectiveDate }
          : {}),
      },
    });
    if (publishClaim.count !== 1) {
      return NextResponse.json(
        { success: false, error: "상품 상태가 변경되어 발행을 시작하지 못했습니다. 목록을 새로고침해 주세요." },
        { status: 409 },
      );
    }
    statusUpdated = true;

    // 발행 스크립트 실행 (백그라운드) - 단순 에이전트 사용
    const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");
    const scriptArgs = [id];
    if (publishMode === "schedule" && scheduleInfo) {
      scriptArgs.push("--publish-mode=schedule", `--scheduled-date=${scheduleInfo.effectiveDateInput}`);
    }
    
    const publishLogDir = path.join(process.cwd(), "logs", "publish");
    fs.mkdirSync(publishLogDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-${id}.log`;
    const logFilePath = path.join(publishLogDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");
    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] publish request id=${id} mode=${publishMode}${
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
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          AI_PROVIDER: agentAiProvider,
          ...buildChatGptBrowserAutomationEnv(useBrowserChatGpt),
          HUMAN_MOBILE_POLISH_ENABLED: "true",
          PRODUCT_THUMBNAIL_CHATGPT_ENABLED: process.env.PRODUCT_THUMBNAIL_CHATGPT_ENABLED || "false",
          PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE:
            process.env.PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE || "false",
          PRODUCT_THUMBNAIL_IMAGE_WAIT_MS:
            process.env.PRODUCT_THUMBNAIL_IMAGE_WAIT_MS || "60000",
          PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED:
            process.env.PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED || "false",
          ...(preparedPackage
            ? { BRANDLINK_PREPARED_POST_MANIFEST: getBrandPostPackageManifestPath(id) }
            : {}),
        },
      });
    } finally {
      fs.closeSync(logFd);
    }

    if (!child.pid) {
      throw new Error("발행 프로세스를 시작하지 못했습니다.");
    }

    child.on("error", (spawnError) => {
      const spawnErrorMessage = getErrorMessage(spawnError);
      void prisma.brandLink
        .updateMany({
          where: { id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            errorMessage: `발행 프로세스 시작 실패: ${spawnErrorMessage}`,
          },
        })
        .catch(() => {});
    });

    child.on("exit", (code, signal) => {
      if (code === 0) return;

      const exitDetail = `code=${code ?? "null"}, signal=${signal ?? "null"}`;
      void prisma.brandLink
        .updateMany({
          where: { id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
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

    if (statusUpdated && linkId) {
      await prisma.brandLink
        .update({
          where: { id: linkId },
          data: {
            status: "FAILED",
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { buildCaptureRequiredPayload, parseConnectKind, toStoredConnectKind } from "@/lib/brandconnect-kind";
import { resolveConnectContract } from "@/lib/connect-contract-store";
import {
  addDaysToYmd,
  normalizeBulkScheduleStartDate,
  ymdInTimeZone,
} from "@/lib/bulk-schedule-plan";

interface BulkScheduleBody {
  connectKind?: string;
  limit?: number;
  delayMs?: number;
  startDate?: string;
  intervalDays?: number;
}

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

type BulkScheduleJob = {
  id: string;
  status: "running" | "completed" | "failed";
  targetCount: number;
  targetIds: string[];
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  error: string | null;
};

const globalJobs = globalThis as typeof globalThis & {
  __blogAutoBulkScheduleJobs?: Map<string, BulkScheduleJob>;
};
const bulkScheduleJobs =
  globalJobs.__blogAutoBulkScheduleJobs ??
  (globalJobs.__blogAutoBulkScheduleJobs = new Map<string, BulkScheduleJob>());

function pruneBulkScheduleJobs() {
  const cutoff = Date.now() - 12 * 60 * 60_000;
  for (const [id, job] of bulkScheduleJobs) {
    if (Date.parse(job.startedAt) < cutoff) bulkScheduleJobs.delete(id);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
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

function toSafePositiveInt(value: unknown, defaultValue: number, max = 100): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }

  const parsed = Math.floor(value);
  if (parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;
  pruneBulkScheduleJobs();
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  const job = bulkScheduleJobs.get(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "예약발행 작업을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: job });
}

export async function POST(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const updateError = requireNoPendingDesktopUpdate();
    if (updateError) {
      return updateError;
    }

    let body: BulkScheduleBody = {};
    try {
      body = (await request.json()) as BulkScheduleBody;
    } catch {
      // no-op (default values)
    }

    const requestedLimit = toSafePositiveInt(body.limit, 10, 200);
    const connectKind = parseConnectKind(body.connectKind);
    const storedConnectKind = toStoredConnectKind(connectKind);
    const contract = resolveConnectContract(connectKind);
    if (contract.captureRequired) {
      return NextResponse.json(
        { success: false, error: buildCaptureRequiredPayload(contract) },
        { status: 501 }
      );
    }
    const delayMs = toSafePositiveInt(body.delayMs, 1500, 60000);
    const intervalDays = toSafePositiveInt(body.intervalDays, 1, 30);
    const startDate =
      typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate.trim())
        ? body.startDate.trim()
        : null;

    const activePublishing = await prisma.brandLink.count({
      where: { status: "PUBLISHING" },
    });
    if (activePublishing > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "이미 발행이 진행 중입니다. 현재 작업 완료 후 다시 실행하세요.",
        },
        { status: 409 }
      );
    }

    const pendingWhere = {
      connectKind: storedConnectKind,
      status: "READY",
      scheduledPublishAt: { not: null },
    } as const;
    const pendingRows = await prisma.brandLink.findMany({
      where: pendingWhere,
      orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
      take: requestedLimit,
      select: { id: true, scheduledPublishAt: true },
    });
    const pendingCount = pendingRows.length;
    const earliestPending = pendingRows[0] ?? null;

    if (pendingCount === 0) {
      return NextResponse.json({
        success: true,
        message: "예약발행일이 설정된 READY 링크가 없습니다.",
        data: {
          targetCount: 0,
        },
      });
    }

    const targetCount = pendingCount;
    const targetIds = pendingRows.map((row) => row.id);
    // 저장 날짜에 빈 날이 있더라도 일괄 예약 결과는 성공 건 기준으로 연속
    // 배정한다. 이미 지난 날짜는 실행 스크립트에서 다음 예약 가능일로 조정한다.
    const scheduleTimeZone = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
    const inferredStartDate =
      startDate ??
      (earliestPending?.scheduledPublishAt
        ? ymdInTimeZone(earliestPending.scheduledPublishAt, scheduleTimeZone)
        : null);
    const effectiveStartDate = inferredStartDate
      ? normalizeBulkScheduleStartDate(
          inferredStartDate,
          new Date(),
          scheduleTimeZone,
        )
      : null;
    const endDate = effectiveStartDate
      ? addDaysToYmd(effectiveStartDate, (targetCount - 1) * intervalDays)
      : null;

    const scriptPath = path.join(process.cwd(), "scripts", "bulk-schedule-publish.ts");
    const scriptArgs = [
      `--limit=${targetCount}`,
      `--delay-ms=${delayMs}`,
      `--interval-days=${intervalDays}`,
      `--connect-kind=${connectKind}`,
    ];
    if (effectiveStartDate) {
      scriptArgs.push(`--start-date=${effectiveStartDate}`);
    }

    const logDir = path.join(process.cwd(), "logs", "publish-bulk");
    fs.mkdirSync(logDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-bulk-schedule.log`;
    const logFilePath = path.join(logDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");

    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] bulk schedule start connectKind=${connectKind} targetCount=${targetCount} delayMs=${delayMs} ${
        effectiveStartDate ? `startDate=${effectiveStartDate}` : "scheduleMode=preserve-existing-dates"
      } intervalDays=${intervalDays}\n`
    );

    let child: ChildProcess;
    const jobId = crypto.randomUUID();
    const job: BulkScheduleJob = {
      id: jobId,
      status: "running",
      targetCount,
      targetIds,
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
      error: null,
    };
    bulkScheduleJobs.set(jobId, job);
    try {
      child = spawn(
        process.execPath,
        [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath, ...scriptArgs],
        {
          cwd: process.cwd(),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          shell: false,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        }
      );
    } finally {
      fs.closeSync(logFd);
    }

    if (!child.pid) {
      bulkScheduleJobs.set(jobId, {
        ...job,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: "예약발행 프로세스 PID를 확인하지 못했습니다.",
      });
      throw new Error("예약발행 일괄 실행 프로세스를 시작하지 못했습니다.");
    }

    child.once("error", (error) => {
      bulkScheduleJobs.set(jobId, {
        ...job,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      });
    });
    child.once("exit", (code) => {
      bulkScheduleJobs.set(jobId, {
        ...job,
        status: code === 0 ? "completed" : "failed",
        completedAt: new Date().toISOString(),
        exitCode: code,
        error: code === 0 ? null : `예약발행 프로세스가 종료되었습니다(code=${code ?? "null"}).`,
      });
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message: "예약발행 일괄 실행을 시작했습니다.",
      data: {
        targetCount,
        targetIds,
        jobId,
        connectKind,
        delayMs,
        startDate: effectiveStartDate ?? undefined,
        endDate: endDate ?? undefined,
        scheduleMode: effectiveStartDate ? "compact-success-sequence" : "preserve-existing-dates",
        intervalDays,
        logFile: logFileRelativePath,
      },
    });
  } catch (error: unknown) {
    console.error("예약발행 일괄 실행 시작 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

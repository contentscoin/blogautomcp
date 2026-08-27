import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { parseConnectKind, toStoredConnectKind } from "@/lib/brandconnect-kind";

interface BulkScheduleBody {
  connectKind?: string;
  limit?: number;
  delayMs?: number;
  startDate?: string;
  intervalDays?: number;
}

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

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

function addDaysToYmd(ymd: string, offsetDays: number): string {
  const [yearText, monthText, dayText] = ymd.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const utcDate = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0, 0));
  return utcDate.toISOString().slice(0, 10);
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
    if (connectKind === "travel") {
      return NextResponse.json(
        { success: false, error: "여행커넥트 발행은 네이버 에디터 삽입 방식 검증 후 사용할 수 있습니다." },
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

    const pendingCount = await prisma.brandLink.count({
      where: {
        connectKind: storedConnectKind,
        status: "READY",
        scheduledPublishAt: { not: null },
      },
    });

    if (pendingCount === 0) {
      return NextResponse.json({
        success: true,
        message: "예약발행일이 설정된 READY 링크가 없습니다.",
        data: {
          targetCount: 0,
        },
      });
    }

    const targetCount = Math.min(requestedLimit, pendingCount);
    const endDate = startDate ? addDaysToYmd(startDate, (targetCount - 1) * intervalDays) : null;

    const scriptPath = path.join(process.cwd(), "scripts", "bulk-schedule-publish.ts");
    const scriptArgs = [
      `--limit=${targetCount}`,
      `--delay-ms=${delayMs}`,
      `--interval-days=${intervalDays}`,
      `--connect-kind=${connectKind}`,
    ];
    if (startDate) {
      scriptArgs.push(`--start-date=${startDate}`);
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
        startDate ? `startDate=${startDate}` : "scheduleMode=preserve-existing-dates"
      } intervalDays=${intervalDays}\n`
    );

    let child: ChildProcess;
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
      throw new Error("예약발행 일괄 실행 프로세스를 시작하지 못했습니다.");
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message: "예약발행 일괄 실행을 시작했습니다.",
      data: {
        targetCount,
        connectKind,
        delayMs,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
        scheduleMode: startDate ? "reassign-from-start-date" : "preserve-existing-dates",
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

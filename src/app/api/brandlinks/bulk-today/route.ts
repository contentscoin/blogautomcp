import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";

interface BulkTodayBody {
  limit?: number;
  delayMs?: number;
  targetDate?: string;
  allScheduled?: boolean;
}

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
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

function formatYmdInTimeZone(date: Date, timeZone: string): string {
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

    let body: BulkTodayBody = {};
    try {
      body = (await request.json()) as BulkTodayBody;
    } catch {
      // no-op (default values)
    }

    const requestedLimit = toSafePositiveInt(body.limit, 10, 100);
    const delayMs = toSafePositiveInt(body.delayMs, 1500, 60000);
    const allScheduled = body.allScheduled !== false;
    const targetDate =
      typeof body.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate.trim())
        ? body.targetDate.trim()
        : formatYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
    const nextDate = addDaysToYmd(targetDate, 1);

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
      where: allScheduled
        ? {
            status: "READY",
            scheduledPublishAt: { not: null },
          }
        : {
            status: "READY",
            scheduledPublishAt: {
              gte: new Date(`${targetDate}T00:00:00.000Z`),
              lt: new Date(`${nextDate}T00:00:00.000Z`),
            },
          },
    });

    if (pendingCount === 0) {
      return NextResponse.json({
        success: true,
        message: allScheduled
          ? "예약발행일이 설정된 READY 링크가 없습니다."
          : "오늘 날짜로 예약된 READY 링크가 없습니다.",
        data: {
          targetCount: 0,
          targetDate: allScheduled ? undefined : targetDate,
        },
      });
    }

    const targetCount = Math.min(requestedLimit, pendingCount);
    const scriptPath = path.join(process.cwd(), "scripts", "bulk-today-publish.ts");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          success: false,
          error: `바로 일괄발행 스크립트를 찾을 수 없습니다: ${scriptPath}`,
        },
        { status: 500 }
      );
    }

    const scriptArgs = [`--limit=${targetCount}`, `--delay-ms=${delayMs}`];
    if (allScheduled) {
      scriptArgs.push("--all-scheduled");
    } else {
      scriptArgs.push(`--target-date=${targetDate}`);
    }

    const logDir = path.join(process.cwd(), "logs", "publish-today");
    fs.mkdirSync(logDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-bulk-today.log`;
    const logFilePath = path.join(logDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");

    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] bulk today start targetCount=${targetCount} delayMs=${delayMs}${
        allScheduled ? " allScheduled=true" : ` targetDate=${targetDate}`
      }\n`
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
      throw new Error("바로 일괄발행 프로세스를 시작하지 못했습니다.");
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message: allScheduled ? "바로 일괄발행을 시작했습니다." : "당일 일괄발행을 시작했습니다.",
      data: {
        targetCount,
        targetDate: allScheduled ? undefined : targetDate,
        delayMs,
        logFile: logFileRelativePath,
      },
    });
  } catch (error: unknown) {
    console.error("바로 일괄발행 시작 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";

interface BulkScheduleBody {
  limit?: number;
  delayMs?: number;
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

export async function POST(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    let body: BulkScheduleBody = {};
    try {
      body = (await request.json()) as BulkScheduleBody;
    } catch {
      // no-op (default values)
    }

    const requestedLimit = toSafePositiveInt(body.limit, 10, 100);
    const delayMs = toSafePositiveInt(body.delayMs, 1500, 60000);

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

    const scriptPath = path.join(process.cwd(), "scripts", "bulk-schedule-publish.ts");
    const scriptArgs = [`--limit=${targetCount}`, `--delay-ms=${delayMs}`];

    const logDir = path.join(process.cwd(), "logs", "publish-bulk");
    fs.mkdirSync(logDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-bulk-schedule.log`;
    const logFilePath = path.join(logDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");

    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] bulk schedule start targetCount=${targetCount} delayMs=${delayMs}\n`
    );

    let child: ChildProcess;
    try {
      child = spawn(
        "npx",
        ["ts-node", "--project", "tsconfig.scripts.json", scriptPath, ...scriptArgs],
        {
          cwd: process.cwd(),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          shell: false,
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
        delayMs,
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

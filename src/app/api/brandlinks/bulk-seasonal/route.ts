import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";

interface BulkSeasonalBody {
  count?: number;
  intervalDays?: number;
  categoryUrl?: string;
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

function formatDateInputUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToYmd(ymd: string, offsetDays: number): string {
  const [yearText, monthText, dayText] = ymd.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const utcDate = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0, 0));
  return formatDateInputUtc(utcDate);
}

function toSafePositiveInt(value: unknown, defaultValue: number, max = 30): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }

  const parsed = Math.floor(value);
  if (parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

function resolveStorageStatePath(): string {
  const configured = process.env.NAVER_STORAGE_STATE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), "playwright", "storage", "naver-session.json");
}

export async function POST(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    let body: BulkSeasonalBody = {};
    try {
      body = (await request.json()) as BulkSeasonalBody;
    } catch {
      // no-op (default values)
    }

    const count = toSafePositiveInt(body.count, 10, 30);
    const intervalDays = toSafePositiveInt(body.intervalDays, 1, 30);
    const categoryUrl =
      typeof body.categoryUrl === "string" && body.categoryUrl.trim().length > 0
        ? body.categoryUrl.trim()
        : null;

    const activePublishing = await prisma.brandLink.count({
      where: { status: "PUBLISHING" },
    });

    if (activePublishing > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "현재 발행 작업이 진행 중입니다. 완료 후 다시 시도하세요.",
        },
        { status: 409 }
      );
    }

    const latestScheduled = await prisma.brandLink.findFirst({
      where: { scheduledPublishAt: { not: null } },
      orderBy: [{ scheduledPublishAt: "desc" }, { createdAt: "desc" }],
      select: { scheduledPublishAt: true },
    });

    let startDate: string;
    if (latestScheduled?.scheduledPublishAt) {
      const nextDate = new Date(latestScheduled.scheduledPublishAt);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      startDate = formatDateInputUtc(nextDate);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      startDate = tomorrow.toISOString().slice(0, 10);
    }

    const endDate = addDaysToYmd(startDate, (count - 1) * intervalDays);

    const scriptPath = path.join(process.cwd(), "scripts", "brandconnect-seasonal-register.ts");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          success: false,
          error: `시즌성 등록 스크립트를 찾을 수 없습니다: ${scriptPath}`,
        },
        { status: 500 }
      );
    }

    const storageStatePath = resolveStorageStatePath();
    if (!fs.existsSync(storageStatePath)) {
      return NextResponse.json(
        {
          success: false,
          error:
            `네이버 로그인 세션 파일이 없습니다: ${storageStatePath}\n` +
            "`npm run login`으로 로그인 세션을 먼저 생성하세요.",
        },
        { status: 400 }
      );
    }

    const scriptArgs = [
      `--count=${count}`,
      `--start-date=${startDate}`,
      `--interval-days=${intervalDays}`,
      `--storage-state=${storageStatePath}`,
    ];

    if (categoryUrl) {
      scriptArgs.push(`--category-url=${categoryUrl}`);
    }

    const logDir = path.join(process.cwd(), "logs", "seasonal");
    fs.mkdirSync(logDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-bulk-seasonal.log`;
    const logFilePath = path.join(logDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");

    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] bulk seasonal start count=${count} intervalDays=${intervalDays} startDate=${startDate}${
        categoryUrl ? ` categoryUrl=${categoryUrl}` : ""
      }\n`
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
      throw new Error("시즌성 등록 프로세스를 시작하지 못했습니다.");
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message: "시즌성 상품 자동 등록을 시작했습니다.",
      data: {
        count,
        intervalDays,
        startDate,
        endDate,
        logFile: logFileRelativePath,
      },
    });
  } catch (error: unknown) {
    console.error("시즌성 일괄 등록 시작 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

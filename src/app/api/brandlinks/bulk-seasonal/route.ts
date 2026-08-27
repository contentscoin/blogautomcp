import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { buildCaptureRequiredPayload, parseConnectKind, resolveConnectContract } from "@/lib/brandconnect-kind";

interface BulkSeasonalBody {
  connectKind?: string;
  count?: number;
  intervalDays?: number;
  dailyQuota?: number;
  startDate?: string;
  categoryUrl?: string;
  selectionProfile?: string;
  promotionFilter?: string;
  categoryFilter?: string;
  duplicateWindowDays?: number;
}

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const NAVER_DEFAULT_SCHEDULE_HOUR = parseBoundedInteger(
  process.env.NAVER_DEFAULT_SCHEDULE_HOUR,
  9,
  0,
  23
);
const NAVER_DEFAULT_SCHEDULE_MINUTE = parseBoundedInteger(
  process.env.NAVER_DEFAULT_SCHEDULE_MINUTE,
  0,
  0,
  59
);
const NAVER_SCHEDULE_MIN_LEAD_MINUTES = parseBoundedInteger(
  process.env.NAVER_SCHEDULE_MIN_LEAD_MINUTES,
  120,
  0,
  1440
);
const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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

function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year") || "0000"}-${map.get("month") || "00"}-${map.get("day") || "00"}`;
}

function getDatePartsInTimeZone(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number.parseInt(map.get("hour") || "0", 10),
    minute: Number.parseInt(map.get("minute") || "0", 10),
  };
}

function isScheduleDateTimeSchedulable(ymd: string): boolean {
  const now = new Date();
  const nowYmd = formatYmdInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  if (ymd > nowYmd) return true;
  if (ymd < nowYmd) return false;

  const nowParts = getDatePartsInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const targetMinutes = NAVER_DEFAULT_SCHEDULE_HOUR * 60 + NAVER_DEFAULT_SCHEDULE_MINUTE;
  return targetMinutes - nowMinutes >= NAVER_SCHEDULE_MIN_LEAD_MINUTES;
}

function normalizeStartDate(startDate: string): string {
  let candidate = startDate;
  for (let attempt = 0; attempt < 370; attempt += 1) {
    if (isScheduleDateTimeSchedulable(candidate)) return candidate;
    candidate = addDaysToYmd(candidate, 1);
  }
  return startDate;
}

function toSafePositiveInt(value: unknown, defaultValue: number, max = 50): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }

  const parsed = Math.floor(value);
  if (parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

function toSafeNonNegativeInt(value: unknown, defaultValue: number, max = 3650): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }

  const parsed = Math.floor(value);
  if (parsed < 0) return defaultValue;
  return Math.min(parsed, max);
}

function normalizeCsvFilter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ).join(",");
  return normalized || null;
}

function resolveStorageStatePath(): string {
  const configured = process.env.NAVER_STORAGE_STATE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }
  const storageDir = process.env.SESSION_STORAGE_DIR?.trim();
  return path.join(storageDir || path.join(process.cwd(), "playwright", "storage"), "naver-session.json");
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

    let body: BulkSeasonalBody = {};
    try {
      body = (await request.json()) as BulkSeasonalBody;
    } catch {
      // no-op (default values)
    }

    const count = toSafePositiveInt(body.count, 10, 200);
    const connectKind = parseConnectKind(body.connectKind);
    const intervalDays = toSafePositiveInt(body.intervalDays, 1, 30);
    const dailyQuota = toSafePositiveInt(body.dailyQuota, 1, 200);
    const categoryUrl =
      typeof body.categoryUrl === "string" && body.categoryUrl.trim().length > 0
        ? body.categoryUrl.trim()
        : null;
    const contract = resolveConnectContract(connectKind, categoryUrl);
    if (contract.captureRequired) {
      return NextResponse.json({ success: false, error: buildCaptureRequiredPayload(contract) }, { status: 501 });
    }
    const selectionProfile =
      typeof body.selectionProfile === "string" && body.selectionProfile.trim().length > 0
        ? body.selectionProfile.trim().toLowerCase()
        : process.env.BRANDCONNECT_SELECTION_PROFILE || "seasonal-hit-popular";
    const promotionFilter = normalizeCsvFilter(body.promotionFilter);
    const categoryFilter = normalizeCsvFilter(body.categoryFilter);
    const duplicateWindowDays = toSafeNonNegativeInt(
      body.duplicateWindowDays,
      parseBoundedInteger(process.env.BRANDCONNECT_DUPLICATE_WINDOW_DAYS, 30, 0, 3650),
      3650
    );

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

    const requestedStartDate =
      typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate.trim())
        ? body.startDate.trim()
        : formatYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
    const startDate = normalizeStartDate(requestedStartDate);

    const endDate = addDaysToYmd(
      startDate,
      Math.floor((count - 1) / dailyQuota) * intervalDays
    );

    const scriptPath = path.join(process.cwd(), "scripts", "brandconnect-seasonal-register.ts");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          success: false,
          error: `시즌·히트·인기 등록 스크립트를 찾을 수 없습니다: ${scriptPath}`,
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
      `--daily-quota=${dailyQuota}`,
      `--storage-state=${storageStatePath}`,
      `--selection-profile=${selectionProfile}`,
      `--connect-kind=${connectKind}`,
    ];

    if (categoryUrl) {
      scriptArgs.push(`--category-url=${categoryUrl}`);
    }
    if (promotionFilter) {
      scriptArgs.push(`--promotion-filter=${promotionFilter}`);
    }
    if (categoryFilter) {
      scriptArgs.push(`--category-filter=${categoryFilter}`);
    }
    scriptArgs.push(`--duplicate-window-days=${duplicateWindowDays}`);

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
      } dailyQuota=${dailyQuota} selectionProfile=${selectionProfile} promotionFilter=${promotionFilter || "-"} categoryFilter=${categoryFilter || "-"} duplicateWindowDays=${duplicateWindowDays}\n`
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
      throw new Error("시즌·히트·인기 등록 프로세스를 시작하지 못했습니다.");
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message: "시즌·히트·인기 상품 자동 등록을 시작했습니다.",
      data: {
        count,
        connectKind,
        intervalDays,
        dailyQuota,
        startDate,
        endDate,
        selectionProfile,
        promotionFilter,
        categoryFilter,
        duplicateWindowDays,
        logFile: logFileRelativePath,
      },
    });
  } catch (error: unknown) {
    console.error("시즌·히트·인기 일괄 등록 시작 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { buildCaptureRequiredPayload, parseConnectKind, resolveConnectContract } from "@/lib/brandconnect-kind";

interface SuperPublishBody {
  connectKind?: string;
  collectCount?: number;
  todayCount?: number;
  dailyQuota?: number;
  delayMs?: number;
  startDate?: string;
  intervalDays?: number;
  categoryUrl?: string;
  selectionProfile?: string;
  promotionFilter?: string;
  categoryFilter?: string;
  duplicateWindowDays?: number;
}

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
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

function toSafePositiveInt(value: unknown, defaultValue: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }

  const parsed = Math.floor(value);
  if (parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

function toSafeNonNegativeInt(value: unknown, defaultValue: number, max: number): number {
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

function addDaysToYmd(ymd: string, offsetDays: number): string {
  const [yearText, monthText, dayText] = ymd.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const utcDate = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0, 0));
  return utcDate.toISOString().slice(0, 10);
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

    let body: SuperPublishBody = {};
    try {
      body = (await request.json()) as SuperPublishBody;
    } catch {
      // no-op
    }

    const collectCount = toSafePositiveInt(body.collectCount, 200, 200);
    const connectKind = parseConnectKind(body.connectKind);
    if (connectKind === "travel") {
      return NextResponse.json(
        { success: false, error: "여행커넥트 수퍼 퍼블리싱은 네이버 에디터 삽입 방식 검증 후 사용할 수 있습니다." },
        { status: 501 }
      );
    }
    const todayCount = Math.min(toSafePositiveInt(body.todayCount, 50, 200), collectCount);
    const dailyQuota = toSafePositiveInt(body.dailyQuota, todayCount, 200);
    const delayMs = toSafePositiveInt(body.delayMs, 1500, 60000);
    const intervalDays = toSafePositiveInt(body.intervalDays, 1, 30);
    const startDate =
      typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate.trim())
        ? body.startDate.trim()
        : formatYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
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
    const envDuplicateWindowDays = Number.parseInt(process.env.BRANDCONNECT_DUPLICATE_WINDOW_DAYS || "30", 10);
    const duplicateWindowDays = toSafeNonNegativeInt(
      body.duplicateWindowDays,
      Number.isFinite(envDuplicateWindowDays) ? envDuplicateWindowDays : 30,
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

    const scriptPath = path.join(process.cwd(), "scripts", "super-publish.ts");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          success: false,
          error: `수퍼 퍼블리싱 스크립트를 찾을 수 없습니다: ${scriptPath}`,
        },
        { status: 500 }
      );
    }

    const storageStatePath = resolveStorageStatePath();
    if (!fs.existsSync(storageStatePath)) {
      return NextResponse.json(
        {
          success: false,
          error: `네이버 로그인 세션 파일이 없습니다: ${storageStatePath}\n먼저 npm run login을 실행하세요.`,
        },
        { status: 400 }
      );
    }

    const scriptArgs = [
      `--collect-count=${collectCount}`,
      `--today-count=${todayCount}`,
      `--daily-quota=${dailyQuota}`,
      `--delay-ms=${delayMs}`,
      `--start-date=${startDate}`,
      `--interval-days=${intervalDays}`,
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

    const logDir = path.join(process.cwd(), "logs", "super-publish");
    fs.mkdirSync(logDir, { recursive: true });
    const logFileName = `${formatLogStamp(new Date())}-super-publish.log`;
    const logFilePath = path.join(logDir, logFileName);
    const logFileRelativePath = path.relative(process.cwd(), logFilePath);
    const logFd = fs.openSync(logFilePath, "a");

    fs.writeSync(
      logFd,
      `[${new Date().toISOString()}] super publish start collectCount=${collectCount} todayCount=${todayCount} dailyQuota=${dailyQuota} startDate=${startDate} intervalDays=${intervalDays} selectionProfile=${selectionProfile} promotionFilter=${promotionFilter || "-"} categoryFilter=${categoryFilter || "-"} duplicateWindowDays=${duplicateWindowDays}\n`
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
      throw new Error("수퍼 퍼블리싱 프로세스를 시작하지 못했습니다.");
    }

    child.unref();

    const todayPublishCount = Math.min(todayCount, collectCount);
    const scheduledCount = Math.max(0, collectCount - todayPublishCount);
    const endDate = addDaysToYmd(
      startDate,
      Math.floor((collectCount - 1) / dailyQuota) * intervalDays
    );

    return NextResponse.json({
      success: true,
      message: "수퍼 퍼블리싱 작업을 시작했습니다.",
      data: {
        collectCount,
        connectKind,
        todayCount: todayPublishCount,
        scheduledCount,
        dailyQuota,
        startDate,
        endDate,
        delayMs,
        intervalDays,
        selectionProfile,
        promotionFilter,
        categoryFilter,
        duplicateWindowDays,
        logFile: logFileRelativePath,
      },
    });
  } catch (error: unknown) {
    console.error("수퍼 퍼블리싱 시작 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

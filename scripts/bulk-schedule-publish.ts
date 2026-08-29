import "dotenv/config";
import path from "path";
import { spawn } from "child_process";
import { PrismaClient } from "../src/generated/prisma";
import {
  buildAppUrl,
  notifyAndLogCompletion,
  type CompletionLink,
} from "./lib/chatbot-notifier";

interface CliOptions {
  connectKind: "SHOPPING" | "TRAVEL";
  limit: number;
  delayMs: number;
  startDate: string | null;
  intervalDays: number;
  createdAfter: Date | null;
}

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const AGENT_AI_PROVIDER = process.env.AI_PROVIDER || "openai";
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
const NAVER_DEFAULT_SCHEDULE_TIME_LABEL = `${String(NAVER_DEFAULT_SCHEDULE_HOUR).padStart(
  2,
  "0"
)}:${String(NAVER_DEFAULT_SCHEDULE_MINUTE).padStart(2, "0")}`;
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

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    connectKind: "SHOPPING",
    limit: 10,
    delayMs: 1500,
    startDate: null,
    intervalDays: 1,
    createdAfter: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--connect-kind=")) {
      options.connectKind = arg.split("=")[1]?.trim().toLowerCase() === "travel" ? "TRAVEL" : "SHOPPING";
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value > 0 && value <= 200) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith("--delay-ms=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value >= 0 && value <= 60000) {
        options.delayMs = value;
      }
      continue;
    }

    if (arg.startsWith("--start-date=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        options.startDate = value;
      }
      continue;
    }

    if (arg.startsWith("--interval-days=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value >= 1 && value <= 30) {
        options.intervalDays = value;
      }
      continue;
    }

    if (arg.startsWith("--created-after=")) {
      const value = arg.split("=")[1]?.trim() || "";
      const date = new Date(value);
      if (value && !Number.isNaN(date.getTime())) {
        options.createdAfter = date;
      }
    }
  }

  return options;
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDatePartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(map.get("year") || "0", 10),
    month: Number.parseInt(map.get("month") || "0", 10),
    day: Number.parseInt(map.get("day") || "0", 10),
    hour: Number.parseInt(map.get("hour") || "0", 10),
    minute: Number.parseInt(map.get("minute") || "0", 10),
  };
}

function formatYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

function addDaysToYmd(ymd: string, offsetDays: number): string {
  const [yearText, monthText, dayText] = ymd.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const utcDate = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0, 0));
  return formatYmd(utcDate);
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

function normalizeStartDate(startDate: string): { startDate: string; adjusted: boolean } {
  let candidate = startDate;
  for (let attempt = 0; attempt < 370; attempt += 1) {
    if (isScheduleDateTimeSchedulable(candidate)) {
      return { startDate: candidate, adjusted: candidate !== startDate };
    }
    candidate = addDaysToYmd(candidate, 1);
  }
  return { startDate, adjusted: false };
}

function createScheduledPublishAt(ymd: string): Date | null {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(
    year,
    month - 1,
    day,
    NAVER_DEFAULT_SCHEDULE_HOUR,
    NAVER_DEFAULT_SCHEDULE_MINUTE,
    0,
    0
  );
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function runSimpleAgent(
  linkId: string,
  scheduledDate: string
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        TS_NODE_BIN,
        "--project",
        "tsconfig.scripts.json",
        scriptPath,
        linkId,
        "--publish-mode=schedule",
        `--scheduled-date=${scheduledDate}`,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "inherit", "inherit"],
        shell: false,
        env: {
          ...process.env,
          AI_PROVIDER: AGENT_AI_PROVIDER,
          BROWSER_GPT_MODE: "false",
          ALLOW_CHATGPT_BROWSER_MODE: "false",
          CHATGPT_USE_CUSTOM_GPTS: "false",
          CHATGPT_DIRECT_ONLY: "true",
          CHATGPT_SKIP_POLISH: "true",
          HUMAN_MOBILE_POLISH_ENABLED: "true",
          PRODUCT_THUMBNAIL_CHATGPT_ENABLED: process.env.PRODUCT_THUMBNAIL_CHATGPT_ENABLED || "false",
          PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE:
            process.env.PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE || "false",
          PRODUCT_THUMBNAIL_CHATGPT_BASE_FALLBACK_ENABLED:
            process.env.PRODUCT_THUMBNAIL_CHATGPT_BASE_FALLBACK_ENABLED || "false",
          PRODUCT_THUMBNAIL_IMAGE_WAIT_MS:
            process.env.PRODUCT_THUMBNAIL_IMAGE_WAIT_MS || "60000",
          PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED:
            process.env.PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED || "false",
          CHATBOT_SUPPRESS_AGENT_NOTIFY: "true",
        },
      }
    );

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));
  const requestedStartDate = options.startDate;
  const normalizedStartDate = requestedStartDate ? normalizeStartDate(requestedStartDate) : null;
  const startDate = normalizedStartDate?.startDate ?? null;
  const shouldReassignScheduleDates = Boolean(startDate);
  const createdAfterWhere = options.createdAfter
    ? {
        createdAt: {
          gte: options.createdAfter,
        },
      }
    : {};

  try {
    const pending = await prisma.brandLink.findMany({
      where: {
        ...createdAfterWhere,
        connectKind: options.connectKind,
        status: "READY",
        scheduledPublishAt: { not: null },
      },
      orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
      take: options.limit,
      select: {
        id: true,
        productName: true,
        scheduledPublishAt: true,
      },
    });

    if (pending.length === 0) {
      console.log("예약발행일이 설정된 READY 링크가 없어 종료합니다.");
      return;
    }

    console.log(
      `예약발행 일괄 실행 시작: ${pending.length}건 / ${
        shouldReassignScheduleDates ? `기준일=${startDate}` : "기존 예약일 유지"
      } / 간격=${options.intervalDays}일`
    );
    if (requestedStartDate && normalizedStartDate?.adjusted) {
      console.log(
        `기준일 ${requestedStartDate} ${NAVER_DEFAULT_SCHEDULE_TIME_LABEL}은 최소 ${NAVER_SCHEDULE_MIN_LEAD_MINUTES}분 리드타임을 만족하지 못해 ${startDate}로 조정했습니다.`
      );
    }

    let successCount = 0;
    let failedCount = 0;
    const completedLinks: CompletionLink[] = [];
    const failedLinks: CompletionLink[] = [];

    for (let index = 0; index < pending.length; index += 1) {
      const link = pending[index];
      const previousScheduledPublishAt = link.scheduledPublishAt;

      if (!previousScheduledPublishAt) {
        failedCount += 1;
        failedLinks.push({
          label: link.productName || link.id,
          url: buildAppUrl(`/?brandLinkId=${link.id}`),
          status: "FAILED",
          description: "예약발행일 누락",
        });
        continue;
      }

      const previousScheduledDate = formatYmd(previousScheduledPublishAt);
      let scheduledDate = previousScheduledDate;
      let scheduledPublishAt: Date | null = previousScheduledPublishAt;
      let adjustedStoredDate = false;

      if (shouldReassignScheduleDates && startDate) {
        scheduledDate = addDaysToYmd(startDate, index * options.intervalDays);
        scheduledPublishAt = createScheduledPublishAt(scheduledDate);
      } else if (!isScheduleDateTimeSchedulable(scheduledDate)) {
        const normalizedStoredDate = normalizeStartDate(scheduledDate);
        scheduledDate = normalizedStoredDate.startDate;
        scheduledPublishAt = createScheduledPublishAt(scheduledDate);
        adjustedStoredDate = normalizedStoredDate.adjusted;
      }

      if (!scheduledPublishAt || Number.isNaN(scheduledPublishAt.getTime())) {
        failedCount += 1;
        failedLinks.push({
          label: link.productName || link.id,
          url: buildAppUrl(`/?brandLinkId=${link.id}`),
          scheduledDate,
          status: "FAILED",
          description: "예약발행 기준일 계산 실패",
        });
        await prisma.brandLink.update({
          where: { id: link.id },
          data: {
            status: "FAILED",
            errorMessage: `일괄 예약발행 기준일 계산 실패: ${scheduledDate}`,
          },
        });
        continue;
      }

      console.log(
        `\n[${index + 1}/${pending.length}] ${link.id} | ${scheduledDate} (기존 ${previousScheduledDate}${
          adjustedStoredDate ? ", 예약가능일로 조정" : ""
        }) | ${
          link.productName ?? "(상품명 없음)"
        }`
      );

      await prisma.brandLink.update({
        where: { id: link.id },
        data: {
          status: "PUBLISHING",
          errorMessage: null,
          scheduledPublishAt,
        },
      });

      try {
        const result = await runSimpleAgent(link.id, scheduledDate);

        if (result.code !== 0) {
          failedCount += 1;
          const detail = `code=${result.code ?? "null"}, signal=${result.signal ?? "null"}`;
          await prisma.brandLink.updateMany({
            where: { id: link.id, status: "PUBLISHING" },
            data: {
              status: "FAILED",
              errorMessage: `일괄 예약발행 스크립트 비정상 종료(${detail})`,
            },
          });
          failedLinks.push({
            label: link.productName || link.id,
            url: buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: "FAILED",
            description: `스크립트 비정상 종료 (${detail})`,
          });
          continue;
        }

        const refreshed = await prisma.brandLink.findUnique({
          where: { id: link.id },
          select: {
            id: true,
            status: true,
            postUrl: true,
            productName: true,
            scheduledPublishAt: true,
            errorMessage: true,
          },
        });

        if (refreshed?.status === "SCHEDULED") {
          successCount += 1;
          completedLinks.push({
            label: refreshed.productName || link.productName || link.id,
            url: buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: "SCHEDULED",
            description: "예약발행 확인",
          });
        } else if (refreshed?.status === "PUBLISHING") {
          failedCount += 1;
          await prisma.brandLink.update({
            where: { id: link.id },
            data: {
              status: "FAILED",
              errorMessage: "예약발행 처리 결과를 확인하지 못했습니다.",
            },
          });
          failedLinks.push({
            label: refreshed.productName || link.productName || link.id,
            url: buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: "FAILED",
            description: "예약발행 결과 확인 실패",
          });
        } else if (refreshed?.status === "FAILED") {
          failedCount += 1;
          failedLinks.push({
            label: refreshed.productName || link.productName || link.id,
            url: buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: "FAILED",
            description: refreshed.errorMessage || "발행 실패",
          });
        } else {
          successCount += 1;
          completedLinks.push({
            label: refreshed?.productName || link.productName || link.id,
            url: refreshed?.postUrl || buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: refreshed?.status || "DONE",
            description: "처리 완료",
          });
        }
      } catch (error: unknown) {
        failedCount += 1;
        const message = getErrorMessage(error);
        await prisma.brandLink.updateMany({
          where: { id: link.id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            errorMessage: `일괄 예약발행 실행 실패: ${message}`,
          },
        });
        failedLinks.push({
          label: link.productName || link.id,
          url: buildAppUrl(`/?brandLinkId=${link.id}`),
          scheduledDate,
          status: "FAILED",
          description: message,
        });
      }

      if (options.delayMs > 0 && index < pending.length - 1) {
        await sleep(options.delayMs);
      }
    }

    console.log("\n========================================");
    console.log("예약발행 일괄 실행 완료");
    console.log(`성공: ${successCount}`);
    console.log(`실패: ${failedCount}`);
    console.log("========================================");

    await notifyAndLogCompletion({
      taskType: "brandconnect.bulk.schedule",
      title: "예약발행 일괄 작업 완료",
      summary: `예약발행 ${successCount}건 완료, ${failedCount}건 실패`,
      successCount,
      failedCount,
      links: [...completedLinks, ...failedLinks],
      extra: {
        startDate: startDate ?? "existing-scheduled-dates",
        intervalDays: options.intervalDays,
        scheduleMode: shouldReassignScheduleDates ? "reassign-from-start-date" : "preserve-existing-dates",
        createdAfter: options.createdAfter?.toISOString() ?? null,
        timezone: NAVER_SCHEDULE_TIMEZONE,
      },
    });

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error: unknown) => {
  const message = getErrorMessage(error);
  console.error("❌ 일괄 예약발행 실패:", getErrorMessage(error));
  await notifyAndLogCompletion({
    taskType: "brandconnect.bulk.schedule.fatal-error",
    title: "예약발행 일괄 작업 오류",
    summary: message,
    successCount: 0,
    failedCount: 1,
    links: [
      {
        label: "대시보드 확인",
        url: buildAppUrl("/"),
        status: "FAILED",
        description: message,
      },
    ],
    extra: {
      fatal: true,
    },
  });
  process.exit(1);
});

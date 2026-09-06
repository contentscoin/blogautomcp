import { preparedPostsFirst } from "../src/lib/prepared-post-priority";
import "dotenv/config";
import { runScheduledDraftWorkflow } from "./lib/scheduled-draft-workflow";
import { PrismaClient } from "../src/generated/prisma";
import { addDaysToYmd, compactedScheduleDate } from "../src/lib/bulk-schedule-plan";
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
  return runScheduledDraftWorkflow(linkId, scheduledDate).then(() => ({ code: 0, signal: null }));
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
    const selected = preparedPostsFirst(await prisma.brandLink.findMany({
      where: {
        ...createdAfterWhere,
        connectKind: options.connectKind,
        status: "READY",
        scheduledPublishAt: { not: null },
      },
      orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        productName: true,
        scheduledPublishAt: true,
      },
    }), process.env.BULK_TARGET_IDS_JSON ? Number.MAX_SAFE_INTEGER : options.limit);
    const targetIds: string[] | null = process.env.BULK_TARGET_IDS_JSON ? JSON.parse(process.env.BULK_TARGET_IDS_JSON) : null;
    const pending = targetIds ? targetIds.map(id => {
      const row = selected.find(item => item.id === id);
      if (!row) throw new Error(`선택한 상품이 더 이상 발행 가능하지 않습니다: ${id}`);
      return row;
    }) : selected;

    if (pending.length === 0) {
      console.log("예약발행일이 설정된 READY 링크가 없어 종료합니다.");
      return;
    }

    const occupiedScheduleDates = shouldReassignScheduleDates
      ? new Set(
          (
            await prisma.brandLink.findMany({
              where: {
                connectKind: options.connectKind,
                status: "SCHEDULED",
                scheduledPublishAt: { not: null },
              },
              select: { scheduledPublishAt: true },
            })
          )
            .map((row) => row.scheduledPublishAt)
            .filter((value): value is Date => Boolean(value))
            .map((value) => formatYmdInTimeZone(value, NAVER_SCHEDULE_TIMEZONE))
        )
      : new Set<string>();

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
        // 실패한 시도는 날짜 슬롯을 소비하지 않고, 기존 SCHEDULED 날짜도
        // 건너뛴다. 2일·4일이 이미 예약돼 있으면 다음 성공 후보는 3일부터
        // 채워 중복 예약과 빈 날짜를 함께 막는다.
        scheduledDate = compactedScheduleDate(
          startDate,
          successCount,
          options.intervalDays,
          occupiedScheduleDates
        );
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
          throw new Error("발행 결과가 불확실합니다. 중복 실행하지 말고 진행 상태를 확인하세요.");
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
          // A zero exit code may mean only a draft was saved. Neither READY,
          // a missing record, nor an immediate publication proves scheduling.
          failedCount += 1;
          failedLinks.push({
            label: refreshed?.productName || link.productName || link.id,
            url: refreshed?.postUrl || buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: "FAILED",
            description: `예약 등록이 확인되지 않았습니다 (현재 상태: ${refreshed?.status || "MISSING"}). 초안 저장과 예약 완료는 다릅니다.`,
          });
        }
      } catch (error: unknown) {
        const uncertain = await prisma.brandLink.findUnique({ where: { id: link.id }, select: { status: true } });
        if (uncertain?.status === "PUBLISHING") throw new Error(`발행 중 연결이 끊겼습니다 (${link.id}). 중복 실행 방지를 위해 나머지 작업을 중단합니다. 실제 발행 결과를 먼저 확인하세요.`);
        failedCount += 1;
        const message = getErrorMessage(error);
        await prisma.brandLink.updateMany({
          // A disconnected API call does not prove the publisher stopped.
          // Preserve active state to prevent an accidental duplicate retry.
          where: { id: link.id, status: { in: ["READY", "FAILED"] } },
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

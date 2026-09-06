import { preparedPostsFirst } from "../src/lib/prepared-post-priority";
import "dotenv/config";
import { runAutomaticDraftWorkflow } from "./lib/scheduled-draft-workflow";
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
  targetDate: string | null;
  allScheduled: boolean;
  createdAfter: Date | null;
}

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    connectKind: "SHOPPING",
    limit: 10,
    delayMs: 1500,
    targetDate: null,
    allScheduled: true,
    createdAfter: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--connect-kind=")) {
      options.connectKind = arg.split("=")[1]?.trim().toLowerCase() === "travel" ? "TRAVEL" : "SHOPPING";
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value > 0 && value <= 100) {
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

    if (arg.startsWith("--target-date=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        options.targetDate = value;
        options.allScheduled = false;
      }
      continue;
    }

    if (arg === "--all-scheduled") {
      options.allScheduled = true;
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
  return formatYmd(utcDate);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

async function runSimpleAgentNow(linkId: string) {
  await runAutomaticDraftWorkflow(linkId, { publishMode: "now" });
  return { code: 0, signal: null };
}
async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));
  const targetDate = options.targetDate ?? formatYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
  const nextDate = addDaysToYmd(targetDate, 1);
  const createdAfterWhere = options.createdAfter
    ? {
        createdAt: {
          gte: options.createdAfter,
        },
      }
    : {};
  const pendingWhere = options.allScheduled
    ? {
        ...createdAfterWhere,
        connectKind: options.connectKind,
        status: "READY",
      }
    : {
        ...createdAfterWhere,
        connectKind: options.connectKind,
        status: "READY",
        scheduledPublishAt: {
          gte: new Date(`${targetDate}T00:00:00.000Z`),
          lt: new Date(`${nextDate}T00:00:00.000Z`),
        },
      };

  try {
    const selected = preparedPostsFirst(await prisma.brandLink.findMany({
      where: pendingWhere,
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
      console.log(
        options.allScheduled
          ? "바로 발행할 READY 링크가 없어 종료합니다."
          : `오늘 날짜(${targetDate})로 예약된 READY 링크가 없어 종료합니다.`
      );
      return;
    }

    console.log(
      options.allScheduled
        ? `즉시 일괄발행 시작: ${pending.length}건 / 예약 READY 전체`
        : `당일 일괄발행 시작: ${pending.length}건 / 대상일=${targetDate}`
    );

    let successCount = 0;
    let failedCount = 0;
    const completedLinks: CompletionLink[] = [];
    const failedLinks: CompletionLink[] = [];

    for (let index = 0; index < pending.length; index += 1) {
      const link = pending[index];
      const scheduledDate = link.scheduledPublishAt ? formatYmd(link.scheduledPublishAt) : "-";

      console.log(
        `\n[${index + 1}/${pending.length}] ${link.id} | ${scheduledDate} | ${
          link.productName ?? "(상품명 없음)"
        }`
      );

      await prisma.brandLink.update({
        where: { id: link.id },
        data: {
          errorMessage: null,
        },
      });

      try {
        const result = await runSimpleAgentNow(link.id);

        if (result.code !== 0) {
          failedCount += 1;
          const detail = `code=${result.code ?? "null"}, signal=${result.signal ?? "null"}`;
          await prisma.brandLink.updateMany({
            where: { id: link.id, status: "PUBLISHING" },
            data: {
              status: "FAILED",
              errorMessage: `바로 일괄발행 스크립트 비정상 종료(${detail})`,
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

        if (refreshed?.status === "PUBLISHED") {
          successCount += 1;
          completedLinks.push({
            label: refreshed.productName || link.productName || link.id,
            url: refreshed.postUrl || buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: "PUBLISHED",
            description: refreshed.postUrl ? "발행글" : "대시보드 확인",
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
          failedCount += 1;
          failedLinks.push({
            label: refreshed?.productName || link.productName || link.id,
            url: refreshed?.postUrl || buildAppUrl(`/?brandLinkId=${link.id}`),
            scheduledDate,
            status: refreshed?.status || "DONE",
            description: "실제 발행 완료가 확인되지 않았습니다.",
          });
        }
      } catch (error: unknown) {
        const uncertain = await prisma.brandLink.findUnique({ where: { id: link.id }, select: { status: true } });
        if (uncertain?.status === "PUBLISHING") throw new Error(`발행 중 연결이 끊겼습니다 (${link.id}). 중복 실행 방지를 위해 나머지 작업을 중단합니다. 실제 발행 결과를 먼저 확인하세요.`);
        failedCount += 1;
        const message = getErrorMessage(error);
        await prisma.brandLink.updateMany({
          where: { id: link.id, status: { in: ["READY", "FAILED"] } },
          data: {
            status: "FAILED",
            errorMessage: `바로 일괄발행 실행 실패: ${message}`,
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
    console.log(options.allScheduled ? "바로 일괄발행 완료" : "당일 일괄발행 완료");
    console.log(`성공: ${successCount}`);
    console.log(`실패: ${failedCount}`);
    console.log("========================================");

    await notifyAndLogCompletion({
      taskType: options.allScheduled
        ? "brandconnect.bulk.now.all-scheduled"
        : "brandconnect.bulk.now.target-date",
      title: options.allScheduled ? "바로 일괄발행 완료" : "당일 일괄발행 완료",
      summary: `바로발행 ${successCount}건 완료, ${failedCount}건 실패`,
      successCount,
      failedCount,
      links: [...completedLinks, ...failedLinks],
      extra: {
        targetDate: options.allScheduled ? null : targetDate,
        allScheduled: options.allScheduled,
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
  console.error("바로 일괄발행 실패:", getErrorMessage(error));
  await notifyAndLogCompletion({
    taskType: "brandconnect.bulk.now.fatal-error",
    title: "바로 일괄발행 작업 오류",
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

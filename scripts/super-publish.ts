import "dotenv/config";
import path from "path";
import { spawnSync } from "child_process";
import { PrismaClient } from "../src/generated/prisma";
import { parseConnectKind, type ConnectKind } from "../src/lib/brandconnect-kind";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAutomationEnabled,
} from "../src/lib/chatgpt-browser-automation";
import {
  buildAppUrl,
  notifyAndLogCompletion,
  type CompletionLink,
} from "./lib/chatbot-notifier";

interface CliOptions {
  connectKind: ConnectKind;
  collectCount: number;
  todayCount: number;
  dailyQuota: number;
  delayMs: number;
  startDate: string;
  intervalDays: number;
  categoryUrl: string | null;
  selectionProfile: string | null;
  promotionFilter: string | null;
  categoryFilter: string | null;
  duplicateWindowDays: number;
  storageStatePath: string | null;
}

interface PhaseResult {
  name: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  skipped?: boolean;
}

const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const AGENT_AI_PROVIDER = process.env.AI_PROVIDER || "openai";
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

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    connectKind: "shopping",
    collectCount: 200,
    todayCount: 50,
    dailyQuota: 50,
    delayMs: 1500,
    startDate: formatYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE),
    intervalDays: 1,
    categoryUrl: null,
    selectionProfile: null,
    promotionFilter: null,
    categoryFilter: null,
    duplicateWindowDays: parseBoundedInteger(process.env.BRANDCONNECT_DUPLICATE_WINDOW_DAYS, 30, 0, 3650),
    storageStatePath: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--connect-kind=")) {
      options.connectKind = parseConnectKind(arg.split("=")[1]);
      continue;
    }
    if (arg.startsWith("--collect-count=")) {
      options.collectCount = parseBoundedInteger(arg.split("=")[1], options.collectCount, 1, 200);
      continue;
    }
    if (arg.startsWith("--today-count=")) {
      options.todayCount = parseBoundedInteger(arg.split("=")[1], options.todayCount, 1, 200);
      continue;
    }
    if (arg.startsWith("--daily-quota=")) {
      options.dailyQuota = parseBoundedInteger(arg.split("=")[1], options.dailyQuota, 1, 200);
      continue;
    }
    if (arg.startsWith("--delay-ms=")) {
      options.delayMs = parseBoundedInteger(arg.split("=")[1], options.delayMs, 0, 60000);
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
      options.intervalDays = parseBoundedInteger(arg.split("=")[1], options.intervalDays, 1, 30);
      continue;
    }
    if (arg.startsWith("--category-url=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.categoryUrl = value;
      }
      continue;
    }
    if (arg.startsWith("--selection-profile=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.selectionProfile = value;
      }
      continue;
    }
    if (arg.startsWith("--promotion-filter=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.promotionFilter = value;
      }
      continue;
    }
    if (arg.startsWith("--category-filter=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.categoryFilter = value;
      }
      continue;
    }
    if (arg.startsWith("--duplicate-window-days=")) {
      options.duplicateWindowDays = parseBoundedInteger(
        arg.split("=")[1],
        options.duplicateWindowDays,
        0,
        3650
      );
      continue;
    }
    if (arg.startsWith("--storage-state=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.storageStatePath = value;
      }
    }
  }

  return options;
}

function runScript(scriptName: string, args: string[]): PhaseResult {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  const result = spawnSync(
    process.execPath,
    [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath, ...args],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        AI_PROVIDER: AGENT_AI_PROVIDER,
        ...buildChatGptBrowserAutomationEnv(isChatGptBrowserAutomationEnabled()),
        HUMAN_MOBILE_POLISH_ENABLED: "true",
        PRODUCT_THUMBNAIL_CHATGPT_ENABLED: process.env.PRODUCT_THUMBNAIL_CHATGPT_ENABLED || "false",
        PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE:
          process.env.PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE || "false",
        PRODUCT_THUMBNAIL_IMAGE_WAIT_MS:
          process.env.PRODUCT_THUMBNAIL_IMAGE_WAIT_MS || "60000",
        PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED:
          process.env.PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED || "false",
        CHATBOT_SUPPRESS_AGENT_NOTIFY: "true",
      },
    }
  );

  return {
    name: scriptName,
    code: result.status,
    signal: result.signal,
  };
}

function phaseSucceeded(phase: PhaseResult): boolean {
  return phase.skipped === true || phase.code === 0;
}

function describePhase(phase: PhaseResult): string {
  if (phase.skipped) return `${phase.name}=skipped`;
  return `${phase.name}=code:${phase.code ?? "null"},signal:${phase.signal ?? "null"}`;
}

function statusDescription(status: string, errorMessage: string | null): string {
  if (status === "PUBLISHED") return "Published now";
  if (status === "SCHEDULED") return "Scheduled";
  if (status === "FAILED") return errorMessage || "Failed";
  if (status === "READY") return "Not processed";
  if (status === "PUBLISHING") return "Still publishing";
  return status;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const phases: PhaseResult[] = [];

  try {
    console.log("=".repeat(70));
    console.log("Super Publishing start");
    console.log(`- collectCount: ${options.collectCount}`);
    console.log(`- connectKind: ${options.connectKind}`);
    console.log(`- todayCount: ${options.todayCount}`);
    console.log(`- dailyQuota: ${options.dailyQuota}`);
    console.log(`- startDate: ${options.startDate}`);
    console.log(`- promotionFilter: ${options.promotionFilter || "-"}`);
    console.log(`- categoryFilter: ${options.categoryFilter || "-"}`);
    console.log(`- duplicateWindowDays: ${options.duplicateWindowDays}`);
    console.log(`- startedAt: ${startedAtIso}`);
    console.log("=".repeat(70));

    const registerArgs = [
      `--connect-kind=${options.connectKind}`,
      `--count=${options.collectCount}`,
      `--start-date=${options.startDate}`,
      `--interval-days=${options.intervalDays}`,
      `--daily-quota=${options.dailyQuota}`,
    ];
    if (options.storageStatePath) {
      registerArgs.push(`--storage-state=${options.storageStatePath}`);
    }
    if (options.selectionProfile) {
      registerArgs.push(`--selection-profile=${options.selectionProfile}`);
    }
    if (options.categoryUrl) {
      registerArgs.push(`--category-url=${options.categoryUrl}`);
    }
    if (options.promotionFilter) {
      registerArgs.push(`--promotion-filter=${options.promotionFilter}`);
    }
    if (options.categoryFilter) {
      registerArgs.push(`--category-filter=${options.categoryFilter}`);
    }
    registerArgs.push(`--duplicate-window-days=${options.duplicateWindowDays}`);

    phases.push(runScript("brandconnect-seasonal-register.ts", registerArgs));

    const createdLinks = await prisma.brandLink.findMany({
      where: {
        connectKind: options.connectKind === "travel" ? "TRAVEL" : "SHOPPING",
        createdAt: { gte: startedAt },
        scheduledPublishAt: { not: null },
      },
      orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
      take: options.collectCount,
      select: {
        id: true,
        productName: true,
        scheduledPublishAt: true,
      },
    });

    const createdIds = createdLinks.map((link) => link.id);
    const originalScheduledDateById = new Map(
      createdLinks.map((link) => [
        link.id,
        link.scheduledPublishAt ? formatYmd(link.scheduledPublishAt) : null,
      ])
    );
    const todayLimit = Math.min(options.todayCount, createdLinks.length);
    const scheduleLimit = Math.max(0, createdLinks.length - todayLimit);

    if (todayLimit > 0) {
      phases.push(
        runScript("bulk-today-publish.ts", [
          `--limit=${todayLimit}`,
          `--delay-ms=${options.delayMs}`,
          "--all-scheduled",
          `--created-after=${startedAtIso}`,
          `--connect-kind=${options.connectKind}`,
        ])
      );
    } else {
      phases.push({ name: "bulk-today-publish.ts", code: 0, signal: null, skipped: true });
    }

    if (scheduleLimit > 0) {
      phases.push(
        runScript("bulk-schedule-publish.ts", [
          `--limit=${scheduleLimit}`,
          `--delay-ms=${options.delayMs}`,
          `--interval-days=${options.intervalDays}`,
          `--created-after=${startedAtIso}`,
          `--connect-kind=${options.connectKind}`,
        ])
      );
    } else {
      phases.push({ name: "bulk-schedule-publish.ts", code: 0, signal: null, skipped: true });
    }

    const finalRows =
      createdIds.length > 0
        ? await prisma.brandLink.findMany({
            where: { id: { in: createdIds } },
            orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              productName: true,
              status: true,
              postUrl: true,
              scheduledPublishAt: true,
              errorMessage: true,
            },
          })
        : [];

    const publishedCount = finalRows.filter((row) => row.status === "PUBLISHED").length;
    const scheduledCount = finalRows.filter((row) => row.status === "SCHEDULED").length;
    const failedOrUnfinishedCount = finalRows.filter(
      (row) => row.status !== "PUBLISHED" && row.status !== "SCHEDULED"
    ).length;
    const phaseFailed = phases.some((phase) => !phaseSucceeded(phase));

    const links: CompletionLink[] = finalRows.map((row) => {
      const originalDate = originalScheduledDateById.get(row.id);
      return {
        label: row.productName || row.id,
        url: row.postUrl || buildAppUrl(`/?brandLinkId=${row.id}`),
        scheduledDate: row.scheduledPublishAt ? formatYmd(row.scheduledPublishAt) : originalDate ?? undefined,
        status: row.status,
        description: statusDescription(row.status, row.errorMessage),
      };
    });
    const phaseFailureLinks: CompletionLink[] = phases
      .filter((phase) => !phaseSucceeded(phase))
      .map((phase) => ({
        label: phase.name,
        url: buildAppUrl("/"),
        status: "FAILED",
        description: describePhase(phase),
      }));
    const reportLinks = [...links, ...phaseFailureLinks];

    await notifyAndLogCompletion({
      taskType: phaseFailed
        ? "brandconnect.super-publishing.completed-with-errors"
        : "brandconnect.super-publishing.completed",
      title: phaseFailed ? "수퍼 퍼블리싱 오류 포함 완료" : "수퍼 퍼블리싱 완료",
      summary:
        `수집 ${createdLinks.length}/${options.collectCount}건, ` +
        `바로발행 ${publishedCount}건, 예약발행 ${scheduledCount}건, ` +
        `실패/미완료 ${failedOrUnfinishedCount + phaseFailureLinks.length}건`,
      successCount: publishedCount + scheduledCount,
      failedCount: failedOrUnfinishedCount + phaseFailureLinks.length,
      links: reportLinks,
      extra: {
        collectCount: options.collectCount,
        createdCount: createdLinks.length,
        todayLimit,
        scheduleLimit,
        dailyQuota: options.dailyQuota,
        startDate: options.startDate,
        intervalDays: options.intervalDays,
        createdAfter: startedAtIso,
        phases: phases.map(describePhase),
      },
    });

    console.log("=".repeat(70));
    console.log("Super Publishing complete");
    console.log(`- created: ${createdLinks.length}`);
    console.log(`- published: ${publishedCount}`);
    console.log(`- scheduled: ${scheduledCount}`);
    console.log(`- failed/unfinished: ${failedOrUnfinishedCount}`);
    console.log(`- phases: ${phases.map(describePhase).join(" | ")}`);
    console.log("=".repeat(70));

    if (phaseFailed || failedOrUnfinishedCount > 0) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Super Publishing fatal error:", message);
    await notifyAndLogCompletion({
      taskType: "brandconnect.super-publishing.fatal-error",
      title: "수퍼 퍼블리싱 오류",
      summary: message,
      successCount: 0,
      failedCount: 1,
      links: [
        {
          label: "Dashboard",
          url: buildAppUrl("/"),
          status: "FAILED",
          description: message,
        },
      ],
      extra: {
        fatal: true,
        collectCount: options.collectCount,
        startDate: options.startDate,
        phases: phases.map(describePhase),
      },
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

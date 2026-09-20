import "dotenv/config";
import { register } from "tsconfig-paths";
register({ baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } });
import path from "path";
import { spawn } from "child_process";
import { PrismaClient } from "../src/generated/prisma";
import fs from "fs";
import { getTopicTaskPublishReadiness, parseTopicSourceUrls } from "../src/lib/topic-task-publish-readiness";
import { getTopicTaskContentReadiness } from "../src/lib/topic-task-content-readiness";

interface CliOptions {
  limit: number;
  delayMs: number;
  dryRun: boolean;
  taskIds?: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 10,
    delayMs: 1500,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--task-ids=")) {
      const ids: unknown = JSON.parse(arg.slice("--task-ids=".length));
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !id.trim())) {
        throw new Error("--task-ids must be a non-empty array of task IDs (max 100)");
      }
      options.taskIds = [...new Set(ids as string[])];
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
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
    }
  }

  return options;
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

function getPublishBlocker(
  task: {
    selectedDraftId: string | null;
    preparedContentJson: string | null;
  },
  images: Array<{ localPath: string | null; provider: string | null; role: string | null }>,
): string | null {
  return getTopicTaskPublishReadiness({ ...task, preparedImages: images }, (localPath) => {
    try { const stat = fs.statSync(localPath); return stat.isFile() && stat.size > 0; } catch { return false; }
  }).reason;
}

function runTopicAgent(
  taskId: string,
  scheduledDate: string,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const scriptPath = path.join(process.cwd(), "scripts", "topic-agent.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        TS_NODE_BIN,
        "--project",
        "tsconfig.scripts.json",
        scriptPath,
        `--task-id=${taskId}`,
        "--publish-mode=schedule",
        `--scheduled-date=${scheduledDate}`,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "inherit", "inherit"],
        shell: false,
      },
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

  try {
    const pending = await prisma.topicPostTask.findMany({
      where: {
        ...(options.taskIds ? { id: { in: options.taskIds } } : {}),
        status: { in: ["PREPARED", "FAILED"] },
        pipelineStage: { not: "OUTCOME_UNKNOWN" },
        scheduledPublishAt: { not: null },
        selectedDraftId: { not: null },
        preparedContentJson: { not: null },
      },
      orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
      take: options.taskIds ? options.taskIds.length : Math.min(Math.max(options.limit * 5, options.limit), 100),
    });

    if (pending.length === 0) {
      console.log("예약발행일이 설정된 준비완료 주제글이 없어 종료합니다.");
      if (options.taskIds) process.exitCode = 1;
      return;
    }

    console.log(`주제글 예약발행 일괄 실행 시작: ${pending.length}건${options.dryRun ? " (dry-run)" : ""}`);

    let attemptedCount = 0;
    let skippedCount = 0;
    let successCount = 0;
    let failedCount = options.taskIds ? options.taskIds.length - pending.length : 0;

    for (let index = 0; index < pending.length; index += 1) {
      if (attemptedCount >= options.limit) break;

      const task = pending[index];
      const scheduledPublishAt = task.scheduledPublishAt;

      if (!scheduledPublishAt) {
        failedCount += 1;
        continue;
      }

      const scheduledDate = formatYmd(scheduledPublishAt);
      console.log(`\n[${index + 1}/${pending.length}] ${task.id} | ${scheduledDate} | ${task.topic}`);

      const draftImages = task.selectedDraftId
        ? await prisma.topicDraftImage.findMany({
            where: { draftId: task.selectedDraftId },
            select: { localPath: true, provider: true, role: true },
          })
        : [];

      const draft = task.selectedDraftId ? await prisma.topicDraft.findUnique({
        where: { id: task.selectedDraftId },
        select: { campaign: { select: { sourceUrls: true } } },
      }) : null;
      const publishBlocker = getPublishBlocker(task, draftImages) || getTopicTaskContentReadiness({
        ...task,
        sourceUrls: parseTopicSourceUrls(draft?.campaign.sourceUrls),
      }).reason;

      if (publishBlocker) {
        skippedCount += 1;
        if (options.taskIds) failedCount += 1;
        console.log(`건너뜀: ${publishBlocker}`);
        continue;
      }

      attemptedCount += 1;

      if (options.dryRun) {
        successCount += 1;
        console.log(`dry-run 통과: ${task.id} | ${scheduledDate} | ${task.topic}`);
        continue;
      }

      const claimed = await prisma.topicPostTask.updateMany({
        where: { id: task.id, status: { in: ["PREPARED", "FAILED"] }, updatedAt: task.updatedAt, pipelineStage: { not: "OUTCOME_UNKNOWN" } },
        data: {
          status: "PUBLISHING",
          pipelineStage: "PUBLISHING",
          errorMessage: null,
          scheduledPublishAt,
        },
      });
      if (claimed.count !== 1) {
        skippedCount += 1;
        if (options.taskIds) failedCount += 1;
        continue;
      }

      try {
        const result = await runTopicAgent(task.id, scheduledDate);

        if (result.code !== 0) {
          failedCount += 1;
          const detail = `code=${result.code ?? "null"}, signal=${result.signal ?? "null"}`;
          await prisma.topicPostTask.updateMany({
            where: { id: task.id, status: "PUBLISHING" },
            data: {
              status: "FAILED",
              pipelineStage: "OUTCOME_UNKNOWN",
              errorMessage: `일괄 예약발행 스크립트 비정상 종료(${detail})`,
            },
          });
          continue;
        }

        const refreshed = await prisma.topicPostTask.findUnique({
          where: { id: task.id },
          select: { status: true },
        });

        if (refreshed?.status === "SCHEDULED") {
          successCount += 1;
        } else if (refreshed?.status === "PUBLISHING") {
          failedCount += 1;
          await prisma.topicPostTask.update({
            where: { id: task.id },
            data: {
              status: "FAILED",
              pipelineStage: "OUTCOME_UNKNOWN",
              errorMessage: "예약발행 처리 결과를 확인하지 못했습니다.",
            },
          });
        } else if (refreshed?.status === "FAILED") {
          failedCount += 1;
        } else {
          failedCount += 1;
        }
      } catch (error: unknown) {
        failedCount += 1;
        const message = getErrorMessage(error);
        await prisma.topicPostTask.updateMany({
          where: { id: task.id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            pipelineStage: "OUTCOME_UNKNOWN",
            errorMessage: `일괄 예약발행 실행 실패: ${message}`,
          },
        });
      }

      if (options.delayMs > 0 && attemptedCount < options.limit && index < pending.length - 1) {
        await sleep(options.delayMs);
      }
    }

    console.log("\n========================================");
    console.log("주제글 예약발행 일괄 실행 완료");
    console.log(`실행대상: ${attemptedCount}`);
    console.log(`건너뜀: ${skippedCount}`);
    console.log(`성공: ${successCount}`);
    console.log(`실패: ${failedCount}`);
    console.log("========================================");

    if (failedCount > 0 && !options.dryRun) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("일괄 주제글 예약발행 실패:", getErrorMessage(error));
  process.exit(1);
});

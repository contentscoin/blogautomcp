import "dotenv/config";
import path from "path";
import { spawn } from "child_process";
import { PrismaClient } from "../src/generated/prisma";
import { parsePreparedTopicContent } from "../src/lib/topic-task-contract";

interface CliOptions {
  limit: number;
  delayMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 10,
    delayMs: 1500,
    dryRun: false,
  };

  for (const arg of argv) {
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

const GENERIC_IMAGE_PROVIDERS = new Set(["loremflickr", "picsum", "dummyimage", "stock-generic"]);
const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

function normalizeProvider(provider: string | null | undefined): string {
  const normalized = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (!normalized) return "unknown";
  if (normalized === "stock") return "stock-generic";
  if (normalized === "topic-craft-ai") return "ai";
  return normalized;
}

function getPublishBlocker(
  task: {
    selectedDraftId: string | null;
    preparedContentJson: string | null;
  },
  images: Array<{ localPath: string | null; provider: string | null; role: string | null }>,
): string | null {
  if (!parsePreparedTopicContent(task.preparedContentJson) || !task.selectedDraftId) {
    return "발행 전에 prepare 단계가 완료되어야 합니다. 먼저 주제글 준비를 다시 실행하세요.";
  }

  const resolvedImages = images.filter(
    (image) => Boolean(image.localPath) && normalizeProvider(image.provider) !== "unresolved",
  );
  const heroImage = resolvedImages.find((image) => (image.role || "").toLowerCase() === "hero");
  if (resolvedImages.length === 0 || !heroImage) {
    return "준비된 이미지가 부족합니다. hero 포함 이미지가 실제 파일로 확보된 뒤에만 발행할 수 있습니다.";
  }

  const heroIsGeneric = GENERIC_IMAGE_PROVIDERS.has(normalizeProvider(heroImage.provider));
  const allImagesAreGeneric = resolvedImages.every((image) =>
    GENERIC_IMAGE_PROVIDERS.has(normalizeProvider(image.provider)),
  );
  if (heroIsGeneric || allImagesAreGeneric) {
    return allImagesAreGeneric
      ? "준비된 이미지가 전부 generic fallback 입니다. 다시 준비한 뒤 발행하세요."
      : "대표(hero) 이미지가 generic fallback 입니다. 다시 준비한 뒤 발행하세요.";
  }

  return null;
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
        status: { in: ["PREPARED", "FAILED"] },
        scheduledPublishAt: { not: null },
        selectedDraftId: { not: null },
        preparedContentJson: { not: null },
      },
      orderBy: [{ scheduledPublishAt: "asc" }, { createdAt: "asc" }],
      take: Math.min(Math.max(options.limit * 5, options.limit), 100),
      select: {
        id: true,
        topic: true,
        selectedDraftId: true,
        preparedContentJson: true,
        scheduledPublishAt: true,
      },
    });

    if (pending.length === 0) {
      console.log("예약발행일이 설정된 준비완료 주제글이 없어 종료합니다.");
      return;
    }

    console.log(`주제글 예약발행 일괄 실행 시작: ${pending.length}건${options.dryRun ? " (dry-run)" : ""}`);

    let attemptedCount = 0;
    let skippedCount = 0;
    let successCount = 0;
    let failedCount = 0;

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

      const publishBlocker = getPublishBlocker(task, draftImages);

      if (publishBlocker) {
        skippedCount += 1;
        console.log(`건너뜀: ${publishBlocker}`);
        continue;
      }

      attemptedCount += 1;

      if (options.dryRun) {
        successCount += 1;
        console.log(`dry-run 통과: ${task.id} | ${scheduledDate} | ${task.topic}`);
        continue;
      }

      await prisma.topicPostTask.update({
        where: { id: task.id },
        data: {
          status: "PUBLISHING",
          pipelineStage: "PUBLISHING",
          errorMessage: null,
          scheduledPublishAt,
        },
      });

      try {
        const result = await runTopicAgent(task.id, scheduledDate);

        if (result.code !== 0) {
          failedCount += 1;
          const detail = `code=${result.code ?? "null"}, signal=${result.signal ?? "null"}`;
          await prisma.topicPostTask.updateMany({
            where: { id: task.id, status: "PUBLISHING" },
            data: {
              status: "FAILED",
              pipelineStage: "FAILED",
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
              pipelineStage: "FAILED",
              errorMessage: "예약발행 처리 결과를 확인하지 못했습니다.",
            },
          });
        } else if (refreshed?.status === "FAILED") {
          failedCount += 1;
        } else {
          successCount += 1;
        }
      } catch (error: unknown) {
        failedCount += 1;
        const message = getErrorMessage(error);
        await prisma.topicPostTask.updateMany({
          where: { id: task.id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            pipelineStage: "FAILED",
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

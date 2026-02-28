import "dotenv/config";
import path from "path";
import { spawn } from "child_process";
import { PrismaClient } from "@prisma/client";

interface CliOptions {
  limit: number;
  delayMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 10,
    delayMs: 1500,
  };

  for (const arg of argv) {
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

function runSimpleAgent(
  linkId: string,
  scheduledDate: string
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "ts-node",
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

  try {
    const pending = await prisma.brandLink.findMany({
      where: {
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

    console.log(`예약발행 일괄 실행 시작: ${pending.length}건`);

    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < pending.length; index += 1) {
      const link = pending[index];
      const scheduledPublishAt = link.scheduledPublishAt;

      if (!scheduledPublishAt) {
        failedCount += 1;
        continue;
      }

      const scheduledDate = formatYmd(scheduledPublishAt);
      console.log(
        `\n[${index + 1}/${pending.length}] ${link.id} | ${scheduledDate} | ${
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
          continue;
        }

        const refreshed = await prisma.brandLink.findUnique({
          where: { id: link.id },
          select: { status: true },
        });

        if (refreshed?.status === "SCHEDULED") {
          successCount += 1;
        } else if (refreshed?.status === "PUBLISHING") {
          failedCount += 1;
          await prisma.brandLink.update({
            where: { id: link.id },
            data: {
              status: "FAILED",
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
        await prisma.brandLink.updateMany({
          where: { id: link.id, status: "PUBLISHING" },
          data: {
            status: "FAILED",
            errorMessage: `일괄 예약발행 실행 실패: ${message}`,
          },
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

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("❌ 일괄 예약발행 실패:", getErrorMessage(error));
  process.exit(1);
});

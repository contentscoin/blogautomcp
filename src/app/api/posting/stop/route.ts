import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAdminApiKey } from "@/lib/api-auth";
import { cancelBrandPostImageRepairs } from "@/lib/brand-post-image-repair";

const execFileAsync = promisify(execFile);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

// 우리가 띄우는 발행 관련 스크립트 시그니처 (이 단어가 명령줄에 있으면 발행 프로세스로 간주)
const PUBLISH_SCRIPT_SIGNATURES = [
  "simple-agent",
  "super-publish",
  "topic-agent",
  "bulk-schedule-publish",
  "bulk-topic-schedule-publish",
  "brandconnect-seasonal-register",
];

/**
 * 실행 중인 발행 프로세스(및 그 하위 Playwright 브라우저)를 모두 종료한다.
 * - Windows: PowerShell로 명령줄을 조회해 해당 node 프로세스 트리를 taskkill
 * - 그 외: pgrep/pkill 패턴 매칭
 * 사용자의 일반 Chrome/Edge 등은 건드리지 않는다(우리 스크립트 시그니처만 매칭).
 */
async function killRunningPublishProcesses(): Promise<{ killed: number; detail: string }> {
  const sig = PUBLISH_SCRIPT_SIGNATURES.join("|");

  if (process.platform === "win32") {
    // 1) 발행 스크립트를 실행 중인 node 프로세스 PID 수집
    const psScript =
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
      `Where-Object { $_.CommandLine -match '${sig}' } | ` +
      `ForEach-Object { $_.ProcessId }`;
    let pids: number[] = [];
    try {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        psScript,
      ]);
      pids = stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0);
    } catch (error) {
      return { killed: 0, detail: `프로세스 조회 실패: ${getErrorMessage(error)}` };
    }

    if (pids.length === 0) {
      return { killed: 0, detail: "실행 중인 발행 프로세스가 없습니다." };
    }

    // 2) 각 PID의 프로세스 트리를 강제 종료 (하위 Playwright 브라우저 포함)
    let killed = 0;
    for (const pid of pids) {
      try {
        await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
        killed += 1;
      } catch {
        // 이미 종료된 경우 무시
      }
    }
    return { killed, detail: `발행 프로세스 ${killed}개(및 하위 브라우저)를 종료했습니다.` };
  }

  // POSIX
  try {
    await execFileAsync("pkill", ["-9", "-f", sig]);
    return { killed: 1, detail: "발행 프로세스를 종료했습니다." };
  } catch {
    return { killed: 0, detail: "실행 중인 발행 프로세스가 없거나 종료할 수 없습니다." };
  }
}

// POST: 모든 포스팅 정지 — 실행 중 프로세스 종료 + DRAFTING/PUBLISHING 상태 복구
export async function POST(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const cancelledImageJobs = cancelBrandPostImageRepairs();
    const kill = await killRunningPublishProcesses();

    const stamp = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const note = `사용자가 포스팅을 정지했습니다. (${stamp})`;

    const links = await prisma.brandLink.updateMany({
      where: { status: { in: ["DRAFTING", "PUBLISHING"] } },
      data: { status: "READY", errorMessage: note },
    });
    const tasks = await prisma.topicPostTask.updateMany({
      where: { status: "PUBLISHING" },
      data: { status: "READY", pipelineStage: "READY", errorMessage: note },
    });

    return NextResponse.json({
      success: true,
      message: `포스팅을 정지했습니다. ${kill.detail} 대기열 복구: 상품 ${links.count}건, 주제글 ${tasks.count}건.`,
      data: {
        killedProcesses: kill.killed,
        cancelledImageJobs,
        resetBrandLinks: links.count,
        resetTopicTasks: tasks.count,
      },
    });
  } catch (error: unknown) {
    console.error("포스팅 정지 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

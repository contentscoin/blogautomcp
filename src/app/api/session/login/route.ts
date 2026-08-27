import { NextRequest, NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAdminApiKey } from "@/lib/api-auth";
import { beginDesktopActivity } from "@/lib/desktop-activity";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

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

interface LoginBody {
  provider?: "naver";
  force?: boolean;
}

interface LoginJob {
  id: string;
  provider: "naver";
  status: "starting" | "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const globalJobs = globalThis as typeof globalThis & {
  __loginJobs?: Map<string, LoginJob>;
  __activeNaverLoginJobId?: string;
};
const loginJobs = globalJobs.__loginJobs ?? (globalJobs.__loginJobs = new Map<string, LoginJob>());

function clearActiveLoginJob(jobId: string): void {
  if (globalJobs.__activeNaverLoginJobId === jobId) {
    delete globalJobs.__activeNaverLoginJobId;
  }
}

export async function GET(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;
  const jobId = request.nextUrl.searchParams.get("jobId");
  const job = jobId ? loginJobs.get(jobId) : undefined;
  if (!job) return NextResponse.json({ success: false, error: "로그인 작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ success: true, data: job });
}

// POST: 로그인 브라우저 실행 (사용자 데스크탑에 로그인 창이 열림)
export async function POST(request: NextRequest) {
  let finishLoginActivity: (() => void) | null = null;
  let startedJobId: string | null = null;
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const updateError = requireNoPendingDesktopUpdate();
    if (updateError) {
      return updateError;
    }

    let body: LoginBody = {};
    try {
      body = (await request.json()) as LoginBody;
    } catch {
      // no-op
    }

    const provider = body.provider;
    if (provider !== "naver") {
      return NextResponse.json(
        { success: false, error: "로컬 프로그램에서는 네이버 로그인만 지원합니다. ChatGPT 연결은 MCP 주소를 사용하세요." },
        { status: 400 }
      );
    }

    const activeJobId = globalJobs.__activeNaverLoginJobId;
    const activeJob = activeJobId ? loginJobs.get(activeJobId) : undefined;
    if (activeJob && (activeJob.status === "starting" || activeJob.status === "running")) {
      return NextResponse.json({
        success: true,
        message: "이미 열린 네이버 로그인 창을 사용해주세요.",
        data: { provider, jobId: activeJob.id, reused: true },
      });
    }
    if (activeJobId) clearActiveLoginJob(activeJobId);

    const scriptPath = path.join(process.cwd(), "scripts", "login.ts");

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { success: false, error: `로그인 스크립트를 찾을 수 없습니다: ${scriptPath}` },
        { status: 500 }
      );
    }

    const logDir = path.join(process.cwd(), "logs", "login");
    fs.mkdirSync(logDir, { recursive: true });
    const logFilePath = path.join(logDir, `${formatLogStamp(new Date())}-${provider}.log`);
    const logFd = fs.openSync(logFilePath, "a");

    let child: ChildProcess;
    const jobId = randomUUID();
    startedJobId = jobId;
    const job: LoginJob = { id: jobId, provider, status: "starting", startedAt: new Date().toISOString() };
    loginJobs.set(jobId, job);
    globalJobs.__activeNaverLoginJobId = jobId;
    finishLoginActivity = beginDesktopActivity("naver-login");
    try {
      const loginArgs = [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath];
      if (body.force === true) loginArgs.push("--force-login");
      child = spawn(
        process.execPath,
        loginArgs,
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
      finishLoginActivity();
      clearActiveLoginJob(jobId);
      loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: "프로세스 PID가 생성되지 않았습니다." });
      return NextResponse.json(
        { success: false, error: "로그인 프로세스를 시작하지 못했습니다." },
        { status: 500 }
      );
    }

    let earlyExitCode: number | null | undefined;
    const startupError = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (!settled) { settled = true; resolve(value); }
      };
      child.once("error", (error) => finish(getErrorMessage(error)));
      child.once("exit", (code) => {
        earlyExitCode = code;
        finish(code === 0 ? null : `로그인 프로세스가 시작 직후 종료되었습니다 (코드 ${code ?? "없음"}).`);
      });
      setTimeout(() => finish(null), 750);
    });
    if (startupError) {
      finishLoginActivity();
      clearActiveLoginJob(jobId);
      loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: startupError });
      return NextResponse.json({ success: false, error: startupError, data: { jobId } }, { status: 500 });
    }

    if (earlyExitCode !== undefined) {
      finishLoginActivity();
      clearActiveLoginJob(jobId);
      loginJobs.set(jobId, { ...job, status: "succeeded", finishedAt: new Date().toISOString() });
    } else {
      loginJobs.set(jobId, { ...job, status: "running" });
      child.once("exit", (code) => {
        finishLoginActivity?.();
        clearActiveLoginJob(jobId);
        loginJobs.set(jobId, { ...job, status: code === 0 ? "succeeded" : "failed", finishedAt: new Date().toISOString(), error: code === 0 ? undefined : `로그인 프로세스가 실패했습니다 (코드 ${code ?? "없음"}).` });
      });
      child.once("error", (error) => {
        finishLoginActivity?.();
        clearActiveLoginJob(jobId);
        loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: getErrorMessage(error) });
      });
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message: body.force === true
        ? "기존 브라우저 인증을 비우고 네이버 재로그인 창을 열었습니다. 로그인하면 새 세션으로 교체됩니다."
        : "네이버 로그인 창을 열었습니다. 열린 브라우저에서 로그인하면 자동으로 세션이 저장됩니다.",
      data: { provider, jobId },
    });
  } catch (error: unknown) {
    finishLoginActivity?.();
    if (startedJobId) clearActiveLoginJob(startedJobId);
    console.error("로그인 실행 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

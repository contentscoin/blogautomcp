import { NextRequest, NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAdminApiKey } from "@/lib/api-auth";
import { beginDesktopActivity } from "@/lib/desktop-activity";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { getLogsDir } from "../../../../../scripts/lib/app-paths";

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

type LoginProvider = "naver" | "chatgpt";

interface LoginBody {
  provider?: LoginProvider;
  force?: boolean;
}

interface LoginJob {
  id: string;
  provider: LoginProvider;
  status: "starting" | "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const globalJobs = globalThis as typeof globalThis & {
  __loginJobs?: Map<string, LoginJob>;
  __activeLoginJobIds?: Partial<Record<LoginProvider, string>>;
};
const loginJobs = globalJobs.__loginJobs ?? (globalJobs.__loginJobs = new Map<string, LoginJob>());
const activeLoginJobIds = globalJobs.__activeLoginJobIds ?? (globalJobs.__activeLoginJobIds = {});

function clearActiveLoginJob(provider: LoginProvider, jobId: string): void {
  if (activeLoginJobIds[provider] === jobId) {
    delete activeLoginJobIds[provider];
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
    if (provider !== "naver" && provider !== "chatgpt") {
      return NextResponse.json(
        { success: false, error: "provider는 naver 또는 chatgpt여야 합니다." },
        { status: 400 }
      );
    }

    const activeJobId = activeLoginJobIds[provider];
    const activeJob = activeJobId ? loginJobs.get(activeJobId) : undefined;
    if (activeJob && (activeJob.status === "starting" || activeJob.status === "running")) {
      return NextResponse.json({
        success: true,
        message: `이미 열린 ${provider === "chatgpt" ? "ChatGPT" : "네이버"} 로그인 창을 사용해 주세요.`,
        data: { provider, jobId: activeJob.id, reused: true },
      });
    }
    if (activeJobId) clearActiveLoginJob(provider, activeJobId);

    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      provider === "chatgpt" ? "chatgpt-login.ts" : "login.ts",
    );

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { success: false, error: `로그인 스크립트를 찾을 수 없습니다: ${scriptPath}` },
        { status: 500 }
      );
    }

    const logDir = path.join(getLogsDir(), "login");
    fs.mkdirSync(logDir, { recursive: true });
    const logFilePath = path.join(logDir, `${formatLogStamp(new Date())}-${provider}.log`);
    const logFd = fs.openSync(logFilePath, "a");

    let child: ChildProcess;
    const jobId = randomUUID();
    startedJobId = jobId;
    const job: LoginJob = { id: jobId, provider, status: "starting", startedAt: new Date().toISOString() };
    loginJobs.set(jobId, job);
    activeLoginJobIds[provider] = jobId;
    finishLoginActivity = beginDesktopActivity(`${provider}-login`);
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
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            ...(provider === "chatgpt"
              ? {
                  CHATGPT_LOGIN_MANUAL_CONFIRM: "false",
                  CHATGPT_VERIFY_CUSTOM_GPTS: "false",
                  CHATGPT_LOGIN_USE_PROBE: "false",
                  BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || "chrome",
                }
              : {}),
          },
        }
      );
    } finally {
      fs.closeSync(logFd);
    }

    if (!child.pid) {
      finishLoginActivity();
      clearActiveLoginJob(provider, jobId);
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
      clearActiveLoginJob(provider, jobId);
      loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: startupError });
      return NextResponse.json({ success: false, error: startupError, data: { jobId } }, { status: 500 });
    }

    if (earlyExitCode !== undefined) {
      finishLoginActivity();
      clearActiveLoginJob(provider, jobId);
      loginJobs.set(jobId, { ...job, status: "succeeded", finishedAt: new Date().toISOString() });
    } else {
      loginJobs.set(jobId, { ...job, status: "running" });
      child.once("exit", (code) => {
        finishLoginActivity?.();
        clearActiveLoginJob(provider, jobId);
        loginJobs.set(jobId, { ...job, status: code === 0 ? "succeeded" : "failed", finishedAt: new Date().toISOString(), error: code === 0 ? undefined : `로그인 프로세스가 실패했습니다 (코드 ${code ?? "없음"}).` });
      });
      child.once("error", (error) => {
        finishLoginActivity?.();
        clearActiveLoginJob(provider, jobId);
        loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: getErrorMessage(error) });
      });
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message: provider === "chatgpt"
        ? body.force === true
          ? "기존 ChatGPT 웹 세션을 비우고 재로그인 창을 열었습니다. 입력창이 확인되면 자동으로 저장됩니다."
          : "ChatGPT 로그인 창을 열었습니다. 로그인 후 입력창이 확인되면 자동으로 세션이 저장됩니다."
        : body.force === true
          ? "기존 브라우저 인증을 비우고 네이버 재로그인 창을 열었습니다. 로그인하면 새 세션으로 교체됩니다."
          : "네이버 로그인 창을 열었습니다. 열린 브라우저에서 로그인하면 자동으로 세션이 저장됩니다.",
      data: { provider, jobId },
    });
  } catch (error: unknown) {
    finishLoginActivity?.();
    if (startedJobId) {
      const startedProvider = loginJobs.get(startedJobId)?.provider;
      if (startedProvider) clearActiveLoginJob(startedProvider, startedJobId);
    }
    console.error("로그인 실행 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

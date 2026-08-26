import { NextRequest, NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAdminApiKey } from "@/lib/api-auth";

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
  provider?: "naver" | "chatgpt";
}

interface LoginJob {
  id: string;
  provider: "naver" | "chatgpt";
  status: "starting" | "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const globalJobs = globalThis as typeof globalThis & { __loginJobs?: Map<string, LoginJob> };
const loginJobs = globalJobs.__loginJobs ?? (globalJobs.__loginJobs = new Map<string, LoginJob>());

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
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
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
        { success: false, error: "provider는 naver 또는 chatgpt 여야 합니다." },
        { status: 400 }
      );
    }

    const scriptPath =
      provider === "naver"
        ? path.join(process.cwd(), "scripts", "login.ts")
        : path.join(process.cwd(), "scripts", "chatgpt-login.ts");

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
    const job: LoginJob = { id: jobId, provider, status: "starting", startedAt: new Date().toISOString() };
    loginJobs.set(jobId, job);
    try {
      child = spawn(
        process.execPath,
        [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath],
        {
          cwd: process.cwd(),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          shell: false,
          env: {
            ...process.env,
            // ChatGPT 로그인은 터미널 입력(Enter) 없이 자동 감지·저장되도록 수동확인 끔
            ...(provider === "chatgpt" ? { CHATGPT_LOGIN_MANUAL_CONFIRM: "false" } : {}),
          },
        }
      );
    } finally {
      fs.closeSync(logFd);
    }

    if (!child.pid) {
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
      loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: startupError });
      return NextResponse.json({ success: false, error: startupError, data: { jobId } }, { status: 500 });
    }

    if (earlyExitCode !== undefined) {
      loginJobs.set(jobId, { ...job, status: "succeeded", finishedAt: new Date().toISOString() });
    } else {
      loginJobs.set(jobId, { ...job, status: "running" });
      child.once("exit", (code) => {
        loginJobs.set(jobId, { ...job, status: code === 0 ? "succeeded" : "failed", finishedAt: new Date().toISOString(), error: code === 0 ? undefined : `로그인 프로세스가 실패했습니다 (코드 ${code ?? "없음"}).` });
      });
      child.once("error", (error) => {
        loginJobs.set(jobId, { ...job, status: "failed", finishedAt: new Date().toISOString(), error: getErrorMessage(error) });
      });
    }

    child.unref();

    return NextResponse.json({
      success: true,
      message:
        provider === "naver"
          ? "네이버 로그인 창을 열었습니다. 열린 브라우저에서 로그인하면 자동으로 세션이 저장됩니다."
          : "ChatGPT 로그인 창을 열었습니다. 열린 브라우저에서 로그인/보안 인증을 완료하면 자동으로 세션이 저장됩니다.",
      data: { provider, jobId },
    });
  } catch (error: unknown) {
    console.error("로그인 실행 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface CodexLocalStatus {
  installed: boolean;
  authenticated: boolean;
  method: string | null;
  message: string;
  error: string | null;
}

export interface CodexLoginJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

interface CodexCommand {
  command: string;
  prefixArgs: string[];
}

declare global {
  var __blogautomcpCodexLoginJobs: Map<string, CodexLoginJob> | undefined;
}

const loginJobs = globalThis.__blogautomcpCodexLoginJobs ?? new Map<string, CodexLoginJob>();
globalThis.__blogautomcpCodexLoginJobs = loginJobs;

export function getBundledCodexEntrypoint(): string | null {
  const directPath = path.join(process.cwd(), "node_modules", "@openai", "codex", "bin", "codex.js");
  if (fs.existsSync(directPath)) return directPath;
  try {
    const resolved = require.resolve("@openai/codex/bin/codex.js");
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export function getBundledCodexExecutable(): string | null {
  const target = (() => {
    if (process.platform === "win32" && process.arch === "x64") {
      return { packageName: "codex-win32-x64", triple: "x86_64-pc-windows-msvc", executable: "codex.exe" };
    }
    if (process.platform === "win32" && process.arch === "arm64") {
      return { packageName: "codex-win32-arm64", triple: "aarch64-pc-windows-msvc", executable: "codex.exe" };
    }
    if (process.platform === "darwin" && process.arch === "x64") {
      return { packageName: "codex-darwin-x64", triple: "x86_64-apple-darwin", executable: "codex" };
    }
    if (process.platform === "darwin" && process.arch === "arm64") {
      return { packageName: "codex-darwin-arm64", triple: "aarch64-apple-darwin", executable: "codex" };
    }
    if (process.platform === "linux" && process.arch === "x64") {
      return { packageName: "codex-linux-x64", triple: "x86_64-unknown-linux-musl", executable: "codex" };
    }
    if (process.platform === "linux" && process.arch === "arm64") {
      return { packageName: "codex-linux-arm64", triple: "aarch64-unknown-linux-musl", executable: "codex" };
    }
    return null;
  })();
  if (!target) return null;
  const executablePath = path.join(
    process.cwd(),
    "node_modules",
    "@openai",
    target.packageName,
    "vendor",
    target.triple,
    "bin",
    target.executable,
  );
  return fs.existsSync(executablePath) ? executablePath : null;
}

function getCodexCommand(): CodexCommand | null {
  const executable = getBundledCodexExecutable();
  if (executable) return { command: executable, prefixArgs: [] };
  const entrypoint = getBundledCodexEntrypoint();
  return entrypoint ? { command: process.execPath, prefixArgs: [entrypoint] } : null;
}

function codexEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    OTEL_SDK_DISABLED: process.env.OTEL_SDK_DISABLED || "true",
  };
}

export function readCodexLocalStatus(): CodexLocalStatus {
  const codexCommand = getCodexCommand();
  if (!codexCommand) {
    return {
      installed: false,
      authenticated: false,
      method: null,
      message: "GPT 연결 모듈을 찾을 수 없습니다.",
      error: "프로그램 업데이트 또는 재설치가 필요합니다.",
    };
  }

  const result = spawnSync(codexCommand.command, [...codexCommand.prefixArgs, "login", "status"], {
    cwd: process.cwd(),
    env: codexEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 12_000,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const authenticated = result.status === 0 && /logged in|authenticated/i.test(output);
  const method = /chatgpt/i.test(output) ? "ChatGPT" : /api key/i.test(output) ? "API key" : null;
  return {
    installed: true,
    authenticated,
    method,
    message: authenticated ? "GPT 계정 연결됨" : "GPT 로그인 필요",
    error: authenticated ? null : output.slice(0, 500) || result.error?.message || null,
  };
}

export function startCodexLogin(): CodexLoginJob {
  const existing = Array.from(loginJobs.values()).find((job) => job.status === "running");
  if (existing) return existing;
  const codexCommand = getCodexCommand();
  if (!codexCommand) throw new Error("Codex 실행 파일을 찾을 수 없습니다.");

  const job: CodexLoginJob = {
    id: crypto.randomUUID(),
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  loginJobs.set(job.id, job);
  let output = "";
  const child = spawn(codexCommand.command, [...codexCommand.prefixArgs, "login"], {
    cwd: process.cwd(),
    env: codexEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-4000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.once("error", (error) => {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = error.message;
  });
  child.once("exit", (code) => {
    const status = readCodexLocalStatus();
    job.status = code === 0 && status.authenticated ? "succeeded" : "failed";
    job.completedAt = new Date().toISOString();
    job.error = job.status === "failed" ? output.trim().slice(-1000) || status.error || `Codex login exited with code ${code}` : null;
  });
  return job;
}

export function getCodexLoginJob(id: string): CodexLoginJob | null {
  return loginJobs.get(id) ?? null;
}

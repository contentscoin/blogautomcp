import { spawn } from "child_process";
import path from "path";
import { beginDesktopActivity } from "@/lib/desktop-activity";

export interface RunScriptResult {
  stdout: string;
  stderr: string;
  code: number;
  signal: NodeJS.Signals | null;
}

interface RunScriptOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function resolveTsNodeBin(cwd: string): string {
  return path.join(cwd, "node_modules", "ts-node", "dist", "bin.js");
}

export class ScriptExecutionError extends Error {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;

  constructor(
    message: string,
    payload: {
      stdout?: string;
      stderr?: string;
      code?: number | null;
      signal?: NodeJS.Signals | null;
    } = {}
  ) {
    super(message);
    this.name = "ScriptExecutionError";
    this.stdout = payload.stdout ?? "";
    this.stderr = payload.stderr ?? "";
    this.code = payload.code ?? null;
    this.signal = payload.signal ?? null;
  }
}

export function runTsNodeScript(
  scriptPath: string,
  args: string[] = [],
  options: RunScriptOptions = {}
): Promise<RunScriptResult> {
  if (process.env.DESKTOP_UPDATE_INSTALL_PENDING === "1") {
    return Promise.reject(new ScriptExecutionError("업데이트 설치가 준비되어 새 자동화 작업을 시작할 수 없습니다."));
  }
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 300_000;
  const resolvedScriptPath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(cwd, scriptPath);

  return new Promise((resolve, reject) => {
    const finishActivity = beginDesktopActivity(`script:${path.basename(resolvedScriptPath)}`);
    let child;
    try {
      child = spawn(
        process.execPath,
        [resolveTsNodeBin(cwd), "--project", "tsconfig.scripts.json", resolvedScriptPath, ...args],
        {
          cwd,
          env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        }
      );
    } catch (error) {
      finishActivity();
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      finishActivity();
      reject(
        new ScriptExecutionError(`스크립트 실행 실패: ${error.message}`, {
          stdout,
          stderr,
          code: null,
          signal: null,
        })
      );
    });

    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      finishActivity();

      if (timedOut) {
        reject(
          new ScriptExecutionError(`스크립트 실행 시간 초과 (${timeoutMs}ms)`, {
            stdout,
            stderr,
            code,
            signal,
          })
        );
        return;
      }

      if (code !== 0) {
        reject(
          new ScriptExecutionError(`스크립트 실행 실패 (exit code: ${code ?? "null"})`, {
            stdout,
            stderr,
            code,
            signal,
          })
        );
        return;
      }

      resolve({
        stdout,
        stderr,
        code: code ?? 0,
        signal,
      });
    });
  });
}

import { spawn } from "child_process";
import path from "path";

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

/**
 * TS 스크립트 실행 커맨드를 환경에 맞게 구성한다.
 * - 패키징된 데스크톱(DESKTOP_PACKAGED=1): npx가 없으므로 Electron 내장 node를
 *   ELECTRON_RUN_AS_NODE로 띄워 ts-node/register(transpile-only)로 .ts를 실행.
 * - 그 외(개발/서버): 기존대로 `npx ts-node`.
 */
export function buildTsScriptSpawn(
  resolvedScriptPath: string,
  args: string[],
  projectRoot: string
): { command: string; commandArgs: string[]; extraEnv: Record<string, string> } {
  if (process.env.DESKTOP_PACKAGED === "1") {
    const electronExec = process.env.DESKTOP_ELECTRON_EXEC || process.execPath;
    return {
      command: electronExec,
      commandArgs: ["-r", "ts-node/register/transpile-only", resolvedScriptPath, ...args],
      extraEnv: {
        ELECTRON_RUN_AS_NODE: "1",
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(projectRoot, "tsconfig.scripts.json"),
      },
    };
  }
  return {
    command: "npx",
    commandArgs: ["ts-node", "--project", "tsconfig.scripts.json", resolvedScriptPath, ...args],
    extraEnv: {},
  };
}

export function runTsNodeScript(
  scriptPath: string,
  args: string[] = [],
  options: RunScriptOptions = {}
): Promise<RunScriptResult> {
  const cwd = options.cwd ?? process.env.DESKTOP_PROJECT_ROOT ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 300_000;
  const resolvedScriptPath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(cwd, scriptPath);

  const { command, commandArgs, extraEnv } = buildTsScriptSpawn(resolvedScriptPath, args, cwd);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...extraEnv, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

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

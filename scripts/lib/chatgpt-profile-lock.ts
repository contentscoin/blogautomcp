import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSessionStorageDir } from "./app-paths";

interface LockPayload {
  ownerId: string;
  pid: number;
  purpose: string;
  acquiredAt: string;
}

export interface ChatGptProfileLock {
  path: string;
  release: () => Promise<void>;
}

interface AcquireOptions {
  purpose?: string;
  timeoutMs?: number;
  pollMs?: number;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(lockPath: string): LockPayload | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<LockPayload>;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.purpose !== "string" ||
      typeof parsed.acquiredAt !== "string"
    ) {
      return null;
    }
    return parsed as LockPayload;
  } catch {
    return null;
  }
}

function clearStaleLock(lockPath: string, staleAfterMs: number): boolean {
  if (!fs.existsSync(lockPath)) return true;
  const payload = readLock(lockPath);
  if (payload && isProcessAlive(payload.pid)) return false;
  if (!payload) {
    let lockAgeMs: number;
    try {
      lockAgeMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
    if (lockAgeMs < Math.min(staleAfterMs, 10_000)) return false;
  }

  try {
    fs.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireChatGptProfileLock(
  options: AcquireOptions = {},
): Promise<ChatGptProfileLock> {
  const lockDir = getSessionStorageDir();
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, "chatgpt-profile.lock");
  const ownerId = crypto.randomUUID();
  const purpose = options.purpose || "chatgpt-browser";
  const timeoutMs = options.timeoutMs ?? positiveNumber(process.env.CHATGPT_PROFILE_LOCK_TIMEOUT_MS, 600_000);
  const pollMs = options.pollMs ?? 750;
  const staleAfterMs = Math.max(timeoutMs * 2, 3_600_000);
  const deadline = Date.now() + timeoutMs;
  let waitingLogged = false;

  while (Date.now() <= deadline) {
    try {
      const file = fs.openSync(lockPath, "wx");
      const payload: LockPayload = {
        ownerId,
        pid: process.pid,
        purpose,
        acquiredAt: new Date().toISOString(),
      };
      try {
        fs.writeFileSync(file, JSON.stringify(payload), "utf8");
        fs.closeSync(file);
      } catch (error) {
        try {
          fs.closeSync(file);
        } finally {
          fs.rmSync(lockPath, { force: true });
        }
        throw error;
      }
      let released = false;
      return {
        path: lockPath,
        release: async () => {
          if (released) return;
          const current = readLock(lockPath);
          if (!current) {
            if (!fs.existsSync(lockPath)) {
              released = true;
              return;
            }
            throw new Error("CHATGPT_PROFILE_LOCK_RELEASE_FAILED: 잠금 파일을 읽을 수 없습니다.");
          }
          if (current.ownerId === ownerId) {
            fs.rmSync(lockPath, { force: true });
          }
          released = true;
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (clearStaleLock(lockPath, staleAfterMs)) continue;
      if (!waitingLogged) {
        const current = readLock(lockPath);
        console.log(
          `      - 다른 ChatGPT 작업이 끝나기를 기다립니다${current?.purpose ? ` (${current.purpose})` : ""}.`,
        );
        waitingLogged = true;
      }
      await sleep(Math.max(100, pollMs));
    }
  }

  throw new Error("CHATGPT_BROWSER_BUSY: 다른 ChatGPT 작업이 실행 중입니다. 완료 후 다시 시도하세요.");
}

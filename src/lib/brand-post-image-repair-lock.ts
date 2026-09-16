import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import { atomicWriteTextFile } from "./atomic-text-file";

const LOCK_VERSION = "brand-post-image-repair-lock/v1" as const;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const MALFORMED_LOCK_GRACE_MS = 10_000;
const RECOVERY_GUARD_STALE_MS = 30_000;

interface ImageRepairLockPayload {
  version: typeof LOCK_VERSION;
  brandLinkId: string;
  ownerToken: string;
  ownerPid: number;
  purpose: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface BrandPostImageRepairLock {
  path: string;
  ownerToken: string;
  assertOwner: () => void;
  heartbeat: () => void;
  release: () => void;
}

interface AcquireImageRepairLockOptions {
  ownerToken?: string;
  purpose?: string;
  /** Fault/recovery tuning for regression tests. Production callers omit it. */
  staleAfterMs?: number;
  /** Pauses the heartbeat at its commit boundary in the focused race test. */
  beforeHeartbeatCommitForTest?: () => void;
}

interface RecoveryGuard {
  path: string;
  descriptor: number;
}

function assertBrandLinkId(brandLinkId: string): void {
  if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(brandLinkId)) {
    throw new Error("초안 상품 ID 형식이 올바르지 않습니다.");
  }
}

export function getBrandPostImageRepairLockPath(brandLinkId: string): string {
  assertBrandLinkId(brandLinkId);
  return path.join(getAppDataDir(), "prepared-brand-posts", brandLinkId, ".image-repair.lock");
}

function readLock(lockPath: string): ImageRepairLockPayload | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<ImageRepairLockPayload>;
    if (parsed.version !== LOCK_VERSION || typeof parsed.brandLinkId !== "string" ||
        typeof parsed.ownerToken !== "string" || !Number.isSafeInteger(parsed.ownerPid) ||
        Number(parsed.ownerPid) < 1 || typeof parsed.purpose !== "string" ||
        typeof parsed.acquiredAt !== "string" || typeof parsed.heartbeatAt !== "string") return null;
    return parsed as ImageRepairLockPayload;
  } catch {
    return null;
  }
}

function processState(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    if (code === "EPERM") return "alive";
    return "unknown";
  }
}

function lockAgeMs(lockPath: string, payload: ImageRepairLockPayload | null): number {
  let modifiedAt = 0;
  try { modifiedAt = fs.statSync(lockPath).mtimeMs; } catch { return Number.POSITIVE_INFINITY; }
  const heartbeatAt = payload ? Date.parse(payload.heartbeatAt) : Number.NaN;
  const lastActivityAt = Number.isFinite(heartbeatAt) ? Math.max(modifiedAt, heartbeatAt) : modifiedAt;
  return Math.max(0, Date.now() - lastActivityAt);
}

function isStaleLock(lockPath: string, staleAfterMs: number): boolean {
  const payload = readLock(lockPath);
  if (!payload) return lockAgeMs(lockPath, null) >= MALFORMED_LOCK_GRACE_MS;
  const state = processState(payload.ownerPid);
  if (state === "dead") return true;
  // A heartbeat proves that this exact image owner is active. The age bound also
  // recovers a lock whose dead PID has already been reused by an unrelated process.
  return lockAgeMs(lockPath, payload) >= staleAfterMs;
}

function acquireRecoveryGuard(lockPath: string): RecoveryGuard | null {
  const recoveryPath = `${lockPath}.recovery`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(recoveryPath, "wx", 0o600);
    return { path: recoveryPath, descriptor };
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the acquisition error. */ }
    }
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      if (Date.now() - fs.statSync(recoveryPath).mtimeMs < RECOVERY_GUARD_STALE_MS) return null;
      fs.rmSync(recoveryPath, { force: true });
      descriptor = fs.openSync(recoveryPath, "wx", 0o600);
      return { path: recoveryPath, descriptor };
    } catch {
      return null;
    }
  }
}

function releaseRecoveryGuard(guard: RecoveryGuard): void {
  try { fs.closeSync(guard.descriptor); } catch { /* Preserve the guarded operation. */ }
  try { fs.rmSync(guard.path, { force: true }); } catch { /* A later recovery can remove a stale guard. */ }
}

function removeStaleLock(lockPath: string, staleAfterMs: number): boolean {
  if (!fs.existsSync(lockPath)) return true;
  const recoveryGuard = acquireRecoveryGuard(lockPath);
  if (!recoveryGuard) return false;
  try {
    if (!fs.existsSync(lockPath)) return true;
    // Re-read only after winning the recovery guard. This prevents deleting a
    // lock that another contender has just recovered and replaced.
    if (!isStaleLock(lockPath, staleAfterMs)) return false;
    fs.rmSync(lockPath, { force: true });
    return !fs.existsSync(lockPath);
  } finally {
    releaseRecoveryGuard(recoveryGuard);
  }
}

function createLock(lockPath: string, payload: ImageRepairLockPayload): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(payload), "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the create error. */ }
      try { fs.rmSync(lockPath, { force: true }); } catch { /* The stale-lock path can recover it. */ }
    }
    throw error;
  }
}

/**
 * Acquires one durable image-repair owner per package across Node/Next processes.
 * A dead owner is reclaimed, while a live or recently malformed owner is never stolen.
 */
export function acquireBrandPostImageRepairLock(
  brandLinkId: string,
  options: AcquireImageRepairLockOptions = {},
): BrandPostImageRepairLock {
  const lockPath = getBrandPostImageRepairLockPath(brandLinkId);
  const ownerToken = options.ownerToken || crypto.randomUUID();
  const now = new Date().toISOString();
  const payload: ImageRepairLockPayload = {
    version: LOCK_VERSION,
    brandLinkId,
    ownerToken,
    ownerPid: process.pid,
    purpose: options.purpose || "brand-post-image-repair",
    acquiredAt: now,
    heartbeatAt: now,
  };
  const staleAfterMs = Math.max(30_000, options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      createLock(lockPath, payload);
      const assertOwner = () => {
        const current = readLock(lockPath);
        if (!current || current.ownerToken !== ownerToken || current.ownerPid !== process.pid) {
          throw new Error("IMAGE_REPAIR_OWNERSHIP_LOST: 이미지 보강 소유권이 변경되어 매니페스트 쓰기를 중단합니다.");
        }
      };
      return {
        path: lockPath,
        ownerToken,
        assertOwner,
        heartbeat: () => {
          // Stale recovery uses the same guard. Holding it across validation and
          // replacement closes the check-then-rename window in which a recovered
          // successor could otherwise be overwritten by the former owner.
          const recoveryGuard = acquireRecoveryGuard(lockPath);
          if (!recoveryGuard) {
            throw new Error("IMAGE_REPAIR_OWNERSHIP_LOST: 이미지 보강 잠금 변경이 진행 중이어서 하트비트를 중단합니다.");
          }
          try {
            assertOwner();
            const current = readLock(lockPath)!;
            atomicWriteTextFile(lockPath, JSON.stringify({
              ...current,
              heartbeatAt: new Date().toISOString(),
            }), {
              replaceForTest: options.beforeHeartbeatCommitForTest
                ? (temporaryPath, targetPath) => {
                    options.beforeHeartbeatCommitForTest?.();
                    fs.renameSync(temporaryPath, targetPath);
                  }
                : undefined,
            });
            assertOwner();
          } finally {
            releaseRecoveryGuard(recoveryGuard);
          }
        },
        release: () => {
          // Serialize the check and removal for the same reason as heartbeat.
          // If recovery owns the guard, leaving this lock behind is safer than
          // deleting the successor it may be installing.
          const recoveryGuard = acquireRecoveryGuard(lockPath);
          if (!recoveryGuard) return;
          try {
            const current = readLock(lockPath);
            if (current?.ownerToken === ownerToken && current.ownerPid === process.pid) {
              fs.rmSync(lockPath, { force: true });
            }
          } finally {
            releaseRecoveryGuard(recoveryGuard);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (removeStaleLock(lockPath, staleAfterMs)) continue;
      const current = readLock(lockPath);
      throw new Error(
        `IMAGE_REPAIR_BUSY: 이 초안의 이미지 보강이 다른 프로세스에서 진행 중입니다${current?.purpose ? ` (${current.purpose})` : ""}.`,
      );
    }
  }
  throw new Error("IMAGE_REPAIR_BUSY: 이 초안의 이미지 보강 잠금을 확보하지 못했습니다.");
}

/** Callers may use this as a hint; acquisition remains the authority. */
export function isBrandPostImageRepairLocked(brandLinkId: string): boolean {
  const lockPath = getBrandPostImageRepairLockPath(brandLinkId);
  if (!fs.existsSync(lockPath)) return false;
  if (!isStaleLock(lockPath, DEFAULT_STALE_AFTER_MS)) return true;
  // Remove a proven stale owner before returning idle. This matters for the
  // direct apply route, which does not call the long-running repair function.
  return !removeStaleLock(lockPath, DEFAULT_STALE_AFTER_MS);
}

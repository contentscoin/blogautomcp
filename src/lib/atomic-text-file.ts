import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface AtomicWriteTextFileOptions {
  /** File permissions for the replacement (for example, private settings). */
  mode?: number;
  /** Fault injection hook for regression tests; production callers omit it. */
  replaceForTest?: (temporaryPath: string, targetPath: string) => void;
  /** Exercise Windows sharing failures in cross-platform regression tests. */
  platformForTest?: NodeJS.Platform;
  /** Synchronous backoff hook for regression tests; production callers omit it. */
  waitForTest?: (milliseconds: number) => void;
}

const WINDOWS_RENAME_BACKOFF_MS = [20, 50, 100, 200] as const;
const MAX_RETRY_SNAPSHOT_BYTES = 8 * 1024 * 1024;

/** Unknown/unreadable targets cannot grant retry authority. Include identity
 * and bytes so another writer's replacement cannot be overwritten on retry. */
function retryFingerprint(file: string): string | undefined {
  try {
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_RETRY_SNAPSHOT_BYTES) return undefined;
    const bytes = fs.readFileSync(file), after = fs.lstatSync(file, { bigint: true });
    // Windows file IDs may exceed Number.MAX_SAFE_INTEGER. Rounding two
    // different IDs to the same number must not authorize replacement/cleanup.
    const identity = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.mode, stat.size,
      stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs].map(value => value.toString());
    if (JSON.stringify(identity(before)) !== JSON.stringify(identity(after))) return undefined;
    return JSON.stringify([...identity(after), crypto.createHash("sha256").update(bytes).digest("hex")]);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : undefined;
  }
}

function waitForWindowsSharing(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Writes a complete text file beside the target, flushes it, then atomically
 * replaces the target. Any failure before the rename leaves the prior target
 * untouched and removes the unpublished temporary file.
 */
export function atomicWriteTextFile(
  targetPath: string,
  content: string,
  options: AtomicWriteTextFileOptions = {},
): void {
  const resolvedTargetPath = path.resolve(targetPath);
  const targetDirectory = path.dirname(resolvedTargetPath);
  fs.mkdirSync(targetDirectory, { recursive: true });
  const temporaryPath = path.join(
    targetDirectory,
    `.${path.basename(resolvedTargetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  let descriptor: number | null = null;
  let ownedTemporary: { dev: bigint; ino: bigint; birthtimeNs: bigint } | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", options.mode);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.ino > BigInt(0)) ownedTemporary = { dev: opened.dev, ino: opened.ino, birthtimeNs: opened.birthtimeNs };
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    const windows = (options.platformForTest ?? process.platform) === "win32";
    const originalTarget = windows ? retryFingerprint(resolvedTargetPath) : undefined;
    const originalTemporary = windows ? retryFingerprint(temporaryPath) : undefined;
    const replace = options.replaceForTest || fs.renameSync;
    for (let attempt = 0; ; attempt++) {
      try { replace(temporaryPath, resolvedTargetPath); break; }
      catch (error) {
        const failure = error as NodeJS.ErrnoException;
        if (!windows || !["EPERM", "EACCES", "EBUSY"].includes(failure.code || "") ||
            (failure.syscall && failure.syscall !== "rename") || attempt >= WINDOWS_RENAME_BACKOFF_MS.length ||
            originalTarget === undefined || !originalTemporary || originalTemporary === "missing") throw error;
        const assertUnchanged = () => {
          if (retryFingerprint(resolvedTargetPath) !== originalTarget || retryFingerprint(temporaryPath) !== originalTemporary) {
            throw Object.assign(new Error("ATOMIC_WRITE_TARGET_CHANGED: 교체 대기 중 대상 또는 임시 파일이 변경되어 덮어쓰지 않았습니다."),
              { code: "ATOMIC_WRITE_TARGET_CHANGED", cause: error });
          }
        };
        assertUnchanged();
        (options.waitForTest || waitForWindowsSharing)(WINDOWS_RENAME_BACKOFF_MS[attempt]);
        assertUnchanged();
      }
    }
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write/flush error.
      }
    }
    try {
      const current = fs.lstatSync(temporaryPath, { bigint: true });
      // A failed exclusive open or a foreign replacement never permits cleanup.
      if (ownedTemporary && current.dev === ownedTemporary.dev && current.ino === ownedTemporary.ino &&
          current.birthtimeNs === ownedTemporary.birthtimeNs && !current.isSymbolicLink()) fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write/replace error.
    }
    throw error;
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface AtomicWriteTextFileOptions {
  /** Fault injection hook for regression tests; production callers omit it. */
  replaceForTest?: (temporaryPath: string, targetPath: string) => void;
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
  try {
    descriptor = fs.openSync(temporaryPath, "wx");
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    (options.replaceForTest || fs.renameSync)(temporaryPath, resolvedTargetPath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write/flush error.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write/replace error.
    }
    throw error;
  }
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteTextFile } from "../../src/lib/atomic-text-file";

export interface PreparedPackageTransactionResult {
  manifestPath: string;
  markdownPath: string;
  revisionDir: string;
}

interface PreparedPackageTransactionInput {
  outputDir: string;
  markdown: string;
  buildManifest: (markdownPath: string, markdownSha256: string) => unknown;
  /** Fault injection for the regression harness; production callers omit it. */
  beforeActivate?: () => void;
}

function writeDurableFile(filePath: string, content: string): void {
  const descriptor = fs.openSync(filePath, "wx");
  try {
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Publishes an immutable markdown revision, then atomically switches the root
 * manifest pointer. A crash before the final switch leaves the old manifest
 * and its markdown untouched, so readers can never observe a mixed pair.
 */
export function commitPreparedPackageTransaction(
  input: PreparedPackageTransactionInput,
): PreparedPackageTransactionResult {
  const outputDir = path.resolve(input.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const transactionId = crypto.randomUUID();
  const stagingRoot = path.join(outputDir, ".package-staging");
  const revisionsRoot = path.join(outputDir, ".package-revisions");
  const stagingDir = path.join(stagingRoot, transactionId);
  const revisionDir = path.join(revisionsRoot, transactionId);
  const markdownPath = path.join(revisionDir, "post.md");
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(revisionsRoot, { recursive: true });

  const markdownSha256 = crypto.createHash("sha256").update(input.markdown).digest("hex");
  const manifestJson = JSON.stringify(input.buildManifest(path.resolve(markdownPath), markdownSha256), null, 2);
  writeDurableFile(path.join(stagingDir, "post.md"), input.markdown);
  writeDurableFile(path.join(stagingDir, "manifest.json"), manifestJson);

  let revisionPublished = false;
  try {
    fs.renameSync(stagingDir, revisionDir);
    revisionPublished = true;
    input.beforeActivate?.();
    atomicWriteTextFile(manifestPath, manifestJson);
    return { manifestPath, markdownPath, revisionDir };
  } catch (error) {
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    if (revisionPublished && fs.existsSync(revisionDir)) fs.rmSync(revisionDir, { recursive: true, force: true });
    throw error;
  }
}

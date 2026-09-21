import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getBrandPostPackageDir } from "../../src/lib/brand-post-package";
import { atomicWriteTextFile } from "../../src/lib/atomic-text-file";

export type ImageRecoveryStage = "refresh-source" | "replan-images";
type Entry = { stage: ImageRecoveryStage; input: string; output?: string; status: "running" | "complete" | "failed"; at: string; reason?: string; externalFailure?: boolean };
const recoverable = new Set(["IMAGE_SOURCE_BINDING_REQUIRED", "PRODUCT_SOURCE_REQUIRED", "PRODUCT_SOURCE_DOWNLOAD_FAILED", "PRODUCT_CUTOUT_REQUIRED"]);
export const isRecoverableImageEvidenceFailure = (code?: string) => recoverable.has(code || "");
export function isRecoverableImageEvidenceResult(value: { code?: string; errors?: string[]; error?: string } | null | undefined): boolean {
  if (!isRecoverableImageEvidenceFailure(value?.code)) return false;
  if (value?.errors?.length) return value.errors.every(message => {
    const codes = message.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || [];
    return codes.length > 0 && codes.every(isRecoverableImageEvidenceFailure);
  });
  return (value?.error?.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || []).every(isRecoverableImageEvidenceFailure);
}

/** Ignore timestamps/statuses: an unchanged manuscript and evidence must not buy a new retry budget. */
export function imageRecoverySignature(root: string): string | null {
  const read = (file: string) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch { return null; } };
  const manifest = read("manifest.json");
  if (!manifest) return null;
  const context = read("mcp-draft-context.json");
  let receipts: string[] = [];
  try {
    receipts = fs.readdirSync(path.join(root, "product-sources")).filter(name => name.endsWith(".retrieval.json"))
      .map(name => read(`product-sources/${name}`)?.sha256).filter((sha): sha is string => typeof sha === "string").sort();
  } catch { /* No sources yet is a meaningful input state. */ }
  return crypto.createHash("sha256").update(JSON.stringify({
    version: 1, product: manifest.sourceSnapshot?.product,
    refreshedProduct: context?.product,
    sections: manifest.composition?.sections?.map((section: Record<string, unknown>) => ({
      id: section.id, title: section.title, body: section.body, imageIntent: section.imageIntent,
      imageMin: section.imageMin, imageMax: section.imageMax,
    })),
    assets: manifest.imageAssets?.map((asset: Record<string, unknown>) => [asset.sha256, asset.sectionId]), receipts,
  })).digest("hex");
}

/** Persist the claim before a long operation, including failures and interrupted runs. */
export async function runRecordedImageRecovery<T>(id: string, stage: ImageRecoveryStage, operation: () => Promise<T>): Promise<{ attempted: boolean; result?: T }> {
  const root = getBrandPostPackageDir(id);
  const input = imageRecoverySignature(root);
  // In-memory fixtures/non-persisted drafts still use the bounded workflow loop.
  if (!input) return { attempted: true, result: await operation() };
  const file = path.join(root, "image-recovery-history.json");
  let entries: Entry[] = [];
  try { const saved = JSON.parse(fs.readFileSync(file, "utf8")); if (Array.isArray(saved.entries)) entries = saved.entries; } catch { /* first run */ }
  if (entries.some(entry => !entry.externalFailure && entry.stage === stage && (entry.input === input || entry.output === input))) return { attempted: false };
  const entry: Entry = { stage, input, status: "running", at: new Date().toISOString() };
  entries.push(entry);
  const save = () => atomicWriteTextFile(file, JSON.stringify({ version: 1, entries: entries.slice(-32) }, null, 2));
  save();
  try {
    const result = await operation();
    entry.status = "complete";
    return { attempted: true, result };
  } catch (error) {
    entry.status = "failed";
    entry.reason = String((error as Error).message || error).slice(0, 500);
    // Stop this run, but a later explicit preparation after login/runtime repair
    // must not be permanently suppressed by unchanged product bytes.
    entry.externalFailure = /^(?:CODEX_(?:AUTH_REQUIRED|LOGIN_REQUIRED|MODEL_INCOMPATIBLE|TIMEOUT)|CHATGPT_BROWSER_(?:AUTH_REQUIRED|LOGIN_REQUIRED|UNREACHABLE|BUSY)|UNAUTHORIZED|LLM_UNAVAILABLE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|REQUEST_TIMEOUT)$/u
      .test((error as { code?: string }).code || "");
    throw error;
  } finally {
    entry.output = imageRecoverySignature(root) || input;
    save();
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readProductSnapshot } from "../../src/lib/draft-context-snapshot";
import type { PublishImageAuditOptions } from "./publish-image-audit";

/** Server-owned source context, shared with the final publication comparison. */
export type ProductSourceAuditContext = Pick<PublishImageAuditOptions,
  "selectedSourceSnapshot" | "selectedSourceProductId" | "selectedSourceDirectory" | "sourceSnapshotId">;

/** Preserve only the server's typed ambiguity tag; ordinary prose cannot grant it. */
export function sourceReviewFailureForSlot(error: unknown): { error: string; errorCode?: "SOURCE_REVIEW_CONFLICT" } {
  const message = error instanceof Error ? error.message : String(error);
  return (error as { code?: unknown })?.code === "SOURCE_REVIEW_CONFLICT"
    ? { error: `SOURCE_REVIEW_CONFLICT: ${message}`, errorCode: "SOURCE_REVIEW_CONFLICT" }
    : { error: message };
}

/** A proposal cache must not outlive changes to canonical facts or gallery bytes.
 * This reads lineage only; it does not approve a photo or change source files. */
export function productSourceAuditContextKey(context: ProductSourceAuditContext): string | null {
  const { selectedSourceSnapshot, selectedSourceProductId, selectedSourceDirectory, sourceSnapshotId } = context;
  if (![selectedSourceSnapshot, selectedSourceProductId, selectedSourceDirectory, sourceSnapshotId].some(value => value !== undefined)) return null;
  const invalid = (): never => { throw new Error("SOURCE_PROPOSAL_AUDIT_FAILED: INVALID_CONTEXT: Canonical selected source context is incomplete or changed"); };
  const snapshot = readProductSnapshot(selectedSourceSnapshot, { productId: selectedSourceProductId, connectKind: "SHOPPING" });
  if (!snapshot || !selectedSourceProductId || !selectedSourceDirectory || !path.isAbsolute(selectedSourceDirectory) ||
      snapshot.snapshotId !== sourceSnapshotId) return invalid();
  const gallery = new Set(Array.isArray(snapshot.product.referenceImageUrls)
    ? snapshot.product.referenceImageUrls.filter((url): url is string => typeof url === "string") : []);
  let directory = path.resolve(selectedSourceDirectory), names: string[] = [];
  let absent = false;
  try {
    directory = fs.realpathSync(directory);
    names = fs.readdirSync(directory).filter(name => name.endsWith(".retrieval.json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return invalid();
    absent = true; // The final comparison also permits a missing legacy cache.
  }
  const bindings: Array<{ sourceUrl: string; receiptSha256: string; actualSha256: string | null }> = [];
  for (const name of names) {
    try {
      const receiptPath = path.join(directory, name), receiptStat = fs.statSync(receiptPath);
      if (!receiptStat.isFile() || receiptStat.size < 1 || receiptStat.size > 32 * 1024 || path.dirname(fs.realpathSync(receiptPath)) !== directory) continue;
      const receiptBytes = fs.readFileSync(receiptPath), receipt = JSON.parse(receiptBytes.toString("utf8"));
      if (!gallery.has(receipt.sourceUrl)) continue;
      const file = path.join(directory, name.slice(0, -".retrieval.json".length));
      let actualSha256: string | null = null;
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.size > 0 && stat.size <= 24 * 1024 * 1024 && path.dirname(fs.realpathSync(file)) === directory)
          actualSha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      } catch { /* Missing comparison bytes invalidate any earlier complete binding. */ }
      bindings.push({ sourceUrl: receipt.sourceUrl,
        receiptSha256: crypto.createHash("sha256").update(receiptBytes).digest("hex"), actualSha256 });
    } catch { /* Invalid receipts do not provide selected lineage. */ }
  }
  return crypto.createHash("sha256").update(JSON.stringify({ version: 1, sourceSnapshotId,
    selectedSourceProductId, directory, absent, bindings })).digest("hex");
}

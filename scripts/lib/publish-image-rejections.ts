import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "./app-paths";
import { atomicWriteTextFile } from "../../src/lib/atomic-text-file";
import { normalizePublishedRenderNodes, type ResolvedPostDocumentV1 } from "../../src/lib/post-composition-contract";
import { invalidateSuccessfulImageAuditReceipt } from "./publish-image-audit-receipt";

type Composition = Pick<ResolvedPostDocumentV1, "renderNodes" | "sections">;
export type PublicationImageRejectionScope = "section" | "product";
interface Rejection {
  sha256: string;
  sectionId: string | null;
  context: string;
  rejectedAt: string;
  /** Old records omitted this field and remain section-scoped. */
  scope?: PublicationImageRejectionScope;
}
function location(id: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error("Invalid package ID");
  return path.join(getAppDataDir(), "prepared-brand-posts", id, "publish-image-rejections.json");
}
export function publicationImageContext(composition: Composition, sectionId: string | null): string {
  return crypto.createHash("sha256").update(JSON.stringify({ sectionId,
    intent: composition.sections.find(section => section.id === sectionId)?.imageIntent || "",
    text: normalizePublishedRenderNodes(composition.renderNodes).flatMap(node => "sectionId" in node && node.sectionId === sectionId &&
      (node.kind === "paragraph" || node.kind === "heading" || node.kind === "quotation") ? [{ kind: node.kind, text: node.text }] : []),
  })).digest("hex");
}
function read(id: string): Rejection[] {
  try {
    const records: unknown = JSON.parse(fs.readFileSync(location(id), "utf8"));
    return Array.isArray(records) ? records.filter((row): row is Rejection => row &&
      /^[a-f0-9]{64}$/.test(row.sha256) && /^[a-f0-9]{64}$/.test(row.context) &&
      (row.sectionId === null || typeof row.sectionId === "string") &&
      (row.scope === undefined || row.scope === "section" || row.scope === "product")) : [];
  } catch { return []; }
}
export function rejectedPublicationImageHashes(id: string, composition: Composition, sectionId: string | null): string[] {
  const context = publicationImageContext(composition, sectionId);
  return [...new Set(read(id).filter(row => row.scope === "product" ||
    (row.sectionId === sectionId && row.context === context)).map(row => row.sha256))];
}
/** A fresh complete pixel verdict can resolve a previous false positive, but
 * only for those exact bytes and unchanged publication context. */
export function clearReviewedPublicationImageRejections(id: string, composition: Composition,
  accepted: Array<{ sha256: string; sectionId: string | null }>): void {
  if (!accepted.length) return;
  const records = read(id);
  const remaining = records.filter(row => !accepted.some(item => item.sha256 === row.sha256 &&
    (row.scope === "product" || (item.sectionId === row.sectionId &&
      publicationImageContext(composition, item.sectionId) === row.context))));
  if (remaining.length !== records.length) atomicWriteTextFile(location(id), JSON.stringify(remaining, null, 2));
}
/** Only definitive pixel rejections, tied to unchanged actual publication text.
 * No raw prompt, image path, credentials, or model response is persisted. */
export function recordPublicationImageRejections(id: string, composition: Composition,
  rejected: Array<{ sha256: string; sectionId: string | null; scope?: PublicationImageRejectionScope }>): void {
  if (!rejected.length) return;
  const file = location(id);
  // A first, unsaved draft has no package to invalidate yet; preserve the
  // original audit failure instead of replacing it with an ENOENT exception.
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "manifest.json"), "utf8")); }
  catch { return; }
  if (manifest.brandLinkId !== id || manifest.version !== "brand-post-package/v2") return;
  const records = read(id);
  let added = false;
  for (const item of rejected) {
    const context = publicationImageContext(composition, item.sectionId);
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || context !== publicationImageContext(manifest.composition, item.sectionId)) continue;
    const scope = item.scope || "section";
    const duplicate = records.findIndex(row => row.sha256 === item.sha256 && (row.scope || "section") === scope &&
      (scope === "product" || (row.sectionId === item.sectionId && row.context === context)));
    if (duplicate >= 0) records.splice(duplicate, 1);
    records.push({ ...item, scope, context, rejectedAt: new Date().toISOString() });
    added = true;
  }
  if (added) invalidateSuccessfulImageAuditReceipt(id);
  atomicWriteTextFile(file, JSON.stringify(records.slice(-64), null, 2));
}

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
export type PublicationImageRegenerationHoldKind = "unresolved-identity" | "uncorroborated-identifier";
export interface PublicationImageRegenerationHoldInput {
  sha256: string;
  sectionId: string | null;
  slotId: string;
  sourceSnapshotId: string;
  policyFingerprint: string;
  kind: PublicationImageRegenerationHoldKind;
}
interface RegenerationHold extends PublicationImageRegenerationHoldInput {
  version: "publication-image-regeneration-hold/v1";
  context: string;
  heldAt: string;
}
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const holdError = () => new Error("PUBLICATION_IMAGE_REGENERATION_HELD: 사진의 미해결 검수 기록을 보존했습니다. 새 이미지 생성 대신 현재 사진의 실제 검수를 완료해야 합니다.");
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
function holdLocation(id: string): string {
  return path.join(path.dirname(location(id)), "publish-image-regeneration-holds.json");
}
function readHolds(id: string): { present: boolean; invalid: boolean; records: RegenerationHold[] } {
  try {
    const file = holdLocation(id);
    if (fs.statSync(file).size > 1024 * 1024) return { present: true, invalid: true, records: [] };
    const rows: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(rows) || rows.length > 1024 || rows.some(row => !row ||
        row.version !== "publication-image-regeneration-hold/v1" || !validHash(row.sha256) || !validHash(row.context) ||
        !validHash(row.sourceSnapshotId) || !validHash(row.policyFingerprint) ||
        (row.sectionId !== null && typeof row.sectionId !== "string") || typeof row.slotId !== "string" || !row.slotId ||
        !["unresolved-identity", "uncorroborated-identifier"].includes(row.kind) || !Number.isFinite(Date.parse(row.heldAt))))
      return { present: true, invalid: true, records: [] };
    return { present: true, invalid: false, records: rows as RegenerationHold[] };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { present: false, invalid: false, records: [] }
      : { present: true, invalid: true, records: [] };
  }
}
function currentManifest(id: string) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(location(id)), "manifest.json"), "utf8"));
    return manifest?.brandLinkId === id && manifest.version === "brand-post-package/v2" && manifest.composition ? manifest : null;
  } catch { return null; }
}
function currentAssetBytesMatch(id: string, asset: { path?: string; sha256?: string }): boolean {
  if (typeof asset.path !== "string" || !validHash(asset.sha256)) return false;
  const resolved = path.resolve(asset.path), relative = path.relative(path.dirname(location(id)), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  try {
    const stat = fs.lstatSync(resolved);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 24 * 1024 * 1024 &&
      path.resolve(fs.realpathSync(resolved)).toLowerCase() === resolved.toLowerCase() &&
      crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex") === asset.sha256;
  } catch { return false; }
}
function heldHashes(id: string, composition: Composition, sectionId: string | null): string[] {
  const held = readHolds(id), context = publicationImageContext(composition, sectionId);
  if (!held.invalid) return held.records.filter(row => row.sectionId === sectionId && row.context === context).map(row => row.sha256);
  // A damaged deny record cannot make existing photos count as verified. Do
  // not invent an adverse verdict: expose only actual current image hashes as
  // blocked, while the regeneration check below conservatively holds all work.
  return composition.renderNodes.flatMap(node => {
    if (node.kind !== "image" || node.sectionId !== sectionId) return [];
    try { return [crypto.createHash("sha256").update(fs.readFileSync(node.assetPath)).digest("hex")]; }
    catch { return []; }
  });
}
export function rejectedPublicationImageHashes(id: string, composition: Composition, sectionId: string | null): string[] {
  const context = publicationImageContext(composition, sectionId);
  return [...new Set([...read(id).filter(row => row.scope === "product" ||
    (row.sectionId === sectionId && row.context === context)).map(row => row.sha256), ...heldHashes(id, composition, sectionId)])];
}
/** Deny-only. False is never permission to generate or replace a photo.
 * A policy/source/slot change cannot upgrade the same held pixels and words
 * into generation authority; only a fresh exact current positive can clear it.
 * A different SHA/section/body has no inferred approval or denial from this row.
 */
export function publicationImageRegenerationHoldState(id: string, composition: Composition, sectionId: string | null,
  sha256: string): "none" | "held" | "invalid" {
  const held = readHolds(id);
  if (held.invalid) return "invalid";
  if (!held.present) return "none";
  const context = publicationImageContext(composition, sectionId);
  // Recording and clearing verify the full slot/source binding. Caller-side
  // field changes cannot clear an existing marker for the same pixels/words.
  // In particular a policy upgrade still requires an actual fresh review.
  return held.records.some(row => row.sha256 === sha256 && row.sectionId === sectionId && row.context === context) ? "held" : "none";
}
/** Compatibility boolean remains deny-only; no proof or authorization is read
 * here. A caller may distinguish a valid hold from corrupt records, but only
 * its separate exact current signed proof can authorize any bounded successor. */
export function hasCurrentPublicationImageRegenerationHold(id: string, composition: Composition, sectionId: string | null,
  sha256: string, options: { slotId: string; sourceSnapshotId: string; policyFingerprint: string }): boolean {
  void options;
  return publicationImageRegenerationHoldState(id, composition, sectionId, sha256) !== "none";
}
/** Persist uncertainty without creating a semantic rejection, retry entitlement
 * or provider request. Malformed existing holds remain untouched and blocking. */
export function recordPublicationImageRegenerationHolds(id: string, composition: Composition,
  holds: PublicationImageRegenerationHoldInput[]): void {
  if (!holds.length) return;
  const manifest = currentManifest(id);
  if (!manifest) return; // Unsaved audit still fails; there is no package to mutate.
  const state = readHolds(id);
  if (state.invalid) throw holdError();
  const records = state.records;
  for (const item of holds) {
    const context = publicationImageContext(composition, item.sectionId);
    const assets = (manifest.imageAssets || []).filter((asset: { sha256?: string; sectionId?: string | null; slotId?: string }) =>
      asset.sha256 === item.sha256 && (asset.sectionId ?? null) === item.sectionId && asset.slotId === item.slotId);
    if (!validHash(item.sha256) || !validHash(item.sourceSnapshotId) || !validHash(item.policyFingerprint) ||
        typeof item.slotId !== "string" || !item.slotId || (item.sectionId !== null && typeof item.sectionId !== "string") ||
        !["unresolved-identity", "uncorroborated-identifier"].includes(item.kind) || assets.length !== 1 ||
        !currentAssetBytesMatch(id, assets[0]) ||
        context !== publicationImageContext(manifest.composition, item.sectionId) || manifest.sourceSnapshot?.snapshotId !== item.sourceSnapshotId ||
        !manifest.composition.renderNodes.some((node: { kind: string; sectionId?: string | null; assetPath?: string }) =>
          node.kind === "image" && node.sectionId === item.sectionId && node.assetPath === assets[0].path)) throw holdError();
    const duplicate = records.some(row => row.sha256 === item.sha256 && row.sectionId === item.sectionId && row.context === context &&
      row.slotId === item.slotId && row.sourceSnapshotId === item.sourceSnapshotId && row.policyFingerprint === item.policyFingerprint && row.kind === item.kind);
    if (!duplicate) records.push({ ...item, version: "publication-image-regeneration-hold/v1", context, heldAt: new Date().toISOString() });
  }
  if (records.length > 1024) throw holdError(); // Never evict a deny marker to make room.
  atomicWriteTextFile(holdLocation(id), JSON.stringify(records, null, 2));
  invalidateSuccessfulImageAuditReceipt(id);
}
function clearReviewedRegenerationHolds(id: string, composition: Composition, accepted: Array<{ sha256: string; sectionId: string | null }>): void {
  const state = readHolds(id);
  if (!state.present) return;
  if (state.invalid) throw holdError(); // Preserve corrupt evidence; it is not a clearable exact verdict.
  const manifest = currentManifest(id);
  if (!manifest) return;
  const remaining = state.records.filter(row => !accepted.some(item => item.sha256 === row.sha256 && item.sectionId === row.sectionId &&
    publicationImageContext(composition, item.sectionId) === row.context &&
    publicationImageContext(manifest.composition, item.sectionId) === row.context && manifest.sourceSnapshot?.snapshotId === row.sourceSnapshotId &&
    manifest.imageAssets?.some((asset: { sha256?: string; sectionId?: string | null; slotId?: string; path?: string }) =>
      asset.sha256 === row.sha256 && (asset.sectionId ?? null) === row.sectionId && asset.slotId === row.slotId &&
      currentAssetBytesMatch(id, asset) &&
      manifest.composition.renderNodes.some((node: { kind: string; sectionId?: string | null; assetPath?: string }) =>
        node.kind === "image" && node.sectionId === row.sectionId && node.assetPath === asset.path))));
  if (remaining.length !== state.records.length) atomicWriteTextFile(holdLocation(id), JSON.stringify(remaining, null, 2));
}
/** Only a real persisted section-scoped semantic rejection of these exact
 * current pixels and published words can authorize original-slot repair. */
export function hasCurrentSectionImageRejection(id: string, composition: Composition, sectionId: string, sha256: string): boolean {
  const context = publicationImageContext(composition, sectionId);
  return read(id).some(row => row.sha256 === sha256 && row.sectionId === sectionId &&
    (row.scope === undefined || row.scope === "section") && row.context === context);
}
/** A fresh complete pixel verdict can resolve a previous false positive, but
 * only for those exact bytes and unchanged publication context. */
export function clearReviewedPublicationImageRejections(id: string, composition: Composition,
  accepted: Array<{ sha256: string; sectionId: string | null }>): void {
  if (!accepted.length) return;
  clearReviewedRegenerationHolds(id, composition, accepted);
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

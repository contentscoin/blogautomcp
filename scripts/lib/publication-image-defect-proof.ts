import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "./app-paths";
import { publicationImageContext } from "./publish-image-rejections";
import { referencePlaneComparisonIssue, type ReferencePlaneContext } from "./reference-plane-grounding";
import type { BrandPostPackageManifestV2 } from "../../src/lib/brand-post-package";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
const valid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const directory = () => path.join(getAppDataDir(), "publication-image-defect-proofs");
function secret(create: boolean): Buffer | null {
  const file = path.join(directory(), ".signing-key");
  try { const bytes = fs.readFileSync(file); return bytes.length === 32 ? bytes : null; }
  catch (error) { if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") return null; }
  fs.mkdirSync(directory(), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, crypto.randomBytes(32), { flag: "wx", mode: 0o600 });
    try { fs.linkSync(temporary, file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { fs.rmSync(temporary, { force: true }); }
  return secret(false);
}
export function publicationDefectMaterialBinding(manifest: BrandPostPackageManifestV2): string {
  return hash(JSON.stringify({ id: manifest.brandLinkId, createdAt: manifest.createdAt, title: manifest.title,
    hashtags: manifest.hashtags, sourceSnapshot: manifest.sourceSnapshot, composition: manifest.composition,
    assets: manifest.imageAssets, hero: manifest.heroImagePath, body: manifest.bodyImagePaths }));
}
function currentBinding(manifest: BrandPostPackageManifestV2, sectionId: string, sha256: string) {
  const matches = (manifest.imageAssets || []).filter(asset => asset.sha256 === sha256 && asset.sectionId === sectionId &&
    asset.provenance === "GENERATED_SCENE" && asset.creationMethod === "reference-guided-scene" && asset.remoteGenerated === true);
  if (matches.length !== 1) return null;
  const asset = matches[0], section = manifest.composition.sections.find(row => row.id === sectionId);
  if (!asset.slotId || !asset.sourcePath || !section?.imagePaths.includes(asset.path) || fileHash(asset.path) !== sha256 || fileHash(asset.sourcePath) !== sha256 ||
      !asset.referenceScene || asset.referenceScene.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId) return null;
  const stem = asset.sourcePath.replace(/\.(?:png|jpe?g|webp)$/iu, ""), metadataPath = `${stem}.reference-scene.json`;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (metadata.slotId !== asset.slotId || metadata.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId || !Array.isArray(metadata.referenceHashes)) return null;
  return { material: publicationDefectMaterialBinding(manifest), context: publicationImageContext(manifest.composition, sectionId),
    sectionId, slotId: asset.slotId, sha256, outStem: stem, metadataSha256: fileHash(metadataPath),
    referenceHashes: metadata.referenceHashes as string[], assetSha256: hash(JSON.stringify(asset)) };
}
export interface PublicationImageDefectProof {
  version: "publication-image-conflicting-print/v1";
  binding: NonNullable<ReturnType<typeof currentBinding>>;
  policyFingerprint: string;
  requestBindingSha256: string;
  comparison: Record<string, unknown>;
  at: string;
  signature: string;
}
function proofFile(binding: NonNullable<ReturnType<typeof currentBinding>>, policy: string) {
  return path.join(directory(), `${hash(JSON.stringify({ binding, policy }))}.json`);
}
function locator(id: string, sectionId: string, sha256: string) {
  const row = { version: "publication-image-defect-seen/v1", id, sectionId, sha256 };
  return { file: path.join(directory(), `seen-${hash(JSON.stringify({ id, sectionId, sha256 }))}.json`), bytes: JSON.stringify(row) };
}
/** Block-only memory: malformed/stale native proof must never fall through to
 * the older generic explicit-replace path. A locator is NEVER generation authority. */
export function publicationImageDefectWasRecorded(id: string, sectionId: string, sha256: string): boolean {
  const expected = locator(id, sectionId, sha256);
  try {
    if (fs.readFileSync(expected.file, "utf8") !== expected.bytes) throw new Error("invalid locator");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("IMAGE_RESUME_REQUIRED: 이전 최종 사진 거절 기록을 확인하지 못해 추가 생성하지 않았습니다.");
  }
}
/** Called only after the native audit has validated the actual structured row
 * and all final pixel/context snapshots. It changes no review decision. */
export function recordPublicationImageDefect(options: { manifest: BrandPostPackageManifestV2; sectionId: string; sha256: string;
  policyFingerprint: string; requestBindingSha256: string; verdict: Record<string, unknown>; context: ReferencePlaneContext }): void {
  const { verdict } = options, comparison = verdict.referenceComparison as Record<string, unknown> | undefined;
  if (verdict.accepted !== false || verdict.identityMatches !== false || comparison?.objectionKind !== "conflicting-print" ||
      referencePlaneComparisonIssue(verdict, options.context) || !valid(options.policyFingerprint) || !valid(options.requestBindingSha256)) return;
  let binding: ReturnType<typeof currentBinding>;
  try { binding = currentBinding(options.manifest, options.sectionId, options.sha256); } catch { return; }
  if (!binding || comparison.primaryReferenceSha256 !== (options.manifest.imageAssets || []).find(asset => asset.sha256 === options.sha256)?.referenceScene?.referenceSha256) return;
  const key = secret(true); if (!key) throw new Error("PUBLICATION_DEFECT_PROOF_KEY_INVALID");
  const seen = locator(options.manifest.brandLinkId, options.sectionId, options.sha256);
  try { fs.writeFileSync(seen.file, seen.bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!publicationImageDefectWasRecorded(options.manifest.brandLinkId, options.sectionId, options.sha256))
    throw new Error("PUBLICATION_DEFECT_PROOF_LOCATOR_INVALID");
  const file = proofFile(binding, options.policyFingerprint);
  if (fs.existsSync(file)) return; // Immutable first observed verdict for these exact inputs.
  const payload = { version: "publication-image-conflicting-print/v1" as const, binding, policyFingerprint: options.policyFingerprint,
    requestBindingSha256: options.requestBindingSha256, comparison, at: new Date().toISOString() };
  const bytes = JSON.stringify({ ...payload, signature: crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex") });
  try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
export function readPublicationImageDefect(manifest: BrandPostPackageManifestV2, sectionId: string, sha256: string, policy: string):
  { proof: PublicationImageDefectProof; path: string; sha256: string } | null {
  try {
    const binding = currentBinding(manifest, sectionId, sha256), key = secret(false);
    if (!binding || !key) return null;
    const file = proofFile(binding, policy); if (fs.statSync(file).size > 24 * 1024) return null;
    const bytes = fs.readFileSync(file), row = JSON.parse(bytes.toString("utf8")) as PublicationImageDefectProof;
    const { signature, ...payload } = row;
    if (row.version !== "publication-image-conflicting-print/v1" || row.policyFingerprint !== policy || !valid(row.requestBindingSha256) ||
        !valid(signature) || JSON.stringify(row.binding) !== JSON.stringify(binding) || row.comparison?.objectionKind !== "conflicting-print" ||
        !crypto.timingSafeEqual(Buffer.from(signature, "hex"), crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest())) return null;
    return { proof: row, path: file, sha256: hash(bytes) };
  } catch { return null; }
}
export function readPublicationImageRepairPlan(parentSha256: string): { outStem: string; contextSha256: string } | null {
  try {
    const key = secret(false); if (!key || !valid(parentSha256)) return null;
    const row = JSON.parse(fs.readFileSync(path.join(directory(), `plan-${parentSha256}.json`), "utf8"));
    const { signature, ...payload } = row;
    if (payload.version !== "publication-image-repair-plan/v1" || payload.parentSha256 !== parentSha256 || typeof payload.outStem !== "string" ||
        !valid(payload.contextSha256) || !valid(signature) || !crypto.timingSafeEqual(Buffer.from(signature, "hex"),
          crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest())) return null;
    return { outStem: payload.outStem, contextSha256: payload.contextSha256 };
  } catch { return null; }
}
/** First frozen improved plan consumes this parent. A changed plan cannot mint
 * another request even if only metadata (and no transport journal) survived. */
export function sealPublicationImageRepairPlan(parentSha256: string, outStem: string, contextSha256: string): void {
  if (!valid(parentSha256) || !valid(contextSha256)) throw new Error("IMAGE_RESUME_REQUIRED: Invalid repair plan binding");
  const file = path.join(directory(), `plan-${parentSha256}.json`), key = secret(false);
  if (!key) throw new Error("IMAGE_RESUME_REQUIRED: Missing native repair authority");
  const payload = { version: "publication-image-repair-plan/v1", parentSha256, outStem, contextSha256 };
  const bytes = JSON.stringify({ ...payload, signature: crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex") });
  try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const saved = readPublicationImageRepairPlan(parentSha256);
  if (!saved || saved.outStem !== outStem || saved.contextSha256 !== contextSha256)
    throw new Error("IMAGE_RESUME_REQUIRED: 이전 최종 거절의 단일 개선 계획이 다릅니다. 추가 생성하지 않았습니다.");
}

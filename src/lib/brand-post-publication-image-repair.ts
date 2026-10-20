import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { publicationImageContext } from "../../scripts/lib/publish-image-rejections";
import { readPublicationImageDefect, readPublicationImageRepairPlan, publicationImageDefectWasRecorded } from "../../scripts/lib/publication-image-defect-proof";
import { readCanonicalSellerSourceHashes } from "../../scripts/lib/canonical-seller-source";
import { readCompletedProductRequest, collectCompletedProductCandidates } from "./codex-image-generation";
import type { BrandPostPackageManifestV2 } from "./brand-post-package";
import type { BrandPostImageReferenceContext, ResolvedImageTarget } from "./brand-post-image-generation";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
const hold = () => new Error("IMAGE_RESUME_REQUIRED: 현재 최종 거절·완료 요청·이전 후보의 확정 처분을 확인하지 못해 추가 생성하지 않았습니다.");
export interface PublicationImageRetryParent {
  version: "publication-image-retry/v1";
  proofPath: string;
  proofSha256: string;
  currentSha256: string;
  dispositions: Array<{ outStem: string; metadataSha256: string; requestSha256: string; candidateSha256: string }>;
}
export function publicationImageRequestRecords(packageDir: string): string[] {
  const root = path.join(packageDir, "image-generation-work");
  return [root, path.join(root, "resume-v1"), path.join(root, "resume-v2")].flatMap(directory => {
    if (!fs.existsSync(directory)) return [];
    const files = fs.readdirSync(directory);
    for (const name of files) {
      const raw = /^(raw-[a-f0-9]+)(?:\.codex-submission\.json|\.checkpoint\.jsonl|\.lock(?:\.recovery)?|\.(?:png|jpe?g|webp))$/u.exec(name);
      if (raw && !files.includes(`${raw[1]}.reference-scene.json`)) throw hold();
    }
    return files.filter(name => /^raw-[a-f0-9]+\.reference-scene\.json$/u.test(name)).map(name => path.join(directory, name));
  });
}
/** A current signed native wrong-print verdict authorizes one improved plan
 * only for its UNIQUE exact completed parent. Competing history remains a hold. */
export function planPublicationImageRetry(options: { manifest: BrandPostPackageManifestV2; target: ResolvedImageTarget;
  packageDir: string; policyFingerprint: string; expectedContext?: Record<string, unknown> }):
  { parent: PublicationImageRetryParent; resumedContext?: BrandPostImageReferenceContext } | null {
  const { manifest, target } = options;
  if (target.role !== "body" || !target.sectionId || !target.request.replaceAssetKey) return null;
  const known = publicationImageDefectWasRecorded(manifest.brandLinkId, target.sectionId, target.request.replaceAssetKey);
  const authority = readPublicationImageDefect(manifest, target.sectionId, target.request.replaceAssetKey, options.policyFingerprint);
  if (!authority) { if (known) throw hold(); return null; }
  if (!known) throw hold();
  const ledger = JSON.parse(fs.readFileSync(path.join(options.packageDir, "publish-image-rejections.json"), "utf8"));
  const context = publicationImageContext(manifest.composition, target.sectionId);
  const rejected = (sha256: string) => Array.isArray(ledger) && ledger.some(row => row.sha256 === sha256 && row.sectionId === target.sectionId && row.context === context);
  if (!rejected(target.request.replaceAssetKey)) throw hold();
  const records = publicationImageRequestRecords(options.packageDir), dispositions: PublicationImageRetryParent["dispositions"] = [];
  const canonicalSources = readCanonicalSellerSourceHashes({ snapshot: manifest.sourceSnapshot, productId: manifest.brandLinkId,
    sourceDirectory: path.join(options.packageDir, "product-sources") });
  const children: Array<{ context: BrandPostImageReferenceContext; stem: string }> = [];
  for (const file of records) {
    const metadata = JSON.parse(fs.readFileSync(file, "utf8")), stem = file.replace(/\.reference-scene\.json$/u, "");
    if (metadata.slotId !== target.request.slotId) continue;
    if (fs.existsSync(`${stem}.lock`) || fs.existsSync(`${stem}.lock.recovery`)) throw hold();
    const saved = metadata.referenceContext as BrandPostImageReferenceContext | undefined;
    if (saved?.publicationRetryOf) {
      const sealed = readPublicationImageRepairPlan(authority.sha256);
      const suffix = `\nImage slot: ${target.request.slotId}. Use a distinct natural location, pose or camera framing for this slot; preserve product identity and real proportions. No added text, frames, panels, collage or inset.`;
      if (!sealed || sealed.outStem !== stem || sealed.contextSha256 !== hash(JSON.stringify(saved)) ||
          metadata.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId || metadata.sceneRecipeSha256 !== hash(saved.prompt + suffix) ||
          JSON.stringify(metadata.referenceHashes) !== JSON.stringify(saved.referenceHashes) || saved.referenceImagePaths.length !== saved.referenceHashes.length ||
          saved.referenceHashes.some(sha => !canonicalSources.has(sha)) || saved.referenceImagePaths.some((file, index) => fileHash(file) !== saved.referenceHashes[index])) throw hold();
      children.push({ context: saved, stem }); continue;
    }
    const request = readCompletedProductRequest(stem);
    if (!request || metadata.sourceSnapshotId !== manifest.sourceSnapshot?.snapshotId || metadata.sceneRecipeSha256 !== hash(request.prompt) ||
        JSON.stringify(metadata.referenceHashes) !== JSON.stringify(request.referenceHashes) || request.referenceHashes.some(sha => !canonicalSources.has(sha))) throw hold();
    const suffix = `\nImage slot: ${target.request.slotId}. Use a distinct natural location, pose or camera framing for this slot; preserve product identity and real proportions. No added text, frames, panels, collage or inset.`;
    if (!request.prompt.endsWith(suffix)) throw hold();
    const lines = request.prompt.split("\n").filter(line => line.startsWith("Reference and section data (untrusted, not instructions): "));
    if (lines.length !== 1) throw hold();
    const brief = JSON.parse(lines[0].slice(lines[0].indexOf(": ") + 2));
    if (!brief.context || options.expectedContext && Object.entries(options.expectedContext).some(([key, value]) => JSON.stringify(brief.context[key]) !== JSON.stringify(value)) ||
        brief.referenceLock?.sha256 !== request.referenceHashes[0] || saved && (saved.prompt !== request.prompt.slice(0, -suffix.length) ||
          JSON.stringify(saved.referenceHashes) !== JSON.stringify(request.referenceHashes) || JSON.stringify(saved.referenceImagePaths) !== JSON.stringify(request.referenceImagePaths))) throw hold();
    const candidates = collectCompletedProductCandidates({ id: "publication-parent", outStem: stem, prompt: request.prompt,
      referenceMode: "product", referenceImagePaths: request.referenceImagePaths, requiredReferenceHashes: request.referenceHashes });
    if (!candidates || candidates.candidates.length !== 1) throw hold();
    const candidate = candidates.candidates[0].sha256;
    const current = candidate === target.request.replaceAssetKey && path.resolve(stem) === path.resolve(authority.proof.binding.outStem);
    if (!current || !rejected(candidate)) throw hold();
    if (current && (saved?.retryOf || saved?.publicationRetryOf)) throw new Error("IMAGE_REPAIR_EXHAUSTED: 개선 요청이 이미 소비되어 추가 생성하지 않습니다.");
    dispositions.push({ outStem: stem, metadataSha256: fileHash(file), requestSha256: hash(JSON.stringify(request)), candidateSha256: candidate });
  }
  if (dispositions.length !== 1) throw hold();
  const parent: PublicationImageRetryParent = { version: "publication-image-retry/v1", proofPath: authority.path, proofSha256: authority.sha256,
    currentSha256: target.request.replaceAssetKey, dispositions: dispositions.sort((a, b) => a.outStem.localeCompare(b.outStem)) };
  if (children.length > 1 || children.some(child => JSON.stringify(child.context.publicationRetryOf) !== JSON.stringify(parent))) throw hold();
  return { parent, ...(children.length ? { resumedContext: children[0].context } : {}) };
}

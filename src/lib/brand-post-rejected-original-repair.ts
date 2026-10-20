import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readCanonicalSellerSourceHashes } from "../../scripts/lib/canonical-seller-source";
import { hasCurrentSectionImageRejection } from "../../scripts/lib/publish-image-rejections";
import { getBrandPostImageSlots, getBrandPostPackageDir, normalizePackageImageAssets, type BrandPostPackageManifestV2 } from "./brand-post-package";
import { planSectionImageRequests } from "./brand-post-image-repair";
import { readOriginalPhotoClaimDefect } from "../../scripts/lib/publication-image-defect-proof";
import { publicationImageAuditPolicyFingerprint } from "../../scripts/lib/publish-image-audit";

/** Narrow existing seller-original replacement, never generation or approval.
 * The old file, original rejection and historical jobs remain intact. */
export function planRejectedOriginalRepair(manifest: BrandPostPackageManifestV2, sectionId: unknown,
  dependencies: { readClaimDefect?: typeof readOriginalPhotoClaimDefect } = {}) {
  const invalid = (): never => { throw new Error("REJECTED_ORIGINAL_REPAIR_INVALID: 현재 본문·원본 사진에 연결된 섹션 거절 근거가 없습니다."); };
  if (manifest.connectKind !== "SHOPPING" || typeof sectionId !== "string" || !sectionId ||
      !manifest.sourceSnapshot || manifest.imageGeneration?.status === "running" || manifest.imageGeneration?.recoveryState === "owner-unknown") return invalid();
  const section = manifest.composition.sections.find(item => item.id === sectionId);
  if (!section || section.imageSource !== "seller-original" || section.imagePaths.length !== 1) return invalid();
  const root = path.resolve(getBrandPostPackageDir(manifest.brandLinkId)), file = path.resolve(section.imagePaths[0]);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return invalid();
  const images = manifest.composition.renderNodes.filter(node => node.kind === "image" && path.resolve(node.assetPath) === file);
  if (images.length !== 1 || images[0].kind !== "image" || images[0].sectionId !== sectionId ||
      manifest.composition.sections.some(other => other.id !== sectionId && other.imagePaths.some(otherFile => path.resolve(otherFile) === file))) return invalid();
  const actualBody = manifest.composition.renderNodes.filter(node => node.kind === "paragraph" && node.sectionId === sectionId)
    .flatMap(node => node.kind === "paragraph" ? [node.text] : []).join("\n");
  const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();
  if (normalized(actualBody) !== normalized(section.body.join("\n"))) return invalid();
  const assets = normalizePackageImageAssets(manifest).filter(asset => path.resolve(asset.path) === file && asset.sectionId === sectionId);
  if (assets.length !== 1) return invalid();
  const asset = assets[0];
  if (asset.role !== "body" || asset.provenance !== "ORIGINAL" || asset.creationMethod !== "source" ||
      asset.remoteGenerated !== false && asset.remoteGenerated !== undefined || asset.referenceScene) return invalid();
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 24 * 1024 * 1024 ||
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== asset.sha256) return invalid();
  } catch { return invalid(); }
  if (!hasCurrentSectionImageRejection(manifest.brandLinkId, manifest.composition, sectionId, asset.sha256)) return invalid();
  if (!(dependencies.readClaimDefect || readOriginalPhotoClaimDefect)(manifest, sectionId, asset.sha256, publicationImageAuditPolicyFingerprint())) return invalid();
  const canonical = readCanonicalSellerSourceHashes({ snapshot: manifest.sourceSnapshot, productId: manifest.brandLinkId,
    sourceDirectory: path.join(root, "product-sources") });
  if (!canonical.has(asset.sha256)) return invalid();
  const slots = getBrandPostImageSlots(manifest).filter(slot => slot.sectionId === sectionId).map(slot => ({ ...slot,
    staleTargets: slot.staleTargets.filter(target => target.code === "image-publication-rejected" && target.assetKey === asset.sha256) }));
  const requests = planSectionImageRequests(slots);
  if (requests.length !== 1 || requests[0].sectionId !== sectionId || requests[0].replaceAssetKey !== asset.sha256) return invalid();
  return requests;
}

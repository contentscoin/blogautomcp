import { randomUUID } from "node:crypto";
import path from "node:path";
import { allowsGenericBrandPostProductPhoto, isShoppingLifestyleImage } from "./brand-post-image-evidence";
import { acquireBrandPostImageRepairLock } from "./brand-post-image-repair-lock";
import { repairBrandPostImages } from "./brand-post-image-repair";
import { getBrandPostImageSlots, readBrandPostPackage, reconcileBrandPostPackageQuality,
  writeBrandPostPackageManifest, type BrandPostPackageManifestV2 } from "./brand-post-package";

type Manifest = BrandPostPackageManifestV2;
type Slots = ReturnType<typeof getBrandPostImageSlots>;
export interface ImageReplanDependencies {
  read: typeof readBrandPostPackage;
  write: typeof writeBrandPostPackageManifest;
  slots: typeof getBrandPostImageSlots;
  repair: typeof repairBrandPostImages;
  lock: typeof acquireBrandPostImageRepairLock;
  reconcile: typeof reconcileBrandPostPackageQuality;
}
const defaults: ImageReplanDependencies = { read: readBrandPostPackage, write: writeBrandPostPackageManifest,
  slots: getBrandPostImageSlots, repair: repairBrandPostImages, lock: acquireBrandPostImageRepairLock,
  reconcile: reconcileBrandPostPackageQuality };
const summary = (slots: Slots) => ({ required: slots.reduce((n, s) => n + s.minimum, 0),
  missing: slots.reduce((n, s) => n + s.missing + s.generationMissing, 0) });
const verifiedAlternative = (slot: Slots[number]) => slot.count > 0 && !slot.missing && !slot.generationMissing &&
  !slot.staleTargets.length && slot.assets.some(asset => asset.creationMethod === "source" &&
    asset.sourceReview?.usage === "section-matched-product-evidence" &&
    ["feature-evidence", "scene-evidence"].includes(asset.sourceReview.reviewClass || ""));

/** Images may be added during review, but a changed draft invalidates the plan. */
export function imageReplanDraftIdentity(manifest: Manifest): string {
  return JSON.stringify({ createdAt: manifest.createdAt, title: manifest.title, markdownSha256: manifest.markdownSha256,
    markdownPath: manifest.markdownPath, connectKind: manifest.connectKind, imagePolicy: manifest.imagePolicy,
    sourceSnapshot: manifest.sourceSnapshot, hashtags: manifest.hashtags, imageRequirements: manifest.imageRequirements,
    postSpec: manifest.postSpec, specDraft: manifest.specDraft,
    textNodes: manifest.composition.renderNodes.filter(node => node.kind !== "image"),
    sections: manifest.composition.sections.map(({ imagePaths: _paths, ...section }) => section) });
}

/** Move visual coverage only after normal source review proves an alternative section.
 * Textual claims and their image intents stay unchanged; a runtime image is never
 * relabelled as proof of a missing performance illustration.
 */
export async function replanShoppingImageCoverage(options: {
  brandLinkId: string; productName?: string; sourceImageUrls?: string[];
}, deps: ImageReplanDependencies = defaults) {
  const initial = deps.read(options.brandLinkId, { migrate: false });
  const empty = { required: 0, missing: 0 };
  const before = initial ? summary(deps.slots(initial)) : empty;
  const unchanged = (reason: string) => ({ changed: false, before, after: before, reason, history: [] as Array<{ from: string; to: string; at: string }> });
  if (!initial || initial.version !== "brand-post-package/v2" || initial.connectKind !== "SHOPPING" ||
      initial.imagePolicy !== "LOCKED_PRODUCT_OR_ORIGINAL" || initial.imageRequirements?.policy === "generated-required")
    return unchanged("REPLAN_NOT_APPLICABLE");
  if (initial.imageGeneration?.status === "running") return unchanged("REPLAN_BUSY");
  const slots = deps.slots(initial);
  const missing = slots.filter(slot => {
    const section = initial.composition.sections.find(s => s.id === slot.sectionId)!;
    return slot.missing > 0 && slot.minimum > slot.count && slot.generatedMinimum === 0 &&
      slot.staleTargets.every(target => ["image-geometry-invalid", "image-publication-rejected"].includes(target.code)) &&
      !isShoppingLifestyleImage(section) && !allowsGenericBrandPostProductPhoto({ sectionTitle: section.title, imageIntent: section.imageIntent });
  });
  const needed = missing.reduce((n, slot) => n + slot.minimum - slot.count, 0);
  const candidates = slots.filter(slot => slot.minimum === 0 && slot.maximum > 0 && !slot.staleTargets.length &&
    (verifiedAlternative(slot) || (slot.count === 0 && !initial.composition.sections.find(s => s.id === slot.sectionId)!.imagePaths.length)));
  if (!needed || candidates.length < needed) return unchanged("REPLAN_NO_ALTERNATIVE_CAPACITY");
  const identity = imageReplanDraftIdentity(initial);
  // Normal repair owns the lock while it reviews and applies seller originals.
  // The number of attempts is bounded by the number of empty optional sections.
  if (candidates.filter(verifiedAlternative).length < needed) {
    const repair = await deps.repair({ ...options, sourceOnly: true, requests: candidates.filter(slot => slot.count === 0).map(slot => ({
      requestId: randomUUID(), sectionId: slot.sectionId, slotId: `${slot.sectionId}:image:1`,
    })) });
    // Only a known lack of source evidence permits trying a different section.
    // Infrastructure and unclassified failures must retain their original cause,
    // even when other optional requests already produced usable photographs.
    const recoverable = new Set(["IMAGE_SOURCE_BINDING_REQUIRED", "PRODUCT_SOURCE_REQUIRED",
      "PRODUCT_SOURCE_DOWNLOAD_FAILED", "PRODUCT_CUTOUT_REQUIRED", "IMAGE_GENERATION_REQUIRED"]);
    const stop = repair.errors.find(error => {
      const codes = error.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/gu) || [];
      return !codes.length || codes.some(code => !recoverable.has(code));
    });
    if (stop) {
      const code = (stop.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || [])
        .find(value => !["IMAGE_SOURCE_BINDING_REQUIRED", "PRODUCT_SOURCE_REQUIRED", "PRODUCT_SOURCE_DOWNLOAD_FAILED", "PRODUCT_CUTOUT_REQUIRED", "IMAGE_GENERATION_REQUIRED"].includes(value));
      throw Object.assign(new Error(`IMAGE_REPLAN_EXTERNAL_BLOCKED: ${stop}`), { code: code || "IMAGE_REPLAN_EXTERNAL_BLOCKED" });
    }
  }
  const lock = deps.lock(options.brandLinkId, { purpose: "shopping-image-coverage-replan" });
  try {
    lock.assertOwner();
    const current = deps.read(options.brandLinkId, { migrate: false });
    if (!current || current.version !== "brand-post-package/v2" || imageReplanDraftIdentity(current) !== identity)
      return unchanged("REPLAN_DRAFT_CHANGED");
    if (current.imageGeneration?.status === "running") return unchanged("REPLAN_BUSY");
    const audited = deps.slots(current);
    const alternatives = candidates.map(c => audited.find(s => s.sectionId === c.sectionId)!).filter(verifiedAlternative);
    if (alternatives.length < needed) return { ...unchanged("REPLAN_INSUFFICIENT_VERIFIED_ALTERNATIVES"), after: summary(audited) };
    const minima = new Map<string, number>();
    const history: Array<{ from: string; to: string; at: string }> = [];
    for (const slot of missing) {
      const now = audited.find(s => s.sectionId === slot.sectionId)!;
      // A concurrent legitimate recovery must not be undone or double-counted.
      if (now.count !== slot.count || now.minimum !== slot.minimum) return unchanged("REPLAN_COVERAGE_CHANGED");
      minima.set(slot.sectionId, slot.count);
      for (let n = slot.count; n < slot.minimum; n++) {
        const alternative = alternatives.shift()!;
        minima.set(alternative.sectionId, 1);
        history.push({ from: slot.sectionId, to: alternative.sectionId, at: new Date().toISOString() });
      }
    }
    // Remove rejected geometry only after equivalent verified coverage exists.
    // Never crop its pixels, silently drop an unfilled requirement, or touch text.
    const rejected = new Set(missing.flatMap(slot => slot.staleTargets.map(target => path.resolve(target.path))));
    const proposed = deps.reconcile({ ...current, approvedAt: null,
      bodyImagePaths: current.bodyImagePaths?.filter(file => !rejected.has(path.resolve(file))),
      imageAssets: current.imageAssets?.filter(asset => !rejected.has(path.resolve(asset.path))),
      composition: { ...current.composition,
        renderNodes: current.composition.renderNodes.filter(node => node.kind !== "image" || !rejected.has(path.resolve(node.assetPath))),
        sections: current.composition.sections.map(section =>
        minima.has(section.id) ? { ...section, imageMin: minima.get(section.id)!,
          imagePaths: section.imagePaths.filter(file => !rejected.has(path.resolve(file))) } : section) },
      pipelineNotes: [...(current.pipelineNotes || []), `IMAGE_COVERAGE_REPLANNED: ${JSON.stringify(history)}`,
        ...(current.imageGeneration?.errors.length ? [`IMAGE_REPLAN_PREVIOUS_ERRORS: ${JSON.stringify(current.imageGeneration.errors)}`] : [])] });
    const after = summary(deps.slots(proposed));
    if (after.required !== before.required || after.missing >= before.missing) return unchanged("REPLAN_INVARIANT_FAILED");
    if (proposed.imageGeneration) proposed.imageGeneration = { ...proposed.imageGeneration,
      remaining: after.missing, status: after.missing ? "incomplete" : "complete", updatedAt: new Date().toISOString(),
      errors: deps.slots(proposed).filter(slot => slot.missing || slot.generationMissing).map(slot =>
        `${slot.sectionId}: IMAGE_COVERAGE_REQUIRED: 검증 이미지 ${Math.max(slot.missing, slot.generationMissing)}장 필요`) };
    lock.assertOwner();
    deps.write(proposed);
    return { changed: true, before, after, reason: "VERIFIED_ALTERNATIVE_COVERAGE", history };
  } finally { lock.release(); }
}

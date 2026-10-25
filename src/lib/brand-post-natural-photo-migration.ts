import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { acquireBrandPostImageRepairLock } from "./brand-post-image-repair-lock";
import {
  getBrandPostImageGenerationState, getBrandPostPackageManifestPath, readBrandPostPackage,
  refreshStoredContentQuality, writeBrandPostPackageManifest,
  type BrandPostPackageManifest, type BrandPostPackageManifestV2,
} from "./brand-post-package";
import { applyShoppingNaturalPhotoPlan, refreshPostDocumentQuality } from "./post-composition-contract";
import { SHOPPING_POST_STRATEGY, SHOPPING_POST_STRATEGY_VERSION } from "./shopping-post-strategy";

export function requiresShoppingNaturalPhotoPlan(manifest: BrandPostPackageManifest | null): boolean {
  return manifest?.version === "brand-post-package/v2" && manifest.connectKind === "SHOPPING" &&
    manifest.composition.strategyVersion !== SHOPPING_POST_STRATEGY_VERSION;
}

/** Explicit full-image preparation only. Never call from a preview or a single-image apply action. */
export function migrateShoppingNaturalPhotoPlan(brandLinkId: string): {
  manifest: BrandPostPackageManifest | null;
  changed: boolean;
  backupPath?: string;
} {
  const initial = readBrandPostPackage(brandLinkId, { migrate: false });
  if (!requiresShoppingNaturalPhotoPlan(initial)) return { manifest: initial, changed: false };
  const lock = acquireBrandPostImageRepairLock(brandLinkId, { purpose: "natural-photo-plan-migration" });
  try {
    const manifest = readBrandPostPackage(brandLinkId, { migrate: false });
    if (!manifest || manifest.version !== "brand-post-package/v2" || !requiresShoppingNaturalPhotoPlan(manifest)) return { manifest, changed: false };
    if (getBrandPostImageGenerationState(manifest)?.status === "running") {
      throw new Error("IMAGE_REPAIR_BUSY: 진행 중인 이미지 준비가 끝난 후 자연스러운 사진 계획으로 변경하세요.");
    }
    const manifestPath = getBrandPostPackageManifestPath(brandLinkId);
    const originalBytes = fs.readFileSync(manifestPath);
    const digest = crypto.createHash("sha256").update(originalBytes).digest("hex");
    const backupPath = path.join(path.dirname(manifestPath), `manifest.before-natural-photo-v2-${digest.slice(0, 16)}.json`);
    // Back up this manifest only. Source photos and previous outputs stay at their existing paths.
    try { fs.writeFileSync(backupPath, originalBytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !fs.readFileSync(backupPath).equals(originalBytes)) throw error;
    }
    lock.assertOwner();
    const snapshotProductName = manifest.sourceSnapshot?.product.name;
    const sections = applyShoppingNaturalPhotoPlan(manifest.composition.sections.map(section => ({ ...section, imagePaths: [] })),
      { productName: typeof snapshotProductName === "string" && snapshotProductName.trim() ? snapshotProductName : manifest.title });
    const composition = refreshPostDocumentQuality({
      ...manifest.composition, strategyVersion: SHOPPING_POST_STRATEGY_VERSION,
      imageFloor: SHOPPING_POST_STRATEGY.images.min, sections,
      renderNodes: manifest.composition.renderNodes.filter(node => node.kind !== "image" ||
        (node.sectionId === null && path.resolve(node.assetPath) === path.resolve(manifest.heroImagePath))),
    });
    // Spec-first preparation must not resurrect the old image paths during a later text revision.
    const oldSpec = manifest.postSpec as { version?: string; sections?: Array<Record<string, unknown>>; imagePlan?: Record<string, unknown> } | undefined;
    const postSpec = oldSpec?.version === "post-spec/v1" && Array.isArray(oldSpec.sections) ? {
      ...oldSpec,
      sections: oldSpec.sections.map((section, index) => ({ ...section, imageSlotIds: [],
        ...(sections[index] ? { imageCount: [sections[index].imageMin, sections[index].imageMax], imageIntent: sections[index].imageIntent } : {}),
      })),
      imagePlan: { ...oldSpec.imagePlan, slots: [], resolvedBody: 0,
        minBody: SHOPPING_POST_STRATEGY.bodyPhotos.total, targetBody: SHOPPING_POST_STRATEGY.bodyPhotos.total,
        shortfall: SHOPPING_POST_STRATEGY.bodyPhotos.total, shrinkApplied: true },
    } : manifest.postSpec;
    const migrated: BrandPostPackageManifestV2 = {
      ...manifest, composition, postSpec, bodyImagePaths: [],
      imageAssets: manifest.imageAssets?.filter(asset => asset.role === "hero" && path.resolve(asset.path) === path.resolve(manifest.heroImagePath)),
      imageRequirements: { policy: "verified-source-first" },
      approvedAt: null, imageGeneration: undefined, textQualityRevalidation: undefined, specValidation: null,
      contentQuality: refreshStoredContentQuality(manifest.contentQuality, composition.qualityReport),
      pipelineNotes: [...(manifest.pipelineNotes || []), `자연스러운 본문 사진 계획으로 변경: 원본 1장 + AI 연출 3장. 이전 이미지 기록 보존: ${path.basename(backupPath)}`],
    };
    lock.assertOwner();
    if (!fs.readFileSync(manifestPath).equals(originalBytes)) throw new Error("IMAGE_CHANGED: 사진 계획 변경 중 원고가 바뀌었습니다.");
    writeBrandPostPackageManifest(migrated);
    lock.assertOwner();
    return { manifest: migrated, changed: true, backupPath };
  } finally { lock.release(); }
}

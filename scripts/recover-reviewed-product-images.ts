/** Recover completed image backgrounds; never generate, approve or publish. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  selectVerifiedProductSectionImage,
  type ProductSectionImageReview,
} from "./lib/product-photo-review";
import {
  createLockedProductEditorialScene,
  createLockedProductThumbnailOnBackground,
} from "./lib/product-image-lock";
import { readProductPhotoSource } from "./lib/product-photo-provenance";
import { buildProductThumbnailCopy } from "./lib/product-thumbnail";
import {
  applyGeneratedBrandPostImage,
  evaluateBrandPostPackageReadiness,
  getBrandPostPackageDir,
  normalizePackageImageAssets,
  readBrandPostPackage,
  writeBrandPostPackageManifest,
  type BrandPostPackageImageAsset,
  type BrandPostPackageManifestV2,
} from "../src/lib/brand-post-package";
import {
  allowsGenericBrandPostProductPhoto,
  normalizeBrandPostImageIntent,
} from "../src/lib/brand-post-image-evidence";
import { planSectionImageRequests } from "../src/lib/brand-post-image-repair";
import { acquireBrandPostImageRepairLock } from "../src/lib/brand-post-image-repair-lock";
import { writeDraftProgress } from "../src/lib/draft-progress";

export interface ReviewedProductBackgroundJob {
  outStem: string;
  prompt: string;
}

export interface BoundReviewedProductRecoveryTarget {
  role: "hero" | "body";
  sectionId: string | null;
  sectionTitle: string;
  ordinal: number;
  slotId: string;
  imageIntent: string;
  replaceAssetKey?: string;
  previousPath?: string;
  backgroundPath: string;
}

export interface ReviewedProductRecoveryTarget extends BoundReviewedProductRecoveryTarget {
  sourcePath: string;
  sourceReview: NonNullable<BrandPostPackageImageAsset["sourceReview"]>;
}

export interface RenderedReviewedProductRecovery {
  target: ReviewedProductRecoveryTarget;
  outputPath: string;
  provenance: "LOCKED_PRODUCT";
  creationMethod: "source-with-generated-background";
  remoteGenerated: true;
}

const sha256File = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const samePath = (left: string, right: string): boolean =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

function clean(value: unknown): string {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function existingBackground(outStem: string): string {
  const stem = path.resolve(outStem);
  const candidates = [stem, `${stem}.png`, `${stem}.jpg`, `${stem}.jpeg`, `${stem}.webp`]
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .filter((candidate) => {
      try { return fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 0; }
      catch { return false; }
    });
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? `RECOVERY_BACKGROUND_MISSING: 기존 배경 결과를 찾지 못했습니다 (${outStem}).`
        : `RECOVERY_BACKGROUND_AMBIGUOUS: 같은 작업의 배경 결과가 여러 개입니다 (${outStem}).`,
    );
  }
  return candidates[0];
}

function promptSlotId(prompt: string): string | null {
  const line = prompt.match(/^Image slot:\s*(.+)$/mu)?.[1]?.trim();
  if (!line) return null;
  return clean(line.replace(/\.\s+Use\s+a\s+distinct\s+viewpoint.*$/iu, ""));
}

function promptArticlePart(prompt: string): string | null {
  return clean(prompt.match(/^Article part:\s*(.+)$/mu)?.[1] || "") || null;
}

function resolveBackgroundJob(
  jobs: ReviewedProductBackgroundJob[],
  slotId: string,
  articlePart: string,
): string {
  const slotMatches = jobs.filter((job) => promptSlotId(job.prompt) === slotId);
  const matches = slotMatches.length > 0
    ? slotMatches
    : jobs.filter((job) => promptArticlePart(job.prompt) === clean(articlePart));
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `RECOVERY_BACKGROUND_MISSING: ${slotId} 슬롯의 기존 배경 작업을 찾지 못했습니다.`
        : `RECOVERY_BACKGROUND_AMBIGUOUS: ${slotId} 슬롯에 맞는 기존 배경 작업이 여러 개입니다.`,
    );
  }
  return existingBackground(matches[0].outStem);
}

function exactBoundAsset(
  assets: BrandPostPackageImageAsset[],
  options: { role: "hero" | "body"; sectionId: string | null; imagePath: string; label: string },
): BrandPostPackageImageAsset {
  const matches = assets.filter((asset) =>
    asset.role === options.role && (asset.sectionId || null) === options.sectionId && samePath(asset.path, options.imagePath));
  if (matches.length !== 1) {
    throw new Error(
      `RECOVERY_BINDING_INVALID: ${options.label}에 실제로 결속된 ${options.role === "hero" ? "대표" : "본문"} 이미지 항목이 ` +
      `${matches.length === 0 ? "없습니다" : "여러 개입니다"}.`,
    );
  }
  return matches[0];
}

function slotOrdinal(slotId: string, sectionId: string): number {
  const match = slotId.match(new RegExp(`^${sectionId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:image:(\\d+)$`, "u"));
  const ordinal = Number(match?.[1]);
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(`RECOVERY_BINDING_INVALID: ${slotId} 슬롯 번호가 올바르지 않습니다.`);
  }
  return ordinal;
}

/**
 * Only paths referenced by both the composition and a matching manifest asset
 * become recovery targets. Unbound seller photos are source candidates, not
 * images that this maintenance utility may overwrite.
 */
export function planReviewedProductImageRecovery(
  manifest: BrandPostPackageManifestV2,
  jobs: ReviewedProductBackgroundJob[],
): BoundReviewedProductRecoveryTarget[] {
  if (manifest.connectKind !== "SHOPPING") {
    throw new Error("RECOVERY_KIND_UNSUPPORTED: 검토 상품 이미지 복구는 쇼핑커넥트 초안만 지원합니다.");
  }
  const readiness = evaluateBrandPostPackageReadiness(manifest);
  const assets = normalizePackageImageAssets(manifest);
  const renderImages = manifest.composition.renderNodes.filter(
    (node): node is Extract<(typeof manifest.composition.renderNodes)[number], { kind: "image" }> => node.kind === "image",
  );
  const targets: BoundReviewedProductRecoveryTarget[] = [];
  const heroBlocked = readiness.blockers.some((blocker) =>
    blocker.code === "hero-image-invalid" ||
    (!blocker.sectionId && blocker.code === "image-provenance-invalid" && /대표/u.test(blocker.reason)));
  if (heroBlocked) {
    const heroRender = renderImages.filter((node) => node.sectionId === null && samePath(node.assetPath, manifest.heroImagePath));
    if (heroRender.length !== 1) {
      throw new Error("RECOVERY_BINDING_INVALID: 대표 이미지가 현재 렌더 문서에 정확히 한 번 결속되어 있지 않습니다.");
    }
    const heroAsset = exactBoundAsset(assets, {
      role: "hero", sectionId: null, imagePath: manifest.heroImagePath, label: "대표 이미지",
    });
    if (assets.filter((asset) => asset.sha256 === heroAsset.sha256).length !== 1) {
      throw new Error("RECOVERY_BINDING_INVALID: 대표 이미지 해시가 다른 이미지 항목과 중복됩니다.");
    }
    targets.push({
      role: "hero", sectionId: null, sectionTitle: manifest.title, ordinal: 1,
      slotId: "hero:image:1",
      imageIntent: clean(heroRender[0].altText || heroAsset.imageIntent || manifest.title),
      replaceAssetKey: heroAsset.sha256,
      previousPath: heroAsset.path,
      backgroundPath: resolveBackgroundJob(jobs, "hero:image:1", manifest.title),
    });
  }

  const planned = planSectionImageRequests(readiness.imageSlots);
  for (const request of planned) {
    const sectionId = clean(request.sectionId);
    const section = manifest.composition.sections.find((candidate) => candidate.id === sectionId);
    const slotId = clean(request.slotId);
    if (!section || !slotId) {
      throw new Error("RECOVERY_BINDING_INVALID: 복구할 본문 파트 또는 슬롯을 확정하지 못했습니다.");
    }
    const ordinal = slotOrdinal(slotId, section.id);
    const stale = readiness.imageSlots.find((slot) => slot.sectionId === section.id)?.staleTargets
      .find((target) => target.slotId === slotId);
    let asset: BrandPostPackageImageAsset | undefined;
    if (request.replaceAssetKey) {
      const matches = assets.filter((candidate) => candidate.sha256 === request.replaceAssetKey);
      if (matches.length !== 1) {
        throw new Error(`RECOVERY_BINDING_INVALID: ${slotId}의 교체 이미지 해시가 ${matches.length === 0 ? "없거나" : "중복되어"} 안전하지 않습니다.`);
      }
      asset = matches[0];
      const imagePath = section.imagePaths.find((candidate) => samePath(candidate, asset!.path));
      if (!imagePath) throw new Error(`RECOVERY_BINDING_INVALID: ${slotId}의 교체 이미지가 현재 파트에 결속되어 있지 않습니다.`);
      exactBoundAsset(assets, { role: "body", sectionId: section.id, imagePath, label: `${section.title} 파트` });
      const rendered = renderImages.filter((node) => node.sectionId === section.id && samePath(node.assetPath, imagePath));
      if (rendered.length !== 1) {
        throw new Error(`RECOVERY_BINDING_INVALID: ${section.title} 파트 이미지가 현재 렌더 문서에 정확히 한 번 결속되어 있지 않습니다.`);
      }
    } else if (stale) {
      // A stale binding without a unique SHA cannot be replaced safely. Appending
      // would reorder the remaining slots and can make a previously valid image stale.
      throw new Error(`RECOVERY_BINDING_INVALID: ${slotId}의 기존 이미지 교체 대상을 안전하게 확정할 수 없습니다.`);
    }
    targets.push({
      role: "body", sectionId: section.id, sectionTitle: section.title, ordinal, slotId,
      imageIntent: section.imageIntent,
      ...(asset ? { replaceAssetKey: asset.sha256, previousPath: asset.path } : {}),
      backgroundPath: resolveBackgroundJob(jobs, slotId, section.title),
    });
  }

  const duplicateAsset = targets.find((target, index) => target.replaceAssetKey &&
    targets.findIndex((candidate) => candidate.replaceAssetKey === target.replaceAssetKey) !== index);
  if (duplicateAsset) {
    throw new Error(
      `RECOVERY_BINDING_INVALID: ${duplicateAsset.slotId}의 이미지 해시가 대표 또는 다른 파트에서도 사용됩니다. ` +
      "해시 기반 교체 대상을 안전하게 확정할 수 없습니다.",
    );
  }
  const backgroundHashes = targets.map((target) => sha256File(target.backgroundPath));
  const duplicateBackground = targets.find((_, index) => backgroundHashes.indexOf(backgroundHashes[index]) !== index);
  if (duplicateBackground) {
    throw new Error(
      `RECOVERY_BACKGROUND_DUPLICATE: ${duplicateBackground.slotId}의 배경이 대표 또는 다른 슬롯과 같습니다. ` +
      "슬롯별 기존 배경을 확인해 주세요.",
    );
  }
  return targets;
}

export async function reviewProductRecoverySources(options: {
  targets: BoundReviewedProductRecoveryTarget[];
  productName: string;
  sourceBySlot: Record<string, string>;
}, dependencies = { review: selectVerifiedProductSectionImage }): Promise<ReviewedProductRecoveryTarget[]> {
  const candidates = options.targets.map((target) => {
    const configured = clean(options.sourceBySlot[target.slotId]);
    const sourcePath = configured ? path.resolve(configured) : "";
    const stat = sourcePath && fs.existsSync(sourcePath) ? fs.statSync(sourcePath) : null;
    if (!sourcePath || !stat?.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024) {
      throw new Error(`RECOVERY_SOURCE_REQUIRED: ${target.slotId}에 검증할 상품 원본 파일이 필요합니다.`);
    }
    return { target, sourcePath, sourceSha256: sha256File(sourcePath) };
  });
  const requiresFeatureEvidence = (target: BoundReviewedProductRecoveryTarget): boolean =>
    target.role === "body" && !allowsGenericBrandPostProductPhoto({
      sectionTitle: target.sectionTitle,
      imageIntent: target.imageIntent,
    });
  const featureCandidates = candidates.filter(({ target }) => requiresFeatureEvidence(target));
  const duplicateFeature = featureCandidates.find((candidate, index) =>
    featureCandidates.findIndex((other) => other.sourceSha256 === candidate.sourceSha256) !== index);
  if (duplicateFeature) {
    throw new Error(
      `RECOVERY_SOURCE_DUPLICATE: ${duplicateFeature.target.slotId} 기능 파트에 다른 기능 파트와 같은 상품 원본을 반복할 수 없습니다. ` +
      "슬롯별로 서로 다른 feature-evidence 원본이 필요합니다.",
    );
  }

  const reviewed: ReviewedProductRecoveryTarget[] = [];
  for (const candidate of candidates) {
    const result: ProductSectionImageReview | null = await dependencies.review(
      [candidate.sourcePath], options.productName, candidate.target.sectionTitle, candidate.target.imageIntent,
    );
    const genericAllowed = !requiresFeatureEvidence(candidate.target);
    if (!result || !samePath(result.path, candidate.sourcePath) || result.sourceSha256 !== candidate.sourceSha256 ||
        (!genericAllowed && result.reviewClass !== "feature-evidence")) {
      throw new Error(
        `RECOVERY_SOURCE_REVIEW_FAILED: ${candidate.target.slotId}의 상품 원본이 현재 파트 목적에 맞는 ` +
        `${genericAllowed ? "검증 이미지" : "feature-evidence"}로 확인되지 않았습니다.`,
      );
    }
    reviewed.push({
      ...candidate.target,
      sourcePath: candidate.sourcePath,
      sourceReview: {
        version: "product-photo-source-review/v1",
        sourceSha256: candidate.sourceSha256,
        usage: "section-matched-product-evidence",
        sectionIntent: candidate.target.imageIntent,
        reviewClass: result.reviewClass,
        reason: result.reason,
        reviewedAt: result.reviewedAt,
      },
    });
  }
  return reviewed;
}

export function parseProductRecoverySourceMap(
  sourceArgument: string,
  targets: BoundReviewedProductRecoveryTarget[],
): Record<string, string> {
  const sourcePath = path.resolve(sourceArgument);
  if (path.extname(sourcePath).toLowerCase() !== ".json") {
    return Object.fromEntries(targets.map((target) => [target.slotId, sourcePath]));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8")); }
  catch (error) {
    throw new Error(`RECOVERY_SOURCES_INVALID: 슬롯별 상품 원본 매핑을 읽지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
    "sources" in parsed ? (parsed as { sources?: unknown }).sources : parsed;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RECOVERY_SOURCES_INVALID: JSON은 {\"slotId\":\"imagePath\"} 매핑이어야 합니다.");
  }
  const base = path.dirname(sourcePath);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([slotId, file]) =>
    typeof file === "string" && clean(file)
      ? [[clean(slotId), path.isAbsolute(file) ? path.resolve(file) : path.resolve(base, file)]]
      : []));
}

export function reviewedProductRecoveryApplyMetadata(
  target: ReviewedProductRecoveryTarget,
): Pick<Parameters<typeof applyGeneratedBrandPostImage>[0],
  "sectionId" | "replaceAssetKey" | "provenance" | "imageIntent" | "slotId" | "creationMethod" | "remoteGenerated" | "sourceReview"> {
  return {
    ...(target.sectionId ? { sectionId: target.sectionId } : {}),
    replaceAssetKey: target.replaceAssetKey,
    provenance: "LOCKED_PRODUCT",
    imageIntent: target.imageIntent,
    slotId: target.slotId,
    creationMethod: "source-with-generated-background",
    remoteGenerated: true,
    sourceReview: target.sourceReview,
  };
}

export async function renderReviewedProductRecoveryTarget(options: {
  target: ReviewedProductRecoveryTarget;
  outputDir: string;
  productName: string;
  variant: number;
}): Promise<RenderedReviewedProductRecovery> {
  if (sha256File(options.target.sourcePath) !== options.target.sourceReview.sourceSha256) {
    throw new Error(`RECOVERY_SOURCE_CHANGED: ${options.target.slotId}의 검토된 상품 원본이 렌더 전에 변경되었습니다.`);
  }
  const targetDir = path.join(
    options.outputDir,
    crypto.createHash("sha256").update(options.target.slotId).digest("hex").slice(0, 16),
  );
  let outputPath: string;
  try {
    if (options.target.role === "hero") {
      const copy = buildProductThumbnailCopy(options.productName, options.productName);
      outputPath = (await createLockedProductThumbnailOnBackground({
        sourcePath: options.target.sourcePath,
        backgroundPath: options.target.backgroundPath,
        outputDir: targetDir,
        productName: copy.productNameLabel,
        headline: copy.headline,
        subline: copy.subline,
        style: "shopping-color-block",
      })).outputPath;
    } else {
      outputPath = (await createLockedProductEditorialScene({
        sourcePath: options.target.sourcePath,
        backgroundPath: options.target.backgroundPath,
        outputDir: targetDir,
        variant: options.variant,
      })).outputPath;
    }
  } catch (error) {
    throw new Error(
      `PRODUCT_CUTOUT_REQUIRED: ${options.target.slotId}에 전체 사각형 상품 사진을 합성하지 않았습니다. ` +
      `안전하게 분리 가능한 흰 배경 상품 원본이 필요합니다. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const source = readProductPhotoSource(outputPath);
  if (!source || !source.segmented || source.provenance !== "LOCKED_PRODUCT" ||
      source.sourceSha256 !== options.target.sourceReview.sourceSha256) {
    throw new Error(`PRODUCT_CUTOUT_REQUIRED: ${options.target.slotId}의 잠금 상품 출처 기록을 검증하지 못했습니다.`);
  }
  return {
    target: options.target,
    outputPath,
    provenance: "LOCKED_PRODUCT",
    creationMethod: "source-with-generated-background",
    remoteGenerated: true,
  };
}

function assertAppliedTarget(
  manifest: BrandPostPackageManifestV2,
  target: ReviewedProductRecoveryTarget,
): BrandPostPackageImageAsset {
  const assets = normalizePackageImageAssets(manifest);
  let imagePath: string;
  if (target.role === "hero") {
    imagePath = manifest.heroImagePath;
  } else {
    const section = manifest.composition.sections.find((candidate) => candidate.id === target.sectionId);
    const paths = section
      ? [...new Map(section.imagePaths.map((file) => [path.resolve(file).toLowerCase(), file])).values()]
      : [];
    imagePath = paths[target.ordinal - 1] || "";
  }
  const applied = exactBoundAsset(assets, {
    role: target.role,
    sectionId: target.sectionId,
    imagePath,
    label: target.slotId,
  });
  const source = readProductPhotoSource(applied.path);
  if (applied.provenance !== "LOCKED_PRODUCT" || applied.creationMethod !== "source-with-generated-background" ||
      applied.remoteGenerated !== true || applied.slotId !== target.slotId ||
      normalizeBrandPostImageIntent(applied.imageIntent) !== normalizeBrandPostImageIntent(target.imageIntent) ||
      applied.sourceReview?.sourceSha256 !== target.sourceReview.sourceSha256 ||
      normalizeBrandPostImageIntent(applied.sourceReview?.sectionIntent) !== normalizeBrandPostImageIntent(target.imageIntent) ||
      applied.sourceReview?.reviewClass !== target.sourceReview.reviewClass ||
      !source?.segmented || source.provenance !== "LOCKED_PRODUCT" ||
      source.sourceSha256 !== target.sourceReview.sourceSha256) {
    throw new Error(`RECOVERY_IMAGE_AUDIT_FAILED: ${target.slotId}의 잠금 상품·슬롯·이미지 목적 기록이 일치하지 않습니다.`);
  }
  return applied;
}

function parseJobs(jobsFile: string): ReviewedProductBackgroundJob[] {
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(jobsFile, "utf8")); }
  catch (error) {
    throw new Error(`RECOVERY_JOBS_INVALID: 기존 배경 작업 파일을 읽지 못했습니다. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((job) =>
    !job || typeof job !== "object" || Array.isArray(job) ||
    typeof (job as Record<string, unknown>).outStem !== "string" ||
    typeof (job as Record<string, unknown>).prompt !== "string")) {
    throw new Error("RECOVERY_JOBS_INVALID: 기존 배경 작업 목록 형식이 올바르지 않습니다.");
  }
  return value as ReviewedProductBackgroundJob[];
}

async function main() {
  const [id, sourceArgument, jobsFile, baseUrl] = process.argv.slice(2);
  if (!id || !sourceArgument || !jobsFile || !baseUrl) {
    throw new Error("Expected id source jobsFile localBaseUrl");
  }
  const ready = await fetch(`${baseUrl.replace(/\/$/u, "")}/api/system/update-readiness`).then((response) => response.json()) as {
    data?: { ready?: boolean };
  };
  if (!ready.data?.ready) throw new Error("Desktop is busy");

  const lock = acquireBrandPostImageRepairLock(id, { purpose: "reviewed-product-image-recovery" });
  let originalManifest: BrandPostPackageManifestV2 | null = null;
  let mutated = false;
  try {
    lock.assertOwner();
    const manifest = readBrandPostPackage(id, { migrate: false });
    if (!manifest || manifest.version !== "brand-post-package/v2" || manifest.approvedAt || manifest.imageGeneration?.status === "running") {
      throw new Error("Expected inactive unapproved v2 draft");
    }
    originalManifest = manifest;
    const initialReadiness = evaluateBrandPostPackageReadiness(manifest);
    const hasImageRecoveryTarget = initialReadiness.blockers.some((blocker) =>
      blocker.code === "hero-image-invalid" ||
      (!blocker.sectionId && blocker.code === "image-provenance-invalid" && /대표/u.test(blocker.reason))) ||
      initialReadiness.imageSlots.some((slot) => slot.missing > 0 || slot.generationMissing > 0 || slot.staleTargets.length > 0);
    if (!hasImageRecoveryTarget) {
      console.log(JSON.stringify({ images: manifest.imageAssets?.length, canApprove: initialReadiness.canApprove,
        code: "NO_RECOVERY_NEEDED", message: "복구가 필요한 이미지 결함이 없어 기존 이미지를 변경하지 않았습니다." }));
      return;
    }
    const jobs = parseJobs(jobsFile);
    const plannedTargets = planReviewedProductImageRecovery(manifest, jobs);
    if (plannedTargets.length === 0) {
      throw new Error("RECOVERY_TARGET_MISSING: 이미지 결함은 있지만 안전하게 결속할 수 있는 복구 대상이 없습니다.");
    }
    const targets = await reviewProductRecoverySources({
      targets: plannedTargets,
      productName: manifest.title,
      sourceBySlot: parseProductRecoverySourceMap(sourceArgument, plannedTargets),
    });
    for (const slot of initialReadiness.imageSlots) {
      const required = Math.max(slot.missing, slot.generationMissing);
      const boundTargets = targets.filter((target) => target.sectionId === slot.sectionId).length;
      if (required > boundTargets) {
        throw new Error(
          `RECOVERY_TARGET_MISSING: ${slot.title} 파트는 ${required}장 보강이 필요하지만 ` +
          `기존 배경과 결속된 복구 대상은 ${boundTargets}장입니다.`,
        );
      }
    }

    const root = getBrandPostPackageDir(id);
    const work = path.join(root, "reviewed-photo-recovery", `${Date.now()}-${crypto.randomUUID()}`);
    const rendered: RenderedReviewedProductRecovery[] = [];
    for (const [index, target] of targets.entries()) {
      rendered.push(await renderReviewedProductRecoveryTarget({
        target,
        outputDir: work,
        productName: manifest.title,
        variant: index,
      }));
    }

    lock.assertOwner();
    const unchanged = readBrandPostPackage(id, { migrate: false });
    if (!unchanged || unchanged.version !== "brand-post-package/v2" ||
        JSON.stringify(unchanged) !== JSON.stringify(originalManifest)) {
      throw new Error("RECOVERY_DRAFT_CHANGED: 복구 준비 중 초안이 변경되어 이미지 적용을 중단했습니다.");
    }
    const backup = path.join(root, `manifest.before-photo-repair-${Date.now()}.json`);
    fs.copyFileSync(path.join(root, "manifest.json"), backup, fs.constants.COPYFILE_EXCL);

    for (const item of rendered) {
      lock.assertOwner();
      const expectedMetadata = reviewedProductRecoveryApplyMetadata(item.target);
      const current = readBrandPostPackage(id, { migrate: false });
      if (!current || current.version !== "brand-post-package/v2") throw new Error("RECOVERY_DRAFT_CHANGED: 저장 초안이 사라졌습니다.");
      const prior = item.target.replaceAssetKey
        ? normalizePackageImageAssets(current).find((asset) => asset.sha256 === item.target.replaceAssetKey)
        : undefined;
      if (item.target.replaceAssetKey && !prior) {
        throw new Error(`RECOVERY_DRAFT_CHANGED: ${item.target.slotId}의 교체 대상이 변경되었습니다.`);
      }
      if (prior && sha256File(item.outputPath) === prior.sha256) {
        assertAppliedTarget(current, item.target);
        console.log(`Already correct ${item.target.slotId}`);
        continue;
      }
      applyGeneratedBrandPostImage({
        brandLinkId: id,
        generatedPath: item.outputPath,
        ...expectedMetadata,
      });
      mutated = true;
      const applied = readBrandPostPackage(id, { migrate: false });
      if (!applied || applied.version !== "brand-post-package/v2") throw new Error("RECOVERY_DRAFT_CHANGED: 적용 결과를 읽지 못했습니다.");
      assertAppliedTarget(applied, item.target);
      lock.heartbeat();
      console.log(`Replaced ${item.target.slotId}`);
    }

    const result = readBrandPostPackage(id, { migrate: false });
    if (!result || result.version !== "brand-post-package/v2") throw new Error("RECOVERY_DRAFT_CHANGED: 최종 초안을 읽지 못했습니다.");
    for (const target of targets) assertAppliedTarget(result, target);
    const approval = evaluateBrandPostPackageReadiness(result);
    const imageBlockers = approval.blockers.filter((blocker) =>
      blocker.code.startsWith("image-") || blocker.code === "hero-image-invalid" || blocker.code === "generation-required");
    if (imageBlockers.length > 0) {
      throw new Error(`RECOVERY_IMAGE_AUDIT_FAILED: ${imageBlockers.map((blocker) => blocker.reason).join(" ")}`);
    }

    if (approval.canApprove) {
      const resultFile = path.join(root, "result.json");
      if (fs.existsSync(resultFile)) {
        fs.copyFileSync(resultFile, `${resultFile}.before-photo-recovery-${Date.now()}`, fs.constants.COPYFILE_EXCL);
      }
      fs.writeFileSync(resultFile, JSON.stringify({
        ok: true,
        code: "RECOVERED",
        message: "잠금 상품 원본과 기존 배경으로 이미지 복구 및 승인 게이트 검증 완료",
        at: new Date().toISOString(),
      }));
      writeDraftProgress(id, { stage: "done", message: "상품 이미지 복구 완료 · 승인 전 내용 확인 필요" });
    }
    console.log(JSON.stringify({
      images: result.imageAssets?.length,
      quality: result.contentQuality?.score,
      canPublish: result.contentQuality?.canPublish,
      canApprove: approval.canApprove,
      blockers: approval.blockers,
    }));
  } catch (error) {
    if (mutated && originalManifest) {
      lock.assertOwner();
      writeBrandPostPackageManifest(originalManifest);
    }
    throw error;
  } finally {
    lock.release();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

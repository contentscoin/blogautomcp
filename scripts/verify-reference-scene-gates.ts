/** Offline review/approval regression: no remote model, browser, DB or publication. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { classifyBrandPostImageEvidence, referenceSceneReviewIssue, REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import type { BrandPostPackageManifestV2, BrandPostPackageImageAsset } from "../src/lib/brand-post-package";
import { isShoppingThumbnailSourceAspectAllowed, isShoppingThumbnailSourceEligible } from "./lib/thumbnail-layout-v2";
import { collectShoppingProductSourceCandidates } from "./lib/product-photo-source";

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "reference-scene-gates-"));
  const previous = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = temporary;
  try {
    const store = await import("../src/lib/brand-post-package");
    const { resolvePostDocument } = await import("../src/lib/post-composition-contract");
    const { createProductSnapshot } = await import("../src/lib/draft-context-snapshot");
    const { reconcileBrandPostImageContinuity } = await import("../src/lib/brand-post-image-continuity");
    const { materialRevision } = await import("../src/lib/material-library");
    const { createPublishAttempt, publicationMaterialHash } = await import("../src/lib/publish-attempt");
    const { auditPublishImages } = await import("./lib/publish-image-audit");
    const { prepareBrandPostImageReferenceContext } = await import("../src/lib/brand-post-image-generation");
    const image = async (name: string, color: string) => {
      const file = path.join(temporary, name);
      await sharp({ create: { width: 640, height: 640, channels: 3, background: color } }).png().toFile(file);
      return file;
    };
    const source = await image("source.png", "#ddd5cc");
    const hero = await image("hero.png", "#aaa0bb");
    const generated = await image("scene.png", "#f7f3ed");
    const snapshot = createProductSnapshot({ productId: "reference-gates", connectKind: "SHOPPING", externalProductId: "p1", sourceUrl: "https://example.test/p1", product: { name: "선택 상품", features: ["50ml"] } });
    const composition = resolvePostDocument({ connectKind: "SHOPPING", title: "선택 상품 확인", sections: ["생활 속 제품\n\n상품을 둔 일상 공간을 살펴봅니다."], hashtags: ["제품"], imagePaths: [hero],
      sectionPlan: [{ sectionId: "scene", role: "lifestyle", imagePaths: [], imageIntent: "AI 연출 이미지: 일상 공간 배치", imageMin: 1, imageMax: 1 }], connectUrl: "https://example.test/p1" });
    const sectionId = composition.sections[0].id;
    // This fixture isolates a single scene slot; the complete mixed-photo plan
    // is covered separately by the composition and readiness tests.
    composition.sections[0].imageSource = "staged-ai";
    const markdownPath = path.join(temporary, "post.md");
    fs.writeFileSync(markdownPath, "상품을 둔 일상 공간을 살펴봅니다.");
    const manifest: BrandPostPackageManifestV2 = { version: "brand-post-package/v2", brandLinkId: "reference-gates", connectKind: "SHOPPING", title: composition.title, generationSource: "AI", markdownPath,
      heroImagePath: hero, bodyImagePaths: [], imageAssets: [{ path: hero, sourcePath: hero, sha256: hash(hero), role: "hero", creationMethod: "local-composite", provenance: "PHOTO_TEXT_THUMBNAIL", remoteGenerated: false }], hashtags: ["제품"], imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", imageRequirements: { policy: "generated-required" }, sourceSnapshot: snapshot,
      createdAt: new Date().toISOString(), approvedAt: "previous-approval", contractVersion: "post-composition-contract/v1", composition,
      thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1080, height: 1080, aspect: "1:1" }, style: "fixture", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", sourceImagePath: hero } };
    // A valid geometry reference can still be too wide for an intact thumbnail.
    // Hero selection must neither mutate the shared body binding nor ask a model
    // to review sources that the renderer will inevitably reject.
    const wideSource = path.join(temporary, "wide-reference.png");
    const tallSource = path.join(temporary, "tall-reference.png");
    const unreadableSource = path.join(temporary, "unreadable-reference.png");
    await sharp({ create: { width: 747, height: 344, channels: 3, background: "#ddd5cc" } }).png().toFile(wideSource);
    await sharp({ create: { width: 344, height: 900, channels: 3, background: "#ddd5cc" } }).png().toFile(tallSource);
    fs.writeFileSync(unreadableSource, "not an image");
    const checkpointPath = path.join(store.getBrandPostPackageDir(manifest.brandLinkId), "image-generation-work", "scene-reference-context.json");
    const thumbnailCheckpointPath = path.join(path.dirname(checkpointPath), "thumbnail-reference-context.json");
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    const sourceReference = (file: string) => ({ path: file, sha256: hash(file), subject: "selected product", geometry: "complete shape", labels: "visible intrinsic logo", reviewedAt: "2026-10-10T10:00:00.000Z" });
    const writeCheckpoint = (file: string) => {
      fs.writeFileSync(checkpointPath, JSON.stringify({ strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, snapshotId: snapshot.snapshotId, reference: sourceReference(file) }));
      return fs.readFileSync(checkpointPath, "utf8");
    };
    const heroTarget = () => ({ role: "hero" as const, request: { requestId: "thumbnail", slotId: "hero:image:1" }, sectionTitle: manifest.title, imageIntent: "대표 상품 사진", bodyExcerpt: manifest.title });
    const wideCheckpoint = writeCheckpoint(wideSource);
    const bodyBindingPath = path.join(path.dirname(checkpointPath), "current-body.reference-scene.json");
    fs.writeFileSync(bodyBindingPath, JSON.stringify({ slotId: `${sectionId}:image:1`, referenceHashes: [hash(wideSource)], sourceSnapshotId: snapshot.snapshotId }));
    const bodyBindingHash = hash(bodyBindingPath);
    let collectCount = 0, selectCount = 0;
    const recoveredThumbnail = await prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: heroTarget() }, {
      collect: async options => { collectCount += 1; assert.equal(options.maximum, 20); return [wideSource, tallSource, unreadableSource, source]; },
      select: async options => { selectCount += 1; assert.deepEqual(options.paths, [source]); return sourceReference(source); },
    });
    assert.equal(recoveredThumbnail.reference.path, source);
    assert.deepEqual(recoveredThumbnail.referenceHashes, [hash(source)]);
    assert.equal(collectCount, 1);
    assert.equal(selectCount, 1);
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), wideCheckpoint, "hero alternative must not overwrite the body checkpoint");
    assert.equal(hash(bodyBindingPath), bodyBindingHash, "hero alternative must not invalidate a body job binding");
    const cachedAlternative = await prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: heroTarget() }, {
      collect: async () => { throw new Error("reviewed hero alternative unexpectedly recollected"); },
      select: async () => { throw new Error("reviewed hero alternative unexpectedly reviewed"); },
    });
    assert.equal(cachedAlternative.reference.path, source, "hero-specific source remains reusable without a provider request");
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), wideCheckpoint);
    const retainedBody = await prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: { ...heroTarget(), role: "body", sectionId, imageSource: "staged-ai" } }, {
      collect: async () => { throw new Error("cached body reference unexpectedly recollected"); },
      select: async () => { throw new Error("cached body reference unexpectedly reviewed"); },
    });
    assert.equal(retainedBody.reference.path, wideSource);
    assert.deepEqual(retainedBody.referenceHashes, [hash(wideSource)]);
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), wideCheckpoint);
    fs.rmSync(thumbnailCheckpointPath);
    let badSelectCount = 0;
    await assert.rejects(prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: heroTarget() }, {
      collect: async () => [wideSource, tallSource, unreadableSource],
      select: async () => { badSelectCount += 1; throw new Error("ineligible sources must not consume a model request"); },
    }), /PRODUCT_REFERENCE_REQUIRED: needs_reference.*0\.55~1\.85/u);
    assert.equal(badSelectCount, 0);
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), wideCheckpoint);
    await assert.rejects(prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: heroTarget() }, {
      collect: async () => [source], select: async () => ({ ...sourceReference(source), sha256: "0".repeat(64) }),
    }), /REFERENCE_SCENE_CHANGED/u);
    await assert.rejects(prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: heroTarget() }, {
      collect: async () => [source], select: async () => sourceReference(wideSource),
    }), /REFERENCE_SCENE_CHANGED/u);
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), wideCheckpoint);
    const eligibleCheckpoint = writeCheckpoint(source);
    const cachedThumbnail = await prepareBrandPostImageReferenceContext({ manifest, productName: "선택 상품", target: heroTarget() }, {
      collect: async () => { throw new Error("eligible cached thumbnail unexpectedly recollected"); },
      select: async () => { throw new Error("eligible cached thumbnail unexpectedly reviewed"); },
    });
    assert.equal(cachedThumbnail.reference.path, source);
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), eligibleCheckpoint);
    assert.equal(await isShoppingThumbnailSourceEligible(wideSource), false);
    assert.equal(await isShoppingThumbnailSourceEligible(unreadableSource), false);
    assert.equal(await isShoppingThumbnailSourceEligible(source), true);
    for (const dimensions of [{ width: 55, height: 100 }, { width: 185, height: 100 }]) assert.equal(isShoppingThumbnailSourceAspectAllowed(dimensions), true);
    for (const dimensions of [{ width: 54, height: 100 }, { width: 186, height: 100 }, { width: 0, height: 100 }, { width: Number.NaN, height: 100 }, {}]) assert.equal(isShoppingThumbnailSourceAspectAllowed(dimensions), false);
    const review = { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, referencePath: source, referenceSha256: hash(source), sourceSnapshotId: snapshot.snapshotId, reviewStatus: "passed" as const, reviewedOutputSha256: hash(generated), checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) };
    const asset: BrandPostPackageImageAsset = { path: generated, sourcePath: generated, sha256: hash(generated), role: "body", sectionId, slotId: `${sectionId}:image:1`, imageIntent: composition.sections[0].imageIntent, provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true, referenceScene: review };
    // Fresh references prioritize the selected snapshot gallery over the entire
    // saved hash-name pool, while preserving coherent reviewed-source priority.
    const selectedUrl = "https://shop-phinf.pstatic.net/current-selected-product.png";
    const fallbackUrl = "https://shop-phinf.pstatic.net/older-collected-product.png";
    const freshSnapshot = createProductSnapshot({ productId: "fresh-gallery", connectKind: "SHOPPING", externalProductId: "selected",
      sourceUrl: "https://example.test/selected", product: { name: "선택 상품", referenceImageUrls: [selectedUrl] } });
    const freshManifest: BrandPostPackageManifestV2 = { ...manifest, brandLinkId: "fresh-gallery", sourceSnapshot: freshSnapshot,
      imageAssets: [{ path: source, sourcePath: source, sha256: hash(source), role: "body", provenance: "ORIGINAL", creationMethod: "source" }] };
    const freshDir = path.join(store.getBrandPostPackageDir(freshManifest.brandLinkId), "product-sources");
    fs.mkdirSync(freshDir, { recursive: true });
    for (let index = 0; index < 20; index++) {
      const file = path.join(freshDir, `old-${index}.png`);
      await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: index, g: 50, b: 150 } } }).png().toFile(file);
      fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: `https://shop-phinf.pstatic.net/old-${index}.png`,
        sha256: hash(file), retrievedAt: new Date().toISOString() }));
    }
    const selectedFile = path.join(freshDir, "zz-current-selected.png");
    fs.copyFileSync(hero, selectedFile);
    fs.writeFileSync(`${selectedFile}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: selectedUrl,
      sha256: hash(selectedFile), retrievedAt: new Date().toISOString(), identityVerified: false }));
    let freshReviews = 0;
    const freshContext = await prepareBrandPostImageReferenceContext({ manifest: freshManifest, productName: "선택 상품",
      target: heroTarget(), sourceImageUrls: [fallbackUrl] }, {
      collect: options => {
        assert.equal(options.preferSourceImageUrls, true);
        assert.deepEqual(options.priorityLocalCandidates, [], "an ORIGINAL section review alone is not a reference-geometry approval");
        assert.deepEqual(options.sourceImageUrls, [selectedUrl, fallbackUrl]);
        return collectShoppingProductSourceCandidates(options, { download: async url => {
          assert.equal(url, fallbackUrl, "current selected URL should reuse its intact receipt");
          throw new Error("offline removed fallback");
        } });
      },
      select: async options => {
        freshReviews++;
        assert.equal(options.paths[0], selectedFile, "the current seller photo remains within the first twelve reviewed candidates");
        assert.equal(options.paths.length, 20);
        return sourceReference(selectedFile);
      },
    });
    assert.equal(freshContext.reference.path, selectedFile);
    assert.equal(freshReviews, 1, "receipt lineage always reaches actual reference selection");
    assert.equal(fs.readFileSync(checkpointPath, "utf8"), eligibleCheckpoint, "other existing body checkpoints are preserved");
    assert.equal(hash(bodyBindingPath), bodyBindingHash, "existing raw-job bindings are preserved");
    for (const [index, mutation] of [{}, { reviewStatus: "pending" }, { sourceSnapshotId: "old" },
      { reviewedOutputSha256: "0".repeat(64) }, { checks: { ...review.checks, noAddedText: false } },
      { referenceSha256: "0".repeat(64) }, { strategyVersion: "old" }].entries()) {
      const prior = { ...asset, referenceScene: { ...review, sourceSnapshotId: freshSnapshot.snapshotId, ...mutation } } as BrandPostPackageImageAsset;
      const withPrior = { ...freshManifest, brandLinkId: `prior-reference-${index}`, imageAssets: [prior] };
      await prepareBrandPostImageReferenceContext({ manifest: withPrior, productName: "선택 상품", target: heroTarget() }, {
        collect: async options => {
          assert.deepEqual(options.priorityLocalCandidates, index === 0 ? [source] : [], "only a coherent current byte-bound passed reference receives priority");
          return [selectedFile];
        },
        select: async () => sourceReference(selectedFile),
      });
    }
    const context = { referenceSha256: hash(source), sourceSnapshotId: snapshot.snapshotId, anchorSha256: hash(hero) };
    assert.deepEqual(classifyBrandPostImageEvidence(asset), { coherent: true, generated: true, reason: null });
    for (const mutation of [{ provenance: "ORIGINAL" }, { provenance: "LOCKED_PRODUCT" }, { remoteGenerated: false }, { creationMethod: "source" }]) assert.equal(classifyBrandPostImageEvidence({ ...asset, ...mutation } as BrandPostPackageImageAsset).coherent, false);
    assert.equal(referenceSceneReviewIssue(asset, context), null);
    for (const mutation of [{ reviewStatus: "pending" }, { reviewStatus: "failed" }, { reviewedOutputSha256: "0".repeat(64) }, { sourceSnapshotId: "changed" }, { referenceSha256: "0".repeat(64) }, { anchorSha256: "0".repeat(64) }, { strategyVersion: "unknown" }, { strategyVersion: "shopping-reference-scene/v1" }, ...REFERENCE_SCENE_REVIEW_CHECKS.map(check => ({ checks: { ...review.checks, [check]: false } }))])
      assert(referenceSceneReviewIssue({ ...asset, referenceScene: { ...review, ...mutation } } as BrandPostPackageImageAsset, context));
    assert.equal(REFERENCE_SCENE_REVIEW_CHECKS.length, 11);
    assert.equal(classifyBrandPostImageEvidence(manifest.imageAssets![0]).coherent, true);
    assert.equal(classifyBrandPostImageEvidence({ ...manifest.imageAssets![0], remoteGenerated: true }).coherent, false);
    store.writeBrandPostPackageManifest(manifest);
    assert.throws(() => store.applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, generatedPath: generated, sectionId, provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true }), /REFERENCE_REVIEW_REQUIRED/);
    const updated = store.applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, generatedPath: generated, sectionId, slotId: asset.slotId, imageIntent: asset.imageIntent, provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true, referenceScene: review });
    assert.equal(updated.approvedAt, null);
    const savedAsset = updated.imageAssets!.find(item => item.provenance === "GENERATED_SCENE")!;
    assert.notEqual(savedAsset.referenceScene!.referencePath, source);
    assert.equal(hash(savedAsset.referenceScene!.referencePath), hash(source));
    assert.equal(store.getBrandPostImageSlots(updated)[0].generatedCount, 1);
    assert.equal(store.getBrandPostImageSlots(updated)[0].generationMissing, 0);
    assert.equal(store.getBrandPostImageSlots(updated)[0].staleTargets.length, 0);
    assert.equal(updated.composition.renderNodes.find(node => node.kind === "image" && node.sectionId === sectionId)?.kind, "image");
    assert(updated.composition.renderNodes.some(node => node.kind === "image" && node.caption === REFERENCE_SCENE_CAPTION));
    const missingAffiliate = structuredClone(updated);
    missingAffiliate.composition.renderNodes = missingAffiliate.composition.renderNodes.filter(node => node.kind !== "disclosure");
    assert(store.evaluateBrandPostPackageReadiness(missingAffiliate).blockers.some(item => item.code === "affiliate-disclosure-position"));
    const bottomAffiliate = structuredClone(updated);
    const affiliate = bottomAffiliate.composition.renderNodes.shift()!;
    if (affiliate.kind === "disclosure") affiliate.placement = "bottom";
    bottomAffiliate.composition.renderNodes.push(affiliate);
    assert(store.evaluateBrandPostPackageReadiness(bottomAffiliate).blockers.some(item => item.code === "affiliate-disclosure-position"));
    const staleStrategy = structuredClone(updated);
    staleStrategy.approvedAt = "approved";
    staleStrategy.composition.strategyVersion = "shopping-post-strategy/v1";
    staleStrategy.textQualityRevalidation = { version: "saved-text-qc/v3", checkedAt: new Date().toISOString(), inputFingerprint: "fixture", sourceSnapshotId: snapshot.snapshotId, sourceOrigin: "package", strategyVersion: "old-strategy" };
    assert(store.evaluateBrandPostPackageReadiness(staleStrategy).blockers.some(item => item.code === "text-qc-stale"));
    const missingCaption = structuredClone(updated);
    missingCaption.composition.renderNodes.forEach(node => { if (node.kind === "image") delete node.caption; });
    assert(store.evaluateBrandPostPackageReadiness(missingCaption).blockers.some(item => item.code === "image-scene-disclosure-missing"));
    const proof = structuredClone(updated);
    proof.composition.sections[0].imageSource = "seller-crop";
    assert(store.getBrandPostImageSlots(proof)[0].staleTargets.some(item => item.code === "image-scene-not-evidence" || item.code === "image-natural-photo-role"));
    const incomplete = structuredClone(updated);
    incomplete.imageAssets!.find(item => item.provenance === "GENERATED_SCENE")!.referenceScene!.reviewStatus = "pending";
    assert.equal(store.getBrandPostImageSlots(incomplete)[0].generatedCount, 0);
    assert.equal(store.getBrandPostImageSlots(incomplete)[0].generationMissing, 1);
    const revised = structuredClone(updated);
    revised.sourceSnapshot = createProductSnapshot({ productId: "reference-gates", connectKind: "SHOPPING", externalProductId: "p2", sourceUrl: "https://example.test/p2", product: { name: "다른 상품" } });
    assert(store.getBrandPostImageSlots(revised)[0].staleTargets.some(item => item.code === "image-reference-review-invalid"));
    assert.equal(reconcileBrandPostImageContinuity(updated, revised).composition.sections[0].imagePaths.length, 0);
    assert.equal(reconcileBrandPostImageContinuity(updated, structuredClone(updated)).composition.sections[0].imagePaths.length, 1);
    for (const brokenCheck of ["noAddedText", "noFramesOrPanels", "singleScene"] as const) {
      const framedScene = structuredClone(updated);
      framedScene.imageAssets!.find(item => item.provenance === "GENERATED_SCENE")!.referenceScene!.checks![brokenCheck] = false;
      assert.equal(reconcileBrandPostImageContinuity(framedScene, structuredClone(framedScene)).composition.sections[0].imagePaths.length, 0,
        `a previously approved image with failed ${brokenCheck} cannot survive text revision`);
    }
    const legacyCard = structuredClone(updated);
    Object.assign(legacyCard.imageAssets!.find(item => item.provenance === "GENERATED_SCENE")!, {
      provenance: "EDITORIAL_CARD", creationMethod: "local-composite", remoteGenerated: false, referenceScene: undefined,
    });
    assert.equal(reconcileBrandPostImageContinuity(legacyCard, structuredClone(legacyCard)).composition.sections[0].imagePaths.length, 0,
      "legacy framed originals must not be carried into the new natural-photo draft");
    const visualReview = async (request: { userPrompt: string; imagePaths?: string[] }) => {
      assert(request.userPrompt.includes("adjacentCaption"));
      const line = request.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
      const slots = JSON.parse(line.slice(line.indexOf("["))) as Array<{ role: string; visualContract: { purpose: string; claimPolicy: string } }>;
      for (const slot of slots) {
        assert.equal(slot.visualContract.purpose, slot.role === "thumbnail" ? "thumbnail" : "lifestyle-illustration");
        assert.equal(slot.visualContract.claimPolicy, "visual-compatibility-and-explicit-photo-claims");
      }
      return JSON.stringify({ reviews: request.imagePaths!.map((_, index) => ({ index: index + 1, accepted: true, identityMatches: true, photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "offline fixture" })) });
    };
    const audited = await auditPublishImages({ productName: "선택 상품", composition: updated.composition, imageAssets: updated.imageAssets, sourceSnapshotId: snapshot.snapshotId, review: visualReview });
    assert.equal(audited.ok, true);
    for (const failedLayoutCheck of ["singlePhotograph", "noGraphicLayout", "textPolicyMatches"] as const) {
      const rejected = await auditPublishImages({ productName: "선택 상품", composition: updated.composition, imageAssets: updated.imageAssets, sourceSnapshotId: snapshot.snapshotId,
        review: async request => {
          const answer = JSON.parse(await visualReview(request));
          answer.reviews.forEach((item: Record<string, unknown>) => { item[failedLayoutCheck] = false; });
          return JSON.stringify(answer);
        } });
      assert.equal(rejected.ok, false, `actual pixel ${failedLayoutCheck} failure rejects a metadata-approved image`);
    }
    const captionAudit = await auditPublishImages({ productName: "선택 상품", composition: missingCaption.composition, imageAssets: missingCaption.imageAssets, sourceSnapshotId: snapshot.snapshotId, review: visualReview });
    assert(captionAudit.failures.some(failure => failure.code === "INVALID_CONTEXT"));
    const photoPaths = [source, generated, await image("scene-2.png", "#bab1a3"), await image("scene-3.png", "#c3baa5")];
    const mixedComposition = resolvePostDocument({ connectKind: "SHOPPING", title: updated.title,
      sections: ["상품 원본", "일상 장면", "외출 장면", "다른 코디"].map(title => `${title}\n\n원본을 확인하고 생활 속 모습을 참고합니다.`),
      sectionPlan: photoPaths.map((file, index) => ({ sectionId: `mixed-${index}`, role: "lifestyle", imagePaths: [file], imageIntent: "생활 장면", imageMin: 1, imageMax: 1 })),
      imagePaths: [hero, ...photoPaths], hashtags: ["제품"], connectUrl: "https://example.test/p1" });
    const mixed: BrandPostPackageManifestV2 = { ...updated, composition: mixedComposition, bodyImagePaths: photoPaths,
      imageAssets: [updated.imageAssets!.find(item => item.role === "hero")!, ...photoPaths.map((file, index): BrandPostPackageImageAsset => {
        const section = mixedComposition.sections[index];
        return index === 0 ? { path: file, sourcePath: file, sha256: hash(file), role: "body", sectionId: section.id,
          slotId: `${section.id}:image:1`, imageIntent: section.imageIntent, provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
          sourceReview: { version: "product-photo-source-review/v1", usage: "section-matched-product-evidence", sourceSha256: hash(file),
            sectionIntent: section.imageIntent, reviewClass: "product-photo", reviewedAt: "fixture", reason: "visible complete product" } }
          : { ...asset, path: file, sourcePath: file, sha256: hash(file), sectionId: section.id, slotId: `${section.id}:image:1`, imageIntent: section.imageIntent,
            referenceScene: { ...review, reviewedOutputSha256: hash(file) } };
      })] };
    const mixedSlots = store.getBrandPostImageSlots(mixed);
    assert.equal(mixedSlots[0].generatedMinimum, 0, "generated-required never demands an AI replacement for the single original slot");
    assert.equal(mixedSlots[0].originalCount, 1);
    assert.equal(mixedSlots.reduce((sum, slot) => sum + slot.generationMissing, 0), 0);
    assert.equal(mixedSlots.reduce((sum, slot) => sum + slot.generatedCount, 0), 3);
    assert(!store.evaluateBrandPostPackageReadiness(mixed).blockers.some(item => item.code === "image-natural-photo-plan"));
    const fakeOriginal = structuredClone(mixed);
    fakeOriginal.imageAssets![1] = { ...mixed.imageAssets![2], path: source, sourcePath: source, sha256: hash(source),
      sectionId: mixedComposition.sections[0].id, slotId: `${mixedComposition.sections[0].id}:image:1`, imageIntent: mixedComposition.sections[0].imageIntent,
      referenceScene: { ...review, reviewedOutputSha256: hash(source) } };
    assert(store.getBrandPostImageSlots(fakeOriginal)[0].staleTargets.some(item => item.code === "image-natural-photo-role"),
      "AI-generated metadata cannot masquerade as the one original photo");
    const originalFiller = structuredClone(mixed);
    originalFiller.imageAssets![2] = { ...mixed.imageAssets![1], path: generated, sourcePath: generated, sha256: hash(generated),
      sectionId: mixedComposition.sections[1].id, slotId: `${mixedComposition.sections[1].id}:image:1`, imageIntent: mixedComposition.sections[1].imageIntent };
    assert(store.getBrandPostImageSlots(originalFiller)[1].staleTargets.some(item => item.code === "image-natural-photo-role"),
      "a seller original cannot fill an AI scene slot via a direct manifest write");
    const revision = materialRevision(updated);
    const manifestPath = store.getBrandPostPackageManifestPath(manifest.brandLinkId);
    const attempt = createPublishAttempt(manifest.brandLinkId, "now", manifestPath);
    const frozen = JSON.parse(fs.readFileSync(attempt.snapshotManifestPath!, "utf8"));
    const frozenReference = frozen.imageAssets.find((item: BrandPostPackageImageAsset) => item.provenance === "GENERATED_SCENE").referenceScene.referencePath;
    assert.notEqual(frozenReference, savedAsset.referenceScene!.referencePath);
    assert.equal(hash(frozenReference), review.referenceSha256);
    fs.writeFileSync(savedAsset.referenceScene!.referencePath, "reference changed");
    assert.notEqual(materialRevision(updated), revision);
    assert.notEqual(publicationMaterialHash(manifestPath), attempt.manifestHash);
    assert.equal(publicationMaterialHash(attempt.snapshotManifestPath!), attempt.snapshotHash);
    assert(store.getBrandPostImageSlots(updated)[0].staleTargets.some(item => item.code === "image-reference-review-invalid"));
    console.log("PASS: reference-scene provenance, review binding, anatomy checks, pending blocking, captions, proof exclusion, source continuity, immutable references and revision hashes; offline only");
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previous;
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

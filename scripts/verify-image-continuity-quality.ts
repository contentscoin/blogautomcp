/** Offline regression: no browser, account, network, or image generation is used. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BrandPostPackageImageAsset,
  BrandPostPackageManifestV2,
} from "../src/lib/brand-post-package";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "image-continuity-quality-"));
process.env.DESKTOP_USER_DATA = temp;

const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const iso = (minute: number) => `2026-09-14T10:${String(minute).padStart(2, "0")}:00.000Z`;

async function main() {
  const continuity = await import("../src/lib/brand-post-image-continuity");
  const generation = await import("../src/lib/brand-post-image-generation");
  const repair = await import("../src/lib/brand-post-image-repair");
  const store = await import("../src/lib/brand-post-package");
  const compositionContract = await import("../src/lib/post-composition-contract");
  const snapshots = await import("../src/lib/draft-context-snapshot");
  const provenance = await import("./lib/product-photo-provenance");

  const packageDir = path.join(temp, "fixture-package");
  fs.mkdirSync(packageDir, { recursive: true });
  const markdownPath = path.join(packageDir, "post.md");
  fs.writeFileSync(markdownPath, "이미지 연속성 검증용 본문입니다.");
  const heroPath = path.join(packageDir, "hero.png");
  fs.writeFileSync(heroPath, "unique-hero");
  const bodyPaths = Array.from({ length: 9 }, (_, index) => {
    const file = path.join(packageDir, `body-${index + 1}.png`);
    fs.writeFileSync(file, `unique-body-${index + 1}`);
    return file;
  });
  const intents = Array.from({ length: 9 }, (_, index) => `장면 의도 ${index + 1}`);
  const sourceSnapshot = snapshots.createProductSnapshot({
    productId: "fixture-image-continuity",
    connectKind: "SHOPPING",
    externalProductId: "seller-product-1",
    sourceUrl: "https://example.test/product",
    product: { name: "연속성 검증 상품" },
    capturedAt: iso(0),
  });

  function buildManifest(options: {
    createdAt: string;
    title?: string;
    bodyRevision?: string;
    sectionTitleRevision?: string;
    imageIntents?: string[];
    attachedBodyPaths?: string[];
    imageGeneration?: BrandPostPackageManifestV2["imageGeneration"];
    imageAssets?: BrandPostPackageImageAsset[];
  }): BrandPostPackageManifestV2 {
    const attached = options.attachedBodyPaths || [];
    const imageIntents = options.imageIntents || intents;
    const sectionPlan = imageIntents.map((imageIntent, index) => ({
      sectionId: `shopping-fixture-${index + 1}`,
      role: `fixture-${index + 1}`,
      imagePaths: attached[index] ? [attached[index]] : [],
      imageIntent,
      imageMin: 1,
      imageMax: 1,
      headingStyle: "sectionTitle" as const,
      earlyConnectCard: index === 1,
    }));
    const sections = imageIntents.map((_, index) => [
      `섹션 ${index + 1}${options.sectionTitleRevision || ""}`,
      `${options.bodyRevision || "초기"} 본문 ${index + 1}. 확인된 정보와 구체적인 사용 장면을 설명합니다. `.repeat(8),
    ].join("\n\n"));
    const composition = compositionContract.resolvePostDocument({
      connectKind: "SHOPPING",
      title: options.title || "연속성 검증 상품",
      sections,
      hashtags: ["연속성", "이미지검수"],
      imagePaths: [heroPath, ...attached],
      sectionImagePaths: imageIntents.map((_, index) => attached[index] ? [attached[index]] : []),
      sectionPlan,
      connectUrl: "https://example.test/product",
      qualityPreset: "PREMIUM",
    });
    const defaultAssets: BrandPostPackageImageAsset[] = [
      {
        path: heroPath,
        sourcePath: heroPath,
        sha256: digest(heroPath),
        role: "hero",
        slotId: "hero:image:1",
        creationMethod: "source",
        provenance: "ORIGINAL",
      },
      ...attached.map((file, index): BrandPostPackageImageAsset => ({
        path: file,
        sourcePath: file,
        sha256: digest(file),
        role: "body",
        sectionId: `shopping-fixture-${index + 1}`,
        slotId: `shopping-fixture-${index + 1}:image:1`,
        imageIntent: imageIntents[index],
        creationMethod: "remote-generated",
        remoteGenerated: true,
        provenance: "GENERATED_BACKGROUND",
      })),
    ];
    return {
      version: "brand-post-package/v2",
      brandLinkId: "fixture-image-continuity",
      connectKind: "SHOPPING",
      title: composition.title,
      generationSource: "AI",
      markdownPath,
      heroImagePath: heroPath,
      bodyImagePaths: attached,
      imageAssets: options.imageAssets || defaultAssets,
      hashtags: ["연속성", "이미지검수"],
      imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
      imageRequirements: { policy: "generated-required" },
      sourceSnapshot,
      createdAt: options.createdAt,
      approvedAt: null,
      contractVersion: "post-composition-contract/v1",
      composition,
      thumbnailSpec: {
        version: "thumbnail-spec/v2",
        canvas: { width: 1000, height: 1000, aspect: "1:1" },
        style: "fixture",
        sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
        sourceImagePath: heroPath,
      },
      imageGeneration: options.imageGeneration,
    };
  }

  const partialState: NonNullable<BrandPostPackageManifestV2["imageGeneration"]> = {
    status: "incomplete",
    requested: 9,
    applied: 4,
    remaining: 5,
    errors: ["fixture fifth slot failed"],
    updatedAt: iso(1),
  };
  const previous = buildManifest({
    createdAt: iso(0),
    attachedBodyPaths: bodyPaths.slice(0, 4),
    imageGeneration: partialState,
  });
  const resumeSources = bodyPaths.slice(0, 4).map((bodyPath, index) => {
    const source = path.join(packageDir, `resume-source-${index + 1}.png`);
    fs.writeFileSync(source, `unique-resume-source-${index + 1}`);
    provenance.preserveProductPhotoSource({ sourcePath: source, outputPath: bodyPath, segmented: true });
    return source;
  });
  previous.imageAssets = previous.imageAssets!.map(asset => asset.role === "body" ? {
    ...asset,
    creationMethod: "source-with-generated-background" as const,
    provenance: "LOCKED_PRODUCT" as const,
  } : asset);
  const previousBodyAssets = previous.imageAssets!.filter((asset) => asset.role === "body");

  const assertExactPreservation = (actual: BrandPostPackageManifestV2, label: string) => {
    assert.equal(actual.createdAt, previous.createdAt, `${label}: original creation time is the package identity`);
    assert.deepEqual(actual.bodyImagePaths, previous.bodyImagePaths, `${label}: exact image paths survive`);
    assert.deepEqual(
      actual.imageAssets!.filter((asset) => asset.role === "body").map((asset) => ({
        path: asset.path,
        sha256: asset.sha256,
        slotId: asset.slotId,
        sectionId: asset.sectionId,
      })),
      previousBodyAssets.map((asset) => ({
        path: asset.path,
        sha256: asset.sha256,
        slotId: asset.slotId,
        sectionId: asset.sectionId,
      })),
      `${label}: hashes and stable slots survive byte-for-byte`,
    );
    assert.deepEqual(actual.imageGeneration, partialState, `${label}: partial generation checkpoint survives`);
  };

  const bodyOnly: BrandPostPackageManifestV2 = continuity.reconcileBrandPostImageContinuity(previous, buildManifest({
    createdAt: iso(5),
    bodyRevision: "보강된",
    attachedBodyPaths: [],
  }));
  assertExactPreservation(bodyOnly, "body-only revision");

  const titleOnly: BrandPostPackageManifestV2 = continuity.reconcileBrandPostImageContinuity(previous, buildManifest({
    createdAt: iso(6),
    title: "제목을 고친 연속성 검증 상품",
    sectionTitleRevision: " - 제목 수정",
    attachedBodyPaths: [],
  }));
  assertExactPreservation(titleOnly, "title-only revision");

  const changedIntents = [...intents];
  changedIntents[2] = "완전히 달라진 제3 장면 의도";
  const oneIntentChanged: BrandPostPackageManifestV2 = continuity.reconcileBrandPostImageContinuity(previous, buildManifest({
    createdAt: iso(7),
    bodyRevision: "보강된",
    imageIntents: changedIntents,
    attachedBodyPaths: [],
  }));
  const retainedBodyAssets = oneIntentChanged.imageAssets!.filter((asset) => asset.role === "body");
  assert.equal(retainedBodyAssets.length, 3, "one changed intent invalidates exactly one completed slot");
  assert.equal(retainedBodyAssets.some((asset) => asset.slotId === "shopping-fixture-3:image:1"), false);
  assert.deepEqual(
    retainedBodyAssets.map((asset) => asset.slotId),
    previousBodyAssets.filter((asset) => asset.slotId !== "shopping-fixture-3:image:1").map((asset) => asset.slotId),
  );

  const slotsAfterResume = store.getBrandPostImageSlots(bodyOnly);
  assert.equal(slotsAfterResume.reduce((sum, slot) => sum + slot.count, 0), 4, "4/9 progress is retained");
  assert.equal(slotsAfterResume.reduce((sum, slot) => sum + slot.missing, 0), 5, "only five missing slots remain");
  assert.equal(slotsAfterResume.reduce((sum, slot) => sum + slot.generationMissing, 0), 5, "generation retry targets only deficits");
  assert.equal(repair.planSectionImageRequests(slotsAfterResume).length, 5, "resume queues only the five absent slots");
  assert.deepEqual(
    generation.getUsedShoppingProductSources(bodyOnly).map(record => record.sourceSha256).sort(),
    resumeSources.map(file => digest(file)).sort(),
    "4/9 resume identifies all four already-used cutout sources before seeking fresh candidates",
  );

  const baseIdentity = generation.buildBrandPostImageJobIdentity({
    manifest: previous,
    slotId: "shopping-fixture-1:image:1",
    sectionId: "shopping-fixture-1",
    role: "body",
    imageIntent: intents[0],
    referenceHashes: ["a".repeat(64)],
  });
  const revisedIdentity = generation.buildBrandPostImageJobIdentity({
    manifest: buildManifest({ createdAt: iso(9), bodyRevision: "재작성된", attachedBodyPaths: bodyPaths.slice(0, 4) }),
    slotId: "shopping-fixture-1:image:1",
    sectionId: "shopping-fixture-1",
    role: "body",
    imageIntent: intents[0],
    referenceHashes: ["a".repeat(64)],
  });
  assert.equal(revisedIdentity, baseIdentity, "createdAt and prose body must not invalidate an image cache entry");
  assert.notEqual(generation.buildBrandPostImageJobIdentity({
    manifest: previous,
    slotId: "shopping-fixture-1:image:1",
    sectionId: "shopping-fixture-1",
    role: "body",
    imageIntent: "different visual intent",
    referenceHashes: ["a".repeat(64)],
  }), baseIdentity, "visual intent changes cache identity");
  assert.notEqual(generation.buildBrandPostImageJobIdentity({
    manifest: previous,
    slotId: "shopping-fixture-1:image:1",
    sectionId: "shopping-fixture-1",
    role: "body",
    imageIntent: intents[0],
    referenceHashes: ["b".repeat(64)],
  }), baseIdentity, "reference bytes change cache identity");

  const sellerSource = path.join(packageDir, "seller-source.png");
  fs.writeFileSync(sellerSource, "one-verified-seller-photo");
  const compositeA = path.join(packageDir, "composite-a.png");
  const compositeB = path.join(packageDir, "composite-b.png");
  fs.writeFileSync(compositeA, "unique-composite-a");
  fs.writeFileSync(compositeB, "unique-composite-b");
  provenance.preserveProductPhotoSource({ sourcePath: sellerSource, outputPath: compositeA, segmented: true });
  provenance.preserveProductPhotoSource({ sourcePath: sellerSource, outputPath: compositeB, segmented: true });
  const duplicateSourceManifest = buildManifest({
    createdAt: iso(10),
    attachedBodyPaths: [compositeA, compositeB],
    imageAssets: [
      {
        path: heroPath, sourcePath: heroPath, sha256: digest(heroPath), role: "hero",
        slotId: "hero:image:1", creationMethod: "source", provenance: "ORIGINAL",
      },
      ...[compositeA, compositeB].map((file, index): BrandPostPackageImageAsset => ({
        path: file,
        sourcePath: file,
        sha256: digest(file),
        role: "body",
        sectionId: `shopping-fixture-${index + 1}`,
        slotId: `shopping-fixture-${index + 1}:image:1`,
        imageIntent: intents[index],
        creationMethod: "source-with-generated-background",
        remoteGenerated: true,
        provenance: "EDITORIAL_CARD",
      })),
    ],
  });
  const reusedSourceBlockers = store.evaluateBrandPostPackageReadiness(duplicateSourceManifest).blockers;
  assert.equal(
    reusedSourceBlockers.some((blocker) => blocker.code === "image-source-duplicate" || blocker.code === "image-output-duplicate"),
    false,
    "one safe segmented product source may be reused when final outputs and slot intents differ",
  );

  const duplicateOutputA = path.join(packageDir, "duplicate-output-a.png");
  const duplicateOutputB = path.join(packageDir, "duplicate-output-b.png");
  fs.writeFileSync(duplicateOutputA, "identical-final-output");
  fs.copyFileSync(duplicateOutputA, duplicateOutputB);
  provenance.preserveProductPhotoSource({ sourcePath: sellerSource, outputPath: duplicateOutputA, segmented: true });
  provenance.preserveProductPhotoSource({ sourcePath: sellerSource, outputPath: duplicateOutputB, segmented: true });
  const duplicateOutputManifest = buildManifest({
    createdAt: iso(10),
    attachedBodyPaths: [duplicateOutputA, duplicateOutputB],
    imageAssets: [
      {
        path: heroPath, sourcePath: heroPath, sha256: digest(heroPath), role: "hero",
        slotId: "hero:image:1", creationMethod: "source", provenance: "ORIGINAL",
      },
      ...[duplicateOutputA, duplicateOutputB].map((file, index): BrandPostPackageImageAsset => ({
        path: file,
        sourcePath: file,
        sha256: digest(file),
        role: "body",
        sectionId: `shopping-fixture-${index + 1}`,
        slotId: `shopping-fixture-${index + 1}:image:1`,
        imageIntent: intents[index],
        creationMethod: "source-with-generated-background",
        remoteGenerated: true,
        provenance: "LOCKED_PRODUCT",
      })),
    ],
  });
  assert.ok(
    store.evaluateBrandPostPackageReadiness(duplicateOutputManifest).blockers.some((blocker) => blocker.code === "image-output-duplicate"),
    "byte-identical final outputs in distinct slots must block approval",
  );

  const fullFrame = path.join(packageDir, "full-frame-on-background.png");
  fs.writeFileSync(fullFrame, "whole-rectangular-source-over-generated-background");
  provenance.preserveProductPhotoSource({ sourcePath: sellerSource, outputPath: fullFrame, segmented: false });
  const fullFrameManifest = buildManifest({
    createdAt: iso(11),
    attachedBodyPaths: [fullFrame],
    imageAssets: [
      {
        path: heroPath, sourcePath: heroPath, sha256: digest(heroPath), role: "hero",
        slotId: "hero:image:1", creationMethod: "source", provenance: "ORIGINAL",
      },
      {
        path: fullFrame,
        sourcePath: fullFrame,
        sha256: digest(fullFrame),
        role: "body",
        sectionId: "shopping-fixture-1",
        slotId: "shopping-fixture-1:image:1",
        imageIntent: intents[0],
        creationMethod: "source-with-generated-background",
        remoteGenerated: true,
        provenance: "EDITORIAL_CARD",
      },
    ],
  });
  assert.ok(
    store.evaluateBrandPostPackageReadiness(fullFrameManifest).blockers.some((blocker) => blocker.code === "image-full-frame-overlay"),
    "segmented:false whole-photo foreground composites must block approval",
  );

  console.log("PASS: image continuity, 4/9 used-source resume, stable cache identity, safe source reuse, identical-output and full-frame blockers");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  parseProductRecoverySourceMap,
  planReviewedProductImageRecovery,
  renderReviewedProductRecoveryTarget,
  reviewProductRecoverySources,
  reviewedProductRecoveryApplyMetadata,
} from "./recover-reviewed-product-images";
import { readProductPhotoSource } from "./lib/product-photo-provenance";
import {
  applyGeneratedBrandPostImage,
  evaluateBrandPostPackageReadiness,
  getBrandPostPackageDir,
  normalizePackageImageAssets,
  readBrandPostPackage,
  writeBrandPostPackageManifest,
  type BrandPostPackageManifestV2,
} from "../src/lib/brand-post-package";
import {
  allowsGenericBrandPostProductPhoto,
  classifyBrandPostImageEvidence,
} from "../src/lib/brand-post-image-evidence";
import { resolvePostDocument, stableFreeformSectionId } from "../src/lib/post-composition-contract";

const hash = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function makeImage(file: string, width: number, height: number, color: string): Promise<void> {
  await sharp({ create: { width, height, channels: 4, background: color } }).png().toFile(file);
}

async function makeSafeCutout(file: string, color: [number, number, number], offsetX: number): Promise<void> {
  const width = 180;
  const height = 160;
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 24; y < 140; y += 1) {
    for (let x = offsetX; x < offsetX + 66; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(file);
}

function passingContentQuality(): NonNullable<BrandPostPackageManifestV2["contentQuality"]> {
  return {
    canPublish: true,
    verdict: "pass",
    code: "ok",
    reason: null,
    score: 96,
    sectionCount: 10,
    hashtagCount: 3,
    totalLength: 4000,
    coveredProductTokens: ["바디드라이어"],
    missingProductTokens: [],
    signals: [{ key: "composition-quality", label: "포스트 계약 품질", status: "pass" }],
    summary: "검수 통과",
    blockers: [],
    quality: {
      score: 96,
      passScore: 70,
      categories: [],
      repetition: { nearDuplicateCount: 0, exactDuplicateCount: 0, duplicateOpeningCount: 0, samples: [] },
      generic: {
        sentenceCount: 10,
        guidanceCount: 0,
        generalStatementCount: 0,
        guidanceRatio: 0,
        generalRatio: 0,
        threshold: 0.24,
      },
    },
  };
}

async function buildReadyFixture(root: string): Promise<BrandPostPackageManifestV2> {
  const id = "reviewed-recovery-fixture";
  const packageDir = getBrandPostPackageDir(id);
  fs.mkdirSync(packageDir, { recursive: true });
  const markdownPath = path.join(packageDir, "post.md");
  fs.writeFileSync(markdownPath, "# 테스트 바디드라이어\n\n검증 가능한 정보로 작성한 쇼핑커넥트 원고입니다.", "utf8");

  const imageDir = path.join(root, "fixture-images");
  fs.mkdirSync(imageDir, { recursive: true });
  const heroPath = path.join(imageDir, "hero.png");
  const bodyPaths = Array.from({ length: 4 }, (_, index) => path.join(imageDir, `body-${index + 1}.png`));
  await Promise.all([
    makeImage(heroPath, 1080, 1080, "#dbeafe"),
    ...bodyPaths.map((file, index) => makeImage(file, 1200, 900,
      ["#e2e8f0", "#fef3c7", "#dcfce7", "#fce7f3"][index])),
  ]);

  const titles = [
    "샤워 뒤 물기 말리는 시간이 번거롭다면",
    "어떤 제품인지부터 보면",
    "냉온풍이 만드는 차이",
    "자동센서를 어떻게 봐야 할까",
    "욕실에서 쓰기 전 확인할 조건",
    "처음부터 제대로 쓰는 방법",
    "사용 환경에 따른 장단점",
    "비슷한 제품과 갈리는 기준",
    "관리할 때 확인할 부분",
    "구매 전 최종 선택 기준",
  ];
  const sections = titles.map((title, index) =>
    `${title}\n\n${`확인된 기능 ${index + 1}과 사용 조건을 연결해 구매 판단에 필요한 차이를 구체적으로 설명합니다. `.repeat(10)}`);
  const bindings = Object.fromEntries(titles.slice(0, 4).map((title, index) => [
    stableFreeformSectionId("SHOPPING", title), [bodyPaths[index]],
  ]));
  const composition = resolvePostDocument({
    connectKind: "SHOPPING",
    title: "테스트 바디드라이어",
    sections,
    imagePaths: [heroPath, ...bodyPaths],
    sectionImageBindings: bindings,
    hashtags: ["바디드라이어", "냉온풍", "자동센서"],
    connectUrl: "https://example.test/shopping",
    qualityPreset: "PREMIUM",
  });
  assert.equal(composition.qualityReport.canAutoPublish, true,
    `fixture composition must pass before image recovery: ${JSON.stringify(composition.qualityReport.blockers)}`);

  const manifest: BrandPostPackageManifestV2 = {
    version: "brand-post-package/v2",
    contractVersion: "post-composition-contract/v1",
    brandLinkId: id,
    connectKind: "SHOPPING",
    title: composition.title,
    generationSource: "AI",
    markdownPath,
    markdownSha256: hash(markdownPath),
    heroImagePath: heroPath,
    bodyImagePaths: bodyPaths,
    imageAssets: [heroPath, ...bodyPaths].map((file, index) => {
      const section = index === 0 ? undefined : composition.sections[index - 1];
      return {
        path: file,
        sourcePath: file,
        sha256: hash(file),
        role: index === 0 ? "hero" as const : "body" as const,
        sectionId: section?.id || null,
        imageIntent: section?.imageIntent || "제품이 한눈에 보이는 대표 이미지",
        slotId: section ? `${section.id}:image:1` : "hero:image:1",
        provenance: "GENERATED_BACKGROUND" as const,
        creationMethod: "remote-generated" as const,
        remoteGenerated: true,
      };
    }),
    hashtags: ["바디드라이어", "냉온풍", "자동센서"],
    imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    createdAt: "2026-09-15T00:00:00.000Z",
    approvedAt: null,
    contentQuality: passingContentQuality(),
    composition,
    thumbnailSpec: {
      version: "thumbnail-spec/v2",
      canvas: { width: 1080, height: 1080, aspect: "1:1" },
      style: "shopping-color-block",
      sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
      sourceImagePath: heroPath,
    },
  };
  writeBrandPostPackageManifest(manifest);
  const stored = readBrandPostPackage(id, { migrate: false });
  assert.ok(stored?.version === "brand-post-package/v2");
  const readiness = evaluateBrandPostPackageReadiness(stored);
  assert.equal(readiness.canApprove, true,
    `fixture must pass the shared gate: ${JSON.stringify(readiness.blockers)}`);
  return stored;
}

function staleTwoFeatureSlots(manifest: BrandPostPackageManifestV2): BrandPostPackageManifestV2 {
  const featureSections = manifest.composition.sections.slice(2, 4);
  assert.equal(featureSections.every((section) => !allowsGenericBrandPostProductPhoto({
    sectionTitle: section.title, imageIntent: section.imageIntent,
  })), true, "fixture targets must require feature evidence");
  const featureIds = new Set(featureSections.map((section) => section.id));
  return {
    ...manifest,
    imageAssets: normalizePackageImageAssets(manifest).map((asset) => featureIds.has(asset.sectionId || "")
      ? { ...asset, slotId: `${asset.sectionId}:image:99`, imageIntent: "구형 이미지 목적" }
      : asset),
  };
}

function reviewStub(paths: string[]) {
  return Promise.resolve({
    path: paths[0],
    sourceSha256: hash(paths[0]),
    reviewClass: "feature-evidence" as const,
    reason: "해당 슬롯의 기능과 조작부를 직접 보여주는 공식 판매자 이미지",
    reviewedAt: "2026-09-15T00:00:00.000Z",
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reviewed-product-recovery-"));
  process.env.DESKTOP_USER_DATA = path.join(root, "user-data");
  try {
    const ready = await buildReadyFixture(root);
    const originalBytes = [ready.heroImagePath, ...ready.bodyImagePaths].map((file) => fs.readFileSync(file));

    const noTargets = planReviewedProductImageRecovery(ready, []);
    assert.deepEqual(noTargets, [], "a healthy hero and healthy sections must never be recovery targets");
    [ready.heroImagePath, ...ready.bodyImagePaths].forEach((file, index) => {
      assert.deepEqual(fs.readFileSync(file), originalBytes[index], `planning must not alter healthy image ${index}`);
    });

    const stale = staleTwoFeatureSlots(ready);
    writeBrandPostPackageManifest(stale);
    const featureSections = stale.composition.sections.slice(2, 4);
    const backgrounds = [path.join(root, "feature-a-background.png"), path.join(root, "feature-b-background.png")];
    await Promise.all([
      makeImage(backgrounds[0], 1200, 900, "#e0f2fe"),
      makeImage(backgrounds[1], 1200, 900, "#f3e8ff"),
    ]);
    const jobs = featureSections.map((section, index) => ({
      outStem: backgrounds[index],
      prompt: `environment only\nImage slot: ${section.id}:image:1. Use a distinct viewpoint and subject detail for this slot.`,
    }));
    const targets = planReviewedProductImageRecovery(stale, jobs);
    assert.equal(targets.length, 2, "only the two stale feature slots may be targeted");
    assert.deepEqual(targets.map((target) => target.sectionId), featureSections.map((section) => section.id));
    assert.equal(targets.some((target) => target.role === "hero"), false, "a healthy hero must remain outside recovery");
    assert.equal(targets.every((target) => target.replaceAssetKey), true, "stale bindings must use exact SHA replacements");

    const genericSource = path.join(root, "one-generic-source.png");
    await makeSafeCutout(genericSource, [18, 88, 166], 54);
    await assert.rejects(
      reviewProductRecoverySources({
        targets,
        productName: stale.title,
        sourceBySlot: Object.fromEntries(targets.map((target) => [target.slotId, genericSource])),
      }, { review: reviewStub }),
      /RECOVERY_SOURCE_DUPLICATE/u,
      "one generic source cannot be repeated across two feature slots even if a reviewer claims it fits",
    );

    const sourcePaths = [path.join(root, "feature-a-source.png"), path.join(root, "feature-b-source.png")];
    await Promise.all([
      makeSafeCutout(sourcePaths[0], [18, 88, 166], 42),
      makeSafeCutout(sourcePaths[1], [146, 64, 14], 70),
    ]);
    const sourceMapFile = path.join(root, "recovery-sources.json");
    fs.writeFileSync(sourceMapFile, JSON.stringify({ sources: Object.fromEntries(
      targets.map((target, index) => [target.slotId, path.basename(sourcePaths[index])]),
    ) }), "utf8");
    const sourceBySlot = parseProductRecoverySourceMap(sourceMapFile, targets);
    const reviewedTargets = await reviewProductRecoverySources({
      targets,
      productName: stale.title,
      sourceBySlot,
    }, { review: reviewStub });
    assert.equal(new Set(reviewedTargets.map((target) => target.sourceReview.sourceSha256)).size, 2,
      "feature slots must carry distinct reviewed source bytes");
    assert.equal(reviewedTargets.every((target) => target.sourceReview.reviewClass === "feature-evidence"), true);

    for (const [index, target] of reviewedTargets.entries()) {
      const rendered = await renderReviewedProductRecoveryTarget({
        target,
        outputDir: path.join(root, "rendered"),
        productName: stale.title,
        variant: index,
      });
      const receipt = readProductPhotoSource(rendered.outputPath);
      assert.equal(receipt?.sourceSha256, target.sourceReview.sourceSha256,
        "the composite receipt must point to the exact reviewed source bytes");
      const metadata = reviewedProductRecoveryApplyMetadata(target);
      assert.deepEqual(classifyBrandPostImageEvidence(metadata), { coherent: true, generated: true, reason: null });
      applyGeneratedBrandPostImage({ brandLinkId: stale.brandLinkId, generatedPath: rendered.outputPath, ...metadata });
    }

    const recovered = readBrandPostPackage(stale.brandLinkId, { migrate: false });
    assert.ok(recovered?.version === "brand-post-package/v2");
    const approval = evaluateBrandPostPackageReadiness(recovered);
    assert.equal(approval.canApprove, true,
      `distinct reviewed feature sources must pass the shared strict gate: ${JSON.stringify(approval.blockers)}`);
    assert.equal(approval.imageSlots.every((slot) => slot.missing === 0 && slot.staleTargets.length === 0), true);

    const healthyPaths = [ready.heroImagePath, ...ready.bodyImagePaths.slice(0, 2)];
    healthyPaths.forEach((file, index) => {
      assert.deepEqual(fs.readFileSync(file), originalBytes[index], `healthy image bytes changed at index ${index}`);
    });
    assert.equal(recovered.heroImagePath, ready.heroImagePath, "healthy hero binding must remain unchanged");
    assert.deepEqual(recovered.bodyImagePaths.slice(0, 2), ready.bodyImagePaths.slice(0, 2),
      "healthy section bindings must remain unchanged");

    const recoveredAssets = normalizePackageImageAssets(recovered);
    for (const target of reviewedTargets) {
      const asset = recoveredAssets.find((candidate) => candidate.slotId === target.slotId);
      assert.equal(asset?.sourceReview?.sourceSha256, target.sourceReview.sourceSha256);
      assert.equal(asset?.sourceReview?.sectionIntent, target.imageIntent);
      assert.equal(asset?.sourceReview?.reviewClass, "feature-evidence");
    }
    assert.ok(fs.existsSync(getBrandPostPackageDir(stale.brandLinkId)));
    console.log("PASS healthy-target exclusion, duplicate feature-source refusal, distinct source recovery and strict approval");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

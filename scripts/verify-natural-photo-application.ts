/** Whole default photo set: offline files, no image generation or live publication. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { applyGeneratedBrandPostImage, getBrandPostImageSlots, getBrandPostPackageManifestPath,
  writeBrandPostPackageManifest, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { resolvePostDocument } from "../src/lib/post-composition-contract";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { preserveProductPhotoSource } from "./lib/product-photo-provenance";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "natural-photo-apply-"));
  const previousRoot = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  try {
    const file = async (name: string, color: string) => {
      const destination = path.join(root, name);
      await sharp({ create: { width: 1080, height: 1080, channels: 3, background: color } }).png().toFile(destination);
      return destination;
    };
    const source = await file("source.png", "#d9b8a6"), hero = await file("hero.png", "#bfdce3");
    preserveProductPhotoSource({ sourcePath: source, outputPath: hero, segmented: false, provenance: "PHOTO_TEXT_THUMBNAIL" });
    const composition = resolvePostDocument({ connectKind: "SHOPPING", title: "바지 핏 선택 기준",
      sections: Array.from({ length: 6 }, (_, index) => `선택 기준 ${index + 1}\n\n판매정보에서 확인한 조건을 설명합니다.`),
      hashtags: ["바지"], imagePaths: [hero], connectUrl: "https://example.test/selected" });
    const markdownPath = path.join(root, "article.md");
    fs.writeFileSync(markdownPath, "변경하지 않을 원문");
    const sourceSnapshot = createProductSnapshot({ productId: "natural-set", connectKind: "SHOPPING", externalProductId: "pants",
      sourceUrl: "https://example.test/pants", product: { name: "선택한 바지" } });
    let manifest: BrandPostPackageManifestV2 = {
      version: "brand-post-package/v2", contractVersion: "post-composition-contract/v1", brandLinkId: "natural-set", connectKind: "SHOPPING",
      title: composition.title, generationSource: "AI", markdownPath, heroImagePath: hero, bodyImagePaths: [], composition, sourceSnapshot,
      createdAt: new Date().toISOString(), approvedAt: null, hashtags: ["바지"], imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
      imageRequirements: { policy: "generated-required" }, imageAssets: [{ path: hero, sourcePath: hero, sha256: hash(hero), role: "hero",
        provenance: "PHOTO_TEXT_THUMBNAIL", creationMethod: "local-composite", remoteGenerated: false }],
      thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1080, height: 1080, aspect: "1:1" }, style: "shopping-bold",
        sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", sourceImagePath: hero },
    };
    writeBrandPostPackageManifest(manifest);
    const original = composition.sections.find(section => section.imageSource === "seller-original")!;
    const scenes = composition.sections.filter(section => section.imageSource === "staged-ai");
    const before = fs.readFileSync(getBrandPostPackageManifestPath(manifest.brandLinkId), "utf8");
    const card = await file("shopping-fact-card-obsolete.png", "#fffabb");
    assert.throws(() => applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, sectionId: scenes[0].id, generatedPath: card,
      provenance: "EDITORIAL_CARD", creationMethod: "local-composite" }), /IMAGE_FORMAT_OBSOLETE/);
    assert.throws(() => applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, sectionId: scenes[0].id, generatedPath: hero,
      provenance: "ORIGINAL", creationMethod: "source" }), /IMAGE_FORMAT_OBSOLETE/, "renamed thumbnail receipt still prevents body insertion");
    assert.throws(() => applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, sectionId: scenes[0].id, generatedPath: source,
      provenance: "ORIGINAL", creationMethod: "source" }), /IMAGE_NATURAL_PHOTO_ROLE/);
    assert.equal(fs.readFileSync(getBrandPostPackageManifestPath(manifest.brandLinkId), "utf8"), before, "rejected formats cannot mutate the draft");
    manifest = applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, sectionId: original.id, generatedPath: source,
      provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false, sourceReview: {
        version: "product-photo-source-review/v1", sourceSha256: hash(source), usage: "section-matched-product-evidence",
        sectionIntent: original.imageIntent, reviewClass: "product-photo", reason: "offline source identity fixture", reviewedAt: new Date().toISOString(),
      } });
    for (const [index, section] of scenes.entries()) {
      const output = await file(`scene-${index}.png`, ["#b4bfca", "#dacbea", "#debcaa"][index]);
      manifest = applyGeneratedBrandPostImage({ brandLinkId: manifest.brandLinkId, sectionId: section.id, generatedPath: output,
        provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true, imageIntent: section.imageIntent,
        referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, referencePath: source, referenceSha256: hash(source),
          sourceSnapshotId: sourceSnapshot.snapshotId, reviewStatus: "passed", reviewedOutputSha256: hash(output),
          checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) },
      });
    }
    const slots = getBrandPostImageSlots(manifest);
    assert.equal(slots.reduce((sum, slot) => sum + slot.missing + slot.generationMissing, 0), 0, "original one and AI three must reach completion");
    assert.equal(slots.reduce((sum, slot) => sum + slot.originalCount, 0), 1);
    assert.equal(slots.reduce((sum, slot) => sum + slot.generatedCount, 0), 3);
    assert.equal(manifest.bodyImagePaths.length, 4);
    const nodes = manifest.composition.renderNodes;
    const originalPhoto = nodes.findIndex(node => node.kind === "image" && node.sectionId === original.id);
    const originalHeading = nodes.findIndex(node => node.kind === "heading" && node.sectionId === original.id);
    assert(originalPhoto < originalHeading && originalPhoto >= 0, "the original precedes the first heading");
    assert.equal(nodes[originalPhoto].kind === "image" && nodes[originalPhoto].caption, "판매페이지 원본 상품 사진");
    for (const section of scenes) {
      const imageIndex = nodes.findIndex(node => node.kind === "image" && node.sectionId === section.id);
      const paragraphIndex = nodes.findLastIndex(node => node.kind === "paragraph" && node.sectionId === section.id);
      assert(imageIndex > paragraphIndex, "lifestyle photo follows its section text");
      assert.equal(nodes[imageIndex].kind === "image" && nodes[imageIndex].caption, REFERENCE_SCENE_CAPTION);
    }
    assert.equal(fs.readFileSync(markdownPath, "utf8"), "변경하지 않을 원문");
    console.log("PASS natural photo application: original one + AI three complete, role/format rejection before mutation, source/AI captions and actual render order");
  } finally {
    if (previousRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousRoot;
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

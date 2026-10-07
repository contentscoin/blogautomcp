import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prepareImagePool, assignImageSlots } from "./lib/post-spec/image-plan";
import { applyShoppingNaturalPhotoPlan, resolvePostDocument, refreshPostDocumentQuality } from "../src/lib/post-composition-contract";
import { shoppingPhotoRoleAt, SHOPPING_POST_STRATEGY } from "../src/lib/shopping-post-strategy";
import { replanShoppingImageCoverage, type ImageReplanDependencies } from "../src/lib/brand-post-image-replan";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";

async function main() {
  for (const count of [5, 6, 7, 8]) {
    const roles = Array.from({ length: count }, (_, index) => shoppingPhotoRoleAt(index, count));
    assert.equal(roles.filter(role => role === "original").length, 1);
    assert.equal(roles.filter(role => role === "scene").length, 3);
    assert.equal(roles[0], "original");
    assert.equal(roles[1], "scene");
    assert.equal(roles.at(-1), "scene");
  }
  const doc = resolvePostDocument({ connectKind: "SHOPPING", title: "선택한 바지의 핏과 코디",
    sections: Array.from({ length: 6 }, (_, index) => `설명 ${index + 1}\n\n${"판매페이지에서 확인한 상품 조건을 설명합니다. ".repeat(10)}`),
    hashtags: ["바지"], imagePaths: ["thumbnail.png"], connectUrl: "https://naver.me/fixture", qualityPreset: "PREMIUM" });
  assert.equal(doc.strategyVersion, "shopping-post-strategy/v2");
  assert.equal(doc.qualityReport.imageCoverage.requiredSlots, 5);
  assert.equal(doc.qualityReport.imageCoverage.missingSectionIds.length, 4);
  assert.equal(doc.qualityReport.canAutoPublish, false);
  assert.equal(refreshPostDocumentQuality({ ...doc, imageFloor: 3 }).qualityReport.target.images.min, 5);
  const planned = applyShoppingNaturalPhotoPlan(doc.sections);
  assert.deepEqual(planned.map(section => section.imageSource), ["seller-original", "staged-ai", "none", "staged-ai", "none", "staged-ai"]);
  assert.equal(planned[0].imagePlacement, "before-heading");
  assert(planned.filter(section => section.imageSource === "staged-ai").every(section => section.imagePlacement === "after-body"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shopping-photo-plan-"));
  try {
    const original = path.join(root, "original.png");
    const another = path.join(root, "other-original.png");
    const card = path.join(root, "shopping-fact-card-fixture.png");
    const crop = path.join(root, "seller_detail_crop.png");
    for (const [index, file] of [original, another, card, crop].entries()) {
      await sharp({ create: { width: 720, height: 720, channels: 3, background: ["#aabbcc", "#bbccdd", "#ccddee", "#ddeeff"][index] } }).png().toFile(file);
    }
    const pool = await prepareImagePool({ kind: "SHOPPING", minBody: 4, targetBody: 4, tempDir: root,
      candidates: [{ path: original, kind: "hero" }, { path: another, kind: "source" }, { path: card, kind: "card" }, { path: crop, kind: "crop" }] });
    assert.deepEqual(pool.body.map(image => image.path), [original], "multiple seller images cannot fill the three AI scene slots");
    assert(pool.body.every(image => image.strategy === "source"));
    assert(!fs.readdirSync(root).some(file => file.startsWith("collage_")), "no collage is produced to satisfy an image shortfall");
    const imagePlan = assignImageSlots(pool, planned.map((section, index) => ({ index,
      imageCount: [section.imageMin!, section.imageMax!] as [number, number], imageIntent: section.imageIntent })), "SHOPPING", 4, 4);
    assert.equal(imagePlan.resolvedBody, 1);
    assert.equal(imagePlan.shortfall, 3);
    assert.equal(imagePlan.slots[0].sectionIndex, 0);
    const rejected = await prepareImagePool({ kind: "SHOPPING", minBody: 4, targetBody: 4, tempDir: root,
      candidates: [{ path: card, kind: "card" }, { path: crop, kind: "crop" }] });
    assert.equal(rejected.body.length, 0, "cards and detail crops cannot stand in for the original full photograph");
    assert(rejected.notes.some(note => note.includes("needs_reference")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const fixture = { version: "brand-post-package/v2", brandLinkId: "natural-policy", connectKind: "SHOPPING",
    imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", composition: doc } as BrandPostPackageManifestV2;
  let repairs = 0;
  let writes = 0;
  const result = await replanShoppingImageCoverage({ brandLinkId: fixture.brandLinkId }, {
    read: () => fixture,
    slots: () => [{ minimum: 1, missing: 1, generationMissing: 1 }],
    repair: async () => { repairs++; return { errors: [] }; },
    write: () => { writes++; return fixture; },
  } as unknown as ImageReplanDependencies);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "REPLAN_NATURAL_PHOTOS_REQUIRED");
  assert.equal(repairs, 0);
  assert.equal(writes, 0, "a failed scene cannot silently lower the current policy or replace it with an original");
  assert.equal(SHOPPING_POST_STRATEGY.bodyPhotos.total + SHOPPING_POST_STRATEGY.thumbnailCount, 5);
  console.log("PASS shopping natural photo plan: original1 + distinct scenes3 + thumbnail1, distributed placement, no card/collage/repeated-original fallback, explicit missing state");
}

main().catch(error => { console.error(error); process.exitCode = 1; });

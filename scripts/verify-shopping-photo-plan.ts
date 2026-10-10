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
  const planned = applyShoppingNaturalPhotoPlan(doc.sections, { productName: "와이드 팬츠" });
  assert.deepEqual(planned.map(section => section.imageSource), ["seller-original", "staged-ai", "none", "staged-ai", "none", "staged-ai"]);
  assert.equal(planned[0].imagePlacement, "before-heading");
  assert(planned.filter(section => section.imageSource === "staged-ai").every(section => section.imagePlacement === "after-body"));
  const unchangedSections = JSON.stringify(doc.sections);
  const sceneRecipes = (sections: typeof doc.sections) => sections.filter(section => section.imageSource === "staged-ai").map(section => section.promptRecipe!);
  assert(sceneRecipes(planned).every(recipe => /의류|핏|기장/u.test(recipe)), "real clothing retains its complete outfit, fit and garment-length direction");
  const earphones = applyShoppingNaturalPhotoPlan(doc.sections, { productName: "[샥즈] 오픈런 프로 2 미니 S821 골전도 스포츠 런닝 이어폰" });
  for (const recipe of sceneRecipes(earphones)) {
    assert.doesNotMatch(recipe, /코디|핏|기장|앉거나 쉬/u, "an earphone cannot inherit apparel scene/fit instructions even when section prose mentions clothing");
    assert.match(recipe, /전체.*(?:제품|형상|윤곽)/u);
    assert.match(recipe, /전체 연결 구조/u);
    assert.match(recipe, /핵심 구조를 가리지/u);
    assert.match(recipe, /착용이나 사용 동작은 필요하지 않음/u);
    assert.match(recipe, /기능·수치·성능·효과의 증거 또는 실제 사용 후기 장면이 아님/u);
  }
  assert.equal(new Set(sceneRecipes(earphones)).size, 3, "non-apparel scenes retain three distinct photographic directions");
  for (const productName of ["셔츠용 옷걸이", "니트 세탁 세제", "스포츠 이어폰과 티셔츠 코디", "의류 관리기", "패딩 가방", "패딩 파우치", "레깅스 세탁망", "바지 집게", "니트릴 장갑", "쿠쿠 음식물처리기", "선택 상품"]) {
    assert(sceneRecipes(applyShoppingNaturalPhotoPlan(doc.sections, { productName })).every(recipe => !/코디|핏|기장/u.test(recipe)),
      `only a clothing product receives the garment recipe: ${productName}`);
  }
  for (const productName of ["차콜 와이드 팬츠", "반팔 티셔츠", "롱 원피스", "바람막이 재킷", "cotton T-shirt"]) {
    assert(sceneRecipes(applyShoppingNaturalPhotoPlan(doc.sections, { productName })).every(recipe => /의류|핏|기장/u.test(recipe)),
      `selected apparel retains clothing-specific preservation: ${productName}`);
  }
  assert(sceneRecipes(applyShoppingNaturalPhotoPlan(doc.sections)).every(recipe => !/코디|핏|기장/u.test(recipe)), "missing selected identity defaults to neutral whole-product photography");
  assert.equal(JSON.stringify(doc.sections), unchangedSections, "the recipe producer never mutates its source sections or an existing saved plan");
  const namedEarphoneDoc = resolvePostDocument({ connectKind: "SHOPPING", title: "티셔츠 코디와 함께 생각해볼 선택 기준",
    productName: "샥즈 오픈런 프로 2 미니 S821 이어폰", sections: ["외형\n전체 구조를 확인합니다.", "선택\n코디와 함께 사용할 수 있습니다.", "장면\n생활 공간에 배치합니다.", "조건\n판매 조건을 확인합니다.", "정리\n확인된 정보로 고릅니다."],
    hashtags: ["샥즈"], imagePaths: ["thumbnail.png"], connectUrl: "https://naver.me/fixture" });
  assert(sceneRecipes(namedEarphoneDoc.sections).every(recipe => !/코디|핏|기장/u.test(recipe)), "the selected product overrides a clothing mention in the article title");
  assert(sceneRecipes(doc.sections).every(recipe => /의류|핏|기장/u.test(recipe)), "the normal resolve path classifies an explicit clothing title when no separate product name exists");

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

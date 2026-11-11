/** Offline first-generation contracts. No product files, provider or model calls. */
import assert from "node:assert/strict";
import { buildProduct9Canvas } from "./lib/product-9canvas";
import { buildGenerationFirstPhotoBrief } from "./lib/generation-first-photo-brief";
import { buildShoppingPhotoHarness } from "./lib/shopping-photo-harness";
import { buildProductThumbnailGenerationPrompt, inferScenePrompt } from "./lib/product-thumbnail";

const productName = "상주곶감 건시 반건시 선물세트";
const canvas = buildProduct9Canvas({ name: productName, features: ["선택 옵션: 반건시 1.2kg", "보관 방법: 냉동 보관"],
  description: "판매자 광고 문구는 검증된 촬영 사실이 아닙니다." });
const base = { productName, sectionTitle: "보관 장소와 고를 때 확인할 점", imageIntent: "자연스러운 생활 공간 사진",
  role: "body" as const, productUnderstanding: canvas, plannedBodyImageCount: 6 };
const slots = Array.from({ length: 6 }, (_, variantIndex) => buildGenerationFirstPhotoBrief({ ...base, variantIndex }));
assert.equal(new Set(slots.map(slot => slot.photoGoal)).size, 6, "six existing body slots receive distinct photographic jobs");
assert.deepEqual(slots.map(slot => slot.bodySlotOrdinal), [1, 2, 3, 4, 5, 6]);
assert.ok(slots.every(slot => slot.plannedBodyImageCount === 6 && slot.deliverable === "one-body-photo"));
assert.match(slots[0].countPolicy, /existing composition plan.*one slot only.*never authorizes extra images/u);
assert.equal(slots[0].productContext?.selectedOption.explicitFeatureLabel, "반건시 1.2kg");
assert.match(slots[0].productContext!.selectedOption.basis, /not a confirmed purchase or included set/u);
assert.deepEqual(slots[0].productContext?.sellerFactsForContextOnly, ["선택 옵션: 반건시 1.2kg", "보관 방법: 냉동 보관"]);
assert.doesNotMatch(JSON.stringify(slots[0].productContext), /판매자 광고/u);

// Catalog alternatives, unrelated saved products and broken evidence links never
// turn into a chosen colour, purchased bundle or new photographic requirement.
const ambiguous = buildGenerationFirstPhotoBrief({ ...base,
  productUnderstanding: buildProduct9Canvas({ name: productName }) });
assert.equal(ambiguous.productContext?.selectedOption.status, "ambiguous");
assert.equal(ambiguous.productContext?.selectedOption.explicitFeatureLabel, null);
const different = buildGenerationFirstPhotoBrief({ ...base, productUnderstanding: buildProduct9Canvas({ name: "선풍기", features: ["선택 옵션: 화이트"] }) });
assert.equal(different.productContext, null);
const corrupt = structuredClone(canvas);
corrupt.claim.find(claim => claim.text === "선택 옵션: 반건시 1.2kg")!.evidenceIds = ["missing-evidence"];
corrupt.claim.push({ ...corrupt.claim.find(claim => claim.text === "보관 방법: 냉동 보관")!, id: "forged-feature", text: "미확인 9개 구성" });
const filtered = buildGenerationFirstPhotoBrief({ ...base, productUnderstanding: corrupt });
assert.deepEqual(filtered.productContext?.sellerFactsForContextOnly, ["보관 방법: 냉동 보관"]);
for (const count of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(buildGenerationFirstPhotoBrief({ ...base, plannedBodyImageCount: count }).plannedBodyImageCount, null);
}
assert.equal(buildGenerationFirstPhotoBrief({ ...base, plannedBodyImageCount: 0 }).plannedBodyImageCount, 0);

// The real harness consumes the brief without flattening seller observations
// into instructions or requiring unseen product details for a new composition.
const source = { sha256: "a".repeat(64), subject: "one sealed selected tray", geometry: "sealed tray with selected food visible",
  labels: "large source logo; lower tiny print unreadable", viewObservation: { subjectState: "packaged" as const,
    cameraView: "front" as const, geometryVisibility: "partial" as const, hiddenParts: ["sealed contents"],
    intrinsicPrint: "unreadable" as const, readableIdentifiers: [] } };
const prompt = buildShoppingPhotoHarness({ ...base, reference: source, variantIndex: 4 });
const line = prompt.split("\n").find(row => row.startsWith("CATEGORY SHOT PLAN"))!;
const plan = JSON.parse(line.slice(line.indexOf(": ") + 2));
assert.equal(plan.generationBrief.photoGoal, slots[4].photoGoal);
assert.equal(plan.generationBrief.plannedBodyImageCount, 6);
assert.equal(plan.generationBrief.bodySlotOrdinal, 5);
assert.deepEqual(plan.generationBrief.productContext, slots[4].productContext);
assert.equal(plan.generationBrief.countPolicy, undefined, "the harness sends shared rules once rather than another repeated rule pack");
assert.equal(plan.viewConstraint.subjectState, "packaged");
assert.match(prompt, /Keep actual readable identifiers; never guess tiny unreadable print/u);
assert.match(prompt, /Do not demand invented microscopic seams/u);
assert.match(prompt, /No explanatory text, editorial information card, original-photo explanation frame, collage, inset product photo/u);
assert.match(prompt, /AI photograph is illustrative, never actual performance/u);

// Finished thumbnails keep their sole headline over the whole photograph,
// without the category defaults inventing operation, hidden shape or kit items.
const thumbnail = buildProductThumbnailGenerationPrompt({ productName, postTitle: "선물세트 고르는 기준", productUnderstanding: canvas });
assert.match(thumbnail.prompt, /at most two lines.*never shrink the product into an inset/u);
assert.match(thumbnail.prompt, /120 x 120 and 240 x 240/u);
assert.doesNotMatch(thumbnail.prompt, /Preserve its full silhouette, garment waistband and hems/u);
assert.match(thumbnail.prompt, /"explicitFeatureLabel":"반건시 1.2kg"/u);
assert.doesNotMatch(inferScenePrompt("청소기", "로봇청소기"), /in use/u);
assert.match(inferScenePrompt("의류", "니트용 보풀제거기"), /fabric shaver at rest/u);
assert.match(inferScenePrompt("식품", "선물 식품"), /keep sealed packages sealed/u);
assert.doesNotMatch(inferScenePrompt("의류", "와이드 팬츠"), /full garment silhouette visible/u);
console.log("PASS generation-first photo brief: planned slot coverage, source-scoped 9Canvas, conservative pixels and large photographic thumbnail; provider calls 0");

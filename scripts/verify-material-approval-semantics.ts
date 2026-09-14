import assert from "node:assert/strict";
import { containsProductToken, getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { assessProductEditorialCoverage, assessProductReviewSubstance, buildProductReviewAnalysis } from "./lib/product-editorial-plan";
import { applyFreeformDraftRevision, applyFreeformSectionRevision, requestsFreeformTitleRevision } from "./lib/freeform-draft-revision";

const productName = "미라클뮤즈아하바하메디크림";
const titled = getBrandLinkContentReadiness({
  productName,
  title: "미라클뮤즈 아하바하메디크림 선택 전에 볼 정보",
  sections: ["제품 소개\n\n미라클뮤즈 아하바하메디크림의 제공된 상품 정보를 정리합니다.", "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로 수수료를 제공받습니다."],
  hashtags: ["미라클뮤즈", "메디크림", "쇼핑커넥트"],
  brandLink: "https://naver.me/fixture", generationSource: "AI", hasRepresentativeImage: true,
});
assert.equal(titled.signals.find((signal) => signal.key === "product-title")?.status, "pass");
assert.equal(titled.signals.find((signal) => signal.key === "product-body")?.status, "pass");
assert.equal(titled.blockers.some((blocker) => blocker.code === "missing-product-name"), false);
assert.equal(titled.canPublish, false, "Identity equivalence does not waive structure or quality requirements");
assert.equal(containsProductToken("미라클뮤즈 아하바하메디크림", productName), true);
assert.equal(containsProductToken("미라클뮤즈 다른메디크림", productName), false);
assert.equal(containsProductToken("AO-20L", "AO-16L"), false);
assert.equal(containsProductToken("ＡＯ-１６Ｌ", "ao-16l"), true);

const fact = "분리형 칸막이를 갖춘 수납함입니다.";
const benefit = "이 구조 덕분에 작은 물건을 나눠 보관하기 수월해요.";
const assessBoundary = (sections: string[]) => getBrandLinkContentReadiness({
  productName: "테스트 수납함", title: "테스트 수납함 구성",
  sections: [...sections, "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로 수수료를 제공받습니다."],
  sourceFeatures: ["분리형 칸막이"], hashtags: ["수납함", "칸막이", "정리"],
  brandLink: "", generationSource: "AI", hasRepresentativeImage: true,
});
const linkage = (sections: string[]) => assessBoundary(sections).quality.categories.find((category) => category.key === "sceneLinkage")!;
assert.equal(linkage([`정리할 때\n\n${fact}\n${benefit}`]).status, "pass", "The gate preserves adjacent fact-to-benefit prose");
assert.equal(linkage([`정리할 때\n\n${fact}\n\n${benefit}`]).status, "fail", "An unrelated paragraph cannot supply evidence");
assert.equal(linkage([`분리형 칸막이\n\n${benefit}`]).status, "fail", "A heading cannot supply evidence");

const foodName = "대용량 갈비살 1kg 소갈비살 늑간살 소고기 구이 캠핑 음식";
const nameOnlyFood = buildProductReviewAnalysis({ productName: foodName, targetSectionCount: 8 });
assert.equal(nameOnlyFood.evidenceLevel, "sparse", "Recognizing food from a title does not manufacture source evidence");
assert.equal(nameOnlyFood.verifiedSignals.length, 0);
const food = buildProductReviewAnalysis({
  productName: foodName,
  features: ["중량: 1kg", "원재료: 소갈비살"],
  targetSectionCount: 8,
});
assert.equal(food.category, "food");
assert.ok(food.verifiedSignals.includes("1kg"));
assert.ok(food.verifiedSignals.includes("소갈비살"));
assert.equal(food.verifiedSignals.some((signal) => /설치|작동|맥락|배터리/u.test(signal)), false);
const appliance = buildProductReviewAnalysis({ productName: "아이닉 에어프라이어 16L", description: "갈비살 소고기 구이 조리용 기기", targetSectionCount: 8 });
assert.notEqual(appliance.category, "food", "Food mentioned in an appliance description is not the product category");
const shallowFacts = ["색상: 흰색", "소재: 플라스틱"];
const shallowFan = buildProductReviewAnalysis({ productName: "테스트 선풍기", features: shallowFacts, targetSectionCount: 8 });
const shallowGeneric = buildProductReviewAnalysis({ productName: "테스트 생활용품", features: shallowFacts, targetSectionCount: 8 });
assert.equal(shallowFan.category, "fan");
assert.equal(shallowFan.evidenceLevel, "sparse", "A category inferred from the product name must not manufacture evidence");
assert.equal(shallowFan.evidenceLevel, shallowGeneric.evidenceLevel, "Identical shallow facts must receive the same evidence-density grade across categories");
assert.equal(shallowFan.verifiedSignals.some((signal) => /공기\s*순환|팬/u.test(signal)), false);
const shallowFanWithMarketing = buildProductReviewAnalysis({
  productName: "테스트 선풍기",
  description: "일상을 더 편리하게 만들어주는 제품",
  features: shallowFacts,
  targetSectionCount: 8,
});
assert.equal(shallowFanWithMarketing.evidenceLevel, "sparse", "Generic marketing copy must not increase the source-evidence grade");
assert.deepEqual(shallowFanWithMarketing.verifiedSignals, shallowFan.verifiedSignals, "Marketing copy must not enter verified product signals");
const foodSections = [
  "구이 메뉴를 준비할 때\n\n갈비살 1kg 구성은 구이 식재료를 한 묶음으로 준비하려는 사람에게 적합해요. 소갈비살 부위를 찾는 사람에게도 잘 맞습니다.",
  "표시 중량의 의미\n\n갈비살은 1kg 구성입니다. 이 구성 덕분에 식사 계획에 맞춰 필요한 양을 소분하기 수월해요.",
  "조리와 보관\n\n갈비살은 먹을 분량을 나눠 조리합니다. 남길 양을 정해 보관하면 한꺼번에 구워 놓는 부담을 줄일 수 있어요. 보관 조건과 소비기한은 이 자료에 제공되지 않았습니다.",
  "선택 기준\n\n갈비살 구이를 계획하고 1kg 구성이 필요한 경우라면 후보가 됩니다. 맛과 식감에 대한 직접 먹은 후기는 제공되지 않았습니다.",
];
const foodSubstance = assessProductReviewSubstance({
  productName: foodName,
  sections: foodSections,
  sourceFeatures: ["중량: 1kg", "원재료: 소갈비살"],
});
assert.equal(foodSubstance.pass, true, foodSubstance.missingElements.join(", "));
assert.ok(foodSubstance.evidenceJudgementCount >= 2);
assert.equal(assessProductEditorialCoverage(foodSections, foodName).missingCoreRoles.length, 0);
const weakFood = assessProductReviewSubstance({ productName: foodName, sections: ["구매 전 확인\n\n가격을 확인하세요. 다른 제품과 비교해보세요. 상품 상세를 살펴보세요."] });
assert.equal(weakFood.pass, false);
assert.equal(weakFood.evidenceJudgementCount, 0);

const draft = { title: "기존 글 제목", sections: ["호텔 객실\n\n기존 객실 본문", "시티투어\n기존 관광 본문"] };
const original = JSON.stringify(draft);
assert.deepEqual(applyFreeformDraftRevision(draft, '{"title":"새 글 제목","updates":[]}', [], { allowTitleChange: true }), { ...draft, title: "새 글 제목" });
const revision = applyFreeformDraftRevision(draft, '{"title":"새 글 제목","updates":[{"index":0,"body":"새 객실 본문"}]}', [0], { allowTitleChange: true });
assert.deepEqual(revision.sections, ["호텔 객실\n\n새 객실 본문", draft.sections[1]]);
assert.equal(JSON.stringify(draft), original, "Revision is atomic and does not mutate the saved draft");
assert.deepEqual(applyFreeformSectionRevision(draft.sections, '{"updates":[{"index":1,"body":"새 관광 본문"}]}', [1]), [draft.sections[0], "시티투어\n새 관광 본문"]);
for (const response of ['{"title":"승인되지 않은 제목"}', '{"updates":[{"index":0,"body":"범위 밖"}]}', '{"updates":[{"index":1,"body":"## 새 소제목"}]}', '{"updates":[null]}']) {
  assert.throws(() => applyFreeformDraftRevision(draft, response, [1]));
}
assert.throws(() => applyFreeformDraftRevision(draft, '{"title":"잘못된\\n제목"}', [], { allowTitleChange: true }));
assert.equal(requestsFreeformTitleRevision("제목에 상품명을 반영하고 본문을 보강하세요"), true);
assert.equal(requestsFreeformTitleRevision("제목은 유지하고 본문 상품명을 반영하세요"), false);
assert.equal(requestsFreeformTitleRevision("제목은 변경하지 말고 본문만 수정하세요"), false);
assert.equal(requestsFreeformTitleRevision("제목에 상품명을 넣어주세요"), true);
assert.equal(requestsFreeformTitleRevision("원고의 사용 장면만 보강하세요"), false);
console.log("PASS: spaced product identity, paragraph evidence boundaries, food-specific source assessment, bounded title/body revision");

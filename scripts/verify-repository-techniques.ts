import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  assessProductEditorialCoverage,
  assessProductReviewSubstance,
  buildProductEditorialPlan,
  hasSufficientProductReviewEvidence,
  isMeaningfulProductEvidenceFeature,
  formatProductEditorialPlanForPrompt,
} from "./lib/product-editorial-plan";
import { hasSufficientVisualDraftEvidence } from "./lib/brandlink-image-readiness";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import {
  formatAdaptiveEditorialHarnessForPrompt,
  getAdaptiveEditorialProfile,
} from "./lib/adaptive-editorial-harness";

const product = {
  productName: "오아 타프 실링 팬 캠핑용 무선 선풍기",
  description: "타프 상부 설치와 무선 사용을 지원하는 캠핑용 실링 팬",
  features: ["무선 방식", "타프 걸이형", "3단 풍량"],
  price: "29,800원",
  targetSectionCount: 11,
};

const keywordOnlyFan = {
  productName: "샤크 유무선 올인원 저소음 스탠드형 탁상형 선풍기 써큘레이터 플렉스브리즈 FA200KR",
  description: "[샤크닌자] 샤크닌자 스마트스토어 생활 주방 가전 전문 미국 프리미엄 브랜드",
  features: ["휴대선풍기", "선풍기추천", "무선선풍기", "거실용선풍기", "가정용선풍기", "충전용선풍기", "여름가전"],
  targetSectionCount: 11,
};
assert.equal(hasSufficientProductReviewEvidence(keywordOnlyFan), false, "SEO 키워드만으로 상세 근거 충분 판정을 내리면 안 됩니다.");
assert.equal(isMeaningfulProductEvidenceFeature("무선선풍기"), false);
assert.equal(isMeaningfulProductEvidenceFeature("배터리 3,800mAh, 1단·회전 미사용 기준 최대 24시간"), true);

assert.equal(hasSufficientProductReviewEvidence({
  productName: "휴대용 LED 조명",
  description: "야외와 실내에서 밝기를 조절해 사용하는 충전식 조명",
  features: ["밝기 3단계"],
  targetSectionCount: 8,
}), true, "usable 텍스트 근거는 GPT 작성 단계로 전달해야 합니다.");
assert.equal(hasSufficientVisualDraftEvidence({
  connectKind: "SHOPPING",
  sourceImageCount: 20,
  materializedImageCount: 10,
  detailImageCount: 0,
}), true, "충분한 쇼핑 원본 이미지가 있으면 GPT가 시각 근거를 구조화할 수 있어야 합니다.");
assert.equal(hasSufficientVisualDraftEvidence({
  connectKind: "SHOPPING",
  sourceImageCount: 1,
  materializedImageCount: 1,
  detailImageCount: 0,
}), false, "대표 이미지 한 장만으로 제품 리뷰 근거가 충분하다고 판단하면 안 됩니다.");

for (const connectKind of ["SHOPPING", "TRAVEL"] as const) {
  const profile = getAdaptiveEditorialProfile(connectKind);
  assert.ok(profile.sourceCount >= 100, `${connectKind} 온톨로지 표본은 100건 이상이어야 합니다.`);
  assert.ok(profile.sectionRange.min < profile.sectionRange.preferred);
  assert.ok(profile.sectionRange.preferred <= profile.sectionRange.max);
  const adaptivePrompt = formatAdaptiveEditorialHarnessForPrompt(connectKind);
  assert.match(adaptivePrompt, /정확한 개수·제목·순서는 강제하지 않습니다/u);
  assert.match(adaptivePrompt, /먼저 상품 사실·이미지·미확인 정보를 분석/u);
  assert.doesNotMatch(adaptivePrompt, /아래 순서를 유지/u);
}

const runtimeSource = fs.readFileSync(path.join(__dirname, "simple-agent.ts"), "utf8");
assert.match(runtimeSource, /formatAdaptiveEditorialHarnessForPrompt/u);
assert.match(runtimeSource, /minimumBodySectionCount/u);
assert.match(runtimeSource, /maximumBodySectionCount/u);
assert.doesNotMatch(runtimeSource, /(?:본문을 정확히|sections는 정확히|아래 순서를 유지)/u);

const plan = buildProductEditorialPlan(product);
assert.equal(plan.framework, "source-backed-product-review-v3");
assert.equal(plan.sections.length, 11);
assert.equal(plan.sections[0]?.role, "review-hook");
assert.equal(plan.sections[3]?.role, "primary-strength");
assert.equal(plan.sections[7]?.role, "limitations");
assert.equal(plan.reviewAnalysis.category, "fan");
assert.match(plan.reviewAnalysis.primaryUse, /타프|천장/u);
assert.ok(plan.reviewAnalysis.strengths.some((item) => item.key === "upper-space-placement"));
assert.ok(plan.reviewAnalysis.limitations.some((item) => item.key === "battery-runtime"));
assert.ok(plan.reviewAnalysis.unresolvedFacts.some((item) => /배터리 지속시간/u.test(item)));

const analysisJson = JSON.stringify(plan.reviewAnalysis);
assert.doesNotMatch(
  analysisJson,
  /(?:예요|해요|돼요|있어요|좋아요|어려워요|맞아요)[.!]?/u,
  "분석 하네스에 발행 가능한 완성 문장을 저장하면 안 됩니다.",
);
assert.doesNotMatch(analysisJson, /"(?:identity|verdict|claim|basis)"/u);

const prompt = formatProductEditorialPlanForPrompt(plan);
assert.match(prompt, /문장 생성 금지 데이터/u);
assert.match(prompt, /표현을 복사하지 말고/u);
assert.doesNotMatch(prompt, /후보가 될 수 있지만/u);
assert.doesNotMatch(prompt, /보냉백/u);

const hairCarePlan = buildProductEditorialPlan({
  productName: "여행용 무선 미니 헤어 드라이기",
  description: "",
  features: ["무선", "미니"],
  targetSectionCount: 11,
});
assert.equal(hairCarePlan.reviewAnalysis.category, "hair-care");
assert.equal(hairCarePlan.reviewAnalysis.primaryUse, "휴대형 모발 건조·스타일링");
assert.doesNotMatch(JSON.stringify(hairCarePlan.reviewAnalysis), /(?:예요|해요|돼요|있어요)[.!]?/u);

const genericPlan = buildProductEditorialPlan({
  productName: "테스트 다목적 기기",
  description: "",
  features: [],
  targetSectionCount: 11,
});
assert.equal(genericPlan.reviewAnalysis.category, "generic");
assert.equal("identity" in genericPlan.reviewAnalysis, false);
assert.equal("verdict" in genericPlan.reviewAnalysis, false);
assert.doesNotMatch(JSON.stringify(genericPlan.reviewAnalysis), /(?:예요|해요|돼요|있어요)[.!]?/u);

const sectionBodies = [
  ["오아 타프 실링 팬은 캠핑 공간 위쪽에 거는 무선 선풍기라는 정체가 선명해요.", "바닥 자리를 비워 두면서 공기를 순환시키는 배치가 가장 큰 장점이에요.", "반대로 고정 지점과 배터리 시간이 맞지 않으면 장점을 살리기 어려워요.", "설치 호환성과 연속 사용시간이 맞는 캠핑 환경에서 우선 후보가 됩니다."],
  ["이 제품은 책상 위 직진풍보다 타프 상부의 넓은 공기 순환에 초점이 있어요.", "실링 팬 구조라 텐트 중앙이나 휴식 공간 위쪽 배치에 어울립니다.", "무선 방식은 콘센트 위치와 전원선 동선을 줄여 주는 구조예요.", "스탠드형 선풍기와는 설치 위치와 바람 방향에서 선택 기준이 달라집니다."],
  ["판매 정보에서 타프 걸이형, 무선 방식, 3단 풍량을 근거로 읽을 수 있어요.", "타프와 실링 팬 표기는 상부 설치 목적을 뒷받침합니다.", "3단 풍량은 상황에 따라 바람 세기를 나눌 수 있다는 제품 고유 기능이에요.", "소음 수치와 배터리 지속시간은 수집 정보에 없어 성능 판단에서 보류합니다."],
  ["가장 분명한 장점은 바닥과 테이블 면적을 차지하지 않는다는 점이에요.", "캠핑 장비가 많은 자리에서 상부 공간을 쓰면 이동 통로를 덜 방해합니다.", "팬의 위치가 높아 여러 좌석을 향한 공기 순환을 설계하기도 쉬워요.", "이 효익은 안전하게 걸 수 있는 타프 구조가 있을 때 성립합니다."],
  ["두 번째 장점은 무선 방식이 주는 배치 자유도예요.", "콘센트에서 먼 텐트 안쪽이나 야외 테이블 주변에도 설치 후보가 됩니다.", "전원선에 발이 걸리는 동선을 줄일 수 있어 캠핑 사용 맥락과 잘 맞아요.", "다만 실제 편의는 풍량별 배터리 지속시간이 충분할 때 완성됩니다."],
  ["타프 아래에서 여러 사람이 쉬는 장면에 오아 타프 실링 팬의 목적이 잘 드러나요.", "바닥 장비를 늘리지 않고 위쪽에서 바람을 나누려는 사용자에게 유리합니다.", "콘센트가 멀거나 전원선을 길게 끌기 어려운 야외 환경에도 방향이 맞아요.", "한 사람에게 강한 직진풍만 필요한 상황이라면 스탠드형이 더 실용적입니다."],
  ["비슷한 캠핑 선풍기와는 걸이 방식, 허용 하중, 풍량 단계를 먼저 비교해야 해요.", "무선 제품끼리는 최대 풍량보다 단계별 배터리 지속시간 차이가 중요합니다.", "수면 중 사용한다면 소음과 조작 방식도 제품 만족도를 크게 가릅니다.", "보관 부피와 무게까지 합쳐야 실제 캠핑 짐 구성에 맞는지 판단할 수 있어요."],
  ["아쉬운 점은 설치 장소의 규격에 따라 사용 가능 여부가 달라진다는 점이에요.", "고정부가 약하거나 걸이 방식이 맞지 않으면 실링 팬의 핵심 장점이 사라집니다.", "무선 구조는 충전시간과 연속 운전시간이라는 별도 제약도 생겨요.", "풍량과 소음 수치가 부족한 상태에서는 강풍이나 저소음을 장점으로 단정할 수 없습니다."],
  ["추천 대상은 타프 상부 공간을 활용하고 전원선 제약을 줄이려는 캠핑 사용자예요.", "비추천 대상은 고정 지점이 없거나 한 방향 강풍을 우선하는 사용자입니다.", "밤새 사용하는 경우 배터리와 소음이 기준을 충족해야 추천 범위에 들어갑니다.", "사용 환경이 다르면 같은 무선 실링 팬의 장점과 제약의 무게도 달라져요."],
  ["현재 표시 가격은 29,800원이며 설치와 무선 편의가 필요한지를 함께 봐야 해요.", "비슷한 가격대라면 걸이 안정성, 풍량 단계, 배터리 시간을 같은 기준으로 비교합니다.", "기능 수보다 캠핑 시간 동안 충전 없이 쓸 수 있는지가 체감 가치에 더 직접적이에요.", "가격이 낮아도 설치 호환성이 맞지 않으면 실제 활용도는 떨어집니다."],
  ["최종 리뷰에서는 상부 공간 활용과 무선 배치가 오아 타프 실링 팬의 선택 이유예요.", "반면 설치 규격과 배터리 지속시간은 구매 판단 전에 해결할 핵심 제약입니다.", "두 조건이 캠핑 환경에 맞으면 목적이 분명한 후보로 둘 수 있어요.", "상부 설치가 어렵거나 직진풍이 우선이면 다른 형태의 선풍기를 고르는 편이 맞습니다."],
];
const reviewSections = plan.sections.map((section, index) => `${section.title}\n\n${sectionBodies[index].join("\n")}\n`);
const reviewText = reviewSections.join("\n");

const coverage = assessProductEditorialCoverage(reviewSections);
assert.equal(coverage.missingCoreRoles.length, 0);
const substance = assessProductReviewSubstance({ productName: product.productName, sections: reviewSections });
assert.equal(substance.pass, true, substance.missingElements.join(", "));
assert.equal(substance.categoryMismatchTerms.length, 0);

const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";
const readiness = getBrandLinkContentReadiness({
  productName: product.productName,
  title: "캠핑용 실링팬 | 오아 타프 무선 선풍기 장단점",
  sections: [...reviewSections, disclosure],
  hashtags: ["오아선풍기", "타프팬", "실링팬", "캠핑선풍기", "무선선풍기"],
  brandLink: "https://naver.me/example",
  generationSource: "AI",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
});
assert.equal(readiness.canPublish, true, readiness.reason || readiness.summary);
assert.equal(readiness.signals.find((signal) => signal.key === "generation-source")?.status, "pass");

const localFallback = getBrandLinkContentReadiness({
  productName: product.productName,
  title: "캠핑용 실링팬 | 오아 타프 무선 선풍기 장단점",
  sections: [...reviewSections, disclosure],
  hashtags: ["오아선풍기", "타프팬", "실링팬"],
  brandLink: "https://naver.me/example",
  generationSource: "LOCAL_FALLBACK",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
});
assert.equal(localFallback.canPublish, false);
assert.equal(localFallback.code, "non-generative-fallback");

const contaminatedSections = reviewSections.map((section, index) =>
  index === 5 ? `${section}\n보냉백은 용량과 어깨끈, 식재료 수납을 확인해야 해요.` : section,
);
const contaminated = getBrandLinkContentReadiness({
  productName: product.productName,
  title: "캠핑용 실링팬 | 오아 타프 무선 선풍기 장단점",
  sections: [...contaminatedSections, disclosure],
  hashtags: ["오아선풍기", "타프팬", "실링팬"],
  brandLink: "https://naver.me/example",
  generationSource: "AI",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
});
assert.equal(contaminated.canPublish, false);
assert.equal(contaminated.code, "category-mismatch");

console.log(JSON.stringify({
  ok: true,
  framework: plan.framework,
  category: plan.reviewAnalysis.category,
  shoppingChars: reviewText.replace(/\s+/gu, "").length,
  readinessScore: readiness.score,
  localFallbackCode: localFallback.code,
  contaminatedCode: contaminated.code,
}, null, 2));

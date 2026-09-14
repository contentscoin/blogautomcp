import assert from "node:assert/strict";
import {
  assessTravelSourceEvidence,
  getBrandLinkContentReadiness,
  type BrandLinkContentReadiness,
} from "./lib/brandlink-content-readiness";
import {
  assessProductReviewSubstance,
  buildProductReviewAnalysis,
  buildProductScoringFeatures,
} from "./lib/product-editorial-plan";
import {
  formatQualityConvergenceInstructions,
  planQualityConvergence,
  qualityFailureSignature,
  selectQualityRepairSectionIndexes,
} from "./lib/quality-convergence";
import { assertUntargetedSectionHashesUnchanged } from "./lib/freeform-draft-revision";

const productName = "RNRN 러닝조끼 메쉬 남녀공용 러닝 베스트";
const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";
const sparseSections = [
  "상품 소개\n\nRNRN 러닝조끼는 러닝할 때 입는 제품입니다. 운동할 때 활용할 수 있어요. 구매 전에 옵션을 확인하세요.",
  "소재를 볼 때\n\n메쉬라는 상품명이 있습니다. 통기성이 좋을 수 있어요. 다른 제품과 비교해보세요.",
  "착용 방법\n\n티셔츠 위에 착용합니다. 사이즈를 확인하세요. 세탁 방법도 확인하세요.",
  "사용 장면\n\n여름 운동에 활용할 수 있습니다. 상황에 따라 편리할 수 있어요. 상세페이지를 살펴보세요.",
  "장점\n\n가볍고 편리한 것이 장점입니다. 운동하는 사람에게 유용해요. 선택에 도움이 됩니다.",
  "주의점\n\n사이즈가 맞지 않으면 불편할 수 있습니다. 사용 환경을 확인하세요. 옵션을 비교하세요.",
  "추천 대상\n\n러닝하는 사람에게 잘 맞을 수 있습니다. 보온이 필요하면 맞지 않을 수 있어요. 조건을 확인하세요.",
  "최종 판단\n\n운동용 조끼가 필요하다면 후보입니다. 가격과 배송을 비교하세요. 구매 전에 정보를 확인하세요.",
  disclosure,
];
const sparse = getBrandLinkContentReadiness({
  productName,
  title: "RNRN 러닝조끼 메쉬 베스트 선택 전 확인",
  sections: sparseSections,
  hashtags: ["러닝조끼", "메쉬조끼", "러닝베스트"],
  brandLink: "https://naver.me/fixture",
  generationSource: "AI",
  hasRepresentativeImage: true,
  requireRepresentativeImage: false,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
  sourceDescription: "RNRN 공식스토어 러닝 용품",
  sourceFeatures: ["러닝조끼", "메쉬", "러닝", "조끼", "여름", "운동"],
  mode: "editorial",
});
assert.equal(sparse.canPublish, false);
assert.equal(sparse.quality.sourceEvidence?.level, "sparse");
assert.equal(sparse.quality.sourceEvidence?.sufficient, false);
assert.equal(sparse.quality.categories.find((item) => item.key === "productEvidence")?.status, "fail");
const sourcePlan = planQualityConvergence({ current: sparse, attempt: 0, maximumAttempts: 2 });
assert.equal(sourcePlan.action, "refresh-source");
assert.equal(sourcePlan.shouldGenerateText, false, "Sparse source must not consume another text generation attempt");

const oneDayTravelEvidence = assessTravelSourceEvidence([
  "핵심 방문지: 히타카츠, 이즈하라",
  "1일차 일정: 히타카츠 → 이즈하라",
]);
assert.deepEqual(
  {
    visitCount: oneDayTravelEvidence.visitCount,
    itineraryDayCount: oneDayTravelEvidence.itineraryDayCount,
    sufficient: oneDayTravelEvidence.sufficient,
  },
  { visitCount: 2, itineraryDayCount: 1, sufficient: true },
);
assert.equal(
  assessTravelSourceEvidence(["여행 기간: 10일", "핵심 방문지: 로마", "1일차 일정: 로마"]).sufficient,
  false,
  "장기 상품은 핵심 방문지 한 곳과 하루 일정만으로 출처 근거를 통과할 수 없습니다",
);
assert.equal(
  assessTravelSourceEvidence(["대마도 2일", "표시가 126,003원", "핵심 방문지: 히타카츠"]).sufficient,
  false,
  "상품명·가격·방문지 이름만으로 일차별 일정 근거를 만들면 안 됩니다",
);
const travelSourceMissing = {
  ...sparse,
  quality: {
    ...sparse.quality,
    sourceEvidence: { ...sparse.quality.sourceEvidence!, level: "travel" as const, sufficient: false },
    categories: sparse.quality.categories.map((item) => item.key === "productEvidence"
      ? { ...item, label: "여행지 고유 근거", status: "fail" as const }
      : item),
  },
} satisfies BrandLinkContentReadiness;
const travelSourcePlan = planQualityConvergence({ current: travelSourceMissing, attempt: 0, maximumAttempts: 2 });
assert.equal(travelSourcePlan.action, "refresh-source");
assert.equal(travelSourcePlan.shouldGenerateText, false);
assert.match(travelSourcePlan.reason, /핵심 방문지·일차별 일정/u);

const rawSource = {
  productName: "테스트 수납함",
  description: "작은 물건을 구분해 옮기는 수납함",
  features: ["분리형 칸막이", "접이식 손잡이", "내부 트레이 3개"],
  price: "19,900원",
  couponInfo: "최대 2천원 할인",
  targetSectionCount: 8,
};
const structuredFeatures = buildProductScoringFeatures(rawSource);
const rawAnalysis = buildProductReviewAnalysis(rawSource);
const structuredAnalysis = buildProductReviewAnalysis({
  ...rawSource,
  features: structuredFeatures,
});
assert.deepEqual(structuredAnalysis.verifiedSignals, rawAnalysis.verifiedSignals, "Generation and saved recheck must see the same product facts");
assert.equal(structuredAnalysis.evidenceLevel, rawAnalysis.evidenceLevel);
assert.ok(!structuredAnalysis.verifiedSignals.some((item) => /^(?:상품명|가격|원가|쿠폰)/u.test(item)));

for (const metadataOnly of [
  ["17900원", "25900원", "할인 10%"],
  ["이미지 10개", "상세 이미지 7개", "대표 사진 1개"],
  ["리뷰 수 1,234개", "평점 4.9 / 5", "무료배송 17,900원"],
]) {
  const analysis = buildProductReviewAnalysis({
    productName: "테스트 상품",
    description: "",
    features: metadataOnly,
    targetSectionCount: 8,
  });
  assert.equal(analysis.evidenceLevel, "sparse", `거래·크롤러 메타데이터는 제품 근거가 아닙니다: ${metadataOnly.join(" / ")}`);
  assert.deepEqual(analysis.verifiedSignals, []);
}
assert.notEqual(buildProductReviewAnalysis({
  productName: "테스트 살균기",
  description: "",
  features: ["살균율: 99.9%", "소비전력: 1200W", "작동시간: 30분"],
  targetSectionCount: 8,
}).evidenceLevel, "sparse", "제품 성능·규격 수치는 계속 제품 근거로 인정해야 합니다");
const nameFragmentOnly = buildProductReviewAnalysis({
  productName: "미닉스 미니건조기 3.5kg PRO+",
  description: "",
  features: ["건조기 3.5kg"],
  targetSectionCount: 8,
});
assert.equal(nameFragmentOnly.evidenceLevel, "sparse", "상품명에서 되풀이한 수치는 독립된 제품 근거가 아닙니다");
assert.deepEqual(nameFragmentOnly.verifiedSignals, []);

const repeatedSingleFact = assessProductReviewSubstance({
  productName: rawSource.productName,
  sourceDescription: rawSource.description,
  sourceFeatures: rawSource.features,
  sections: [
    "구성 사실\n\n분리형 칸막이가 있고 접이식 손잡이와 내부 트레이 3개가 제공됩니다.",
    "첫 판단\n\n분리형 칸막이가 있습니다. 이 구조 덕분에 작은 물건을 구분하기 수월해요.",
    "두 번째 판단\n\n분리형 칸막이가 있습니다. 이 구조 덕분에 정리할 때 편리해요.",
    "세 번째 판단\n\n분리형 칸막이가 있습니다. 이 구조 덕분에 수납에 유용해요.",
    "사용법\n\n사용할 때는 분리형 칸막이를 끼웁니다. 보관할 때는 칸막이를 분리합니다.",
    "제약과 대상\n\n다만 수납 크기가 맞지 않으면 제약이 있습니다. 작은 물건을 나눠 담는 사람에게 적합해요.",
    "결론\n\n분리 수납이 필요한 경우라면 후보가 됩니다.",
  ],
});
assert.ok(repeatedSingleFact.evidenceJudgementCount >= repeatedSingleFact.requiredEvidenceJudgementCount);
assert.equal(repeatedSingleFact.groundedSignalCount, 1);
assert.ok(repeatedSingleFact.requiredGroundedSignalCount > repeatedSingleFact.groundedSignalCount);
assert.ok(repeatedSingleFact.missingElements.includes("서로 다른 근거와 사용 가치가 연결된 판단"));
assert.ok(!repeatedSingleFact.missingElements.includes("구매후기 근거의 장점 요약"), "No review evidence means no manufactured review requirement");

const usefulness = sparse.quality.categories.find((item) => item.key === "usefulness")!;
const textFailure = {
  ...sparse,
  verdict: "quality",
  code: "missing-review-substance",
  blockers: [],
  qualityFailures: [{ ...usefulness, status: "fail", notes: ["조건부 최종 결론"] }],
  quality: {
    ...sparse.quality,
    sourceEvidence: { ...sparse.quality.sourceEvidence!, level: "usable", sufficient: true },
    categories: sparse.quality.categories.map((item) => item.key === "usefulness"
      ? { ...item, status: "fail" as const, notes: ["조건부 최종 결론"] }
      : { ...item, status: "pass" as const, score: item.maxScore, notes: [] }),
  },
  signals: sparse.signals.map((signal) => ({ ...signal, status: signal.key === "review-substance" ? "fail" as const : "pass" as const })),
} satisfies BrandLinkContentReadiness;
const textPlan = planQualityConvergence({ current: textFailure, attempt: 0, maximumAttempts: 2 });
assert.equal(textPlan.action, "repair-text");
assert.equal(textPlan.shouldGenerateText, true);
assert.match(formatQualityConvergenceInstructions(textPlan), /조건부 결론/u);
const inferredScope = selectQualityRepairSectionIndexes({
  current: textFailure,
  sections: sparseSections,
  plan: textPlan,
});
assert.deepEqual(inferredScope, [7], "a missing conditional verdict targets only the existing final-judgement section");
const scopedCandidate = [...sparseSections];
scopedCandidate[7] = `${scopedCandidate[7]}\n추가 판단`;
assert.doesNotThrow(() => assertUntargetedSectionHashesUnchanged(sparseSections, scopedCandidate, inferredScope));
const outOfScopeCandidate = [...scopedCandidate];
outOfScopeCandidate[1] = `${outOfScopeCandidate[1]}\n범위 밖 변경`;
assert.throws(
  () => assertUntargetedSectionHashesUnchanged(sparseSections, outOfScopeCandidate, inferredScope),
  /수정 대상이 아닌 2번 문단/u,
  "an otherwise valid candidate is rejected when any untargeted section hash changes",
);
const rawLinkSections = [...sparseSections];
rawLinkSections[3] = `${rawLinkSections[3]} https://naver.me/fixture`;
const rawLinkFailure = {
  ...textFailure,
  verdict: "blocked",
  code: "link-in-body",
  blockers: [{ code: "link-in-body", tier: "safety", reason: "본문에 쇼핑커넥트/상품 URL이 직접 노출되었습니다." }],
  qualityFailures: [],
  quality: {
    ...textFailure.quality,
    categories: textFailure.quality.categories.map((category) => ({
      ...category,
      status: "pass" as const,
      score: category.maxScore,
      notes: [],
    })),
  },
} satisfies BrandLinkContentReadiness;
const rawLinkPlan = planQualityConvergence({ current: rawLinkFailure, attempt: 0, maximumAttempts: 2 });
assert.deepEqual(
  selectQualityRepairSectionIndexes({ current: rawLinkFailure, sections: rawLinkSections, plan: rawLinkPlan }),
  [3],
  "a concrete safety violation targets the exact containing section rather than every body section",
);
assert.equal(planQualityConvergence({ current: textFailure, previous: textFailure, attempt: 1, maximumAttempts: 2 }).action, "stop");

const compositionOnly = {
  ...textFailure,
  verdict: "blocked",
  code: "composition-quality",
  blockers: [{ code: "composition-quality", tier: "structure", reason: "본문 이미지 2장이 부족합니다." }],
  qualityFailures: [],
  quality: { ...textFailure.quality, categories: textFailure.quality.categories.map((item) => ({ ...item, status: "pass" as const, score: item.maxScore, notes: [] })) },
  signals: textFailure.signals.map((signal) => ({ ...signal, status: signal.key === "composition-quality" ? "fail" as const : "pass" as const })),
} satisfies BrandLinkContentReadiness;
assert.equal(planQualityConvergence({ current: compositionOnly, attempt: 0, maximumAttempts: 2 }).action, "repair-composition");
assert.equal(qualityFailureSignature(compositionOnly).includes("blocker:composition-quality"), true);

const complete = { ...textFailure, canPublish: true, verdict: "pass", code: "ok", blockers: [], qualityFailures: [] } satisfies BrandLinkContentReadiness;
assert.equal(planQualityConvergence({ current: complete, attempt: 0, maximumAttempts: 2 }).action, "complete");

console.log("PASS: sparse-source stop, canonical evidence, distinct grounding, scoped repair hashes, review optionality, bounded convergence");

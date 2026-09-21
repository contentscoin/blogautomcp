import assert from "node:assert/strict";
import { assessProductReviewSubstance, buildProductReviewAnalysis, normalizeProductSubstanceFeatures } from "./lib/product-editorial-plan";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { planQualityConvergence } from "./lib/quality-convergence";
import { extractExplicitProductFacts } from "./lib/product-source-facts";

// September 21 saved Shokz input: one function plus origin was graded usable
// and demanded two distinct functional judgements from the writer.
const shokzSource = {
  productName: "샥즈 오픈핏 2 T920 오픈형 귀걸이형 블루투스 공기전도 무선 귀걸이 이어폰",
  description: "[샥즈 코리아] 업계를 선도하는 오픈-이어 이어폰의 강자",
  features: ["원산지: 중국산(Shenzhen Shokz Co.,Ltd.) 등", "기능: 무선"],
  targetSectionCount: 8,
};
const shokzAnalysis = buildProductReviewAnalysis(shokzSource);
assert.deepEqual(shokzAnalysis.verifiedSignals, ["무선 방식"]);
assert.equal(shokzAnalysis.evidenceLevel, "sparse");
assert.deepEqual(normalizeProductSubstanceFeatures(["상세 근거: 가격: 10000원"]), []);
const duplicateFunctions = buildProductReviewAnalysis({ ...shokzSource,
  features: ["기능: 무선", "기능: 무선 방식", "원산지: 중국산"],
});
assert.equal(duplicateFunctions.verifiedSignals.length, 1);
assert.equal(duplicateFunctions.evidenceLevel, "sparse");
const sparseQuality = getBrandLinkContentReadiness({
  productName: shokzSource.productName, title: shokzSource.productName,
  sourceDescription: shokzSource.description, sourceFeatures: shokzSource.features,
  sections: ["무선 기능\n\n무선 방식은 케이블이 손에 걸리는 부담을 줄여 줍니다."],
  hashtags: [], brandLink: "", generationSource: "AI", hasRepresentativeImage: true,
  requireRepresentativeImage: false, connectKind: "SHOPPING", mode: "editorial",
});
assert.equal(planQualityConvergence({ current: sparseQuality, attempt: 0, maximumAttempts: 3 }).action,
  "refresh-source", "missing independent source evidence must trigger collection, not a rewrite loop");
const collectedAudioFacts = extractExplicitProductFacts(shokzSource.productName, "title");
assert.deepEqual(collectedAudioFacts, ["기능: 오픈형", "기능: 귀걸이형", "기능: 공기전도", "기능: 무선"]);
assert.deepEqual(extractExplicitProductFacts("샥즈 오픈핏 2 T920", "title"), [],
  "model identity alone must not invent the newly supported structures");
for (const denied of ["오픈형 아님", "귀걸이형 미지원", "공기전도 방식 아님", "오픈형, 귀걸이형 아님"]) {
  assert.deepEqual(extractExplicitProductFacts(denied, "description"), [], denied);
}
const refreshedAudio = buildProductReviewAnalysis({ ...shokzSource, features: collectedAudioFacts });
assert.equal(refreshedAudio.verifiedSignals.length, 4);
assert.notEqual(refreshedAudio.evidenceLevel, "sparse");
const adjacentFit = assessProductReviewSubstance({ productName: shokzSource.productName,
  sourceFeatures: collectedAudioFacts,
  sections: ["착용 환경\n\n귀를 막지 않는 오픈형 이어폰이에요. 주변 소리를 같이 들어야 하는 사람에게 맞는 구조입니다."],
});
assert.equal(adjacentFit.evidenceJudgementCount, 1, "natural immediately adjacent fit explanation is grounded");
const isolatedFit = assessProductReviewSubstance({ productName: shokzSource.productName,
  sourceFeatures: collectedAudioFacts,
  sections: ["착용 환경\n\n귀를 막지 않는 오픈형 이어폰이에요.\n\n주변 소리를 같이 들어야 하는 사람에게 맞는 구조입니다."],
});
assert.equal(isolatedFit.evidenceJudgementCount, 0, "fit cannot borrow facts from a different paragraph");
const crab = buildProductReviewAnalysis({productName:'제철 꽃게 1kg',features:['원산지: 국산','무게: 1kg','보관조건: 냉동보관'],targetSectionCount:8});
assert.equal(crab.category,'food');
assert.ok(crab.verifiedSignals.includes('원산지: 국산'), 'food origin is a legitimate sourcing fact');

const source = {
  productName: "테스트 수납함",
  sourceFeatures: ["분리형 칸막이", "접이식 손잡이"],
};
const assess = (sections: string[]) => assessProductReviewSubstance({ ...source, sections });
const fact = "분리형 칸막이를 갖춘 수납함입니다.";
const benefit = "이 구조 덕분에 작은 물건을 나눠 보관하기 수월해요.";
const fit = "이 구성은 작은 물건을 나눠 담으려는 사용자에게 적합해요.";
const natural = assess([
  `물건을 나눠 담을 때\n\n${fact}\n${benefit}`,
  `사용 환경에 따라\n\n${fact} ${fit}`,
  "손잡이를 다루는 방법\n\n접이식 손잡이는 이동하지 않을 때 접어 보관합니다. 이 구조 덕분에 들고 옮길 때 손잡이가 걸리는 불편을 줄이기 수월해요. 설치할 때는 분리형 칸막이를 끼웁니다. 다만 수납 크기가 맞지 않으면 사용에 제약이 있습니다.",
  "고르는 기준\n\n분리형 칸막이가 필요한 환경이라면 정리용 후보가 됩니다.",
]);
assert.equal(natural.pass, true, natural.missingElements.join(", "));
assert.ok(natural.evidenceJudgementCount >= 2);

for (const sections of [
  [`${fact}\n\n${benefit}`], // The fact is a paragraph, not a heading.
  [`사실\n\n${fact}`, `다른 주제\n\n${benefit} ${fit}`],
  [`분리형 칸막이 장점 추천 대상\n\n${benefit} ${fit}`],
  [`사실\n\n${fact} 잠깐 다른 이야기를 해요. ${benefit} ${fit}`],
  [`판단\n\n${benefit} ${fit}`],
  ["분리형 칸막이 장점 추천 대상"],
]) {
  const result = assess(sections);
  assert.equal(result.evidenceJudgementCount, 0, JSON.stringify(sections));
  assert.ok(result.missingElements.includes("구체적인 장점"));
  assert.ok(result.missingElements.includes("추천·비추천 대상"));
}
const sameSentence = assess(["구성\n\n분리형 칸막이는 작은 물건을 나눠 보관하는 데 유용해요."]);
assert.equal(sameSentence.evidenceJudgementCount, 1);
const twoSentences = assess([`구성\n\n${fact} ${benefit}`]);
assert.equal(twoSentences.evidenceJudgementCount, 1, "One explanation is counted once");
const noChaining = assess([`구성\n\n${fact} ${benefit} ${fit}`]);
assert.equal(noChaining.evidenceJudgementCount, 1, "An inferred benefit cannot anchor the next judgement");
const unsupported = assess(["설명\n\n자동 냉각 장치가 있습니다. 이 구조 덕분에 보관이 수월해요."]);
assert.equal(unsupported.evidenceJudgementCount, 0, "An unsupported feature is not evidence");
const weak = assess([
  "장점과 추천 대상\n\n분리형 칸막이가 있습니다. 구매 전에 확인하세요. 다른 상품도 살펴보세요.",
  "조건부 결론\n\n설치 방법을 확인하세요. 보관 방법을 확인하세요. 가격을 비교해보세요.",
]);
assert.equal(weak.pass, false);
assert.equal(weak.evidenceJudgementCount, 0);
assert.ok(weak.missingElements.includes("구체적인 장점"));
console.log("PASS: natural benefit/fit, local adjacent evidence, heading/paragraph isolation, no chained or missing evidence, weak guide rejected");

const pump = (text: string) => assessProductReviewSubstance({ productName: "바디워시", sourceFeatures: ["용기형태: 펌프형"], sections: [`선택 조건\n\n${text}`] });
const unwrapped = pump("펌프형 용기를 원하는 사용자에게 적합해요.");
const wrapped = pump("펌프형 용기를 원하는\n사용자에게 적합해요.");
assert.equal(unwrapped.missingElements.includes("추천·비추천 대상"), false, "metadata label need not appear in prose");
assert.equal(wrapped.evidenceJudgementCount, unwrapped.evidenceJudgementCount, "soft wraps must not split evidence from judgement");
assert.equal(wrapped.missingElements.includes("추천·비추천 대상"), false);
assert.equal(pump("펌프형 용기입니다.\n\n이 구성은 사용자에게 적합해요.").missingElements.includes("추천·비추천 대상"), true, "paragraph boundaries remain evidence boundaries");
assert.equal(pump("자동 세척 기능을 원하는 사용자에게 적합해요.").evidenceJudgementCount, 0, "unsupported functions remain rejected");
console.log("PASS: field-value grounding and soft-wrap invariance without crossing paragraphs");
assert.equal(pump("펌프형을 매일 쓰는 집에는 잘 맞는 제품입니다.").missingElements.includes("조건부 최종 결론"), false,
  "explicit household condition and judgement constitute a conditional verdict");

const eyeSource = { productName: "아이크림", sourceFeatures: ["원산지: 폴란드산", "피부타입: 모든피부용", "용기형태: 튜브형"] };
const eye = assessProductReviewSubstance({ ...eyeSource, sections: ["사용 조건\n\n튜브형은 양 조절에 유용해요. 피부타입은 모든피부용으로 안내되어 있지만, 눈가는 개인차가 큰 부위라 소량 사용이 먼저예요."] });
assert.equal(eye.groundedSignalCount, 2, "a source-grounded suitability limitation supplies distinct evidence");
const ungroundedCaution = assessProductReviewSubstance({ ...eyeSource, sections: ["사용 조건\n\n개인차가 있어 소량 사용이 먼저예요."] });
assert.equal(ungroundedCaution.evidenceJudgementCount, 0, "generic caution cannot invent a second source");
const bareSkinFact = assessProductReviewSubstance({ ...eyeSource, sections: ["사용 조건\n\n모든피부용이고 개인차가 있습니다."] });
assert.equal(bareSkinFact.evidenceJudgementCount, 0, "a bare fact without practical consequence is not a judgement");
const tubeFit = assessProductReviewSubstance({ ...eyeSource, sections: ["선택 조건\n\n튜브형이라 위생과 양 조절을 중요하게 보는 분도 선택 이유가 분명해요."] });
assert.equal(tubeFit.missingElements.includes("추천·비추천 대상"), false);
const genericFit = assessProductReviewSubstance({ ...eyeSource, sections: ["선택 조건\n\n위생과 양 조절을 중요하게 보는 분도 선택 이유가 분명해요."] });
assert.equal(genericFit.evidenceJudgementCount, 0, "fit language still requires source evidence");

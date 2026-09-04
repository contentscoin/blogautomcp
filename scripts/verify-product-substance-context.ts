import assert from "node:assert/strict";
import { assessProductReviewSubstance } from "./lib/product-editorial-plan";

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
  "손잡이를 다루는 방법\n\n접이식 손잡이는 이동하지 않을 때 접어 보관합니다. 설치할 때는 분리형 칸막이를 끼웁니다. 다만 수납 크기가 맞지 않으면 사용에 제약이 있습니다.",
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

import assert from "node:assert/strict";
import {
  buildLocalTravelPostJson,
  buildTravelContractEditorialPlan,
  formatTravelEditorialPlanForPrompt,
} from "./lib/travel-content";

const product = {
  name: "[출발확정/여행핫딜] 스위스/이탈리아 2국 9일 <노쇼핑/융프라우/루체른/관광열차/피사/폼페이/콜로세움내부>",
  description: "",
  features: [],
  price: "3,149,000원",
};

const plan = buildTravelContractEditorialPlan(product);
const titles = plan.map((section) => section.title);
const fullText = plan.flatMap((section) => section.body).join(" ");

assert.equal(plan.length, 13, "여행 포스트 계약의 13개 섹션을 맞춰야 합니다.");
assert.equal(new Set(titles).size, titles.length, "여행 소제목을 반복하면 안 됩니다.");
assert.match(titles[0], /누구에게/u, "첫 섹션은 독자 적합도와 결론을 먼저 제시해야 합니다.");
assert.match(titles.at(-1) || "", /예약 전/u, "마지막 섹션은 예약 판단으로 끝나야 합니다.");
assert.ok(titles.some((title) => title.includes("융프라우")), "확인된 코스 포인트를 섹션에 반영해야 합니다.");
assert.doesNotMatch(fullText, /배송|교환|반품|구성품/u, "쇼핑 상품 문구가 여행 글에 섞이면 안 됩니다.");
assert.doesNotMatch(fullText, /다녀왔|먹어봤|묵어봤/u, "근거 없는 체험담을 만들면 안 됩니다.");

assert.ok(plan.some((section) => /전체 동선/u.test(section.title)));
assert.ok(plan.some((section) => /포함·불포함/u.test(section.title)));
assert.ok(plan.some((section) => /잘 맞아요/u.test(section.title)));

const prompt = formatTravelEditorialPlanForPrompt(plan);
assert.match(prompt, /대표 장면.*일정 한눈에 보기.*예약 링크/u, "여행 편집 흐름이 프롬프트에 있어야 합니다.");

const localDraft = JSON.parse(buildLocalTravelPostJson(product, 13)) as {
  title: string;
  sections: string[];
  hashtags: string[];
};
assert.equal(localDraft.sections.length, 13, "로컬 폴백도 여행 섹션 수를 유지해야 합니다.");
assert.equal(new Set(localDraft.sections.map((section) => section.split("\n")[0])).size, 13);
const localDraftLength = localDraft.sections.join("\n").replace(/\s+/gu, "").length;
assert.ok(localDraftLength >= 3_200 && localDraftLength <= 4_800, `여행 폴백 본문 길이가 범위를 벗어났습니다: ${localDraftLength}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      title: localDraft.title,
      sectionTitles: titles,
      hashtags: localDraft.hashtags,
      bodyChars: localDraftLength,
    },
    null,
    2,
  ),
);

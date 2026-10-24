import assert from "node:assert/strict";
import fs from "node:fs";
import { buildProduct9Canvas } from "./lib/product-9canvas";
import { buildShoppingWritingSectionPlan } from "./lib/shopping-writing-plan";
import { buildTitleCandidates, scoreTitle } from "./lib/topic-templates/title-planner";
import { composeBudgetedWritingPrompt, createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";

const fixtures = [
  { name: "아비노 바디로션 532ml", features: ["용량: 532ml", "용기형태: 펌프형", "향료: 무향", "피부타입: 건성 피부"], category: "beauty_body" },
  { name: "샘플 X100 USB 모니터", features: ["연결: USB-C", "규격: 27인치", "호환: Windows 11", "스탠드 높이 조절: 미지원"], category: "digital_it" },
  { name: "상주 곶감 반건시 건시 선물세트", features: ["원산지: 국내산", "보관: 냉동 보관", "해동 후 재냉동 불가"], category: "food_supplement" },
  { name: "모아 캠핑 클립 선풍기", features: ["소비전력: 5W", "배터리: 4000mAh", "풍속: 3단계", "회전: 90도", "중량: 500g", "충전: USB-C"], category: "home_appliance" },
  { name: "마이런 러닝 조끼", features: ["소재: 폴리에스터 100%", "무게: 120g", "사이즈: M", "구성품: 조끼 1개"], category: "fashion_goods" },
  { name: "오로라 상품", features: [], category: "generic_shopping" },
] as const;

const concerns = new Set<string>();
const promptLengths: number[] = [];
for (const fixture of fixtures) {
  const product = { name: fixture.name, features: [...fixture.features] };
  const canvas = buildProduct9Canvas(product);
  const contract = createWritingPromptContract({ kind: "SHOPPING", product, productUnderstanding: canvas,
    minimumSections: 5, maximumSections: 8, targetCharacters: { min: 1300, max: 2400 }, hashtagCount: 5,
    publicationPhotoContext: { version: "writing-publication-photo-context/v1", verifiedOriginal: {
      path: "C:/test-fixture/verified-product.png", sha256: "a".repeat(64), verifiedProductName: fixture.name, sourceUrl: null,
    }, plannedScenes: [{ role: "scene-1" }, { role: "scene-2" }, { role: "scene-3" }] },
  });
  const plan = contract.sectionPlan!;
  assert.equal(plan.brief?.categoryId, fixture.category);
  assert.deepEqual(plan.brief?.selectedOption, canvas.subject.selectedOption);
  assert.notEqual(plan.brief?.selectedOption, canvas.subject.selectedOption, "planning cannot mutate the analysis");
  assert.ok(plan.brief!.confirmedConstraints.every(fact => plan.facts.includes(fact)), "constraint highlights cannot invent negative product facts");
  concerns.add(plan.brief!.readerConcern);

  for (const count of [5, 6, 8]) {
    const bounded = buildShoppingWritingSectionPlan({ productName: fixture.name, sourceFeatures: fixture.features,
      productUnderstanding: canvas, minimumSections: count, maximumSections: count });
    const assigned = bounded.sections.flatMap(section => section.factIndexes);
    assert.deepEqual(assigned, bounded.facts.map((_, index) => index), "every chosen fact is allocated exactly once, including short outlines");
  }

  const local = formatWritingPromptContract(contract);
  const mcp = formatWritingPromptContract(JSON.parse(JSON.stringify(contract)));
  assert.equal(local, mcp, "the serializable local and exported MCP contract must produce the same brief");
  assert.doesNotMatch(local, /\[Product 9Canvas/u, "the same product analysis is not repeated behind the brief");
  assert.match(local, /미확인 조건을 단점으로 만들지/u);
  assert.match(local, /기능 설명 옆 연출 사진에 그 기능을 증명할 의무는 없/u);
  assert.match(local, /문구를 복사할 필요는 없/u);
  assert.match(local, /없는 1인칭 체험은 만들지/u);
  const compact = formatWritingPromptContract(contract, { topicDetail: "minimal" });
  for (const fact of plan.facts) {
    assert.ok(compact.includes(fact), "the mandatory compact brief retains facts, numbers and qualifiers");
  }
  if (contract.titlePlanContext) {
    const candidates = buildTitleCandidates(contract.titlePlanContext).filter(title => scoreTitle(title, contract.titlePlanContext!).hardFailures.length === 0);
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some(title => compact.includes(title)), "compact recovery shares a grounded natural title candidate");
  }
  for (const limit of [6500, 8500]) {
    const prompt = composeBudgetedWritingPrompt({ contract, prefix: "실제 상품 근거로 작성합니다.\n".repeat(15),
      evidence: Array.from({ length: 1000 }, (_, index) => `별도 상세 근거입니다. 자료 번호 ${index}`).join("\n"),
      suffix: "JSON 원고를 작성하세요.", maxChars: limit });
    assert.ok(prompt.length <= limit);
    assert.ok(prompt.includes("별도 상세 근거입니다."), "brief leaves room for actual source evidence");
    assert.ok(prompt.endsWith(compact));
    promptLengths.push(prompt.length);
  }
}
assert.equal(concerns.size, fixtures.length, "product families do not receive one universal reader concern");

const ambiguous = buildShoppingWritingSectionPlan({ productName: fixtures[2].name, sourceFeatures: fixtures[2].features,
  productUnderstanding: buildProduct9Canvas({ name: fixtures[2].name, features: fixtures[2].features }), minimumSections: 5, maximumSections: 8 });
assert.equal(ambiguous.brief?.selectedOption.status, "ambiguous");
assert.ok(ambiguous.brief?.unresolvedConstraints.includes("선택 옵션 미확정"));
assert.match(ambiguous.brief!.optionDirective, /모두 포함된 구성으로 쓰지 말/u);
assert.equal(buildShoppingWritingSectionPlan({ productName: "오로라 상품", minimumSections: 5, maximumSections: 8 }).facts.length, 0);

const wrongAnalysis = buildProduct9Canvas({ name: "다른 골프 워치", features: ["배터리: 500mAh"] });
const safe = buildShoppingWritingSectionPlan({ productName: fixtures[0].name, sourceFeatures: fixtures[0].features,
  productUnderstanding: wrongAnalysis, minimumSections: 5, maximumSections: 8 });
assert.equal(safe.brief?.categoryId, "beauty_body");
assert.doesNotMatch(JSON.stringify(safe), /골프|500mAh/u, "another product's analysis cannot contaminate the writer brief");

const longFeatures = fixtures[3].features.map(fact => `${fact}; ${"판매자에 표기된 조건 안에서 제공되며 모델별 상세 조건을 구분해야 합니다. ".repeat(3).trim()}`);
const longContract = createWritingPromptContract({ kind: "SHOPPING", product: { name: fixtures[3].name, features: longFeatures },
  minimumSections: 5, maximumSections: 8, targetCharacters: { min: 1300, max: 2400 }, hashtagCount: 5 });
assert.ok(longContract.sectionPlan!.facts.some(fact => fact.length > 100), "stress case carries real long fact rows");
const longPrompt = composeBudgetedWritingPrompt({ contract: longContract, prefix: "작성 요청", suffix: "JSON만 작성",
  evidence: "상세 근거 유지 확인", maxChars: 6500 });
assert.ok(longPrompt.length <= 6500);
assert.ok(longPrompt.includes("상세 근거 유지 확인"));
for (const fact of longContract.sectionPlan!.facts) assert.ok(longPrompt.includes(fact), "a long specification is retained whole");

// Observe the real local/export call sites without opening a provider or operating data.
const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
assert.match(agent, /mandatoryWritingPromptBlock = formatWritingPromptContract\(writingContract\)/u);
assert.match(agent, /writingHarness: formatWritingPromptContract\(writingContract\)/u);

console.log(JSON.stringify({ ok: true, products: fixtures.length, budgets: [6500, 8500],
  maximumPromptLength: Math.max(...promptLengths), longFactBudget: longPrompt.length,
  distinctReaderConcerns: concerns.size, sharedLocalMcpContract: true }));

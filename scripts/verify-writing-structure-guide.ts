import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { buildPreparedDraftView } from "../src/lib/draft-context-view";
import { formatWritingStructureGuide } from "./lib/writing-structure-guide";
import { SHOPPING_POST_STRATEGY } from "../src/lib/shopping-post-strategy";
import { getAdaptiveEditorialProfile, formatAdaptiveEditorialHarnessForPrompt } from "./lib/adaptive-editorial-harness";
import { renderSystemPrompt } from "./lib/post-spec/generate";
import type { PostSpec } from "./lib/post-spec/types";
import {
  composeBudgetedWritingPrompt, createWritingPromptContract,
  formatWritingPromptContract, getWritingOutputExample, resolveWritingDraftTitle,
} from "./lib/writing-prompt-contract";

// Execute the production user-prompt initializer without starting the agent.
const agentText = fs.readFileSync(path.join(__dirname, "simple-agent.ts"), "utf8");
const ast = ts.createSourceFile("simple-agent.ts", agentText, ts.ScriptTarget.Latest, true);
let userInitializer: ts.Expression | undefined;
function findPrompt(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "userPrompt") {
    userInitializer = node.initializer;
  }
  ts.forEachChild(node, findPrompt);
}
findPrompt(ast);
assert.ok(userInitializer);
const defaults: Record<string, unknown> = {};
function defaultIdentifiers(node: ts.Node): void {
  if (ts.isIdentifier(node)) defaults[node.text] = "";
  ts.forEachChild(node, defaultIdentifiers);
}
defaultIdentifiers(userInitializer);
assert.match(agentText, /runCodexDraft\(\{\s*systemPrompt,\s*userPrompt,/u);
assert.match(agentText, /writingContract,\s*outputSchema: getWritingOutputExample\(writingContract\),\s*systemPrompt,\s*userPrompt,/u);

for (const kind of ["SHOPPING", "TRAVEL"] as const) {
  const title = "요청한 제목";
  const contract = createWritingPromptContract({
    kind, minimumSections: 8, maximumSections: 11,
    targetCharacters: { min: 2400, max: 4200 }, hashtagCount: 4,
    draftMemo: `제목은 정확히 “${title}”으로 작성. 숙박 선택 기준을 포함하세요.`,
  });
  const guide = formatWritingStructureGuide(kind);
  // Only these spec fields are consumed by the real system-prompt renderer.
  const promptSpec = {
    connectKind: kind, brief: null,
    facts: { travel: null, blockedClaimRules: ["테스트 금지 주장"] },
  } as unknown as PostSpec;
  const specPrompt = renderSystemPrompt(promptSpec, { extraSystemRules: "추가 테스트 규칙" });
  assert.ok(specPrompt.includes(guide), "Actual Spec-first generation/repair system prompt includes guide");
  assert.equal(specPrompt.split(guide).length - 1, 1);
  assert.match(specPrompt, /섹션 ID·순서·제목과 JSON 스키마는 유지/u);
  assert.match(specPrompt, /같은 섹션·문단의 바로 다음 문장/u);
  assert.match(specPrompt, /전용 근거.*최소 1개/u);
  assert.match(specPrompt, /테스트 금지 주장/u);
  assert.match(specPrompt, /추가 테스트 규칙/u);
  assert.doesNotMatch(specPrompt, /까지 한 문장으로 잇습니다|개인 검토 소감.*허용|널리 알려진 여행지 정보/u);
  const mandatory = formatWritingPromptContract(contract);
  assert.ok(guide.length < 1800, "Style guidance must leave space for evidence");
  assert.ok(mandatory.includes(guide));
  assert.ok(mandatory.indexOf(guide) < mandatory.indexOf("[사용자 초안 메모"));
  assert.equal(resolveWritingDraftTitle("다른 제목", "기본 제목", contract, (s) => s.trim()), title);
  assert.deepEqual(JSON.parse(mandatory.split("\n").at(-1)!), getWritingOutputExample(contract));
  assert.match(guide, /완결된 문장마다 줄바꿈/u);
  assert.match(guide, /모든 섹션을.*반복하지/u);
  assert.match(guide, /추정형 어미만 없애 확정 사실로 만들지/u);
  assert.match(guide, /모두 필수 목차가 아니며/u);
  // Osaka audit regressions: flexible rhythm must retain limits and source grounding.
  assert.match(guide, /최소·최대 문장 수와 전체 분량을 지키되 모두 5문장으로 맞추지/u);
  assert.match(guide, /요약은 짧게.*근거 설명은 충분히.*조건 비교·실제 제약·추천\/비추천 결론/u);
  assert.match(guide, /문장 수를 채우려고 사실이나 체험을 지어내지/u);
  assert.match(guide, /첫 문장에 긴 원문 상품명.*통째로 붙이지/u);
  assert.match(guide, /사용자가 지정한 제목은 유지/u);
  if (kind === "TRAVEL") {
    assert.match(guide, /원본의 일차·방문 순서/u);
    assert.match(guide, /장소별 소개로 재배열하면 일정 순서가 아님을 밝히/u);
    assert.match(guide, /근거 없는 '돌아오면'·'그날 밤'.*만들지/u);
    assert.match(guide, /일차가 없으면 임의로 배정하지/u);
    assert.match(guide, /포함·불포함·선택 조건을 구분.*확정된 불포함.*가정으로 약화하지/u);
    assert.match(guide, /호텔 미확정 여부와 안내 시점.*필수 방문·체류시간.*원본에 있을 때/u);
    assert.match(guide, /상품명에만 있는 선택 옵션.*세부 일정·비용·대체 코스를 만들지.*확인되지 않은 범위/u);
    // The incident is evidence for general rules, not reusable product facts.
    assert.doesNotMatch(guide, /오사카|도톤보리|고베|USJ|40~60|3~4/u);
  } else {
    assert.doesNotMatch(guide, /호텔 미확정|실제 일정은 원본/u);
    assert.match(guide, /생활 문제·선택 기준.*상품 사실·구성.*구매 판단.*사용 계획.*체크리스트/u);
    assert.match(guide, /판매자의 사용감·효능 설명.*검증된 직접 체험을 구분/u);
    assert.match(guide, /작업 보고를 절마다 반복하지/u);
    assert.match(guide, /제휴 고지와 상품 카드는 시스템이 배치/u);
    assert.equal(contract.strategyVersion, SHOPPING_POST_STRATEGY.version);
    assert.deepEqual(getAdaptiveEditorialProfile(kind).sectionRange, SHOPPING_POST_STRATEGY.sections);
    const harness = formatAdaptiveEditorialHarnessForPrompt(kind);
    assert.match(harness, /5~8절, 이미지 5장 중심/u);
    assert.match(harness, /연출 이미지는 효능·실측·실제 체험의 증거가 아닙니다/u);
    assert.doesNotMatch(harness, /핵심 기능이 어떤 구조로 작동|스펙을 말한 직후 실제 사용법과 체감 가능한/u);
    assert.doesNotMatch(guide + harness, /달바|SPF50|50ml|퍼플 톤업/u, "Strategy must not encode the sample product");
  }
  assert.ok(guide.includes(kind === "SHOPPING" ? "[쇼핑 전개 선택]" : "[여행 전개 선택]"));
  assert.ok(!guide.includes(kind === "SHOPPING" ? "[여행 전개 선택]" : "[쇼핑 전개 선택]"));
  const evidence = "확인된 원본 근거입니다.\n".repeat(10000);
  const prompt = composeBudgetedWritingPrompt({ contract, prefix: "작성 요청", suffix: "수정에도 적용",
    evidence, maxChars: 6000 });
  assert.ok(prompt.length <= 6000);
  assert.ok(prompt.endsWith(formatWritingPromptContract(contract, { topicDetail: "minimal" })), "Evidence truncation retains style, memo, and JSON contract");
  assert.ok(prompt.includes("확인된 원본 근거"), "Guidance must not crowd out all evidence");
  const actualUserPrompt = vm.runInNewContext(ts.transpileModule(`(${userInitializer.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { ...defaults, JSON, isTravel: kind === "TRAVEL", writingContract: contract,
    mandatoryWritingPromptBlock: mandatory, productEditorialPlan: { sections: [] },
    product: { description: "테스트 근거", features: [] } });
  assert.ok(actualUserPrompt.includes(guide), "Actual Codex user prompt includes structure guidance");
  for (const padding of ["", "x".repeat(860 * 1024)]) {
    const data = { generation: { writingContract: contract, userPrompt: actualUserPrompt }, padding };
    const warnings: string[] = [];
    const view = buildPreparedDraftView(data, "fixture-product", "fixture-job", warnings);
    const exported = view.generation as typeof data.generation;
    assert.ok(exported.userPrompt.includes(guide), "MCP generation payload retains guide even when flattened prompts are omitted");
    if (!padding) assert.equal(view.userPrompt, actualUserPrompt);
    else assert.equal(view.userPrompt, null);
  }
}
console.log("PASS: shopping/travel structure, memo precedence, JSON shape, budgeted evidence, production Codex prompt, MCP prepared view, Spec-first system prompt");

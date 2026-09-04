import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { buildPreparedDraftView } from "../src/lib/draft-context-view";
import { formatWritingStructureGuide } from "./lib/writing-structure-guide";
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
  assert.ok(guide.includes(kind === "SHOPPING" ? "[쇼핑 전개 선택]" : "[여행 전개 선택]"));
  assert.ok(!guide.includes(kind === "SHOPPING" ? "[여행 전개 선택]" : "[쇼핑 전개 선택]"));
  const evidence = "확인된 원본 근거입니다.\n".repeat(10000);
  const prompt = composeBudgetedWritingPrompt({ contract, prefix: "작성 요청", suffix: "수정에도 적용",
    evidence, maxChars: 6000 });
  assert.ok(prompt.length <= 6000);
  assert.ok(prompt.endsWith(mandatory), "Evidence truncation retains style, memo, and JSON contract");
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

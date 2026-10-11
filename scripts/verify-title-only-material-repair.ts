/** Offline coverage of measured title failures and the production writer's bounded JSON contract. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  getBrandLinkContentReadiness,
  type BrandLinkContentReadiness,
  type BrandLinkContentReadinessInput,
} from "./lib/brandlink-content-readiness";
import { planQualityConvergence } from "./lib/quality-convergence";
import { isPreparedTitleOnlyRepair, selectPreparedRevisionSectionIndexes } from "./lib/prepared-revision-policy";
import { applyFreeformDraftRevision, assertUntargetedSectionHashesUnchanged } from "./lib/freeform-draft-revision";
import { shouldAcceptQualityRepair } from "./lib/quality-repair-policy";

const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";
const sections = [
  "작은 부품을 나눠 담는 구조\n\n테스트 수납함 M3는 작은 물건을 구분해 옮기는 제품입니다. 분리형 칸막이가 있어서 도구 크기에 맞춰 구획을 조절할 수 있어요. 그래서 나사와 단추처럼 종류가 다른 부품을 한 상자에서 구분하기 수월하다는 장점이 있습니다. 한 공간에 전부 섞어 놓는 방식과 비교하면 종류별 위치를 정할 수 있는 구조가 선택 이유입니다.",
  "이동할 때 접는 손잡이\n\n접이식 손잡이는 작업 장소를 바꿀 때 상자를 들고 옮기는 용도입니다. 이 구조 덕분에 정리함과 부품을 따로 나눠 운반하는 번거로움을 줄일 수 있어요. 책상에서 작업대를 오가는 상황에서는 손잡이를 펴고 내용물의 무게를 고르게 배치합니다. 보관할 때는 손잡이를 접어 상자 위쪽 공간을 정리하는 방식으로 활용합니다.",
  "세 트레이로 나누는 작업 순서\n\n내부 트레이 3개는 작업 종류에 따라 부품을 분리하는 구성입니다. 따라서 수리와 바느질 용품을 구별해 두고 쓰는 사람에게 유용합니다. 필요한 트레이를 따로 꺼내 책상 위에 놓고 작업하면 나머지 내용물은 상자에 남겨 둘 수 있습니다. 트레이마다 다른 작업의 물건을 배치하는 것이 이 구성의 실용적인 사용 방법입니다.",
  "공간에 맞춰 배치하는 방법\n\n분리형 칸막이를 배치할 때는 물건을 넣은 뒤 구획의 간격을 조절합니다. 긴 도구와 작은 부품을 같은 칸에 쌓으면 아래쪽 물건을 꺼내기 어려우므로 크기에 맞게 나누는 방식이 편리해요. 이동이 잦은 물건은 손잡이 가까운 쪽에 두기보다 무게를 상자 양쪽으로 나눠 담는 편이 균형을 잡는 데 도움이 됩니다.",
  "구획이 오히려 제약인 경우\n\n내부 트레이 3개라는 구성은 작은 물건을 종류별로 보관하는 상황에서 의미가 있습니다. 반면 큰 물건 하나를 통째로 넣는 용도라면 트레이가 공간을 나누는 제약이 될 수 있어요. 부품이 적고 종류도 한 가지라면 여러 구획을 모두 쓸 필요가 없는 경우입니다. 이런 사용 조건에서는 단순한 상자와 구분해서 판단하는 것이 합리적입니다.",
  "누구의 작업대에 잘 맞을까\n\n분리형 칸막이 덕분에 서로 다른 부품의 위치를 정할 수 있어서 작은 도구를 자주 분류하는 사람에게 잘 맞는 제품입니다. 접이식 손잡이가 있으므로 작업 장소를 옮기는 사용자에게도 선택 이유가 분명해요. 비추천 대상은 큰 물건을 한 공간에 담으려는 사람입니다. 필요한 구획의 수와 넣을 물건의 크기가 이 수납함을 고르는 기준입니다.",
  "한 상자와 여러 구획의 차이\n\n일반 상자는 물건을 한 공간에 모으는 데 초점을 두지만 내부 트레이 3개는 작업 단위를 분리하는 방식입니다. 필요한 부품만 꺼내는 작업에서는 이 구성이 편리한 반면 종류가 하나뿐인 물건에는 구획을 늘리는 의미가 적습니다. 제품을 비교할 때에는 막연한 수납량보다 작업 종류를 나눌 필요가 있는지를 먼저 기준으로 삼을 수 있습니다.",
  "작업 조건으로 내리는 최종 결론\n\n작은 부품을 작업별로 분류하고 장소도 옮겨야 하는 경우라면 분리형 칸막이와 접이식 손잡이가 있는 테스트 수납함 M3를 후보로 추천합니다. 내부 트레이 3개를 실제 작업에 나눠 활용할 수 있을 때 구성의 강점이 살아나요. 반대로 큰 물건을 한 덩어리로 보관하는 용도라면 구획 없는 다른 상자가 더 적합할 수 있습니다.",
  disclosure,
];
const input: BrandLinkContentReadinessInput = {
  productName: "테스트 수납함 M3", title: "작업대의 작은 물건을 나누는 방법", sections,
  hashtags: ["수납함", "정리함", "작업대"], brandLink: "https://naver.me/offline-fixture",
  generationSource: "AI", hasRepresentativeImage: true, requireRepresentativeImage: false,
  thumbnailGenerated: true, connectKind: "SHOPPING", mode: "editorial",
  sourceDescription: "작은 물건을 구분해 옮기는 수납함",
  sourceFeatures: ["분리형 칸막이", "접이식 손잡이", "내부 트레이 3개"],
};
const before = getBrandLinkContentReadiness(input);
assert.equal(before.score, 100, JSON.stringify(before));
assert.equal(before.canPublish, false);
assert.equal(before.code, "missing-product-name");
assert.deepEqual(before.blockers.map(blocker => blocker.code), ["missing-product-name"]);
assert.deepEqual(before.signals.filter(signal => signal.status === "fail").map(signal => signal.key), ["product-title"]);
const plan = planQualityConvergence({ current: before, attempt: 0, maximumAttempts: 3 });
const scope = selectPreparedRevisionSectionIndexes({ current: before, sections, plan,
  requestedIndexes: [], qualityConvergence: true, incrementalOnly: true });
assert.deepEqual(scope, []);
assert.equal(isPreparedTitleOnlyRepair({ current: before, plan, qualityConvergence: true }), true);

function rejectsTitleOnly(current: BrandLinkContentReadiness, label: string): void {
  const candidatePlan = planQualityConvergence({ current, attempt: 0, maximumAttempts: 3 });
  assert.equal(isPreparedTitleOnlyRepair({ current, plan: candidatePlan, qualityConvergence: true }), false, label);
}
rejectsTitleOnly({ ...before, signals: before.signals.map(signal => signal.key === "product-body"
  ? { ...signal, status: "fail" } : signal) }, "body identity failure cannot be treated as title-only");
rejectsTitleOnly({ ...before, signals: [...before.signals, { key: "unknown-body-failure", label: "unmapped", status: "fail" }] },
  "an unmapped failed signal must not inherit title-only permission");
rejectsTitleOnly(getBrandLinkContentReadiness({ ...input, sections: sections.map((section, index) => index === 0
  ? `${section} 직접 사용해봤습니다.` : section) }), "a real safety failure stays blocking");
rejectsTitleOnly({ ...before, quality: { ...before.quality, score: before.quality.passScore - 1 } },
  "a below-threshold draft needs more than title repair");
rejectsTitleOnly({ ...before, qualityFailures: [{ ...before.quality.categories[0], status: "fail" }] },
  "mandatory quality failures stay blocking");
rejectsTitleOnly({ ...before, quality: { ...before.quality, categories: before.quality.categories.map((category, index) => index === 0
  ? { ...category, status: "fail" } : category) } }, "failed categories stay blocking even without qualityFailures");
assert.equal(isPreparedTitleOnlyRepair({ current: before, plan, qualityConvergence: false }), false);
assert.equal(isPreparedTitleOnlyRepair({ current: before, plan: { ...plan, targets: [] }, qualityConvergence: true }), false);
assert.equal(isPreparedTitleOnlyRepair({ current: before, plan: { ...plan, action: "stop" }, qualityConvergence: true }), false);

const draft = { title: input.title, sections };
const repairedTitle = "테스트 수납함 M3 칸막이와 손잡이가 필요한 작업 조건";
const repaired = applyFreeformDraftRevision(draft, JSON.stringify({ title: repairedTitle, updates: [] }), scope,
  { allowTitleChange: true, allowEmptyBodyScope: true });
assert.equal(repaired.title, repairedTitle);
assert.deepEqual(repaired.sections, sections, "every paragraph, heading, order and disclosure remains byte-identical");
assertUntargetedSectionHashesUnchanged(sections, repaired.sections, scope);
const after = getBrandLinkContentReadiness({ ...input, ...repaired });
assert.equal(after.canPublish, true, after.summary);
assert.equal(after.score, 100);
assert.equal(shouldAcceptQualityRepair(before, after), true);
assert.throws(() => applyFreeformDraftRevision(draft,
  JSON.stringify({ title: repairedTitle, updates: [{ index: 0, body: "본문 변경" }] }), [],
  { allowTitleChange: true, allowEmptyBodyScope: true }), /수정 문단 식별자/u,
  "title-only JSON cannot silently fall back to all body paragraphs");
assert.throws(() => applyFreeformDraftRevision(draft,
  JSON.stringify({ title: repairedTitle, updates: [{ index: sections.length - 1, body: "고지 변경" }] }), [],
  { allowTitleChange: true, allowEmptyBodyScope: true }), /수정 문단 식별자/u);
assert.throws(() => applyFreeformDraftRevision(draft,
  JSON.stringify({ title: repairedTitle, updates: [] }), [], { allowEmptyBodyScope: true }), /제목 수정이 요청되지/u);
assert.throws(() => applyFreeformDraftRevision(draft,
  JSON.stringify({ title: draft.title, updates: [] }), [],
  { allowTitleChange: true, allowEmptyBodyScope: true }), /수정된 문단 응답이 없습니다/u);
const legacy = applyFreeformDraftRevision(draft, JSON.stringify({ updates: [{ index: 0, body: "기존 일반 수정 동작" }] }));
assert.notEqual(legacy.sections[0], sections[0], "legacy empty-index body-edit API remains compatible");
assert.throws(() => assertUntargetedSectionHashesUnchanged(sections, legacy.sections, []), /수정 대상이 아닌 1번/u,
  "the writer retains a second fail-closed boundary for alternate revision engines");

// Execute the actual writer's prompt expression without importing its live providers or publishing agent.
const sourceText = fs.readFileSync("scripts/simple-agent.ts", "utf8");
const source = ts.createSourceFile("simple-agent.ts", sourceText, ts.ScriptTarget.Latest, true);
let writerPrompt: ts.CallExpression | undefined;
let explicitEmptyScope = false;
function inspect(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "generateWithAI") {
    const prompt = node.arguments[1];
    if (prompt && ts.isCallExpression(prompt) && prompt.expression.getText(source) === "JSON.stringify" &&
      prompt.getText(source).includes("updates: titleOnlyRepair ? []")) writerPrompt = prompt;
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "applyFreeformDraftRevision") {
    explicitEmptyScope ||= Boolean(node.arguments[3]?.getText(source).includes("allowEmptyBodyScope: titleOnlyRepair"));
  }
  ts.forEachChild(node, inspect);
}
inspect(source);
assert.ok(writerPrompt, "actual writer must send a title-only JSON contract");
assert.ok(explicitEmptyScope, "actual writer must pass the title-only empty-body scope to the parser");
const emitted = ts.transpileModule(`result = ${writerPrompt.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { result: "", attemptInstructions: "제목 상품명 보완", diagnostic: before.summary,
  snapshot: { fixture: true }, selected: draft, allowedIndexes: scope, allowCandidateTitleChange: true,
  titleOnlyRepair: true };
vm.runInNewContext(emitted, sandbox);
const actualPrompt = JSON.parse(sandbox.result);
assert.deepEqual(actualPrompt.allowedIndexes, []);
assert.deepEqual(actualPrompt.output, { title: "수정한 글 제목", updates: [] });
assert.match(actualPrompt.rules, /updates는 반드시 빈 배열/u);
assert.deepEqual(actualPrompt.sections, sections.map((text, index) => ({ index, text })));

console.log("Title-only material repair: measured 100-point failure, mixed/safety refusals, immutable body, strict JSON scope and actual writer prompt passed");

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
import { preservePreparedRevisionRenderPlan } from "./lib/prepared-revision-composition";
import { normalizePublishedPostText, resolvePostDocument, type ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";
import { createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";

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
let revisionComposition: ts.ArrowFunction | undefined;
function inspect(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "resolveRevisedComposition" &&
      node.initializer && ts.isArrowFunction(node.initializer)) revisionComposition = node.initializer;
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
const promptComposition = normalizePublishedPostText(resolvePostDocument({ connectKind: "SHOPPING", productName: input.productName,
  title: input.title, sections, hashtags: input.hashtags, imagePaths: [], connectUrl: input.brandLink }));
const writingContract = createWritingPromptContract({ kind: "SHOPPING", product: { name: input.productName,
  description: input.sourceDescription, features: input.sourceFeatures }, minimumSections: sections.length - 1,
  maximumSections: sections.length - 1, targetCharacters: { min: 1200, max: 2800 }, hashtagCount: input.hashtags.length });
const sandbox = { result: "", attemptInstructions: "제목 상품명 보완", diagnostic: before.summary,
  snapshot: { fixture: true }, selected: draft, allowedIndexes: scope, allowCandidateTitleChange: true,
  titleOnlyRepair: true, qualityConvergence: true, allowCandidateSectionHeadingChange: false,
  formatWritingPromptContract, writingContract, prewritingPhotoProof: undefined,
  savedPhotoPlan: promptComposition.sections.slice(0, -1).map(section => ({ sectionId: section.id, title: section.title,
    imageSource: section.imageSource || "none", imageIntent: section.imageIntent, promptRecipe: section.promptRecipe || null,
    imageMin: section.imageMin ?? 0, imageMax: section.imageMax ?? 1 })) };
vm.runInNewContext(emitted, sandbox);
const actualPrompt = JSON.parse(sandbox.result);
assert.deepEqual(actualPrompt.allowedIndexes, []);
assert.deepEqual(actualPrompt.output, { title: "수정한 글 제목", updates: [] });
assert.match(actualPrompt.rules, /updates는 반드시 빈 배열/u);
assert.deepEqual(actualPrompt.sections, sections.map((text, index) => ({ index, text })));
assert.equal(actualPrompt.writingHarness, formatWritingPromptContract(writingContract), "the actual production formatter remains part of the title-only request");
assert.deepEqual(actualPrompt.savedPhotoPlan, sandbox.savedPhotoPlan, "title-only requests retain the saved photo plan without changing the body scope");
assert.match(actualPrompt.photoRevisionRule, /외형 묘사를 추가·변경하지/u, "an unattached original cannot authorize a visual rewrite while fixing only the title");

// Legacy saved layouts have early/final cards, captions and image placement
// which are not fully represented by the revision caller's partial sectionPlan.
// Run the actual writer resolver with a one-sentence edit, offline.
assert.ok(revisionComposition);
const claim = "사진에는 상품을 세로와 가로 방향으로 세운 모습이 담겼어요.";
const photoPaths = Array.from({ length: 5 }, (_, index) => `fixture/photo-${index}.png`);
const photoSections = [
  `사용 조건\n\n${claim} 책상에서 제품을 고를 때 확인할 정보를 정리합니다.\n\n사양과 호환 범위를 구분해 판단합니다.`,
  ...Array.from({ length: 4 }, (_, index) => `구매 기준 ${index + 1}\n\n기존에 검증한 본문의 사실과 문단은 그대로 유지합니다.`),
];
const saved = normalizePublishedPostText(resolvePostDocument({ connectKind: "SHOPPING", title: "테스트 상품 선택 기준",
  sections: [...photoSections, disclosure], hashtags: ["상품", "구매", "선택"], imagePaths: photoPaths,
  sectionImagePaths: [[photoPaths[1]], [photoPaths[2]], [photoPaths[3]], [], [photoPaths[4]]], connectUrl: "https://example.test/affiliate" }));
const legacyParagraphs = saved.renderNodes.filter(node => node.kind === "paragraph" && node.sectionId === saved.sections[0].id);
let keptLegacyParagraph = false;
saved.renderNodes = saved.renderNodes.flatMap(node => {
  if (node.kind !== "paragraph" || node.sectionId !== saved.sections[0].id) return [node];
  if (keptLegacyParagraph) return [];
  keptLegacyParagraph = true;
  return [{ ...node, text: legacyParagraphs.map(part => part.kind === "paragraph" ? part.text : "").join("\n\n") }];
});
assert.equal(saved.renderNodes.filter(node => node.kind === "connectCard").length, 2);
const firstSectionId = saved.sections[0].id;
const originalImage = saved.renderNodes.find(node => node.kind === "image" && node.sectionId === firstSectionId)!;
assert.equal(originalImage.kind === "image" && originalImage.caption, "판매페이지 원본 상품 사진");
const revisionSandbox: { resolve?: (candidate: { title: string; sections: string[]; hashtags: string[] }) => ResolvedPostDocumentV1; [key: string]: unknown } = {
  prepared: { composition: saved }, preservePreparedRevisionRenderPlan, normalizePublishedPostText, resolvePostDocument,
  connectKind: "SHOPPING", name: "테스트 상품", link: { url: "https://example.test/affiliate" }, imagePaths: photoPaths,
  BRANDLINK_QUALITY_PRESET: "PREMIUM", BRANDLINK_EXPERIENCE_MODE: "AI_ASSISTED_INFORMATION",
};
vm.runInNewContext(ts.transpileModule(`this.resolve = ${revisionComposition.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, revisionSandbox);
const updatedText = { title: saved.title, sections: [...photoSections.map((text, index) => index === 0 ? text.replace(claim, "") : text), disclosure], hashtags: ["상품", "구매", "선택"] };
const preserved = revisionSandbox.resolve!(updatedText);
assert.deepEqual(preserved.sections.slice(1), saved.sections.slice(1), "all untargeted section fields remain identical");
assert.deepEqual(preserved.sections[0].imagePaths, saved.sections[0].imagePaths);
assert.equal(preserved.sections[0].imageIntent, saved.sections[0].imageIntent);
assert.equal(preserved.sections[0].imageSource, saved.sections[0].imageSource);
assert.equal(preserved.sections[0].imagePlacement, saved.sections[0].imagePlacement);
assert.equal(preserved.renderNodes.length, saved.renderNodes.length);
saved.renderNodes.forEach((node, index) => {
  const afterNode = preserved.renderNodes[index];
  if (node.kind === "paragraph" && node.sectionId === firstSectionId) {
    assert.equal(afterNode.kind, "paragraph");
    assert.equal(node.text.replace(claim, ""), afterNode.kind === "paragraph" && afterNode.text,
      "only the quoted literal is removed; old paragraph separators and adjacent spaces are retained");
  } else assert.deepEqual(afterNode, node, "images, captions, order, early/final CTA, notices and untargeted text are immutable");
});
assert.deepEqual(saved.sections[0].body, normalizePublishedPostText(resolvePostDocument({ connectKind: "SHOPPING", title: saved.title,
  sections: [...photoSections, disclosure], hashtags: ["상품", "구매", "선택"], imagePaths: photoPaths,
  sectionImagePaths: [[photoPaths[1]], [photoPaths[2]], [photoPaths[3]], [], [photoPaths[4]]], connectUrl: "https://example.test/affiliate" })).sections[0].body,
"the helper never mutates its saved-layout input");
const restored = preservePreparedRevisionRenderPlan(saved, preserved);
assert.deepEqual(restored.renderNodes, preserved.renderNodes, "the same pure helper can restore a saved layout around already corrected section text");
assert.deepEqual(preservePreparedRevisionRenderPlan(saved, { ...saved, title: "수정된 제목" }).renderNodes, saved.renderNodes,
  "title-only edits cannot reassemble body, images or CTA");
assert.throws(() => preservePreparedRevisionRenderPlan(saved, { ...saved, sections: saved.sections.slice(1) }), /REVISION_RENDER_SCOPE_AMBIGUOUS/);
assert.throws(() => preservePreparedRevisionRenderPlan(saved, { ...saved, sections: [...saved.sections].reverse() }), /REVISION_RENDER_SCOPE_AMBIGUOUS/);
const unknownRender = structuredClone(saved);
const paragraphIndex = unknownRender.renderNodes.findIndex(node => node.kind === "paragraph" && node.sectionId === firstSectionId);
unknownRender.renderNodes[paragraphIndex] = { kind: "paragraph", sectionId: firstSectionId, text: "본문과 대응하지 않는 별도 렌더 문장" };
assert.throws(() => preservePreparedRevisionRenderPlan(unknownRender, preserved), /REVISION_RENDER_SCOPE_AMBIGUOUS/);
const splitBlocks = structuredClone(saved);
splitBlocks.renderNodes.splice(paragraphIndex, 1,
  { kind: "paragraph", sectionId: firstSectionId, text: splitBlocks.sections[0].body[0] },
  { kind: "divider", sectionId: null },
  { kind: "paragraph", sectionId: firstSectionId, text: splitBlocks.sections[0].body.slice(1).join("\n") });
const splitResult = preservePreparedRevisionRenderPlan(splitBlocks, preserved);
assert.equal(splitResult.renderNodes.length, splitBlocks.renderNodes.length);
assert.deepEqual(splitResult.renderNodes[paragraphIndex + 1], splitBlocks.renderNodes[paragraphIndex + 1], "saved block boundaries keep intervening layout nodes");
assert.deepEqual(splitResult.renderNodes[paragraphIndex + 2], splitBlocks.renderNodes[paragraphIndex + 2], "unchanged text blocks retain exact bytes");
const changedCardinality = structuredClone(preserved);
changedCardinality.sections[0].body.push("새 문단 경계를 임의로 추정하지 않습니다.");
assert.throws(() => preservePreparedRevisionRenderPlan(splitBlocks, changedCardinality), /REVISION_RENDER_SCOPE_AMBIGUOUS/);

// The public revision API fixes section identity/count, not the internal body
// paragraph count. One exact saved render block can own a safe split or merge.
const threeParagraphs = ["첫 문단의 확인된 상품 설명입니다.", "두 번째 문단의 확인된 사용 조건입니다.", "세 번째 문단의 확인된 구매 기준입니다."];
const threeBodySaved = structuredClone(saved);
threeBodySaved.sections[0] = { ...threeBodySaved.sections[0], body: threeParagraphs, characterCount: threeParagraphs.join("").length };
threeBodySaved.renderNodes[paragraphIndex] = { ...threeBodySaved.renderNodes[paragraphIndex], kind: "paragraph", sectionId: firstSectionId, text: threeParagraphs.join("\n\n") };
(revisionSandbox.prepared as { composition: ResolvedPostDocumentV1 }).composition = threeBodySaved;
for (const revisedBody of [
  [threeParagraphs[0], "두 번째 문단을 안전하게 나눈 앞부분입니다.", "두 번째 문단을 나눈 뒷부분입니다.", threeParagraphs[2]],
  [threeParagraphs[0], `${threeParagraphs[1]} ${threeParagraphs[2]}`],
]) {
  const revisedSections = [`${threeBodySaved.sections[0].title}\n\n${revisedBody.join("\n\n")}`, ...photoSections.slice(1), disclosure];
  const result = revisionSandbox.resolve!({ title: threeBodySaved.title, sections: revisedSections, hashtags: ["상품", "구매", "선택"] });
  assert.deepEqual(result.sections[0].body, revisedBody, `actual writer accepts 3→${revisedBody.length} within one exact owned render block`);
  assert.deepEqual(result.sections.slice(1), threeBodySaved.sections.slice(1));
  assert.equal(result.renderNodes.length, threeBodySaved.renderNodes.length);
  result.renderNodes.forEach((node, index) => {
    if (index === paragraphIndex) assert.equal(node.kind === "paragraph" && node.text, revisedBody.join("\n\n"));
    else assert.deepEqual(node, threeBodySaved.renderNodes[index], "all non-target nodes, photo paths/captions and both CTAs stay exact");
  });
  const otherBlock = structuredClone(threeBodySaved);
  otherBlock.renderNodes[paragraphIndex] = { kind: "paragraph", sectionId: firstSectionId,
    text: "원래 본문 전체에 대응하지 않는 별도 문장이 섞여 있습니다." };
  assert.throws(() => preservePreparedRevisionRenderPlan(otherBlock, result), /REVISION_RENDER_SCOPE_AMBIGUOUS/);
  const compactOnly = structuredClone(threeBodySaved);
  compactOnly.renderNodes[paragraphIndex] = { kind: "paragraph", sectionId: firstSectionId, text: threeParagraphs.join("").replace(/\s/gu, "") };
  assert.throws(() => preservePreparedRevisionRenderPlan(compactOnly, result), /REVISION_RENDER_SCOPE_AMBIGUOUS/,
    "compact text equality alone cannot authorize a cardinality-changing rewrite");
}
(revisionSandbox.prepared as { composition: ResolvedPostDocumentV1 }).composition = saved;

console.log("Title-only/section material repair: strict JSON scope, legacy exact layout/caption/CTA preservation and actual writer single-block 3→4/3→2 paragraph revisions passed");

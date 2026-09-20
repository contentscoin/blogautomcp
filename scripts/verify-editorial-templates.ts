import assert from "node:assert/strict";
import { createEditorialSelection, selectEditorialTemplate, EDITORIAL_TEMPLATES, listEditorialSectionDesigns } from "./lib/editorial-templates";
import { createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";
import { renderSystemPrompt } from "./lib/post-spec/generate";
import type { PostSpec } from "./lib/post-spec/types";
import { resolvePostDocument } from "../src/lib/post-composition-contract";
import {
  batchSectionParagraphs,
  createEditorialBodyStyleState,
  invalidateBodyStyle,
  markBodyStyleReady,
  shouldApplyBodyStyle,
} from "./lib/editorial-batch-write";

const fixtures = [
  ["SHOPPING", "수납 공간 부족", "shopping-problem"],
  ["SHOPPING", "규격 2종 선택", "shopping-comparison"],
  ["SHOPPING", "소재와 세척 관리", "shopping-detail"],
  ["TRAVEL", "1일차 서울 방문, 2일차 부산 방문", "travel-itinerary"],
  ["TRAVEL", "해안 산책로", "travel-scenic"],
  ["TRAVEL", "숙박 미확정, 식사 불포함", "travel-conditions"],
] as const;
assert.equal(Object.keys(EDITORIAL_TEMPLATES).length, 6);
assert.equal(new Set(Object.values(EDITORIAL_TEMPLATES).map(t => t.persona)).size, 6);
for (const [kind, description, id] of fixtures) {
  const product = { name: "상품", description };
  const editorial = createEditorialSelection(kind, product);
  assert.equal(editorial.id, id);
  assert.equal(editorial.policy.writeMode, "batch");
  assert.equal(editorial.policy.citation?.headingForm, "question");
  assert.equal(editorial.policy.citation?.faqPairs, 3);
  assert.ok(listEditorialSectionDesigns(id).length >= 6, "category templates define section designs");
  const contract = createWritingPromptContract({ kind, product, minimumSections: 8, maximumSections: 11,
    targetCharacters: { min: 2400, max: 4200 }, hashtagCount: 4 });
  const formatted = formatWritingPromptContract(JSON.parse(JSON.stringify(contract)));
  assert.ok(formatted.includes(id));
  assert.ok(formatted.includes("질문형"), "writing contract requires question-form headings");
  assert.ok(formatted.includes("FAQ"), "writing contract requires FAQ pairs");
  const spec = { connectKind: kind, productName: product.name, brief: null,
    facts: { lines: [description], travel: null, blockedClaimRules: ["QC sentinel"] } } as unknown as PostSpec;
  assert.ok(renderSystemPrompt(spec, {}).includes(id));
  assert.ok(renderSystemPrompt(spec, {}).includes("QC sentinel"));
  const input = { connectKind: kind, title: "unrelated article title", sections: ["첫 장소\n\n설명입니다.\n조건입니다.\n한계입니다.", "다음 장소\n\n다른 설명입니다."],
    hashtags: [], imagePaths: ["hero.jpg", "a.jpg", "b.jpg"], sectionImagePaths: [["b.jpg"], ["a.jpg"]], connectUrl: "https://example.com" };
  const baseline = resolvePostDocument(input);
  const selected = resolvePostDocument({ ...input, editorial });
  assert.deepEqual(selected.renderNodes.filter(n => n.kind === "image"), baseline.renderNodes.filter(n => n.kind === "image"), "Images keep section IDs and order");
  assert.deepEqual(selected.renderNodes.filter(n => ["connectCard", "disclosure", "heading"].includes(n.kind)), baseline.renderNodes.filter(n => ["connectCard", "disclosure", "heading"].includes(n.kind)), "Factual heading order, links and disclosure preserved");
  assert.deepEqual(selected.qualityReport, baseline.qualityReport, "QC is unchanged");
  assert.deepEqual(JSON.parse(JSON.stringify(selected)).editorial, editorial);
  const firstId = selected.sections[0].id;
  const nodes = selected.renderNodes.filter(n => "sectionId" in n && n.sectionId === firstId);
  const imageAt = nodes.findIndex(n => n.kind === "image");
  const headingAt = nodes.findIndex(n => n.kind === "heading");
  const bodyAt = nodes.findIndex(n => n.kind === "paragraph");
  const imageLayout = editorial.policy.sectionDesigns?.[firstId]?.image ?? editorial.policy.layout.image;
  if (imageLayout === "before-heading") assert.ok(imageAt < headingAt);
  if (imageLayout === "before-body") assert.ok(imageAt > headingAt && imageAt < bodyAt);
  if (imageLayout === "after-body") assert.ok(imageAt > nodes.map(n => n.kind).lastIndexOf("paragraph"));
  if (imageLayout === "after-lead") assert.equal(imageAt, bodyAt + 1);
  const body = nodes.filter(n => n.kind === "paragraph");
  // Batch write collapses sentence units into 1–2 body blocks per section.
  if (imageLayout === "after-lead") {
    assert.equal(body.length, 2);
  } else {
    assert.equal(body.length, 1);
  }
  assert.equal(body.map(n => n.text).join("").replace(/\s/g, ""), "설명입니다.조건입니다.한계입니다.");
  spec.editorial = editorial;
  spec.facts.lines = ["다른 근거"];
  assert.ok(renderSystemPrompt(spec, {}).includes(id), "Repair retains saved template despite changed facts");
  assert.deepEqual(editorial.applied, [], "Intent must not be reported as applied");
  assert.ok(editorial.unsupported.includes("saved-state-verification"));
}
assert.equal(selectEditorialTemplate("SHOPPING", { name: "최고 비교 상품" }), "shopping-problem");
assert.equal(selectEditorialTemplate("TRAVEL", { name: "1일차 완벽 일정" }), "travel-scenic");
assert.equal(selectEditorialTemplate("TRAVEL", { description: "식사 포함, 1일차 서울 방문, 호텔 미확정" }), "travel-itinerary");
assert.equal(selectEditorialTemplate("TRAVEL", { description: "왕복 항공 포함" }), "travel-scenic");

const packed = batchSectionParagraphs(["A.", "B.", "C."], 1, "after-lead");
assert.equal(packed.blocks.length, 2);
assert.equal(packed.lead, "A.");
assert.equal(packed.rest, "B.\n\nC.");
const styleState = createEditorialBodyStyleState();
assert.equal(shouldApplyBodyStyle(styleState, "sec-1"), true);
markBodyStyleReady(styleState, "sec-1");
assert.equal(shouldApplyBodyStyle(styleState, "sec-1"), false);
invalidateBodyStyle(styleState);
assert.equal(shouldApplyBodyStyle(styleState, "sec-1"), true);

console.log("PASS six selections, section designs, batch body nodes, style-once helpers, unchanged image order and QC");

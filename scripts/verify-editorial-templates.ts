import assert from "node:assert/strict";
import { createEditorialSelection, selectEditorialTemplate, EDITORIAL_TEMPLATES } from "./lib/editorial-templates";
import { createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";
import { renderSystemPrompt } from "./lib/post-spec/generate";
import type { PostSpec } from "./lib/post-spec/types";
import { resolvePostDocument } from "../src/lib/post-composition-contract";

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
  const contract = createWritingPromptContract({ kind, product, minimumSections: 8, maximumSections: 11,
    targetCharacters: { min: 2400, max: 4200 }, hashtagCount: 4 });
  assert.ok(formatWritingPromptContract(JSON.parse(JSON.stringify(contract))).includes(id));
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
  if (editorial.policy.layout.image === "before-heading") assert.ok(imageAt < headingAt);
  if (editorial.policy.layout.image === "before-body") assert.ok(imageAt > headingAt && imageAt < bodyAt);
  if (editorial.policy.layout.image === "after-body") assert.ok(imageAt > nodes.map(n => n.kind).lastIndexOf("paragraph"));
  if (editorial.policy.layout.image === "after-lead") assert.equal(imageAt, bodyAt + 1);
  const body = nodes.filter(n => n.kind === "paragraph");
  assert.equal(body.length, editorial.policy.layout.sentences === 2 ? 2 : 3);
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
console.log("PASS six selections, persisted prompts/render metadata, unchanged image order and QC, unsupported style reporting");

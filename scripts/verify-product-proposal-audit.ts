import assert from "node:assert/strict";
import { auditSectionProposals, type SectionProposal } from "./lib/product-section-proposal-audit";
import type { PublishImageAuditOptions, PublishImageAuditResult } from "./lib/publish-image-audit";

const proposals = Array.from({ length: 5 }, (_, i) => ({ targetIndex: 0, sourceSha256: `sha-${i}`, path: `photo-${i}` }));
const targets = [{ sectionId: "actual-section", sectionTitle: "AI 기능", sectionBody: ["AI 기능의 실제 설명"], imageIntent: "AI 기능 근거" }];
const select = (rows: SectionProposal[]) => rows.slice(0, 1);
function result(input: PublishImageAuditOptions, code?: "SEMANTIC_REJECTION" | "INVALID_REVIEW" | "INVALID_IMAGE" | "INVALID_CONTEXT"): PublishImageAuditResult {
  assert.deepEqual(input.composition.sections[0].body, targets[0].sectionBody);
  assert.equal(input.composition.sections[0].id, "actual-section");
  assert(input.composition.renderNodes.some(node => node.kind === "paragraph" && node.text === "AI 기능의 실제 설명"));
  const nodeIndex = input.composition.renderNodes.findIndex(node => node.kind === "image");
  const node = input.composition.renderNodes[nodeIndex];
  assert(node.kind === "image");
  return { ok: !code, checked: 1, images: [{ nodeIndex, assetPath: node.assetPath, sha256: node.assetPath.replace("photo-", "sha-") }], failures: code ? [{ nodeIndex,
    assetPath: "photo", code, reason: "일반 사진은 AI 기능을 입증하지 못함" }] : [] };
}
async function main() {
  let calls = 0;
  const rejected: string[] = [];
  const chosen = await auditSectionProposals({ productName: "삼성", targets, proposals, select,
    onRejected: row => rejected.push(row.path), audit: async input => result(input, ++calls === 1 ? "SEMANTIC_REJECTION" : undefined) });
  assert.equal(calls, 2); assert.equal(chosen[0].path, "photo-1"); assert.deepEqual(rejected, ["photo-0"]);
  calls = 0;
  const exhausted = await auditSectionProposals({ productName: "삼성", targets, proposals, select,
    onRejected() {}, audit: async input => { calls++; return result(input, "SEMANTIC_REJECTION"); } });
  assert.equal(calls, 3); assert.deepEqual(exhausted, []);
  calls = 0;
  await assert.rejects(auditSectionProposals({ productName: "삼성", targets, proposals, select,
    onRejected() {}, audit: async () => { calls++; throw new Error("AUTH_REQUIRED: login"); } }), /AUTH_REQUIRED/);
  assert.equal(calls, 1);
  // One image's malformed verdict or undecodable file rejects only that proposal; the next one is tried.
  for (const code of ["INVALID_REVIEW", "INVALID_IMAGE"] as const) {
    calls = 0;
    const perImage: string[] = [];
    const recovered = await auditSectionProposals({ productName: "삼성", targets, proposals, select,
      onRejected: row => perImage.push(row.path), audit: async input => result(input, ++calls === 1 ? code : undefined) });
    assert.equal(recovered[0].path, "photo-1", code);
    assert.deepEqual(perImage, ["photo-0"], code);
  }
  await assert.rejects(auditSectionProposals({ productName: "삼성", targets, proposals, select,
    onRejected() {}, audit: async input => result(input, "INVALID_CONTEXT") }), /INVALID_CONTEXT/, "context errors still stop the replan");
  await assert.rejects(auditSectionProposals({ productName: "삼성", targets, proposals, select,
    onRejected() {}, audit: async input => ({ ...result(input), images: [{ nodeIndex: 2, assetPath: "photo-0", sha256: "changed" }] }) }), /IMAGE_CHANGED/);
  const selectedProduct = JSON.stringify({ name: "삼성", optionFacts: ["색상: 화이트"] });
  await auditSectionProposals({ productName: "삼성", selectedProduct, targets, proposals, select, onRejected() {},
    audit: async input => { assert.equal(input.selectedProduct, selectedProduct); return result(input); } });
  console.log("PASS proposal final-rule audit: mismatched feature rejected, alternate accepted, bounded exhaustion, exact context, per-image failures drop only that proposal, auth and context errors stop");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

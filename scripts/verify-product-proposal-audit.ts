import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { auditSectionProposals, type SectionProposal } from "./lib/product-section-proposal-audit";
import { auditPublishImages, type PublishImageAuditOptions, type PublishImageAuditResult } from "./lib/publish-image-audit";

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
  // Exercise the real final pixel gate with an offline reviewer. The source hint
  // must survive proposal assembly without relaxing the actual published text.
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-source-hint-"));
  try {
    const file = path.join(fixtureDir, "seller-photo.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).png().toFile(file);
    const bytes = fs.readFileSync(file);
    const originalProposal = [{ targetIndex: 0, path: file, sourceSha256: crypto.createHash("sha256").update(bytes).digest("hex") }];
    const originalTarget = { sectionId: "selected-original", sectionTitle: "음식물처리기가 줄여주는 불편",
      sectionBody: ["선택한 상품의 외형을 보여주는 판매자 원본 사진입니다."],
      imageIntent: "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인", imageSource: "seller-original" as const };
    const verdict = (accepted: boolean, reason: string) => JSON.stringify({ reviews: [{ index: 1, accepted, identityMatches: true,
      notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false,
      singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true,
      reviewClass: "product-photo", reason }] });
    const seen: PublishImageAuditResult[] = [];
    const approved = await auditSectionProposals({ productName: "쿠쿠 음식물처리기", targets: [originalTarget], proposals: originalProposal,
      select, onRejected() {}, audit: async input => {
        assert.equal(input.composition.sections[0].imageSource, "seller-original", "the explicit source policy reaches the final audit");
        const audited = await auditPublishImages({ ...input, review: async call => {
          assert.match(call.userPrompt, /"allowProductPhoto":true/u, "an overview original is allowed beside prose");
          assert.match(call.userPrompt, /Even when allowProductPhoto=true, reject generic photos used as proof of a feature claim/u);
          return verdict(true, "A single unchanged photograph identifies the selected product without proving a function.");
        } });
        seen.push(audited); return audited;
      } });
    assert.equal(approved.length, 1, JSON.stringify(seen)); assert.equal(seen[0].ok, true);
    const featureBody = "이 사진이 소음 감소 효과를 증명합니다.";
    const rejectedReasons: string[] = [];
    const unsupported = await auditSectionProposals({ productName: "쿠쿠 음식물처리기",
      targets: [{ ...originalTarget, sectionBody: [featureBody] }], proposals: originalProposal, select,
      onRejected: (_row, reason) => rejectedReasons.push(reason), audit: input => auditPublishImages({ ...input, review: async call => {
        assert.match(call.userPrompt, /"allowProductPhoto":true/u);
        assert.ok(call.userPrompt.includes(featureBody), "the actual feature-evidence claim is retained for pixel review");
        assert.match(call.userPrompt, /Even when allowProductPhoto=true, reject generic photos used as proof of a feature claim/u);
        return verdict(false, "A static product photograph cannot prove the published noise-reduction assertion.");
      } }) });
    assert.deepEqual(unsupported, [], "a source hint cannot override a failed feature-claim pixel verdict");
    assert.match(rejectedReasons[0], /noise-reduction assertion/u);
    assert.deepEqual(fs.readFileSync(file), bytes, "source pixels remain unchanged");
    assert.deepEqual(originalTarget.sectionBody, ["선택한 상품의 외형을 보여주는 판매자 원본 사진입니다."], "the accepted manuscript context remains unchanged");
  } finally {
    // The only recursive removal is this verified OS-temp test directory.
    assert.ok(path.resolve(fixtureDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
  console.log("PASS proposal final-rule audit: mismatched feature rejected, alternate accepted, bounded exhaustion, exact context, per-image failures drop only that proposal, auth and context errors stop");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

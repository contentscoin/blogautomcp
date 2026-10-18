import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { auditSectionProposals, type SectionProposal } from "./lib/product-section-proposal-audit";
import { auditPublishImages, type PublishImageAuditOptions, type PublishImageAuditResult } from "./lib/publish-image-audit";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./lib/product-9canvas";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";

const proposals = Array.from({ length: 8 }, (_, i) => ({ targetIndex: 0, sourceSha256: `sha-${i}`, path: `photo-${i}` }));
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
  assert.equal(calls, 6); assert.deepEqual(exhausted, [], "bounded exhaustion never returns an unaudited reserve");
  calls = 0;
  const fourth = await auditSectionProposals({ productName: "삼성", targets, proposals, select,
    onRejected() {}, audit: async input => result(input, ++calls <= 3 ? "SEMANTIC_REJECTION" : undefined) });
  assert.equal(calls, 4); assert.equal(fourth[0].path, "photo-3", "fourth independently eligible candidate reaches the same final gate");
  calls = 0;
  let refills = 0;
  const renewed = await auditSectionProposals({ productName: "삼성", targets, proposals: proposals.slice(0, 3), select,
    replenish: async missing => { refills++; assert.deepEqual(missing, [0]); return [proposals[0], proposals[3]]; },
    onRejected() {}, audit: async input => result(input, ++calls <= 3 ? "SEMANTIC_REJECTION" : undefined) });
  assert.equal(refills, 1); assert.equal(calls, 4); assert.equal(renewed[0].path, "photo-3", "refill cannot reinstate rejected pairs");
  calls = 0;
  refills = 0;
  const boundedRenewal = await auditSectionProposals({ productName: "삼성", targets, proposals: proposals.slice(0, 3), select,
    replenish: async () => { refills++; return proposals.slice(3); }, onRejected() {},
    audit: async input => { calls++; return result(input, "SEMANTIC_REJECTION"); } });
  assert.equal(refills, 1); assert.equal(calls, 6); assert.deepEqual(boundedRenewal, [], "initial plus renewed audit calls share one six-round bound");
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
    const verdict = (accepted: boolean, reason: string, photoClaimMatches = true, exactBodyClaim = "") => JSON.stringify({ reviews: [{ index: 1, accepted, identityMatches: true, photoClaimMatches,
      photoClaimObjection: photoClaimMatches ? { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" }
        : { origin: "section-body", sourceIndex: 0, quote: exactBodyClaim, scope: "pictured-appearance", conflict: reason },
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
    const shokzBody = ["수영에서는 MP3 모드를 사용하고, 지상에서는 블루투스로 연결할 수 있습니다."];
    const shokzProduct = JSON.stringify({ name: "샥즈 오픈스윔 프로", optionFacts: ["색상: 오렌지", "저장공간: 32GB"] });
    const shokz = await auditSectionProposals({ productName: "샥즈 오픈스윔 프로", selectedProduct: shokzProduct,
      targets: [{ ...originalTarget, sectionTitle: "수영과 지상에서 쓰는 MP3·블루투스 기준", sectionBody: shokzBody }],
      proposals: originalProposal, select, onRejected() {}, audit: input => auditPublishImages({ ...input, review: async call => {
        assert.equal(input.selectedProduct, shokzProduct);
        assert.deepEqual(input.composition.sections[0].body, shokzBody);
        const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image"))!;
        const slots = JSON.parse(line.slice(line.indexOf("[")));
        assert.equal(slots[0].visualContract.purpose, "product-appearance");
        assert.deepEqual(slots[0].sectionBody, shokzBody);
        return verdict(true, "The selected orange exterior matches; technical prose alone does not demand every use scene.");
      } }) });
    assert.equal(shokz.length, 1, "proposal assembly and final gate accept an exterior original alongside swimming, land, MP3 and Bluetooth prose");
    const originalAction = await auditSectionProposals({ productName: "샥즈 오픈스윔 프로", selectedProduct: shokzProduct,
      targets: [{ ...originalTarget, sectionTitle: "원본 수영 사용 장면", sectionBody: ["이 사진에는 선택한 이어폰을 착용하고 수영하는 모습이 보입니다."],
        imageIntent: "선택 상품을 착용한 실제 수영 장면의 판매자 원본" }], proposals: originalProposal, select, onRejected() {},
      audit: input => auditPublishImages({ ...input, review: async call => {
        assert.ok(call.userPrompt.includes("착용하고 수영하는 모습이 보입니다"), "explicit action description must reach the pixel gate unchanged");
        return verdict(true, "The plain product packshot contains no person or swimming action claimed in the published photograph description.", false,
          "이 사진에는 선택한 이어폰을 착용하고 수영하는 모습이 보입니다.");
      } }) });
    assert.deepEqual(originalAction, [], "a white packshot cannot satisfy an explicit original action-photo claim");
    const featureBody = "이 사진이 소음 감소 효과를 증명합니다.";
    const rejectedReasons: string[] = [];
    const unsupported = await auditSectionProposals({ productName: "쿠쿠 음식물처리기",
      targets: [{ ...originalTarget, sectionBody: [featureBody] }], proposals: originalProposal, select,
      onRejected: (_row, reason) => rejectedReasons.push(reason), audit: input => auditPublishImages({ ...input, review: async call => {
        assert.match(call.userPrompt, /"allowProductPhoto":true/u);
        assert.ok(call.userPrompt.includes(featureBody), "the actual feature-evidence claim is retained for pixel review");
        assert.match(call.userPrompt, /Even when allowProductPhoto=true, reject generic photos used as proof of a feature claim/u);
        return verdict(true, "A static product photograph cannot prove the published noise-reduction assertion.", false, featureBody);
      } }) });
    assert.deepEqual(unsupported, [], "a source hint cannot override a failed feature-claim pixel verdict");
    assert.match(rejectedReasons[0], /사진을 기능·성능·결과의 증거/u);
    assert.match(rejectedReasons[0], /noise-reduction assertion/u);
    const beefProduct = selectedProductContextFrom9Canvas(buildProduct9Canvas({ name: "한우 선물세트",
      description: "미검증 원시 설명", features: ["부위: 등심, 채끝, 차돌박이, 앞다리, 설도", "중량: 1200g"] }));
    for (const fixture of [
      { name: "included exterior", body: "세트에 포함된 차돌박이의 외형을 보여줍니다.", accepted: true, identityMatches: true, photoClaimMatches: true, noGraphicLayout: true },
      { name: "wrong cut", body: "세트에 포함된 차돌박이의 외형을 보여줍니다.", accepted: true, identityMatches: false, photoClaimMatches: true, noGraphicLayout: true },
      { name: "unresolved membership", body: "세트에 포함된 차돌박이의 외형을 보여줍니다.", accepted: false, identityMatches: false, photoClaimMatches: true, noGraphicLayout: true },
      { name: "unsupported whole-set promise", body: "이 사진에 구매할 1200g 세트의 전 구성품이 보입니다.", accepted: true, identityMatches: true, photoClaimMatches: false, noGraphicLayout: true },
      { name: "added explanatory panel", body: "세트에 포함된 차돌박이의 외형을 보여줍니다.", accepted: true, identityMatches: true, photoClaimMatches: true, noGraphicLayout: false },
    ]) {
      let pixelCalls = 0;
      const outcome = await auditSectionProposals({ productName: "한우 선물세트", selectedProduct: beefProduct,
        targets: [{ ...originalTarget, sectionTitle: "포함 부위의 외형", sectionBody: [fixture.body] }], proposals: originalProposal,
        select, onRejected() {}, audit: input => auditPublishImages({ ...input, review: async call => {
          pixelCalls++;
          assert.equal(input.selectedProduct, beefProduct);
          assert.ok(call.userPrompt.includes("부위: 등심, 채끝, 차돌박이, 앞다리, 설도"));
          assert.ok(call.userPrompt.includes(fixture.body));
          assert.ok(!call.userPrompt.includes("미검증 원시 설명"));
          const answer = JSON.parse(verdict(fixture.accepted, fixture.name, fixture.photoClaimMatches, fixture.body));
          answer.reviews[0].identityMatches = fixture.identityMatches;
          answer.reviews[0].noGraphicLayout = fixture.noGraphicLayout;
          return JSON.stringify(answer);
        } }) });
      assert.equal(outcome.length, fixture.name === "included exterior" ? 1 : 0, fixture.name);
      assert.equal(pixelCalls, 1, "an adverse final verdict cannot be automatically reversed");
    }
    const sourceDirectory = path.join(fixtureDir, "canonical-gallery"); fs.mkdirSync(sourceDirectory);
    const urls = [1, 2, 3].map(index => `https://shop-phinf.pstatic.net/fixture/original-${index}.png`);
    for (let index = 0; index < urls.length; index++) {
      const comparison = path.join(sourceDirectory, `original-${index + 1}.png`);
      if (index === 2) fs.copyFileSync(file, comparison);
      else await sharp({ create: { width: 320, height: 240, channels: 3, background: index ? "#dddddd" : "#bbbbbb" } }).png().toFile(comparison);
      fs.writeFileSync(`${comparison}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: urls[index],
        sha256: crypto.createHash("sha256").update(fs.readFileSync(comparison)).digest("hex"), retrievedAt: new Date().toISOString() }));
    }
    const sourceSnapshot = createProductSnapshot({ productId: "canonical-proposal-fixture", connectKind: "SHOPPING",
      externalProductId: "selected-sku", sourceUrl: "https://brand.naver.com/fixture/products/1",
      product: { name: "선택 상품", features: ["선택 옵션 화이트"], referenceImageUrls: urls } });
    const canonical = { selectedSourceSnapshot: sourceSnapshot, selectedSourceProductId: sourceSnapshot.productId,
      selectedSourceDirectory: sourceDirectory, sourceSnapshotId: sourceSnapshot.snapshotId };
    let proposalInput: PublishImageAuditOptions | undefined;
    let proposalPrompt = "", proposalAttachmentShas: string[] = [];
    const sameContext = await auditSectionProposals({ ...canonical, productName: "선택 상품", selectedProduct: "same canonical selected facts",
      targets: [originalTarget], proposals: originalProposal, select, onRejected() {}, audit: async input => {
        proposalInput = input;
        assert.equal(input.selectedSourceSnapshot, sourceSnapshot);
        assert.equal(input.selectedSourceDirectory, sourceDirectory);
        return auditPublishImages({ ...input, review: async call => {
          proposalPrompt = call.userPrompt;
          proposalAttachmentShas = call.imagePaths!.map(image => crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex"));
          assert.equal(call.imagePaths!.length, 4, "the exact original outside the first two gallery references is comparison-only evidence");
          assert.match(call.userPrompt, /Canonical selected source:/u);
          assert.match(call.userPrompt, /"selectedGalleryComparisonImageIndexes":\[2,3,4\]/u);
          return verdict(true, "Visible selected component matches its own canonical source; no claim is inferred from source lineage.");
        } });
      } });
    assert.equal(sameContext.length, 1);
    const publication = await auditPublishImages({ ...proposalInput!, review: async call => {
      assert.equal(call.userPrompt, proposalPrompt, "source-final and publication-final assemble the same product, text, source and indexed comparison context");
      assert.deepEqual(call.imagePaths!.map(image => crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex")), proposalAttachmentShas);
      return verdict(true, "Same unchanged input.");
    } });
    assert.equal(publication.ok, true);
    for (const badContext of [{ ...canonical, sourceSnapshotId: "f".repeat(64) },
      { ...canonical, selectedSourceProductId: "another-product" },
      { ...canonical, selectedSourceSnapshot: { ...sourceSnapshot, product: { ...sourceSnapshot.product, features: ["unbound option"] } } }]) {
      let modelCalls = 0;
      await assert.rejects(auditSectionProposals({ ...badContext, productName: "selected", targets: [originalTarget], proposals: originalProposal,
        select, onRejected() {}, audit: input => auditPublishImages({ ...input, review: async () => { modelCalls++; return verdict(true, "must not execute"); } }) }), /INVALID_CONTEXT/u);
      assert.equal(modelCalls, 0, "invalid canonical context cannot receive a model approval");
    }
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

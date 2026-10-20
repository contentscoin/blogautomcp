import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { auditPublishImages, assertPublishImagesSafe, type PublishImageAuditOptions } from "./lib/publish-image-audit";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { recordPublicationImageRejections, rejectedPublicationImageHashes } from "./lib/publish-image-rejections";
import { PRODUCT_IMAGE_BODY_TEXT_RULE_EN, PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO } from "./lib/product-image-visual-contract";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";
import { runMaterialPreparation } from "./lib/scheduled-draft-workflow";

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const slot = (call: CodexDraftOptions): { exactCanonicalSellerOriginal: boolean; textPolicy: string } => {
  const line = call.userPrompt.split("\n").find(text => text.startsWith("Each attached image belongs ONLY"))!;
  return JSON.parse(line.slice(line.indexOf("[")))[0];
};
const good = { index: 1, reason: "Offline contract fixture: coherent selected product photograph with its original plain source-brand watermark",
  photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" }, identityMatches: true,
  photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false,
  singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", accepted: true };
const response = (patch = {}) => JSON.stringify({ reviews: [{ ...good, ...patch }] });

async function main() {
  // Injected reviewers test binding/decision propagation, not model accuracy.
  // No provider, network, live material, image edits or approval bypass is used.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-watermark-"));
  const previous = process.env.DESKTOP_USER_DATA; process.env.DESKTOP_USER_DATA = root;
  let checks = 0;
  try {
    const source = path.join(root, "source.png"), final = path.join(root, "final.png"), other = path.join(root, "other.png");
    await sharp({ create: { width: 340, height: 340, channels: 3, background: "gray" } }).png().toFile(source);
    await sharp({ create: { width: 340, height: 340, channels: 3, background: "white" } }).png().toFile(other);
    fs.copyFileSync(source, final);
    const sourceUrl = "https://shop-phinf.pstatic.net/selected/mat-original.png?type=w860";
    const receipt = `${source}.retrieval.json`;
    const receiptBytes = JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
      sha256: hash(source), retrievedAt: new Date(Date.now() - 1000).toISOString() });
    fs.writeFileSync(receipt, receiptBytes);
    const snapshot = createProductSnapshot({ productId: "watermark-fixture", externalProductId: "selected-mat", connectKind: "SHOPPING",
      sourceUrl: "https://smartstore.naver.com/selected/products/123456", product: {
        name: "selected gray heated mat", features: ["gray quilted mat"], referenceImageUrls: [sourceUrl] } });
    const fixture = (): PublishImageAuditOptions => ({ productName: "selected gray heated mat", sourceSnapshotId: snapshot.snapshotId,
      selectedSourceSnapshot: structuredClone(snapshot), selectedSourceProductId: snapshot.productId, selectedSourceDirectory: root,
      imageAssets: [{ path: final, sourcePath: source, sha256: hash(final), role: "body", sectionId: "exterior",
        provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false }],
      composition: { sections: [{ id: "exterior", title: "상품 외형 확인", body: ["선택 매트의 외형 참고 사진입니다."], characterCount: 30,
        imagePaths: [final], imageIntent: "판매페이지 원본 상품 사진: 선택 상품 외형", imageSource: "seller-original", headingStyle: "plain" }],
      renderNodes: [{ kind: "heading", sectionId: "exterior", text: "상품 외형 확인" },
        { kind: "paragraph", sectionId: "exterior", text: "선택 매트의 외형 참고 사진입니다." },
        { kind: "image", sectionId: "exterior", assetPath: final, role: "detail", altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] },
      review: async call => {
        assert.equal(slot(call).exactCanonicalSellerOriginal, true);
        assert.match(slot(call).textPolicy, /unchanged nonexplanatory source-brand watermark only/u);
        assert(call.userPrompt.includes(PRODUCT_IMAGE_BODY_TEXT_RULE_EN));
        assert.match(call.userPrompt, /never permits a product-name headline, promotional\/efficacy copy/u);
        return response();
      } });
    const originalHashes = [source, final, other, receipt].map(hash);
    assert.equal((await auditPublishImages(fixture())).ok, true); checks++;
    assert(PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO.includes("exactCanonicalSellerOriginal=true")); checks++;
    for (const mode of ["ORIGINAL-string-only", "wrong-source-sha", "edited", "generated", "malformed-generation-flag", "wrong-creation-method", "forged-receipt", "unselected-gallery"] as const) {
      const options = fixture();
      if (mode === "ORIGINAL-string-only") {
        delete options.selectedSourceSnapshot; delete options.selectedSourceProductId; delete options.selectedSourceDirectory; delete options.sourceSnapshotId;
      }
      if (mode === "wrong-source-sha") options.imageAssets![0].sha256 = "a".repeat(64);
      if (mode === "edited") { fs.copyFileSync(other, final); options.imageAssets![0].sha256 = hash(final); }
      if (mode === "generated") options.imageAssets![0].remoteGenerated = true;
      if (mode === "malformed-generation-flag") options.imageAssets![0].remoteGenerated = "true" as unknown as boolean;
      if (mode === "wrong-creation-method") options.imageAssets![0].creationMethod = "local-composite";
      if (mode === "forged-receipt") fs.writeFileSync(receipt, JSON.stringify({ ...JSON.parse(receiptBytes), sha256: hash(other) }));
      if (mode === "unselected-gallery") {
        options.selectedSourceSnapshot = createProductSnapshot({ ...snapshot, product: { ...snapshot.product, referenceImageUrls: [] } });
        options.sourceSnapshotId = options.selectedSourceSnapshot.snapshotId;
      }
      let calls = 0;
      options.review = async call => { calls++; assert.equal(slot(call).exactCanonicalSellerOriginal, false, mode);
        assert.equal(slot(call).textPolicy, "BODY_NO_ADDED_TEXT: only intrinsic physical product printing is permitted");
        return response({ accepted: false, textPolicyMatches: false, reason: `${mode}: unbound/edited/generated source watermark is not permitted` }); };
      try { const result = await auditPublishImages(options); assert.equal(result.ok, false, mode); assert.equal(result.failures[0].code, "SEMANTIC_REJECTION", mode);
        assert.equal(calls, mode === "wrong-creation-method" ? 0 : 1, mode); checks++; }
      finally { fs.copyFileSync(source, final); fs.writeFileSync(receipt, receiptBytes); }
    }
    for (const [label, patch] of [
      ["product-name headline", { textPolicyMatches: false }], ["promotional text", { textPolicyMatches: false }],
      ["explanatory frame", { noGraphicLayout: false }], ["certification badge", { textPolicyMatches: false }],
      ["wrong product", { identityMatches: false }], ["severe distortion", { accepted: false }],
      ["false photographic claim", { photoClaimMatches: false, photoClaimObjection: { origin: "section-body", sourceIndex: 0,
        quote: "선택 매트의 외형 참고 사진입니다.", scope: "pictured-appearance", conflict: "Reviewer finds the actual exterior photograph contradicts the published assertion" } }],
    ] as const) {
      const options = fixture(); let calls = 0;
      options.review = async call => { calls++; assert.equal(slot(call).exactCanonicalSellerOriginal, true);
        return response({ ...patch, reason: `${label}: exact source lineage never overrides this adverse actual-pixel verdict` }); };
      const result = await auditPublishImages(options); assert.equal(result.ok, false); assert.equal(result.failures[0].code, "SEMANTIC_REJECTION");
      assert.equal(calls, 1, "no semantic retry to fish for approval"); checks++;
    }
    for (const mutation of ["asset", "source-receipt", "source-bytes"] as const) {
      const options = fixture();
      options.review = async call => { assert.equal(slot(call).exactCanonicalSellerOriginal, true);
        if (mutation === "asset") options.imageAssets![0].remoteGenerated = true;
        if (mutation === "source-receipt") fs.appendFileSync(receipt, "\n");
        if (mutation === "source-bytes") fs.copyFileSync(other, source);
        return response(); };
      try { assert.equal((await auditPublishImages(options)).failures[0].code, "IMAGE_CHANGED"); checks++; }
      finally { fs.copyFileSync(final, source); fs.writeFileSync(receipt, receiptBytes); }
    }
    const options = fixture(), id = snapshot.productId;
    const directory = path.join(root, "data", "prepared-brand-posts", id); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ brandLinkId: id, version: "brand-post-package/v2", composition: options.composition }));
    const historical = path.join(directory, "historical-job.json"), historyBytes = JSON.stringify({ code: "PUBLISH_IMAGE_AUDIT_FAILED", status: "FAILED" });
    fs.writeFileSync(historical, historyBytes);
    recordPublicationImageRejections(id, options.composition, [{ sha256: hash(final), sectionId: "exterior", scope: "product" },
      { sha256: hash(other), sectionId: "exterior", scope: "product" }]);
    await assertPublishImagesSafe({ ...options, brandLinkId: id, forceReview: true });
    assert.deepEqual(rejectedPublicationImageHashes(id, options.composition, "exterior"), [hash(other)],
      "only the freshly and completely reviewed exact source SHA is resolved");
    assert.equal(fs.readFileSync(historical, "utf8"), historyBytes); assert.deepEqual([source, final, other, receipt].map(hash), originalHashes); checks++;
    // The normal MCP/material repair path diagnoses retained rejected pixels
    // BEFORE binding sources or generating replacements. Its fresh full pixel
    // verdict resolves this one old source rejection and then approves normally.
    recordPublicationImageRejections(id, options.composition, [{ sha256: hash(final), sectionId: "exterior", scope: "product" }]);
    const actions: string[] = []; let backup = 0, approvals = 0, auditCalls = 0;
    const preview = () => {
      const rejected = rejectedPublicationImageHashes(id, options.composition, "exterior").includes(hash(final));
      return { connectKind: "SHOPPING", approvedAt: approvals ? "offline-current-approval" : null,
        approval: { canApprove: !rejected, blockers: rejected ? [{ code: "image-publication-rejected", sectionId: "exterior", reason: "저장된 정확 원본의 이전 최종 검수 거절" }] : [] },
        composition: { sections: [{ id: "exterior", imageSource: "seller-original" }] },
        imageGeneration: { status: "complete" }, imageSlots: [{ sectionId: "exterior", missing: rejected ? 1 : 0, generationMissing: 0 }],
        contentQuality: { signals: [] } };
    };
    await runMaterialPreparation(id, { pause: async () => {}, call: async (url, method, body) => {
      const action = (body as { action?: string })?.action || method; actions.push(action);
      assert(!url.endsWith("/images") && !["revise", "repair_photo_description", "prepare_context"].includes(action),
        "the normal preparation must not replace retained source pixels, write text or submit a generator");
      if (action === "audit_photo_descriptions" || action === "approve") {
        assert.equal(backup, 1);
        await assertPublishImagesSafe({ ...options, brandLinkId: id, review: async call => {
          auditCalls++; assert.equal(slot(call).exactCanonicalSellerOriginal, true); return response(); } });
        if (action === "approve") { assert(!preview().approval.blockers.length); approvals++; }
      }
      return { success: true, data: preview() };
    } }, { incrementalOnly: true, beforeRepair: async () => { backup++; } });
    assert.equal(actions.filter(action => action === "audit_photo_descriptions").length, 1);
    assert.equal(approvals, 1); assert.equal(auditCalls, 2, "diagnostic full QA and final approval both inspect exact retained pixels");
    assert.deepEqual(rejectedPublicationImageHashes(id, options.composition, "exterior"), [hash(other)]);
    assert.equal(fs.readFileSync(historical, "utf8"), historyBytes); assert.deepEqual([source, final, other, receipt].map(hash), originalHashes); checks++;
    console.log(`PASS seller-source watermark contract: ${checks} checks, canonical exact-byte proof, generated/forged/changed negatives, no verdict override, scoped prior-rejection recovery; zero provider calls`);
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

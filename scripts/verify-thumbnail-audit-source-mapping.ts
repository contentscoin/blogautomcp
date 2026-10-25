/** Offline incident regression: exact title-composite input + independent selected
 * gallery, no app data, native/image generation, network or publication calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import Ajv from "ajv";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { createOriginalProductPhotoThumbnail } from "./lib/product-image-lock";
import { readProductPhotoSource } from "./lib/product-photo-provenance";
import { LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT } from "./lib/lightweight-publication-review";
import type { auditPublishImages, PublishImageAuditOptions } from "./lib/publish-image-audit";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thumbnail-own-source-mapping-"));
  const oldData = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  let calls = 0, checks = 0;
  let policyContext: { localGates: string; schema: { properties: { contractVersion: { const: string }; reviews: { items: { properties: Record<string, unknown> } } } } } | undefined;
  let respond: (call: CodexDraftOptions) => Promise<string>;
  try {
    const productId = "selected-thumbnail-source-fixture", packageDir = path.join(root, "data/prepared-brand-posts", productId);
    const sourceDir = path.join(packageDir, "product-sources"), images = path.join(packageDir, "images");
    fs.mkdirSync(sourceDir, { recursive: true }); fs.mkdirSync(images, { recursive: true });
    const canonical = path.join(sourceDir, "selected-seller.jpg"), crop = path.join(images, "verified-region.png");
    await sharp({ create: { width: 640, height: 700, channels: 3, background: "#c7cbd1" } }).jpeg().toFile(canonical);
    await sharp({ create: { width: 340, height: 380, channels: 3, background: "#bcc2ca" } }).png().toFile(crop);
    const sourceUrl = "https://shop-phinf.pstatic.net/fixture/selected-seller.jpg";
    const canonicalReceiptPath = `${canonical}.retrieval.json`;
    fs.writeFileSync(canonicalReceiptPath, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
      sha256: hash(canonical), retrievedAt: new Date().toISOString() }));
    const snapshot = createProductSnapshot({ productId, connectKind: "SHOPPING", externalProductId: null,
      sourceUrl: "https://smartstore.naver.com/fixture/products/123", product: { name: "Selected white device", features: ["색상: 화이트"], referenceImageUrls: [sourceUrl] } });
    const thumbnail = await createOriginalProductPhotoThumbnail({ sourcePath: crop, outputDir: images,
      productName: "Selected white device", headline: "구매 전 확인", subline: "", style: "shopping-clean" });
    const receiptPath = `${thumbnail.outputPath}.source.json`, originalReceipt = fs.readFileSync(receiptPath);
    const source = readProductPhotoSource(thumbnail.outputPath)!;
    const input: PublishImageAuditOptions = { productName: "Selected white device", selectedProduct: "Selected white device; selected option white",
      sourceSnapshotId: snapshot.snapshotId, selectedSourceSnapshot: snapshot, selectedSourceProductId: productId, selectedSourceDirectory: sourceDir,
      imageAssets: [
        { path: thumbnail.outputPath, sourcePath: thumbnail.outputPath, sha256: hash(thumbnail.outputPath), role: "hero", sectionId: null,
          provenance: "PHOTO_TEXT_THUMBNAIL", creationMethod: "local-composite", remoteGenerated: false },
        { path: crop, sourcePath: crop, sha256: hash(crop), role: "body", sectionId: null,
          provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false },
      ], composition: { sections: [], renderNodes: [{ kind: "image", assetPath: thumbnail.outputPath, role: "thumbnail", sectionId: null,
        altText: "Selected white device", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] } };
    const auditFile = path.resolve("scripts/lib/publish-image-audit.ts"), actualRequire = createRequire(auditFile), exports: Record<string, unknown> = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(auditFile, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Buffer, process, console, structuredClone, setTimeout,
      require: (name: string) => {
        if (name === "./codex-draft-provider") return { runCodexDraft: async (call: CodexDraftOptions) => { calls++; return respond(call); } };
        const actual = actualRequire(name);
        return name === "./lightweight-publication-review" ? { ...actual, lightweightPublicationPolicyFingerprint: (context: typeof policyContext) => {
          policyContext = context; return actual.lightweightPublicationPolicyFingerprint(context);
        } } : actual;
      } });
    const audit = exports.auditPublishImages as typeof auditPublishImages;
    let lastRaw = "";
    const answer = (call: CodexDraftOptions, patch: Record<string, unknown> = {}, chosen?: { imageIndex: number; sha256: string }) => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"))!;
      const [slot] = JSON.parse(line.slice(line.indexOf("[")));
      const reference = slot.referencePlaneMap || (chosen ? { primaryReferenceImageIndex: chosen.imageIndex, primaryReferenceSha256: chosen.sha256 } : null);
      lastRaw = JSON.stringify({ contractVersion: LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, reviews: [{ index: 1,
        reason: "Actual selected-product geometry and confirmed white option correspond; no photographic performance claim.",
        visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
          { part: "housing", referenceObservation: "selected housing", candidateObservation: "matching housing" },
          { part: "base", referenceObservation: "selected base", candidateObservation: "matching base" }], conflict: "" },
        optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] },
        photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" },
        referenceComparison: reference ? { primaryReferenceImageIndex: reference.primaryReferenceImageIndex,
          primaryReferenceSha256: reference.primaryReferenceSha256, objectionKind: "none", observation: "The actual compared source and final geometry correspond; independent selected-gallery pixels support the same visible product/option." } : null,
        identityMatches: true, photoClaimMatches: true, notice: false, mixedOptions: false,
        explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true,
        textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", ...patch }] });
      return lastRaw;
    };
    respond = async call => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"))!;
      const [slot] = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slot.referencePlaneMap.primaryReferenceSha256, hash(crop), "use the exact title-composite input, not an arbitrary gallery photo");
      assert.equal(slot.thumbnailPhotoInput.canonicalOriginal, false, "a crop never gains canonical parent lineage");
      assert.match(slot.thumbnailPhotoInput.rule, /no asserted parent-crop lineage/u);
      assert.equal(slot.referencePlaneMap.supplementalReferences.length, 1);
      assert.equal(slot.referencePlaneMap.supplementalReferences[0].sha256, hash(canonical), "selected canonical product comparison remains mandatory");
      assert.equal(call.imagePaths!.length, 3, "final + exact local input + independent selected canonical source");
      const expected = await sharp(crop).raw().toBuffer();
      const actual = await sharp(call.imagePaths![slot.referencePlaneMap.primaryReferenceImageIndex - 1]).raw().toBuffer();
      assert.deepEqual(actual, expected, "comparison attachment preserves exact source pixels");
      assert(!JSON.stringify(call.outputSchema).includes('"accepted"'), "new native wire does not request duplicate aggregate approval");
      assert(!call.userPrompt.includes('"accepted":true'), "the native example omits aggregate approval as well as its schema");
      assert(call.userPrompt.includes(`"contractVersion":"${LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT}"`));
      return answer(call);
    };
    const before = [thumbnail.outputPath, crop, canonical, receiptPath, canonicalReceiptPath].map(hash);
    const good = await audit(input);
    assert.equal(good.ok, true, JSON.stringify(good.failures)); assert.equal(calls, 1);
    assert.equal(good.lightweightReviews![0].rawResponse, lastRaw);
    assert.equal(Object.hasOwn(JSON.parse(lastRaw).reviews[0], "accepted"), false);
    assert.equal(policyContext!.schema.properties.contractVersion.const, LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT);
    assert.equal(Object.hasOwn(policyContext!.schema.properties.reviews.items.properties, "accepted"), false,
      "success policy hashes the actual marker/noaggregate native contract rather than the old aggregate schema");
    assert.match(policyContext!.localGates, /-v3$/u);
    assert.deepEqual([thumbnail.outputPath, crop, canonical, receiptPath, canonicalReceiptPath].map(hash), before); checks += 18;

    // A real adverse selected-option comparison remains adverse; adding an own
    // source attachment never converts a model's negative gate into approval.
    respond = async call => answer(call, { identityMatches: false,
      visibleIdentityEvidence: { basis: "concrete-conflict", landmarks: [{ part: "selected colour", referenceObservation: "white", candidateObservation: "black" }], conflict: "A distinguishable confirmed-option contradiction" },
      referenceComparison: { primaryReferenceImageIndex: 2, primaryReferenceSha256: hash(crop), objectionKind: "concrete-conflict", observation: "Actual confirmed option conflict" } });
    const adverse = await audit(input);
    assert.equal(adverse.ok, false); assert(adverse.failures.some(row => row.code === "SEMANTIC_REJECTION")); checks += 2;

    // A source crop used as an ORIGINAL body photo has no exact canonical-SHA
    // primary. The native reader may honestly select a supplied canonical pair
    // instead of being forced to null, including the SECOND matching reference.
    const secondCanonical = path.join(sourceDir, "selected-white-second.jpg"), secondUrl = "https://shop-phinf.pstatic.net/fixture/selected-white-second.jpg";
    await sharp({ create: { width: 660, height: 740, channels: 3, background: "#d0d4d9" } }).jpeg().toFile(secondCanonical);
    fs.writeFileSync(`${secondCanonical}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: secondUrl,
      sha256: hash(secondCanonical), retrievedAt: new Date().toISOString() }));
    const bodySnapshot = createProductSnapshot({ productId, connectKind: "SHOPPING", externalProductId: null,
      sourceUrl: snapshot.sourceUrl, product: { ...snapshot.product, referenceImageUrls: [sourceUrl, secondUrl] } });
    const bodyInput: PublishImageAuditOptions = { ...input, sourceSnapshotId: bodySnapshot.snapshotId, selectedSourceSnapshot: bodySnapshot,
      imageAssets: input.imageAssets!.filter(asset => asset.role === "body"),
      composition: { sections: [{ id: "body", title: "선택 상품 외형", body: ["상품 외형 참고 사진입니다. 성능을 입증하지 않습니다."],
        characterCount: 33, imagePaths: [crop], imageMin: 1, imageMax: 1, imageSource: "seller-original", imageIntent: "선택 상품 외형 참고", headingStyle: "plain" }],
      renderNodes: [{ kind: "heading", sectionId: "body", text: "선택 상품 외형" },
        { kind: "paragraph", sectionId: "body", text: "상품 외형 참고 사진입니다. 성능을 입증하지 않습니다." },
        { kind: "image", sectionId: "body", assetPath: crop, role: "scene", altText: "선택 상품 외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] } };
    const selectedPair = (call: CodexDraftOptions) => {
      const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"))!;
      const [slot] = JSON.parse(line.slice(line.indexOf("[")));
      assert.equal(slot.referencePlaneMap, undefined, "no canonical primary is manufactured from a crop SHA");
      assert.equal(slot.availableCanonicalReferences.length, 2);
      const choice = slot.availableCanonicalReferences.find((row: { sha256: string }) => row.sha256 === hash(secondCanonical));
      assert(choice && choice.imageIndex !== slot.availableCanonicalReferences[0].imageIndex, "native fixture deliberately selects a non-first canonical source");
      return choice as { imageIndex: number; sha256: string };
    };
    respond = async call => answer(call, {}, selectedPair(call)); calls = 0;
    const body = await audit(bodyInput);
    assert.equal(body.ok, true, JSON.stringify(body.failures)); assert.equal(calls, 1);
    assert.equal(body.lightweightReviews![0].rawResponse, lastRaw); checks += 6;
    for (const conflict of ["candidate-index", "wrong-pair", "unattached-sha"]) {
      respond = async call => { const chosen = selectedPair(call); return answer(call, { referenceComparison: {
        primaryReferenceImageIndex: conflict === "candidate-index" ? 1 : conflict === "wrong-pair" ? chosen.imageIndex - 1 : chosen.imageIndex,
        primaryReferenceSha256: conflict === "unattached-sha" ? "f".repeat(64) : chosen.sha256,
        objectionKind: "none", observation: "Malformed source selection must remain held" } }, chosen); };
      const held = await audit(bodyInput);
      assert.equal(held.ok, false); assert(held.failures.every(row => row.code === "INVALID_REVIEW"));
      assert.equal(held.lightweightReviews![0].rawResponse, lastRaw); checks += 3;
    }
    respond = async call => { const chosen = selectedPair(call); return answer(call, { identityMatches: false,
      visibleIdentityEvidence: { basis: "concrete-conflict", landmarks: [{ part: "option", referenceObservation: "selected white", candidateObservation: "different black" }], conflict: "Actual confirmed-option mismatch" },
      referenceComparison: { primaryReferenceImageIndex: chosen.imageIndex, primaryReferenceSha256: chosen.sha256,
        objectionKind: "concrete-conflict", observation: "An actual visible option contradiction remains adverse" } }, chosen); };
    const bodyAdverse = await audit(bodyInput);
    assert.equal(bodyAdverse.ok, false); assert(bodyAdverse.failures.some(row => row.code === "SEMANTIC_REJECTION")); checks += 2;
    respond = async call => {
      selectedPair(call);
      const raw = answer(call, { identityMatches: false, referenceComparison: null,
        visibleIdentityEvidence: { basis: "insufficient-visible-structure", landmarks: [], conflict: "No sufficiently distinguishing observed product correspondence was established" } });
      assert(new Ajv().compile(call.outputSchema as object)(JSON.parse(raw)), "an unmapped slot permits honest null comparison in the actual native schema");
      return raw;
    };
    const nullComparison = await audit(bodyInput);
    assert.equal(nullComparison.ok, false); assert(nullComparison.failures.some(row => row.code === "SEMANTIC_REJECTION"));
    assert.equal(nullComparison.lightweightReviews![0].rawResponse, lastRaw); checks += 4;

    // Available canonical choices never override a thumbnail's fixed own input.
    respond = async call => answer(call, { referenceComparison: { primaryReferenceImageIndex: 3, primaryReferenceSha256: hash(canonical),
      objectionKind: "none", observation: "A different attached source cannot replace the fixed own primary" } });
    const ownChanged = await audit(input);
    assert.equal(ownChanged.ok, false); assert(ownChanged.failures.every(row => row.code === "INVALID_REVIEW")); checks += 2;

    // An exact byte copy in another product directory still cannot replace the
    // selected package's bound input. No first-gallery or filename fallback.
    const other = path.join(root, "data/prepared-brand-posts/other-product/photo.png");
    fs.mkdirSync(path.dirname(other), { recursive: true }); fs.copyFileSync(source.sourcePath, other);
    fs.writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(originalReceipt.toString()), sourcePath: other }));
    calls = 0; const foreign = await audit(input);
    assert.equal(foreign.ok, false); assert.equal(calls, 0); assert(foreign.failures.some(row => row.code === "INVALID_CONTEXT")); checks += 3;
    fs.writeFileSync(receiptPath, originalReceipt);
    const unbound = structuredClone(input); unbound.imageAssets = unbound.imageAssets!.filter(asset => asset.role !== "body");
    calls = 0; assert.equal((await audit(unbound)).ok, false); assert.equal(calls, 0); checks += 2;

    const canonicalReceipt = fs.readFileSync(canonicalReceiptPath); fs.unlinkSync(canonicalReceiptPath);
    calls = 0; const noGallery = await audit(input);
    assert.equal(noGallery.ok, false); assert.equal(calls, 0);
    assert(noGallery.failures.some(row => row.reason.includes("selected canonical gallery"))); checks += 3;
    fs.writeFileSync(canonicalReceiptPath, canonicalReceipt);
    respond = async call => { const raw = answer(call); fs.appendFileSync(receiptPath, " "); return raw; };
    const changed = await audit(input);
    assert.equal(changed.ok, false); assert(changed.failures.some(row => row.code === "IMAGE_CHANGED")); checks += 2;
    fs.writeFileSync(receiptPath, originalReceipt);
    assert.deepEqual([thumbnail.outputPath, crop, canonical, receiptPath, canonicalReceiptPath].map(hash), before);
    console.log(`PASS thumbnail audit own-source mapping: ${checks} contracts; original pixels preserved; actual native/network/generation calls 0`);
  } finally {
    if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData;
    assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

/** Offline execution-boundary regression: real local images and HMAC receipts;
 * only the native provider seam is stubbed. No remote or paid calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
import type { auditPublishImages, PublishImageAuditOptions } from "./lib/publish-image-audit";
import type { reviewShoppingReferenceScene } from "./lib/shopping-reference-scene";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";
import { REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION, referenceSceneReviewIssue } from "../src/lib/brand-post-image-evidence";
import { lightweightPublicationPolicyFingerprint, semanticPublicationReviewRequest, lightweightPublicationReferenceIssue } from "./lib/lightweight-publication-review";
import { brandPostApprovalBinding, brandPostCompatibleApprovalBindings, hasCurrentBrandPostApprovalReceipt } from "../src/lib/brand-post-approval-receipt";
import { writeSuccessfulImageAuditReceipt } from "./lib/publish-image-audit-receipt";
import { COMPATIBLE_STRICT_PUBLICATION_POLICIES, LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT } from "./lib/lightweight-publication-review";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { normalizePublishedPostText } from "../src/lib/post-composition-contract";
import type { BrandPostPackageManifest } from "../src/lib/brand-post-package";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lightweight-publication-review-"));
const previousData = process.env.DESKTOP_USER_DATA;
process.env.DESKTOP_USER_DATA = temporary;
const hash = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
let nativeCalls: CodexDraftOptions[] = [], forbiddenCalls = 0;
let respond: (call: CodexDraftOptions) => Promise<string>;
type ReviewBatchSchema = { properties: { reviews: { maxItems: number } } };
const nativeReviewResponse = (reviews: unknown[]) => JSON.stringify({ contractVersion: LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, reviews });
function load(relative: string, sourceOverride?: string) {
  const file = path.resolve(relative), nativeRequire = createRequire(file), exports: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(sourceOverride || fs.readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, { exports, Buffer, process, console, structuredClone, setTimeout,
    require: (name: string) => {
      if (name === "./codex-draft-provider") return { runCodexDraft: async (call: CodexDraftOptions) => { nativeCalls.push(call); return respond(call); } };
      if (["./publication-identifier-review", "./intrinsic-identifier-corroboration"].includes(name)) return new Proxy({}, {
        get: () => () => { forbiddenCalls++; throw new Error("Unexpected blind B/OCR dispatch"); },
      });
      return nativeRequire(name);
    } }, { filename: file });
  return exports;
}
const final = load("scripts/lib/publish-image-audit.ts").auditPublishImages as typeof auditPublishImages;
const scene = load("scripts/lib/shopping-reference-scene.ts").reviewShoppingReferenceScene as typeof reviewShoppingReferenceScene;
const neutralClaim = { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" };
const good = (index = 1) => ({ index, reason: "Distinct selected housing and cap match; tiny unreadable lettering is not certified. Ordinary 4~5 hour charging discussion does not assert photographic proof.",
  visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
    { part: "housing", referenceObservation: "round selected housing", candidateObservation: "same round housing" },
    { part: "cap", referenceObservation: "short selected cap", candidateObservation: "same short cap" }], conflict: "" },
  optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] }, photoClaimObjection: neutralClaim,
  referenceComparison: null, identityMatches: true, photoClaimMatches: true, notice: false, mixedOptions: false,
  explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true,
  textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo" });

async function main() {
  const photo = path.join(temporary, "photo.png"), source = path.join(temporary, "source.png");
  await sharp({ create: { width: 320, height: 320, channels: 3, background: "#ccddee" } }).png().toFile(photo);
  await sharp({ create: { width: 320, height: 320, channels: 3, background: "#ddeeff" } }).png().toFile(source);
  const options = (count = 1): PublishImageAuditOptions => ({ productName: "Selected device", selectedProduct: "Selected device black option",
    composition: { sections: [{ id: "spec", title: "제품 사양 체크", body: ["충전에는 4~5시간이 걸립니다."], characterCount: 24,
      imagePaths: [photo], imageIntent: "성능 설명 옆 제품 외형", headingStyle: "plain" }],
    renderNodes: [{ kind: "heading", sectionId: "spec", text: "제품 사양 체크" },
      { kind: "paragraph", sectionId: "spec", text: "충전에는 4~5시간이 걸립니다." },
      ...Array.from({ length: count }, () => ({ kind: "image" as const, sectionId: "spec", assetPath: photo, role: "detail" as const,
        altText: "Selected device exterior", layout: "single" as const, sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" as const }))] } });
  respond = async call => nativeReviewResponse(Array.from({ length: (call.outputSchema as ReviewBatchSchema).properties.reviews.maxItems }, (_, index) => good(index + 1)));
  const original = fileHash(photo), input = options(9);
  const first = await final(input);
  assert.equal(first.ok, true, JSON.stringify(first.failures));
  assert.equal(nativeCalls.length, 2, "nine photos use two bounded integrated batches, rather than independent A/B/C/D per image");
  assert.equal(forbiddenCalls, 0);
  assert.equal(first.scopedReviews, undefined);
  assert.equal(first.lightweightReviews?.every(row => row.nativeExecution && row.responseSha256 === hash(row.rawResponse)), true);
  assert.equal(fileHash(photo), original, "valid pixels are retained");
  assert(nativeCalls.every(call => call.imagePaths!.length <= 8 && call.usageStage === "image-review"));
  assert(nativeCalls.every(call => !JSON.stringify(call.outputSchema).includes("sourceBox")), "basic review has no OCR/ROI schema");

  // The actual signed success shortcut performs local checks and zero native calls.
  const reusable = { ...options(), brandLinkId: "offline-lightweight-native" };
  nativeCalls = [];
  assert.equal((await final(reusable)).ok, true);
  assert.equal((await final(reusable)).receiptReused, true);
  assert.equal(nativeCalls.length, 1);
  const receiptDir = path.join(temporary, "data", "publication-image-audit-receipts");
  const receiptPath = path.join(receiptDir, `${hash(reusable.brandLinkId)}.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.signature = "0".repeat(64);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal((await final(reusable)).receiptReused, false, "forged HMAC never reuses success");
  assert.equal(nativeCalls.length, 2);
  const changedContext = structuredClone(reusable);
  (changedContext.composition.renderNodes[1] as { text: string }).text = "현재 상품 설명이 변경됐습니다.";
  assert.equal((await final(changedContext)).receiptReused, false, "changed publication wording invalidates success");

  // A known stronger historic success remains ready without rewriting its HMAC
  // or calling native review. Every material/source byte remains in the binding.
  const historicalId = "offline-stronger-policy", packageDir = path.join(temporary, "data", "prepared-brand-posts", historicalId);
  const sourceDir = path.join(packageDir, "product-sources"); fs.mkdirSync(sourceDir, { recursive: true });
  const canonical = path.join(sourceDir, "canonical.png"), sourceUrl = "https://shop-phinf.pstatic.net/offline/canonical.png";
  fs.copyFileSync(source, canonical);
  fs.writeFileSync(`${canonical}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl, sha256: fileHash(canonical), retrievedAt: "2026-10-20T00:00:00Z" }));
  const snapshot = createProductSnapshot({ productId: historicalId, connectKind: "SHOPPING", externalProductId: null,
    sourceUrl: "https://smartstore.naver.com/offline/products/1234567890", product: { name: "Selected device", features: [], referenceImageUrls: [sourceUrl] } });
  const historicalOptions = options(); historicalOptions.composition.sections[0].imagePaths = [canonical];
  historicalOptions.composition.sections[0].imageSource = "seller-original";
  for (const node of historicalOptions.composition.renderNodes) if (node.kind === "image") node.assetPath = canonical;
  const markdown = path.join(packageDir, "post.md"); fs.writeFileSync(markdown, "unchanged healthy manuscript");
  const assets = [{ path: canonical, sourcePath: canonical, sha256: fileHash(canonical), role: "body" as const, sectionId: "spec",
    provenance: "ORIGINAL" as const, creationMethod: "source" as const, remoteGenerated: false }];
  const manifest = { version: "brand-post-package/v2", brandLinkId: historicalId, connectKind: "SHOPPING", title: "Healthy device article",
    markdownPath: markdown, heroImagePath: canonical, bodyImagePaths: [canonical], imageAssets: assets, sourceSnapshot: snapshot,
    approvedAt: "2026-10-20T00:00:00Z", createdAt: "2026-10-20T00:00:00Z", composition: historicalOptions.composition } as unknown as BrandPostPackageManifest;
  fs.writeFileSync(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));
  const oldBinding = brandPostApprovalBinding(manifest, sourceDir, COMPATIBLE_STRICT_PUBLICATION_POLICIES[0]);
  writeSuccessfulImageAuditReceipt(historicalId, hash("simulated exact historical native request"), oldBinding);
  const historicalReceipt = path.join(receiptDir, `${hash(historicalId)}.json`), historicalBytes = fs.readFileSync(historicalReceipt);
  assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sourceDir), true, "known stronger contract preserves ready status");
  const historicalAudit: PublishImageAuditOptions = { ...historicalOptions, brandLinkId: historicalId,
    composition: normalizePublishedPostText(historicalOptions.composition as Parameters<typeof normalizePublishedPostText>[0]),
    imageAssets: assets, selectedSourceSnapshot: snapshot, sourceSnapshotId: snapshot.snapshotId, selectedSourceProductId: historicalId, selectedSourceDirectory: sourceDir,
    selectedProduct: (load("scripts/lib/publish-image-audit.ts").buildSelectedProductImageAuditContext as (name: string, features: string[]) => string)("Selected device", []),
    compatibleReadinessBindingKeys: brandPostCompatibleApprovalBindings(manifest, sourceDir), readinessBindingKey: brandPostApprovalBinding(manifest, sourceDir) };
  nativeCalls = [];
  const compatible = await final(historicalAudit);
  assert.equal(compatible.ok, true, JSON.stringify(compatible.failures)); assert.equal(compatible.receiptCompatibilityReused, true);
  assert.equal(nativeCalls.length, 0, "unchanged stronger native HMAC needs zero new native calls");
  assert.deepEqual(fs.readFileSync(historicalReceipt), historicalBytes, "compatibility never rewrites or re-signs historical proof");
  for (const policy of COMPATIBLE_STRICT_PUBLICATION_POLICIES.slice(1)) {
    const binding = brandPostApprovalBinding(manifest, sourceDir, policy);
    writeSuccessfulImageAuditReceipt(historicalId, hash(`simulated completed historical request ${policy}`), binding);
    const bytes = fs.readFileSync(historicalReceipt);
    assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sourceDir), true, "unchanged completed 170 native success remains ready");
    nativeCalls = [];
    const result = await final(historicalAudit);
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.equal(result.receiptCompatibilityReused, true);
    assert.equal(nativeCalls.length, 0, "normal signed 170 success must not consume a new review call after the contract update");
    assert.deepEqual(fs.readFileSync(historicalReceipt), bytes);
  }
  const galleryBatch = { ...historicalAudit, brandLinkId: undefined, compatibleReadinessBindingKeys: undefined, readinessBindingKey: undefined,
    composition: structuredClone(historicalAudit.composition) };
  const imageNode = galleryBatch.composition.renderNodes.find(node => node.kind === "image")!;
  galleryBatch.composition.renderNodes = [...galleryBatch.composition.renderNodes.filter(node => node.kind !== "image"),
    ...Array.from({ length: 9 }, () => ({ ...imageNode }))];
  respond = async call => {
    const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"))!;
    const slots = JSON.parse(line.slice(line.indexOf("["))) as Array<{ referencePlaneMap: { primaryReferenceImageIndex: number; primaryReferenceSha256: string } }>;
    return nativeReviewResponse(slots.map((slot, index) => ({ ...good(index + 1), referenceComparison: {
      primaryReferenceImageIndex: slot.referencePlaneMap.primaryReferenceImageIndex,
      primaryReferenceSha256: slot.referencePlaneMap.primaryReferenceSha256, objectionKind: "none", observation: "The same selected visible product and option match" } })));
  };
  nativeCalls = [];
  assert.equal((await final(galleryBatch)).ok, true);
  assert.equal(nativeCalls.length, 2, "a shared canonical gallery is included within each bounded batch, rather than forcing one call per photo");
  assert(nativeCalls.every(call => call.imagePaths!.length <= 8));
  const mappedInput = { ...historicalAudit, brandLinkId: undefined, compatibleReadinessBindingKeys: undefined, readinessBindingKey: undefined };
  for (const kind of ["unresolved", "concrete-conflict"]) {
    const comparison = { primaryReferenceImageIndex: 2, primaryReferenceSha256: fileHash(canonical), objectionKind: kind,
      observation: "An actual negative source/candidate observation remains unresolved or conflicting" };
    const contradictoryRow = { ...good(), referenceComparison: comparison };
    const raw = nativeReviewResponse([contradictoryRow]);
    respond = async () => raw;
    const held = await final(mappedInput);
    assert.equal(held.ok, false);
    assert(held.failures.every(row => row.code === "INVALID_REVIEW"), "a raw reference objection cannot coexist with favorable identity/acceptance");
    assert.equal(held.lightweightReviews![0].rawResponse, raw, "negative comparison and true raw flags are retained without favorable rewriting");
    respond = async () => nativeReviewResponse([{ ...contradictoryRow, identityMatches: false,
      visibleIdentityEvidence: { basis: kind === "unresolved" ? "insufficient-visible-structure" : "concrete-conflict",
        landmarks: kind === "unresolved" ? [] : [{ part: "housing", referenceObservation: "selected round housing", candidateObservation: "different rectangular housing" }],
        conflict: "Actual distinguishing structure is unresolved or visibly conflicting" } }]);
    const negative = await final(mappedInput);
    assert(negative.failures.some(row => row.code === "SEMANTIC_REJECTION"), "an honestly adverse identity remains a semantic rejection");
    assert(!negative.failures.some(row => row.code === "INVALID_REVIEW"));
  }
  const mappedContext = { primaryReferenceImageIndex: 2, primaryReferenceSha256: fileHash(canonical), supplementalReferences: [] };
  const mappedNone = { primaryReferenceImageIndex: 2, primaryReferenceSha256: fileHash(canonical), objectionKind: "none", observation: "actual matching source and candidate" };
  assert.notEqual(lightweightPublicationReferenceIssue(mappedNone, mappedContext, false), null, "adverse identity cannot claim no structured objection");
  assert.notEqual(lightweightPublicationReferenceIssue({ ...mappedNone, primaryReferenceSha256: mappedNone.primaryReferenceSha256.toUpperCase() }, mappedContext, true), null,
    "source SHA spelling/case is exact and never normalized into a favorable binding");
  for (const evidence of [
    { basis: "insufficient-visible-structure", landmarks: [], conflict: "" },
    { basis: "concrete-conflict", landmarks: [], conflict: "A negative claim with no observed opposing landmark" },
  ]) {
    const raw = nativeReviewResponse([{ ...good(), identityMatches: false, visibleIdentityEvidence: evidence,
      referenceComparison: { ...mappedNone, objectionKind: evidence.basis === "concrete-conflict" ? "concrete-conflict" : "unresolved" },
      reason: "Actual negative prose remains preserved but its structured identity evidence is incomplete" }]);
    respond = async () => raw;
    const held = await final(mappedInput);
    assert(held.failures.length > 0 && held.failures.every(row => row.code === "INVALID_REVIEW"),
      "incomplete negative identity is HOLD only, never a semantic product blacklist");
    assert.equal(held.lightweightReviews![0].rawResponse, raw);
  }
  respond = async call => nativeReviewResponse(Array.from({ length: (call.outputSchema as ReviewBatchSchema).properties.reviews.maxItems }, (_, index) => good(index + 1)));
  fs.appendFileSync(markdown, "changed");
  assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sourceDir), false, "changed saved manuscript breaks historical compatibility");
  fs.writeFileSync(markdown, "unchanged healthy manuscript");
  fs.appendFileSync(`${canonical}.retrieval.json`, " ");
  assert.equal(hasCurrentBrandPostApprovalReceipt(manifest, sourceDir), false, "changed source receipt bytes break historical compatibility");
  const staleHint = structuredClone(historicalAudit); (staleHint.composition.renderNodes[1] as { text: string }).text = "Changed current paragraph";
  nativeCalls = [];
  assert.equal((await final(staleHint)).receiptReused, false, "a stale internal compatible key cannot authorize changed audit input");
  assert.equal(nativeCalls.length, 1);

  for (const patch of [
    { identityMatches: false, reason: "Clearly wrong product housing" },
    { identityMatches: false, reason: "Confirmed selected option is black; visible item is red" },
    { identityMatches: false, reason: "Severely distorted cap and housing" },
    { identityMatches: false, reason: "Large readable different identifying logo" },
    { identityMatches: false, reason: "Visible distinguishing structure is genuinely unresolved" },
    { noGraphicLayout: false, reason: "Graphic panel and border around reduced photograph" },
    { textPolicyMatches: false, reason: "Added explanation burned into body image" },
  ]) {
    respond = async () => nativeReviewResponse([{ ...good(), ...patch,
      ...(patch.identityMatches === false ? { visibleIdentityEvidence: { basis: "concrete-conflict", landmarks: [
        { part: "housing", referenceObservation: "selected housing", candidateObservation: patch.reason }], conflict: patch.reason } } : {}) }]);
    const rejected = await final(options());
    assert.equal(rejected.ok, false, patch.reason);
    assert(rejected.failures.some(row => row.code === "SEMANTIC_REJECTION"), "real defects reject semantically, without a microprint proof task");
  }
  const mixed = options(); mixed.selectedProduct = JSON.stringify({ optionResolution: { confirmedOptionLabel: "검정" }, selectedOption: { status: "confirmed", label: "검정" } });
  respond = async () => nativeReviewResponse([{ ...good(), mixedOptions: true,
    optionConflictWitness: { origin: "confirmed-selection", quote: "검정", visibleAlternatives: ["black", "red"] }, reason: "Conflicting selected variants are mixed" }]);
  assert((await final(mixed)).failures.some(row => row.code === "SEMANTIC_REJECTION"));
  const proof = options(); (proof.composition.renderNodes[1] as { text: string }).text = "이 사진으로 충전 시간을 확인할 수 있습니다.";
  respond = async () => nativeReviewResponse([{ ...good(), photoClaimMatches: false,
    photoClaimObjection: { origin: "section-body", sourceIndex: 0, quote: "이 사진으로 충전 시간을 확인할 수 있습니다.", scope: "performance", conflict: "A still photo does not measure charging duration" } }]);
  assert.equal((await final(proof)).ok, false);
  for (const answer of ["not-json", JSON.stringify({ reviews: [{ ...good(), accepted: "true" }] }),
    JSON.stringify({ reviews: [{ ...good(), identityMatches: false, accepted: true }] })]) {
    respond = async () => answer; nativeCalls = [];
    assert.equal((await final(options())).ok, false);
    assert.equal(nativeCalls.length, 1, "technical responses fail closed without extra native loops");
  }
  respond = async () => nativeReviewResponse([{ ...good(), accepted: false }]);
  const inconsistent = await final(options());
  assert(inconsistent.failures.every(row => row.code === "INVALID_REVIEW"), "internally inconsistent final verdict never blacklists healthy pixels as an observed defect");
  respond = async () => { fs.appendFileSync(photo, "changed"); return nativeReviewResponse([good()]); };
  assert.equal((await final(options())).failures.some(row => row.code === "IMAGE_CHANGED"), true);

  // Main scene review has exactly one native call and no independent print task.
  const comparisons = Object.fromEntries(["productShape", "intrinsicPrinting", "visibleOption", "sceneContext"].map(key => [key,
    { result: key === "intrinsicPrinting" ? "allowed-variation" : "consistent", variation: key === "intrinsicPrinting" ? "nonessential-print-legibility" : "none",
      referenceObservation: "source-visible shape and small marks", candidateObservation: "matching shape; tiny letters unreadable", basis: "visible identity clear; tiny letters not certified" }]));
  const sceneAnswer = { comparisons, checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])), identityMatches: true,
    illustrativeOnly: true, reason: "Visible design and option match; no actual photographic proof assertion", accepted: true };
  respond = async () => JSON.stringify(sceneAnswer); nativeCalls = [];
  const sceneReview = await scene({ reference: { path: source, sha256: fileHash(source), subject: "selected device", geometry: "distinct housing and cap", labels: "tiny unreadable", reviewedAt: new Date().toISOString() },
    outputPath: photo, productName: "Selected device", imageIntent: "Natural product photograph", sourceSnapshotId: hash("source-snapshot") });
  assert.equal(nativeCalls.length, 1); assert.equal(forbiddenCalls, 0);
  assert.equal(sceneReview.reviewMode, "lightweight/v1");
  assert.equal(sceneReview.integratedReview?.nativeExecution, true);
  const asset = { role: "body" as const, sectionId: "spec", provenance: "GENERATED_SCENE" as const, creationMethod: "reference-guided-scene" as const,
    remoteGenerated: true, sha256: fileHash(photo), referenceScene: sceneReview };
  const context = { referenceSha256: fileHash(source), sourceSnapshotId: hash("source-snapshot") };
  assert.equal(referenceSceneReviewIssue(asset, context), null);
  assert.notEqual(referenceSceneReviewIssue({ ...asset, sha256: hash("changed pixels") }, context), null);
  assert.notEqual(referenceSceneReviewIssue({ ...asset, referenceScene: { ...sceneReview, integratedReview: { ...sceneReview.integratedReview!, nativeExecution: false } } }, context), null);
  const legacy = { ...sceneReview }; delete legacy.reviewMode; delete legacy.integratedReview;
  assert.equal(legacy.strategyVersion, REFERENCE_SCENE_STRATEGY_VERSION);
  assert.equal(referenceSceneReviewIssue({ ...asset, referenceScene: legacy }, context), null, "healthy old v2 reviews are preserved");
  respond = async () => JSON.stringify({ ...sceneAnswer, accepted: false }); nativeCalls = [];
  await assert.rejects(scene({ reference: { path: source, sha256: fileHash(source), subject: "selected device", geometry: "housing", labels: "tiny", reviewedAt: "2026-10-20" },
    outputPath: photo, productName: "Selected device", imageIntent: "Natural scene" }), /REFERENCE_SCENE_REVIEW_INVALID/);
  assert.equal(nativeCalls.length, 1, "contradictory scene verdict holds without repeating native calls");
  assert.equal(lightweightPublicationPolicyFingerprint({ contract: "same" }), lightweightPublicationPolicyFingerprint({ contract: "same" }));
  const auditModule = "scripts/lib/publish-image-audit.ts";
  const originalPolicy = load(auditModule).publicationImageAuditPolicyFingerprint as () => string;
  const commentPolicy = load(auditModule, `${fs.readFileSync(auditModule, "utf8")}\n// unrelated release logging comment\n`).publicationImageAuditPolicyFingerprint as () => string;
  assert.equal(originalPolicy(), commentPolicy(), "unrelated source/log changes do not invalidate semantic native evidence");
  assert.deepEqual(semanticPublicationReviewRequest({ userPrompt: "same", usageStage: "image-review" }), { userPrompt: "same" });
  console.log("PASS lightweight review: bounded default native batches; zero blind/OCR tasks; unchanged signed reuse calls zero models; concrete defects, malformed/forged/changed evidence block; one scene review; healthy old v2 photos preserved (offline only)");
}
main().finally(() => {
  if (previousData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousData;
  fs.rmSync(temporary, { recursive: true, force: true });
}).catch(error => { console.error(error); process.exitCode = 1; });

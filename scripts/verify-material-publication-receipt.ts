/** Offline completion parity: actual audit/receipt code, isolated files,
 * stubbed reviewer and focused execution of the production approval gate. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import sharp from "sharp";
import ts from "typescript";
import { brandPostApprovalBinding, hasCurrentBrandPostApprovalReceipt } from "../src/lib/brand-post-approval-receipt";
import { approveBrandPostPackage, getBrandPostPackageDir, readBrandPostPackage, reconcileBrandPostPackageQuality,
  writeBrandPostPackageManifest, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { validateBrandPostPublishImages } from "../src/lib/brand-post-publish-preflight";
import { readSuccessfulImageAuditReceipt, readSuccessfulImageAuditReadinessBinding, writeSuccessfulImageAuditReceipt } from "./lib/publish-image-audit-receipt";
import { PUBLICATION_IMAGE_AUDIT_POLICY_FILES, publicationImageAuditPolicyFingerprint } from "./lib/publish-image-audit";
import { resolvePostDocument } from "../src/lib/post-composition-contract";
import { getMaterial, materialRevision } from "../src/lib/material-library";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { revalidateSavedBrandPostText, SavedTextRevalidationError } from "../src/lib/brand-post-revalidation";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { shoppingPhotoRoleAt } from "../src/lib/shopping-post-strategy";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

const load = (file: string, overrides: Record<string, unknown>, replacement?: (source: string) => string) => {
  const original = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(replacement ? replacement(original) : original,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} }; const require = createRequire(path.resolve(file));
  vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports, require: (id: string) => overrides[id] ?? require(id),
    console, process, Buffer, setTimeout, clearTimeout, structuredClone }, { filename: file });
  return loadedModule.exports;
};

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "material-publication-receipt-"));
  const beforeData = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = temp;
  let cases = 0;
  try {
    const id = "publication-receipt-fixture";
    const directory = getBrandPostPackageDir(id), sources = path.join(directory, "product-sources");
    fs.mkdirSync(sources, { recursive: true });
    const photo = path.join(directory, "product.png"), reference = path.join(directory, "reference.png");
    await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).png().toFile(photo);
    fs.copyFileSync(photo, reference);
    const markdown = path.join(directory, "post.md"); fs.writeFileSync(markdown, "원고 보존 테스트");
    const composition = resolvePostDocument({ connectKind: "SHOPPING", title: "선택 상품 외형 정보",
      sections: ["선택 상품 외형\n선택 상품의 외형을 참고하는 사진입니다."], imagePaths: [photo],
      hashtags: ["상품", "외형", "선택"], connectUrl: "https://naver.me/fixture", qualityPreset: "PREMIUM" });
    const section = composition.sections[0]; section.imageSource = "seller-original";
    section.imageIntent = "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인";
    section.body = ["선택 상품의 외형을 참고하는 사진입니다."];
    section.imagePaths = [photo];
    composition.renderNodes = [
      { kind: "image", assetPath: photo, sectionId: section.id, role: "detail", altText: "선택 상품", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" },
      { kind: "heading", sectionId: section.id, text: section.title },
      { kind: "paragraph", sectionId: section.id, text: section.body[0] },
    ];
    const fixture: BrandPostPackageManifestV2 = {
      version: "brand-post-package/v2", contractVersion: "post-composition-contract/v1", brandLinkId: id,
      connectKind: "SHOPPING", title: composition.title, generationSource: "AI", composition,
      markdownPath: markdown, heroImagePath: photo, bodyImagePaths: [photo], hashtags: ["상품", "외형", "선택"],
      imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", createdAt: "2026-10-12", approvedAt: "2026-10-12",
      imageAssets: [{ path: photo, sourcePath: reference, sha256: crypto.createHash("sha256").update(fs.readFileSync(photo)).digest("hex"),
        role: "body", sectionId: section.id, provenance: "ORIGINAL", creationMethod: "source" }],
      thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1000, height: 1000, aspect: "1:1" },
        style: "fixture", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", sourceImagePath: photo },
    };
    const canonicalUrl="https://shop-phinf.pstatic.net/fixture/canonical.png",canonicalFile=path.join(sources,"canonical.png");
    const digest=(file:string)=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    fs.copyFileSync(reference,canonicalFile);fs.writeFileSync(`${canonicalFile}.retrieval.json`,JSON.stringify({version:"product-image-retrieval/v1",sourceUrl:canonicalUrl,sha256:digest(canonicalFile),retrievedAt:new Date(Date.now()-1000).toISOString()}));
    fixture.sourceSnapshot=createProductSnapshot({productId:id,externalProductId:"receipt-fixture",connectKind:"SHOPPING",sourceUrl:"https://smartstore.naver.com/fixture/products/1",product:{name:"선택 상품",referenceImageUrls:[canonicalUrl]}});
    const key = () => brandPostApprovalBinding(fixture, sources);
    const originalBinding = key(); const canonicalRequest = "a".repeat(64);
    writeSuccessfulImageAuditReceipt(id, canonicalRequest);
    assert.equal(readSuccessfulImageAuditReceipt(id, canonicalRequest), true);
    assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), false, "legacy approvals have no current saved-input binding"); cases++;
    writeSuccessfulImageAuditReceipt(id, canonicalRequest, originalBinding);
    assert.equal(readSuccessfulImageAuditReceipt(id, canonicalRequest), true);
    assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), true); cases++;
    const timestamps = structuredClone(fixture);
    timestamps.approvedAt = new Date().toISOString();
    timestamps.imageGeneration = { status: "complete", requested: 4, applied: 4, remaining: 0, errors: [], updatedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    assert.equal(brandPostApprovalBinding(timestamps, sources), originalBinding, "approval/progress timestamps are not reviewed content"); cases++;
    const withTextAudit = structuredClone(fixture);
    withTextAudit.textQualityRevalidation = { version: "saved-text-qc/v3", checkedAt: "2026-10-12T00:00:00Z",
      inputFingerprint: "a".repeat(64), sourceSnapshotId: "same-snapshot", sourceOrigin: "package" };
    const textBinding = brandPostApprovalBinding(withTextAudit, sources);
    withTextAudit.textQualityRevalidation.checkedAt = "2026-10-12T01:00:00Z";
    assert.equal(brandPostApprovalBinding(withTextAudit, sources), textBinding, "same text QC input is not stale solely because checkedAt changes"); cases++;
    withTextAudit.textQualityRevalidation.inputFingerprint = "b".repeat(64);
    assert.notEqual(brandPostApprovalBinding(withTextAudit, sources), textBinding); cases++;
    for (const mutate of [
      (row: BrandPostPackageManifestV2) => { row.title += " 변경"; },
      (row: BrandPostPackageManifestV2) => { row.composition.sections[0].body[0] += " 잘못된 사진 묘사"; },
      (row: BrandPostPackageManifestV2) => { const node = row.composition.renderNodes.find(node => node.kind === "paragraph"); if (node?.kind === "paragraph") node.text += " 변경"; },
      (row: BrandPostPackageManifestV2) => { row.productUnderstanding = { identity: "different-product" } as never; },
      (row: BrandPostPackageManifestV2) => { row.imageAssets![0].sectionId = "different-slot"; },
      (row: BrandPostPackageManifestV2) => { row.sourceSnapshot = { snapshotId: "different-selected-source" } as never; },
    ]) {
      const changed = structuredClone(fixture); mutate(changed);
      assert.equal(hasCurrentBrandPostApprovalReceipt(changed, sources), false); cases++;
    }
    for (const file of [photo, reference, markdown]) {
      const bytes = fs.readFileSync(file); fs.appendFileSync(file, "changed-in-place");
      assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), false);
      fs.writeFileSync(file, bytes); assert.equal(key(), originalBinding); cases++;
    }
    const sourceReceipt = path.join(sources, "seller.png.retrieval.json"), sourcePhoto = path.join(sources, "seller.png");
    fs.copyFileSync(photo, sourcePhoto); fs.writeFileSync(sourceReceipt, JSON.stringify({ sha256: "b".repeat(64), sourceUrl: "https://shop-phinf.pstatic.net/new.png" }));
    assert.notEqual(key(), originalBinding, "new gallery evidence changes the review input membership"); cases++;
    const galleryBinding = key(); fs.appendFileSync(sourcePhoto, "gallery-changed"); assert.notEqual(key(), galleryBinding); cases++;
    fs.rmSync(sourcePhoto); fs.rmSync(sourceReceipt); assert.equal(key(), originalBinding);
    const sidecar = `${photo}.source.json`; fs.writeFileSync(sidecar, "invalid-new-provenance");
    assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), false); fs.rmSync(sidecar); cases++;
    const receiptPath = path.join(temp, "data", "publication-image-audit-receipts", `${crypto.createHash("sha256").update(id).digest("hex")}.json`);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); receipt.readinessBindingKey = "b".repeat(64);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    assert.equal(readSuccessfulImageAuditReadinessBinding(id, "b".repeat(64)), false, "editing the stored binding cannot forge the HMAC"); cases++;

    // Real review/receipt integration: unchanged accepted pixels are reused,
    // while changed body claims must undergo review and cannot promote failure.
    writeBrandPostPackageManifest(fixture);
    let reviewCalls = 0;
    const review = async (call: CodexDraftOptions) => {
      reviewCalls++;
      const data=JSON.parse(call.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
      if(call.systemPrompt.includes("publication-image-task/A-visible")) return JSON.stringify({memberBrandScope:"selected-main-product-body",memberBrandObservation:"Visible main physical product body, not an independent accessory",reason:"Offline corresponding selected product structure",visibleIdentityEvidence:{basis:"observed-correspondence",landmarks:[
        {part:"contour",referenceObservation:"source contour",candidateObservation:"candidate contour"},{part:"connection",referenceObservation:"source connection",candidateObservation:"candidate connection"}],conflict:""},
        picturedMemberEvidence:{scope:"pictured-member-only",memberFactIndex:0,picturedMember:"visible selected fixture member",verdict:"selected-member-visible",selectedFact:data.selectedSubjectFacts.selectedTitle,referenceObservation:"source included member",candidateObservation:"candidate included member",conflict:""},identityMatches:true,accepted:true});
      if(call.systemPrompt.includes("publication-image-task/C-photo-claims")) return JSON.stringify({reason:"Offline exact published claims supported",photoClaimObjection:{origin:"none",sourceIndex:null,quote:"",scope:"none",conflict:""},optionConflictWitness:{origin:"none",quote:"",visibleAlternatives:[]},photoClaimMatches:true,intrinsicPrintProofClaim:false,mixedOptions:false,explicitNamedComparison:false,optionsClearlyLabeled:false,reviewClass:"product-photo",accepted:true});
      assert.match(call.systemPrompt,/publication-image-task\/D-pixel-format/u);
      return JSON.stringify({reason:"Offline pixels contain no added graphic layout",pixelFormatObjection:{kind:"none",location:"",observation:""},notice:false,singlePhotograph:true,noGraphicLayout:true,textPolicyMatches:true,thumbnailHeadlineLegible:true,accepted:true});
    };
    const inputBytes = [photo, reference, markdown].map(file => fs.readFileSync(file));
    // An explicitly injected test reviewer intentionally cannot issue production
    // receipts. Replace only the provider dependency and execute the production
    // no-review-option path, including its real OS lock and HMAC storage.
    let reviewProvider = review;
    const provider={runCodexDraft:(call:CodexDraftOptions)=>reviewProvider(call)};
    const observerModule=await import("./lib/intrinsic-identifier-observer");
    const observer={...observerModule,observeIntrinsicIdentifier:async (options:{path:string;sha256:string})=>{
      assert.equal(digest(options.path),options.sha256);
      const observation={literal:"",box:null,identifierRole:"none" as const,location:"not-observed" as const,readability:"absent" as const},rawResponse=JSON.stringify({observation});
      return {status:"observed",reason:"Offline synthetic solid-colour fixture has no intrinsic identifier",evidence:{version:observerModule.INTRINSIC_IDENTIFIER_OBSERVER_VERSION,nativeExecution:true,imageSha256:options.sha256,
        requestSha256:observerModule.intrinsicIdentifierObserverRequestSha256(options.sha256),responseSha256:crypto.createHash("sha256").update(rawResponse).digest("hex"),rawResponse,observation}};
    }};
    const scoped=load(path.resolve("scripts/lib/publication-image-scoped-review.ts"),{"./codex-draft-provider":provider});
    const identifiers=load(path.resolve("scripts/lib/publication-identifier-review.ts"),{"./codex-draft-provider":provider,"./intrinsic-identifier-observer":observer});
    const productionAudit = load(path.resolve("scripts/lib/publish-image-audit.ts"), {
      "./codex-draft-provider":provider,"./publication-image-scoped-review":scoped,"./publication-identifier-review":identifiers,
    });
    const productionPreflight = load(path.resolve("src/lib/brand-post-publish-preflight.ts"), {
      "../../scripts/lib/publish-image-audit": productionAudit,
    }) as { validateBrandPostPublishImages: typeof validateBrandPostPublishImages };
    const preflight = (productId: string, productName?: string) =>
      productionPreflight.validateBrandPostPublishImages(productId, productName, { bindReadiness: true });
    await productionPreflight.validateBrandPostPublishImages(id, "선택 상품");
    assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), false, "diagnostic-only pixel success cannot renew an old manuscript approval"); cases++;
    await preflight(id, "선택 상품");
    assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), true); assert.ok(reviewCalls > 0); cases++;
    const firstCalls = reviewCalls;
    reviewProvider = async () => { throw new Error("same accepted input must reuse receipt, without another model call"); };
    await preflight(id, "선택 상품");
    assert.equal(reviewCalls, firstCalls); cases++;
    const changed = structuredClone(fixture);
    const paragraph = changed.composition.renderNodes.find(node => node.kind === "paragraph");
    if (paragraph?.kind === "paragraph") paragraph.text += " 이 사진은 다른 상품을 보여줍니다.";
    writeBrandPostPackageManifest(changed);
    reviewProvider = async call => {
      const result=JSON.parse(await review(call));
      if(call.systemPrompt.includes("publication-image-task/C-photo-claims")) {
        const data=JSON.parse(call.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
        result.photoClaimMatches=false;result.accepted=false;
        result.photoClaimObjection={origin:"section-body",sourceIndex:0,quote:data.displayedParagraphs[0].text,scope:"pictured-appearance",conflict:"The published whole paragraph claims a different pictured product"};
      }return JSON.stringify(result);
    };
    await assert.rejects(preflight(id, "선택 상품"), (error: unknown) => (error as { name?: string }).name === "PublishImageAuditError");
    assert.equal(hasCurrentBrandPostApprovalReceipt(changed, sources), false, "failed current review never produces a successful binding"); cases++;
    [photo, reference, markdown].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), inputBytes[index], "preflight must never regenerate/edit manuscript or images")); cases++;
    // Force a genuinely unreviewed claim packet for the in-flight race. A
    // fully unchanged positive packet is now correctly served by its cache.
    const raceFixture=structuredClone(fixture),raceParagraph=raceFixture.composition.renderNodes.find(n=>n.kind==="paragraph");
    if(raceParagraph?.kind==="paragraph") raceParagraph.text+=" 현재 외형을 확인합니다.";
    writeBrandPostPackageManifest(raceFixture);
    reviewProvider = async call => {
      fs.copyFileSync(photo, sourcePhoto); fs.writeFileSync(sourceReceipt, "gallery appears while reviewer runs");
      return review(call);
    };
    await assert.rejects(preflight(id, "선택 상품"), (error: unknown) => (error as { code?: string }).code === "IMAGE_CHANGED");
    assert.equal(hasCurrentBrandPostApprovalReceipt(fixture, sources), false); cases++;
    fs.rmSync(sourcePhoto); fs.rmSync(sourceReceipt);writeBrandPostPackageManifest(fixture);

    const bindingModule = load(path.resolve("src/lib/brand-post-approval-receipt.ts"), {
      "../../scripts/lib/publish-image-audit": { publicationImageAuditPolicyFingerprint: () => "changed-policy" },
    }) as { brandPostApprovalBinding: typeof brandPostApprovalBinding };
    assert.notEqual(bindingModule.brandPostApprovalBinding(fixture, sources), originalBinding); cases++;
    const policyModule = load(path.resolve("scripts/lib/publish-image-audit.ts"), {}) as { publicationImageAuditPolicyFingerprint: typeof publicationImageAuditPolicyFingerprint };
    assert.equal(policyModule.publicationImageAuditPolicyFingerprint(), publicationImageAuditPolicyFingerprint(), "separately transpiled consumers have the same source policy identity"); cases++;
    const policyCopy = path.join(temp, "policy-consumer"), previousProjectRoot = process.env.DESKTOP_PROJECT_ROOT;
    for (const relative of PUBLICATION_IMAGE_AUDIT_POLICY_FILES) {
      fs.mkdirSync(path.dirname(path.join(policyCopy, relative)), { recursive: true });
      fs.copyFileSync(path.resolve(relative), path.join(policyCopy, relative));
    }
    const policyBefore = publicationImageAuditPolicyFingerprint();
    try {
      process.env.DESKTOP_PROJECT_ROOT = policyCopy;
      assert.equal(publicationImageAuditPolicyFingerprint(), policyBefore, "installation root is not policy identity"); cases++;
      fs.appendFileSync(path.join(policyCopy, "scripts/lib/publish-image-audit.ts"), "\n// changed actual prompt contract\n");
      assert.notEqual(publicationImageAuditPolicyFingerprint(), policyBefore, "policy/source edits invalidate readiness without a manual version bump"); cases++;
      fs.rmSync(path.join(policyCopy, "scripts/lib/product-image-visual-contract.ts"));
      assert.throws(() => publicationImageAuditPolicyFingerprint(), /ENOENT/u, "missing packaged policy source cannot authorize readiness"); cases++;
    } finally {
      if (previousProjectRoot === undefined) delete process.env.DESKTOP_PROJECT_ROOT; else process.env.DESKTOP_PROJECT_ROOT = previousProjectRoot;
    }

    // Execute actual ready-list logic with the other quality gates held passing.
    const materialModule = load(path.resolve("src/lib/material-library.ts"), {
      "./material-review-warnings": { readCurrentMaterialReviewWarnings: () => [] },
      "./brand-post-package": { readBrandPostPackage: () => fixture, getBrandPostPackageDir: () => directory,
        evaluateBrandPostPackageReadiness: () => ({ blockers: [], composition: fixture.composition, contentScore: 100 }) },
    }) as { getMaterial: (id: string) => { ready: boolean; blockers: string[] } };
    writeSuccessfulImageAuditReceipt(id, canonicalRequest);
    assert.equal(materialModule.getMaterial(id).ready, false); cases++;
    writeSuccessfulImageAuditReceipt(id, canonicalRequest, key());
    assert.equal(materialModule.getMaterial(id).ready, true); cases++;
    fs.appendFileSync(markdown, "changed"); assert.equal(materialModule.getMaterial(id).ready, false); cases++;
    fs.writeFileSync(markdown, inputBytes[2]);

    const routeFile = path.resolve("src/app/api/brandlinks/[id]/draft/route.ts"), routeSource = fs.readFileSync(routeFile, "utf8");
    const ast = ts.createSourceFile(routeFile, routeSource, ts.ScriptTarget.Latest, true);
    const gate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "approvePackageAfterCurrentValidation")!;
    assert.ok(gate, "manual and automatic paths require one shared completion gate");
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "approvePackageAfterCurrentValidation") calls.push(node); ts.forEachChild(node, visit); };
    visit(ast); assert.equal(calls.length, 2, "both manual PATCH and automatic POST call the gate"); cases++;
    const events: string[] = []; let release: (() => void) | undefined;
    const context = vm.createContext({
      revalidatePackageForApproval: () => events.push("text"),
      validateBrandPostPublishImages: async () => { events.push("pixels-start"); await new Promise<void>(resolve => { release = resolve; }); events.push("pixels-complete"); },
      approveBrandPostPackage: () => { events.push("approved"); return fixture; },
    });
    vm.runInContext(ts.transpileModule(gate.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const running = vm.runInContext(`approvePackageAfterCurrentValidation("${id}", { productName: "선택 상품" })`, context) as Promise<unknown>;
    assert.deepEqual(events, ["text", "pixels-start"]); release!(); await running;
    assert.deepEqual(events, ["text", "pixels-start", "pixels-complete", "approved"]); cases++;
    events.length = 0;
    context.validateBrandPostPublishImages = async () => { events.push("pixels-failed"); throw new Error("rejected"); };
    await assert.rejects(vm.runInContext(`approvePackageAfterCurrentValidation("${id}", {})`, context) as Promise<unknown>, /rejected/u);
    assert.deepEqual(events, ["text", "pixels-failed"]); cases++;

    // Reuse the existing independently passing writing fixture as data, then
    // execute the REAL text evaluator, pixel preflight, package approval and
    // ready-list reader together. No quality gate is stubbed in this sequence.
    const fixtureSource = ts.createSourceFile("writing-fixture.ts", fs.readFileSync(path.resolve("scripts/verify-brand-post-quality-reinforcement.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    let fixtureExpression: ts.Expression | undefined;
    const findFixture = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(fixtureSource) === "naturalShoppingReview" && node.initializer && ts.isCallExpression(node.initializer))
        fixtureExpression = node.initializer.arguments[0];
      ts.forEachChild(node, findFixture);
    };
    findFixture(fixtureSource); assert.ok(fixtureExpression);
    const writing = vm.runInNewContext(`(${fixtureExpression!.getText(fixtureSource)})`) as {
      productName: string; title: string; sections: string[]; hashtags: string[]; brandLink: string; sourceDescription: string; sourceFeatures: string[];
    };
    const fullId = "publication-full-ready-fixture", fullDirectory = getBrandPostPackageDir(fullId);
    fs.mkdirSync(fullDirectory, { recursive: true });
    const images: string[] = [];
    for (let i = 0; i < 6; i++) {
      const image = path.join(fullDirectory, `${i}.png`);
      await sharp({ create: { width: 320, height: 240, channels: 3, background: `rgb(${i * 30}, 90, 120)` } }).png().toFile(image); images.push(image);
    }
    const bodySections = writing.sections.slice(0, 8); let bodyIndex = 1;
    const sectionImages = bodySections.map((_, index) => shoppingPhotoRoleAt(index, bodySections.length) === "none" ? [] : [images[bodyIndex++]]);
    const fullComposition = resolvePostDocument({ connectKind: "SHOPPING", productName: writing.productName,
      title: writing.title, sections: bodySections, hashtags: writing.hashtags, imagePaths: images.slice(0, 5),
      sectionImagePaths: sectionImages, connectUrl: writing.brandLink, qualityPreset: "PREMIUM" });
    const snapshot = createProductSnapshot({ productId: fullId, connectKind: "SHOPPING", externalProductId: "shaver-fixture",
      sourceUrl: "https://brand.naver.com/fixture/products/123", product: { name: writing.productName, description: writing.sourceDescription, features: writing.sourceFeatures, referenceImageUrls:[canonicalUrl] } });
    const imageHash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const comparison = (output: string, raw?: string) => ({ strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION,
      referencePath: images[1], referenceSha256: imageHash(images[1]), sourceSnapshotId: snapshot.snapshotId,
      reviewStatus: "passed" as const, reviewedOutputSha256: imageHash(raw || output),
      ...(raw ? { thumbnailRawPath: raw, thumbnailOutputSha256: imageHash(output) } : {}),
      checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(check => [check, true])) });
    const fullSources=path.join(fullDirectory,"product-sources");fs.mkdirSync(fullSources,{recursive:true});
    const fullCanonical=path.join(fullSources,"canonical.png");fs.copyFileSync(images[1],fullCanonical);
    fs.writeFileSync(`${fullCanonical}.retrieval.json`,JSON.stringify({version:"product-image-retrieval/v1",sourceUrl:canonicalUrl,sha256:imageHash(fullCanonical),retrievedAt:new Date(Date.now()-1000).toISOString()}));
    const full: BrandPostPackageManifestV2 = { ...structuredClone(fixture), brandLinkId: fullId, title: writing.title,
      approvedAt: null, sourceSnapshot: snapshot, markdownPath: path.join(fullDirectory, "post.md"), heroImagePath: images[0],
      bodyImagePaths: images.slice(1, 5), hashtags: writing.hashtags, composition: fullComposition,
      thumbnailSpec: { ...fixture.thumbnailSpec, sourceImagePath: images[0] },
      imageAssets: [{ path: images[0], sourcePath: images[5], sha256: imageHash(images[0]), role: "hero", sectionId: null,
        provenance: "PHOTO_TEXT_THUMBNAIL", creationMethod: "remote-generated", remoteGenerated: true, referenceScene: comparison(images[0], images[5]) },
      ...fullComposition.sections.flatMap(section => section.imagePaths.map((file, ordinal) => ({ path: file, sourcePath: images[1],
        sha256: imageHash(file), role: "body" as const, sectionId: section.id, imageIntent: section.imageIntent,
        slotId: `${section.id}:image:${ordinal + 1}`,
        ...(section.imageSource === "seller-original" ? { provenance: "ORIGINAL" as const, creationMethod: "source" as const, remoteGenerated: false,
          sourceReview: { version: "product-photo-source-review/v1" as const, sourceSha256: imageHash(file), usage: "section-matched-product-evidence" as const,
            sectionIntent: section.imageIntent, reviewClass: "product-photo" as const, reviewedAt: "2026-10-12T00:00:00Z" } }
          : { provenance: "GENERATED_SCENE" as const, creationMethod: "reference-guided-scene" as const, remoteGenerated: true, referenceScene: comparison(file) }) })))],
    };
    for (const node of full.composition.renderNodes) if (node.kind === "image" && full.imageAssets?.find(asset => asset.path === node.assetPath)?.provenance === "GENERATED_SCENE") node.caption = REFERENCE_SCENE_CAPTION;
    fs.writeFileSync(full.markdownPath, bodySections.join("\n\n")); writeBrandPostPackageManifest(full);
    const fullProtectedPaths=[full.markdownPath,...images,fullCanonical,`${fullCanonical}.retrieval.json`];
    const fullProtected = fullProtectedPaths.map(file => fs.readFileSync(file));
    const revalidate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "revalidatePackageForApproval")!;
    const completeContext = vm.createContext({ fs, path, SavedTextRevalidationError, readBrandPostPackage, getBrandPostPackageDir,
      revalidateSavedBrandPostText, reconcileBrandPostPackageQuality, writeBrandPostPackageManifest,
      validateBrandPostPublishImages: preflight, approveBrandPostPackage });
    vm.runInContext(ts.transpileModule(`${revalidate.getText(ast)}\n${gate.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, completeContext);
    reviewProvider = review;
    const link = { connectKind: "SHOPPING", productName: writing.productName, externalItemId: "shaver-fixture",
      finalUrl: snapshot.sourceUrl, sourceUrl: snapshot.sourceUrl, url: writing.brandLink };
    for (const mode of ["manual", "automatic"]) {
      completeContext.fixtureLink = link;
      await vm.runInContext(`approvePackageAfterCurrentValidation("${fullId}", fixtureLink)`, completeContext);
      const finalMaterial = getMaterial(fullId)!;
      assert.equal(finalMaterial.ready, true, `${mode}: actual approval followed by actual ready-list reader: ${finalMaterial.blockers.join(" / ")}`); cases++;
      fullProtectedPaths.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), fullProtected[index]));
    }
    // A validator-only/source policy change leaves prompt/body/image bytes the
    // same. It must invalidate BOTH readiness and the exact-request cache so a
    // newly adverse current review cannot re-sign the old successful verdict.
    for (const relative of PUBLICATION_IMAGE_AUDIT_POLICY_FILES) fs.copyFileSync(path.resolve(relative), path.join(policyCopy, relative));
    fs.appendFileSync(path.join(policyCopy, "scripts/lib/shopping-image-format.ts"), "\n// changed current format validator\n");
    const beforePolicyReviewCalls = reviewCalls;
    try {
      process.env.DESKTOP_PROJECT_ROOT = policyCopy;
      assert.equal(getMaterial(fullId)!.ready, false); cases++;
      reviewProvider = async call => {
        const result = JSON.parse(await review(call)); result.accepted = false;
        return JSON.stringify(result);
      };
      await assert.rejects(preflight(fullId, writing.productName), (error: unknown) => (error as { name?: string }).name === "PublishImageAuditError");
      assert.ok(reviewCalls > beforePolicyReviewCalls, "changed validator cannot renew readiness solely by reusing the old request receipt");
      assert.equal(getMaterial(fullId)!.ready, false); cases++;
    } finally {
      if (previousProjectRoot === undefined) delete process.env.DESKTOP_PROJECT_ROOT; else process.env.DESKTOP_PROJECT_ROOT = previousProjectRoot;
    }
    assert.equal(materialRevision(fixture).length, 64); // Selection revision still binds approval/state independently.
    console.log(`PASS: ${cases} saved-material publication receipt scenarios (offline; no generation, live mutation or publication)`);
  } finally {
    if (beforeData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = beforeData;
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("material-publication-receipt-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

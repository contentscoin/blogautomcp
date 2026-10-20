/** Offline native-call seam: real task coordinator, zero real providers/network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import type { PublishImageAuditOptions } from "./lib/publish-image-audit";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";

async function main() {
  const require = createRequire(import.meta.url), root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-scoped-native-"));
  const oldData = process.env.DESKTOP_USER_DATA, oldFetch = globalThis.fetch;
  process.env.DESKTOP_USER_DATA = root; globalThis.fetch = async () => { throw Error("offline fixture attempted network"); };
  const providerPath = require.resolve("./lib/codex-draft-provider"), actualProvider = require(providerPath);
  let mode = "good", checks = 0, providerCalls = 0, mutate: (() => void) | undefined;
  const calls: CodexDraftOptions[] = [];
  const a = () => ({ memberBrandScope:"selected-main-product-body",memberBrandObservation:"Visible main physical product body, not an independent accessory",reason: "Offline visible contour and connection correspond", picturedMemberEvidence: {scope:"pictured-member-only",memberFactIndex:0,picturedMember:"visible selected fixture member", verdict: "selected-member-visible", selectedFact: "EXPECTED_SELECTED_SUBJECT", referenceObservation: "selected visible member in source", candidateObservation: "same visible member in candidate", conflict: "" }, identityMatches: true, accepted: true, visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
      { part: "contour", referenceObservation: "source contour", candidateObservation: "same contour" },
      { part: "connection", referenceObservation: "source connection", candidateObservation: "same connection" }], conflict: "" } });
  const c = () => ({ reason: "Offline actual publication claims satisfy their own checks", photoClaimObjection: { origin: "none", sourceIndex: null as number | null, quote: "", scope: "none", conflict: "" },
    optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] as string[] }, photoClaimMatches: true, intrinsicPrintProofClaim:false, mixedOptions: false,
    explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", accepted: true });
  const d = () => ({ reason: "Offline actual pixels have no graphic overlay", pixelFormatObjection: { kind: "none", location: "", observation: "" },
    notice: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, accepted: true });
  require.cache[providerPath]!.exports = { ...actualProvider, runCodexDraft: async (call: CodexDraftOptions) => {
    providerCalls++; calls.push(call); assert.equal(call.noTransientRetry, true); checks++;
    if (call.systemPrompt.includes("publication-image-task/A-visible")) {
      assert.equal(call.imagePaths!.length, 2); assert(!call.userPrompt.includes("black supplemental trap")); checks += 2;
      const row = a();
      if (mode === "a-false") { row.identityMatches = row.accepted = false; row.visibleIdentityEvidence.basis = "concrete-conflict"; row.visibleIdentityEvidence.conflict = "Actual synthetic connector differs"; }
      if (mode === "gift") { row.accepted = false; row.picturedMemberEvidence.verdict = "nonselected-subject-visible"; row.picturedMemberEvidence.conflict = "Both show a gift explicitly not included in the selected subject"; }
      if (mode === "a-unknown") return JSON.stringify({ ...row, identityMatches: null });
      if (mode === "mutation") mutate?.();
      return JSON.stringify(row);
    }
    if (call.systemPrompt.includes("publication-image-task/C-photo-claims")) {
      assert.equal(call.imagePaths!.length, 1); assert(!call.userPrompt.includes("primaryReferenceImageIndex")); checks += 2;
      const row = c();
      if(mode === "c-positive-invalid") row.photoClaimObjection={origin:"section-body",sourceIndex:0,quote:"inconsistent leftover",scope:"pictured-appearance",conflict:"positive boolean with adverse claim"};
      if(mode === "c-positive-invalid-witness") row.optionConflictWitness={origin:"published-purchase-bundle",quote:"unmixed has a leftover witness",visibleAlternatives:["one","two"]};

      if (mode === "c-claim") { row.accepted = row.photoClaimMatches = false; row.photoClaimObjection = { origin: "section-body", sourceIndex: 0,
        quote: "이 사진에는 선택 상품 외형이 보입니다.", scope: "pictured-appearance", conflict: "Synthetic actual published description contradicts the pixels" }; }
      if (mode === "c-second-paragraph" || mode === "c-substring") { row.accepted = row.photoClaimMatches = false; row.photoClaimObjection = {origin:"section-body",sourceIndex:1,
        quote:mode === "c-second-paragraph" ? "사진에서는 귀에 거는 형태와 검은색 본체, 로고를 확인할 수 있어요." : "검은색 본체",scope:"pictured-appearance",conflict:"Actual label close-up does not show the claimed complete hook"}; }
      if (mode === "c-forged-quote") { row.photoClaimMatches = row.accepted = false; row.photoClaimObjection = { origin: "section-body", sourceIndex: 0, quote: "invented sentence", scope: "quantity", conflict: "invalid quoted claim" }; }
      if (mode === "c-unknown") return JSON.stringify({ ...row, photoClaimMatches: null });
      if(mode === "print-claim-auth") row.intrinsicPrintProofClaim=true;
      return JSON.stringify(row);
    }
    if(call.systemPrompt.startsWith("Observe literal physical printing")) return JSON.stringify({literal:"",box:null,identifierRole:"none",location:"not-observed",
      readability:path.basename(call.imagePaths![0])==="source.png"?"unreadable":"absent"});
    if(call.systemPrompt.includes("publication-image-task/B-print-applicability")) {
      if(mode === "print-provider") throw Error("offline provider failure");
      if(mode === "print-malformed") return "malformed";
      return JSON.stringify({sourceObservation:"The source product is visible but this local print location is not resolved",candidateObservation:"The product is visible, but no exact local mark is readable",
        correspondenceObservation:"A already observes physical structure; this task cannot map a fine print location",samePhysicalPart:null,samePhysicalSurface:null,sameSelectedVisibleOption:null,
        sourcePrintLocation:"not-observed",candidatePrintLocation:"unresolved",sourceBox:null,candidateBox:null,witness:"Local fine-print correspondence is not observable",
        applicability:"unresolved",accepted:false});
    }
    if (call.systemPrompt.includes("publication-image-task/D-pixel-format")) {
      assert.equal(call.imagePaths!.length, 1); assert(!call.userPrompt.includes("이 사진에는") && !call.userPrompt.includes("displayedParagraphs")); checks += 2;
      const row = d();
      if (mode === "c-frame") { row.accepted = row.noGraphicLayout = false; row.pixelFormatObjection = {kind:"frame-or-panels",location:"image border",observation:"actual synthetic frame around reduced photograph"}; }
      if (mode === "d-ungrounded") row.accepted = row.noGraphicLayout = false;
      return JSON.stringify(row);
    }
    throw Error("exact canonical ORIGINAL B must use deterministic bytes identity, not a provider");
  } };
  try {
    const { auditPublishImages, assertPublishImagesSafe, publicationImageAuditPolicyFingerprint } = require("./lib/publish-image-audit") as typeof import("./lib/publish-image-audit");
    const { buildScopedPublicationPackets, executeScopedPublicationPacket, scopedPublicationEvidenceIssue } = require("./lib/publication-image-scoped-review") as typeof import("./lib/publication-image-scoped-review");
    const { visibleIdentityReviewContext } = require("./lib/publication-visible-identity") as typeof import("./lib/publication-visible-identity");
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    async function fixture(): Promise<PublishImageAuditOptions> {
      const id = crypto.randomUUID(), packageDir = path.join(root,"data","prepared-brand-posts",id), directory = path.join(packageDir,"product-sources"); fs.mkdirSync(directory, { recursive: true });
      const source = path.join(directory, "source.png"), final = path.join(packageDir, "final.png");
      await sharp({ create: { width: 340, height: 340, channels: 3, background: "gray" } }).png().toFile(source); fs.copyFileSync(source, final);
      const url = `https://shop-phinf.pstatic.net/scoped/${id}.png`, snapshot = createProductSnapshot({ productId: id, externalProductId: "1", connectKind: "SHOPPING",
        sourceUrl: "https://smartstore.naver.com/scoped/products/1", product: { name: "EXPECTED_SELECTED_SUBJECT", features: ["verified selected component"], referenceImageUrls: [url] } });
      fs.writeFileSync(`${source}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: url, sha256: hash(source), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
      return { forceReview:true, productName: "EXPECTED_SELECTED_SUBJECT", selectedProduct: JSON.stringify({ selectedTitle: "EXPECTED_SELECTED_SUBJECT", productKind: "selected fixture component",
        validatedSellerFeatures: [{ text: "Only the fixture component is included; other shown gifts are not selected", evidenceIds: ["seller-feature-1"] }] }),
      sourceSnapshotId: snapshot.snapshotId, selectedSourceSnapshot: snapshot, selectedSourceProductId: id, selectedSourceDirectory: directory,
      imageAssets: [{ path: final, sourcePath: source, sha256: hash(final), role: "body", sectionId: "exterior", slotId: "exterior:image:1", provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false }],
      composition: { sections: [{ id: "exterior", title: "상품 외형", body: ["이 사진에는 선택 상품 외형이 보입니다."], imagePaths: [final],
        characterCount: 30, imageIntent: "판매페이지 원본 상품 사진: 선택 상품 외형", imageSource: "seller-original", headingStyle: "plain" }],
      renderNodes: [{ kind: "heading", sectionId: "exterior", text: "상품 외형" }, { kind: "paragraph", sectionId: "exterior", text: "이 사진에는 선택 상품 외형이 보입니다." },
        { kind: "image", sectionId: "exterior", assetPath: final, role: "detail", altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] } };
    }
    for (mode of ["good", "a-false", "gift", "a-unknown", "c-frame", "c-claim", "c-forged-quote", "c-unknown", "d-ungrounded", "mutation"]) {
      const options = await fixture(), files = [options.imageAssets![0].path, options.imageAssets![0].sourcePath!], before = files.map(hash), priorCalls = providerCalls;
      mutate = () => { options.composition.sections[0].body[0] = "changed during native task"; };
      const result = await auditPublishImages(options);
      assert.equal(result.ok, mode === "good", mode); assert.deepEqual(files.map(hash), before); checks += 2;
      if (mode === "good") { assert.equal(result.scopedReviews!.length, 1); assert.equal(result.scopedReviews![0].identifiers!.nativeExecution, false); checks += 2; }
      else assert(result.failures.length > 0, "no adverse/unknown domain can be voted away");
      if (mode === "a-false") assert.equal(result.scopedReviews![0].visible.row!.identityMatches, false);
      if (mode === "gift") assert.equal((result.scopedReviews![0].visible.row!.picturedMemberEvidence as {verdict:string}).verdict, "nonselected-subject-visible");
      if (mode === "c-frame") assert.equal(result.scopedReviews![0].format.row!.noGraphicLayout, false);
      if (["a-unknown", "c-forged-quote", "c-unknown", "d-ungrounded"].includes(mode)) assert(result.failures.some(failure => failure.code === "INVALID_REVIEW"));
      if (mode === "mutation") { assert(result.failures.some(failure => failure.code === "IMAGE_CHANGED")); assert.equal(providerCalls - priorCalls, 1); checks += 2; }
      else { assert.equal(providerCalls - priorCalls, 3, "one A, one C, one D; canonical source identity needs no B model, no retry-to-pass"); checks++; }
    }
    mode = "good";
    const options = await fixture(), input = { candidatePath: options.imageAssets![0].path, candidateSha256: options.imageAssets![0].sha256!,
      primaryReference: { path: options.imageAssets![0].sourcePath!, sha256: hash(options.imageAssets![0].sourcePath!) }, role: "detail",
      exactCanonicalSellerOriginal: true, sectionTitle: "상품 외형", sectionBody: ["원래 전체 문장"], allowProductPhoto: true,
      selection: visibleIdentityReviewContext(options.selectedProduct!), selectedProduct: options.selectedProduct! };
    const packet = buildScopedPublicationPackets(input)[0], evidence = await executeScopedPublicationPacket(packet);
    assert.equal(scopedPublicationEvidenceIssue(evidence, { task: "A-visible", candidateSha256: input.candidateSha256, primaryReferenceSha256: input.primaryReference.sha256 }), null); checks++;
    for (const changed of ["request", "raw", "parsed", "source", "candidate", "injected"] as const) {
      const tampered = structuredClone(evidence);
      if (changed === "request") tampered.request.maxImages = 8;
      if (changed === "raw") tampered.rawResponse += " ";
      if (changed === "parsed") tampered.row!.accepted = false;
      if (changed === "source") tampered.context.primaryReferenceSha256 = "f".repeat(64);
      if (changed === "candidate") tampered.context.candidateSha256 = "e".repeat(64);
      if (changed === "injected") tampered.nativeExecution = false;
      assert(scopedPublicationEvidenceIssue(tampered, { task: "A-visible", candidateSha256: input.candidateSha256, primaryReferenceSha256: input.primaryReference.sha256 })); checks++;
    }
    mode="good";
    const cacheOptions={policyFingerprint:"a".repeat(64)}, cachePacket=buildScopedPublicationPackets(input)[0], beforeCache=providerCalls;
    await executeScopedPublicationPacket(cachePacket,undefined,cacheOptions);
    const reusedPacket=await executeScopedPublicationPacket(cachePacket,undefined,cacheOptions);
    assert.equal(providerCalls-beforeCache,1);assert.equal(reusedPacket.reused,true);checks+=2;
    await executeScopedPublicationPacket(cachePacket,undefined,{...cacheOptions,forceReview:true});assert.equal(providerCalls-beforeCache,2);checks++;
    await executeScopedPublicationPacket(cachePacket,undefined,{policyFingerprint:"b".repeat(64)});assert.equal(providerCalls-beforeCache,3);checks++;
    for(const invalidMode of ["c-positive-invalid","c-positive-invalid-witness"]) {
      const claimPacket=buildScopedPublicationPackets(input)[1],policyFingerprint=crypto.createHash("sha256").update(invalidMode).digest("hex"),before=providerCalls;
      mode=invalidMode;const invalid=await executeScopedPublicationPacket(claimPacket,undefined,{policyFingerprint});
      mode="good";const current=await executeScopedPublicationPacket(claimPacket,undefined,{policyFingerprint});
      const reused=await executeScopedPublicationPacket(claimPacket,undefined,{policyFingerprint});
      assert.equal(providerCalls-before,2);assert.equal(invalid.row!.accepted,true);assert.equal(invalid.reused,undefined);
      assert.equal(current.reused,undefined);assert.equal(reused.reused,true);checks+=5;
    }
    const {picturedMemberFacts,picturedMemberEvidenceIssue}=require("./lib/publication-image-scoped-review") as typeof import("./lib/publication-image-scoped-review");
    const kit=JSON.stringify({selectedTitle:"Synthetic upper/lower clothing set",validatedSellerFeatures:[{text:"구성: 상하세트",evidenceIds:["source-composition"]}]});
    const memberFacts=picturedMemberFacts(kit);assert.deepEqual(memberFacts.map(f=>f.memberLabel),["상의","하의"]);checks++;
    const memberEvidence={scope:"pictured-member-only",memberFactIndex:0,picturedMember:"상의",selectedFact:"구성: 상하세트",referenceObservation:"Visible upper neckline and sleeves",candidateObservation:"Corresponding upper neckline and sleeves",verdict:"selected-member-visible",conflict:""};
    assert.equal(picturedMemberEvidenceIssue({picturedMemberEvidence:memberEvidence},kit),null);checks++;
    for(const changed of [{...memberEvidence,scope:"complete-bundle"},{...memberEvidence,memberFactIndex:2},{...memberEvidence,picturedMember:"상하세트"},{...memberEvidence,selectedFact:"invented gift fact"}]) {
      assert(picturedMemberEvidenceIssue({picturedMemberEvidence:changed},kit));checks++;
    }
    assert(picturedMemberEvidenceIssue({visibleMemberInclusion:{verdict:"included-visible-member"}},kit));checks++;
    const kitA=buildScopedPublicationPackets({...input,selectedProduct:kit})[0];
    const kitData=JSON.parse(kitA.call.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
    assert.deepEqual(kitData.selectedSubjectFacts.picturedMemberCandidates,memberFacts.map((fact,memberFactIndex)=>({memberFactIndex,...fact})));
    assert(!("validatedSellerFeatures" in kitData.selectedSubjectFacts));checks+=2;
    // Display units are exact render-string slices, not arbitrary excerpts.
    const {publicationClaimUnits} = require("./lib/publication-claim-units") as typeof import("./lib/publication-claim-units");
    const original = "첫 문단.\n\n사진에서는 작은 본체가 보여요.\r\n\r\n 마지막 원문 ";
    const units = publicationClaimUnits([original],[17]);
    assert.equal(units.length,3); checks++;
    for (const unit of units) { assert.equal(original.slice(unit.startOffset,unit.endOffset),unit.text); assert.equal(unit.sourceRenderNodeIndex,17);
      assert.equal(unit.sha256,crypto.createHash("sha256").update(unit.text).digest("hex")); checks += 3; }
    const mappedPackets = buildScopedPublicationPackets({...input,sectionBody:[original],sectionBodyRenderNodeIndices:[17]});
    const cData = JSON.parse(mappedPackets[1].call.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
    assert.deepEqual(cData.displayedParagraphs,units); assert(!mappedPackets[2].call.userPrompt.includes("첫 문단") && !mappedPackets[2].call.userPrompt.includes("마지막 원문")); checks += 2;
    for (mode of ["c-second-paragraph","c-substring"]) {
      const options = await fixture(), raw = "첫 구매 판단 문단.\n\n사진에서는 귀에 거는 형태와 검은색 본체, 로고를 확인할 수 있어요.";
      const paragraph = options.composition.renderNodes.find(n => n.kind === "paragraph")!;
      if (paragraph.kind === "paragraph") paragraph.text=raw; options.composition.sections[0].body=[raw];
      const result = await auditPublishImages(options);
      assert.equal(result.ok,false); assert.equal(result.failures.some(f => f.code === "INVALID_REVIEW"),mode === "c-substring");
      if(mode === "c-second-paragraph") assert(result.failures.some(f => f.photoClaimMismatchOnly));
      assert.equal((paragraph as {text:string}).text,raw); checks+=4;
    }
    // The composite's OWN intact receipt selects its canonical source. A
    // different arbitrary gallery image or invalid receipt is never fallback.
    mode="good";
    const composite=await fixture(), hero=composite.imageAssets![0], source=hero.sourcePath!;
    await sharp({create:{width:340,height:340,channels:3,background:"silver"}}).png().toFile(hero.path); hero.sha256=hash(hero.path);
    hero.role="hero";hero.sectionId=undefined;hero.provenance="PHOTO_TEXT_THUMBNAIL";hero.creationMethod="local-composite";
    fs.writeFileSync(`${hero.path}.source.json`,JSON.stringify({version:"product-photo-source/v1",sourcePath:source,sourceSha256:hash(source),outputSha256:hero.sha256,provenance:"PHOTO_TEXT_THUMBNAIL",segmented:false}));
    composite.composition.renderNodes=[{kind:"image",sectionId:null,assetPath:hero.path,role:"thumbnail",altText:"제목",layout:"single",sourcePolicy:"LOCKED_PRODUCT_OR_ORIGINAL"}];
    const validComposite=await auditPublishImages(composite);
    assert(!validComposite.failures.some(f => f.code==="INVALID_CONTEXT"));
    assert.equal(validComposite.scopedReviews![0].visible.context.primaryReferenceSha256,hash(source)); checks+=2;
    const sourceReceipt=fs.readFileSync(`${hero.path}.source.json`);fs.writeFileSync(`${hero.path}.source.json`,sourceReceipt.toString().replace(hash(source),"e".repeat(64)));
    const invalidComposite=await auditPublishImages(composite);assert(invalidComposite.failures.some(f => f.code==="INVALID_CONTEXT"));checks++;
    fs.writeFileSync(`${hero.path}.source.json`,sourceReceipt);
    // Actual native B evidence can leave printing explicitly uncertified while
    // geometry/claims/format stay positive. It never changes raw false/null.
    async function printFixture() {
      const value=await fixture(),asset=value.imageAssets![0],src=asset.sourcePath!;
      await sharp({create:{width:340,height:340,channels:3,background:"silver"}}).png().toFile(asset.path);asset.sha256=hash(asset.path);
      asset.provenance="GENERATED_SCENE";asset.creationMethod="reference-guided-scene";asset.remoteGenerated=true;
      asset.referenceScene={strategyVersion:REFERENCE_SCENE_STRATEGY_VERSION,sourceSnapshotId:value.sourceSnapshotId!,referencePath:src,referenceSha256:hash(src),
        reviewedOutputSha256:asset.sha256!,reviewStatus:"passed",checks:Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(check=>[check,true]))};
      value.composition.sections[0].imageSource="staged-ai";value.composition.sections[0].imageIntent="AI 연출 이미지: 자연스러운 생활 장면";
      const image=value.composition.renderNodes.find(node=>node.kind==="image")!;Object.assign(image,{role:"scene",caption:REFERENCE_SCENE_CAPTION});
      value.brandLinkId=value.selectedSourceProductId;value.forceReview=false;return value;
    }
    mode="good";const warningOptions=await printFixture(),warningBefore=warningOptions.imageAssets!.map(asset=>hash(asset.path));
    const warned=await assertPublishImagesSafe(warningOptions),warningRaw=warned.scopedReviews![0].identifiers!;
    assert.equal(warned.ok,true);assert.equal(warningRaw.status,"unverified");assert.equal(warningRaw.nativeExecution,false);
    assert.equal(warningRaw.printApplicability!.row!.accepted,false);assert.equal(warningRaw.printApplicability!.row!.samePhysicalPart,null);
    assert.equal(warned.warnings![0].code,"INTRINSIC_PRINT_UNVERIFIED");checks+=6;
    const beforeReuse=providerCalls,reusedWarning=await assertPublishImagesSafe(warningOptions);
    assert.equal(reusedWarning.receiptReused,true);assert.deepEqual(reusedWarning.warnings,warned.warnings);assert.equal(providerCalls,beforeReuse);checks+=3;
    const markerDir=path.join(root,"data","publication-image-defect-proofs"),markerRow={version:"publication-image-defect-seen/v1",id:warningOptions.brandLinkId!,sectionId:"exterior",sha256:warningOptions.imageAssets![0].sha256!};
    fs.mkdirSync(markerDir,{recursive:true});const markerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:markerRow.id,sectionId:markerRow.sectionId,sha256:markerRow.sha256})).digest("hex")}.json`);
    fs.writeFileSync(markerFile,JSON.stringify(markerRow));
    await assert.rejects(assertPublishImagesSafe(warningOptions),/인쇄 결함/);checks++;
    warningOptions.forceReview=true;await assert.rejects(assertPublishImagesSafe(warningOptions),/인쇄 결함/);checks++;
    fs.writeFileSync(markerFile,"malformed");await assert.rejects(assertPublishImagesSafe(warningOptions),/인쇄 결함/);checks++;
    assert.deepEqual(warningOptions.imageAssets!.map(asset=>hash(asset.path)),warningBefore);checks++;
    for(mode of ["a-false","a-unknown","c-frame","print-claim-auth","print-provider","print-malformed"]) {
      const value=await printFixture();value.forceReview=true;const result=await auditPublishImages(value);
      assert.equal(result.ok,false,`print warning cannot bypass ${mode}`);assert.equal(result.warnings?.length || 0,0);checks+=2;
    }
    // The actual default audit writer, isolated from any live package/provider,
    // signs only a fully traced ORIGINAL claim-only defect.
    const {readOriginalPhotoClaimDefect,readPublicationDefectMaterialContext} = require("./lib/publication-image-defect-proof") as typeof import("./lib/publication-image-defect-proof");
    mode = "c-claim";
    const claimOptions = await fixture();
    const id = claimOptions.selectedSourceProductId!, packageDir = path.dirname(claimOptions.imageAssets![0].path);
    const manifest = {schemaVersion:2,brandLinkId:id,createdAt:new Date().toISOString(),title:"정확 원고",hashtags:["원문"],sourceSnapshot:claimOptions.selectedSourceSnapshot,
      composition:claimOptions.composition,imageAssets:claimOptions.imageAssets,heroImagePath:null,bodyImagePaths:[claimOptions.imageAssets![0].path]} as unknown as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
    fs.writeFileSync(path.join(packageDir,"manifest.json"),JSON.stringify(manifest)); claimOptions.brandLinkId=id;
    await assert.rejects(assertPublishImagesSafe(claimOptions)); checks++;
    const signed = readOriginalPhotoClaimDefect(manifest,"exterior",claimOptions.imageAssets![0].sha256!,publicationImageAuditPolicyFingerprint());
    assert(signed,"exact native A/C/D plus deterministic canonical B can admit only original-source rebind"); checks++;
    const retained = readPublicationDefectMaterialContext(signed.proof)!; assert.deepEqual(retained.composition,manifest.composition); checks++;
    assert.equal(readOriginalPhotoClaimDefect({...manifest,title:"foreign body"},"exterior",claimOptions.imageAssets![0].sha256!,publicationImageAuditPolicyFingerprint()),null); checks++;
    const contextFile = path.join(root,"data","publication-image-defect-proofs",signed.proof.materialContext.file), oldContext = fs.readFileSync(contextFile);
    fs.appendFileSync(contextFile," "); assert.equal(readOriginalPhotoClaimDefect(manifest,"exterior",claimOptions.imageAssets![0].sha256!,publicationImageAuditPolicyFingerprint()),null); checks++;
    fs.writeFileSync(contextFile,oldContext);
    fs.renameSync(contextFile,`${contextFile}.missing`);assert.equal(readOriginalPhotoClaimDefect(manifest,"exterior",claimOptions.imageAssets![0].sha256!,publicationImageAuditPolicyFingerprint()),null);checks++;
    fs.renameSync(`${contextFile}.missing`,contextFile);
    assert.equal(readOriginalPhotoClaimDefect(manifest,"exterior",claimOptions.imageAssets![0].sha256!,"f".repeat(64)),null);checks++;
    const canonicalReceipt=`${claimOptions.imageAssets![0].sourcePath}.retrieval.json`,canonicalBytes=fs.readFileSync(canonicalReceipt);
    fs.appendFileSync(canonicalReceipt," ");assert.equal(readOriginalPhotoClaimDefect(manifest,"exterior",claimOptions.imageAssets![0].sha256!,publicationImageAuditPolicyFingerprint()),null);checks++;
    fs.writeFileSync(canonicalReceipt,canonicalBytes);
    const signedBytes = fs.readFileSync(signed.path), broken = JSON.parse(signedBytes.toString()); broken.claimsReview.row.photoClaimObjection.quote="excerpt";
    fs.writeFileSync(signed.path,JSON.stringify(broken)); assert.equal(readOriginalPhotoClaimDefect(manifest,"exterior",claimOptions.imageAssets![0].sha256!,publicationImageAuditPolicyFingerprint()),null); checks++;
    fs.writeFileSync(signed.path,signedBytes);
    assert(calls.every(call => call.imagePaths!.length <= (call.systemPrompt.includes("/B-intrinsic-print") ? 6 : 2))); checks++;
    console.log(`PASS publication scoped native tasks: ${checks} assertions; isolated A own-pair/C exact claims/D pixels; canonical B is byte identity only; adverse/unknown/tamper hold, source bytes preserved; real provider/network zero`);
  } finally { require.cache[providerPath]!.exports = actualProvider; globalThis.fetch = oldFetch;
    if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData;
    fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

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
      if (mode.startsWith("packaged-")) {
        row.picturedMemberEvidence.scope="pictured-member-only";
        row.picturedMemberEvidence.referenceObservation="Selected member's own gray package with a stitched handle and clear front window";
        row.picturedMemberEvidence.candidateObservation="Corresponding own gray package, stitched handle and clear front window; hidden body is not certified";
        row.visibleIdentityEvidence.landmarks=[{part:"handle attachment",referenceObservation:"Handle attached at two top seams",candidateObservation:"Corresponding two top handle seams"},
          {part:"front window",referenceObservation:"Clear front window below the top seam",candidateObservation:"Corresponding front window below the top seam"}];
        if(mode==="packaged-hidden-hold") {row.identityMatches=row.accepted=false;row.visibleIdentityEvidence.basis="insufficient-visible-structure";row.visibleIdentityEvidence.landmarks=[];row.visibleIdentityEvidence.conflict="The reviewer still cannot establish visible own-package correspondence";}
        if(mode==="packaged-wrong") {row.identityMatches=row.accepted=false;row.visibleIdentityEvidence.basis="concrete-conflict";row.visibleIdentityEvidence.conflict="Candidate has a different actual window shape and closure";}
        if(mode==="packaged-gift") {row.accepted=false;row.picturedMemberEvidence.verdict="nonselected-subject-visible";row.picturedMemberEvidence.conflict="This package belongs to an unselected gift, not the selected member";}
      }
      if (mode === "a-false") { row.identityMatches = row.accepted = false; row.visibleIdentityEvidence.basis = "concrete-conflict"; row.visibleIdentityEvidence.conflict = "Actual synthetic connector differs"; }
      if (mode === "gift") { row.accepted = false; row.picturedMemberEvidence.verdict = "nonselected-subject-visible"; row.picturedMemberEvidence.conflict = "Both show a gift explicitly not included in the selected subject"; }
      if (mode === "a-unknown") return JSON.stringify({ ...row, identityMatches: null });
      if (mode === "mutation") mutate?.();
      return JSON.stringify(row);
    }
    if (call.systemPrompt.includes("publication-image-task/C-photo-claims")) {
      assert.equal(call.imagePaths!.length, 1); assert(!call.userPrompt.includes("primaryReferenceImageIndex")); checks += 2;
      const row = c();
      if(mode==="packaged-complete-claim") {row.accepted=row.photoClaimMatches=false;row.photoClaimObjection={origin:"section-body",sourceIndex:0,
        quote:"이 사진에는 구성품 전체가 모두 보입니다.",scope:"complete-set",conflict:"Only an own package is visible; the photograph does not show all claimed contents"};}
      if(mode === "c-positive-invalid") row.photoClaimObjection={origin:"section-body",sourceIndex:0,quote:"inconsistent leftover",scope:"pictured-appearance",conflict:"positive boolean with adverse claim"};
      if(mode === "c-positive-invalid-witness") row.optionConflictWitness={origin:"published-purchase-bundle",quote:"unmixed has a leftover witness",visibleAlternatives:["one","two"]};

      if (mode === "c-claim") { row.accepted = row.photoClaimMatches = false; row.photoClaimObjection = { origin: "section-body", sourceIndex: 0,
        quote: "이 사진에는 선택 상품 외형이 보입니다.", scope: "pictured-appearance", conflict: "Synthetic actual published description contradicts the pixels" }; }
      if (mode === "c-headline-certification") { row.accepted = row.photoClaimMatches = false; row.photoClaimObjection = { origin: "thumbnail-headline", sourceIndex: null,
        quote: "인증된 치료 효과", scope: "result", conflict: "The actual pixel headline asserts certification and efficacy absent from confirmed facts and visible evidence" }; }
      if (mode === "c-second-paragraph" || mode === "c-substring") { row.accepted = row.photoClaimMatches = false; row.photoClaimObjection = {origin:"section-body",sourceIndex:1,
        quote:mode === "c-second-paragraph" ? "사진에서는 귀에 거는 형태와 검은색 본체, 로고를 확인할 수 있어요." : "검은색 본체",scope:"pictured-appearance",conflict:"Actual label close-up does not show the claimed complete hook"}; }
      if (mode === "c-forged-quote") { row.photoClaimMatches = row.accepted = false; row.photoClaimObjection = { origin: "section-body", sourceIndex: 0, quote: "invented sentence", scope: "quantity", conflict: "invalid quoted claim" }; }
      if (mode === "c-unknown") return require("./lib/publication-image-scoped-review").serializeScopedPublicationResponse("C-photo-claims",{ ...row, photoClaimMatches: null });
      if(mode === "print-claim-auth" || mode === "ambiguous-print-proofclaim") row.intrinsicPrintProofClaim=true;
      return require("./lib/publication-image-scoped-review").serializeScopedPublicationResponse("C-photo-claims",row);
    }
    if(mode.startsWith("ambiguous-print") && call.systemPrompt.startsWith("Observe literal physical printing"))
      return JSON.stringify({observation:{literal:"",box:null,identifierRole:"none",location:"not-observed",readability:"ambiguous"}});
    if(mode==="external-word" && call.systemPrompt.startsWith("Observe literal physical printing"))
      return JSON.stringify({observation:path.basename(call.imagePaths![0])==="source.png"?{literal:"",box:null,identifierRole:"none",location:"not-observed",readability:"absent"}
        :{literal:"Artmark",box:{left:100,top:100,width:400,height:150},identifierRole:"brand",location:"intrinsic",readability:"legible"}});
    if(mode==="other-member" && call.systemPrompt.startsWith("Observe literal physical printing") && path.basename(call.imagePaths![0])==="source.png")
      return JSON.stringify({observation:{literal:"Markora",box:{left:100,top:100,width:400,height:150},identifierRole:"brand",location:"intrinsic",readability:"legible"}});
    if(mode==="suspected" && call.systemPrompt.startsWith("Observe literal physical printing") && path.basename(call.imagePaths![0])==="clear.png")
      return JSON.stringify({observation:{literal:"Markora",box:{left:100,top:100,width:400,height:150},identifierRole:"brand",location:"intrinsic",readability:"legible"}});
    if(call.systemPrompt.startsWith("Observe literal physical printing")) return JSON.stringify({observation:{literal:"",box:null,identifierRole:"none",location:"not-observed",
      readability:path.basename(call.imagePaths![0])==="source.png"?"unreadable":"absent"}});
    if(call.systemPrompt.includes("publication-image-task/B-print-applicability")) {
      if(mode === "print-provider") throw Error("offline provider failure");
      if(mode === "print-malformed") return "malformed";
      if(mode==="ambiguous-print-target") return JSON.stringify({sourceObservation:"Whole rectangular printed label inside the selected package window",candidateObservation:"The corresponding printed label is visible in the selected package",
        correspondenceObservation:"The same handle attachments and transparent-window frame locate the label regions",samePhysicalPart:true,samePhysicalSurface:true,sameSelectedVisibleOption:true,
        sourcePrintLocation:"present",candidatePrintLocation:"marked-readable",sourceBox:[306,413,720,694],candidateBox:[272,446,750,801],
        witness:"Both actual label regions are visible, but the single-image observer could not identify one unique word; no letters are certified",
        applicability:"comparable-entire-location",accepted:true});
      if(mode==="external-word") return JSON.stringify({sourceObservation:"Unprinted physical product is below separate flat source artwork",candidateObservation:"The corresponding physical product is unprinted below the same external artwork",
        correspondenceObservation:"Round upper control and rectangular lower button correspond",samePhysicalPart:true,samePhysicalSurface:true,sameSelectedVisibleOption:true,
        sourcePrintLocation:"unprinted",candidatePrintLocation:"own-unprinted-face",sourceBox:null,candidateBox:null,witness:"Two actual local physical controls correspond",
        applicability:"not-applicable-own-unprinted-face",accepted:true,candidateObservedWordRelation:"external-background-artwork",candidateObservedWordBox:[100,100,500,250],
        candidatePhysicalProductsBox:[50,400,900,950],sourceExternalGraphicBox:[100,100,500,250],sourcePhysicalProductsBox:[50,400,900,950],sameExternalGraphic:true,
        externalGraphicObservations:{primaryObservation:"Two matching lines of flat source artwork sit entirely above the physical product",candidateObservation:"The same source artwork content and layout remains above, outside all physical products"},
        candidateObservedWordSpatialWitness:"Both graphic regions are entirely separate from the full physical products/packaging below",
        candidateFaceLandmarks:[{primaryObservation:"round upper control",candidateObservation:"same round upper control"},{primaryObservation:"rectangular lower button",candidateObservation:"same rectangular lower button"}]});
      if(mode==="other-member") return JSON.stringify({sourceObservation:"An unprinted device face is visible separately from a marked included box",candidateObservation:"The same device face is visibly unprinted",
        correspondenceObservation:"Upper round control and lower rectangular button correspond",samePhysicalPart:true,samePhysicalSurface:true,sameSelectedVisibleOption:true,
        sourcePrintLocation:"unprinted",candidatePrintLocation:"own-unprinted-face",sourceBox:null,candidateBox:null,witness:"Two distinct controls identify the same front face",
        applicability:"not-applicable-own-unprinted-face",accepted:true,primaryObservedWordRelation:"other-visible-member-or-face",primaryObservedWordBox:[100,100,500,250],
        comparedPrimaryFaceBox:[20,400,700,900],primaryObservedWordSpatialWitness:"The marked box above is entirely separate from the whole device front below",
        primaryFaceLandmarks:[{primaryObservation:"upper round control",candidateObservation:"same round control"},{primaryObservation:"lower rectangular button",candidateObservation:"same rectangular button"}]});
      if(mode==="suspected") return JSON.stringify({sourceObservation:"An intrinsic mark appears on the OWN primary's small pod",candidateObservation:"The corresponding own-view location appears fully exposed and blank",
        correspondenceObservation:"The own-view pod and connector correspond",samePhysicalPart:true,samePhysicalSurface:true,sameSelectedVisibleOption:true,
        sourcePrintLocation:"present",candidatePrintLocation:"entire-exposed-blank",sourceBox:[100,100,500,250],candidateBox:[200,200,600,400],
        witness:"An own-view omission is suspected at the full exposed location",applicability:"comparable-entire-location",accepted:true});
      return JSON.stringify({sourceObservation:"The source product is visible but this local print location is not resolved",candidateObservation:"The product is visible, but no exact local mark is readable",
        correspondenceObservation:"A already observes physical structure; this task cannot map a fine print location",samePhysicalPart:null,samePhysicalSurface:null,sameSelectedVisibleOption:null,
        sourcePrintLocation:"not-observed",candidatePrintLocation:"unresolved",sourceBox:null,candidateBox:null,witness:"Local fine-print correspondence is not observable",
        applicability:"unresolved",accepted:false});
    }
    if(mode==="suspected" && call.userPrompt.includes("blind-two-image/v1: IMAGE 1")) {
      const properties=(call.outputSchema as {properties:{comparison:{properties:{sourceImageIndex:{enum:number[]};sourceSha256:{enum:string[]}}}}}).properties.comparison.properties;
      return JSON.stringify({coordinateSpace:"normalized-1000",sourceImageSize:{width:340,height:340},candidateImageSize:{width:340,height:340},comparison:{
        sourceImageIndex:properties.sourceImageIndex.enum[0],sourceSha256:properties.sourceSha256.enum[0],sourceObservation:"A clear intrinsic brand word appears on this selected source",
        candidateObservation:"No candidate word is observed at a confirmed corresponding part",correspondenceObservation:"The clear-source local part and face cannot be mapped from this view",
        samePhysicalPart:null,samePhysicalSurface:null,sameSelectedVisibleOption:null,sourcePrintState:"present",candidatePrintState:"not-observed",sourceBox:[100,100,500,250],candidateBox:null,
        sourceLiteral:"Markora",identifierRole:"brand",sourceRegionCoverage:"entire-observed-identifier",candidateRegionCoverage:"not-observed",candidateSurfaceCondition:"unknown",
        candidateIdentifierVisibility:"no-intrinsic-identifiers-observed",identifierComparisons:[],reason:"Independent local correspondence remains unresolved, not a confirmed omission",accepted:false}});
    }
    if (call.systemPrompt.includes("publication-image-task/D-pixel-format")) {
      assert.equal(call.imagePaths!.length, 1); assert(!call.userPrompt.includes("이 사진에는") && !call.userPrompt.includes("displayedParagraphs")); checks += 2;
      const row = d();
      if (mode === "c-frame") { row.accepted = row.noGraphicLayout = false; row.pixelFormatObjection = {kind:"frame-or-panels",location:"image border",observation:"actual synthetic frame around reduced photograph"}; }
      if (mode === "d-body-no-headline") row.thumbnailHeadlineLegible = false;
      if (mode === "d-thumbnail-no-headline") { row.accepted = row.thumbnailHeadlineLegible = false;
        row.pixelFormatObjection = {kind:"headline",location:"upper headline",observation:"The actual headline is clipped and unreadable"}; }
      if (mode === "d-old-negative-generic") { row.accepted = row.textPolicyMatches = false;
        row.reason = "Legacy raw review disputed a generic purchase-check heading";
        row.pixelFormatObjection = {kind:"headline",location:"upper headline",observation:"Legacy native reviewer rejected this visible purchase-check wording"}; }
      if (mode === "d-ungrounded") row.accepted = row.noGraphicLayout = false;
      return JSON.stringify(row);
    }
    throw Error("exact canonical ORIGINAL B must use deterministic bytes identity, not a provider");
  } };
  try {
    const { auditPublishImages, assertPublishImagesSafe, publicationImageAuditPolicyFingerprint } = require("./lib/publish-image-audit") as typeof import("./lib/publish-image-audit");
    const { buildScopedPublicationPackets, executeScopedPublicationPacket, scopedPublicationEvidenceIssue, serializeScopedPublicationResponse,
      parseScopedPublicationResponse, PUBLICATION_OPTION_DECISION_VERSION,PUBLICATION_PHOTO_DECISION_VERSION } = require("./lib/publication-image-scoped-review") as typeof import("./lib/publication-image-scoped-review");
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
    // A's own-packaging scope does not manufacture positive pixels, selected
    // membership or evidence that the photograph displays hidden contents.
    for(mode of ["packaged-good","packaged-hidden-hold","packaged-wrong","packaged-gift","packaged-complete-claim"]) {
      const options=await fixture();
      if(mode==="packaged-complete-claim") {options.composition.sections[0].body=["이 사진에는 구성품 전체가 모두 보입니다."];
        const paragraph=options.composition.renderNodes.find(node=>node.kind==="paragraph");if(paragraph?.kind==="paragraph")paragraph.text=options.composition.sections[0].body[0];}
      const before=options.imageAssets!.map(asset=>hash(asset.path)),body=JSON.stringify(options.composition),priorCalls=providerCalls;
      const result=await auditPublishImages(options),visible=result.scopedReviews![0].visible;
      assert.equal(result.ok,mode==="packaged-good");assert.equal(providerCalls-priorCalls,3,"own packaging does not retry or skip C/D");
      assert.deepEqual(options.imageAssets!.map(asset=>hash(asset.path)),before);assert.equal(JSON.stringify(options.composition),body);
      assert.equal((visible.row!.picturedMemberEvidence as {scope:string}).scope,"pictured-member-only");checks+=5;
      if(mode==="packaged-hidden-hold") {assert.equal(visible.row!.identityMatches,false);assert.equal(visible.row!.accepted,false);
        assert(result.failures.some(failure=>failure.code==="INVALID_REVIEW"));checks+=3;}
      if(mode==="packaged-wrong" || mode==="packaged-gift" || mode==="packaged-complete-claim") {
        assert(result.failures.some(failure=>failure.code==="SEMANTIC_REJECTION"));checks++;
      }
      if(mode==="packaged-complete-claim") {assert.equal(visible.row!.accepted,true);assert.equal(result.scopedReviews![0].claims.row!.photoClaimMatches,false);
        assert.equal((result.scopedReviews![0].claims.row!.photoClaimObjection as {scope:string}).scope,"complete-set");checks+=3;}
    }
    mode = "good";
    const options = await fixture(), input = { candidatePath: options.imageAssets![0].path, candidateSha256: options.imageAssets![0].sha256!,
      primaryReference: { path: options.imageAssets![0].sourcePath!, sha256: hash(options.imageAssets![0].sourcePath!) }, role: "detail",
      exactCanonicalSellerOriginal: true, sectionTitle: "상품 외형", sectionBody: ["원래 전체 문장"], allowProductPhoto: true,
      selection: visibleIdentityReviewContext(options.selectedProduct!), selectedProduct: options.selectedProduct! };
    const packet = buildScopedPublicationPackets(input)[0], evidence = await executeScopedPublicationPacket(packet);
    assert.equal(scopedPublicationEvidenceIssue(evidence, { task: "A-visible", candidateSha256: input.candidateSha256, primaryReferenceSha256: input.primaryReference.sha256 }), null); checks++;
    // A coherent nested wire prevents the actual old true+none contradiction
    // from being generated as a valid answer. No runtime adverse is corrected.
    const claimPacket=buildScopedPublicationPackets(input)[1], claimSchema=claimPacket.call.outputSchema;
    const claimWire=(row:Record<string,unknown>)=>serializeScopedPublicationResponse("C-photo-claims",row);
    const parseClaim=(row:Record<string,unknown>)=>parseScopedPublicationResponse("C-photo-claims",claimWire(row),claimSchema,claimPacket.call.userPrompt);
    const oldContradiction={...c(),mixedOptions:true};
    const oldContradictionRaw=claimWire(oldContradiction);
    assert.equal(parseClaim(oldContradiction),null);
    assert.equal(oldContradiction.mixedOptions,true);assert.deepEqual(oldContradiction.optionConflictWitness,{origin:"none",quote:"",visibleAlternatives:[]});
    const nativeWire=JSON.parse(claimWire(c()));
    assert.equal(nativeWire.optionDecision.version,PUBLICATION_OPTION_DECISION_VERSION);
    assert.equal("mixedOptions" in nativeWire,false);assert.equal("optionConflictWitness" in nativeWire,false);
    assert.deepEqual(parseClaim(c()),c());checks+=7;
    assert.equal(nativeWire.photoDecision.version,PUBLICATION_PHOTO_DECISION_VERSION);
    assert.equal("photoClaimMatches" in nativeWire,false);assert.equal("photoClaimObjection" in nativeWire,false);checks+=3;
    const {hasExplicitPhotographicProofLink}=require("./lib/publication-claim-units") as typeof import("./lib/publication-claim-units");
    const {validatePhotoClaimObjection}=require("./lib/publish-image-audit") as typeof import("./lib/publish-image-audit");
    const adjacentSpec="기능은 오픈형으로 표기되어 있어요. 귀 입구를 막는 밀폐형 이어폰과 착용 구조가 달라 주변 소리를 함께 들으며 음악을 듣고 싶은 상황에 선택 기준이 됩니다.";
    const directProof="이 사진에서 소음이 줄어든 결과가 보인다.";
    const claimFor=(body:string[],title="상품 외형",role="detail")=>buildScopedPublicationPackets({...input,sectionTitle:title,sectionBody:body,role})[1];
    const parseFor=(row:Record<string,unknown>,current:typeof claimPacket)=>parseScopedPublicationResponse(current.task,claimWire(row),current.call.outputSchema,current.call.userPrompt);
    const adversePhoto=(quote:string,scope:string,origin="section-body",sourceIndex:number|null=0)=>({...c(),photoClaimMatches:false,accepted:false,
      photoClaimObjection:{origin,sourceIndex,quote,scope,conflict:"The actual pixels do not establish the exact claimed visible assertion"}});
    const specPacket=claimFor([adjacentSpec]),actualOldFalse=adversePhoto(adjacentSpec,"performance"),actualOldRaw=claimWire(actualOldFalse);
    assert.equal(hasExplicitPhotographicProofLink(adjacentSpec),false);
    assert.equal(parseFor(actualOldFalse,specPacket),null);
    assert.equal(validatePhotoClaimObjection(actualOldFalse,{sectionTitle:"상품 외형",sectionBody:[adjacentSpec],role:"detail"}),false);
    assert.equal(actualOldFalse.photoClaimMatches,false);assert.equal(actualOldRaw,claimWire(actualOldFalse));checks+=5;
    for(const quote of [directProof,"이미지로 충전 시간을 확인할 수 있습니다.","이 장면은 사용 결과를 보여 줍니다.","This photograph demonstrates the noise reduction result.",
      "사진 속에서 먼지가 제거되는 결과를 확인할 수 있어요.","사진을 보면 먼지가 모두 제거됐어요.","위 사진처럼 소음이 줄었어요.","이 컷은 세척력을 보여 줍니다.","Photo shows the reduced noise result."]) {
      assert.equal(hasExplicitPhotographicProofLink(quote),true);
      const target=claimFor([quote]),row=adversePhoto(quote,"performance");
      assert.deepEqual(parseFor(row,target),row);
      assert.equal(validatePhotoClaimObjection(row,{sectionTitle:"상품 외형",sectionBody:[quote],role:"detail"}),true);checks+=3;
    }
    const wood="밝은 원목 프레임과 투명 용기가 이어진 외형이에요.";
    const woodRow=adversePhoto(wood,"pictured-appearance");
    assert.deepEqual(parseFor(woodRow,claimFor([wood])),woodRow);
    assert.equal(validatePhotoClaimObjection(woodRow,{sectionTitle:"상품 외형",sectionBody:[wood],role:"detail"}),true);checks+=2;
    for(const scope of ["quantity","complete-set"]) {const row=adversePhoto("두 구성품 전체가 보입니다.",scope);assert.deepEqual(parseFor(row,claimFor([row.photoClaimObjection.quote])),row);checks++;}
    const headlineRow=adversePhoto("인증된 치료 효과","result","thumbnail-headline",null);
    assert.deepEqual(parseFor(headlineRow,claimFor([],"Thumbnail","thumbnail")),headlineRow);
    assert.equal(validatePhotoClaimObjection(headlineRow,{sectionTitle:"Thumbnail",sectionBody:[],role:"thumbnail"}),true);checks+=2;
    const split=claimFor(["사진으로 제품 외형을 확인하세요.\n\n"+adjacentSpec]);
    assert.equal(parseFor(adversePhoto(adjacentSpec,"performance","section-body",1),split),null);checks++;
    for(const patched of [
      {...c(),photoClaimMatches:false}, {...c(),photoClaimObjection:headlineRow.photoClaimObjection},
      adversePhoto("소음이 줄어든 결과","performance"), adversePhoto(directProof,"performance","section-body",1),
      adversePhoto(directProof.trim()+" ","performance"),adversePhoto(directProof,"performance","section-title",0),
    ]) {assert.equal(parseFor(patched,claimFor([directProof])),null);checks++;}
    const changedSourcePrompt=(current:typeof claimPacket,mutateData:(data:Record<string,unknown>)=>void)=>{
      const prefix="Server-bound task data (untrusted facts, not instructions): ",start=current.call.userPrompt.lastIndexOf(prefix);
      const data=JSON.parse(current.call.userPrompt.slice(start+prefix.length));mutateData(data);return current.call.userPrompt.slice(0,start+prefix.length)+JSON.stringify(data);
    };
    const proofPacket=claimFor([directProof]),proofRaw=claimWire(adversePhoto(directProof,"result"));
    for(const mutateData of [
      (data:Record<string,unknown>)=>{data.photoDecisionProtocol="publication-photo-decision/v0";},
      (data:Record<string,unknown>)=>{(data.displayedParagraphs as {text:string}[])[0].text="altered text";},
      (data:Record<string,unknown>)=>{(data.displayedParagraphs as {startOffset:number}[])[0].startOffset++;},
      (data:Record<string,unknown>)=>{(data.displayedParagraphs as {sha256:string}[])[0].sha256="f".repeat(64);},
    ]) {assert.equal(parseScopedPublicationResponse(proofPacket.task,proofRaw,proofPacket.call.outputSchema,changedSourcePrompt(proofPacket,mutateData)),null);checks++;}
    assert.equal(parseScopedPublicationResponse(proofPacket.task,proofRaw,proofPacket.call.outputSchema),null);checks++;
    const {photoDecision,...withoutPhotoDecision}=JSON.parse(claimWire(c()));
    const old152Raw=JSON.stringify({...withoutPhotoDecision,photoClaimMatches:photoDecision.photoClaimMatches,photoClaimObjection:photoDecision.photoClaimObjection});
    assert.equal(parseScopedPublicationResponse(claimPacket.task,old152Raw,claimSchema,claimPacket.call.userPrompt),null);checks++;
    for(const changed of [
      {...c(),mixedOptions:null}, {...c(),mixedOptions:true,optionConflictWitness:{origin:"published-named-comparison",quote:"원래 전체 문장",visibleAlternatives:["black"]}},
      {...c(),mixedOptions:true,optionConflictWitness:{origin:"none",quote:"원래 전체 문장",visibleAlternatives:["black","gray"]}},
      {...c(),mixedOptions:false,optionConflictWitness:{origin:"published-named-comparison",quote:"원래 전체 문장",visibleAlternatives:["black","gray"]}},
      {...c(),mixedOptions:true,optionConflictWitness:{origin:"published-named-comparison",quote:"",visibleAlternatives:["black","gray"]}},
      {...c(),mixedOptions:false,optionConflictWitness:{origin:"none",quote:"",visibleAlternatives:["black"]}},
    ]) {assert.equal(parseClaim(changed),null);checks++;}
    const trueRow={...c(),mixedOptions:true,accepted:false,optionConflictWitness:{origin:"published-named-comparison",quote:"원래 전체 문장",visibleAlternatives:["black","gray"]}};
    assert.deepEqual(parseClaim(trueRow),trueRow);assert.equal(parseClaim({...c(),accepted:false})!.accepted,false);
    assert.equal(parseClaim({...c(),accepted:null}),null);checks+=3;
    for(const oldRaw of [JSON.stringify(c()),JSON.stringify({...c(),mixedOptions:true}),JSON.stringify({...nativeWire,mixedOptions:false}),
      JSON.stringify({...nativeWire,optionDecision:{...nativeWire.optionDecision,version:"publication-option-decision/v0"}})]) {
      assert.equal(parseScopedPublicationResponse("C-photo-claims",oldRaw,claimSchema,claimPacket.call.userPrompt),null);checks++;
    }
    const oldSchema=structuredClone(claimSchema) as {properties:Record<string,unknown>;required:string[]};
    delete oldSchema.properties.optionDecision;oldSchema.properties.mixedOptions={type:"boolean"};oldSchema.properties.optionConflictWitness={type:"object",properties:{},required:[],additionalProperties:false};
    oldSchema.required=Object.keys(oldSchema.properties);
    assert.equal(parseScopedPublicationResponse("C-photo-claims",JSON.stringify({...c(),optionConflictWitness:{}}),oldSchema,claimPacket.call.userPrompt),null);checks++;
    let malformedCalls=0;
    const incoherent=await executeScopedPublicationPacket(claimPacket,async()=>{malformedCalls++;return oldContradictionRaw;});
    assert.equal(malformedCalls,1);assert.equal(incoherent.row,null);assert.equal(incoherent.rawResponse,oldContradictionRaw);assert.equal(incoherent.nativeExecution,false);checks+=4;
    const coherent=await executeScopedPublicationPacket(claimPacket,async()=>claimWire(trueRow));
    assert.equal(coherent.row!.accepted,false);assert.equal(coherent.row!.mixedOptions,true);
    assert.equal(scopedPublicationEvidenceIssue(coherent,{task:"C-photo-claims",candidateSha256:input.candidateSha256},false),null);
    const changedProjection=structuredClone(coherent);changedProjection.row!.mixedOptions=false;
    assert(scopedPublicationEvidenceIssue(changedProjection,{task:"C-photo-claims",candidateSha256:input.candidateSha256},false));checks+=4;
    const scalarSchema=(extra:Record<string,unknown>)=>({type:"object",properties:{reason:{type:"string"},value:extra},required:["reason","value"],additionalProperties:false});
    const parseValue=(value:unknown,schema:Record<string,unknown>)=>parseScopedPublicationResponse("D-pixel-format",JSON.stringify({reason:"schema fixture",value}),scalarSchema(schema));
    assert(parseValue([{b:2,a:1}],{type:"array",items:{type:"object",properties:{a:{type:"integer"},b:{type:"integer"}},required:["a","b"],additionalProperties:false},enum:[[{a:1,b:2}]],minItems:1,maxItems:1}));checks++;
    for(const [value,schema] of [
      [[],{type:"array",items:{type:"string"},minItems:1}], [["a"],{type:"array",items:{type:"string"},maxItems:0}],
      ["a",{type:"string",minLength:2}], ["ab",{type:"string",maxLength:1}],
      [[],{type:"array",items:{type:"string",unknownKeyword:true}}], [[],{type:"array",items:{type:"string"},minItems:"2"}],
      [[],{type:"array",items:{type:"string"},maxItems:-1}], [[],{type:"array",items:{type:"string"},minItems:2,maxItems:1}],
      ["a",{anyOf:[{type:"string"},{type:"string",unknownKeyword:true}]}], ["a",{anyOf:[]}],
      ["a",{anyOf:[{type:"string"}],type:"string"}], ["a",{type:"string",enum:[]}],
      [[],{type:"array",items:{type:"string"},additionalProperties:false}],
      [null,{type:["null","string"],minLength:-1}], [true,{type:"boolean",minItems:0}],
    ] as const) {assert.equal(parseValue(value,schema),null);checks++;}
    const duplicatePhysical=a();duplicatePhysical.visibleIdentityEvidence.landmarks[1].part=duplicatePhysical.visibleIdentityEvidence.landmarks[0].part;
    const {visibleIdentityEvidenceIssue}=require("./lib/publication-visible-identity") as typeof import("./lib/publication-visible-identity");
    assert(visibleIdentityEvidenceIssue(duplicatePhysical,visibleIdentityReviewContext(input.selectedProduct)));
    assert.equal(visibleIdentityEvidenceIssue(a(),visibleIdentityReviewContext(input.selectedProduct)),null);
    assert(packet.call.userPrompt.includes("Two people/items both having an upper garment are not two different features"));checks+=3;
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
    // Facts belong to C's assertion checks. D's actual packet is mechanically
    // limited to role/source-watermark policy, even if private seller facts
    // contain capacities, certifications or misleading instructional text.
    const privateFacts = ["PRIVATE_SCOPE_SENTINEL_8d9e", "capacity 7321 mL", "seller certificate ABC-912"];
    const selectedWithPrivateFacts = JSON.stringify({selectedTitle:"PRIVATE_SELECTED_TITLE_72a4",productKind:"PRIVATE_DEVICE_KIND_f9d1",validatedSellerFeatures:
      privateFacts.map((text,index)=>({text,evidenceIds:[`seller-${index}`]}))});
    const isolated = buildScopedPublicationPackets({...input,selectedProduct:selectedWithPrivateFacts,sectionTitle:"구매 전에 살펴볼 점",
      sectionBody:["실제 사용 환경에 맞는지 확인하세요."]});
    const taskData = (value:typeof isolated[number]) => JSON.parse(value.call.userPrompt!.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
    assert.deepEqual(taskData(isolated[2]),{role:"detail",exactCanonicalSellerOriginal:true});
    assert.deepEqual(taskData(isolated[1]).selectedSubjectFacts.validatedSellerFeatures.map((row:{text:string})=>row.text),privateFacts);
    assert.deepEqual(taskData(isolated[1]).displayedParagraphs.map((row:{text:string})=>row.text),["실제 사용 환경에 맞는지 확인하세요."]);
    const forbiddenFormatContext = [...privateFacts,"PRIVATE_SELECTED_TITLE_72a4","PRIVATE_DEVICE_KIND_f9d1","구매 전에 살펴볼 점","실제 사용 환경에 맞는지 확인하세요."];
    for (const secret of forbiddenFormatContext) assert.equal(JSON.stringify(isolated[2].call).includes(secret),false);
    checks += 3 + forbiddenFormatContext.length;
    mode="good";
    const cacheOptions={policyFingerprint:"a".repeat(64)}, cachePacket=buildScopedPublicationPackets(input)[0], beforeCache=providerCalls;
    await executeScopedPublicationPacket(cachePacket,undefined,cacheOptions);
    const reusedPacket=await executeScopedPublicationPacket(cachePacket,undefined,cacheOptions);
    assert.equal(providerCalls-beforeCache,1);assert.equal(reusedPacket.reused,true);checks+=2;
    await executeScopedPublicationPacket(cachePacket,undefined,{...cacheOptions,forceReview:true});assert.equal(providerCalls-beforeCache,2);checks++;
    await executeScopedPublicationPacket(cachePacket,undefined,{policyFingerprint:"b".repeat(64)});assert.equal(providerCalls-beforeCache,3);checks++;
    // The exact native D cache observes actual role: a body has no thumbnail
    // headline requirement, while an adverse thumbnail never becomes cached.
    const cachePolicy=(label:string)=>crypto.createHash("sha256").update(label).digest("hex");
    const bodyFormatPacket=buildScopedPublicationPackets({...input,role:"body"})[2],formatCache={policyFingerprint:cachePolicy("body-format-cache")};
    mode="d-body-no-headline";const beforeBodyCache=providerCalls;
    const bodyFormat=await executeScopedPublicationPacket(bodyFormatPacket,undefined,formatCache);
    const bodyFormatReused=await executeScopedPublicationPacket(bodyFormatPacket,undefined,formatCache);
    assert.equal(providerCalls-beforeBodyCache,1);assert.equal(bodyFormat.row!.thumbnailHeadlineLegible,false);assert.equal(bodyFormat.row!.accepted,true);
    assert.equal(bodyFormatReused.reused,true);assert.equal(bodyFormatReused.row!.thumbnailHeadlineLegible,false);checks+=5;
    await executeScopedPublicationPacket(bodyFormatPacket,undefined,{...formatCache,forceReview:true});assert.equal(providerCalls-beforeBodyCache,2);checks++;
    await executeScopedPublicationPacket(bodyFormatPacket,undefined,{policyFingerprint:cachePolicy("other-body-format-policy")});assert.equal(providerCalls-beforeBodyCache,3);checks++;
    const bodyCandidateBytes=fs.readFileSync(input.candidatePath);
    try {
      await sharp({create:{width:340,height:340,channels:3,background:"rgb(25,55,85)"}}).png().toFile(input.candidatePath);
      await assert.rejects(executeScopedPublicationPacket(bodyFormatPacket,undefined,formatCache),/SCOPED_IMAGE_INPUT_CHANGED/);checks++;
      const changedFormatPacket=buildScopedPublicationPackets({...input,candidateSha256:hash(input.candidatePath),role:"body"})[2];
      assert.notEqual(changedFormatPacket.requestSha256,bodyFormatPacket.requestSha256);checks++;
      await executeScopedPublicationPacket(changedFormatPacket,undefined,formatCache);assert.equal(providerCalls-beforeBodyCache,4);checks++;
    } finally {fs.writeFileSync(input.candidatePath,bodyCandidateBytes);}
    const thumbFormatPacket=buildScopedPublicationPackets({...input,role:"thumbnail"})[2],thumbCache={policyFingerprint:cachePolicy("thumb-format-cache")};
    mode="d-thumbnail-no-headline";const beforeThumbCache=providerCalls;
    for(let attempt=0;attempt<2;attempt++) {const failed=await executeScopedPublicationPacket(thumbFormatPacket,undefined,thumbCache);
      assert.equal(failed.row!.accepted,false);assert.equal(failed.row!.thumbnailHeadlineLegible,false);assert.equal(failed.reused,undefined);checks+=3;}
    assert.equal(providerCalls-beforeThumbCache,2);checks++;
    mode="good";const fixedThumb=await executeScopedPublicationPacket(thumbFormatPacket,undefined,thumbCache),fixedThumbReused=await executeScopedPublicationPacket(thumbFormatPacket,undefined,thumbCache);
    assert.equal(providerCalls-beforeThumbCache,3);assert.equal(fixedThumb.reused,undefined);assert.equal(fixedThumbReused.reused,true);checks+=3;
    mode="c-frame";const adverseBodyCache={policyFingerprint:cachePolicy("body-frame-no-cache")},beforeAdverseCache=providerCalls;
    for(let attempt=0;attempt<2;attempt++) {const failed=await executeScopedPublicationPacket(bodyFormatPacket,undefined,adverseBodyCache);
      assert.equal(failed.row!.noGraphicLayout,false);assert.equal(failed.row!.accepted,false);assert.equal(failed.reused,undefined);checks+=3;}
    assert.equal(providerCalls-beforeAdverseCache,2);checks++;
    mode="good";
    for(const invalidMode of ["c-positive-invalid","c-positive-invalid-witness"]) {
      const claimPacket=buildScopedPublicationPackets(input)[1],policyFingerprint=crypto.createHash("sha256").update(invalidMode).digest("hex"),before=providerCalls;
      mode=invalidMode;const invalid=await executeScopedPublicationPacket(claimPacket,undefined,{policyFingerprint});
      mode="good";const current=await executeScopedPublicationPacket(claimPacket,undefined,{policyFingerprint});
      const reused=await executeScopedPublicationPacket(claimPacket,undefined,{policyFingerprint});
      assert.equal(providerCalls-before,2);
      assert.equal(invalid.row,null);
      assert.equal(invalid.reused,undefined);
      assert.equal(current.reused,undefined);assert.equal(reused.reused,true);checks+=5;
    }
    const {picturedMemberFacts,picturedMemberEvidenceIssue,VISIBLE_PRESENTATION_SCOPE}=require("./lib/publication-image-scoped-review") as typeof import("./lib/publication-image-scoped-review");
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
    assert.deepEqual(kitData.visiblePresentationScope,VISIBLE_PRESENTATION_SCOPE);
    assert.equal(kitData.visiblePresentationScope.hiddenContentsCertified,false);
    assert.equal(kitData.visiblePresentationScope.completeSetAndQuantityTask,"C-photo-claims");
    assert.match(kitA.call.userPrompt,/own packaging\/in-packaged state/);
    const scopeSchema=(kitA.call.outputSchema as {properties:{picturedMemberEvidence:{properties:{scope:{enum:string[]}}}}}).properties.picturedMemberEvidence.properties.scope;
    assert.deepEqual(scopeSchema.enum,["pictured-member-only"]);checks+=5;
    const packagedMember={...memberEvidence,scope:"pictured-member-only",referenceObservation:"Own package window and closure",candidateObservation:"Corresponding own package window and closure"};
    assert.equal(picturedMemberEvidenceIssue({picturedMemberEvidence:packagedMember},kit),null);checks++;
    for(const changed of [{...packagedMember,scope:"hidden-contents-certified"},{...packagedMember,selectedFact:"unselected gift package"},
      {...packagedMember,memberFactIndex:2},{...packagedMember,referenceObservation:""},{...packagedMember,verdict:"selected-member-visible",conflict:"Actual different closure"}]) {
      assert(picturedMemberEvidenceIssue({picturedMemberEvidence:changed},kit));checks++;
    }
    const priorQuestion={...kitA.call,userPrompt:kitA.call.userPrompt.replace(JSON.stringify(VISIBLE_PRESENTATION_SCOPE),"{}")};
    const {scopedPublicationRequestSha256}=require("./lib/publication-image-scoped-review") as typeof import("./lib/publication-image-scoped-review");
    assert.notEqual(scopedPublicationRequestSha256(priorQuestion),kitA.requestSha256,"the new packaging scope has its own bound request, never an old-packet relabel");checks++;
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
    async function thumbnailFixture() {
      const value=await fixture(),asset=value.imageAssets![0],original=asset.sourcePath!;
      await sharp({create:{width:340,height:340,channels:3,background:"silver"}}).png().toFile(asset.path); asset.sha256=hash(asset.path);
      asset.role="hero";asset.sectionId=undefined;asset.provenance="PHOTO_TEXT_THUMBNAIL";asset.creationMethod="local-composite";
      fs.writeFileSync(`${asset.path}.source.json`,JSON.stringify({version:"product-photo-source/v1",sourcePath:original,sourceSha256:hash(original),outputSha256:asset.sha256,provenance:"PHOTO_TEXT_THUMBNAIL",segmented:false}));
      value.composition.renderNodes=[{kind:"image",sectionId:null,assetPath:asset.path,role:"thumbnail",altText:"구매 전에 살펴볼 점",layout:"single",sourcePolicy:"LOCKED_PRODUCT_OR_ORIGINAL"}];
      return value;
    }
    mode="good";
    const composite=await thumbnailFixture(),hero=composite.imageAssets![0],source=hero.sourcePath!;
    const validComposite=await auditPublishImages(composite);
    assert(!validComposite.failures.some(f => f.code==="INVALID_CONTEXT"));
    assert.equal(validComposite.scopedReviews![0].visible.context.primaryReferenceSha256,hash(source)); checks+=2;
    const sourceReceipt=fs.readFileSync(`${hero.path}.source.json`);fs.writeFileSync(`${hero.path}.source.json`,sourceReceipt.toString().replace(hash(source),"e".repeat(64)));
    const invalidComposite=await auditPublishImages(composite);assert(invalidComposite.failures.some(f => f.code==="INVALID_CONTEXT"));checks++;
    fs.writeFileSync(`${hero.path}.source.json`,sourceReceipt);
    // Assertion negatives remain authoritative even with independent A and D
    // positives. A generic-heading policy change never rewrites an old raw D
    // negative, and the thumbnail exception never leaks to body-image checks.
    for (mode of ["c-headline-certification","d-old-negative-generic","d-thumbnail-no-headline"]) {
      const value=await thumbnailFixture(),before=[hash(value.imageAssets![0].path),hash(value.imageAssets![0].sourcePath!)];
      const result=await auditPublishImages(value),tasks=result.scopedReviews![0];
      assert.equal(result.ok,false,mode);assert.equal(tasks.visible.row!.identityMatches,true);assert(result.failures.some(f=>f.code==="SEMANTIC_REJECTION"));
      if(mode==="c-headline-certification") {assert.equal(tasks.claims.row!.photoClaimMatches,false);assert.equal(tasks.format.row!.accepted,true);}
      else {assert.equal(tasks.format.row!.accepted,false);assert.equal(tasks.claims.row!.photoClaimMatches,true);}
      assert.deepEqual([hash(value.imageAssets![0].path),hash(value.imageAssets![0].sourcePath!)],before);checks+=6;
    }
    mode="d-body-no-headline";
    const noBodyHeadline=await auditPublishImages(await fixture());
    assert.equal(noBodyHeadline.ok,true);assert.equal(noBodyHeadline.scopedReviews![0].format.row!.thumbnailHeadlineLegible,false);checks+=2;
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
    async function ambiguousPrintFixture(shade:number) {
      const value=await printFixture(),asset=value.imageAssets![0],src=asset.sourcePath!;
      // Observations are correctly cached by exact pixels, independently of
      // product IDs. Each semantic case gets distinct synthetic images.
      await sharp({create:{width:340,height:340,channels:3,background:`rgb(${shade},140,159)`}}).png().toFile(asset.path);asset.sha256=hash(asset.path);
      await sharp({create:{width:340,height:340,channels:3,background:`rgb(${shade},120,139)`}}).png().toFile(src);
      const retrieval=`${src}.retrieval.json`,receipt=JSON.parse(fs.readFileSync(retrieval,"utf8"));
      receipt.sha256=hash(src);fs.writeFileSync(retrieval,JSON.stringify(receipt));
      asset.referenceScene!.referenceSha256=hash(src);asset.referenceScene!.reviewedOutputSha256=asset.sha256;
      return value;
    }
    mode="ambiguous-print";const ambiguousOptions=await ambiguousPrintFixture(121),ambiguousBytes=ambiguousOptions.imageAssets!.map(asset=>hash(asset.path));
    const ambiguousStart=calls.length,ambiguousFinal=await assertPublishImagesSafe(ambiguousOptions),ambiguousRaw=ambiguousFinal.scopedReviews![0].identifiers!;
    assert.equal(ambiguousFinal.ok,true);assert.equal(ambiguousRaw.status,"unverified");assert.equal(ambiguousRaw.nativeExecution,false);
    assert.equal(ambiguousRaw.blindInputObservations!.candidate.observation.readability,"ambiguous");
    assert.equal(ambiguousRaw.blindInputObservations!.sources[0].evidence.observation.readability,"ambiguous");
    assert.equal(ambiguousRaw.printApplicability!.row!.accepted,false);assert.equal(ambiguousRaw.printApplicability!.row!.samePhysicalPart,null);
    assert.equal(ambiguousRaw.identifierConflict,undefined);assert.equal(ambiguousRaw.missingPrintEvidence,undefined);
    assert.equal(calls.slice(ambiguousStart).filter(call=>call.systemPrompt.includes("B-print-applicability")).length,1);
    assert.equal(calls.slice(ambiguousStart).filter(call=>call.userPrompt.includes("blind-two-image/v1: IMAGE 1")).length,0);
    assert.equal(ambiguousFinal.warnings![0].code,"INTRINSIC_PRINT_UNVERIFIED");checks+=12;
    const beforeAmbiguousReuse=providerCalls,ambiguousReused=await assertPublishImagesSafe(ambiguousOptions);
    assert.equal(ambiguousReused.receiptReused,true);assert.deepEqual(ambiguousReused.warnings,ambiguousFinal.warnings);assert.equal(providerCalls,beforeAmbiguousReuse);checks+=3;
    const ambiguousMarker={...markerRow,id:ambiguousOptions.brandLinkId!,sha256:ambiguousOptions.imageAssets![0].sha256!};
    const ambiguousMarkerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:ambiguousMarker.id,sectionId:ambiguousMarker.sectionId,sha256:ambiguousMarker.sha256})).digest("hex")}.json`);
    fs.writeFileSync(ambiguousMarkerFile,JSON.stringify(ambiguousMarker));await assert.rejects(assertPublishImagesSafe(ambiguousOptions),/인쇄 결함/u);checks++;
    ambiguousOptions.forceReview=true;await assert.rejects(assertPublishImagesSafe(ambiguousOptions),/인쇄 결함/u);checks++;
    fs.writeFileSync(ambiguousMarkerFile,"malformed");await assert.rejects(assertPublishImagesSafe(ambiguousOptions),/인쇄 결함/u);checks++;
    assert.deepEqual(ambiguousOptions.imageAssets!.map(asset=>hash(asset.path)),ambiguousBytes);checks++;
    mode="ambiguous-print-target";const targetOptions=await ambiguousPrintFixture(139),targetBytes=targetOptions.imageAssets!.map(asset=>hash(asset.path));
    const targetFinal=await assertPublishImagesSafe(targetOptions),targetRaw=targetFinal.scopedReviews![0].identifiers!;
    assert.equal(targetFinal.ok,true);assert.equal(targetRaw.status,"unverified");assert.equal(targetRaw.nativeExecution,false);
    assert.equal(targetRaw.printObservationWarning!.version,"publication-target-ambiguous-print-warning/v1");
    assert.equal(targetRaw.blindInputObservations!.candidate.observation.readability,"ambiguous");assert.equal(targetRaw.printApplicability!.row!.candidatePrintLocation,"marked-readable");
    assert.equal(targetRaw.identifierConflict,undefined);assert.equal(targetRaw.missingPrintEvidence,undefined);checks+=8;
    const beforeTargetReuse=providerCalls,targetReuse=await assertPublishImagesSafe(targetOptions);
    assert.equal(targetReuse.receiptReused,true);assert.deepEqual(targetReuse.warnings,targetFinal.warnings);assert.equal(providerCalls,beforeTargetReuse);checks+=3;
    const targetMarker={...markerRow,id:targetOptions.brandLinkId!,sha256:targetOptions.imageAssets![0].sha256!};
    const targetMarkerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:targetMarker.id,sectionId:targetMarker.sectionId,sha256:targetMarker.sha256})).digest("hex")}.json`);
    fs.writeFileSync(targetMarkerFile,JSON.stringify(targetMarker));await assert.rejects(assertPublishImagesSafe(targetOptions),/인쇄 결함/u);checks++;
    targetOptions.forceReview=true;await assert.rejects(assertPublishImagesSafe(targetOptions),/인쇄 결함/u);checks++;
    fs.writeFileSync(targetMarkerFile,"malformed");await assert.rejects(assertPublishImagesSafe(targetOptions),/인쇄 결함/u);checks++;
    assert.deepEqual(targetOptions.imageAssets!.map(asset=>hash(asset.path)),targetBytes);checks++;
    mode="ambiguous-print-proofclaim";const ambiguousClaim=await auditPublishImages(await ambiguousPrintFixture(151));
    assert.equal(ambiguousClaim.ok,false);assert.equal(ambiguousClaim.warnings?.length||0,0);
    assert.equal(ambiguousClaim.scopedReviews![0].claims.row!.intrinsicPrintProofClaim,true);checks+=3;
    mode="suspected";const suspectedOptions=await printFixture(),clear=path.join(suspectedOptions.selectedSourceDirectory!,"clear.png");
    await sharp({create:{width:340,height:340,channels:3,background:"black"}}).png().toFile(clear);
    const originalSnapshot=suspectedOptions.selectedSourceSnapshot as ReturnType<typeof createProductSnapshot>,clearUrl="https://shop-phinf.pstatic.net/scoped/clear.png";
    const suspectedSnapshot=createProductSnapshot({...originalSnapshot,product:{...originalSnapshot.product,
      referenceImageUrls:[...(Array.isArray(originalSnapshot.product.referenceImageUrls)?originalSnapshot.product.referenceImageUrls:[]),clearUrl]}});
    fs.writeFileSync(`${clear}.retrieval.json`,JSON.stringify({version:"product-image-retrieval/v1",sourceUrl:clearUrl,sha256:hash(clear),retrievedAt:new Date(Date.now()-1000).toISOString()}));
    suspectedOptions.selectedSourceSnapshot=suspectedSnapshot;suspectedOptions.sourceSnapshotId=suspectedSnapshot.snapshotId;suspectedOptions.imageAssets![0].referenceScene!.sourceSnapshotId=suspectedSnapshot.snapshotId;
    const suspected=await assertPublishImagesSafe(suspectedOptions),rawSuspected=suspected.scopedReviews![0].identifiers!;
    assert.equal(suspected.ok,true);assert.equal(suspected.warnings![0].kind,"suspected-omission-uncorroborated");assert.match(suspected.warnings![0].reason,/누락 의심·미확정/u);
    assert.equal(rawSuspected.status,"unverified");assert.equal(rawSuspected.comparison!.accepted,false);assert.equal(rawSuspected.comparison!.samePhysicalPart,null);
    assert.equal(rawSuspected.printApplicability!.row!.accepted,true);assert.equal(rawSuspected.printApplicability!.row!.candidatePrintLocation,"entire-exposed-blank");assert.notEqual(rawSuspected.rawB,"");checks+=9;
    const beforeSuspectedReuse=providerCalls,reusedSuspected=await assertPublishImagesSafe(suspectedOptions);
    assert.equal(reusedSuspected.receiptReused,true);assert.deepEqual(reusedSuspected.warnings,suspected.warnings);assert.equal(providerCalls,beforeSuspectedReuse);checks+=3;
    const suspectedMarker={...markerRow,id:suspectedOptions.brandLinkId!,sha256:suspectedOptions.imageAssets![0].sha256!};
    const suspectedMarkerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:suspectedMarker.id,sectionId:suspectedMarker.sectionId,sha256:suspectedMarker.sha256})).digest("hex")}.json`);
    fs.writeFileSync(suspectedMarkerFile,JSON.stringify(suspectedMarker));await assert.rejects(assertPublishImagesSafe(suspectedOptions),/인쇄 결함/u);checks++;
    suspectedOptions.forceReview=true;await assert.rejects(assertPublishImagesSafe(suspectedOptions),/인쇄 결함/u);checks++;
    fs.writeFileSync(suspectedMarkerFile,"malformed");await assert.rejects(assertPublishImagesSafe(suspectedOptions),/인쇄 결함/u);checks++;
    mode="other-member";const otherMemberOptions=await printFixture(),otherMemberSource=otherMemberOptions.imageAssets![0].sourcePath!;
    await sharp({create:{width:340,height:340,channels:3,background:"rgb(48,74,99)"}}).png().toFile(otherMemberSource);
    const otherReceiptFile=`${otherMemberSource}.retrieval.json`,otherSourceReceipt=JSON.parse(fs.readFileSync(otherReceiptFile,"utf8"));
    otherSourceReceipt.sha256=hash(otherMemberSource);fs.writeFileSync(otherReceiptFile,JSON.stringify(otherSourceReceipt));
    otherMemberOptions.imageAssets![0].referenceScene!.referenceSha256=hash(otherMemberSource);
    const otherMemberWarning=await assertPublishImagesSafe(otherMemberOptions),otherRaw=otherMemberWarning.scopedReviews![0].identifiers!;
    assert.equal(otherMemberWarning.ok,true);assert.equal(otherRaw.status,"unverified");assert.equal(otherRaw.nativeExecution,false);
    assert.equal(otherRaw.printObservationWarning!.version,"publication-other-member-print-warning/v1");
    assert.equal(otherRaw.blindInputObservations!.sources[0].evidence.observation.literal,"Markora");
    assert.equal(otherRaw.printApplicability!.row!.primaryObservedWordRelation,"other-visible-member-or-face");
    assert.equal(otherRaw.identifierConflict,undefined);assert.equal(otherRaw.missingPrintEvidence,undefined);checks+=8;
    const beforeOtherReuse=providerCalls,otherReused=await assertPublishImagesSafe(otherMemberOptions);
    assert.equal(otherReused.receiptReused,true);assert.deepEqual(otherReused.warnings,otherMemberWarning.warnings);assert.equal(providerCalls,beforeOtherReuse);checks+=3;
    const otherMarker={...markerRow,id:otherMemberOptions.brandLinkId!,sha256:otherMemberOptions.imageAssets![0].sha256!};
    const otherMarkerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:otherMarker.id,sectionId:otherMarker.sectionId,sha256:otherMarker.sha256})).digest("hex")}.json`);
    fs.writeFileSync(otherMarkerFile,JSON.stringify(otherMarker));await assert.rejects(assertPublishImagesSafe(otherMemberOptions),/인쇄 결함/u);checks++;
    otherMemberOptions.forceReview=true;await assert.rejects(assertPublishImagesSafe(otherMemberOptions),/인쇄 결함/u);checks++;
    fs.writeFileSync(otherMarkerFile,"malformed");await assert.rejects(assertPublishImagesSafe(otherMemberOptions),/인쇄 결함/u);checks++;
    mode="external-word";const externalOptions=await thumbnailFixture(),externalAsset=externalOptions.imageAssets![0],externalSource=externalAsset.sourcePath!;
    await sharp({create:{width:340,height:340,channels:3,background:"rgb(51,79,101)"}}).png().toFile(externalSource);
    await sharp({create:{width:340,height:340,channels:3,background:"rgb(84,117,152)"}}).png().toFile(externalAsset.path);externalAsset.sha256=hash(externalAsset.path);
    const externalRetrieval=`${externalSource}.retrieval.json`,externalRetrievalRow=JSON.parse(fs.readFileSync(externalRetrieval,"utf8"));externalRetrievalRow.sha256=hash(externalSource);fs.writeFileSync(externalRetrieval,JSON.stringify(externalRetrievalRow));
    const externalSidecar=`${externalAsset.path}.source.json`,externalSidecarRow=JSON.parse(fs.readFileSync(externalSidecar,"utf8"));
    externalSidecarRow.sourceSha256=hash(externalSource);externalSidecarRow.outputSha256=externalAsset.sha256;fs.writeFileSync(externalSidecar,JSON.stringify(externalSidecarRow));
    externalOptions.forceReview=false;externalOptions.brandLinkId=externalOptions.selectedSourceProductId;const beforeExternalCalls=calls.length;
    const externalWarning=await assertPublishImagesSafe(externalOptions),externalRaw=externalWarning.scopedReviews![0].identifiers!;
    assert.equal(externalWarning.ok,true);assert.equal(externalRaw.status,"unverified");assert.equal(externalRaw.nativeExecution,false);
    assert.equal(externalRaw.printObservationWarning!.version,"publication-external-word-print-warning/v1");
    assert.equal(externalRaw.blindInputObservations!.candidate.observation.literal,"Artmark");assert.equal(externalRaw.blindInputObservations!.candidate.observation.location,"intrinsic");
    assert.equal(externalRaw.printApplicability!.row!.candidateObservedWordRelation,"external-background-artwork");assert.equal(externalRaw.identifierConflict,undefined);assert.equal(externalRaw.missingPrintEvidence,undefined);
    assert.equal(calls.slice(beforeExternalCalls).filter(call=>call.systemPrompt!.includes("B-print-applicability")).length,1,"one spatial task, no question retry");
    assert.equal(calls.slice(beforeExternalCalls).filter(call=>call.userPrompt.includes("blind-two-image/v1: IMAGE 1")).length,0);checks+=11;
    const beforeExternalReuse=providerCalls,externalReused=await assertPublishImagesSafe(externalOptions);
    assert.equal(externalReused.receiptReused,true);assert.deepEqual(externalReused.warnings,externalWarning.warnings);assert.equal(providerCalls,beforeExternalReuse);checks+=3;
    const externalMarker={...markerRow,id:externalOptions.brandLinkId!,sha256:externalAsset.sha256!};
    const externalSuccessFile=path.join(root,"data","publication-image-audit-receipts",crypto.createHash("sha256").update(externalOptions.brandLinkId!).digest("hex")+".json");
    const externalSuccessBytes=fs.readFileSync(externalSuccessFile);
    // Thumbnail scope is empty; no synthetic section may hide a native
    // rejection marker. Replay only the genuine saved signed receipt bytes.
    const externalHeroMarker={...externalMarker,sectionId:""};
    const externalHeroMarkerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:externalHeroMarker.id,sectionId:externalHeroMarker.sectionId,sha256:externalHeroMarker.sha256})).digest("hex")}.json`);
    for(const markerBytes of [JSON.stringify(externalHeroMarker),"malformed"]) for(const forceReview of [false,true]) {
      fs.writeFileSync(externalSuccessFile,externalSuccessBytes);fs.writeFileSync(externalHeroMarkerFile,markerBytes);externalOptions.forceReview=forceReview;
      const before=providerCalls;await assert.rejects(assertPublishImagesSafe(externalOptions),/인쇄 결함/u);
      if(!forceReview) {assert.equal(providerCalls,before,"even a reused signed receipt must recheck a known/corrupt hero locator");checks++;}checks++;
    }
    fs.rmSync(externalHeroMarkerFile);
    // The same current asset was previously bound to an actual body section.
    // Merely placing its identical pixels in the hero cannot clear that memory.
    externalAsset.sectionId="exterior";externalOptions.forceReview=false;
    await assertPublishImagesSafe(externalOptions);const samePixelsReceipt=fs.readFileSync(externalSuccessFile);
    const externalBodyMarkerFile=path.join(markerDir,`seen-${crypto.createHash("sha256").update(JSON.stringify({id:externalMarker.id,sectionId:externalMarker.sectionId,sha256:externalMarker.sha256})).digest("hex")}.json`);
    for(const markerBytes of [JSON.stringify(externalMarker),"malformed"]) for(const forceReview of [false,true]) {
      fs.writeFileSync(externalSuccessFile,samePixelsReceipt);fs.writeFileSync(externalBodyMarkerFile,markerBytes);externalOptions.forceReview=forceReview;
      const before=providerCalls;await assert.rejects(assertPublishImagesSafe(externalOptions),/인쇄 결함/u);
      if(!forceReview) {assert.equal(providerCalls,before);checks++;}checks++;
    }
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

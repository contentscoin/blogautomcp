/** Offline comparison contracts; injected verdicts do not measure visual accuracy. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import Ajv from "ajv";
import { buildShoppingReferenceScenePrompt, reviewShoppingReferenceScene, selectShoppingSceneReference,
  selectShoppingSceneSupportingReferences, SCENE_FIDELITY_CHECKS, type ShoppingSceneReference } from "./lib/shopping-reference-scene";
import { hasCompleteShoppingGeometryEvidence, resolveShoppingReferenceView, type ShoppingReferenceViewObservation } from "./lib/shopping-reference-view";
import { PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_VERSION, PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN,
  PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_KO, PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO } from "./lib/product-image-visual-contract";
import { auditPublishImages, publicationImageAuditPolicyFingerprint } from "./lib/publish-image-audit";
import { selectVerifiedProductPhotos } from "./lib/product-photo-review";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reference-evidence-scope-")); let checks = 0;
  try {
    const referencePath = path.join(root, "worn-reference.png"), candidatePath = path.join(root, "completed-natural-photo.png"), detailPath = path.join(root, "housing-logo-closeup.png");
    for (const [index, file] of [referencePath, candidatePath, detailPath].entries())
      await sharp({ create: { width: 400, height: 400, channels: 3, background: `rgb(${80 + index * 50},110,150)` } }).png().toFile(file);
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const before = [referencePath, candidatePath, detailPath].map(hash);
    const partial: ShoppingReferenceViewObservation = { subjectState: "worn", cameraView: "side", geometryVisibility: "partial",
      hiddenParts: ["rear band behind head and hair", "opposite ear unit"], intrinsicPrint: "readable", readableIdentifiers: ["Source mark"] };
    const complete: ShoppingReferenceViewObservation = { subjectState: "freestanding", cameraView: "three-quarter", geometryVisibility: "complete",
      hiddenParts: [], intrinsicPrint: "readable", readableIdentifiers: ["Source mark"] };
    const reference: ShoppingSceneReference = { path: referencePath, sha256: hash(referencePath), subject: "selected black ear unit worn at the ear",
      geometry: "distinctive teardrop ear unit, rear housing and short visible band continuing behind hair", labels: "small source mark", reviewedAt: "offline", viewObservation: partial };
    const url = "https://shop-phinf.pstatic.net/offline/selected-detail.png", receipt = `${detailPath}.retrieval.json`;
    fs.writeFileSync(receipt, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: url, sha256: hash(detailPath), retrievedAt: new Date().toISOString() }));
    const detail = { path: detailPath, sha256: hash(detailPath), sourceUrl: url, sourceSnapshotId: "selected-snapshot",
      receiptPath: receipt, receiptSha256: hash(receipt) };
    // Actual failure's legacy observation pattern: a logo close-up was described
    // as worn/partial yet purpose=geometry promoted it to a whole-shape view.
    const legacySupport = { ...detail, ...reference, path: detail.path, sha256: detail.sha256, purpose: "geometry" as const,
      reason: "legacy same-option comparison", viewObservation: partial };
    const legacyBytes = JSON.stringify(legacySupport);
    const selection = { reference, candidates: [detail], sourceSnapshotId: detail.sourceSnapshotId, sourceImageUrls: [url], selectedProduct: "selected black ear unit" };
    const row = (purpose: "geometry" | "intrinsic-label", viewObservation: ShoppingReferenceViewObservation | undefined) => ({
      index: 1, purpose, identityMatches: true, sameVisibleOption: true, geometryConsistent: true, intrinsicPrintingConsistent: true, detailsVisible: true,
      subject: "same selected black product", geometry: "only actually visible structural landmarks", labels: "Source mark", reason: "source/candidate visible details agree", viewObservation,
    });
    const assertRule = (call: CodexDraftOptions) => {
      assert(call.userPrompt.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
      assert.match(call.userPrompt, /not proved absent merely because its full route or far end is not visible/u);
      assert.match(call.userPrompt, /enough independently distinctive visible structure and the selected option/u);
      assert.match(call.userPrompt, /real visible gap\/break\/disconnected or missing identifying structure/u);
      assert.match(call.userPrompt, /genuinely unresolved identity still rejects/u);
      assert.match(call.userPrompt, /never rewrite a returned adverse boolean or verdict/u);
    };
    for (const observation of [partial, undefined, { ...complete, hiddenParts: ["rear connection"] },
      { ...complete, subjectState: "unknown" as const }, { ...complete, cameraView: "unknown" as const }]) {
      assert.deepEqual(await selectShoppingSceneSupportingReferences(selection, { review: async call => { assertRule(call); return JSON.stringify({ references: [row("geometry", observation)] }); } }), []);
      assert.equal(hasCompleteShoppingGeometryEvidence({ viewObservation: observation }), false); checks++;
    }
    for (const [purpose, observation] of [["geometry", complete], ["intrinsic-label", partial]] as const) {
      const result = await selectShoppingSceneSupportingReferences(selection, { review: async call => {
        assertRule(call);
        const schema = call.outputSchema as { properties: { references: { items: { properties: { purpose: { description: string } } } } } };
        assert(schema.properties.references.items.properties.purpose.description.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
        return JSON.stringify({ references: [row(purpose, observation)] });
      } }); assert.equal(result.length, 1); assert.equal(result[0].purpose, purpose); checks++;
    }
    for (const view of [undefined, { ...partial, intrinsicPrint: "unreadable" as const, readableIdentifiers: [] }]) {
      assert.deepEqual(await selectShoppingSceneSupportingReferences(selection, { review: async () => JSON.stringify({ references: [row("intrinsic-label", view)] }) }), []); checks++;
    }
    for (const field of ["identityMatches", "sameVisibleOption", "geometryConsistent", "intrinsicPrintingConsistent", "detailsVisible"])
      { assert.deepEqual(await selectShoppingSceneSupportingReferences(selection, { review: async () => JSON.stringify({ references: [{ ...row("geometry", complete), [field]: false }] }) }), []); checks++; }

    const prompt = buildShoppingReferenceScenePrompt({ productName: "selected black ear unit", sectionTitle: "구매 전 볼 기준", imageIntent: "자연스러운 연출", role: "hero",
      reference, supportingReferences: [legacySupport] });
    assert(prompt.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
    assert.match(prompt, /INPUT 2 is a verified SAME-option seller partial-detail-only view/u);
    assert.doesNotMatch(prompt, /INPUT 2 is a verified SAME-option seller complete-shape view/u);
    assert.equal(resolveShoppingReferenceView(reference, [legacySupport]).presentationChangeSupported, false);
    assert.equal(resolveShoppingReferenceView(reference, [legacySupport]).mayVaryViewpoint, false);
    assert.equal(JSON.stringify(legacySupport), legacyBytes); checks++;
    const source = await selectShoppingSceneReference({ paths: [referencePath], productName: "scope-source", selectedProduct: "scope-selected-black" }, {
      verify: async paths => paths, review: async call => { assertRule(call); return JSON.stringify({ identityMatches: true, geometryReadable: true, observedViewSufficient: true,
        completeShape: false, notDeformed: true, unobstructed: false, subject: reference.subject, geometry: reference.geometry, labels: reference.labels,
        reason: "Visible distinctive instance is identifiable; the hidden band is not claimed observed", viewObservation: partial }); },
    }); assert.deepEqual(source.viewObservation, partial); checks++;
    for (const accepted of [true, false]) {
      let calls = 0;
      const paths = await selectVerifiedProductPhotos([referencePath], `observed-input-first-stage-${accepted}`, 1, {
        purpose: "generation-reference", review: async call => {
          calls++; assert(call.userPrompt.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_KO));
          assert.match(call.userPrompt, /관찰된 부분의 입력으로 쓸 수 있으며 전체 형상·숨은 구조·새 자세의 근거가 아닙니다/u);
          const schema = call.outputSchema as { properties: { productPhoto: { description: string } } };
          assert(schema.properties.productPhoto.description.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_KO));
          return JSON.stringify({ productPhoto: accepted, reason: accepted ? "Visible distinctive same selected subject supports this exact view only" : "actual visible identity is unresolved" });
        },
      }); assert.deepEqual(paths, accepted ? [referencePath] : []); assert.equal(calls, 1); checks++;
    }
    const honestPartial = { identityMatches: true, geometryReadable: true, observedViewSufficient: true, completeShape: false, notDeformed: true, unobstructed: false,
      subject: reference.subject, geometry: reference.geometry, labels: reference.labels,
      reason: "Observed landmarks identify the selected product; the hidden band is not a complete-shape observation", viewObservation: partial };
    const honestBytes = JSON.stringify(honestPartial);
    let inspected = 0;
    const honest = await selectShoppingSceneReference({ paths: [referencePath], productName: "honest-partial", selectedProduct: "honest-partial" }, {
      verify: async paths => paths, review: async call => {
        inspected++; assert.match(call.userPrompt, /Keep completeShape=false and unobstructed=false honestly/u);
        assert.match(call.userPrompt, /input-only eligibility for the retained observed view, never a publication approval/u);
        assert.equal(new Ajv().compile(call.outputSchema!)(honestPartial), true);
        return JSON.stringify(honestPartial);
      },
    }); assert.equal(inspected, 1); assert.equal(honest.viewObservation?.geometryVisibility, "partial");
    assert.equal(JSON.stringify(honestPartial), honestBytes); assert.equal(hasCompleteShoppingGeometryEvidence(honest), false); checks++;
    for (const [index, patch] of [
      { identityMatches: false }, { geometryReadable: false }, { observedViewSufficient: false }, { notDeformed: false },
      { completeShape: true }, { unobstructed: true }, { viewObservation: { ...complete }, completeShape: false, unobstructed: false },
      { viewObservation: { ...partial, subjectState: "unknown" } }, { viewObservation: { ...partial, cameraView: "unknown" } },
      { viewObservation: { ...partial, geometryVisibility: "unknown" } }, { viewObservation: { ...partial, hiddenParts: [] } },
      { viewObservation: { ...complete, hiddenParts: ["rear band"] }, completeShape: true, unobstructed: true },
    ].entries()) {
      let calls = 0;
      await assert.rejects(selectShoppingSceneReference({ paths: [referencePath], productName: "partial-negative", selectedProduct: `partial-negative-${index}` }, {
        verify: async paths => paths, review: async () => { calls++; return JSON.stringify({ ...honestPartial, ...patch }); },
      }), /PRODUCT_REFERENCE_REQUIRED/u); assert.equal(calls, 1); checks++;
    }
    await assert.rejects(selectShoppingSceneReference({ paths: [referencePath], productName: "partial-malformed", selectedProduct: "partial-malformed" }, {
      verify: async paths => paths, review: async () => JSON.stringify({ ...honestPartial, observedViewSufficient: undefined }),
    }), /REFERENCE_SCENE_REVIEW_INVALID/u); checks++;

    const comparisons = Object.fromEntries(["productShape", "intrinsicPrinting", "visibleOption", "sceneContext"].map(key => [key, {
      result: "consistent", variation: "none", referenceObservation: `source ${key} observed`, candidateObservation: `candidate ${key} observed`, basis: "corresponding actually visible landmarks match" }]));
    const good = { comparisons: { ...comparisons, productShape: { result: "allowed-variation", variation: "viewpoint-or-pose",
      referenceObservation: "teardrop ear unit and rear housing with a thin band continuing behind opaque hair",
      candidateObservation: "matching distinctive ear unit, housing and thin continuation behind hair at the same side view",
      basis: "visible design and black option identify the same item; no exposed break or terminating connector, hidden topology is not claimed verified" } },
      checks: Object.fromEntries(SCENE_FIDELITY_CHECKS.map(key => [key, true])), identityMatches: true, illustrativeOnly: true,
      reason: "Matching observed landmarks identify the product without inventing a view of the occluded band", accepted: true };
    const options = { reference, outputPath: candidatePath, productName: "selected black ear unit", imageIntent: "자연스러운 착용 사진",
      sectionTitle: "구매 전 볼 기준", bodyExcerpt: "선택 조건을 살펴보세요.", supportingReferences: [legacySupport] };
    const passed = await reviewShoppingReferenceScene(options, { review: async call => {
      assertRule(call); assert.deepEqual(call.imagePaths, [referencePath, candidatePath, detailPath]);
      assert.match(call.userPrompt, /Evidence coverage: partial-detail-only/u);
      const schema = call.outputSchema as { properties: { comparisons: { properties: { productShape: { description: string } } };
        checks: { properties: { silhouette: { description: string } } }; identityMatches: { description: string } } };
      assert(schema.properties.comparisons.properties.productShape.description.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
      assert(schema.properties.checks.properties.silhouette.description.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
      assert(schema.properties.identityMatches.description.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
      const validate = new Ajv({ allErrors: true }).compile(call.outputSchema!); assert.equal(validate(good), true, JSON.stringify(validate.errors));
      return JSON.stringify(good);
    } }); assert.equal(passed.reviewStatus, "passed"); checks++;
    for (const [label, dimension, check, resultKind, basis] of [
      ["exposed missing real rear band", "productShape", "silhouette", "contradiction", "the unobscured rear connector visibly terminates with a real gap where the source band continues"],
      ["changed physical ear-unit design", "productShape", "proportions", "contradiction", "two bulky housings replace the source teardrop unit"],
      ["prior 211da blank enlarged identifying face", "intrinsicPrinting", "labelHierarchy", "contradiction", "candidate's clearly visible enlarged face is blank where the source has actual product printing"],
      ["readable wrong brand", "intrinsicPrinting", "labelHierarchy", "contradiction", "candidate reads a different brand in the same exposed region"],
      ["wrong visible colour option", "visibleOption", "color", "contradiction", "selected black becomes beige"],
      ["generic obscured unit cannot be identified", "productShape", "silhouette", "unverifiable", "no independently distinctive visible structure resolves the selected product"],
    ]) {
      let calls = 0;
      await assert.rejects(reviewShoppingReferenceScene(options, { review: async call => { calls++; assertRule(call);
        return JSON.stringify({ ...good, comparisons: { ...good.comparisons, [dimension]: { result: resultKind, variation: "none",
          referenceObservation: "actual identifying source landmark", candidateObservation: basis, basis } }, checks: { ...good.checks, [check]: false },
          identityMatches: false, accepted: true, reason: label });
      } }), /REFERENCE_SCENE_FIDELITY_FAILED/u); assert.equal(calls, 1); checks++;
    }
    for (const check of SCENE_FIDELITY_CHECKS) {
      await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify({ ...good, checks: { ...good.checks, [check]: false }, accepted: true }) }), /REFERENCE_SCENE_FIDELITY_FAILED/u); checks++;
    }
    const garmentReference = { ...reference, subject: "selected male black plain thermal top, not the adjacent grey garment",
      geometry: "narrow round neckline, shoulder seam, close-fitting long sleeves and visible straight top hem; lower trouser legs not shown",
      labels: "no intrinsic printing on the actual garment; BYC/HEATFIT is outside seller artwork",
      viewObservation: { ...partial, hiddenParts: ["lower trouser legs"], intrinsicPrint: "absent" as const, readableIdentifiers: [] } };
    const garmentOptions = { ...options, reference: garmentReference, productName: "BYC 히트핏 남자 내복 검정 선택 사이즈",
      bodyExcerpt: "구매할 사이즈는 판매 페이지에서 확인하세요.", supportingReferences: [] };
    const garmentGood = { ...good, comparisons: { ...good.comparisons,
      productShape: { result: "consistent", variation: "none", referenceObservation: garmentReference.geometry,
        candidateObservation: "matching selected black top's narrow round neck, shoulder seam, long-sleeve cut and visible hem",
        basis: "corresponding distinguishing construction and selected visible option match; exact size/brand and unobserved trouser geometry are not pixel-certified" },
      intrinsicPrinting: { result: "consistent", variation: "none", referenceObservation: "actual source garment has no intrinsic branding or size printing",
        candidateObservation: "candidate also has no added or intrinsic lettering", basis: "external seller advertising and product-name size are not physical garment print or photo-reading claims" } },
      reason: "Visible selected garment construction matches without demanding typography absent from the source" };
    const garmentPass = await reviewShoppingReferenceScene(garmentOptions, { review: async call => {
      assertRule(call); assert.match(call.userPrompt, /do not require such absent identifiers to appear or become readable/u);
      assert.match(call.userPrompt, /no source lineage or generic plain garment alone grants identity/u);
      assert.match(call.userPrompt, /Never add those marks, copy the external artwork onto the product/u);
      return JSON.stringify(garmentGood);
    } }); assert.equal(garmentPass.reviewStatus, "passed"); checks++;
    for (const [label, dimension, basis] of [
      ["invented intrinsic brand", "intrinsicPrinting", "candidate has newly added physical brand text on a source-unprinted chest"],
      ["source-present print removed", "intrinsicPrinting", "this separately printed source has an intrinsic label on the corresponding plainly visible surface, but the candidate is blank"],
      ["different garment cut", "productShape", "candidate has a wide V neck and short loose sleeves instead of the selected round-neck long-sleeve cut"],
      ["unresolved generic garment", "productShape", "a plain dark patch without observable seams, neckline or distinctive construction cannot resolve the selected subject"],
    ]) {
      await assert.rejects(reviewShoppingReferenceScene(garmentOptions, { review: async () => JSON.stringify({ ...garmentGood,
        comparisons: { ...garmentGood.comparisons, [dimension]: { result: label === "unresolved generic garment" ? "unverifiable" : "contradiction",
          variation: "none", referenceObservation: garmentReference.geometry, candidateObservation: basis, basis } }, identityMatches: false, accepted: true, reason: label }) }), /REFERENCE_SCENE_FIDELITY_FAILED/u); checks++;
    }
    assert(PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_KO)); checks++;
    for (const role of ["detail", "thumbnail"] as const) for (const adverse of [false, true]) {
      const composition = { sections: [{ id: "body", title: options.sectionTitle, body: [options.bodyExcerpt], characterCount: 20,
        imageIntent: "선택 상품 외형", imageSource: "seller-original" as const, headingStyle: "plain" as const, imagePaths: [candidatePath] }], renderNodes: [
        { kind: "paragraph" as const, sectionId: "body", text: options.bodyExcerpt },
        { kind: "image" as const, sectionId: role === "thumbnail" ? null : "body", role, assetPath: candidatePath,
          altText: "외형", layout: "single" as const, sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" as const }] };
      let calls = 0;
      const audit = await auditPublishImages({ productName: options.productName, composition, review: async call => {
        calls++; assertRule(call);
        const schema = call.outputSchema as { properties: { reviews: { items: { properties: { identityMatches: { description: string } } } } } };
        assert(schema.properties.reviews.items.properties.identityMatches.description.includes(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_RULE_EN));
        return JSON.stringify({ reviews: [{ index: 1, accepted: !adverse, identityMatches: !adverse, photoClaimMatches: true,
          photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" }, notice: false, mixedOptions: false,
          explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true,
          thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: adverse ? "real exposed broken band remains a defect" : "matching visible structures with legitimate occlusion" }] });
      } }); assert.equal(audit.ok, !adverse); assert.equal(calls, 1); checks++;
    }
    assert.equal(PRODUCT_IMAGE_REFERENCE_EVIDENCE_SCOPE_VERSION, "product-reference-evidence-scope/v1");
    assert.match(publicationImageAuditPolicyFingerprint(), /^[a-f0-9]{64}$/u);
    assert.deepEqual([referencePath, candidatePath, detailPath].map(hash), before); assert.equal(JSON.stringify(legacySupport), legacyBytes); checks++;
    console.log(`PASS reference evidence scope: ${checks} offline contracts; partial/unknown support never grants complete-shape authority, matched occlusion is evidence-scoped, real missing/wrong/blank/ambiguous identity and every adverse check still reject; provider/generation calls 0`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

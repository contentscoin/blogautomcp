/** Offline contract tests with injected reviewers; not model visual-accuracy claims. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import sharp from "sharp";
import { reviewShoppingReferenceScene, selectShoppingSceneReference, SCENE_FIDELITY_CHECKS } from "./lib/shopping-reference-scene";
import { auditPublishImages, publicationImageAuditPolicyFingerprint } from "./lib/publish-image-audit";
import { PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN, PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_KO,
  PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO } from "./lib/product-image-visual-contract";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "print-observability-")); let cases = 0;
  try {
    const referencePath = path.join(root, "reference.png"), candidate = path.join(root, "completed-candidate.png");
    await sharp({ create: { width: 400, height: 400, channels: 3, background: "gray" } }).png().toFile(referencePath);
    await sharp({ create: { width: 400, height: 400, channels: 3, background: "white" } }).png().toFile(candidate);
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const unchanged = [referencePath, candidate].map(hash);
    const reference = { path: referencePath, sha256: hash(referencePath), subject: "selected black open-ear wearable",
      geometry: "distinctive ear unit with visible rear connecting body", labels: "small light intrinsic mark at rear; letters unresolved", reviewedAt: "offline" };
    const checks = Object.fromEntries(SCENE_FIDELITY_CHECKS.map(key => [key, true]));
    const comparisons = Object.fromEntries(["productShape", "intrinsicPrinting", "visibleOption", "sceneContext"].map(key => [key, {
      result: "consistent", variation: "none", referenceObservation: `reference ${key} visible`, candidateObservation: `candidate ${key} matches`, basis: "specific identifying landmarks and selected option agree" }]));
    const good = { comparisons: { ...comparisons, intrinsicPrinting: { result: "allowed-variation", variation: "matched-small-print-unreadable",
      referenceObservation: "A real small light mark is visible on the rear body at this normal worn viewing distance; its letters cannot reliably be read",
      candidateObservation: "A real small light mark is visible at the corresponding rear-body position at a matching ordinary worn scale; its letters cannot reliably be read",
      basis: "Distinctive ear unit, rear connecting structure and black option match; the body does not claim to read the letters; no attached reference shows a conflicting identifier. No letter match is asserted" } },
      checks, identityMatches: true, illustrativeOnly: true, reason: "The source/candidate show corresponding small marks and independently matching identifying structure; letter readability is not claimed", accepted: true };
    const neutral = { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" };
    const options = { reference, outputPath: candidate, productName: "선택 검정색 오픈형 이어폰", imageIntent: "자연스러운 착용 맥락",
      sectionTitle: "구매 전 볼 기준", bodyExcerpt: "러닝 조건과 확인할 사양을 살펴보세요." };
    let schema: Record<string, unknown> | undefined;
    const assertRule = (call: CodexDraftOptions) => {
      assert(call.userPrompt.includes(PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN));
      assert.match(call.userPrompt, /actual marks are visible at corresponding relative product positions in BOTH reference and candidate/u);
      assert.match(call.userPrompt, /independently distinctive visible geometry and selected option/u);
      assert.match(call.userPrompt, /no other attached gallery\/detail shows a conflicting identifier or design/u);
      assert.match(call.userPrompt, /enlarged clearly visible candidate surface that is blank/u);
      assert.match(call.userPrompt, /never change an adverse boolean or grant automatic acceptance/u);
    };
    const result = await reviewShoppingReferenceScene(options, { review: async call => {
      assertRule(call); assert.deepEqual(call.imagePaths, [referencePath, candidate]); schema = call.outputSchema as Record<string, unknown>;
      const typed = call.outputSchema as { properties: { checks: { properties: { labelHierarchy: { description: string } } }; identityMatches: { description: string } } };
      assert(typed.properties.identityMatches.description.includes(PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN));
      assert(typed.properties.checks.properties.labelHierarchy.description.includes(PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN));
      return JSON.stringify(good);
    } });
    assert.equal(result.reviewStatus, "passed"); assert.equal(result.reviewedOutputSha256, hash(candidate)); cases++;
    const validate = new Ajv({ allErrors: true }).compile(schema!);
    assert.equal(validate(good), true, JSON.stringify(validate.errors)); cases++;
    for (const [resultKind, variation] of [["consistent", "matched-small-print-unreadable"], ["unverifiable", "matched-small-print-unreadable"],
      ["allowed-variation", "none"], ["allowed-variation", "unknown-print-excuse"]] as const) {
      const answer = { ...good, comparisons: { ...good.comparisons, intrinsicPrinting: { ...good.comparisons.intrinsicPrinting, result: resultKind, variation } } };
      assert.equal(validate(answer), false);
      await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(answer) }), /REFERENCE_SCENE_REVIEW_INVALID/u); cases++;
    }
    for (const dimension of ["productShape", "visibleOption", "sceneContext"]) {
      const answer = { ...good, comparisons: { ...good.comparisons, [dimension]: { ...comparisons[dimension], result: "allowed-variation", variation: "matched-small-print-unreadable" } } };
      assert.equal(validate(answer), false); cases++;
    }
    // Exact real failure shape: if a fresh reviewer still reports an adverse
    // label/identity verdict, no parser or prose normalization may pass it.
    for (const key of SCENE_FIDELITY_CHECKS) {
      let calls = 0;
      await assert.rejects(reviewShoppingReferenceScene(options, { review: async call => {
        calls++; assertRule(call); return JSON.stringify({ ...good, checks: { ...checks, [key]: false }, accepted: false });
      } }), error => {
        assert.equal((error as { fidelityFailure?: { failedChecks: string[] } }).fidelityFailure?.failedChecks.includes(key), true); return true;
      }); assert.equal(calls, 1); cases++;
    }
    for (const [label, patch] of [
      ["blank enlarged candidate face", { checks: { ...checks, labelHierarchy: false }, identityMatches: false }],
      ["readable different brand", { checks: { ...checks, labelHierarchy: false }, identityMatches: false }],
      ["generic category without resolved design", { identityMatches: false }],
      ["wrong selected color", { checks: { ...checks, color: false }, identityMatches: false }],
      ["unsupported exact photo lettering claim", { illustrativeOnly: false }],
      ["conflicting selected gallery", { identityMatches: false }],
    ] as const) {
      let calls = 0;
      await assert.rejects(reviewShoppingReferenceScene(options, { review: async call => {
        calls++; assertRule(call); return JSON.stringify({ ...good, ...patch, accepted: false, reason: label });
      } }), /REFERENCE_SCENE_FIDELITY_FAILED/u); assert.equal(calls, 1); cases++;
    }
    for (const resultKind of ["contradiction", "unverifiable"]) {
      let calls = 0;
      await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => { calls++;
        return JSON.stringify({ ...good, comparisons: { ...good.comparisons, intrinsicPrinting: { ...good.comparisons.intrinsicPrinting,
          result: resultKind, variation: "none", basis: "A genuinely unresolved identifying detail remains adverse" } }, accepted: false });
      } }), /REFERENCE_SCENE_FIDELITY_FAILED/u); assert.equal(calls, 1); cases++;
    }
    let consistencyCalls = 0;
    await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => { consistencyCalls++; return JSON.stringify({ ...good, accepted: false }); } }), /REFERENCE_SCENE_REVIEW_INVALID/u);
    assert.equal(consistencyCalls, 2); cases++;
    const selected = await selectShoppingSceneReference({ paths: [referencePath], productName: "print-observation-source", selectedProduct: "selected wearable" }, {
      verify: async paths => paths, review: async call => { assertRule(call);
        return JSON.stringify({ identityMatches: true, geometryReadable: true, completeShape: true, notDeformed: true, unobstructed: true,
          subject: reference.subject, geometry: reference.geometry, labels: reference.labels, reason: "Distinctive source geometry is resolved without pretending to read tiny marks",
          viewObservation: { subjectState: "worn", cameraView: "side", geometryVisibility: "partial", hiddenParts: ["opposite side"], intrinsicPrint: "unreadable", readableIdentifiers: [] } }); },
    }); assert.equal(selected.viewObservation?.intrinsicPrint, "unreadable"); assert.deepEqual(selected.viewObservation?.readableIdentifiers, []); cases++;
    assert(PRODUCT_IMAGE_VISUAL_CONTRACT_RULES_KO.includes(PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_KO)); cases++;
    for (const role of ["detail", "thumbnail"] as const) for (const adverse of [false, true]) {
      let calls = 0;
      const composition = { sections: [{ id: "body", title: "구매 전 볼 기준", body: [options.bodyExcerpt], characterCount: 35,
        imageIntent: "선택 상품 외형", imageSource: "seller-original" as const, headingStyle: "plain" as const, imagePaths: [candidate] }], renderNodes: [
        { kind: "paragraph" as const, sectionId: "body", text: options.bodyExcerpt },
        { kind: "image" as const, sectionId: role === "thumbnail" ? null : "body", role, assetPath: candidate, altText: "상품", layout: "single" as const, sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" as const }] };
      const audited = await auditPublishImages({ productName: options.productName, composition, review: async call => {
        calls++; assertRule(call);
        const typed = call.outputSchema as { properties: { reviews: { items: { properties: { identityMatches: { description: string } } } } } };
        assert(typed.properties.reviews.items.properties.identityMatches.description.includes(PRODUCT_IMAGE_PRINT_OBSERVABILITY_RULE_EN));
        return JSON.stringify({ reviews: [{ index: 1, reason: adverse ? "Readable wrong brand remains adverse" : "Observed same-position small marks and identifying design match",
          photoClaimObjection: neutral, identityMatches: !adverse, photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false,
          optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true,
          reviewClass: "product-photo", accepted: !adverse }] });
      } }); assert.equal(audited.ok, !adverse); assert.equal(calls, 1); cases++;
    }
    assert.deepEqual([referencePath, candidate].map(hash), unchanged);
    assert(/^[a-f0-9]{64}$/u.test(publicationImageAuditPolicyFingerprint()), "the actual shared policy participates in canonical receipt fingerprints"); cases++;
    console.log(`PASS print observability: ${cases} offline source/scene/body/thumbnail contract checks; typed allowed observation, wrong/blank/ambiguous print and adverse verdicts still reject, unchanged completed pixels, zero provider/generation calls`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

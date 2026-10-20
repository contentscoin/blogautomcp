/** Offline contracts based on observed a7/a0b and 211da failure patterns.
 * Synthetic rasters + injected verdicts test roles, not visual-model accuracy. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import sharp from "sharp";
import { auditPublishImages, assertPublishImagesSafe, type PublishImageAuditOptions, type PublishImageAuditResult } from "./lib/publish-image-audit";
import { REFERENCE_PLANE_IDENTITY_QUESTION, REFERENCE_PLANE_COMPARISON_SCHEMA, referencePlaneComparisonIssue, type ReferencePlaneContext } from "./lib/reference-plane-grounding";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { recordPublicationImageRejections } from "./lib/publish-image-rejections";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

const neutral = { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" };
const good = { index: 1, accepted: true, identityMatches: true, photoClaimMatches: true, photoClaimObjection: neutral,
  visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
    { part: "Housing", referenceObservation: "Offline source housing contour", candidateObservation: "Offline matching candidate housing" },
    { part: "Control face", referenceObservation: "Offline source control face", candidateObservation: "Offline matching candidate controls" }], conflict: "" },
  optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] },
  notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true,
  noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "Offline source-plane contract" };
const positive = (context: ReferencePlaneContext) => ({ primaryReferenceImageIndex: context.primaryReferenceImageIndex,
  primaryReferenceSha256: context.primaryReferenceSha256, primaryObservation: "Ivory inner indicator/control face, four dots and narrow reverse housing; this visible face has no logo",
  candidateObservation: "Matching ivory indicator face and reverse housing; no new printing", objectionKind: "none", evidenceImageIndex: context.primaryReferenceImageIndex,
  samePhysicalPart: true, samePhysicalSurface: true, sameSelectedVisibleOption: true, referencePrintState: "absent", candidatePrintState: "absent-on-exposed-face",
  candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [],
  evidenceObservation: "The numbered primary shows the same unprinted face, not the black outer-branding plane", basis: "Actual same visible faces correspond; a gallery outer logo does not move onto this face" });
const slots = (call: CodexDraftOptions): Array<{ index: number; referencePlaneMap?: ReferencePlaneContext; identityQuestion?: string; selectedGalleryComparisonImageIndexes?: number[] }> => {
  const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"))!;
  return JSON.parse(line.slice(line.indexOf("[")));
};

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reference-plane-grounding-")), oldData = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root; let checks = 0;
  try {
    const c: ReferencePlaneContext = { primaryReferenceImageIndex: 2, primaryReferenceSha256: "a".repeat(64), supplementalReferences: [{ imageIndex: 3, sha256: "b".repeat(64) }] };
    const row = { ...good, referenceComparison: positive(c) }, serialized = JSON.stringify(row);
    assert.equal(referencePlaneComparisonIssue(row, c), null); assert.equal(new Ajv().compile(REFERENCE_PLANE_COMPARISON_SCHEMA)(row.referenceComparison), true); checks++;
    for (const key of Object.keys(row.referenceComparison)) {
      const broken: Record<string, unknown> = { ...row.referenceComparison }; delete broken[key];
      assert(referencePlaneComparisonIssue({ ...row, referenceComparison: broken }, c)); checks++;
    }
    for (const patch of [{ primaryReferenceImageIndex: 3 }, { primaryReferenceSha256: "b".repeat(64) }, { evidenceImageIndex: 1 },
      { evidenceImageIndex: 4 }, { evidenceImageIndex: "2" }, { primaryObservation: " " }, { samePhysicalPart: "true" },
      { objectionKind: "guess" }, { referencePrintState: "tiny" }, { candidatePrintState: "blank" }]) {
      assert(referencePlaneComparisonIssue({ ...row, referenceComparison: { ...row.referenceComparison, ...patch } }, c)); checks++;
    }
    assert.equal(referencePlaneComparisonIssue({ ...good }, c), "mapped slot requires referenceComparison"); checks++;
    assert.equal(referencePlaneComparisonIssue({ ...good, referenceComparison: null }, null), null);
    assert(referencePlaneComparisonIssue(row, null)); assert.equal(JSON.stringify(row), serialized); checks++;
    const missing = { ...positive(c), objectionKind: "missing-print", referencePrintState: "present", candidatePrintState: "absent-on-exposed-face" };
    for (const field of ["samePhysicalPart", "samePhysicalSurface", "sameSelectedVisibleOption"]) for (const value of [false, null]) {
      assert(referencePlaneComparisonIssue({ ...good, identityMatches: false, accepted: false, referenceComparison: { ...missing, [field]: value } }, c)); checks++;
    }
    assert.equal(referencePlaneComparisonIssue({ ...good, identityMatches: false, accepted: false, referenceComparison: missing }, c), null); checks++;
    assert.equal(referencePlaneComparisonIssue({ ...good, identityMatches: false, accepted: false, referenceComparison: { ...missing, evidenceImageIndex: 3 } }, c), null,
      "a legitimate same-option/same-surface gallery detail remains usable"); checks++;
    const unreadable = { ...positive(c), referencePrintState: "present", candidatePrintState: "present-unreadable" };
    assert.equal(referencePlaneComparisonIssue({ ...good, referenceComparison: unreadable }, c), null);
    assert.equal(new Ajv().compile(REFERENCE_PLANE_COMPARISON_SCHEMA)(unreadable), true); checks++;
    for (const field of ["samePhysicalPart", "samePhysicalSurface", "sameSelectedVisibleOption"]) for (const value of [false, null]) {
      assert(referencePlaneComparisonIssue({ ...good, referenceComparison: { ...unreadable, [field]: value } }, c)); checks++;
    }
    for (const patch of [{ referencePrintState: "absent" }, { objectionKind: "missing-print" }, { objectionKind: "conflicting-print" }]) {
      assert(referencePlaneComparisonIssue({ ...good, identityMatches: false, accepted: false, referenceComparison: { ...unreadable, ...patch } }, c)); checks++;
    }

    const id = "reference-plane-offline", dir = path.join(root, "data/prepared-brand-posts", id), sources = path.join(dir, "product-sources"); fs.mkdirSync(sources, { recursive: true });
    const candidate = path.join(dir, "a7-pattern-natural.png"), primary = path.join(sources, "a0b-pattern-primary.png"), gallery = path.join(sources, "outer-logo-detail.png");
    for (const [index, file] of [candidate, primary, gallery].entries()) await sharp({ create: { width: 400, height: 400, channels: 3,
      background: `rgb(${80 + index * 45},120,150)` } }).png().toFile(file);
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const urls = ["https://shop-phinf.pstatic.net/offline/ivory-primary.png", "https://shop-phinf.pstatic.net/offline/outer-logo.png"];
    for (const [index, file] of [primary, gallery].entries()) fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1",
      sourceUrl: urls[index], sha256: hash(file), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
    const snapshot = createProductSnapshot({ productId: id, externalProductId: null, connectKind: "SHOPPING", sourceUrl: "https://smartstore.naver.com/offline/products/1",
      product: { name: "선택 이어폰 외형", referenceImageUrls: urls } });
    const section = { id: "body", title: "후기와 가격보다 먼저 볼 선택 기준", body: ["구매 조건을 확인하세요."], characterCount: 15, imagePaths: [candidate],
      imageSource: "staged-ai" as const, imageIntent: "AI 연출 이미지: 생활 맥락", headingStyle: "plain" as const };
    const options: PublishImageAuditOptions = { brandLinkId: id, productName: "선택 이어폰 외형", sourceSnapshotId: snapshot.snapshotId,
      selectedSourceSnapshot: snapshot, selectedSourceProductId: id, selectedSourceDirectory: sources,
      composition: { sections: [section], renderNodes: [{ kind: "heading", sectionId: "body", text: section.title },
        { kind: "paragraph", sectionId: "body", text: section.body[0] }, { kind: "image", sectionId: "body", role: "scene", assetPath: candidate,
          altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", caption: REFERENCE_SCENE_CAPTION }] },
      imageAssets: [{ path: candidate, sourcePath: candidate, sha256: hash(candidate), role: "body", sectionId: "body", provenance: "GENERATED_SCENE",
        creationMethod: "reference-guided-scene", remoteGenerated: true, referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION,
          sourceSnapshotId: snapshot.snapshotId, referencePath: primary, referenceSha256: hash(primary), reviewedOutputSha256: hash(candidate), reviewStatus: "passed",
          checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } }] };
    const before = [candidate, primary, gallery].map(hash), history = path.join(dir, "publish-image-rejections.json");
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: "brand-post-package/v2", brandLinkId: id, composition: options.composition }));
    const run = async (kind: "pass" | "plain-crew" | "unreadable-mark" | "brand-proof" | "print-reading-proof" | "brand-on-unprinted" | "wrong-vneck" | "extra-pocket" | "wrong-knit" | "material-unresolved" | "wrong-plane" | "different-option" | "bad-index" | "missing-field" | "real-blank" | "gallery-real-blank" | "wrong-brand" | "wrong-option" | "wrong-shape" | "unresolved" | "mixed-claim" | "mixed-format") => {
      let calls = 0;
      const proofText = kind === "print-reading-proof" ? "이 사진의 표기를 읽으면 정확한 모델번호를 확인할 수 있습니다." : "이 사진은 BYC 정품과 구매한 사이즈를 증명합니다.";
      const composition = structuredClone(options.composition);
      if (["brand-proof", "print-reading-proof"].includes(kind)) Object.assign(composition.renderNodes.find(node => node.kind === "paragraph")!, { text: proofText });
      const input = { ...options, composition, review: async (call: CodexDraftOptions) => {
        calls++; assert.match(call.userPrompt, /REFERENCE ROLES: Inspect the exact primaryReferenceImageIndex\/SHA for THIS slot first/u);
        const slot = slots(call)[0], map = slot.referencePlaneMap!;
        assert.equal(slot.identityQuestion, REFERENCE_PLANE_IDENTITY_QUESTION);
        assert.match(call.userPrompt, /not market uniqueness, authenticity or exact-SKU certification/u);
        const schema = call.outputSchema as { properties: { reviews: { items: { properties: { identityMatches: { description: string } } } } } };
        assert(schema.properties.reviews.items.properties.identityMatches.description.length <= 250);
        assert.match(schema.properties.reviews.items.properties.identityMatches.description, /this slot's own source and confirmed visible option/u);
        assert.equal(map.primaryReferenceImageIndex, 2); assert.equal(map.primaryReferenceSha256, hash(primary));
        assert.deepEqual(map.supplementalReferences, [{ imageIndex: 3, sha256: hash(gallery) }]);
        assert.deepEqual(slot.selectedGalleryComparisonImageIndexes, [3]);
        assert.equal(call.imagePaths?.length, 3, "primary present in canonical gallery is attached once, not supplemental to itself");
        let response = { ...good, referenceComparison: positive(map) } as Record<string, unknown>;
        if (kind === "plain-crew") response.referenceComparison = { ...positive(map),
          primaryObservation: "Plain black close-fitting crew-neck long sleeve; narrow neckline, shoulder and cuff seams; no intrinsic logo",
          candidateObservation: "Same observed black fabric, crew neckline, fit, shoulder/cuff seam construction; no visible logo",
          evidenceObservation: "Actual mapped plain garment; BYC/HEATFIT belongs to exterior seller artwork, not garment printing",
          basis: "Sufficient observed construction matches; market exclusivity, exact SKU and authenticity are not certified" };
        if (["unreadable-mark", "print-reading-proof"].includes(kind)) response.referenceComparison = { ...positive(map), referencePrintState: "present", candidatePrintState: "present-unreadable",
          primaryObservation: "Source shows a small intrinsic mark on the outer control housing",
          candidateObservation: "Actual faint small mark at matching position on the same outer housing; letters cannot be read",
          evidenceObservation: "Corresponding visible mark, matched housing geometry and option; not an exposed blank face",
          basis: "Presence and position match without word certification or a conflicting published print-reading claim" };
        if (["brand-proof", "print-reading-proof"].includes(kind)) response = { ...response, accepted: false, photoClaimMatches: false,
          photoClaimObjection: { origin: "section-body", sourceIndex: 0, quote: proofText, scope: "pictured-appearance", conflict: "Actual pixels do not establish this published authenticity/size or unreadable-word claim" } };
        if (!["pass", "plain-crew", "unreadable-mark", "brand-proof", "print-reading-proof"].includes(kind)) {
          const comparison: Record<string, unknown> = { ...positive(map), objectionKind: "missing-print", referencePrintState: "present", candidatePrintState: "absent-on-exposed-face" };
          if (["wrong-plane", "mixed-claim", "mixed-format"].includes(kind)) { comparison.evidenceImageIndex = 3; comparison.samePhysicalSurface = false;
            comparison.evidenceObservation = "Black outer branded face; candidate shows ivory inner indicator face"; }
          if (kind === "different-option") { comparison.evidenceImageIndex = 3; comparison.sameSelectedVisibleOption = false; }
          if (kind === "bad-index") comparison.primaryReferenceImageIndex = 3;
          if (kind === "missing-field") delete comparison.primaryObservation;
          if (kind === "gallery-real-blank") comparison.evidenceImageIndex = 3;
          if (kind === "wrong-brand") { comparison.objectionKind = "conflicting-print"; comparison.evidenceImageIndex = 3; comparison.candidatePrintState = "present";
            comparison.samePhysicalSurface = null; comparison.evidenceObservation = "Actual readable source brand, candidate reads another brand"; }
          if (kind === "wrong-shape") comparison.objectionKind = "shape";
          if (["wrong-vneck", "extra-pocket", "wrong-knit"].includes(kind)) { comparison.objectionKind = "shape";
            comparison.evidenceObservation = kind === "wrong-vneck" ? "Mapped source crew neckline; actual candidate V-neck conflicts"
              : kind === "extra-pocket" ? "Mapped source plain chest; actual candidate has an added chest pocket"
                : "Mapped source smooth thin knit; actual candidate has thick cable-knit structure"; }
          if (kind === "wrong-option") { comparison.objectionKind = "option"; comparison.sameSelectedVisibleOption = false;
            comparison.evidenceObservation = "Actual confirmed selected ivory housing, candidate is a distinguishable different option"; }
          if (kind === "unresolved" || kind === "material-unresolved") { comparison.objectionKind = "unresolved"; comparison.referencePrintState = "not-observed";
            comparison.candidatePrintState = "not-observed"; comparison.samePhysicalSurface = null; }
          if (kind === "brand-on-unprinted") { comparison.objectionKind = "unresolved"; comparison.referencePrintState = "absent"; comparison.candidatePrintState = "present";
            comparison.evidenceObservation = "Actual mapped source garment is unprinted; candidate adds readable OtherBrand; source-absent identifier tolerance cannot authorize this invented conflicting branding"; }
          response = { ...response, identityMatches: false, accepted: false, referenceComparison: comparison };
          if (kind === "mixed-format") response.noGraphicLayout = false;
          if (kind === "mixed-claim") { response.photoClaimMatches = false; response.photoClaimObjection = { origin: "section-body", sourceIndex: 0,
            quote: section.body[0], scope: "pictured-appearance", conflict: "Injected independently adverse pixel claim for mixed invalid-verdict hold" }; }
        }
        if (response.identityMatches === false) {
          const comparison = response.referenceComparison as Record<string, unknown>;
          response.visibleIdentityEvidence = { basis: comparison.objectionKind === "unresolved" ? "insufficient-visible-structure" : "concrete-conflict",
            landmarks: [{ part: "Offline compared component", referenceObservation: comparison.evidenceObservation,
              candidateObservation: comparison.candidateObservation }], conflict: comparison.basis };
        }
        const validate = new Ajv({ allErrors: true }).compile(call.outputSchema!);
        if (!["bad-index", "missing-field"].includes(kind)) assert.equal(validate({ reviews: [response] }), true, JSON.stringify(validate.errors));
        return JSON.stringify({ reviews: [response] });
      } };
      let result: PublishImageAuditResult;
      try { result = await assertPublishImagesSafe(input); } catch (error) { result = (error as { audit: PublishImageAuditResult }).audit; }
      assert(result); assert.equal(calls, 1, "invalid physical grounding is held, never semantically retried");
      assert.deepEqual([candidate, primary, gallery].map(hash), before); return result;
    };
    for (const kind of ["wrong-plane", "different-option", "bad-index", "missing-field", "mixed-claim", "mixed-format"] as const) {
      recordPublicationImageRejections(id, options.composition, [{ sha256: hash(candidate), sectionId: "body", scope: "product" }]);
      const saved = fs.readFileSync(history);
      const result = await run(kind); assert.equal(result.ok, false); assert(result.failures.every(f => f.code === "INVALID_REVIEW"));
      assert.deepEqual(fs.readFileSync(history), saved, "invalid grounding cannot clear or add semantic rejection authority");
      assert.equal(result.referenceComparisons?.[0].verdict.identityMatches, false);
      if (kind === "mixed-format") assert.equal(result.referenceComparisons?.[0].verdict.noGraphicLayout, false);
      if (kind === "mixed-claim") assert.equal(result.referenceComparisons?.[0].verdict.photoClaimMatches, false); checks++;
    }
    for (const kind of ["real-blank", "gallery-real-blank", "wrong-brand", "wrong-option", "wrong-shape", "unresolved", "wrong-vneck", "extra-pocket", "wrong-knit", "material-unresolved", "brand-proof", "print-reading-proof", "brand-on-unprinted"] as const) {
      const result = await run(kind); assert.equal(result.ok, false); assert(result.failures.some(f => f.code === "SEMANTIC_REJECTION"));
      assert(!result.failures.some(f => f.code === "INVALID_REVIEW")); checks++;
    }
    for (const kind of ["plain-crew", "unreadable-mark"] as const) { const result = await run(kind); assert.equal(result.ok, true); checks++; }
    const passed = await run("pass"); assert.equal(passed.ok, true); assert.equal(passed.checked, 1);
    assert.equal(JSON.parse(fs.readFileSync(history, "utf8")).length, 0, "only fresh complete passing QA clears the exact rejection"); checks++;
    const noMapping = await auditPublishImages({ productName: "plain selected object", composition: { sections: [section], renderNodes: [
      { kind: "paragraph", sectionId: "body", text: section.body[0] }, { kind: "image", sectionId: "body", role: "detail", assetPath: candidate, altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] },
      review: async call => { const validate = new Ajv().compile(call.outputSchema!);
        assert.equal(validate({ reviews: [{ ...good, referenceComparison: null }] }), true);
        assert.equal(validate({ reviews: [{ ...good, referenceComparison: positive(c) }] }), false);
        return JSON.stringify({ reviews: [{ ...good, referenceComparison: null }] }); } });
    assert.equal(noMapping.ok, true); checks++;
    console.log(`PASS reference-plane grounding: ${checks} offline cases; mapped primary/deduplicated supplemental roles, opposite-face hold, real same-face blank/wrong-brand/shape/unresolved rejection, mixed adverse preservation and exact-ledger clearing; provider/generation 0`);
  } finally { if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData; fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

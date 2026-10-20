/** Offline only: real raster decoding and exact reference bindings; provider is stubbed. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import Ajv from "ajv";
import sharp from "sharp";
import ts from "typescript";
import { auditPublishImages as actualAuditPublishImages, encodeLosslessAuditSnapshot, planPublishImageAuditBatches, planPublishImageComparisonGroups, PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES, PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT, type PublishImageAuditOptions, type PublishImageAuditResult } from "./lib/publish-image-audit";
import { referencePlaneFixtureRow, withReferencePlaneFixture } from "./test-fixtures/reference-plane-review";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { runMaterialPreparation } from "./lib/scheduled-draft-workflow";
const auditPublishImages = (options: PublishImageAuditOptions) => actualAuditPublishImages(withReferencePlaneFixture(options));

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const slots = (call: CodexDraftOptions): Array<{ index: number; role: string; sectionTitle: string; comparisonReferenceImageIndex: number; referenceSha256: string; sourceSnapshotId: string; sectionBody: string[];
  claimSources: { sectionTitle: { origin: string; sourceIndex: null; text: string }; sectionBody: Array<{ origin: string; sourceIndex: number; text: string }> } }> => {
  const line = call.userPrompt.split("\n").find(text => text.startsWith("Each attached image belongs ONLY"))!;
  return JSON.parse(line.slice(line.indexOf("[")));
};
const good = (index: number) => ({ index, referenceComparison: null, accepted: true, identityMatches: true, photoClaimMatches: true, notice: false,
  mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true,
  noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "Offline pixel-pair contract fixture",
  photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" } });
const bodyObjection = (quote: string, sourceIndex = 0) => ({ origin: "section-body", sourceIndex, quote,
  scope: "quantity", conflict: "The fixture reviewer reports that the pictured quantity does not match this exact published assertion." });
const answer = (call: CodexDraftOptions) => JSON.stringify({ reviews: slots(call).map(slot => good(slot.index)) });

// Source-backed saved-body excerpts copied once for an offline regression. No
// private IDs/URLs or live data reads. The harness checks the response contract;
// it never decides a reviewer boolean from keywords or a disclaimer pattern.
const publishedContextFixtures = [
  { title: "1.65kg은 어떻게 판단하면 좋을까요?", body: [
    "상품에 안내된 무게는 1.65kg이에요.",
    "그만큼 받는 분의 먹는 양과 보관 여유를 함께 따져야 해서 소량 간식만 원하는 경우에는 부담이에요.",
    "가족이 나눠 먹을 선물이라면 총중량과 함께 종류별 개수도 판단 기준이 돼요.",
    "같은 무게라도 큰 곶감 위주인지 작은 말이 위주인지에 따라 나누는 방식이 달라지거든요.",
    "총중량만으로 몇 명이 먹기에 충분한지 정하거나 한 개의 크기를 추정하지는 않는 편이 정확해요.",
  ] },
  { title: "상주산과 무게가 알려주는 선택 기준", body: [
    "원산지는 국산(경상북도 상주시)으로 안내돼 있어요.",
    "그래서 산지를 분명하게 정해 상주곶감 선물을 찾는 분에게 선택 기준이 돼요.",
    "표기된 상품 무게는 1.27kg이에요.",
    "그만큼 소량 간식을 고를 때보다 먹을 사람 수와 보관 공간을 함께 따져야 하는 구성이에요.",
    "다만 이 수치를 낱개 무게나 확정된 제공 인원으로 바꿔 계산하기는 어려워요.",
    "산지는 선물을 고르는 근거가 되지만 당도나 식감까지 보장하는 수치는 아니에요.",
  ] },
  { title: "여럿이 나눌 선물이라면 구성부터", body: [
    "천년빛곶감은 건시와 반건시, 호두말이와 크림치즈 옵션을 살펴볼 수 있는 곶감 선물 상품이에요.",
    "선물할 때는 받는 분이 좋아하는 곶감 종류와 먹을 분량을 먼저 정하는 편이 좋아요.",
    "다만 냉동 보관이 필요해서 받는 분의 보관 여건까지 맞아야 해요.",
    "명절 선물은 포장만큼 실제로 꺼내 먹기 좋은지도 중요하죠.",
    "구매 전에는 판매페이지의 구성 안내와 선택한 주문 옵션이 일치하는지 확인해 보세요.",
  ] },
];

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-reference-fixture-"));
  const previousUserData = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  let checks = 0;
  try {
    const finals: string[] = [], references: string[] = [];
    for (let index = 0; index < 5; index++) {
      const final = path.join(root, `final-${index}.png`), reference = path.join(root, `reference-${index}.png`);
      await sharp({ create: { width: 300, height: 300, channels: 3, background: `rgb(${index * 30}, 40, 90)` } }).png().toFile(final);
      await sharp({ create: { width: 250, height: 240, channels: 3, background: `rgb(${index * 20}, 110, 90)` } }).png().toFile(reference);
      finals.push(final); references.push(reference);
    }
    const fixture = (pairs: Array<{ final: string; reference: string }>): PublishImageAuditOptions => ({
      productName: "selected kit: toner, serum and cream", selectedProduct: "selected toner/serum/cream kit", sourceSnapshotId: "offline-snapshot",
      composition: { sections: pairs.map((pair, index) => ({ id: `section-${index}`, title: "외형과 생활 맥락", body: ["선택 구성품의 외형 참고용이며 전체 세트나 성능을 입증하는 사진이 아닙니다."],
        imagePaths: [pair.final], characterCount: 55, imageSource: "staged-ai", imageIntent: "AI 연출 이미지: 구성품의 생활 맥락", headingStyle: "plain" })),
      renderNodes: pairs.flatMap((pair, index) => [{ kind: "image" as const, assetPath: pair.final, sectionId: `section-${index}`, role: "scene" as const,
        altText: "selected kit component", layout: "single" as const, sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" as const, caption: REFERENCE_SCENE_CAPTION },
      { kind: "heading" as const, sectionId: `section-${index}`, text: "외형과 생활 맥락" },
      { kind: "paragraph" as const, sectionId: `section-${index}`, text: "선택 구성품의 외형 참고용이며 전체 세트나 성능을 입증하는 사진이 아닙니다." }]) },
      imageAssets: pairs.map((pair, index) => ({ path: pair.final, sourcePath: pair.final, sha256: hash(pair.final), role: "body", sectionId: `section-${index}`,
        provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true,
        referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, sourceSnapshotId: "offline-snapshot",
          referencePath: pair.reference, referenceSha256: hash(pair.reference), reviewedOutputSha256: hash(pair.final), reviewStatus: "passed",
          checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } })),
      review: async call => answer(call),
    });
    const pairs = [{ final: finals[0], reference: references[0] }, { final: finals[1], reference: references[1] }, { final: finals[2], reference: references[0] }];
    const textFixture = (texts: Array<{ title: string; body: string[] }>): PublishImageAuditOptions => {
      const options = fixture(texts.map((_, index) => pairs[index]));
      options.composition.sections.forEach((section, index) => {
        section.title = texts[index].title; section.body = [...texts[index].body];
        section.characterCount = section.body.join("").length;
      });
      options.composition.renderNodes = texts.flatMap((text, index) => [
        options.composition.renderNodes[index * 3],
        { kind: "heading" as const, sectionId: `section-${index}`, text: text.title },
        ...text.body.map(value => ({ kind: "paragraph" as const, sectionId: `section-${index}`, text: value })),
      ]);
      return options;
    };
    // Execute the real assertion wrapper while replacing only its persistence
    // boundaries. No saved user package, success receipt or rejection is touched.
    const auditPath = path.resolve("scripts/lib/publish-image-audit.ts");
    const auditRequire = createRequire(auditPath);
    const cleared: Array<{ sha256: string; sectionId: string | null }> = [];
    const rejected: Array<{ sha256: string; sectionId: string | null }> = [];
    let defaultProviderCalls = 0;
    const auditedExports: Record<string, unknown> = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(auditPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { exports: auditedExports, Buffer, console, setTimeout, process, require: (id: string) =>
      id === "./codex-draft-provider" ? { runCodexDraft: async () => { defaultProviderCalls++; throw new Error("Unexpected paid provider in offline proof fixture"); } } :
      id === "./publish-image-rejections" ? { ...auditRequire(id),
        clearReviewedPublicationImageRejections: (_id: string, _composition: unknown, rows: typeof cleared) => { cleared.push(...rows); },
        recordPublicationImageRejections: (_id: string, _composition: unknown, rows: typeof rejected) => { rejected.push(...rows); } } :
      id === "./photo-description-finding" ? { ...auditRequire(id), savePhotoDescriptionFindings: () => {} } : auditRequire(id),
    });
    const rawAssertAudit = auditedExports.assertPublishImagesSafe as (options: PublishImageAuditOptions) => Promise<PublishImageAuditResult>;
    const assertAudit = (options: PublishImageAuditOptions) => rawAssertAudit(withReferencePlaneFixture(options));
    const assertBlocked = async (options: PublishImageAuditOptions, codes: string[]) => {
      cleared.length = 0; rejected.length = 0;
      let result: PublishImageAuditResult | undefined;
      try { await assertAudit({ ...options, brandLinkId: "offline-claim-proof" }); }
      catch (error) { result = (error as { audit?: PublishImageAuditResult }).audit; }
      assert(result && !result.ok, "a malformed/adverse review must not authorize the assertion wrapper");
      assert.deepEqual(Array.from(result.failures, failure => failure.code).sort(), [...codes].sort());
      assert.equal(cleared.length, 0, "invalid/adverse final pixels cannot clear an earlier rejection");
      return result;
    };
    const unchangedPixels = [...finals, ...references].map(hash);
    for (const text of publishedContextFixtures) {
      const options = textFixture([text]); let calls = 0;
      options.review = async call => {
        calls++;
        const actual = slots(call)[0];
        assert.equal(actual.sectionTitle, text.title); assert.deepEqual(actual.sectionBody, text.body);
        assert.deepEqual(actual.claimSources, { sectionTitle: { origin: "section-title", sourceIndex: null, text: text.title },
          sectionBody: text.body.map((value, sourceIndex) => ({ origin: "section-body", sourceIndex, text: value })) },
        "quote sources retain the exact rendered paragraph boundaries and zero-based indexes");
        const schema = new Ajv({ allErrors: true }).compile(call.outputSchema as object);
        assert(schema({ reviews: [referencePlaneFixtureRow(call, good(1))] }), "ordinary saved specs/preferences may accompany a neutral structured reviewer verdict");
        assert(!schema({ reviews: [referencePlaneFixtureRow(call, { ...good(1), photoClaimObjection: undefined })] }), "the explicit objection contract is required even for favorable decisions");
        return answer(call);
      };
      assert.equal((await auditPublishImages(options)).ok, true); assert.equal(calls, 1); checks++;
    }
    const exactBody = publishedContextFixtures[0].body[0];
    const invalidProofs: Array<[string, unknown, boolean?]> = [
      ["missing", undefined],
      ["null-object", null],
      ["wrong-slot", bodyObjection(publishedContextFixtures[1].body[0])],
      ["wrong-index", bodyObjection(exactBody, 1)],
      ["fractional-index", bodyObjection(exactBody, 0.5)],
      ["string-index", { ...bodyObjection(exactBody), sourceIndex: "0" }],
      ["clipped-quote", bodyObjection(exactBody.slice(0, -1))],
      ["decimal-altered", bodyObjection(exactBody.replace("1.65", "65"))],
      ["nfkc-altered", bodyObjection(exactBody.replace("1.65kg", "１.６５ｋｇ"))],
      ["whitespace-altered", bodyObjection(exactBody.replace("무게는 ", "무게는  "))],
      ["empty-conflict", { ...bodyObjection(exactBody), conflict: "  " }],
      ["none-scope", { ...bodyObjection(exactBody), scope: "none" }],
      ["none-contradiction", { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" }],
      ["thumbnail-origin-in-body", { ...bodyObjection(exactBody), origin: "thumbnail-headline", sourceIndex: null }],
      ["title-with-body-index", { ...bodyObjection(publishedContextFixtures[0].title), origin: "section-title", sourceIndex: 0 }],
      ["wrong-title", { ...bodyObjection(publishedContextFixtures[1].title), origin: "section-title", sourceIndex: null }],
      ["true-has-objection", bodyObjection(exactBody), true],
    ];
    for (const [label, proof, photoClaimMatches = false] of invalidProofs) {
      const options = textFixture([publishedContextFixtures[0]]); let calls = 0;
      options.review = async () => { calls++; return JSON.stringify({ reviews: [{ ...good(1), accepted: photoClaimMatches, photoClaimMatches,
        photoClaimObjection: proof, reason: `Original reviewer reason preserved: ${label}` }] }); };
      const blocked = await assertBlocked(options, ["INVALID_REVIEW"]);
      assert.equal(calls, 1, "a bad objection proof must not cause another reviewer call or semantic pass-fishing");
      assert.equal(rejected.length, 0, "reviewer contract failure is not evidence for blacklisting or regenerating the image");
      assert(blocked.failures[0].reason.includes(label), "the original reviewer reason remains available for diagnosis");
      const details = JSON.parse(blocked.failures[0].reason.slice(blocked.failures[0].reason.indexOf("{"))) as {
        rawReason: string; rawVerdicts: { accepted: boolean; photoClaimMatches: boolean };
      };
      assert.equal(details.rawReason, `Original reviewer reason preserved: ${label}`);
      assert.equal(details.rawVerdicts.accepted, photoClaimMatches); assert.equal(details.rawVerdicts.photoClaimMatches, photoClaimMatches);
      assert.deepEqual([...finals, ...references].map(hash), unchangedPixels); checks++;
    }
    const staleSectionText = textFixture([publishedContextFixtures[0]]); let staleSectionCalls = 0;
    const metadataOnlyParagraph = "The saved section metadata is stale and is not published.";
    staleSectionText.composition.sections[0].body = [metadataOnlyParagraph];
    staleSectionText.review = async call => { staleSectionCalls++; assert.deepEqual(slots(call)[0].sectionBody, publishedContextFixtures[0].body);
      return JSON.stringify({ reviews: [{ ...good(1), accepted: false, photoClaimMatches: false,
        photoClaimObjection: bodyObjection(metadataOnlyParagraph), reason: "Metadata-only quote must not replace actual published render text" }] }); };
    await assertBlocked(staleSectionText, ["INVALID_REVIEW"]); assert.equal(staleSectionCalls, 1); assert.equal(rejected.length, 0); checks++;
    const titleProof = textFixture([publishedContextFixtures[0]]); let titleCalls = 0;
    titleProof.review = async call => { titleCalls++; return JSON.stringify({ reviews: [{ ...good(1), accepted: false, photoClaimMatches: false,
      photoClaimObjection: { ...bodyObjection(slots(call)[0].sectionTitle), origin: "section-title", sourceIndex: null },
      reason: "An exact whole-title objection retains the original adverse result" }] }); };
    await assertBlocked(titleProof, ["SEMANTIC_REJECTION"]); assert.equal(titleCalls, 1); assert.equal(rejected.length, 1); checks++;
    for (const text of publishedContextFixtures) {
      const options = textFixture([text]); let calls = 0;
      options.review = async call => { calls++; return JSON.stringify({ reviews: [{ ...good(1), accepted: false, photoClaimMatches: false,
        photoClaimObjection: bodyObjection(slots(call)[0].sectionBody[0]), reason: "Structurally grounded adverse reviewer decision remains adverse" }] }); };
      await assertBlocked(options, ["SEMANTIC_REJECTION"]);
      assert.equal(calls, 1); assert.equal(rejected.length, 1,
        "even ordinary specs/preferences cannot be used by deterministic text patterns to override a grounded adverse boolean"); checks++;
    }
    for (const [label, patch] of [
      ["identity", { identityMatches: false }], ["format", { noGraphicLayout: false }], ["notice", { notice: true }],
      ["options", { mixedOptions: true }], ["geometry", { accepted: false }],
    ] as const) {
      const options = textFixture([publishedContextFixtures[0]]); let calls = 0;
      options.review = async () => { calls++; return JSON.stringify({ reviews: [{ ...good(1), ...patch, photoClaimMatches: label === "geometry",
        photoClaimObjection: undefined, reason: `Concrete independent ${label} objection is not removed by a missing quote proof` }] }); };
      const blocked = await assertBlocked(options, ["INVALID_REVIEW", "SEMANTIC_REJECTION"]);
      assert.equal(calls, 1); assert.equal(rejected.length, 1);
      assert(blocked.failures.some(failure => failure.reason.includes(label))); checks++;
    }
    const crossSlot = textFixture(publishedContextFixtures.slice(0, 2)); let crossSlotCalls = 0;
    crossSlot.review = async call => { crossSlotCalls++; const actual = slots(call);
      return JSON.stringify({ reviews: actual.map((slot, index) => index === 0 ? { ...good(slot.index), accepted: false, photoClaimMatches: false,
        photoClaimObjection: bodyObjection(actual[1].sectionBody[0]), reason: "This quote belongs to the other final slot" } : good(slot.index)) }); };
    cleared.length = 0; rejected.length = 0;
    await assert.rejects(assertAudit({ ...crossSlot, brandLinkId: "offline-cross-slot-proof" }));
    assert.equal(crossSlotCalls, 1); assert(!cleared.some(row => row.sha256 === hash(finals[0])));
    assert.equal(rejected.length, 0, "another final slot's text cannot create a pixel rejection for this image"); checks++;
    // Feed an actual INVALID_REVIEW through the existing full preparation
    // workflow. It must propagate the outer audit code without rewriting text,
    // dropping/replacing pictures, submitting a generator, or completing approval.
    const invalidOptions = textFixture([publishedContextFixtures[0]]); let preparationReviewCalls = 0;
    invalidOptions.review = async () => { preparationReviewCalls++; return JSON.stringify({ reviews: [{ ...good(1), accepted: false,
      photoClaimMatches: false, photoClaimObjection: undefined, reason: "No source-bound objection was returned" }] }); };
    let imageMutations = 0, textMutations = 0, approvalAttempts = 0;
    const savedPreview = { approvedAt: null, imageSlots: [], contentQuality: { signals: [{ key: "review-substance", status: "pass" as const }] } };
    await assert.rejects(runMaterialPreparation("offline-proof-workflow", { pause: async () => {}, call: async (url, method, body) => {
      const action = (body as { action?: string } | undefined)?.action;
      if (url.endsWith("/images")) { imageMutations++; throw new Error("Unexpected image generation after reviewer contract failure"); }
      if (action === "revise" || action === "repair_photo_description" || method === "POST") { textMutations++; throw new Error("Unexpected creation/correction after reviewer contract failure"); }
      if (action === "approve") {
        approvalAttempts++;
        try { await assertAudit({ ...invalidOptions, brandLinkId: "offline-proof-workflow" }); }
        catch (error) {
          const audit = (error as { audit?: PublishImageAuditResult }).audit; assert(audit);
          throw Object.assign(new Error("PUBLISH_IMAGE_AUDIT_FAILED: original reviewer contract failure"), { code: "PUBLISH_IMAGE_AUDIT_FAILED",
            errors: audit.failures.map(failure => `${failure.code}: ${failure.reason}`), imageAuditFailures: audit.failures });
        }
        throw new Error("An invalid proof unexpectedly passed approval");
      }
      return { success: true, data: savedPreview };
    } }), (error: unknown) => (error as { code?: string }).code === "PUBLISH_IMAGE_AUDIT_FAILED");
    assert.equal(preparationReviewCalls, 1); assert.equal(approvalAttempts, 1); assert.equal(savedPreview.approvedAt, null);
    assert.equal(imageMutations, 0); assert.equal(textMutations, 0);
    assert.equal(defaultProviderCalls, 0); assert.deepEqual([...finals, ...references].map(hash), unchangedPixels); checks++;
    const mapped = fixture(pairs);
    let calls = 0;
    mapped.review = async call => {
      calls++;
      const rows = slots(call);
      assert.deepEqual(rows.map(row => row.comparisonReferenceImageIndex), [4, 5, 4]);
      assert.equal(call.imagePaths!.length, 5, "shared reference is attached once, after all three final photographs");
      assert.equal(call.maxImages, 5);
      assert.equal(call.preserveImageOrder, true);
      assert(call.imagePaths!.reduce((sum, file) => sum + fs.statSync(file).size, 0) <= PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES);
      for (const [index, row] of rows.entries()) {
        const attachedFinal = await sharp(call.imagePaths![index]).raw().toBuffer();
        const attachedReference = await sharp(call.imagePaths![row.comparisonReferenceImageIndex - 1]).raw().toBuffer();
        assert.deepEqual(attachedFinal, await sharp(pairs[index].final).raw().toBuffer());
        assert.deepEqual(attachedReference, await sharp(pairs[index].reference).raw().toBuffer());
        assert.deepEqual(fs.readFileSync(call.imagePaths![index]), await encodeLosslessAuditSnapshot(fs.readFileSync(pairs[index].final)),
          "final snapshots use the actual shared lossless encoder");
        assert.deepEqual(fs.readFileSync(call.imagePaths![row.comparisonReferenceImageIndex - 1]), await encodeLosslessAuditSnapshot(fs.readFileSync(pairs[index].reference)),
          "own mapped references use the same shared encoder and retain their cache identity");
        assert.equal(row.referenceSha256, hash(pairs[index].reference));
        assert.equal(row.sourceSnapshotId, "offline-snapshot");
      }
      assert.match(call.userPrompt, /not publication candidates/u);
      assert.match(call.userPrompt, /Do not output a review for reference attachments/u);
      assert.match(call.userPrompt, /one identifiable selected kit component/u);
      assert.match(call.userPrompt, /Missing other kit components or purchased units alone is not an identity mismatch/u);
      assert.match(call.userPrompt, /wrong visible component, swapped scent\/model/u);
      assert.match(call.userPrompt, /Multiple views or physical units of the same identifiable model\/variant alone are not mixedOptions/u);
      assert.match(call.userPrompt, /same-design items are not automatically approved/u);
      const validate = new Ajv({ allErrors: true }).compile(call.outputSchema as object);
      assert.equal(validate({ reviews: rows.map(row => referencePlaneFixtureRow(call, good(row.index))) }), true);
      assert.equal(validate({ reviews: [...rows.map(row => referencePlaneFixtureRow(call, good(row.index))), good(4)] }), false, "reference attachments cannot become extra output verdicts");
      assert.equal(validate({ reviews: [good(1), good(2), good(4)] }), false, "reference index is not a final output index");
      return answer(call);
    };
    const mappedResult = await auditPublishImages(mapped);
    assert.equal(mappedResult.ok, true); assert.equal(mappedResult.checked, 3); assert.equal(calls, 1); checks++;
    const derivedThumbnail = (): PublishImageAuditOptions => ({ productName: "selected product", sourceSnapshotId: "offline-snapshot",
      composition: { sections: [], renderNodes: [{ kind: "image", assetPath: finals[0], sectionId: null, role: "thumbnail", altText: "large title", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" }] },
      imageAssets: [{ path: finals[0], sourcePath: finals[0], sha256: hash(finals[0]), role: "hero", sectionId: null,
        provenance: "PHOTO_TEXT_THUMBNAIL", creationMethod: "remote-generated", remoteGenerated: true,
        referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, sourceSnapshotId: "offline-snapshot",
          referencePath: references[0], referenceSha256: hash(references[0]), thumbnailRawPath: finals[1], reviewedOutputSha256: hash(finals[1]),
          thumbnailOutputSha256: hash(finals[0]), reviewStatus: "passed", checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } }],
      review: async call => { assert.equal(slots(call)[0].comparisonReferenceImageIndex, 2);
        assert.deepEqual(await sharp(call.imagePaths![1]).raw().toBuffer(), await sharp(references[0]).raw().toBuffer()); return answer(call); } });
    assert.equal((await auditPublishImages(derivedThumbnail())).ok, true); checks++;
    const headlineProof = derivedThumbnail(); let headlineProofCalls = 0;
    headlineProof.review = async () => { headlineProofCalls++; return JSON.stringify({ reviews: [{ ...good(1), accepted: false, photoClaimMatches: false,
      photoClaimObjection: { origin: "thumbnail-headline", sourceIndex: null, quote: "사진으로 성능 입증", scope: "performance",
        conflict: "The original reviewer reports the headline is unsupported by the pixels." },
      reason: "Headline proof format is valid; this is not an OCR truth guarantee or an override of the adverse verdict" }] }); };
    await assertBlocked(headlineProof, ["SEMANTIC_REJECTION"]); assert.equal(headlineProofCalls, 1); assert.equal(rejected.length, 1); checks++;
    const headlineRejected = derivedThumbnail(); headlineRejected.review = async () => JSON.stringify({ reviews: [{ ...good(1), thumbnailHeadlineLegible: false }] });
    assert.equal((await auditPublishImages(headlineRejected)).ok, false, "passed noAddedText raw review never approves an unreadable final headline"); checks++;
    for (const field of ["thumbnailRawPath", "thumbnailOutputSha256", "reviewedOutputSha256"] as const) {
      const invalid = derivedThumbnail(); Object.assign(invalid.imageAssets![0].referenceScene!, { [field]: field === "thumbnailRawPath" ? path.join(root, "missing.png") : "0".repeat(64) });
      invalid.review = async () => { throw new Error("bad raw/final lineage must never reach provider"); };
      assert.equal((await auditPublishImages(invalid)).ok, false); checks++;
    }
    for (const changedFile of [finals[0], finals[1], references[0]]) {
      const bytes = fs.readFileSync(changedFile); const options = derivedThumbnail();
      options.review = async call => { fs.writeFileSync(changedFile, "changed during final audit"); return answer(call); };
      const changed = await auditPublishImages(options); fs.writeFileSync(changedFile, bytes);
      assert.equal(changed.ok, false); assert(changed.failures.some(item => item.code === "IMAGE_CHANGED")); checks++;
    }
    const galleryUrls = ["https://shop-phinf.pstatic.net/selected/toner.png?type=w860", "https://shop-phinf.pstatic.net/selected/kit.png?type=w860"];
    const selectedSnapshot = createProductSnapshot({ productId: "selected-kit", connectKind: "SHOPPING", externalProductId: "kit-123",
      sourceUrl: "https://brand.naver.com/seller/products/123", product: { name: "selected toner/serum/cream kit", description: "selected kit",
        features: ["toner, serum, cream"], referenceImageUrls: galleryUrls } });
    const receiptPaths = [references[0], references[1]].map(file => `${file}.retrieval.json`);
    receiptPaths.forEach((file, index) => fs.writeFileSync(file, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: galleryUrls[index],
      sha256: hash(references[index]), retrievedAt: new Date(Date.now() - 1000).toISOString(), identityVerified: false })));
    const galleryOptions = (): PublishImageAuditOptions => {
      const options = fixture(pairs);
      options.sourceSnapshotId = selectedSnapshot.snapshotId;
      options.imageAssets!.forEach(asset => { asset.referenceScene!.sourceSnapshotId = selectedSnapshot.snapshotId; });
      return { ...options, selectedSourceSnapshot: structuredClone(selectedSnapshot), selectedSourceProductId: "selected-kit", selectedSourceDirectory: root };
    };
    const galleryMapped = galleryOptions();
    let galleryCalls = 0;
    galleryMapped.review = async call => {
      const pair = pairs[galleryCalls++];
      const rows = slots(call) as Array<ReturnType<typeof slots>[number] & { selectedGalleryComparisonImageIndexes: number[] }>;
      assert.equal(rows.length, 1, "rich gallery evidence is reviewed against exactly one final publication candidate");
      assert.equal(call.imagePaths!.length, 3, "gallery and per-scene references sharing SHA use one actual attachment");
      assert.equal(rows[0].comparisonReferenceImageIndex, 2);
      assert.deepEqual(rows[0].selectedGalleryComparisonImageIndexes, [3], "the exact slot primary is retained as primary, not relabeled supplemental");
      const schema = call.outputSchema as { properties: { reviews: { minItems: number; maxItems: number; items: { properties: { index: { enum: number[] } } } } } };
      assert.equal(schema.properties.reviews.minItems, 1); assert.equal(schema.properties.reviews.maxItems, 1);
      assert.deepEqual(schema.properties.reviews.items.properties.index.enum, [1]);
      assert.deepEqual(await sharp(call.imagePaths![0]).raw().toBuffer(), await sharp(pair.final).raw().toBuffer());
      assert.match(call.userPrompt, /role":"canonical-selected-source"/u);
      assert.match(call.userPrompt, /UNVERIFIED comparison context, not identity approval or publication candidates/u);
      assert.match(call.userPrompt, /gifts, cross-sells or other variants/u);
      assert.match(call.userPrompt, /inspect publication-format checks ONLY on final attachments/u);
      assert.match(call.userPrompt, /selected kit component exterior.*names a component category, not a promise to show the complete kit/u);
      assert.match(call.userPrompt, /identifiable component visibly matched to selected-gallery membership evidence/u);
      assert.match(call.userPrompt, /Reject an actual claim such as '이 사진에 세트 전 구성품이 보입니다'/u);
      assert.match(call.userPrompt, /intentionally changes the reference's background, props, lighting, camera viewpoint and product pose/u);
      assert.match(call.userPrompt, /Compare the actual product's identifying geometry, intrinsic printing and selected variant, not scene sameness/u);
      assert.match(call.userPrompt, /Pose\/viewpoint variation cannot excuse a warped cap.*wrong variant or impossible geometry/u);
      assert.match(call.userPrompt, /Only when BOTH canonical selected facts and indexed selected-gallery pixels establish inclusion/u);
      assert.match(call.userPrompt, /not alternative purchase options requiring a named comparison/u);
      assert.match(call.userPrompt, /cross-sells, gift badges and unselected models\/variants remain unverified or conflicting/u);
      for (const reference of references.slice(0, 2)) {
        const actualIndex = hash(reference) === hash(pair.reference) ? 2 : 3;
        assert.deepEqual(await sharp(call.imagePaths![actualIndex - 1]).raw().toBuffer(), await sharp(reference).raw().toBuffer());
        assert.deepEqual(fs.readFileSync(call.imagePaths![actualIndex - 1]),
          await encodeLosslessAuditSnapshot(fs.readFileSync(reference)), "gallery snapshots use the same shared encoder");
      }
      return answer(call);
    };
    assert.equal((await auditPublishImages(galleryMapped)).ok, true); assert.equal(galleryCalls, 3); checks++;
    for (const patch of [
      { identityMatches: false, reason: "The selected gallery actually shows a different component/variant" },
      { noGraphicLayout: false, reason: "Final publication photo contains a gift badge; comparison artwork does not grant body permission" },
      { photoClaimMatches: false, reason: "One component cannot prove the headline's whole-set claim" },
      { identityMatches: false, reason: "Changed background cannot excuse the warped cap and missing distinctive identifying part" },
      { accepted: false, reason: "The photo has no visible kitchen cues despite an explicit kitchen setting" },
      { accepted: false, reason: "All individual boolean checks true but actual overall verdict is adverse; it remains a rejection" },
      { mixedOptions: true, reason: "An unselected scented variant or cross-sell cannot become a selected kit member from the gallery alone" },
    ]) {
      const options = galleryOptions(); options.review = async call => JSON.stringify({ reviews: slots(call).map(row => ({ ...good(row.index), ...patch,
        ...("photoClaimMatches" in patch && patch.photoClaimMatches === false ? { photoClaimObjection: bodyObjection(row.sectionBody[0]) } : {}) })) });
      assert.equal((await auditPublishImages(options)).ok, false); checks++;
    }
    for (const invalid of ["product-id", "snapshot-digest", "snapshot-binding", "relative-directory"] as const) {
      const options = galleryOptions();
      if (invalid === "product-id") options.selectedSourceProductId = "different-product";
      if (invalid === "snapshot-digest") options.selectedSourceSnapshot!.product.name = "modified kit";
      if (invalid === "snapshot-binding") options.sourceSnapshotId = "changed-source";
      if (invalid === "relative-directory") options.selectedSourceDirectory = "relative-cache";
      options.review = async () => { throw new Error("Invalid declared selected source must not reach provider"); };
      assert.equal((await auditPublishImages(options)).failures[0].code, "INVALID_CONTEXT"); checks++;
    }
    for (const changed of ["source", "receipt", "decoded", "snapshot", "product-id", "directory"] as const) {
      const options = galleryOptions(), savedSource = fs.readFileSync(references[1]), savedReceipt = fs.readFileSync(receiptPaths[1]);
      options.review = async call => {
        if (changed === "source") fs.writeFileSync(references[1], fs.readFileSync(references[2]));
        if (changed === "receipt") fs.appendFileSync(receiptPaths[1], "\n");
        if (changed === "decoded") fs.writeFileSync(call.imagePaths![2], fs.readFileSync(references[2]));
        if (changed === "snapshot") options.selectedSourceSnapshot!.product.name = "modified while reviewing";
        if (changed === "product-id") options.selectedSourceProductId = "other-kit";
        if (changed === "directory") options.selectedSourceDirectory = path.join(root, "other-cache");
        return answer(call);
      };
      try { assert.equal((await auditPublishImages(options)).failures[0].code, "IMAGE_CHANGED"); checks++; }
      finally { fs.writeFileSync(references[1], savedSource); fs.writeFileSync(receiptPaths[1], savedReceipt); }
    }
    const legacyGallery = galleryOptions(); legacyGallery.selectedSourceDirectory = path.join(root, "missing-legacy-cache");
    legacyGallery.review = async call => { assert.equal(call.imagePaths!.length, 5, "missing gallery preserves the existing exact scene references"); return answer(call); };
    assert.equal((await auditPublishImages(legacyGallery)).ok, true); checks++;
    const brokenGalleryPath = path.join(root, "broken-optional-gallery.png"), brokenGalleryUrl = "https://shop-phinf.pstatic.net/selected/broken.png?type=w860";
    fs.writeFileSync(brokenGalleryPath, "not decodable raster bytes");
    fs.writeFileSync(`${brokenGalleryPath}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: brokenGalleryUrl,
      sha256: hash(brokenGalleryPath), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
    const skipOptional = galleryOptions();
    skipOptional.selectedSourceSnapshot = createProductSnapshot({ ...selectedSnapshot,
      product: { ...selectedSnapshot.product, referenceImageUrls: [brokenGalleryUrl, ...galleryUrls] } });
    skipOptional.sourceSnapshotId = skipOptional.selectedSourceSnapshot.snapshotId;
    skipOptional.imageAssets!.forEach(asset => { asset.referenceScene!.sourceSnapshotId = skipOptional.sourceSnapshotId!; });
    skipOptional.review = async call => {
      assert.equal(call.imagePaths!.length, 3, "optional broken first gallery entry is skipped in favor of two useful intact static references");
      assert(!call.userPrompt.includes(brokenGalleryUrl), "invalid cache bytes cannot enter declared comparison context");
      return answer(call);
    };
    assert.equal((await auditPublishImages(skipOptional)).ok, true); checks++;
    const sourceUrl = "https://shop-phinf.pstatic.net/selected/exact-original.png?type=w860";
    fs.writeFileSync(`${references[2]}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
      sha256: hash(references[2]), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
    const originalSnapshot = createProductSnapshot({ productId: "selected-kit", connectKind: "SHOPPING", externalProductId: "selected-external",
      sourceUrl: selectedSnapshot.sourceUrl, product: { ...selectedSnapshot.product, referenceImageUrls: [...galleryUrls, sourceUrl] } });
    const exactOriginalOptions = (): PublishImageAuditOptions => {
      const options = fixture([{ final: references[2], reference: references[0] }]);
      options.sourceSnapshotId = originalSnapshot.snapshotId;
      Object.assign(options.imageAssets![0], { provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false });
      delete options.imageAssets![0].referenceScene;
      Object.assign(options.composition.renderNodes[0], { caption: "판매자 제공 상품 원본 사진" });
      Object.assign(options.composition.sections[0], { imageSource: "seller-original", imageIntent: "판매자 원본 사진: 선택 구성품 외형" });
      return { ...options, selectedSourceSnapshot: structuredClone(originalSnapshot), selectedSourceProductId: "selected-kit", selectedSourceDirectory: root };
    };
    const originalMapped = exactOriginalOptions();
    originalMapped.review = async call => {
      assert.equal(call.imagePaths!.length, 4);
      assert.match(call.userPrompt, /"exactCanonicalSourceForFinalImageIndexes":\[1\]/u);
      assert.match(call.userPrompt, /seller-gallery bytes, not automatic identity approval/u);
      assert.match(call.userPrompt, /Do not compare a pictured serum to a different included toner/u);
      assert.match(call.userPrompt, /BODY_NO_ADDED_TEXT/u);
      assert.deepEqual(await sharp(call.imagePaths![0]).raw().toBuffer(), await sharp(call.imagePaths![3]).raw().toBuffer());
      return answer(call);
    };
    const originalResult = await auditPublishImages(originalMapped);
    assert.equal(originalResult.ok, true, JSON.stringify(originalResult.failures)); checks++;
    for (const patch of [{ identityMatches: false }, { textPolicyMatches: false }, { accepted: false }]) {
      const options = exactOriginalOptions(); let calls = 0;
      options.review = async () => { calls++; return JSON.stringify({ reviews: [{ ...good(1), ...patch, reason: "Canonical source lineage does not approve an unselected component or body overlay" }] }); };
      assert.equal((await auditPublishImages(options)).ok, false); assert.equal(calls, 1); checks++;
    }
    const oversizedOriginal = path.join(root, "oversized-original.png");
    const oversizedDescriptor = fs.openSync(oversizedOriginal, "w");
    fs.ftruncateSync(oversizedDescriptor, 24 * 1024 * 1024 + 1); fs.closeSync(oversizedDescriptor);
    for (const invalidPath of [root, path.join(root, "missing-original.png"), oversizedOriginal]) {
      const options = exactOriginalOptions();
      options.imageAssets![0].path = invalidPath;
      Object.assign(options.composition.renderNodes[0], { assetPath: invalidPath });
      options.review = async () => { throw new Error("Invalid ORIGINAL must reject before provider"); };
      const invalid = await auditPublishImages(options);
      assert.equal(invalid.ok, false); assert.equal(invalid.failures[0].code, "MISSING_IMAGE"); checks++;
    }
    const sevenPairs = Array.from({ length: 7 }, (_, index) => ({ final: finals[index % finals.length], reference: references[0] }));
    const laterGallery = { ...fixture(sevenPairs), ...Object.fromEntries(Object.entries(galleryOptions()).filter(([key]) =>
      ["selectedSourceSnapshot", "selectedSourceProductId", "selectedSourceDirectory", "sourceSnapshotId"].includes(key))) } as PublishImageAuditOptions;
    laterGallery.imageAssets!.forEach(asset => { asset.referenceScene!.sourceSnapshotId = selectedSnapshot.snapshotId; });
    const beforeLaterReceipt = fs.readFileSync(receiptPaths[1]); let laterCalls = 0;
    laterGallery.review = async call => {
      laterCalls++;
      if (laterCalls === 7) fs.appendFileSync(receiptPaths[1], "\n");
      return answer(call);
    };
    try {
      const laterResult = await auditPublishImages(laterGallery);
      assert.equal(laterCalls, 7); assert.equal(laterResult.ok, false);
      assert(laterResult.failures.some(failure => failure.nodeIndex === 0 && failure.code === "IMAGE_CHANGED"),
        "a later batch receipt mutation also invalidates the already reviewed first final slot"); checks++;
    } finally { fs.writeFileSync(receiptPaths[1], beforeLaterReceipt); }
    const sevenShared = Array.from({ length: 7 }, () => ({ snapshotBytes: 1,
      referenceScene: { referenceSha256: "a".repeat(64), snapshotBytes: 1 },
      comparisonReferences: [{ referenceSha256: "a".repeat(64), snapshotBytes: 1 }, { referenceSha256: "b".repeat(64), snapshotBytes: 1 }] }));
    assert.deepEqual(planPublishImageAuditBatches(sevenShared).batches.map(batch => batch.length), [6, 1]); checks++;
    const third = Math.floor(PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES / 3);
    assert.equal(planPublishImageAuditBatches([{ snapshotBytes: third + 3,
      comparisonReferences: [{ referenceSha256: "a".repeat(64), snapshotBytes: third }, { referenceSha256: "b".repeat(64), snapshotBytes: third }] }]).oversized.length, 1); checks++;

    for (const patch of [
      { identityMatches: false, reason: "Readable changed product badge Zylex conflicts with the exact seller reference" },
      { identityMatches: false, reason: "Visible bottle is a different scent or component, not the selected member" },
      { photoClaimMatches: false, reason: "Published text claims this one bottle proves the complete three-piece kit" },
      { mixedOptions: true, reason: "Same-design units; the returned adverse flag is preserved, never normalized from reason" },
      { singlePhotograph: false, reason: "Pasted duplicate instead of a coherent photograph" },
      { noGraphicLayout: false, reason: "A matching product still sits inside an information panel" },
      { accepted: false, reason: "Reference metadata is valid but final pixel verdict still rejects" },
    ]) {
      const options = fixture([pairs[0]]);
      options.review = async call => JSON.stringify({ reviews: [{ ...good(1), ...patch,
        ...("photoClaimMatches" in patch && patch.photoClaimMatches === false ? { photoClaimObjection: bodyObjection(slots(call)[0].sectionBody[0]) } : {}) }] });
      const result = await auditPublishImages(options);
      assert.equal(result.ok, false); assert.equal(result.failures[0].code, "SEMANTIC_REJECTION");
      assert.ok(result.failures[0].reason.endsWith(patch.reason)); checks++;
    }

    for (const corrupt of ["snapshot", "source-hash", "output-hash", "pending", "missing-check", "missing-reference", "undecodable-reference"] as const) {
      const options = fixture([pairs[0]]);
      const metadata = options.imageAssets![0].referenceScene!;
      if (corrupt === "snapshot") options.sourceSnapshotId = "different-snapshot";
      if (corrupt === "source-hash") metadata.referenceSha256 = "f".repeat(64);
      if (corrupt === "output-hash") metadata.reviewedOutputSha256 = "f".repeat(64);
      if (corrupt === "pending") metadata.reviewStatus = "pending";
      if (corrupt === "missing-check") metadata.checks!.silhouette = false;
      if (corrupt === "missing-reference") metadata.referencePath = path.join(root, "missing.png");
      if (corrupt === "undecodable-reference") {
        metadata.referencePath = path.join(root, "corrupt-reference.png"); fs.writeFileSync(metadata.referencePath, "not raster pixels");
        metadata.referenceSha256 = hash(metadata.referencePath);
      }
      options.review = async () => { throw new Error("Invalid reference binding must block before provider"); };
      assert.equal((await auditPublishImages(options)).failures[0].code, "INVALID_CONTEXT"); checks++;
    }

    for (const changed of ["reference-source", "reference-snapshot", "final-source", "final-snapshot", "snapshot-id", "review-proof"] as const) {
      const options = fixture([pairs[0]]);
      const finalBytes = fs.readFileSync(pairs[0].final), refBytes = fs.readFileSync(pairs[0].reference);
      options.review = async call => {
        if (changed === "reference-source") fs.writeFileSync(pairs[0].reference, fs.readFileSync(references[1]));
        if (changed === "reference-snapshot") fs.writeFileSync(call.imagePaths![1], fs.readFileSync(references[1]));
        if (changed === "final-source") fs.writeFileSync(pairs[0].final, fs.readFileSync(finals[1]));
        if (changed === "final-snapshot") fs.writeFileSync(call.imagePaths![0], fs.readFileSync(finals[1]));
        if (changed === "snapshot-id") options.sourceSnapshotId = "changed-during-review";
        if (changed === "review-proof") options.imageAssets![0].referenceScene!.reviewStatus = "pending";
        return answer(call);
      };
      try { assert.equal((await auditPublishImages(options)).failures[0].code, "IMAGE_CHANGED"); checks++; }
      finally { fs.writeFileSync(pairs[0].final, finalBytes); fs.writeFileSync(pairs[0].reference, refBytes); }
    }

    const retry = fixture(pairs);
    calls = 0;
    retry.review = async call => {
      calls++;
      if (calls === 1) return JSON.stringify({ reviews: slots(call).map(row => row.index === 2 ? { ...good(row.index), notice: null } : good(row.index)) });
      assert.equal(calls, 2, "only the pre-existing malformed-format retry occurs");
      assert.deepEqual(slots(call).map(row => row.comparisonReferenceImageIndex), [2]);
      assert.deepEqual(await sharp(call.imagePaths![0]).raw().toBuffer(), await sharp(pairs[1].final).raw().toBuffer());
      assert.deepEqual(await sharp(call.imagePaths![1]).raw().toBuffer(), await sharp(pairs[1].reference).raw().toBuffer());
      assert.equal(call.maxImages, 2);
      return answer(call);
    };
    assert.equal((await auditPublishImages(retry)).ok, true); assert.equal(calls, 2); checks++;

    const countBound = fixture(finals.map((final, index) => ({ final, reference: references[index] })));
    const attachmentCounts: number[] = [];
    countBound.review = async call => { attachmentCounts.push(call.imagePaths!.length); assert(call.imagePaths!.length <= PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT); return answer(call); };
    assert.equal((await auditPublishImages(countBound)).ok, true);
    assert.deepEqual(attachmentCounts, [8, 2]); checks++;
    const shared = Array.from({ length: 9 }, () => ({ snapshotBytes: 1, referenceScene: { referenceSha256: "a".repeat(64), snapshotBytes: 1 } }));
    assert.deepEqual(planPublishImageAuditBatches(shared).batches.map(batch => batch.length), [7, 2]); checks++;
    const half = PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES / 2;
    assert.equal(planPublishImageAuditBatches([{ snapshotBytes: half, referenceScene: { referenceSha256: "a".repeat(64), snapshotBytes: half } }]).oversized.length, 0);
    assert.equal(planPublishImageAuditBatches([{ snapshotBytes: half + 1, referenceScene: { referenceSha256: "a".repeat(64), snapshotBytes: half } }]).oversized.length, 1); checks++;

    const largeFinal = path.join(root, "large-final.png"), largeReference = path.join(root, "large-reference.png");
    await sharp(crypto.randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toFile(largeFinal);
    await sharp(crypto.randomBytes(1450 * 1450 * 3), { raw: { width: 1450, height: 1450, channels: 3 } }).png().toFile(largeReference);
    const largeHashes = [hash(largeFinal), hash(largeReference)];
    // Real decoded final + 3 selected-gallery PNGs exceed one request, while
    // each bounded group can retain the exact direct reference unchanged.
    const splitGallery: string[] = [];
    const splitUrls = ["gallery-a.png", "gallery-b.png", "context-180ml.png"].map(name => `https://shop-phinf.pstatic.net/selected/${name}?type=w860`);
    for (let index = 0; index < 3; index++) {
      const file = path.join(root, `split-gallery-${index}.png`);
      await sharp(crypto.randomBytes(850 * 850 * 3), { raw: { width: 850, height: 850, channels: 3 } }).png().toFile(file);
      fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: splitUrls[index],
        sha256: hash(file), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
      splitGallery.push(file);
    }
    const splitSnapshot = createProductSnapshot({ productId: "split-kit", connectKind: "SHOPPING", externalProductId: "split-kit-id",
      sourceUrl: selectedSnapshot.sourceUrl, product: { name: "selected toner 180ml/serum/cream kit", features: ["180ml toner"], referenceImageUrls: splitUrls } });
    const splitFixture = (): PublishImageAuditOptions => {
      const options = fixture([{ final: largeFinal, reference: references[0] }]);
      options.sourceSnapshotId = splitSnapshot.snapshotId;
      options.imageAssets![0].referenceScene!.sourceSnapshotId = splitSnapshot.snapshotId;
      return { ...options, selectedSourceSnapshot: structuredClone(splitSnapshot), selectedSourceProductId: "split-kit", selectedSourceDirectory: root };
    };
    const allSplitHashes = [largeFinal, references[0], ...splitGallery].map(hash);
    assert([largeFinal, references[0], ...splitGallery].reduce((sum, file) => sum + fs.statSync(file).size, 0) > PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES,
      "this regression actually exceeds the single-request byte limit");
    const groupsSeen: string[][] = [];
    const splitOptions = splitFixture();
    splitOptions.review = async call => {
      assert.equal(slots(call).length, 1);
      assert.equal(slots(call)[0].comparisonReferenceImageIndex, 2);
      assert(call.imagePaths!.length <= PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT);
      assert(call.imagePaths!.reduce((sum, file) => sum + fs.statSync(file).size, 0) <= PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES);
      assert.deepEqual(await sharp(call.imagePaths![0]).raw().toBuffer(), await sharp(largeFinal).raw().toBuffer());
      assert.deepEqual(await sharp(call.imagePaths![1]).raw().toBuffer(), await sharp(references[0]).raw().toBuffer());
      const hashes = call.imagePaths!.slice(2).map(hash);
      groupsSeen.push(hashes);
      for (const [index, file] of call.imagePaths!.slice(2).entries()) {
        const original = splitGallery.find(reference => hash(reference) === hashes[index])!;
        assert.deepEqual(await sharp(file).raw().toBuffer(), await sharp(original).raw().toBuffer());
      }
      assert.match(call.userPrompt, /EVERY complete verdict must pass/u);
      return answer(call);
    };
    const splitResult = await auditPublishImages(splitOptions);
    assert.equal(splitResult.ok, true, JSON.stringify(splitResult.failures));
    assert.equal(splitResult.checked, 1, "multiple comparison groups still count one publication candidate");
    assert.deepEqual(groupsSeen.map(group => group.length), [2, 1]);
    assert.deepEqual(groupsSeen.flat(), splitGallery.map(hash), "all selected comparison evidence is reviewed in stable order");
    assert.equal(splitResult.comparisonReviews!.length, 2);
    assert(splitResult.comparisonReviews!.every(row => row.referenceSha256s.includes(hash(references[0]))));
    assert.deepEqual([largeFinal, references[0], ...splitGallery].map(hash), allSplitHashes); checks++;
    for (const patch of [{ identityMatches: false }, { photoClaimMatches: false }, { mixedOptions: true },
      { noGraphicLayout: false }, { textPolicyMatches: false }, { accepted: false }]) {
      const options = splitFixture(); let groupCalls = 0;
      options.review = async call => { groupCalls++;
        return JSON.stringify({ reviews: [{ ...good(1), ...(groupCalls === 1 ? patch : {}),
          ...(groupCalls === 1 && "photoClaimMatches" in patch && patch.photoClaimMatches === false
            ? { photoClaimObjection: bodyObjection(slots(call)[0].sectionBody[0]) } : {}),
          reason: "First group adverse; later matching gallery cannot cancel it" }] }); };
      const blocked = await auditPublishImages(options);
      assert.equal(groupCalls, 2, "every evidence group is inspected even after an adverse verdict");
      assert.equal(blocked.ok, false); assert.equal(blocked.checked, 1);
      assert.equal(blocked.comparisonReviews!.length, 2);
      for (const [key, value] of Object.entries(patch)) assert.equal(blocked.comparisonReviews![0].verdict![key], value);
      assert(blocked.failures.some(failure => failure.code === "SEMANTIC_REJECTION")); checks++;
    }
    const invalidSplit = splitFixture(); let splitCalls = 0;
    invalidSplit.review = async call => {
      splitCalls++;
      if (splitCalls <= 2) { assert.equal(call.imagePaths!.length, 4, "malformed retry retains the same bounded group"); return "{}"; }
      assert.equal(call.imagePaths!.length, 3, "remaining comparison group is still reviewed"); return answer(call);
    };
    const invalidSplitResult = await auditPublishImages(invalidSplit);
    assert.equal(splitCalls, 3); assert.equal(invalidSplitResult.ok, false);
    assert.equal(invalidSplitResult.comparisonReviews![0].verdict, null);
    assert(invalidSplitResult.failures.some(failure => failure.code === "INVALID_REVIEW")); checks++;
    const bytesHalf = PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES / 2;
    assert.equal(planPublishImageComparisonGroups(bytesHalf, [{ referenceSha256: "a".repeat(64), snapshotBytes: bytesHalf }],
      [{ referenceSha256: "b".repeat(64), snapshotBytes: 1 }]), null, "an optional reference cannot displace the mandatory identity reference");
    assert.equal(planPublishImageComparisonGroups(1, [], [{ referenceSha256: "a".repeat(64), snapshotBytes: 1 },
      { referenceSha256: "a".repeat(64), snapshotBytes: 2 }]), null, "conflicting duplicate reference sizes fail closed"); checks++;
    const byteReference = path.join(root, "byte-reference.png");
    await sharp(crypto.randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toFile(byteReference);
    const byteBound = fixture([{ final: largeFinal, reference: byteReference }, { final: largeFinal, reference: byteReference }]);
    const byteCounts: number[] = [];
    byteBound.review = async call => {
      byteCounts.push(call.imagePaths!.length);
      assert(call.imagePaths!.reduce((sum, file) => sum + fs.statSync(file).size, 0) <= PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES);
      assert.deepEqual(await sharp(call.imagePaths![0]).raw().toBuffer(), await sharp(largeFinal).raw().toBuffer());
      assert.deepEqual(await sharp(call.imagePaths![1]).raw().toBuffer(), await sharp(byteReference).raw().toBuffer());
      return answer(call);
    };
    assert.equal((await auditPublishImages(byteBound)).ok, true);
    assert.deepEqual(byteCounts, [2, 2], "two final PNGs would fit alone; the required reference bytes force separate full-resolution requests"); checks++;
    const oversized = fixture([{ final: largeFinal, reference: largeReference }, pairs[0]]);
    oversized.review = async () => { throw new Error("Individually oversized final/reference pair cannot reach provider"); };
    const oversizedResult = await auditPublishImages(oversized);
    assert.equal(oversizedResult.failures[0].code, "IMAGE_PAYLOAD_TOO_LARGE");
    assert.equal(oversizedResult.checked, 0); assert.equal(oversizedResult.images.length, 0);
    assert.deepEqual([hash(largeFinal), hash(largeReference)], largeHashes); checks++;
    console.log(`PASS publish audit references: ${checks} offline scenarios; mapped exact pixels, unique refs, whole-payload limits, strict proof/hash/format/claim verdicts, bounded retry (paid calls 0)`);
  } finally {
    if (previousUserData === undefined) delete process.env.DESKTOP_USER_DATA;
    else process.env.DESKTOP_USER_DATA = previousUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

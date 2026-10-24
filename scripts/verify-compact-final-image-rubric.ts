/** Offline request-budget and unchanged adverse-verdict contracts. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { auditPublishImages, buildSelectedProductImageAuditContext, type PublishImageAuditOptions } from "./lib/publish-image-audit";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { referencePlaneFixtureRow } from "./test-fixtures/reference-plane-review";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compact-final-rubric-")), id = "compact-offline";
  const sourceDirectory = path.join(root, "sources"); fs.mkdirSync(sourceDirectory);
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  let checks = 0, calls = 0, maximumUser = 0, maximumSchema = 0, maximumDescription = 0;
  try {
    const sources = Array.from({ length: 5 }, (_, index) => path.join(sourceDirectory, `${index}.png`));
    const candidate = path.join(root, "candidate.png"), urls = sources.map((_, index) => `https://shop-phinf.pstatic.net/offline/rubric-${index}.png`);
    for (const [index, file] of [...sources, candidate].entries()) await sharp({ create: { width: 400, height: 400, channels: 3,
      background: `rgb(${40 + index * 25},100,130)` } }).png().toFile(file);
    for (const [index, file] of sources.entries()) fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1",
      sourceUrl: urls[index], sha256: hash(file), retrievedAt: new Date(Date.now() - 1000).toISOString() }));
    const features = ["선택 옵션: FREE(95-100) / XL(105-110)", "색상: 검정/차콜", "색상: 검정/회색", "색상: 검정/차색/보카시", "색상: 검정"];
    const snapshot = createProductSnapshot({ productId: id, externalProductId: null, connectKind: "SHOPPING",
      sourceUrl: "https://smartstore.naver.com/offline/products/1", product: { name: "선택 상품 외형", features, referenceImageUrls: urls } });
    const section = { id: "body", title: "선택 외형과 확인할 조건", body: ["구매할 옵션을 확인하세요."], characterCount: 15,
      imagePaths: [candidate], imageSource: "staged-ai" as const, imageIntent: "AI 연출 이미지: 생활 맥락", headingStyle: "plain" as const };
    const options: PublishImageAuditOptions = { productName: snapshot.product.name as string,
      selectedProduct: buildSelectedProductImageAuditContext(snapshot.product.name as string, features), sourceSnapshotId: snapshot.snapshotId,
      selectedSourceSnapshot: snapshot, selectedSourceProductId: id, selectedSourceDirectory: sourceDirectory,
      composition: { sections: [section], renderNodes: [{ kind: "heading", sectionId: "body", text: section.title },
        { kind: "paragraph", sectionId: "body", text: section.body[0] }, { kind: "image", sectionId: "body", role: "scene", assetPath: candidate,
          altText: "외형", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", caption: REFERENCE_SCENE_CAPTION }] },
      imageAssets: [{ path: candidate, sourcePath: candidate, sha256: hash(candidate), role: "body", sectionId: "body", provenance: "GENERATED_SCENE",
        creationMethod: "reference-guided-scene", remoteGenerated: true, referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION,
          sourceSnapshotId: snapshot.snapshotId, referencePath: sources[0], referenceSha256: hash(sources[0]), reviewedOutputSha256: hash(candidate),
          reviewStatus: "passed", checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } }] };
    const files = [candidate, ...sources, ...sources.map(file => `${file}.retrieval.json`)], before = files.map(hash);
    for (const kind of ["pass", "shape", "option", "frame", "claim", "notice"] as const) {
      const result = await auditPublishImages({ ...options, review: async call => {
        calls++; maximumUser = Math.max(maximumUser, call.userPrompt.length); maximumSchema = Math.max(maximumSchema, JSON.stringify(call.outputSchema).length);
        assert(call.userPrompt.length < 24_000, "a normal five-reference request must not repeat whole rubrics in every field");
        assert(JSON.stringify(call.outputSchema).length < 12_000, "schema contains short field descriptions, not a second policy document"); checks += 2;
        for (const section of ["TASK:", "IDENTITY EVIDENCE:", "REFERENCE ROLES:", "OPTIONS AND COMPONENTS:", "OPTION WITNESS:", "PHOTO CLAIMS:", "FORMAT:", "VERDICT:"]) {
          assert.equal(call.userPrompt.split(section).length - 1, 1, `${section} central rule appears once`); checks++;
        }
        const scan = (value: unknown) => { if (!value || typeof value !== "object") return; for (const [key, item] of Object.entries(value)) {
          if (key === "description") { assert(typeof item === "string" && item.length <= 250); maximumDescription = Math.max(maximumDescription, String(item).length); checks++; }
          else scan(item);
        } }; scan(call.outputSchema);
        for (const meaning of [/not market uniqueness, authenticity or exact-SKU certification/u, /same selected component/u,
          /concealed or absent in the source/u, /a size-only confirmed label establishes no colour/u,
          /exactCanonicalSellerOriginal/u, /product-name headline, promotional\/efficacy copy/u,
          /do not alone make a photograph proof/u, /whole-room view or intended styling/u,
          /different cut, material, shape, construction, readable brand or confirmed option/u,
          /Severe deformation or clearly impossible real-world scale, contact or placement/u,
          /a role=thumbnail/u, /actual shipping\/service\/seller announcement/u, /no majority vote cancels an adverse group/u]) {
          assert.match(call.userPrompt, meaning); checks++;
        }
        const row = referencePlaneFixtureRow(call, { index: 1, reason: `Offline ${kind} observation`, accepted: kind === "pass", identityMatches: true,
          photoClaimMatches: true, photoClaimObjection: { origin: "none", sourceIndex: null as number | null, quote: "", scope: "none", conflict: "" },
          notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true,
          noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo" });
        if (kind === "shape" || kind === "option") {
          row.identityMatches = false; (row.referenceComparison as Record<string, unknown>).objectionKind = kind;
          (row as Record<string, unknown>).visibleIdentityEvidence = { basis: "concrete-conflict", landmarks: [{ part: "Actual differing feature",
            referenceObservation: "Source feature", candidateObservation: "Conflicting candidate feature" }], conflict: `Real ${kind} conflict` };
        }
        if (kind === "frame") row.noGraphicLayout = false;
        if (kind === "claim") { row.photoClaimMatches = false; row.photoClaimObjection = { origin: "section-body", sourceIndex: 0,
          quote: section.body[0], scope: "pictured-appearance", conflict: "Actual injected visible claim conflict" }; }
        if (kind === "notice") row.notice = true;
        return JSON.stringify({ reviews: [row] });
      } });
      assert.equal(result.ok, kind === "pass"); checks++;
      if (kind !== "pass") { assert(result.failures.some(failure => failure.code === "SEMANTIC_REJECTION")); checks++; }
    }
    assert.deepEqual(files.map(hash), before); assert.equal(calls, 6); checks += 2;
    console.log(`PASS compact final rubric: ${checks} offline checks; user<=${maximumUser}, schema<=${maximumSchema}, field descriptions<=${maximumDescription}; raw adverse verdicts preserved, provider/generation/live writes0`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

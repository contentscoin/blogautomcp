/** Offline only: real raster decoding and exact reference bindings; provider is stubbed. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import sharp from "sharp";
import { auditPublishImages, planPublishImageAuditBatches, PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES, PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT, type PublishImageAuditOptions } from "./lib/publish-image-audit";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const slots = (call: CodexDraftOptions): Array<{ index: number; comparisonReferenceImageIndex: number; referenceSha256: string; sourceSnapshotId: string; sectionBody: string[] }> => {
  const line = call.userPrompt.split("\n").find(text => text.startsWith("Each attached image belongs ONLY"))!;
  return JSON.parse(line.slice(line.indexOf("[")));
};
const good = (index: number) => ({ index, accepted: true, identityMatches: true, photoClaimMatches: true, notice: false,
  mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true,
  noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "Offline pixel-pair contract fixture" });
const answer = (call: CodexDraftOptions) => JSON.stringify({ reviews: slots(call).map(slot => good(slot.index)) });

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-reference-fixture-"));
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
      assert.equal(validate({ reviews: rows.map(row => good(row.index)) }), true);
      assert.equal(validate({ reviews: [...rows.map(row => good(row.index)), good(4)] }), false, "reference attachments cannot become extra output verdicts");
      assert.equal(validate({ reviews: [good(1), good(2), good(4)] }), false, "reference index is not a final output index");
      return answer(call);
    };
    const mappedResult = await auditPublishImages(mapped);
    assert.equal(mappedResult.ok, true); assert.equal(mappedResult.checked, 3); assert.equal(calls, 1); checks++;

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
      options.review = async () => JSON.stringify({ reviews: [{ ...good(1), ...patch }] });
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
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

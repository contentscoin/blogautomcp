/** Offline transport regression: full real PNG decoding, no provider/image generation. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { auditPublishImages, planPublishImageAuditBatches, PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES, PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT, type PublishImageAuditOptions } from "./lib/publish-image-audit";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-payload-fixture-"));
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  try {
    const files: string[] = [];
    for (let index = 0; index < 5; index++) {
      const file = path.join(root, `image-${index}.png`);
      await sharp(crypto.randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toFile(file);
      files.push(file);
    }
    const originalHashes = files.map(hash);
    const seen: number[] = [], batchLengths: number[] = [];
    const imageNode = (assetPath: string): Extract<PublishImageAuditOptions["composition"]["renderNodes"][number], { kind: "image" }> => ({
      kind: "image", role: "thumbnail", sectionId: null, assetPath, altText: "selected product", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    });
    const options: PublishImageAuditOptions = {
      productName: "selected product", composition: {
        sections: [], renderNodes: files.map(imageNode),
      },
      review: async call => {
        const attached = call.imagePaths!;
        batchLengths.push(attached.length);
        assert.equal(call.maxImages, attached.length);
        assert.equal(call.preserveImageOrder, true);
        assert(attached.reduce((total, file) => total + fs.statSync(file).size, 0) <= PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES);
        for (const file of attached) {
          const index = Number(path.basename(file, ".png"));
          seen.push(index);
          const original = await sharp(files[index]).raw().toBuffer();
          const snapshot = await sharp(file).raw().toBuffer();
          assert.deepEqual(snapshot, original, "transport splitting must not downsample or alter review pixels");
        }
        return JSON.stringify({ reviews: attached.map((_, index) => ({ index: index + 1, accepted: true, identityMatches: true,
          photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false,
          singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "fixture exact selected product" })) });
      },
    };
    const result = await auditPublishImages(options);
    assert.equal(result.ok, true);
    assert.equal(result.checked, 5);
    assert.deepEqual(seen, [0, 1, 2, 3, 4], "all original slots are reviewed once in stable asset order");
    assert.deepEqual(batchLengths, [2, 2, 1], "large aggregate request is divided before any provider call");
    assert.deepEqual(files.map(hash), originalHashes);
    const small = Array.from({ length: PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT + 1 }, (_, index) => ({ index, snapshotBytes: 1 }));
    assert.deepEqual(planPublishImageAuditBatches(small).batches.map(batch => batch.length), [PUBLISH_IMAGE_AUDIT_MAX_BATCH_COUNT, 1]);
    assert.deepEqual(planPublishImageAuditBatches([{ snapshotBytes: PUBLISH_IMAGE_AUDIT_MAX_BATCH_BYTES }, { snapshotBytes: 1 }]).batches.map(batch => batch.length), [1, 1]);
    const oversized = path.join(root, "oversized.png");
    await sharp(crypto.randomBytes(1800 * 1800 * 3), { raw: { width: 1800, height: 1800, channels: 3 } }).png().toFile(oversized);
    const oversizedHash = hash(oversized);
    let calls = 0;
    const blocked = await auditPublishImages({ ...options, composition: { sections: [], renderNodes: [
      imageNode(oversized), options.composition.renderNodes[1],
    ] }, review: async () => { calls++; throw new Error("Oversized request must never reach provider"); } });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.checked, 0);
    assert.equal(blocked.images.length, 0, "unreviewed candidates cannot clear a prior image-rejection ledger entry");
    assert.equal(calls, 0);
    assert.equal(blocked.failures[0].code, "IMAGE_PAYLOAD_TOO_LARGE");
    assert.match(blocked.failures[0].reason, /original file was preserved.*No partial approval or downsampling/);
    assert.equal(hash(oversized), oversizedHash);
    console.log("PASS: payload-budgeted full-resolution audit [2,2,1], stable all-slot review, unchanged originals/pixels, count/byte boundaries, oversized fail-closed before provider");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

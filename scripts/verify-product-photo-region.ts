import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { recoverProductPhotoRegion } from "./lib/product-photo-region";
import { prioritizeImageCandidates } from "./lib/product-image-selection";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product-region-test-"));
  try {
    const original = path.join(dir, "seller.png");
    await sharp({ create: { width: 860, height: 860, channels: 3, background: "#aa55ff" } }).png().toFile(original);
    const input = { productName: "아비노 스트레스릴리프 라벤더향 532ml 2개", localCandidates: [original], sourceImageUrls: [], outputDir: dir };
    let verified = 0;
    const dependencies = {
      download: async () => original,
      review: async () => JSON.stringify({ regions: [{ imageIndex: 1, left: 0.2, top: 0.1, right: 0.7, bottom: 0.9 }] }),
      verify: async (files: string[]) => { verified++; return files[0]; },
    };
    const selected = await recoverProductPhotoRegion(input, dependencies);
    assert.ok(selected && selected !== original);
    assert.equal(verified, 1, "the suggested crop must be independently photo-reviewed");
    const actual = await sharp(selected).raw().toBuffer();
    const expected = await sharp(original).extract({ left: 172, top: 86, width: 430, height: 688 }).raw().toBuffer();
    assert.deepEqual(actual, expected, "crop pixels are unchanged seller pixels, not generated imagery");
    assert.equal(await recoverProductPhotoRegion(input, { ...dependencies, verify: async () => null }), null, "notice/other-product crop cannot bypass QC");
    for (const region of [
      { imageIndex: 99, left: 0, top: 0, right: 1, bottom: 1 },
      { imageIndex: 1, left: -0.1, top: 0, right: 1, bottom: 1 },
      { imageIndex: 1, left: 0.9, top: 0, right: 0.1, bottom: 1 },
      { imageIndex: 1, left: 0, top: 0, right: 0.1, bottom: 0.1 },
    ]) {
      assert.equal(await recoverProductPhotoRegion(input, { ...dependencies,
        review: async () => JSON.stringify({ regions: [region] }),
        verify: async () => { throw new Error("invalid box reached QC"); },
      }), null);
    }
    await assert.rejects(recoverProductPhotoRegion(input, { ...dependencies, review: async () => "not JSON" }), /해석/);
    await assert.rejects(recoverProductPhotoRegion(input, { ...dependencies, verify: async () => { throw new Error("AUTH_FAILED"); } }), /AUTH_FAILED/);
    const gallery = "https://shop-phinf.pstatic.net/gallery.png?type=f40";
    const recommendation = "https://shop-phinf.pstatic.net/other.jpg?type=w860";
    assert.equal(prioritizeImageCandidates([
      { url: recommendation, source: "dom", width: 860, height: 860 },
      { url: gallery, source: "gallery", width: 40, height: 40 },
    ])[0], gallery.replace("f40", "w860"), "lazy gallery images precede unrelated loaded recommendations");
    console.log("PASS: source pixels preserved; strict QC, invalid boxes, auth failures and lazy gallery priority verified");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

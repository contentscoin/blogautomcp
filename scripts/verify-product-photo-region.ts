import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { recoverProductPhotoRegion } from "./lib/product-photo-region";
import { prioritizeImageCandidates } from "./lib/product-image-selection";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product-region-test-"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("No real HTTP or provider calls in source-region fixtures"); };
    let tests = 0;
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const url = "https://shop-phinf.pstatic.net/selected-option.png";
    const original = path.join(dir, "seller.png");
    const pixels = Buffer.alloc(860 * 860 * 3);
    for (let y = 0; y < 860; y++) for (let x = 0; x < 860; x++) {
      const offset = (y * 860 + x) * 3;
      pixels[offset] = x % 256; pixels[offset + 1] = y % 256; pixels[offset + 2] = (x + y) % 256;
    }
    await sharp(pixels, { raw: { width: 860, height: 860, channels: 3 } }).png().toFile(original);
    const receipt = (file: string, sourceUrl = url) => fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({
      version: "product-image-retrieval/v1", sourceUrl, sha256: hash(file), retrievedAt: new Date(Date.now() - 1000).toISOString(), identityVerified: false,
    }));
    receipt(original);
    const input = { productName: "아비노 스트레스릴리프 라벤더향 532ml 2개", localCandidates: [original], sourceImageUrls: [url], outputDir: dir,
      acceptSourcePhoto: async (file: string) => path.basename(file).startsWith("verified-region-") };
    let downloads = 0;
    let verified = 0;
    const dependencies = {
      download: async () => { downloads++; throw new Error("Warm seller receipt must avoid HTTP"); },
      review: async () => JSON.stringify({ regions: [{ imageIndex: 1, left: 0.2, top: 0.1, right: 0.7, bottom: 0.9 }] }),
      verify: async (files: string[]) => { verified++; return files[0]; },
    };
    const selected = await recoverProductPhotoRegion(input, dependencies);
    assert.ok(selected && selected !== original);
    assert.equal(verified, 1, "the suggested crop must be independently photo-reviewed");
    const actual = await sharp(selected).raw().toBuffer();
    const expected = await sharp(original).extract({ left: 172, top: 86, width: 430, height: 688 }).raw().toBuffer();
    assert.deepEqual(actual, expected, "crop pixels are unchanged seller pixels, not generated imagery");
    assert.equal(downloads, 0); tests++;
    const originalHash = hash(original);
    let fullCrops = 0, regionCalls = 0;
    const first = { imageIndex: 1, left: 0.05, top: 0.1, right: 0.55, bottom: 0.9 };
    const second = { imageIndex: 1, left: 0.45, top: 0.1, right: 0.95, bottom: 0.9 };
    const later = await recoverProductPhotoRegion({ ...input, acceptSourcePhoto: async file =>
      path.basename(file).startsWith("verified-region-") && ++fullCrops === 2 }, { ...dependencies,
      review: async () => { regionCalls++; return JSON.stringify({ regions: [first, first, second] }); },
    });
    assert.ok(later); assert.equal(fullCrops, 2); assert.equal(regionCalls, 1);
    assert.equal(hash(original), originalHash, "a failed first crop cannot modify source pixels");
    const laterPixels = await sharp(later).raw().toBuffer();
    assert.deepEqual(laterPixels, await sharp(original).extract({ left: 387, top: 86, width: 430, height: 688 }).raw().toBuffer(),
      "coarse-positive/full-negative first crop continues to the next distinct bounded region");
    tests++;
    let allRejectedFullChecks = 0;
    assert.equal(await recoverProductPhotoRegion({ ...input, acceptSourcePhoto: async () => { allRejectedFullChecks++; return false; } }, {
      ...dependencies, review: async () => JSON.stringify({ regions: [first, first, second] }),
    }), null);
    assert.equal(allRejectedFullChecks, 3, "one intact original plus two distinct crops; a duplicate crop is never re-reviewed"); tests++;
    const warm = path.join(dir, "warm-sixth"); fs.mkdirSync(warm);
    const sixUrls = Array.from({ length: 6 }, (_, index) => `https://shop-phinf.pstatic.net/current-${index}.png`);
    const sixFiles = sixUrls.map((sourceUrl, index) => {
      const file = path.join(warm, `seller-${index}.png`); fs.writeFileSync(file, Buffer.concat([fs.readFileSync(original), Buffer.from(String(index))]));
      receipt(file, sourceUrl); return file;
    });
    let originalReviews = 0, sixthCropCalls = 0;
    const sixth = await recoverProductPhotoRegion({ ...input, outputDir: warm, localCandidates: sixFiles.slice(0, 5), sourceImageUrls: sixUrls,
      acceptSourcePhoto: async file => { originalReviews++; return file === sixFiles[5]; } }, { ...dependencies,
      review: async () => { sixthCropCalls++; throw new Error("A clean sixth original must avoid all crop calls"); },
    });
    assert.equal(sixth, sixFiles[5]); assert.equal(originalReviews, 6); assert.equal(sixthCropCalls, 0); assert.equal(downloads, 0); tests++;

    const shared = path.join(dir, "shared-cache"); fs.mkdirSync(shared);
    const validShared = path.join(shared, "current.png"); fs.copyFileSync(original, validShared); receipt(validShared);
    const ignoredFiles = [path.join(shared, "foreign-large.png"), path.join(shared, "expired-large.png")];
    for (const file of ignoredFiles) fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024, 17));
    receipt(ignoredFiles[0], "https://shop-phinf.pstatic.net/different-product.png");
    receipt(ignoredFiles[1]);
    const expiredReceipt = JSON.parse(fs.readFileSync(`${ignoredFiles[1]}.retrieval.json`, "utf8"));
    fs.writeFileSync(`${ignoredFiles[1]}.retrieval.json`, JSON.stringify({ ...expiredReceipt,
      retrievedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }));
    const readFile = fs.readFileSync;
    let ignoredPixelReads = 0;
    try {
      fs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
        if (typeof file === "string" && ignoredFiles.includes(file)) { ignoredPixelReads++; throw new Error("Unrelated or stale pixels must not be read"); }
        return Reflect.apply(readFile, fs, [file, ...args]);
      }) as typeof fs.readFileSync;
      assert.equal(await recoverProductPhotoRegion({ ...input, outputDir: shared, localCandidates: ignoredFiles,
        acceptSourcePhoto: async file => file === validShared }, dependencies), validShared);
    } finally { fs.readFileSync = readFile; }
    assert.equal(ignoredPixelReads, 0, "filter source URL and expiry before opening cached image bytes"); tests++;

    const batches = path.join(dir, "later-batch"); fs.mkdirSync(batches);
    const batchUrls = Array.from({ length: 9 }, (_, index) => `https://shop-phinf.pstatic.net/batch-${index}.png`);
    for (const [index, sourceUrl] of batchUrls.entries()) {
      const file = path.join(batches, `batch-${index}.png`);
      if (index === 8) await sharp(original).modulate({ brightness: 0.8 }).png().toFile(file);
      else fs.writeFileSync(file, Buffer.concat([fs.readFileSync(original), Buffer.from(String(index))]));
      receipt(file, sourceUrl);
    }
    let laterBatchReviews = 0, laterBatchFullCrops = 0;
    const batchResult = await recoverProductPhotoRegion({ ...input, outputDir: batches, localCandidates: [], sourceImageUrls: batchUrls,
      acceptSourcePhoto: async file => path.basename(file).startsWith("verified-region-") && ++laterBatchFullCrops === 2 }, {
      ...dependencies, review: async () => { laterBatchReviews++; return JSON.stringify({ regions: [first] }); },
    });
    assert.ok(batchResult); assert.equal(laterBatchReviews, 2); assert.equal(laterBatchFullCrops, 2,
      "a complete first-batch rejection continues to the remaining verified seller batch"); tests++;

    let invalidSourceReviews = 0;
    const foreign = path.join(dir, "foreign"); fs.mkdirSync(foreign);
    const foreignFile = path.join(foreign, "other.png"); fs.copyFileSync(original, foreignFile);
    receipt(foreignFile, "https://shop-phinf.pstatic.net/foreign-product.png");
    const unverified = path.join(foreign, "unverified.png"); fs.copyFileSync(original, unverified);
    const invalidInput = { ...input, outputDir: foreign, localCandidates: [foreignFile, unverified],
      acceptSourcePhoto: async () => { invalidSourceReviews++; return true; } };
    assert.equal(await recoverProductPhotoRegion(invalidInput, { ...dependencies, download: async () => foreignFile }), null);
    assert.equal(invalidSourceReviews, 0, "foreign URL receipts and unverified local files never reach the selected-context gate"); tests++;
    receipt(foreignFile, url); fs.appendFileSync(foreignFile, "changed bytes");
    assert.equal(await recoverProductPhotoRegion(invalidInput, { ...dependencies, download: async () => foreignFile }), null);
    assert.equal(invalidSourceReviews, 0, "receipt SHA mismatch cannot bind a photo"); tests++;
    let unknownDownloads = 0;
    await assert.rejects(recoverProductPhotoRegion({ ...invalidInput, sourceImageUrls: sixUrls }, { ...dependencies,
      download: async () => { unknownDownloads++; throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }); },
    }), /fetch failed/);
    assert.equal(unknownDownloads, 1, "unknown source transport cannot loop over the remaining URLs"); tests++;
    let quotaChecks = 0;
    await assert.rejects(recoverProductPhotoRegion({ ...input, outputDir: warm, sourceImageUrls: sixUrls, acceptSourcePhoto: async () => {
      quotaChecks++; throw Object.assign(new Error("You’ve hit your usage limit."), { code: "CODEX_USAGE_LIMIT_REACHED" });
    } }, dependencies), /usage limit/);
    assert.equal(quotaChecks, 1, "shared provider failure stops before later candidates"); tests++;
    const sourceBeforeMutation = fs.readFileSync(original);
    await assert.rejects(recoverProductPhotoRegion({ ...input, acceptSourcePhoto: async () => false }, { ...dependencies,
      review: async () => { fs.appendFileSync(original, "changed during source review"); return JSON.stringify({ regions: [first] }); },
    }), /PREWRITING_PHOTO_CHANGED/);
    fs.writeFileSync(original, sourceBeforeMutation); tests++;
    await assert.rejects(recoverProductPhotoRegion(input, { ...dependencies,
      verify: async files => { fs.appendFileSync(files[0], "changed during coarse review"); return files[0]; },
    }), /PREWRITING_PHOTO_CHANGED/);
    // Restore only the isolated test crop so later immutability tests begin from intact bytes.
    fs.writeFileSync(selected, await sharp(original).extract({ left: 172, top: 86, width: 430, height: 688 }).png().toBuffer()); tests++;
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
      tests++;
    }
    await assert.rejects(recoverProductPhotoRegion(input, { ...dependencies, review: async () => "not JSON" }), /해석/);
    await assert.rejects(recoverProductPhotoRegion(input, { ...dependencies, verify: async () => { throw new Error("AUTH_FAILED"); } }), /AUTH_FAILED/);
    let created = 0;
    await recoverProductPhotoRegion({ ...input, onCreated: () => { created++; } }, dependencies);
    assert.equal(created, 0, "the identical content-addressed crop is reused without overwriting it"); tests++;
    const corrupt = path.join(dir, path.basename(selected));
    fs.writeFileSync(corrupt, "fixture-corrupt-existing-file");
    await assert.rejects(recoverProductPhotoRegion(input, dependencies), /EEXIST/);
    assert.equal(fs.readFileSync(corrupt, "utf8"), "fixture-corrupt-existing-file", "an existing mismatched crop is never overwritten"); tests++;
    const gallery = "https://shop-phinf.pstatic.net/gallery.png?type=f40";
    const recommendation = "https://shop-phinf.pstatic.net/other.jpg?type=w860";
    assert.equal(prioritizeImageCandidates([
      { url: recommendation, source: "dom", width: 860, height: 860 },
      { url: gallery, source: "gallery", width: 40, height: 40 },
    ])[0], gallery.replace("f40", "w860"), "lazy gallery images precede unrelated loaded recommendations");
    console.log(`PASS: ${tests} source/crop recovery cases; exact selected-context gate, sixth seller original, immutable pixels, bounded duplicates and terminal failures`);
  } finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

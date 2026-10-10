/** Offline lineage regressions; a gallery receipt never grants visual identity approval. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { readSelectedGalleryComparisons } from "./lib/selected-gallery-comparison";

const digest = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const productId = "selected-gallery-fixture";
const urls = [1, 2, 3, 4].map(index => `https://shop-phinf.pstatic.net/selected-kit-${index}.png?type=original`);
const snapshot = (referenceImageUrls = urls, product: Record<string, unknown> = {}) => createProductSnapshot({
  productId, connectKind: "SHOPPING", externalProductId: "selected-external-kit",
  sourceUrl: "https://smartstore.naver.com/fixture/products/1234567890",
  product: { name: "선택 토너·세럼·크림 키트", features: ["토너, 세럼, 크림 구성"], ...product, referenceImageUrls },
});

async function main() {
  const temporaryParent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryParent, "selected-gallery-comparison-"));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0, checks = 0, sequence = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("No network calls in selected-gallery fixtures"); };
  const test = async (name: string, run: () => Promise<void>) => {
    await run(); checks++; console.log(`PASS ${name}`);
  };
  const fixture = () => {
    const directory = path.join(root, String(++sequence));
    fs.mkdirSync(directory);
    return directory;
  };
  const saved = (directory: string, name: string, bytes: Buffer, sourceUrl = urls[0], patch: Record<string, unknown> = {}) => {
    const file = path.join(directory, name.endsWith(".gif") ? name : `${name}.png`), receiptPath = `${file}.retrieval.json`;
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(receiptPath, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl,
      sha256: digest(bytes), retrievedAt: new Date(Date.now() - 1000).toISOString(), identityVerified: false, rightsGranted: false, ...patch }));
    return { file, receiptPath };
  };
  const read = (sourceDirectory: string, selectedSnapshot: unknown = snapshot(), maximum?: number) =>
    readSelectedGalleryComparisons({ snapshot: selectedSnapshot, productId, sourceDirectory, maximum });
  const directoryBytes = (directory: string) => fs.readdirSync(directory).sort().map(name =>
    [name, fs.readFileSync(path.join(directory, name)).toString("base64")]);
  try {
    const [blue, green, red, gold] = await Promise.all(["#2255aa", "#33aa55", "#aa3322", "#cc9922"].map(background =>
      sharp({ create: { width: 24, height: 24, channels: 3, background } }).png().toBuffer()));
    const animatedGif = await sharp([blue, red], { join: { animated: true } }).gif({ loop: 0 }).toBuffer();
    const staticGif = await sharp(blue).gif().toBuffer();
    assert.equal((await sharp(animatedGif).metadata()).pages, 2, "the animated rejection fixture must contain two actual frames");
    assert.equal((await sharp(staticGif).metadata()).pages ?? 1, 1, "the accepted GIF fixture must contain one actual frame");
    const gifUrl = "https://shop-phinf.pstatic.net/selected-kit-original.gif?type=original";

    await test("exact selected URL and original SHA bind both pixel and receipt bytes", async () => {
      const directory = fixture(), selectedSnapshot = snapshot([urls[0]]);
      const { file, receiptPath } = saved(directory, "selected", blue);
      const before = directoryBytes(directory);
      assert.deepEqual(await read(directory, selectedSnapshot), [{ path: file, sha256: digest(blue), sourceUrl: urls[0],
        sourceSnapshotId: selectedSnapshot.snapshotId, receiptPath, receiptSha256: digest(fs.readFileSync(receiptPath)) }]);
      assert.deepEqual(directoryBytes(directory), before, "reading evidence must not normalize, download or rewrite source files");
    });

    await test("snapshot URL order wins over sorted cached filenames and unrelated receipts", async () => {
      const directory = fixture();
      const first = saved(directory, "z-first", blue, urls[0]);
      const second = saved(directory, "y-second", green, urls[1]);
      saved(directory, "b-third", red, urls[2]);
      saved(directory, "a-unrelated", gold, "https://shop-phinf.pstatic.net/another-product.png", { identityVerified: true });
      assert.deepEqual((await read(directory)).map(row => row.path), [first.file, second.file]);
      assert.deepEqual((await read(directory, snapshot(), 1)).map(row => row.path), [first.file]);
      assert.deepEqual((await read(directory, snapshot(), 99)).map(row => row.path), [first.file, second.file], "maximum cannot exceed two");
      assert((await read(directory, snapshot(), Number.NaN)).length <= 2, "non-finite maximum cannot lift the comparison cap");
    });

    await test("first available selected URLs are used when earlier gallery files are absent", async () => {
      const directory = fixture();
      const third = saved(directory, "third", red, urls[2]);
      const first = saved(directory, "first", blue, urls[0]);
      saved(directory, "second", green, urls[1]);
      const selectedSnapshot = snapshot([urls[3], urls[2], urls[0], urls[1]]);
      assert.deepEqual((await read(directory, selectedSnapshot)).map(row => row.path), [third.file, first.file]);
    });

    for (const [label, firstBytes] of [
      ["animated GIF", animatedGif], ["undecodable original", Buffer.from("not an image, but correctly bound retrieval bytes")],
    ] as Array<[string, Buffer]>) await test(`${label} cannot consume a static comparison slot`, async () => {
      const directory = fixture();
      saved(directory, "first.gif", firstBytes, gifUrl);
      const second = saved(directory, "second-static", green, urls[1]);
      const third = saved(directory, "third-static", red, urls[2]);
      const before = directoryBytes(directory);
      assert.deepEqual((await read(directory, snapshot([gifUrl, urls[1], urls[2]]))).map(row => row.path), [second.file, third.file]);
      assert.deepEqual(directoryBytes(directory), before, "unusable originals and their receipts must remain byte-for-byte intact");
    });

    await test("single-frame GIF is valid comparison evidence without normalization", async () => {
      const directory = fixture(), selectedSnapshot = snapshot([gifUrl]);
      const { file, receiptPath } = saved(directory, "single-frame.gif", staticGif, gifUrl);
      const before = directoryBytes(directory);
      const [selected] = await read(directory, selectedSnapshot);
      assert.equal(selected.path, file);
      assert.equal(selected.sha256, digest(staticGif));
      assert.equal(selected.sourceUrl, gifUrl);
      assert.equal(selected.receiptSha256, digest(fs.readFileSync(receiptPath)));
      assert.deepEqual(directoryBytes(directory), before);
    });

    await test("same URL with different static and animated originals remains ambiguous", async () => {
      const directory = fixture();
      saved(directory, "static-original.gif", staticGif, gifUrl);
      saved(directory, "animated-original.gif", animatedGif, gifUrl);
      const next = saved(directory, "next-static", blue, urls[0]);
      const following = saved(directory, "following-static", green, urls[1]);
      const before = directoryBytes(directory);
      assert.deepEqual((await read(directory, snapshot([gifUrl, urls[0], urls[1]]))).map(row => row.path), [next.file, following.file]);
      assert.deepEqual(directoryBytes(directory), before);
    });

    await test("repeated identical bytes are attached once without starving the next distinct reference", async () => {
      const directory = fixture();
      const first = saved(directory, "first", blue, urls[0]);
      saved(directory, "second-same-pixels", blue, urls[1]);
      const third = saved(directory, "third-distinct", green, urls[2]);
      assert.deepEqual((await read(directory)).map(row => row.path), [first.file, third.file]);
    });

    await test("different recorded originals for one URL stay ambiguous", async () => {
      const directory = fixture();
      saved(directory, "old", blue);
      saved(directory, "new", green);
      assert.deepEqual(await read(directory, snapshot([urls[0]])), []);
    });

    await test("matching hashes and identityVerified cannot borrow another product URL", async () => {
      const directory = fixture();
      saved(directory, "wrong-product", blue, "https://shop-phinf.pstatic.net/other-product.png", { identityVerified: true });
      assert.deepEqual(await read(directory, snapshot([urls[0]])), []);
    });

    await test("query variants are separate retrieval origins", async () => {
      const directory = fixture();
      saved(directory, "resized", blue, urls[0].replace("original", "w860"));
      assert.deepEqual(await read(directory, snapshot([urls[0]])), []);
    });

    for (const sourceUrl of [
      "https://checkout.phinf.pstatic.net/customer-upload.png",
      "https://blogfiles.pstatic.net/customer-photo.png",
      "https://shop-phinf.pstatic.net/reviews/customer-photo.png",
      "https://arbitrary.cloudfront.net/selected-kit.png",
      "http://shop-phinf.pstatic.net/selected-kit.png",
    ]) await test(`non-seller or disallowed URL is not membership evidence: ${sourceUrl}`, async () => {
      const directory = fixture();
      saved(directory, "candidate", blue, sourceUrl, { identityVerified: true });
      assert.deepEqual(await read(directory, snapshot([sourceUrl])), []);
    });

    await test("changed source bytes cannot inherit the old retrieval SHA", async () => {
      const directory = fixture(), { file } = saved(directory, "changed", blue);
      fs.writeFileSync(file, green);
      assert.deepEqual(await read(directory, snapshot([urls[0]])), []);
    });

    for (const patch of [
      { version: "product-image-retrieval/v0" },
      { sourceUrl: urls[1] },
      { sha256: digest(green) },
      { sha256: "not-a-sha" },
      { retrievedAt: "invalid-time" },
      { retrievedAt: null },
      { retrievedAt: "2999-01-01T00:00:00.000Z" },
    ]) await test(`altered retrieval claim is rejected: ${JSON.stringify(patch)}`, async () => {
      const directory = fixture();
      saved(directory, "invalid-receipt", blue, urls[0], patch);
      assert.deepEqual(await read(directory, snapshot([urls[0]])), []);
    });

    await test("malformed or oversized receipt bytes cannot become comparison evidence", async () => {
      const directory = fixture(), { receiptPath } = saved(directory, "corrupt", blue);
      fs.writeFileSync(receiptPath, "{");
      assert.deepEqual(await read(directory), []);
      fs.writeFileSync(receiptPath, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: urls[0], sha256: digest(blue),
        retrievedAt: new Date(Date.now() - 1000).toISOString(), padding: "x".repeat(33 * 1024) }));
      assert.deepEqual(await read(directory), []);
    });

    await test("missing cache and legacy source-only receipts remain empty evidence", async () => {
      assert.deepEqual(await read(path.join(root, "absent-cache")), []);
      const directory = fixture(), file = path.join(directory, `${digest(blue)}.png`);
      fs.writeFileSync(file, blue);
      fs.writeFileSync(`${file}.source.json`, JSON.stringify({ version: "product-photo-source/v1", sourcePath: file,
        sourceSha256: digest(blue), outputSha256: digest(blue), provenance: "LOCKED_PRODUCT", segmented: false }));
      assert.deepEqual(await read(directory), [], "a hash filename and locked-product receipt do not prove selected gallery lineage");
    });

    await test("static derivative cannot use a copied receipt containing the original SHA", async () => {
      const directory = fixture();
      saved(directory, "original-static-derivative", green, urls[0], { sha256: digest(blue) });
      assert.deepEqual(await read(directory, snapshot([urls[0]])), []);
    });

    await test("empty source and missing retrieval timestamp do not pass", async () => {
      const directory = fixture(), { file, receiptPath } = saved(directory, "empty", Buffer.alloc(0));
      assert.deepEqual(await read(directory), []);
      fs.writeFileSync(file, blue);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      receipt.sha256 = digest(blue);
      delete receipt.retrievedAt;
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      assert.deepEqual(await read(directory), []);
    });

    await test("declared invalid snapshot, changed digest and wrong selected product fail closed", async () => {
      const directory = fixture();
      const { file } = saved(directory, "selected", blue);
      const valid = snapshot();
      const invalidSnapshots: unknown[] = [null, {}, { ...valid, version: "brand-product-snapshot/v0" },
        { ...valid, snapshotId: "0".repeat(64) }, { ...valid, product: { ...valid.product, name: "변경된 다른 상품" } },
        createProductSnapshot({ productId, connectKind: "TRAVEL", externalProductId: null, sourceUrl: valid.sourceUrl, product: valid.product })];
      for (const invalid of invalidSnapshots) await assert.rejects(async () => read(directory, invalid), /SELECTED_SOURCE_CONTEXT_INVALID/u);
      for (const selectedProductId of ["", "another-product"]) await assert.rejects(async () =>
        readSelectedGalleryComparisons({ snapshot: valid, productId: selectedProductId, sourceDirectory: directory }), /SELECTED_SOURCE_CONTEXT_INVALID/u);
      for (const sourceDirectory of ["", ".", "relative-cache"]) await assert.rejects(async () =>
        readSelectedGalleryComparisons({ snapshot: valid, productId, sourceDirectory }), /SELECTED_SOURCE_CONTEXT_INVALID/u);
      await assert.rejects(async () => read(file, valid), /SELECTED_SOURCE_CONTEXT_INVALID/u,
        "an existing source file cannot stand in for the selected gallery directory");
    });

    await test("later receipt and source changes are freshly reflected without mutating prior bindings", async () => {
      const directory = fixture(), selectedSnapshot = snapshot([urls[0]]);
      const { file, receiptPath } = saved(directory, "mutable", blue);
      const initial = (await read(directory, selectedSnapshot))[0];
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      receipt.retrievedAt = "2025-01-01T00:00:00.000Z";
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      const changedReceipt = (await read(directory, selectedSnapshot))[0];
      assert.equal(changedReceipt.sha256, initial.sha256);
      assert.notEqual(changedReceipt.receiptSha256, initial.receiptSha256, "unchanged pixels cannot hide receipt mutation");
      receipt.sourceUrl = urls[1];
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      assert.deepEqual(await read(directory, selectedSnapshot), []);
      assert.equal(initial.sourceUrl, urls[0]);
      receipt.sourceUrl = urls[0];
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      fs.writeFileSync(file, green);
      assert.deepEqual(await read(directory, selectedSnapshot), []);
      receipt.sha256 = digest(green);
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      assert.equal((await read(directory, selectedSnapshot))[0].sha256, digest(green), "new lineage is returned for inspection, never treated as identity approval");
      assert.equal(initial.sha256, digest(blue));
      assert.deepEqual(await read(directory, snapshot([urls[1]])), [], "a new selected gallery cannot borrow old source membership");
    });

    const capacityUrl = (filename: string) => `https://shop-phinf.pstatic.net/selected/${filename}?type=original`;
    for (const [label, product, filename] of [
      ["canonical name", { name: "선택 세럼 100ml" }, "serum-100ml.png"],
      ["canonical description and unit case", { description: "세럼 용량 100 ml" }, "serum-100ML.png"],
      ["canonical features and NFKC amount", { features: ["세럼 용량 １００．００ｍｌ"] }, "serum-100.0ml.png"],
      ["decimal litre", { name: "선택 리필 1.5 L" }, "refill-1.500l.png"],
      ["gram", { description: "선택 크림 5 g" }, "cream-5G.png"],
      ["kilogram", { features: ["선택 분말 0.25kg"] }, "powder-0.250kg.png"],
      ["milligram", { name: "선택 시료 10mg" }, "sample-10.0MG.png"],
      ["percent-encoded filename and NFKC unit", { name: "선택 세럼 100ml" }, encodeURIComponent("serum-１００.０ｍＬ.png")],
    ] as Array<[string, Record<string, unknown>, string]>) await test(`supplemental capacity selection uses ${label} only as comparison context`, async () => {
      const directory = fixture(), extraUrl = capacityUrl(filename);
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      const extra = saved(directory, "extra", red, extraUrl);
      const selectedSnapshot = snapshot([urls[0], urls[1], extraUrl], product), before = directoryBytes(directory);
      const selected = await read(directory, selectedSnapshot);
      assert.deepEqual(selected.map(row => row.path), [first.file, second.file, extra.file]);
      assert.equal(selected[2].sourceUrl, extraUrl);
      assert.equal(selected[2].sha256, digest(red));
      assert.equal(selected[2].receiptSha256, digest(fs.readFileSync(extra.receiptPath)));
      assert.equal(selected[2].sourceSnapshotId, selectedSnapshot.snapshotId);
      assert(!("identityVerified" in selected[2]), "a capacity filename can select context but cannot grant visual identity approval");
      assert.deepEqual(directoryBytes(directory), before, "supplemental selection must preserve all original and receipt bytes");
    });

    await test("first two static references remain first and capacity supplement follows canonical gallery order", async () => {
      const directory = fixture(), wrongUrl = capacityUrl("serum-200ml.png"), firstExtraUrl = capacityUrl("serum-100ml-first.png"), laterExtraUrl = capacityUrl("serum-100ml-later.png");
      const first = saved(directory, "z-first", blue, urls[0]), second = saved(directory, "y-second", green, urls[1]);
      saved(directory, "a-wrong-capacity", gold, wrongUrl);
      const extra = saved(directory, "x-first-extra", red, firstExtraUrl);
      const later = saved(directory, "b-later-extra", gold, laterExtraUrl);
      const selectedSnapshot = snapshot([urls[0], urls[1], wrongUrl, firstExtraUrl, laterExtraUrl], { name: "선택 세럼 100ml" });
      assert.deepEqual((await read(directory, selectedSnapshot)).map(row => row.path), [first.file, second.file, extra.file, later.file]);
    });

    for (const [label, extraUrl, product] of [
      ["wrong amount", capacityUrl("serum-200ml.png"), { name: "선택 세럼 100ml" }],
      ["larger amount containing the selected digits", capacityUrl("serum-2100ml.png"), { name: "선택 세럼 100ml" }],
      ["unselected physical unit", capacityUrl("serum-100g.png"), { name: "선택 세럼 100ml" }],
      ["unrequested unit conversion", capacityUrl("serum-0.1L.png"), { name: "선택 세럼 100ml" }],
      ["query only", "https://shop-phinf.pstatic.net/selected/serum.png?capacity=100ml", { name: "선택 세럼 100ml" }],
      ["fragment only", "https://shop-phinf.pstatic.net/selected/serum.png#100ml", { name: "선택 세럼 100ml" }],
      ["directory only", "https://shop-phinf.pstatic.net/100ml/serum.png?type=original", { name: "선택 세럼 100ml" }],
      ["count token", capacityUrl("kit-100ea.png"), { name: "선택 키트 100ea" }],
      ["time token", capacityUrl("serum-100min.png"), { description: "선택 세럼 100min" }],
      ["URL metadata without canonical capacity", capacityUrl("serum-100ml.png"), {}],
      ["arbitrary product field", capacityUrl("serum-100ml.png"), { alternateTitle: "세럼 100ml" }],
      ["quantity synthesized across fields", capacityUrl("serum-100ml.png"), { name: "선택 모델 100", description: "ml units are measurement" }],
      ["quantity synthesized across features", capacityUrl("serum-100ml.png"), { features: ["선택 모델 100", "ml units are measurement"] }],
      ["floating point rounding", capacityUrl("serum-100ml.png"), { name: "선택 세럼 100.000000000000000001ml" }],
    ] as Array<[string, string, Record<string, unknown>]>) await test(`${label} cannot authorize a supplemental capacity reference`, async () => {
      const directory = fixture();
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      saved(directory, "extra", red, extraUrl);
      const before = directoryBytes(directory);
      assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], extraUrl], product))).map(row => row.path), [first.file, second.file]);
      assert.deepEqual(directoryBytes(directory), before);
    });

    await test("supplemental capacity cannot borrow an arbitrary cached URL or disallowed gallery host", async () => {
      const directory = fixture(), unselectedUrl = capacityUrl("unselected-100ml.png"), disallowedUrl = "https://arbitrary.cloudfront.net/selected-100ml.png";
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      saved(directory, "unselected-cache", red, unselectedUrl, { identityVerified: true });
      saved(directory, "disallowed-cache", gold, disallowedUrl, { identityVerified: true });
      assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], disallowedUrl], { name: "선택 세럼 100ml" }))).map(row => row.path), [first.file, second.file]);
    });

    for (const unavailable of ["absent", "animated", "undecodable", "ambiguous"] as const) await test(`${unavailable} capacity supplement is skipped for the next eligible selected URL`, async () => {
      const directory = fixture(), unavailableUrl = capacityUrl(`serum-100ml-${unavailable}.${unavailable === "animated" ? "gif" : "png"}`), laterUrl = capacityUrl("serum-100ml-later.png");
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      if (unavailable === "animated") saved(directory, "animated.gif", animatedGif, unavailableUrl);
      if (unavailable === "undecodable") saved(directory, "undecodable", Buffer.from("intact receipt, undecodable supplemental original"), unavailableUrl);
      if (unavailable === "ambiguous") {
        saved(directory, "ambiguous-old", red, unavailableUrl);
        saved(directory, "ambiguous-new", gold, unavailableUrl);
      }
      const later = saved(directory, "later", gold, laterUrl), before = directoryBytes(directory);
      assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], unavailableUrl, laterUrl], { name: "선택 세럼 100ml" }))).map(row => row.path), [first.file, second.file, later.file]);
      assert.deepEqual(directoryBytes(directory), before);
    });

    await test("supplemental SHA deduplication does not starve a later distinct capacity reference", async () => {
      const directory = fixture(), duplicateUrl = capacityUrl("serum-100ml-duplicate.png"), laterUrl = capacityUrl("serum-100ml-distinct.png");
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      saved(directory, "duplicate", blue, duplicateUrl);
      const later = saved(directory, "later", red, laterUrl);
      assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], duplicateUrl, laterUrl], { name: "선택 세럼 100ml" }))).map(row => row.path), [first.file, second.file, later.file]);
    });

    await test("explicit maxima remain bounded and capacity context never exceeds four attachments", async () => {
      const directory = fixture(), extraUrl = capacityUrl("serum-100ml-first.png"), fourthUrl = capacityUrl("serum-100ml-fourth.png");
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      const extra = saved(directory, "extra", red, extraUrl);
      const fourth = saved(directory, "fourth", gold, fourthUrl);
      const selectedSnapshot = snapshot([urls[0], urls[1], extraUrl, fourthUrl], { name: "선택 세럼 100ml" }), before = directoryBytes(directory);
      assert.deepEqual((await read(directory, selectedSnapshot, 1)).map(row => row.path), [first.file]);
      assert.deepEqual((await read(directory, selectedSnapshot, 2)).map(row => row.path), [first.file, second.file]);
      assert.deepEqual((await read(directory, selectedSnapshot, 3)).map(row => row.path), [first.file, second.file, extra.file]);
      for (const maximum of [undefined, 4, 99, Number.NaN, Number.POSITIVE_INFINITY])
        assert.deepEqual((await read(directory, selectedSnapshot, maximum)).map(row => row.path), [first.file, second.file, extra.file, fourth.file]);
      assert.deepEqual(directoryBytes(directory), before);
    });

    assert.equal(networkCalls, 0);
    console.log(`Selected gallery comparison: ${checks} offline cases passed; no network or provider calls.`);
  } finally {
    globalThis.fetch = originalFetch;
    const cleanupTarget = path.resolve(root);
    assert(cleanupTarget.startsWith(`${temporaryParent}${path.sep}`) && path.basename(cleanupTarget).startsWith("selected-gallery-comparison-"),
      "recursive fixture cleanup must stay inside the intended temporary directory");
    fs.rmSync(cleanupTarget, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

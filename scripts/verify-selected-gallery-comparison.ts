/** Offline lineage regressions; a gallery receipt never grants visual identity approval. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { readSelectedGalleryComparisons, readPublicationIdentifierReferenceBindings } from "./lib/selected-gallery-comparison";

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

    await test("exact publication source adds one canonical original without granting identity or borrowing arbitrary bytes", async () => {
      const directory = fixture(), originalUrl = urls[2], extra1 = capacityUrl("selected-100ml-first.png"), extra2 = capacityUrl("selected-100ml-second.png");
      const fifthBytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#993388" } }).png().toBuffer();
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      const original = saved(directory, "actual-original", red, originalUrl);
      const qty1 = saved(directory, "qty1", gold, extra1), qty2 = saved(directory, "qty2", fifthBytes, extra2);
      const selectedSnapshot = snapshot([urls[0], urls[1], originalUrl, extra1, extra2], { name: "selected 100ml" });
      const bound = (maximum?: number, publicationOriginalSha256 = digest(red), selected = selectedSnapshot) =>
        readSelectedGalleryComparisons({ snapshot: selected, productId, sourceDirectory: directory, maximum, publicationOriginalSha256 });
      assert.deepEqual((await bound()).map(row => row.path), [first.file, second.file, original.file, qty1.file, qty2.file]);
      for (const maximum of [1, 2, 3, 4, 5, 99]) assert.equal((await bound(maximum)).length, Math.min(maximum, 5));
      assert.deepEqual((await bound(undefined, digest(blue))).map(row => row.path), [first.file, second.file, qty1.file, qty2.file]);
      assert.deepEqual((await bound(undefined, "f".repeat(64))).map(row => row.path), [first.file, second.file, qty1.file, qty2.file]);
      const thirdQtyUrl = capacityUrl("selected-100ml-third.png");
      saved(directory, "third-qty", red, thirdQtyUrl);
      const overlapSnapshot = snapshot([urls[0], urls[1], originalUrl, extra1, extra2, thirdQtyUrl], { name: "selected 100ml" });
      assert.deepEqual((await bound(undefined, digest(gold), overlapSnapshot)).map(row => row.path), [first.file, second.file, qty1.file, qty2.file],
        "an ORIGINAL already in the two quantity contexts must not add a third quantity attachment");
      assert.deepEqual((await bound(undefined, digest(red), snapshot([urls[0], urls[1], extra1, extra2], { name: "selected 100ml" }))).map(row => row.path), [first.file, second.file, qty1.file, qty2.file]);
      saved(directory, "conflicting-original", fifthBytes, originalUrl);
      assert.deepEqual((await bound()).map(row => row.path), [first.file, second.file, qty1.file, qty2.file]);
    });

    const portrait = (width: number, height: number, background: string) =>
      sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
    await test("one bounded portrait detail fills a spare slot without filename or SKU authority", async () => {
      const directory = fixture(), detailUrl = capacityUrl("arbitrary-detail.png");
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      const detail = saved(directory, "detail", await portrait(80, 264, "#925533"), detailUrl);
      const selectedSnapshot = snapshot([urls[0], urls[1], detailUrl]), before = directoryBytes(directory);
      const selected = await read(directory, selectedSnapshot);
      assert.deepEqual(selected.map(row => row.path), [first.file, second.file, detail.file]);
      assert.equal(selected[2].receiptSha256, digest(fs.readFileSync(detail.receiptPath)));
      assert.equal(selected[2].sourceSnapshotId, selectedSnapshot.snapshotId);
      assert(!("identityVerified" in selected[2]) && !("accepted" in selected[2]), "geometry discovers unverified comparison context only");
      assert.deepEqual(directoryBytes(directory), before);
    });

    await test("detail ranking uses bounded aspect then canonical order and adds only one", async () => {
      const directory = fixture(), detailUrls = ["short", "best", "tied", "overlong"].map(name => capacityUrl(`${name}.png`));
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      saved(directory, "a-short", await portrait(80, 120, "#331122"), detailUrls[0]);
      const best = saved(directory, "z-best", await portrait(80, 264, "#925533"), detailUrls[1]);
      saved(directory, "b-tied", await portrait(80, 264, "#119955"), detailUrls[2]);
      saved(directory, "overlong", await portrait(80, 4097, "#335599"), detailUrls[3]);
      const selected = await read(directory, snapshot([urls[0], urls[1], ...detailUrls]));
      assert.deepEqual(selected.map(row => row.path), [first.file, second.file, best.file]);
      assert.equal((await read(directory, snapshot([urls[0], urls[1], ...detailUrls]), 2)).length, 2);
    });

    await test("detail never displaces later quantity or exact publication original priorities", async () => {
      const directory = fixture(), detailUrl = capacityUrl("detail.png"), qty1Url = capacityUrl("one-100ml.png"), qty2Url = capacityUrl("two-100ml.png");
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      saved(directory, "early-detail", await portrait(80, 264, "#925533"), detailUrl);
      const qty1 = saved(directory, "qty1", red, qty1Url), qty2 = saved(directory, "qty2", gold, qty2Url);
      const originalBytes = await portrait(48, 48, "#993388"), original = saved(directory, "last-original", originalBytes, urls[2]);
      const selectedSnapshot = snapshot([urls[0], urls[1], detailUrl, qty1Url, qty2Url, urls[2]], { name: "selected 100ml" });
      const selected = await readSelectedGalleryComparisons({ snapshot: selectedSnapshot, productId, sourceDirectory: directory,
        publicationOriginalSha256: digest(originalBytes) });
      assert.deepEqual(selected.map(row => row.path), [first.file, second.file, qty1.file, qty2.file, original.file]);
      assert.equal(selected.length, 5);
    });

    for (const invalid of ["foreign", "ambiguous", "changed-pixels", "changed-receipt", "animated", "broken"] as const)
      await test(`detail discovery preserves lineage and decoding rejection: ${invalid}`, async () => {
        const directory = fixture(), detailUrl = capacityUrl("detail.png"), fallbackUrl = capacityUrl("fallback.png");
        const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
        const detailBytes = await portrait(80, 264, "#925533");
        const bytes = invalid === "animated" ? await sharp([detailBytes, await portrait(80, 264, "#119955")], { join: { animated: true } }).gif().toBuffer()
          : invalid === "broken" ? Buffer.from("not static pixels") : detailBytes;
        if (invalid === "animated") assert.equal((await sharp(bytes, { animated: true }).metadata()).pages, 2);
        const detail = saved(directory, invalid === "animated" ? "detail.gif" : "detail", bytes,
          invalid === "foreign" ? capacityUrl("foreign-not-current.png") : detailUrl);
        if (invalid === "ambiguous") saved(directory, "another-original", await portrait(80, 264, "#119955"), detailUrl);
        if (invalid === "changed-pixels") fs.writeFileSync(detail.file, await portrait(80, 264, "#119955"));
        if (invalid === "changed-receipt") fs.writeFileSync(detail.receiptPath, "{");
        const fallback = saved(directory, "fallback", await portrait(80, 160, "#112299"), fallbackUrl), before = directoryBytes(directory);
        assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], detailUrl, fallbackUrl]))).map(row => row.path),
          [first.file, second.file, fallback.file]);
        assert.deepEqual(directoryBytes(directory), before);
      });

    await test("detail byte and receipt changes after discovery cannot inherit the earlier binding", async () => {
      for (const change of ["pixels", "receipt"] as const) {
        const directory = fixture(), detailUrl = capacityUrl("detail.png");
        const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
        const detail = saved(directory, "detail", await portrait(80, 264, "#925533"), detailUrl);
        const replacement = await portrait(80, 264, "#119955"), originalRead = fs.readFileSync;
        let detailReads = 0;
        fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
          const bytes = Reflect.apply(originalRead, fs, args);
          if (String(args[0]) === detail.file && ++detailReads === 2) {
            if (change === "pixels") fs.writeFileSync(detail.file, replacement);
            else fs.writeFileSync(detail.receiptPath, `${originalRead(detail.receiptPath, "utf8")} `);
          }
          return bytes;
        }) as typeof fs.readFileSync;
        try {
          assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], detailUrl]))).map(row => row.path), [first.file, second.file]);
          assert(detailReads >= 3, "mutation must occur after metadata discovery and before adoption");
        } finally { fs.readFileSync = originalRead; }
      }
    });

    await test("detail selection retains canonical twenty-URL cap and accepts the 4096 boundary", async () => {
      const directory = fixture(), gallery = Array.from({ length: 21 }, (_, index) => capacityUrl(`canonical-${index}.png`));
      const first = saved(directory, "first", blue, gallery[0]), second = saved(directory, "second", green, gallery[1]);
      saved(directory, "outside-twenty", await portrait(80, 264, "#925533"), gallery[20]);
      assert.deepEqual((await read(directory, snapshot(gallery))).map(row => row.path), [first.file, second.file]);
      const boundary = saved(directory, "boundary", await portrait(80, 4096, "#119955"), gallery[19]);
      assert.deepEqual((await read(directory, snapshot(gallery))).map(row => row.path), [first.file, second.file, boundary.file]);
    });

    await test("an individually untransportable detail is not added or allowed to hide a usable detail", async () => {
      const directory = fixture(), largeUrl = capacityUrl("large.png"), fallbackUrl = capacityUrl("small.png");
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      const noisy = await sharp(crypto.randomBytes(1600 * 2048 * 3), { raw: { width: 1600, height: 2048, channels: 3 } }).png().toBuffer();
      assert(noisy.length > 8 * 1024 * 1024);
      saved(directory, "untransportable", noisy, largeUrl);
      const fallback = saved(directory, "fallback", await portrait(80, 96, "#112299"), fallbackUrl);
      assert.deepEqual((await read(directory, snapshot([urls[0], urls[1], largeUrl, fallbackUrl]))).map(row => row.path),
        [first.file, second.file, fallback.file]);
    });

    await test("identifier own-primary receipt survives the optional-gallery shortlist without rewriting evidence", async () => {
      const directory = fixture(), selectedSnapshot = snapshot();
      const first = saved(directory, "first", blue, urls[0]), second = saved(directory, "second", green, urls[1]);
      const own = saved(directory, "own", red, urls[3]), copy = path.join(root, "exact-own-copy.png"); fs.writeFileSync(copy, red);
      assert.deepEqual((await read(directory, selectedSnapshot)).map(row => row.path), [first.file, second.file]);
      const before = directoryBytes(directory), bound = await readPublicationIdentifierReferenceBindings({ snapshot: selectedSnapshot,
        productId, sourceDirectory: directory, primaryReference: { path: copy, sha256: digest(red) } });
      assert.deepEqual(bound.map(row => row.path), [first.file, second.file, own.file]);
      assert.equal(bound.at(-1)!.sourceSnapshotId, selectedSnapshot.snapshotId);
      assert.equal(bound.at(-1)!.receiptSha256, digest(fs.readFileSync(own.receiptPath)));
      assert.deepEqual(directoryBytes(directory), before);
    });
    await test("unreceipted, ambiguous or off-snapshot primaries never acquire another source's snapshot", async () => {
      for (const kind of ["missing", "ambiguous", "off-snapshot", "forged-sha"] as const) {
        const directory = fixture(), selectedSnapshot = snapshot();
        saved(directory, "first", blue, urls[0]); saved(directory, "second", green, urls[1]);
        if (kind !== "missing") saved(directory, "own", red, kind === "off-snapshot" ? "https://shop-phinf.pstatic.net/unselected.png" : urls[3],
          kind === "forged-sha" ? { sha256: digest(gold) } : {});
        if (kind === "ambiguous") saved(directory, "ambiguous", gold, urls[3]);
        const copy = path.join(root, `unbound-${kind}.png`); fs.writeFileSync(copy, red);
        const bound = await readPublicationIdentifierReferenceBindings({ snapshot: selectedSnapshot, productId, sourceDirectory: directory,
          primaryReference: { path: copy, sha256: digest(red) } });
        assert(!bound.some(row => row.sha256 === digest(red)), kind);
      }
    });
    await test("a changed own-primary copy fails instead of borrowing a valid canonical receipt", async () => {
      const directory = fixture(); saved(directory, "own", red, urls[3]);
      const copy = path.join(root, "changed-own-copy.png"); fs.writeFileSync(copy, gold);
      await assert.rejects(readPublicationIdentifierReferenceBindings({ snapshot: snapshot(), productId, sourceDirectory: directory,
        primaryReference: { path: copy, sha256: digest(red) } }), /SELECTED_SOURCE_CONTEXT_INVALID/u);
    });
    await test("own-primary binding preserves the five-source ceiling and deduplicates exact originals", async () => {
      const directory = fixture(), gallery = [urls[0], urls[1], capacityUrl("serum-100ml.png"), capacityUrl("toner-180ml.png"), urls[3], capacityUrl("published.png")];
      const colors = [blue, green, red, gold, await portrait(24, 24, "#1199aa"), await portrait(24, 24, "#7711aa")];
      const files = gallery.map((url, index) => saved(directory, `source-${index}`, colors[index], url));
      const selectedSnapshot = snapshot(gallery, { features: ["세럼 100ml", "토너 180ml"] });
      const bound = await readPublicationIdentifierReferenceBindings({ snapshot: selectedSnapshot, productId, sourceDirectory: directory,
        publicationOriginalSha256: digest(colors[5]), primaryReference: { path: files[4].file, sha256: digest(colors[4]) } });
      assert.equal(bound.length, 5); assert.equal(new Set(bound.map(row => row.sha256)).size, 5);
      assert.equal(bound.at(-1)!.sha256, digest(colors[4]));
    });
    const sceneFixture = async (full = false) => {
      const packageDir = fixture(), sourceDirectory = path.join(packageDir, "product-sources"); fs.mkdirSync(sourceDirectory);
      const gallery = [urls[0], urls[1], capacityUrl("scene-detail.png"), urls[3], capacityUrl("scene-macro.png"),
        ...(full ? [capacityUrl("extra-one-100ml.png"), capacityUrl("extra-two-100ml.png")] : [])];
      const selectedSnapshot = snapshot(gallery, full ? { features: ["선택 용량 100ml"] } : {});
      const first = saved(sourceDirectory, "first", blue, gallery[0]), second = saved(sourceDirectory, "second", green, gallery[1]);
      const detail = saved(sourceDirectory, "detail", await portrait(48, 144, "#335577"), gallery[2]);
      const own = saved(sourceDirectory, "own", red, gallery[3]), macro = saved(sourceDirectory, "macro", gold, gallery[4]);
      if (full) {
        saved(sourceDirectory, "extra-one", await portrait(24, 24, "#2299aa"), gallery[5]);
        saved(sourceDirectory, "extra-two", await portrait(24, 24, "#aa9922"), gallery[6]);
      }
      const candidatePath = path.join(packageDir, "candidate.png"), candidateBytes = await portrait(24, 24, "#7711aa");
      fs.writeFileSync(candidatePath, candidateBytes); const candidateSha256 = digest(candidateBytes);
      const primaryReference = { path: own.file, sha256: digest(red) };
      const canonicalReferences = [primaryReference, { path: macro.file, sha256: digest(gold) }]
        .map(reference => ({ ...reference, sourceSnapshotId: selectedSnapshot.snapshotId }));
      const hashJson = (value: unknown) => digest(Buffer.from(JSON.stringify(value)));
      const request = { imagePaths: [primaryReference.sha256, candidateSha256, digest(gold)] }, rawResponse = "offline scene response";
      const scopeGate = { kind: "scene-native-positive/v1", nativeExecution: true, request, requestSha256: hashJson(request),
        rawResponse, responseSha256: digest(Buffer.from(rawResponse)) };
      const input = { candidatePath, candidateSha256, primaryReference, canonicalReferences, scopeGate };
      const result = { status: "unverified", context: { candidateSha256, primaryReferenceImageIndex: 2,
        primaryReferenceSha256: primaryReference.sha256, scopeGateSha256: hashJson(scopeGate),
        references: canonicalReferences.map((reference, index) => ({ imageIndex: index + 2, sha256: reference.sha256,
          sourceSnapshotId: reference.sourceSnapshotId })) } };
      const asset = { path: candidatePath, sha256: candidateSha256, role: "body", provenance: "GENERATED_SCENE",
        creationMethod: "reference-guided-scene", remoteGenerated: true, referenceScene: { reviewStatus: "passed",
          reviewedOutputSha256: candidateSha256, sourceSnapshotId: selectedSnapshot.snapshotId, referenceSha256: primaryReference.sha256,
          referencePath: primaryReference.path, printObservationWarning: { input, result } } };
      const manifest = { brandLinkId: productId, sourceSnapshot: selectedSnapshot, imageAssets: [asset] };
      const manifestPath = path.join(packageDir, "manifest.json"), write = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest)); write();
      const options = { snapshot: selectedSnapshot, productId, sourceDirectory, candidateSha256, primaryReference };
      return { packageDir, sourceDirectory, first, second, detail, own, macro, input, result, asset, manifest, manifestPath, write, options };
    };
    await test("completed scene retains its exact canonical macro in a spare final-review slot", async () => {
      const f = await sceneFixture(), before = directoryBytes(f.sourceDirectory), manifestBefore = fs.readFileSync(f.manifestPath);
      const bound = await readPublicationIdentifierReferenceBindings(f.options);
      assert.deepEqual(bound.map(row => row.path), [f.first.file, f.second.file, f.detail.file, f.macro.file, f.own.file]);
      assert(bound.every(row => !("accepted" in row) && !("literal" in row) && !("nativeExecution" in row)), "only current canonical discovery bindings are returned");
      assert.deepEqual(fs.readFileSync(f.manifestPath), manifestBefore); assert.deepEqual(directoryBytes(f.sourceDirectory), before);
      f.result.status = "hold"; f.write();
      assert((await readPublicationIdentifierReferenceBindings(f.options)).some(row => row.path === f.macro.file), "a prior verdict is never reused as current approval authority");
    });
    for (const invalid of ["candidate", "candidate-bytes", "candidate-path-missing", "asset-path-foreign", "duplicate-asset", "primary", "primary-path", "snapshot", "snapshot-content", "reference-snapshot", "reference-path", "reference-bytes", "reference-missing", "reference-receipt", "reference-ambiguous", "context", "request-hash", "scope-hash"] as const)
      await test(`scene discovery rejects stale or changed bindings: ${invalid}`, async () => {
        const f = await sceneFixture();
        switch (invalid) {
          case "candidate": f.input.candidateSha256 = "a".repeat(64); break;
          case "candidate-bytes": fs.writeFileSync(f.asset.path, green); break;
          case "candidate-path-missing": f.input.candidatePath = path.join(f.packageDir, "missing.png"); break;
          case "asset-path-foreign": { const file = path.join(root, "foreign-candidate.png"); fs.copyFileSync(f.asset.path, file); f.asset.path = file; break; }
          case "duplicate-asset": f.manifest.imageAssets.push(structuredClone(f.asset)); break;
          case "primary": f.asset.referenceScene.referenceSha256 = "a".repeat(64); break;
          case "primary-path": f.asset.referenceScene.referencePath = f.second.file; break;
          case "snapshot": f.asset.referenceScene.sourceSnapshotId = "a".repeat(64); break;
          case "snapshot-content": f.manifest.sourceSnapshot = { ...f.manifest.sourceSnapshot, product: { ...f.manifest.sourceSnapshot.product, name: "다른 상품" } }; break;
          case "reference-snapshot": f.input.canonicalReferences[1].sourceSnapshotId = "a".repeat(64); break;
          case "reference-path": { const file = path.join(root, "foreign-macro.png"); fs.copyFileSync(f.macro.file, file); f.input.canonicalReferences[1].path = file; break; }
          case "reference-bytes": fs.writeFileSync(f.macro.file, green); break;
          case "reference-missing": fs.unlinkSync(f.macro.file); break;
          case "reference-receipt": fs.writeFileSync(f.macro.receiptPath, "{"); break;
          case "reference-ambiguous": saved(f.sourceDirectory, "other-macro", red, JSON.parse(fs.readFileSync(f.macro.receiptPath, "utf8")).sourceUrl); break;
          case "context": f.result.context.references[1].sha256 = "a".repeat(64); break;
          case "request-hash": f.input.scopeGate.requestSha256 = "a".repeat(64); break;
          case "scope-hash": f.result.context.scopeGateSha256 = "a".repeat(64); break;
        }
        f.write();
        assert(!(await readPublicationIdentifierReferenceBindings(f.options)).some(row => row.sha256 === digest(gold)), invalid);
      });
    await test("scene discovery cannot displace existing canonical priorities at the five-reference ceiling", async () => {
      const f = await sceneFixture(true), bound = await readPublicationIdentifierReferenceBindings(f.options);
      assert.equal(bound.length, 5); assert.equal(bound.at(-1)!.path, f.own.file);
      assert.deepEqual(bound.slice(0, 2).map(row => row.path), [f.first.file, f.second.file]);
      assert(!bound.some(row => row.path === f.macro.file));
    });
    await test("scene discovery rechecks the frozen manifest after awaiting current source decoding", async () => {
      const f = await sceneFixture(), originalRead = fs.readFileSync; let changed = false, captured = false;
      fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
        const bytes = Reflect.apply(originalRead, fs, args);
        if (String(args[0]) === f.manifestPath) captured = true;
        if (captured && !changed && String(args[0]) === f.macro.receiptPath) { changed = true; fs.appendFileSync(f.manifestPath, " "); }
        return bytes;
      }) as typeof fs.readFileSync;
      try { assert(!(await readPublicationIdentifierReferenceBindings(f.options)).some(row => row.path === f.macro.file)); assert(changed); }
      finally { fs.readFileSync = originalRead; }
    });
    await test("a later scene hint cannot leave earlier hints or originals stale across its await", async () => {
      for (const changedInput of ["manifest", "earlier-hint", "base", "own"] as const) {
        const f = await sceneFixture(), secondBytes = await portrait(24, 24, "#9988aa");
        const secondUrl = JSON.parse(fs.readFileSync(f.detail.receiptPath, "utf8")).sourceUrl;
        saved(f.sourceDirectory, "detail", secondBytes, secondUrl);
        f.input.canonicalReferences.push({ path: f.detail.file, sha256: digest(secondBytes), sourceSnapshotId: f.options.snapshot.snapshotId });
        f.input.scopeGate.request.imagePaths.push(digest(secondBytes));
        f.input.scopeGate.requestSha256 = digest(Buffer.from(JSON.stringify(f.input.scopeGate.request)));
        f.result.context.scopeGateSha256 = digest(Buffer.from(JSON.stringify(f.input.scopeGate)));
        f.result.context.references.push({ imageIndex: 4, sha256: digest(secondBytes), sourceSnapshotId: f.options.snapshot.snapshotId }); f.write();
        const originalRead = fs.readFileSync; let captured = false, laterReads = 0;
        fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
          const bytes = Reflect.apply(originalRead, fs, args);
          if (String(args[0]) === f.manifestPath) captured = true;
          if (captured && String(args[0]) === f.detail.receiptPath && ++laterReads === 2) {
            if (changedInput === "manifest") fs.appendFileSync(f.manifestPath, " ");
            else fs.writeFileSync(changedInput === "earlier-hint" ? f.macro.file : changedInput === "base" ? f.first.file : f.own.file, green);
          }
          return bytes;
        }) as typeof fs.readFileSync;
        try {
          if (changedInput === "own") await assert.rejects(readPublicationIdentifierReferenceBindings(f.options), /SELECTED_SOURCE_CONTEXT_INVALID/u);
          else {
            const bound = await readPublicationIdentifierReferenceBindings(f.options);
            assert(!bound.some(row => row.path === (changedInput === "base" ? f.first.file : f.macro.file)), changedInput);
          }
          assert(laterReads >= 2, "mutation must occur after the earlier hint was adopted");
        } finally { fs.readFileSync = originalRead; }
      }
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

/** Actual downloader with local fixture pixels and mocked fetch; no provider or live data. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadProductSourcePhoto, collectShoppingProductSourceCandidates, PRODUCT_SOURCE_RECEIPT_TTL_MS } from "./lib/product-photo-source";
import sharp from "sharp";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-receipt-stability-"));
  const originalFetch = globalThis.fetch;
  const url = "https://shop-phinf.pstatic.net/fixture/product.png";
  const originalPixels = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#888888" } }).png().toBuffer();
  const differentPixels = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#444444" } }).png().toBuffer();
  let pixels = originalPixels, calls = 0, checks = 0;
  globalThis.fetch = async () => { calls++; return new Response(new Uint8Array(pixels), { headers: { "content-type": "image/png" } }); };
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  try {
    const file = await downloadProductSourcePhoto(url, root);
    const receiptPath = `${file}.retrieval.json`, observationPath = `${file}.retrieval-observation.json`;
    const expired = { ...JSON.parse(fs.readFileSync(receiptPath, "utf8")), retrievedAt: new Date(Date.now() - PRODUCT_SOURCE_RECEIPT_TTL_MS - 1000).toISOString() };
    fs.writeFileSync(receiptPath, JSON.stringify(expired));
    const before = fs.readFileSync(receiptPath), pixelHash = hash(file);
    assert.equal(await downloadProductSourcePhoto(url, root), file);
    assert.deepEqual(fs.readFileSync(receiptPath), before, "same URL/pixels must preserve an already bound receipt, including retrievedAt");
    assert.equal(hash(file), pixelHash);
    const observation = JSON.parse(fs.readFileSync(observationPath, "utf8"));
    assert.equal(observation.receiptSha256, hash(receiptPath));
    assert.ok(Date.parse(observation.observedAt) > Date.parse(expired.retrievedAt)); checks += 5;
    const downloadsBeforeCache = calls;
    assert.deepEqual(await collectShoppingProductSourceCandidates({ localCandidates: [], sourceImageUrls: [url], outputDir: root,
      preferSourceImageUrls: true }), [file]);
    assert.equal(calls, downloadsBeforeCache, "new observation keeps retrieval warm without rewriting the historical receipt"); checks += 2;
    const stableObservation = fs.readFileSync(observationPath);
    await assert.rejects(downloadProductSourcePhoto("https://shop-phinf.pstatic.net/fixture/other.png", root), /PRODUCT_SOURCE_PROVENANCE_CONFLICT/);
    assert.deepEqual(fs.readFileSync(receiptPath), before, "a new URL cannot replace the provenance bound to these same pixels");
    assert.deepEqual(fs.readFileSync(observationPath), stableObservation); checks += 3;
    pixels = differentPixels;
    const changedFile = await downloadProductSourcePhoto(url, root);
    assert.notEqual(changedFile, file, "different bytes produce a separate content-addressed source and receipt");
    assert.equal(hash(file), pixelHash); assert.deepEqual(fs.readFileSync(receiptPath), before); checks += 3;
    pixels = originalPixels;
    fs.writeFileSync(observationPath, JSON.stringify({ ...observation, receiptSha256: "0".repeat(64) }));
    const beforeInvalidCache = calls;
    await collectShoppingProductSourceCandidates({ localCandidates: [], sourceImageUrls: [url], outputDir: root, forceRefresh: true });
    assert.ok(calls > beforeInvalidCache, "force refresh still reaches the seller; immutability is not a permanent retrieval cache");
    assert.deepEqual(fs.readFileSync(receiptPath), before); checks += 2;
    fs.writeFileSync(receiptPath, JSON.stringify({ ...expired, rightsGranted: true }));
    const invalidReceipt = fs.readFileSync(receiptPath);
    await assert.rejects(downloadProductSourcePhoto(url, root), /PRODUCT_SOURCE_PROVENANCE_CONFLICT/);
    assert.deepEqual(fs.readFileSync(receiptPath), invalidReceipt, "unexpected authority flags are never silently repaired"); checks += 2;
    console.log(`source receipt stability: ${checks} checks passed; live network/provider calls 0`);
  } finally {
    globalThis.fetch = originalFetch;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

/** Offline exact-pixel MCP handoff. No network, provider, generation or production data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { attachPreparedDraftOriginal } from "../src/lib/prepared-draft-reference";
import { persistPrewritePhotoForContext, withShoppingPrewritePhoto, writingPhotosFromPrewrite } from "./lib/shopping-prewrite-photos";
const availability = (value: Record<string, unknown>) => value.publicationPhotoAvailability as Record<string, unknown>;
const images = (value: Record<string, unknown>) => value.nativeReferenceImages as Array<{ sha256: string; base64: string }>;

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-mcp-original-"));
  let checks = 0;
  try {
    const imagePath = path.join(directory, "source.png"), contextPath = path.join(directory, "context", "mcp-draft-context.json");
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(512, 9)]);
    const sha256 = createHash("sha256").update(bytes).digest("hex"); fs.writeFileSync(imagePath, bytes);
    const snapshot = createProductSnapshot({ productId: "product_fixture", connectKind: "SHOPPING", externalProductId: "selected-model",
      sourceUrl: "https://seller.example/selected", product: { name: "선택 가습기", description: "분리형 물통", features: ["선택 옵션: 화이트", "물통 용량: 200ml"] } });
    const selected = await withShoppingPrewritePhoto({ snapshot, candidatePaths: [imagePath] }, async proof => proof, {
      select: async files => ({ path: files[0], sourceSha256: sha256, reviewClass: "product-photo", targetIndex: 0, reviewedAt: "now", reason: "확인된 흰색 가습기 원본" }),
    });
    const proof = persistPrewritePhotoForContext(selected, contextPath);
    const data = { connectKind: "SHOPPING", snapshot, snapshotId: snapshot.snapshotId, prewritingPhotoProof: proof,
      publicationPhotoContext: writingPhotosFromPrewrite(proof), publicationPhotoAvailability: { status: "verified-local-original" } };
    fs.writeFileSync(contextPath, JSON.stringify(data));
    const originalJson = JSON.stringify(data), warnings: string[] = [];
    let uploads = 0;
    const deps = { upload: async (file: string, expectedHash: string) => {
      uploads++; assert.equal(file, proof.original.path); assert.equal(expectedHash, sha256);
      return "https://site.example/api/agent/assets/image";
    }, warn: (message: string) => warnings.push(message) };
    const result = await attachPreparedDraftOriginal(data, snapshot.productId, contextPath, deps);
    assert.equal(availability(result).status, "attached-verified-original"); checks++;
    assert.equal(images(result)[0].sha256, sha256); checks++;
    assert.equal(images(result)[0].base64, bytes.toString("base64")); checks++;
    assert.equal(availability(result).snapshotId, snapshot.snapshotId); checks++;
    assert.equal(JSON.stringify(result).includes(proof.original.path.replace(/\\/gu, "\\\\")), false); checks++;
    assert.equal(JSON.stringify(data), originalJson); assert.equal(fs.readFileSync(contextPath, "utf8"), originalJson); checks += 2;
    const beforeTamper = uploads;
    fs.appendFileSync(proof.original.path, "tampered");
    const changed = await attachPreparedDraftOriginal(data, snapshot.productId, contextPath, deps);
    assert.equal(availability(changed).status, "needs_reference"); assert.equal(changed.nativeReferenceImages, undefined);
    assert.equal(uploads, beforeTamper); checks += 3;
    fs.writeFileSync(proof.original.path, bytes);
    const differentOption = createProductSnapshot({ ...snapshot, product: { ...snapshot.product, features: ["선택 옵션: 블랙"] } });
    const option = await attachPreparedDraftOriginal({ ...data, snapshot: differentOption, snapshotId: differentOption.snapshotId }, snapshot.productId, contextPath, deps);
    assert.equal(availability(option).externalWriterReady, false); assert.equal(uploads, beforeTamper); checks += 2;
    const wrongProduct = await attachPreparedDraftOriginal(data, "another_product", contextPath, deps);
    assert.equal(availability(wrongProduct).externalWriterReady, false); assert.equal(uploads, beforeTamper); checks += 2;
    const failedUpload = await attachPreparedDraftOriginal(data, snapshot.productId, contextPath, { ...deps, upload: async () => null });
    assert.equal(availability(failedUpload).status, "needs_reference"); assert.equal(failedUpload.nativeReferenceImages, undefined); checks += 2;
    const duringUpload = await attachPreparedDraftOriginal(data, snapshot.productId, contextPath, { ...deps, upload: async () => {
      fs.appendFileSync(proof.original.path, "changed during upload"); return "https://site.example/original";
    } });
    assert.equal(availability(duringUpload).externalWriterReady, false); assert.equal(duringUpload.nativeReferenceImages, undefined); checks += 2;
    fs.writeFileSync(proof.original.path, bytes);
    const changedContext = await attachPreparedDraftOriginal(data, snapshot.productId, contextPath, { ...deps, upload: async () => {
      fs.writeFileSync(contextPath, JSON.stringify({ ...data, snapshot: differentOption, snapshotId: differentOption.snapshotId }));
      return "https://site.example/original";
    } });
    assert.equal(availability(changedContext).externalWriterReady, false); assert.equal(changedContext.nativeReferenceImages, undefined); checks += 2;
    fs.writeFileSync(contextPath, originalJson);
    const legacy = { connectKind: "SHOPPING", snapshot, snapshotId: snapshot.snapshotId };
    fs.writeFileSync(contextPath, JSON.stringify(legacy));
    assert.equal(availability(await attachPreparedDraftOriginal(legacy, snapshot.productId, contextPath, deps)).externalWriterReady, false); checks++;
    const travel = { connectKind: "TRAVEL", sourceImages: ["https://seller.example/travel.jpg"] };
    assert.deepEqual(await attachPreparedDraftOriginal(travel, "travel", "unused", { upload: async () => { throw Error("must not upload"); }, warn() {} }), travel); checks++;
    assert.ok(warnings.length >= 5); checks++;
    console.log(`PASS: prepared draft exact-original MCP handoff ${checks} assertions`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exit(1); });

/** Offline deny/budget tests. The isolated VM substitutes the native admission
 * reader, never writes a native proof or calls a provider/live API. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBrandPostPackageDir } from "../src/lib/brand-post-package";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { publicationImageContext } from "./lib/publish-image-rejections";
import { isolatedOriginalRecovery } from "./lib/test-original-source-workflow";
import { readSellerOriginalRecoveryScope, sellerOriginalRecoveryBudgetBinding, type SellerOriginalRecoveryScope } from "./lib/seller-original-recovery-scope";

const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
let checks = 0;
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "original-source-scope-")), previous = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  try {
    let proofAvailable = true, proofEpoch = "initial", scopes = 0;
    const getScope = (id: string, sectionId: string): SellerOriginalRecoveryScope | null => {
      scopes++;
      if (!proofAvailable) return null;
      const dir = getBrandPostPackageDir(id), manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      const original = manifest.imageAssets.find((row: { sectionId?: string; provenance?: string }) => row.sectionId === sectionId && row.provenance === "ORIGINAL");
      const identity = { productId: id, sectionId, slotId: original.slotId, sha256: original.sha256,
        context: publicationImageContext(manifest.composition, sectionId), sourceSnapshotId: manifest.sourceSnapshot.snapshotId,
        canonicalReceipts: manifest.sourceSnapshot.product.referenceImageUrls.map((sourceUrl: string) => ({ sourceUrl, sourceSha256: original.sha256 })) };
      return { version: "seller-original-recovery-scope/v1", identity, binding: sellerOriginalRecoveryBudgetBinding(identity),
        nativeProof: { path: "offline-no-native-proof-" + proofEpoch, sha256: hash(proofEpoch), materialContext: { file: "offline-context", sha256: hash("offline context " + proofEpoch) } } };
    };
    const recovery = isolatedOriginalRecovery(getScope);
    const fixture = (label: string) => {
      const id = "offline-original-" + label, dir = getBrandPostPackageDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const original = path.join(dir, "original.png"), normal = path.join(dir, "normal.png"), markdown = path.join(dir, "post.md");
      fs.writeFileSync(original, "isolated original bytes"); fs.writeFileSync(normal, "isolated normal bytes"); fs.writeFileSync(markdown, "원고를 보존합니다.");
      const snapshot = createProductSnapshot({ productId: id, externalProductId: id, connectKind: "SHOPPING", sourceUrl: "https://smartstore.naver.com/shop/products/123",
        product: { name: "offline original fixture", referenceImageUrls: ["https://shop-phinf.pstatic.net/selected/photo.png"] } });
      const manifest = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", title: "원고 제목", markdownPath: markdown, markdownSha256: hash(fs.readFileSync(markdown)),
        sourceSnapshot: snapshot, imageAssets: [{ path: original, sha256: hash(fs.readFileSync(original)), sectionId: "source", slotId: "source:image:1", role: "body", provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false },
          { path: normal, sha256: hash(fs.readFileSync(normal)), sectionId: "normal", role: "body", provenance: "GENERATED_SCENE" }],
        composition: { title: "원고 제목", sections: [{ id: "source", title: "외형", body: ["사진에서는 전체 연결부가 보여요."], imagePaths: [original], imageSource: "seller-original" }],
          renderNodes: [{ kind: "paragraph", sectionId: "source", text: "사진에서는 전체 연결부가 보여요." }, { kind: "image", sectionId: "source", assetPath: original, role: "scene" }] } };
      const file = path.join(dir, "manifest.json"), history = path.join(dir, "image-recovery-history.json"), claims = path.join(dir, "seller-original-recovery-scopes");
      fs.writeFileSync(file, JSON.stringify(manifest));
      return { id, dir, file, history, claims, manifest, protectedFiles: [original, normal, markdown].map(file => ({ file, sha256: hash(fs.readFileSync(file)) })) };
    };
    const first = fixture("once");
    assert.equal(readSellerOriginalRecoveryScope(first.id, "source"), null, "real default reader accepts no fixture/generic ledger as native authority"); checks++;
    let operations = 0;
    const operation = async () => { operations++; return "source-only result"; };
    assert.equal((await recovery.runRecordedImageRecovery(first.id, "repair-rejected-original", operation, { originalSectionId: "source" })).attempted, true); checks++;
    const marker = path.join(first.claims, getScope(first.id, "source")!.binding + ".json"), markerBytes = fs.readFileSync(marker), historyBytes = fs.readFileSync(first.history);
    const entry = JSON.parse(historyBytes.toString("utf8")).entries[0];
    assert.equal(entry.status, "complete"); assert.equal(entry.originalSourceScope.nativeProof.sha256, hash("initial"));
    assert.equal(JSON.parse(markerBytes.toString("utf8")).generationAuthorization, false); checks += 3;
    const firstScope = getScope(first.id, "source")!;
    for (const urls of [[...firstScope.identity.canonicalReceipts.map(row => row.sourceUrl), "https://shop-phinf.pstatic.net/selected/alias.png"],
      ["https://shop-phinf.pstatic.net/selected/alias.png"]]) {
      first.manifest.sourceSnapshot.product.referenceImageUrls = urls;
      fs.writeFileSync(first.file, JSON.stringify(first.manifest));
      const aliasScope = getScope(first.id, "source")!;
      assert.notDeepEqual(aliasScope.identity.canonicalReceipts, firstScope.identity.canonicalReceipts);
      assert.equal(aliasScope.binding, firstScope.binding, "canonical aliases retain evidence but cannot renew the same original scope");
      assert.equal((await recovery.runRecordedImageRecovery(first.id, "repair-rejected-original", operation, { originalSectionId: "source" })).attempted, false);
      assert.equal(operations, 1); assert.deepEqual(fs.readFileSync(marker), markerBytes); assert.deepEqual(fs.readFileSync(first.history), historyBytes); checks += 6;
    }
    first.manifest.imageAssets[1].sha256 = hash("unrelated print replacement");
    fs.writeFileSync(first.file, JSON.stringify({ ...first.manifest, imageGeneration: { status: "complete", checkedAt: "new telemetry" } }));
    proofEpoch = "fresh-policy-and-other-image-audit";
    assert.equal((await recovery.runRecordedImageRecovery(first.id, "repair-rejected-original", operation, { originalSectionId: "source" })).attempted, false);
    assert.equal(operations, 1); assert.deepEqual(fs.readFileSync(marker), markerBytes); assert.deepEqual(fs.readFileSync(first.history), historyBytes); checks += 4;
    // Even if the generic last32 history window later disappears, its immutable
    // source claim keeps the same original/body/source operation consumed.
    fs.unlinkSync(first.history);
    assert.equal((await recovery.runRecordedImageRecovery(first.id, "repair-rejected-original", operation, { originalSectionId: "source" })).attempted, false); checks++;
    fs.writeFileSync(marker, "corrupt deny marker");
    assert.equal((await recovery.runRecordedImageRecovery(first.id, "repair-rejected-original", operation, { originalSectionId: "source" })).attempted, false);
    assert.equal(fs.readFileSync(marker, "utf8"), "corrupt deny marker"); assert.equal(operations, 1); checks += 3;
    for (const saved of first.protectedFiles) assert.equal(hash(fs.readFileSync(saved.file)), saved.sha256); checks += 3;

    for (const [index, saved] of ["{", "{}", '{"entries":null}', '{"entries":[null]}', '{"entries":[{"stage":"repair-rejected-original","input":"unknown","status":"running","at":"not-a-date"}]}'].entries()) {
      const f = fixture("malformed-" + index); fs.writeFileSync(f.history, saved); let calls = 0;
      await assert.rejects(recovery.runRecordedImageRecovery(f.id, "repair-rejected-original", async () => { calls++; }, { originalSectionId: "source" }), (error: unknown) => (error as { code?: string }).code === "IMAGE_RESUME_REQUIRED");
      assert.equal(calls, 0); assert.equal(fs.readFileSync(f.history, "utf8"), saved); assert.equal(fs.existsSync(f.claims), false); checks += 4;
    }
    for (const status of ["running", "complete", "failed"] as const) {
      const f = fixture("legacy-" + status), saved = JSON.stringify({ version: 1, entries: [{ stage: "repair-rejected-original", input: hash("legacy whole-image input"),
        status, at: "2026-10-20T00:00:00Z", externalFailure: true, reason: "old result or send is uncertain" }] });
      fs.writeFileSync(f.history, saved); let calls = 0;
      assert.equal((await recovery.runRecordedImageRecovery(f.id, "repair-rejected-original", async () => { calls++; }, { originalSectionId: "source" })).attempted, false);
      assert.equal(calls, 0); assert.equal(fs.readFileSync(f.history, "utf8"), saved); checks += 3;
    }
    for (const code of ["ECONNRESET", "ETIMEDOUT", "REQUEST_TIMEOUT", undefined]) {
      const f = fixture("unknown-send-" + (code || "unknown")); let calls = 0;
      await assert.rejects(recovery.runRecordedImageRecovery(f.id, "repair-rejected-original", async () => { calls++; throw Object.assign(new Error("mutation result unknown"), { code }); }, { originalSectionId: "source" }));
      const saved = fs.readFileSync(f.history); assert.equal(JSON.parse(saved.toString()).entries[0].externalFailure, false);
      assert.equal((await recovery.runRecordedImageRecovery(f.id, "repair-rejected-original", async () => { calls++; }, { originalSectionId: "source" })).attempted, false);
      assert.equal(calls, 1); assert.deepEqual(fs.readFileSync(f.history), saved); checks += 4;
    }
    const absent = fixture("no-native-claim"); proofAvailable = false; let absentCalls = 0;
    await assert.rejects(recovery.runRecordedImageRecovery(absent.id, "repair-rejected-original", async () => { absentCalls++; }, { originalSectionId: "source" }), /서명된/u);
    assert.equal(absentCalls, 0); assert.equal(fs.existsSync(absent.history), false); assert.equal(fs.existsSync(absent.claims), false); checks += 4;
    proofAvailable = true;
    await assert.rejects(recovery.runRecordedImageRecovery(absent.id, "repair-rejected-original", async () => { absentCalls++; }), /서명된/u); checks++;
    assert(scopes > 0);
    console.log(`PASS original source recovery scope: ${checks} offline assertions; native-proof default deny, exact original/body/source scope, unrelated images/policy cannot renew, immutable claim after history loss, malformed/legacy/unknownsend hold, existing bytes preserved; provider/generation/publication0`);
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previous;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^original-source-scope-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

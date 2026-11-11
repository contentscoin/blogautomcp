/** Offline discovery fixtures. No user proofs, provider or approval writes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { publicationImageContext } from "./lib/publish-image-rejections";
import { publicationDefectMaterialBinding, readHistoricalPrintSourceHints, readPublicationImageDefect } from "./lib/publication-image-defect-proof";
import { readPublicationIdentifierReferenceBindings } from "./lib/selected-gallery-comparison";

const hash = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "historical-source-hints-"));
const prior = process.env.DESKTOP_USER_DATA;
process.env.DESKTOP_USER_DATA = root;
async function main() {
  const productId = "historical-source-fixture", sectionId = "section-one", slotId = "slot-one";
  const folder = path.join(root, "data/prepared-brand-posts", productId), sources = path.join(folder, "product-sources");
  const proofs = path.join(root, "data/publication-image-defect-proofs");
  fs.mkdirSync(sources, { recursive: true }); fs.mkdirSync(proofs, { recursive: true });
  const urls = [1, 2, 3].map(i => `https://shop-phinf.pstatic.net/fixture-${i}.png`);
  const originals = await Promise.all(["#aabbcc", "#ccbbaa", "#bbccaa"].map(async (color, i) => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
    const file = path.join(sources, `${i}.png`); fs.writeFileSync(file, bytes);
    fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: urls[i],
      sha256: hash(bytes), retrievedAt: "2026-01-01T00:00:00Z" }));
    return { path: file, sha256: hash(bytes) };
  }));
  const snapshot = createProductSnapshot({ productId, connectKind: "SHOPPING", externalProductId: "fixture",
    sourceUrl: "https://smartstore.naver.com/fixture/products/1234567890", product: { name: "시험 상품", referenceImageUrls: urls } });
  const candidate = path.join(folder, "scene.png"), candidateBytes = Buffer.from("offline candidate bytes");
  fs.writeFileSync(candidate, candidateBytes); const sha256 = hash(candidateBytes), outStem = candidate.slice(0, -4);
  const metadataPath = `${outStem}.reference-scene.json`;
  fs.writeFileSync(metadataPath, JSON.stringify({ slotId, sourceSnapshotId: snapshot.snapshotId, referenceHashes: [originals[0].sha256] }));
  const asset = { path: candidate, sourcePath: candidate, sha256, sectionId, slotId, role: "body", provenance: "GENERATED_SCENE",
    creationMethod: "reference-guided-scene", remoteGenerated: true, referenceScene: { referenceSha256: originals[0].sha256, sourceSnapshotId: snapshot.snapshotId } };
  const manifest = { brandLinkId: productId, createdAt: "2026-01-01", title: "Saved", hashtags: [], sourceSnapshot: snapshot,
    composition: { sections: [{ id: sectionId, imagePaths: [candidate] }], renderNodes: [] }, imageAssets: [asset], heroImagePath: "", bodyImagePaths: [candidate] } as unknown as BrandPostPackageManifestV2;
  const contextBytes = JSON.stringify({ version: "publication-defect-material-context/v1", manifest });
  const contextSha = hash(contextBytes), contextFile = `context-${contextSha}.json`;
  fs.writeFileSync(path.join(proofs, contextFile), contextBytes);
  const binding = { material: publicationDefectMaterialBinding(manifest), context: publicationImageContext(manifest.composition, sectionId),
    sectionId, slotId, sha256, outStem, metadataSha256: hash(fs.readFileSync(metadataPath)), referenceHashes: [originals[0].sha256], assetSha256: hash(JSON.stringify(asset)) };
  const payload = { version: "publication-image-print-defect/v4", binding, materialContext: { file: contextFile, sha256: contextSha },
    defectKind: "conflicting-print", policyFingerprint: "a".repeat(64),
    identifierInput: { canonicalReferences: [{ ...originals[2], sourceSnapshotId: snapshot.snapshotId }] },
    identifierReview: { status: "conflict", nativeExecution: true, identifierConflict: { pair: { sourceSha256: originals[2].sha256 },
      evidence: { source: { originalSha256: originals[2].sha256 }, candidate: { originalSha256: sha256 } } } } };
  const key = crypto.randomBytes(32); fs.writeFileSync(path.join(proofs, ".signing-key"), key);
  const proofPath = path.join(proofs, `${"b".repeat(64)}.json`);
  const sign = (value: unknown) => fs.writeFileSync(proofPath, JSON.stringify({ ...(value as object),
    signature: crypto.createHmac("sha256", key).update(JSON.stringify(value)).digest("hex") }));
  sign(payload);
  const hints = (m = manifest) => readHistoricalPrintSourceHints(m, sha256, originals[0].sha256);
  assert.deepEqual(hints(), [originals[2].sha256]);
  const unrelated = structuredClone(manifest); unrelated.title = "Updated unrelated title";
  assert.deepEqual(hints(unrelated), [originals[2].sha256]);
  assert.equal(readPublicationImageDefect(unrelated, sectionId, sha256, "c".repeat(64)), null, "discovery never migrates repair authority");
  for (const mutate of [
    (m: BrandPostPackageManifestV2) => { m.brandLinkId = "another-product"; },
    (m: BrandPostPackageManifestV2) => { m.sourceSnapshot = { ...m.sourceSnapshot!, snapshotId: "d".repeat(64) }; },
    (m: BrandPostPackageManifestV2) => { m.imageAssets![0].slotId = "another-slot"; },
    (m: BrandPostPackageManifestV2) => { m.composition.sections[0].imagePaths = []; },
    (m: BrandPostPackageManifestV2) => { m.composition.sections[0].imageIntent = "changed intended image"; },
  ]) { const m = structuredClone(manifest); mutate(m); assert.deepEqual(hints(m), []); }
  const unsigned = { ...payload, signature: "0".repeat(64) }; fs.writeFileSync(proofPath, JSON.stringify(unsigned));
  assert.deepEqual(hints(), []); sign(payload);
  fs.appendFileSync(candidate, "changed"); assert.deepEqual(hints(), []); fs.writeFileSync(candidate, candidateBytes);
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest));
  const options = { snapshot, productId, sourceDirectory: sources, candidateSha256: sha256, primaryReference: originals[0] };
  const before = fs.readFileSync(proofPath);
  assert((await readPublicationIdentifierReferenceBindings(options)).some(row => row.sha256 === originals[2].sha256));
  fs.writeFileSync(`${originals[2].path}.retrieval.json`, "invalid");
  assert(!(await readPublicationIdentifierReferenceBindings(options)).some(row => row.sha256 === originals[2].sha256), "hint cannot bypass current receipt");
  assert.deepEqual(fs.readFileSync(proofPath), before, "discovery never signs or overwrites old evidence");
  assert.deepEqual(fs.readFileSync(candidate), candidateBytes);
  console.log("PASS historical source discovery: signature/context/target/receipt isolation; stale policy grants no approval or repair authority; no provider calls");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (prior === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = prior;
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^historical-source-hints-/u);
  fs.rmSync(root, { recursive: true, force: true });
});

/** Offline, isolated files only. No image/provider/approval or publication API. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearReviewedPublicationImageRejections, hasCurrentPublicationImageRegenerationHold,
  publicationImageContext, publicationImageRegenerationHoldState, recordPublicationImageRegenerationHolds, recordPublicationImageRejections,
  rejectedPublicationImageHashes, type PublicationImageRegenerationHoldInput } from "./lib/publish-image-rejections";
import { readSuccessfulImageAuditReceipt, writeSuccessfulImageAuditReceipt } from "./lib/publish-image-audit-receipt";
import type { ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";

const sha = (value: crypto.BinaryLike) => crypto.createHash("sha256").update(value).digest("hex");
const hashFile = (file: string) => sha(fs.readFileSync(file));
async function main() {
  const prefix = "verify-publication-regeneration-holds-";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previous = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  let assertions = 0;
  try {
    const id = "held-photo-fixture", directory = path.join(root, "data/prepared-brand-posts", id);
    fs.mkdirSync(directory, { recursive: true });
    const image = path.join(directory, "normal.png"), md = path.join(directory, "draft.md");
    const rawTrace = path.join(directory, "raw-provider-verdict.json"), failedQc = path.join(directory, "failed-qc.json");
    fs.writeFileSync(image, Buffer.from("fixture original normal photo bytes")); fs.writeFileSync(md, "기존 원고를 보존합니다.");
    fs.writeFileSync(rawTrace, JSON.stringify({ accepted: false, identityMatches: false, referenceComparison: { objectionKind: "unresolved" } }));
    fs.writeFileSync(failedQc, JSON.stringify({ code: "INVALID_REVIEW", originalVerdictPreserved: true }));
    const photoHash = hashFile(image), source = sha("selected-snapshot"), policy = sha("policy149");
    const composition = { sections: [{ id: "body", title: "기모 안내", body: ["사진은 자연스러운 착용 연출입니다."],
      imageIntent: "natural photo", imageSource: "staged-ai", imagePaths: [image], imageMin: 1, imageMax: 1 }],
      renderNodes: [{ kind: "heading", sectionId: "body", text: "기모 안내" },
        { kind: "paragraph", sectionId: "body", text: "사진은 자연스러운 착용 연출입니다." },
        { kind: "image", sectionId: "body", role: "scene", assetPath: image }] } as unknown as ResolvedPostDocumentV1;
    const manifest = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", composition,
      sourceSnapshot: { snapshotId: source }, markdownPath: md, markdownSha256: hashFile(md),
      imageAssets: [{ path: image, sha256: photoHash, sectionId: "body", slotId: "body:image:1", role: "body",
        imageIntent: "natural photo", provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true }] };
    const manifestPath = path.join(directory, "manifest.json"), heldPath = path.join(directory, "publish-image-regeneration-holds.json");
    const rejectionPath = path.join(directory, "publish-image-rejections.json");
    const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest)); save();
    const protectedFiles = [image, md, rawTrace, failedQc, manifestPath].map(file => [file, hashFile(file)] as const);
    const hold: PublicationImageRegenerationHoldInput = { sha256: photoHash, sectionId: "body", slotId: "body:image:1",
      sourceSnapshotId: source, policyFingerprint: policy, kind: "unresolved-identity" };
    const query = { slotId: hold.slotId, sourceSnapshotId: source, policyFingerprint: policy };
    assert.equal(hasCurrentPublicationImageRegenerationHold(id, composition, "body", photoHash, query), false); assertions++;
    assert.equal(publicationImageRegenerationHoldState(id, composition, "body", photoHash), "none"); assertions++;
    assert.deepEqual(rejectedPublicationImageHashes(id, composition, "body"), []); assertions++;
    const receiptKey = sha("old-positive"); writeSuccessfulImageAuditReceipt(id, receiptKey);
    assert(readSuccessfulImageAuditReceipt(id, receiptKey)); assertions++;
    recordPublicationImageRegenerationHolds(id, composition, [hold]);
    assert.equal(hasCurrentPublicationImageRegenerationHold(id, composition, "body", photoHash, query), true); assertions++;
    assert.equal(publicationImageRegenerationHoldState(id, composition, "body", photoHash), "held"); assertions++;
    assert.deepEqual(rejectedPublicationImageHashes(id, composition, "body"), [photoHash]); assertions++;
    assert(!readSuccessfulImageAuditReceipt(id, receiptKey), "A hold invalidates the old signed positive cache"); assertions++;
    assert(!fs.existsSync(rejectionPath), "Uncertainty is not rewritten as a semantic product rejection"); assertions++;
    for (const altered of [{ ...query, policyFingerprint: sha("new-policy") }, { ...query, sourceSnapshotId: sha("new-source") },
      { ...query, slotId: "body:image:2" }]) {
      assert(hasCurrentPublicationImageRegenerationHold(id, composition, "body", photoHash, altered), "Changing caller inputs cannot buy generation"); assertions++;
    }
    assert(!hasCurrentPublicationImageRegenerationHold(id, composition, "other", photoHash, query)); assertions++;
    assert.equal(publicationImageRegenerationHoldState(id, composition, "other", photoHash), "none"); assertions++;
    assert(!hasCurrentPublicationImageRegenerationHold(id, composition, "body", sha("different photo"), query)); assertions++;
    assert.equal(publicationImageRegenerationHoldState(id, composition, "body", sha("different photo")), "none"); assertions++;
    const changed = structuredClone(composition);
    (changed.renderNodes[1] as { text: string }).text = "실제 본문이 변경되었습니다.";
    assert.notEqual(publicationImageContext(changed, "body"), publicationImageContext(composition, "body")); assertions++;
    assert(!hasCurrentPublicationImageRegenerationHold(id, changed, "body", photoHash, query), "An old hold cannot approve or diagnose a new body"); assertions++;
    assert.equal(publicationImageRegenerationHoldState(id, changed, "body", photoHash), "none"); assertions++;
    assert.deepEqual(rejectedPublicationImageHashes(id, changed, "body"), []); assertions++;
    const firstBytes = fs.readFileSync(heldPath);
    recordPublicationImageRegenerationHolds(id, composition, [hold]);
    assert.deepEqual(fs.readFileSync(heldPath), firstBytes, "Duplicate observation preserves the first hold"); assertions++;
    for (const invalid of [{ ...hold, slotId: "other:image:1" }, { ...hold, sourceSnapshotId: sha("another snapshot") },
      { ...hold, sha256: sha("other photo") }, { ...hold, policyFingerprint: "missing" },
      { ...hold, kind: "definitive-product-mismatch" as PublicationImageRegenerationHoldInput["kind"] }]) {
      assert.throws(() => recordPublicationImageRegenerationHolds(id, composition, [invalid]), /PUBLICATION_IMAGE_REGENERATION_HELD/); assertions++;
      assert.deepEqual(fs.readFileSync(heldPath), firstBytes); assertions++;
    }
    assert.throws(() => recordPublicationImageRegenerationHolds(id, changed, [hold]), /PUBLICATION_IMAGE_REGENERATION_HELD/); assertions++;
    clearReviewedPublicationImageRejections(id, composition, [{ sha256: sha("other photo"), sectionId: "body" }]);
    assert.deepEqual(fs.readFileSync(heldPath), firstBytes); assertions++;
    clearReviewedPublicationImageRejections(id, changed, [{ sha256: photoHash, sectionId: "body" }]);
    assert.deepEqual(fs.readFileSync(heldPath), firstBytes, "An old/current-body mismatch cannot clear"); assertions++;
    const originalSource = manifest.sourceSnapshot;
    manifest.sourceSnapshot = { snapshotId: sha("changed selected source") }; save();
    clearReviewedPublicationImageRejections(id, composition, [{ sha256: photoHash, sectionId: "body" }]);
    assert.deepEqual(fs.readFileSync(heldPath), firstBytes, "Source mismatch cannot clear a source-bound hold"); assertions++;
    manifest.sourceSnapshot = originalSource; save();
    const oldPhotoBytes = fs.readFileSync(image);
    fs.appendFileSync(image, "changed after review");
    clearReviewedPublicationImageRejections(id, composition, [{ sha256: photoHash, sectionId: "body" }]);
    assert.deepEqual(fs.readFileSync(heldPath), firstBytes, "A metadata-only old SHA cannot clear mutated current pixels"); assertions++;
    assert.throws(() => recordPublicationImageRegenerationHolds(id, composition, [hold]), /PUBLICATION_IMAGE_REGENERATION_HELD/); assertions++;
    assert.deepEqual(fs.readFileSync(heldPath), firstBytes); assertions++;
    fs.writeFileSync(image, oldPhotoBytes);
    recordPublicationImageRejections(id, composition, [{ sha256: photoHash, sectionId: "body", scope: "product" }]);
    const semanticBefore = fs.readFileSync(rejectionPath);
    recordPublicationImageRegenerationHolds(id, composition, [{ ...hold, kind: "uncorroborated-identifier", policyFingerprint: sha("next policy") }]);
    assert.deepEqual(fs.readFileSync(rejectionPath), semanticBefore, "Hold recording never normalizes raw semantic history"); assertions++;
    assert.deepEqual(rejectedPublicationImageHashes(id, composition, "body"), [photoHash], "Semantic and hold hashes deduplicate"); assertions++;
    clearReviewedPublicationImageRejections(id, composition, [{ sha256: photoHash, sectionId: "body" }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(heldPath, "utf8")), []); assertions++;
    assert(!hasCurrentPublicationImageRegenerationHold(id, composition, "body", photoHash, query)); assertions++;
    assert.equal(publicationImageRegenerationHoldState(id, composition, "body", photoHash), "none"); assertions++;
    assert.deepEqual(rejectedPublicationImageHashes(id, composition, "body"), []); assertions++;
    // Unknown/corrupt records remain deny-only even across policy changes;
    // neither recording nor a guessed positive may silently discard them.
    const validRecord = JSON.parse(firstBytes.toString("utf8"))[0];
    for (const invalidBytes of ["not-json", "{}", JSON.stringify([{ ...validRecord, context: "unknown" }]),
      JSON.stringify([{ ...validRecord, sourceSnapshotId: "unknown" }]), JSON.stringify([{ ...validRecord, heldAt: "unknown" }]),
      JSON.stringify([{ ...validRecord, kind: "wrong-kind" }]), JSON.stringify([{ ...validRecord, version: "unknown" }])]) {
      fs.writeFileSync(heldPath, invalidBytes);
      assert(hasCurrentPublicationImageRegenerationHold(id, composition, "body", photoHash, query)); assertions++;
      assert.equal(publicationImageRegenerationHoldState(id, composition, "body", photoHash), "invalid"); assertions++;
      assert(hasCurrentPublicationImageRegenerationHold(id, composition, "body", sha("unknown photo"), { ...query, policyFingerprint: sha("future") })); assertions++;
      assert.equal(publicationImageRegenerationHoldState(id, changed, "other", sha("unknown photo")), "invalid", "corrupt ledgers never become a valid hold/none even for another body or SHA"); assertions++;
      assert(rejectedPublicationImageHashes(id, composition, "body").includes(photoHash)); assertions++;
      assert.throws(() => recordPublicationImageRegenerationHolds(id, composition, [hold]), /PUBLICATION_IMAGE_REGENERATION_HELD/); assertions++;
      assert.throws(() => clearReviewedPublicationImageRejections(id, composition, [{ sha256: photoHash, sectionId: "body" }]), /PUBLICATION_IMAGE_REGENERATION_HELD/); assertions++;
      assert.equal(fs.readFileSync(heldPath, "utf8"), invalidBytes); assertions++;
    }
    for (const [file, hash] of protectedFiles) { assert.equal(hashFile(file), hash, "Existing manuscript/photo/full metadata/raw QC bytes preserved"); assertions++; }
    assert.deepEqual(fs.readdirSync(directory).filter(name => /\.(png|jpg|webp)$/u.test(name)), ["normal.png"]); assertions++;
    console.log(`PASS publication image regeneration holds: ${assertions} offline assertions; deny-only uncertainty, exact context/normal bytes, no policy/source bypass, official exact positive clear, malformed hold preservation; provider/generation/publication calls0`);
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previous;
    const resolved = path.resolve(root), intended = path.resolve(os.tmpdir()) + path.sep + prefix;
    assert(resolved.startsWith(intended), "Test cleanup must stay in its own verified temp workspace");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

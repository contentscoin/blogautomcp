import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { assertPublishImagesSafe } from "./lib/publish-image-audit";
import { recordPublicationImageRejections, rejectedPublicationImageHashes } from "./lib/publish-image-rejections";
import { imageRecoverySignature } from "./lib/material-image-recovery";
import type { ResolvedPostDocumentV1 } from "../src/lib/post-composition-contract";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-rejections-"));
  process.env.DESKTOP_USER_DATA = root;
  const store = await import("../src/lib/brand-post-package");
  const id = "rejection-fixture";
  const dir = store.getBrandPostPackageDir(id); fs.mkdirSync(dir, { recursive: true });
  const photo = path.join(dir, "photo.png");
  await sharp({ create: { width: 300, height: 300, channels: 3, background: "white" } }).png().toFile(photo);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(photo)).digest("hex");
  const composition = { sections: [{ id: "body", title: "공식 보습 기능", body: ["수분 공급"], imageIntent: "기능 근거", imagePaths: [photo], imageMin: 1, imageMax: 1 }],
    renderNodes: [{ kind: "heading", sectionId: "body", text: "공식 보습 기능" }, { kind: "paragraph", sectionId: "body", text: "수분 공급" },
      { kind: "image", sectionId: "body", assetPath: photo, role: "scene" }] } as unknown as ResolvedPostDocumentV1;
  const manifest = { brandLinkId: id, version: "brand-post-package/v2", composition, connectKind: "SHOPPING", heroImagePath: photo,
    imageAssets: [{ role: "body", sectionId: "body", path: photo, sourcePath: photo, sha256: hash }] } as unknown as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
  const save = () => fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest)); save();
  const verdict = { index: 1, accepted: false, identityMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false,
    optionsClearlyLabeled: false, reviewClass: "feature-evidence", reason: "보습이 아니라 보송한 마무리 설명" };
  const opts = { brandLinkId: id, productName: "fixture", composition,
    review: async () => JSON.stringify({ reviews: [verdict] }) };
  try {
    const before = imageRecoverySignature(dir);
    await assert.rejects(assertPublishImagesSafe(opts), /SEMANTIC_REJECTION/);
    assert.deepEqual(rejectedPublicationImageHashes(id, composition, "body"), [hash]);
    assert.notEqual(imageRecoverySignature(dir), before, "new rejection unlocks one bounded recovery");
    const after = imageRecoverySignature(dir);
    await assert.rejects(assertPublishImagesSafe(opts));
    assert.equal(imageRecoverySignature(dir), after, "same repeated verdict cannot buy more retries");
    assert.equal(store.getBrandPostImageSlots(manifest)[0].staleTargets[0].code, "image-publication-rejected");
    const changed = structuredClone(composition); (changed.renderNodes[1] as { text: string }).text = "새로운 본문";
    assert.deepEqual(rejectedPublicationImageHashes(id, changed, "body"), []);
    const bytes = fs.readFileSync(photo);
    fs.writeFileSync(photo, Buffer.concat([bytes, Buffer.from("changed")]));
    const changedHash = crypto.createHash("sha256").update(fs.readFileSync(photo)).digest("hex");
    assert(!rejectedPublicationImageHashes(id, composition, "body").includes(changedHash));
    await assert.rejects(assertPublishImagesSafe({ ...opts, review: async () => { throw new Error("AUTH_REQUIRED"); } }), /AUTH_REQUIRED/);
    assert(!rejectedPublicationImageHashes(id, composition, "body").includes(changedHash));
    await assert.rejects(assertPublishImagesSafe({ ...opts, review: async () => "{}" }), /INVALID_REVIEW/);
    assert(!rejectedPublicationImageHashes(id, composition, "body").includes(changedHash));
    await assert.rejects(assertPublishImagesSafe({ ...opts, review: async () => { fs.appendFileSync(photo, "more"); return JSON.stringify({ reviews: [verdict] }); } }), /IMAGE_CHANGED/);
    assert(!rejectedPublicationImageHashes(id, composition, "body").includes(changedHash));
    // A concurrent manuscript edit must not receive a rejection for the old draft.
    manifest.composition = changed; save();
    const lastHash = crypto.createHash("sha256").update(fs.readFileSync(photo)).digest("hex");
    await assert.rejects(assertPublishImagesSafe(opts));
    assert(!rejectedPublicationImageHashes(id, composition, "body").includes(lastHash));
    recordPublicationImageRejections(id, changed, Array.from({ length: 70 }, (_, i) => ({ sectionId: "body", sha256: crypto.createHash("sha256").update(String(i)).digest("hex") })));
    assert.equal(rejectedPublicationImageHashes(id, changed, "body").length, 64);
    console.log("PASS final image rejections: persisted semantic-only verdicts, stale repair, context/bytes binding, auth/malformed/racing rejection exclusion, bounded history/recovery fingerprint");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

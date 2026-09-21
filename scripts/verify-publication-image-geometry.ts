import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import crypto from "node:crypto";
import { publicationImageGeometryIssue, isPublicationImageAspectAllowed } from "./lib/publication-image-geometry";
import { selectVerifiedProductSectionImages } from "./lib/product-photo-review";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-geometry-"));
  process.env.DESKTOP_USER_DATA = root;
  try {
    assert.equal(isPublicationImageAspectAllowed(860, 2580), true);
    assert.equal(isPublicationImageAspectAllowed(860, 2581), false);
    assert.equal(isPublicationImageAspectAllowed(2580, 860), true);
    assert.equal(isPublicationImageAspectAllowed(2581, 860), false);
    assert.equal(isPublicationImageAspectAllowed(0, 20), false);
    assert.equal(isPublicationImageAspectAllowed(NaN, 20), false);
    for (const format of ["png", "jpeg", "webp", "gif"] as const) {
      const file = path.join(root, `actual.${format}`);
      await sharp({ create: { width: 860, height: 2818, channels: 3, background: "white" } }).toFormat(format).toFile(file);
      assert.match(publicationImageGeometryIssue(file)!, /LONG_IMAGE: 860x2818/);
      // Entirely invalid candidates cannot invoke the visual provider.
      assert.deepEqual(await selectVerifiedProductSectionImages([file], "fixture", [{ sectionTitle: "기능", imageIntent: "기능 근거" }]), []);
    }
    const long = path.join(root, "actual.jpeg");
    const rotated = path.join(root, "rotated.jpg");
    await sharp(long).withMetadata({ orientation: 6 }).toFile(rotated);
    assert.match(publicationImageGeometryIssue(rotated)!, /LONG_IMAGE/);
    const broken = path.join(root, "broken.png"); fs.writeFileSync(broken, "not an image");
    assert.match(publicationImageGeometryIssue(broken)!, /INVALID_IMAGE/);
    const valid = path.join(root, "valid.png");
    await sharp({ create: { width: 860, height: 2580, channels: 3, background: "white" } }).png().toFile(valid);
    assert.equal(publicationImageGeometryIssue(valid), null);
    const store = await import("../src/lib/brand-post-package");
    const { resolvePostDocument } = await import("../src/lib/post-composition-contract");
    const { planSectionImageRequests } = await import("../src/lib/brand-post-image-repair");
    const { getMaterial } = await import("../src/lib/material-library");
    const composition = resolvePostDocument({ connectKind: "SHOPPING", title: "기능 비교",
      sections: Array.from({ length: 8 }, (_, i) => `기능 ${i}\n\n확인된 기능입니다.`),
      imagePaths: [valid, long], hashtags: [], connectUrl: "https://example.test", qualityPreset: "PREMIUM" });
    const section = composition.sections[0]; section.imagePaths = [long]; section.imageMin = 1;
    composition.renderNodes.push({ kind: "image", assetPath: long, sectionId: section.id, role: "scene",
      altText: "fixture long photo", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" });
    const markdown = path.join(root, "post.md"); fs.writeFileSync(markdown, "fixture");
    const manifest = { version: "brand-post-package/v2", brandLinkId: "geometry-fixture", connectKind: "SHOPPING",
      contractVersion: "post-composition-contract/v1",
      title: composition.title, composition, heroImagePath: valid, bodyImagePaths: [long], markdownPath: markdown,
      approvedAt: new Date().toISOString(), createdAt: new Date().toISOString(), imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
      contentQuality: { score: 100, canPublish: true, signals: [], blockers: [] }, hashtags: [] } as unknown as import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
    manifest.imageAssets = [{ path: valid, sourcePath: valid, role: "hero", sha256: crypto.createHash("sha256").update(fs.readFileSync(valid)).digest("hex") },
      { path: long, sourcePath: long, role: "body", sectionId: section.id, sha256: crypto.createHash("sha256").update(fs.readFileSync(long)).digest("hex") }];
    store.writeBrandPostPackageManifest(manifest);
    const slot = store.getBrandPostImageSlots(manifest).find(item => item.sectionId === section.id)!;
    assert.equal(slot.count, 0); assert.equal(slot.missing, 1);
    assert.equal(slot.staleTargets[0]?.code, "image-geometry-invalid");
    assert(planSectionImageRequests([slot])[0]?.replaceAssetKey);
    assert.equal(getMaterial(manifest.brandLinkId)?.ready, false);
    assert(getMaterial(manifest.brandLinkId)?.blockers.some(reason => reason.includes("LONG_IMAGE")));
    assert.throws(() => store.approveBrandPostPackage(manifest.brandLinkId));
    const { validateBrandPostPublishImages } = await import("../src/lib/brand-post-publish-preflight");
    await assert.rejects(validateBrandPostPublishImages(manifest.brandLinkId, "geometry fixture", {
      review: async options => JSON.stringify({ reviews: (options.imagePaths || []).map((_, index) => ({ index: index + 1,
        accepted: true, identityMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false,
        optionsClearlyLabeled: false, reviewClass: "feature-evidence", reason: "fixture pixels" })) }),
    }), /LONG_IMAGE/);
    await assert.rejects(validateBrandPostPublishImages(manifest.brandLinkId, "geometry fixture", {
      review: async () => { throw Object.assign(new Error("CODEX_AUTH_REQUIRED"), { code: "CODEX_AUTH_REQUIRED" }); },
    }), /CODEX_AUTH_REQUIRED/); // previous failed audit released its repair lock
    console.log("PASS publication geometry: 3:1 boundaries, four formats, orientation, malformed input, pre-review filtering, saved READY invalidation, replacement planning, approval block");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

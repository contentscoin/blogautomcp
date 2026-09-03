import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "package-qc-reconcile-"));
  process.env.DESKTOP_USER_DATA = temp;
  const store = await import("../src/lib/brand-post-package");
  const { resolvePostDocument } = await import("../src/lib/post-composition-contract");
  try {
    const id = "legacy-saga-fixture";
    const dir = store.getBrandPostPackageDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const images = Array.from({ length: 11 }, (_, n) => path.join(dir, `${n}.png`));
    images.forEach((file, n) => fs.writeFileSync(file, `unique-fixture-${n}`));
    const markdownPath = path.join(dir, "post.md");
    fs.writeFileSync(markdownPath, "이 본문은 재작성하지 않습니다.");
    const composition = resolvePostDocument({
      connectKind: "TRAVEL", title: "규슈 사가 여행 다케오부터 벳푸 유후인까지 3일 풍경",
      sections: Array.from({ length: 10 }, (_, n) => `${n === 2 ? "다케오 시립 도서관" : `여행지 ${n + 1}`}\n\n${"확인된 장소의 풍경과 이동 동선을 구체적으로 연결합니다. ".repeat(10)}`),
      imagePaths: images, hashtags: ["규슈", "사가", "여행"], connectUrl: "https://example.test/", qualityPreset: "PREMIUM",
    });
    // Reproduce the old freeform document: no explicit image bounds, but each section already has an image.
    composition.sections.forEach((section) => { delete section.imageMin; delete section.imageMax; });
    const fixture: BrandPostPackageManifestV2 = {
      version: "brand-post-package/v2", brandLinkId: id, connectKind: "TRAVEL", title: composition.title,
      generationSource: "AI", markdownPath, heroImagePath: images[0], bodyImagePaths: images.slice(1),
      hashtags: ["규슈", "사가", "여행"], imagePolicy: "TRAVEL_EDITORIAL", createdAt: "2026-09-03", approvedAt: null,
      contractVersion: "post-composition-contract/v1", composition,
      contentQuality: {
        canPublish: false, verdict: "blocked", code: "composition-quality", reason: "이미지가 7장보다 적습니다 (3장).", score: 82,
        summary: "내용 보강 필요", signals: [{ key: "composition-quality", label: "구성", status: "fail" }],
        blockers: [{ code: "composition-quality", tier: "structure", reason: "이미지 3장" }],
        quality: { score: 100, passScore: 70, categories: [] },
      } as unknown as BrandPostPackageManifestV2["contentQuality"],
      thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1000, height: 1000, aspect: "1:1" }, style: "fixture", sourcePolicy: "TRAVEL_EDITORIAL", sourceImagePath: images[0] },
    };
    // These offline stand-ins represent completed generated travel images.
    // Execution metadata stays absent, as it does for MCP-submitted images.
    fixture.imageAssets = store.normalizePackageImageAssets(fixture).map((asset) => ({
      ...asset, provenance: "GENERATED_BACKGROUND",
    }));
    const originals: BrandPostPackageManifestV2 = {
      ...fixture,
      brandLinkId: `${id}-originals`,
      imageAssets: fixture.imageAssets.map((asset) => ({ ...asset, provenance: "ORIGINAL" })),
    };
    store.writeBrandPostPackageManifest(originals);
    const originalRead = store.readBrandPostPackage(originals.brandLinkId) as BrandPostPackageManifestV2;
    assert.equal(originalRead.imageGeneration, undefined);
    assert.equal(originalRead.composition.qualityReport.canAutoPublish, true, "Originals satisfy image counts only");
    const originalSlots = store.packagePreview(originalRead).imageSlots;
    assert.equal(originalSlots.reduce((sum, slot) => sum + slot.missing, 0), 0);
    assert.equal(originalSlots.reduce((sum, slot) => sum + slot.generationMissing, 0), 10);
    assert.throws(() => store.approveBrandPostPackage(originals.brandLinkId), /섹션 이미지 품질 게이트/u,
      "Original images without execution metadata must not satisfy generated coverage");
    assert.equal(store.readBrandPostPackage(originals.brandLinkId)?.approvedAt, null);

    store.writeBrandPostPackageManifest(fixture);
    const reconciled = store.readBrandPostPackage(id) as BrandPostPackageManifestV2;
    assert.equal(reconciled.composition.qualityReport.canAutoPublish, true, JSON.stringify(reconciled.composition.qualityReport));
    assert.equal(reconciled.contentQuality?.score, 100);
    assert.equal(reconciled.contentQuality?.canPublish, true);
    assert.equal(reconciled.contentQuality?.verdict, "pass");
    assert.equal(reconciled.contentQuality?.code, "ok");
    assert.equal(reconciled.contentQuality?.reason, null);
    assert.deepEqual(reconciled.contentQuality?.blockers, []);
    assert.equal(reconciled.approvedAt, null, "Migration must never approve a user's post");
    assert.deepEqual(reconciled.composition.sections.map((s) => [s.id, s.title, s.body, s.imagePaths]), fixture.composition.sections.map((s) => [s.id, s.title, s.body, s.imagePaths]));
    assert.equal(fs.readFileSync(markdownPath, "utf8"), "이 본문은 재작성하지 않습니다.");
    const backup = path.join(dir, "manifest.json.pre-qc-v139.bak");
    const backupBytes = fs.readFileSync(backup);
    assert.equal(JSON.parse(backupBytes.toString()).contentQuality.score, 82);
    assert.deepEqual(store.readBrandPostPackage(id), reconciled, "Reconciliation is idempotent");
    assert.deepEqual(fs.readFileSync(backup), backupBytes);
    assert.equal(reconciled.imageGeneration, undefined);
    assert.ok(store.packagePreview(reconciled).imageSlots.every((slot) => slot.generationMissing === 0));
    assert.ok(store.approveBrandPostPackage(id).approvedAt, "An isolated complete fixture can be approved");

    const explicit = structuredClone(reconciled);
    explicit.composition.sections[2].imageMin = 2;
    explicit.composition.sections[2].imageMax = 3;
    const explicitResult = store.reconcileBrandPostPackageQuality(explicit);
    assert.equal(explicitResult.composition.qualityReport.canAutoPublish, false);
    assert.equal(explicitResult.contentQuality?.canPublish, false, "Explicit two-image plans must still block");
    assert.ok(explicitResult.contentQuality?.reason?.includes(explicit.composition.sections[2].id));
    assert.ok(!explicitResult.contentQuality?.reason?.includes("3장"), "Do not retain stale image totals");

    const unsafe = structuredClone(reconciled);
    unsafe.contentQuality!.canPublish = false;
    unsafe.contentQuality!.code = "unsupported-experience-claim" as never;
    unsafe.contentQuality!.reason = "허위 체험 표현";
    unsafe.contentQuality!.blockers = [{ code: unsafe.contentQuality!.code as never, tier: "safety", reason: "허위 체험 표현" }];
    unsafe.contentQuality!.signals.push({ key: "experience", label: "허위 체험", status: "fail" });
    assert.equal(store.reconcileBrandPostPackageQuality(unsafe).contentQuality?.canPublish, false, "Images cannot clear safety failures");
    const legacyFailure = structuredClone(reconciled);
    legacyFailure.contentQuality!.canPublish = false;
    legacyFailure.contentQuality!.code = "unsupported-experience-claim" as never;
    legacyFailure.contentQuality!.reason = "Legacy safety reason without duplicate signals";
    legacyFailure.composition.sections[2].imageMin = 2;
    legacyFailure.composition.sections[2].imageMax = 2;
    const firstResult = store.reconcileBrandPostPackageQuality(legacyFailure);
    assert.equal(firstResult.contentQuality?.code, legacyFailure.contentQuality!.code);
    firstResult.composition.sections[2].imageMin = 1;
    const nextResult = store.reconcileBrandPostPackageQuality(firstResult);
    assert.equal(nextResult.contentQuality?.canPublish, false, "Multiple image results cannot erase a legacy code-only text failure");
    assert.equal(nextResult.contentQuality?.reason, legacyFailure.contentQuality!.reason);
    const low = structuredClone(reconciled);
    low.contentQuality!.quality.score = 65;
    assert.equal(store.reconcileBrandPostPackageQuality(low).contentQuality?.canPublish, false, "Images cannot clear editorial quality failure");

    fs.unlinkSync(images[3]);
    const missing = store.readBrandPostPackage(id) as BrandPostPackageManifestV2;
    assert.equal(missing.approvedAt, null, "Missing files revoke stale approval");
    assert.equal(missing.contentQuality?.canPublish, false);
    assert.ok(missing.contentQuality?.reason?.includes(missing.composition.sections[2].id));
    assert.equal(missing.composition.qualityReport.actual.images, 10);
    assert.throws(() => store.approveBrandPostPackage(id), /게이트/u);
    const repairPath = path.join(dir, "new-library.png");
    fs.writeFileSync(repairPath, "unique-library-replacement");
    const repaired = store.applyGeneratedBrandPostImage({ brandLinkId: id, sectionId: missing.composition.sections[2].id, generatedPath: repairPath, provenance: "GENERATED_BACKGROUND" });
    const imageNode = repaired.composition.renderNodes.find((node) => node.kind === "image" && node.sectionId === missing.composition.sections[2].id);
    assert.ok(imageNode?.kind === "image");
    assert.equal(imageNode.layout, "single", "Generation cannot reintroduce a positional highlight collage");
    assert.equal(store.readBrandPostPackage(id)?.contentQuality?.canPublish, true);

    // Optional real-world fixture: read-only input, in-memory reconciliation only.
    if (process.argv[2]) {
      const sourcePath = path.resolve(process.argv[2]);
      const original = fs.readFileSync(sourcePath);
      const actual = JSON.parse(original.toString()) as BrandPostPackageManifestV2;
      const result = store.reconcileBrandPostPackageQuality(actual);
      assert.equal(result.contentQuality?.score, 100);
      assert.equal(result.contentQuality?.canPublish, true, result.contentQuality?.reason || "");
      assert.equal(result.composition.qualityReport.canAutoPublish, true);
      assert.deepEqual(result.bodyImagePaths, actual.bodyImagePaths);
      assert.deepEqual(result.composition.sections.map((s) => [s.id, s.title, s.body, s.imagePaths]), actual.composition.sections.map((s) => [s.id, s.title, s.body, s.imagePaths]));
      assert.deepEqual(fs.readFileSync(sourcePath), original, "Live input must remain untouched");
      console.log(JSON.stringify({ realFixture: { contentScore: result.contentQuality?.score, compositionScore: result.composition.qualityReport.score, sections: result.composition.sections.length, images: result.composition.qualityReport.actual.images, approvedAt: result.approvedAt, blockers: result.composition.qualityReport.blockers } }));
    }
    console.log("PASS: legacy QC reconciliation, backup/idempotency, generated approval without execution metadata, originals blocked, explicit minima, safety/content guards, missing files and untouched text/images");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

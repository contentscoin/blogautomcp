import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { migrateShoppingNaturalPhotoPlan } from "../src/lib/brand-post-natural-photo-migration";
import { getBrandPostPackageManifestPath, readBrandPostPackage, writeBrandPostPackageManifest, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { resolvePostDocument } from "../src/lib/post-composition-contract";
import { acquireBrandPostImageRepairLock, isBrandPostImageRepairLocked } from "../src/lib/brand-post-image-repair-lock";
import { planWholeBrandPostImageRequests, repairBrandPostImages, type ImageRepairDependencies } from "../src/lib/brand-post-image-repair";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "natural-photo-migration-"));
  const previousRoot = process.env.DESKTOP_USER_DATA;
  process.env.DESKTOP_USER_DATA = root;
  try {
    const id = "migration-fixture";
    const manifestPath = getBrandPostPackageManifestPath(id);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const hero = path.join(root, "hero.png");
    const body = path.join(root, "shopping-fact-card-old.png");
    const markdownPath = path.join(root, "article.md");
    await sharp({ create: { width: 720, height: 720, channels: 3, background: "#aaaaaa" } }).png().toFile(hero);
    await sharp({ create: { width: 720, height: 720, channels: 3, background: "#bbbbbb" } }).png().toFile(body);
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const composition = resolvePostDocument({ connectKind: "SHOPPING", title: "바지 핏 확인",
      sections: Array.from({ length: 6 }, (_, index) => `설명 ${index + 1}\n\n원문 ${index + 1}: 확인한 판매정보입니다.`),
      hashtags: ["바지"], imagePaths: [hero], connectUrl: "https://naver.me/preserved" });
    composition.strategyVersion = "shopping-post-strategy/v1";
    composition.imageFloor = 3;
    composition.sections[1].imagePaths = [body];
    composition.sections[1].imageSource = "editorial-card";
    composition.renderNodes.splice(4, 0, { kind: "image", assetPath: body, sectionId: composition.sections[1].id,
      role: "detail", altText: "old card", caption: "과거 AI 설명", layout: "single", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" });
    fs.writeFileSync(markdownPath, "본문은 그대로 보존합니다.", "utf8");
    const initial = {
      version: "brand-post-package/v2", contractVersion: "post-composition-contract/v1", brandLinkId: id,
      connectKind: "SHOPPING", title: "바지 핏 확인", createdAt: "2026-10-07T00:00:00Z", approvedAt: "old-approval",
      generationSource: "AI", heroImagePath: hero, bodyImagePaths: [body], markdownPath, markdownSha256: hash(markdownPath),
      hashtags: ["바지"], imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", imageRequirements: { policy: "generated-required" }, composition,
      imageAssets: [
        { path: hero, sourcePath: hero, sha256: hash(hero), role: "hero", provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false },
        { path: body, sourcePath: body, sha256: hash(body), role: "body", sectionId: composition.sections[1].id,
          provenance: "EDITORIAL_CARD", creationMethod: "local-composite", remoteGenerated: false },
      ],
      imageGeneration: { status: "complete", requested: 4, applied: 4, remaining: 0, errors: [], updatedAt: "old" },
      textQualityRevalidation: { version: "saved-text-qc/v3", checkedAt: "old", inputFingerprint: "old", strategyVersion: "shopping-post-strategy/v1" },
      thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 720, height: 720, aspect: "1:1" }, style: "old", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", sourceImagePath: hero },
      postSpec: { version: "post-spec/v1", sections: composition.sections.map(section => ({ role: section.id, imageSlotIds: ["old"], imageCount: [1, 1] })),
        imagePlan: { hero: { path: hero }, slots: [{ path: body }], resolvedBody: 1 } },
      reservationId: "same-reservation", scheduledDate: "2026-10-10T08:20:00+09:00",
    } as unknown as BrandPostPackageManifestV2;
    const originalText = JSON.stringify(initial, null, 2);
    fs.writeFileSync(manifestPath, originalText, "utf8");
    const lock = acquireBrandPostImageRepairLock(id);
    try { assert.throws(() => migrateShoppingNaturalPhotoPlan(id), /IMAGE_REPAIR_BUSY/u); }
    finally { lock.release(); }
    assert.equal(fs.readFileSync(manifestPath, "utf8"), originalText, "an active image owner prevents migration writes");
    const result = migrateShoppingNaturalPhotoPlan(id);
    assert.equal(result.changed, true);
    assert.ok(result.backupPath);
    assert.equal(fs.readFileSync(result.backupPath!, "utf8"), originalText, "backup exactly retains the previous manifest and old asset records");
    const next = result.manifest as BrandPostPackageManifestV2 & { reservationId: string; scheduledDate: string };
    assert.equal(next.composition.strategyVersion, "shopping-post-strategy/v2");
    assert.equal(next.composition.imageFloor, 5);
    assert.deepEqual(next.bodyImagePaths, []);
    assert(next.composition.sections.every(section => section.imagePaths.length === 0));
    assert.deepEqual(next.composition.sections.map(section => section.imageSource), ["seller-original", "staged-ai", "none", "staged-ai", "none", "staged-ai"]);
    assert.deepEqual(next.composition.sections.map(({ id, title, body }) => ({ id, title, body })), initial.composition.sections.map(({ id, title, body }) => ({ id, title, body })));
    assert.deepEqual(next.composition.renderNodes.filter(node => node.kind !== "image"), initial.composition.renderNodes.filter(node => node.kind !== "image"));
    assert.deepEqual(next.composition.renderNodes.filter(node => node.kind === "image").map(node => node.assetPath), [hero]);
    assert(!JSON.stringify(next.composition.renderNodes).includes("과거 AI 설명"), "removed body photos cannot leave stale captions");
    assert.deepEqual(next.imageAssets?.map(asset => asset.path), [hero]);
    assert.equal(next.heroImagePath, hero);
    assert.equal(next.reservationId, "same-reservation");
    assert.equal(next.scheduledDate, "2026-10-10T08:20:00+09:00");
    assert.equal(next.approvedAt, null);
    assert.equal(next.imageGeneration, undefined);
    assert.equal(next.textQualityRevalidation, undefined);
    assert.equal(next.specValidation, null);
    assert.equal(next.composition.qualityReport.canAutoPublish, false);
    assert.equal(next.composition.qualityReport.imageCoverage.missingSectionIds.length, 4);
    assert.deepEqual((next.postSpec as { imagePlan: { slots: unknown[] } }).imagePlan.slots, []);
    assert.equal(fs.readFileSync(markdownPath, "utf8"), "본문은 그대로 보존합니다.");
    assert.equal(hash(body), initial.imageAssets![1].sha256, "the old photo remains recoverable on disk");
    const persisted = fs.readFileSync(manifestPath, "utf8");
    assert.equal(migrateShoppingNaturalPhotoPlan(id).changed, false);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), persisted, "repeating full preparation does not reset an already migrated draft");
    assert.equal(readBrandPostPackage(id, { migrate: false })?.approvedAt, null);
    const whole = planWholeBrandPostImageRequests(next);
    assert.equal(whole.length, 5, "full preparation includes the old thumbnail and four body photos");
    assert.equal(whole[0].replaceAssetKey, next.imageAssets![0].sha256);
    assert.equal(whole[0].sectionId, undefined);
    const photoThumbnail = structuredClone(next);
    photoThumbnail.imageAssets![0].provenance = "PHOTO_TEXT_THUMBNAIL";
    assert.equal(planWholeBrandPostImageRequests(photoThumbnail).length, 4, "a current photo thumbnail is retained");
    let migrateCalls = 0;
    let generationCalls = 0;
    const deps = {
      read: () => initial,
      write: (value: BrandPostPackageManifestV2) => value,
      apply: () => { throw new Error("Unexpected generation application"); },
      generate: async () => { generationCalls++; return []; },
      migrateNaturalPhotoPlan: () => { migrateCalls++; return { manifest: next, changed: true }; },
    } as unknown as ImageRepairDependencies;
    await assert.rejects(repairBrandPostImages({ brandLinkId: id, requests: [] }, deps), /NATURAL_IMAGE_PLAN_REQUIRED/u);
    assert.equal(migrateCalls, 0, "a targeted request never starts whole-plan migration");
    assert.equal(generationCalls, 0, "a targeted legacy action cannot silently generate additional scenes");
    const { migrateNaturalPhotoPlan: _migration, ...memoryDeps } = deps;
    await repairBrandPostImages({ brandLinkId: id, requests: [] }, memoryDeps);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), persisted, "in-memory DI does not migrate a real package");
    fs.writeFileSync(manifestPath, originalText, "utf8");
    let plannedRequests = 0;
    const repaired = await repairBrandPostImages({ brandLinkId: id }, {
      ...deps, read: readBrandPostPackage, write: writeBrandPostPackageManifest,
      migrateNaturalPhotoPlan: (brandLinkId) => {
        assert.equal(isBrandPostImageRepairLocked(brandLinkId), false, "migration runs before repair takes its own lock");
        migrateCalls++;
        return migrateShoppingNaturalPhotoPlan(brandLinkId);
      },
      generate: async (options) => { plannedRequests = options.requests.length; return []; },
    });
    assert.equal(migrateCalls, 1);
    assert.equal(plannedRequests, 5, "whole repair plans the old thumbnail plus original1 and three scenes after migration");
    assert.equal(repaired.manifest.composition.strategyVersion, "shopping-post-strategy/v2");
    assert.equal(repaired.appliedCount, 0, "a missing generation response cannot advance completion");
    assert.equal(repaired.manifest.imageGeneration?.status, "incomplete");
    assert.equal(isBrandPostImageRepairLocked(id), false);
    console.log("PASS natural photo migration: exact backup, preserved text/link/reservation/hero, removed old body paths/captions, approval reset, lock safety, idempotence");
  } finally {
    if (previousRoot === undefined) delete process.env.DESKTOP_USER_DATA;
    else process.env.DESKTOP_USER_DATA = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

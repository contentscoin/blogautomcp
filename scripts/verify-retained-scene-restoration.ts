import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { getBrandPostPackageDir, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";
import { REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { planRetainedBrandPostSceneRestoration, restoreRetainedBrandPostScene } from "../src/lib/brand-post-retained-scene";
import { backupMaterialBeforeRewrite } from "../src/lib/material-rewrite-backup";
import type { ShoppingSceneReference } from "./lib/shopping-reference-scene";

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "retained-scene-")), oldData = process.env.DESKTOP_USER_DATA, oldFetch = globalThis.fetch;
  process.env.DESKTOP_USER_DATA = temp;
  globalThis.fetch = async () => { throw new Error("unexpected network"); };
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  let checks = 0, sourceReviews = 0, sceneReviews = 0;
  try {
    async function fixture() {
      const id = crypto.randomUUID(), jobId = crypto.randomUUID(), root = getBrandPostPackageDir(id);
      for (const folder of ["images", "references", "product-sources", "image-generation-work"]) fs.mkdirSync(path.join(root, folder), { recursive: true });
      const [retained, replacement, other, reference] = ["images/old.png", "images/new.png", "images/normal.png", "references/source.png"].map(file => path.join(root, file));
      for (const [index, file] of [retained, replacement, other, reference].entries()) await sharp({ create: { width: 320, height: 320, channels: 3,
        background: `rgb(${index * 40 + 30},120,150)` } }).png().toFile(file);
      const sourcePath = path.join(root, "image-generation-work/old.png"); fs.copyFileSync(retained, sourcePath);
      const cachedSource = path.join(root, `product-sources/${hash(reference)}.png`); fs.copyFileSync(reference, cachedSource);
      const sourceUrl = "https://shop-phinf.pstatic.net/selected/retained-source.png?type=w860", receipt = `${cachedSource}.retrieval.json`;
      fs.writeFileSync(receipt, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl, sha256: hash(reference), retrievedAt: new Date(Date.now() - 10000).toISOString() }));
      const snapshot = createProductSnapshot({ productId: id, externalProductId: id, connectKind: "SHOPPING", sourceUrl: "https://smartstore.naver.com/selected/products/123",
        product: { name: "BYC 검정 의류", features: ["색상: 검정"], referenceImageUrls: [sourceUrl] } });
      const section = { id: "target", title: "선택 기준", body: ["본인 조건에 맞는 사이즈인지 확인해 보세요."], imageIntent: "AI 연출 이미지: 생활 맥락",
        imageSource: "staged-ai", imageMin: 1, imageMax: 1, imagePaths: [retained], promptRecipe: "실제 확인된 의류 구조 유지" };
      const markdown = path.join(root, "post.md"); fs.writeFileSync(markdown, section.body.join("\n"));
      const asset = { path: retained, sourcePath, sha256: hash(retained), role: "body" as const, sectionId: "target", slotId: "target:image:1",
        imageIntent: section.imageIntent, provenance: "GENERATED_SCENE" as const, creationMethod: "reference-guided-scene" as const, remoteGenerated: true,
        referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, referencePath: reference, referenceSha256: hash(reference), sourceSnapshotId: snapshot.snapshotId,
          reviewedOutputSha256: hash(retained), reviewStatus: "passed" as const, reviewedAt: "2026-10-19T01:36:18.360Z", reason: "original accepted source/scene verdict retained exactly",
          checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) } };
      const previous = { version: "brand-post-package/v2", brandLinkId: id, connectKind: "SHOPPING", title: "BYC 검정 의류",
        createdAt: "2026-10-19T01:31:04.440Z", approvedAt: "2026-10-20T16:32:59.221Z", markdownPath: markdown, markdownSha256: hash(markdown),
        sourceSnapshot: snapshot, heroImagePath: other, bodyImagePaths: [retained, other], imageAssets: [asset,
          { path: other, sourcePath: other, sha256: hash(other), role: "body", sectionId: "normal", slotId: "normal:image:1" }],
        composition: { sections: [section, { ...section, id: "normal", title: "다른 정상 파트", imagePaths: [other] }], renderNodes: [
          { kind: "heading", sectionId: "target", text: section.title }, { kind: "paragraph", sectionId: "target", text: section.body[0] },
          { kind: "image", sectionId: "target", assetPath: retained, caption: "AI 연출 이미지" },
          { kind: "image", sectionId: "normal", assetPath: other, caption: "AI 연출 이미지" }] },
      } as unknown as BrandPostPackageManifestV2;
      const manifestFile = path.join(root, "manifest.json"); fs.writeFileSync(manifestFile, JSON.stringify(previous));
      const backup = backupMaterialBeforeRewrite(id, jobId)!;
      const jobs = path.join(temp, "data/material-jobs"); fs.mkdirSync(jobs, { recursive: true });
      const jobFile = path.join(jobs, `${jobId}.json`);
      fs.writeFileSync(jobFile, JSON.stringify({ jobId, kind: "repair", status: "partial", items: [{ productId: id, backupCreated: true }] }));
      const current = structuredClone(previous); current.approvedAt = null;
      current.imageAssets![0] = { ...asset, path: replacement, sourcePath: replacement, sha256: hash(replacement), referenceScene: { ...asset.referenceScene, reviewedOutputSha256: hash(replacement) } };
      current.composition.sections[0].imagePaths = [replacement]; current.composition.renderNodes[2] = { ...current.composition.renderNodes[2], assetPath: replacement } as never;
      current.bodyImagePaths[0] = replacement; fs.writeFileSync(manifestFile, JSON.stringify(current));
      const options = { brandLinkId: id, backupJobId: jobId, sectionId: "target", currentAssetKey: hash(replacement), retainedSha256: hash(retained) };
      const preserved = [retained, replacement, other, reference, sourcePath, receipt, markdown, jobFile, path.join(backup, "manifest.json")];
      const before = new Map(preserved.map(file => [file, hash(file)]));
      const unchanged = () => { for (const [file, sha] of before) assert.equal(hash(file), sha, file); };
      const source: ShoppingSceneReference = { path: reference, sha256: hash(reference), subject: "실제 검정 의류", geometry: "보이는 실제 목선과 봉제 구조",
        labels: "인쇄 없음", reviewedAt: new Date().toISOString() };
      const dependencies = { selectSource: async () => { sourceReviews++; return source; }, reviewScene: async () => { sceneReviews++;
        return { ...asset.referenceScene, reviewedAt: new Date().toISOString(), reason: "fresh actual policy QA passed" }; } };
      return { id, root, backup, options, current, previous, manifestFile, jobFile, receipt, retained, replacement, reference, other, source, dependencies, unchanged };
    }
    const f = await fixture(), plan = planRetainedBrandPostSceneRestoration(f.options);
    assert.deepEqual(plan.candidate.imageAssets![0], f.previous.imageAssets![0]); assert.deepEqual(plan.candidate.imageAssets![1], f.current.imageAssets![1]);
    assert.equal(plan.candidate.approvedAt, null); assert.equal(sourceReviews, 0); assert.equal(sceneReviews, 0); f.unchanged(); checks += 5;
    const restored = await restoreRetainedBrandPostScene(f.options, f.dependencies);
    const saved = JSON.parse(fs.readFileSync(f.manifestFile, "utf8"));
    assert.equal(restored.alreadyRestored, false); assert.deepEqual(saved.imageAssets[0], f.previous.imageAssets![0]);
    assert.deepEqual(saved.imageAssets[1], f.current.imageAssets![1]); assert.equal(saved.approvedAt, null);
    assert.deepEqual(saved.composition.sections.map((section: { body: string[] }) => section.body), f.current.composition.sections.map(section => section.body));
    assert.equal(saved.composition.sections[0].imagePaths[0], f.retained); assert.equal(saved.composition.renderNodes[2].assetPath, f.retained);
    assert.equal(sourceReviews, 1); assert.equal(sceneReviews, 1); f.unchanged(); checks += 9;
    const again = await restoreRetainedBrandPostScene(f.options, f.dependencies);
    assert.equal(again.alreadyRestored, true); assert.equal(sourceReviews, 1); assert.equal(sceneReviews, 1); f.unchanged(); checks += 3;
    for (const mutation of ["foreign-job", "running-job", "no-backup-flag", "no-approval", "body", "hashtags", "text-node", "snapshot", "wrong-current", "wrong-retained", "wrong-section",
      "old-provenance", "old-reference", "old-pixels", "normal-pixels", "foreign-source", "duplicate-target", "duplicate-old", "cross-slot", "missing-path-binding", "running", "unknown-owner", "already-active"] as const) {
      const sample = await fixture(), current = structuredClone(sample.current), previous = structuredClone(sample.previous), options = { ...sample.options };
      if (["foreign-job", "running-job", "no-backup-flag"].includes(mutation)) {
        const job = JSON.parse(fs.readFileSync(sample.jobFile, "utf8"));
        if (mutation === "foreign-job") job.items[0].productId = crypto.randomUUID();
        if (mutation === "running-job") job.status = "running";
        if (mutation === "no-backup-flag") job.items[0].backupCreated = false;
        fs.writeFileSync(sample.jobFile, JSON.stringify(job));
      }
      if (mutation === "no-approval") previous.approvedAt = null;
      if (mutation === "body") current.composition.sections[0].body = ["다른 본문"];
      if (mutation === "hashtags") current.hashtags = ["변경된태그"];
      if (mutation === "text-node") current.composition.renderNodes[1] = { kind: "paragraph", sectionId: "target", text: "다른 발행 문장" };
      if (mutation === "snapshot") current.sourceSnapshot!.product.name = "다른 상품";
      if (mutation === "wrong-current") options.currentAssetKey = "e".repeat(64);
      if (mutation === "wrong-retained") options.retainedSha256 = "f".repeat(64);
      if (mutation === "wrong-section") options.sectionId = "normal";
      if (mutation === "old-provenance") previous.imageAssets![0].provenance = "GENERATED_BACKGROUND";
      if (mutation === "old-reference") previous.imageAssets![0].referenceScene!.checks!.silhouette = false;
      if (mutation === "old-pixels") fs.appendFileSync(sample.retained, "changed");
      if (mutation === "normal-pixels") fs.appendFileSync(sample.other, "changed");
      if (mutation === "foreign-source") { const receipt = JSON.parse(fs.readFileSync(sample.receipt, "utf8")); receipt.sourceUrl = "https://shop-phinf.pstatic.net/foreign.png"; fs.writeFileSync(sample.receipt, JSON.stringify(receipt)); }
      if (mutation === "duplicate-target") current.composition.sections[0].imagePaths.push(sample.other);
      if (mutation === "duplicate-old") previous.imageAssets!.push(previous.imageAssets![0]);
      if (mutation === "cross-slot") current.composition.sections[1].imagePaths = [sample.replacement];
      if (mutation === "missing-path-binding") current.bodyImagePaths = [sample.other];
      if (mutation === "running" || mutation === "unknown-owner") current.imageGeneration = { status: mutation === "running" ? "running" : "complete", recoveryState: mutation === "unknown-owner" ? "owner-unknown" : undefined } as never;
      if (mutation === "already-active") { current.imageAssets![0] = previous.imageAssets![0]; current.composition.sections[0].imagePaths = [sample.retained]; }
      fs.writeFileSync(path.join(sample.backup, "manifest.json"), JSON.stringify(previous)); fs.writeFileSync(sample.manifestFile, JSON.stringify(current));
      assert.throws(() => planRetainedBrandPostSceneRestoration(options), /RETAINED_SCENE_RESTORE_INVALID/, mutation); checks++;
    }
    for (const failure of ["source-reject", "scene-reject", "provider", "incomplete-verdict", "source-race", "manifest-race", "backup-race", "receipt-race", "new-source-conflict"] as const) {
      const sample = await fixture(), before = fs.readFileSync(sample.manifestFile);
      const dependencies = { ...sample.dependencies,
        selectSource: async () => {
          if (failure === "source-reject") throw new Error("PRODUCT_REFERENCE_REQUIRED: no matching source");
          if (failure === "provider") throw Object.assign(new Error("QA unavailable"), { code: "CODEX_AUTH_REQUIRED" });
          return sample.source;
        }, reviewScene: async () => {
          if (failure === "scene-reject") throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: actual different product");
          if (failure === "source-race") fs.appendFileSync(sample.reference, "changed");
          if (failure === "manifest-race") fs.writeFileSync(sample.manifestFile, JSON.stringify({ ...sample.current, title: "concurrent edit preserved" }));
          if (failure === "backup-race") fs.appendFileSync(path.join(sample.backup, "manifest.json"), " ");
          if (failure === "receipt-race") fs.appendFileSync(sample.receipt, " ");
          if (failure === "new-source-conflict") {
            const file = path.join(sample.root, "product-sources/conflict.png"); fs.copyFileSync(sample.other, file);
            const receipt = JSON.parse(fs.readFileSync(sample.receipt, "utf8")); receipt.sha256 = hash(file);
            fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify(receipt));
          }
          const review = { ...sample.previous.imageAssets![0].referenceScene!, checks: { ...sample.previous.imageAssets![0].referenceScene!.checks } };
          if (failure === "incomplete-verdict") review.checks.silhouette = false;
          return review;
        } };
      await assert.rejects(restoreRetainedBrandPostScene(sample.options, dependencies), /REFERENCE_|PRODUCT_|QA unavailable|RETAINED_/);
      if (failure !== "manifest-race") assert.deepEqual(fs.readFileSync(sample.manifestFile), before);
      else assert.equal(JSON.parse(fs.readFileSync(sample.manifestFile, "utf8")).title, "concurrent edit preserved");
      const current = JSON.parse(fs.readFileSync(sample.manifestFile, "utf8")); assert.equal(current.imageAssets[0].sha256, sample.options.currentAssetKey);
      checks += 3;
    }
    console.log(`Retained-scene restoration: ${checks} offline checks passed; original metadata/pixels and manuscript preserved; generation/network/publish calls 0; final approval required.`);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData;
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

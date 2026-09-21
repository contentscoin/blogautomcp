import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { isDraftEditorialQualityPassed } from "../src/lib/brand-post-quality-display";
import { preserveProductPhotoSource } from "./lib/product-photo-provenance";

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "section-image-repair-"));
  process.env.DESKTOP_USER_DATA = temp;
  const store = await import("../src/lib/brand-post-package");
  const { repairBrandPostImages, planSectionImageRequests, cancelBrandPostImageRepairs } = await import("../src/lib/brand-post-image-repair");
  const { resolvePostDocument } = await import("../src/lib/post-composition-contract");
  try {
    for (const connectKind of ["TRAVEL", "SHOPPING"] as const) {
      const id = `fixture-${connectKind}`;
      const dir = store.getBrandPostPackageDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const paths = [0, 1, 2].map((n) => path.join(dir, `${n}.png`));
      paths.forEach((file, i) => fs.writeFileSync(file, `original-${i}`));
      const markdown = path.join(dir, "post.md");
      fs.writeFileSync(markdown, "검증된 본문은 이미지 보강 중 바뀌지 않습니다.");
      const composition = resolvePostDocument({
        connectKind, title: "규슈 사가 여행 3일 장소별 안내",
        sections: Array.from({ length: connectKind === "TRAVEL" ? 10 : 7 }, (_, i) => `장소 ${i + 1}\n\n${"확인된 장소의 특징과 여행 장면을 연결한 내용입니다. ".repeat(9)}`),
        imagePaths: paths, hashtags: ["여행", "장소", "규슈"], connectUrl: "https://example.test/", qualityPreset: "PREMIUM",
      });
      const fixture: import("../src/lib/brand-post-package").BrandPostPackageManifestV2 = {
        version: "brand-post-package/v2", brandLinkId: id, connectKind, title: composition.title,
        generationSource: "AI", markdownPath: markdown, heroImagePath: paths[0], bodyImagePaths: paths.slice(1),
        hashtags: [], imagePolicy: connectKind === "TRAVEL" ? "TRAVEL_EDITORIAL" : "LOCKED_PRODUCT_OR_ORIGINAL",
        createdAt: new Date().toISOString(), approvedAt: null, contractVersion: "post-composition-contract/v1", composition,
        contentQuality: { canPublish: false, code: "composition-quality", reason: "이미지 부족", score: 100, summary: "이미지 준비 필요", signals: [{ key: "composition-quality", label: "구성", status: "fail" }] } as never,
        thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1000, height: 1000, aspect: "1:1" }, style: "test", sourcePolicy: "TRAVEL_EDITORIAL", sourceImagePath: paths[0] },
      };
      if (connectKind === "SHOPPING") {
        const legacy = structuredClone(fixture);
        const first = legacy.composition.sections[0];
        const old = `${first.title}: AI 연출 이미지: 검증된 상품 원형을 보존한 생활 공간 배치. 기능 시연이나 실제 사용 후기 사진이 아님`;
        first.imageIntent = old; first.imagePaths = [];
        assert.match(store.reconcileBrandPostPackageQuality(legacy).composition.sections[0].imageIntent, /원본 사용 장면/u);
        const strict = structuredClone(legacy);
        strict.imageRequirements = { policy: "generated-required" } as typeof strict.imageRequirements;
        assert.equal(store.reconcileBrandPostPackageQuality(strict).composition.sections[0].imageIntent, old);
        const completed = structuredClone(legacy);
        completed.composition.sections[0].imagePaths = [paths[1]];
        completed.imageAssets = [{ path: paths[1], sourcePath: paths[1], sha256: crypto.createHash("sha256").update(fs.readFileSync(paths[1])).digest("hex"),
          role: "body", sectionId: first.id, provenance: "LOCKED_PRODUCT", creationMethod: "source-with-generated-background",
          remoteGenerated: true, imageIntent: old, slotId: `${first.id}:image:1` }];
        const kept = store.reconcileBrandPostPackageQuality(completed);
        assert.equal(kept.composition.sections[0].imageIntent, old, "completed generated prompt binding must not be migrated");
        assert.deepEqual(kept.imageAssets, completed.imageAssets, "completed image metadata and hashes remain intact");
      }
      store.writeBrandPostPackageManifest(fixture);
      const plan = planSectionImageRequests(store.packagePreview(fixture).imageSlots);
      const requiredSections = composition.sections.filter(section => (section.imageMin || 0) > 0);
      const requiredImages = requiredSections.reduce((sum, section) => sum + (section.imageMin || 0), 0);
      assert.equal(plan.length, requiredImages, "Only explicit contract deficits are planned");
      assert.equal(new Set(plan.map((r) => r.sectionId)).size, requiredSections.length);
      assert.equal(new Set(plan.filter((r) => r.replaceAssetKey).map((r) => r.replaceAssetKey)).size, plan.filter((r) => r.replaceAssetKey).length);
      const deps: import("../src/lib/brand-post-image-repair").ImageRepairDependencies = {
        read: store.readBrandPostPackage, write: store.writeBrandPostPackageManifest, apply: store.applyGeneratedBrandPostImage,
        generate: async (options) => {
          const results: import("../src/lib/brand-post-image-generation").BrandPostImageGenerationResult[] = [];
          for (const [i, request] of options.requests.entries()) {
            const file = path.join(dir, `new-${request.requestId}.png`);
            fs.writeFileSync(file, `generated-${request.requestId}`);
            const sectionIntent = composition.sections.find(section => section.id === request.sectionId)?.imageIntent || "해당 섹션 장면";
            let sourceReview: import("../src/lib/brand-post-package").BrandPostPackageImageAsset["sourceReview"];
            if (connectKind === "SHOPPING" && i > 0) {
              const source = path.join(dir, `source-${request.requestId}.png`);
              fs.writeFileSync(source, `feature-source-${request.requestId}`);
              const receipt = preserveProductPhotoSource({ sourcePath: source, outputPath: file, segmented: true });
              sourceReview = {
                version: "product-photo-source-review/v1",
                sourceSha256: receipt.sourceSha256,
                usage: "section-matched-product-evidence",
                sectionIntent,
                reviewClass: "feature-evidence",
                reason: "fixture feature evidence",
                reviewedAt: "2026-09-15T00:00:00.000Z",
              };
            }
            const result = {
              ...request,
              generatedPath: i === 0 ? null : file,
              error: i === 0 ? "fixture timeout" : undefined,
              provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" as const : "GENERATED_BACKGROUND" as const,
              creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" as const : "remote-generated" as const,
              remoteGenerated: true,
              imageIntent: sectionIntent,
              sourceReview,
            };
            results.push(result);
            await options.onResult?.(result);
            if (i === 1) assert.equal(store.readBrandPostPackage(id)?.imageGeneration?.applied, 1, "A success must be persisted before batch completion");
          }
          return results;
        },
      };
      const first = await repairBrandPostImages({ brandLinkId: id }, deps);
      assert.equal(first.generatedCount, plan.length - 1, "Early failure must not starve later sections or double apply callbacks");
      assert.equal(first.remaining, 1);
      assert.equal(first.manifest.imageGeneration?.status, "incomplete");
      assert.equal(first.manifest.contentQuality?.score, 100, "Image changes cannot replace editorial score");
      assert.equal(first.manifest.approvedAt, null);
      const pending = planSectionImageRequests(store.packagePreview(first.manifest).imageSlots);
      assert.equal(pending.length, 1, "Retry only the missing slot");
      deps.generate = async (options) => {
        const request = options.requests[0];
         const file = path.join(dir, "last.png"); fs.writeFileSync(file, "last-generated");
         const sectionIntent = composition.sections.find(section => section.id === request.sectionId)?.imageIntent || "장면";
         let sourceReview: import("../src/lib/brand-post-package").BrandPostPackageImageAsset["sourceReview"];
         if (connectKind === "SHOPPING") {
           const source = path.join(dir, "last-source.png");
           fs.writeFileSync(source, "last-feature-source");
           const receipt = preserveProductPhotoSource({ sourcePath: source, outputPath: file, segmented: true });
           sourceReview = {
             version: "product-photo-source-review/v1",
             sourceSha256: receipt.sourceSha256,
             usage: "section-matched-product-evidence",
             sectionIntent,
             reviewClass: "feature-evidence",
             reason: "fixture feature evidence",
             reviewedAt: "2026-09-15T00:00:00.000Z",
           };
         }
         return [{
          ...request,
          generatedPath: file,
          provenance: connectKind === "SHOPPING" ? "LOCKED_PRODUCT" as const : "GENERATED_BACKGROUND" as const,
          creationMethod: connectKind === "SHOPPING" ? "source-with-generated-background" as const : "remote-generated" as const,
           remoteGenerated: true,
           imageIntent: sectionIntent,
           sourceReview,
        }];
      };
      const final = await repairBrandPostImages({ brandLinkId: id }, deps);
      assert.equal(final.remaining, 0);
      assert.equal(final.manifest.composition.qualityReport.imageCoverage.missingSectionIds.length, 0);
      assert.equal(final.manifest.contentQuality?.score, 100);
      assert.equal(fs.readFileSync(markdown, "utf8"), "검증된 본문은 이미지 보강 중 바뀌지 않습니다.");
      assert.ok(final.manifest.composition.sections.every((s) => s.imagePaths.length >= (s.imageMin || 0)));
      assert.throws(() => store.applyGeneratedBrandPostImage({
        brandLinkId: id, sectionId: final.manifest.composition.sections[0].id,
        generatedPath: final.manifest.composition.sections[0].imagePaths[0],
        provenance: "GENERATED_BACKGROUND",
      }), /동일한 파일/u, "Copied images must not masquerade as new section generation");
      store.writeBrandPostPackageManifest({ ...final.manifest, approvedAt: "fixture-approved" });
      const noop = await repairBrandPostImages({ brandLinkId: id }, { ...deps, generate: async () => { throw new Error("No-op must not generate"); } });
      assert.equal(noop.manifest.approvedAt, "fixture-approved");
      const missingPath = final.manifest.composition.sections[0].imagePaths[0];
      fs.unlinkSync(missingPath);
      const missingPreview = store.packagePreview(store.readBrandPostPackage(id)!);
      assert.ok(missingPreview.imageSlots[0].missing > 0, "Missing files cannot satisfy verified image coverage");
      assert.throws(() => store.approveBrandPostPackage(id), /이미지/u);
      const beforeChange = store.readBrandPostPackage(id)!;
      await assert.rejects(repairBrandPostImages({ brandLinkId: id }, {
        ...deps,
        generate: async (options) => {
          const replacement = { ...store.readBrandPostPackage(id)!, title: "외부에서 교체된 새 원고" };
          store.writeBrandPostPackageManifest(replacement);
          const file = path.join(dir, "late.png"); fs.writeFileSync(file, "late-old-draft-result");
          return [{ ...options.requests[0], generatedPath: file, provenance: "GENERATED_BACKGROUND", imageIntent: "이전 원고" }];
        },
      }), /원고가 변경/u);
      const replaced = store.readBrandPostPackage(id)!;
      assert.equal(replaced.title, "외부에서 교체된 새 원고");
      assert.deepEqual(replaced.bodyImagePaths, beforeChange.bodyImagePaths, "Late results must not modify the replacement draft");
      const cancelled = await repairBrandPostImages({ brandLinkId: id }, {
        ...deps,
        generate: async (options) => {
          assert.equal(cancelBrandPostImageRepairs(), 1);
          assert.equal(options.signal?.aborted, true);
          const file = path.join(dir, "cancelled.png"); fs.writeFileSync(file, "cancelled-late-result");
          const result = { ...options.requests[0], generatedPath: file, provenance: "GENERATED_BACKGROUND" as const, imageIntent: "중지된 생성" };
          await options.onResult?.(result);
          return [result];
        },
      });
      assert.equal(cancelled.generatedCount, 0);
      assert.match(cancelled.warning || "", /중지/u);
      assert.equal(cancelBrandPostImageRepairs(), 0, "Cancellation registration must be cleaned up");

      if (connectKind === "TRAVEL") {
        // ChatGPT 대화(내장 이미지 생성)에서 받은 이미지를 슬롯에 붙이는 외부 적용 경로. 브라우저 배치를 거치지 않는다.
        type ManifestV2 = import("../src/lib/brand-post-package").BrandPostPackageManifestV2;
        const generation = await import("../src/lib/brand-post-image-generation");
        const current = store.readBrandPostPackage(id) as ManifestV2;
        const slotWithRoom = store.packagePreview(current).imageSlots.find((slot) => slot.maximum > 0 && slot.count < slot.maximum);
        assert.ok(slotWithRoom, "fixture must leave one slot with room for an external image");
        const targetSectionId = slotWithRoom.sectionId;
        const externalRaw = path.join(dir, "image-generation-work", "external-download.png");
        fs.mkdirSync(path.dirname(externalRaw), { recursive: true });
        fs.writeFileSync(externalRaw, "chatgpt-built-in-imagegen-result");
        const applied = await generation.applyExternalGeneratedBrandPostImage({
          brandLinkId: id, manifest: current, productName: current.title, sectionId: targetSectionId, rawPath: externalRaw,
        });
        assert.equal(applied.alreadyApplied, false);
        assert.ok(applied.assetKey && /^[a-f0-9]{64}$/u.test(applied.assetKey));
        assert.equal(applied.provenance, "GENERATED_BACKGROUND", "Travel body images are applied as-is");
        assert.equal(applied.manifest.approvedAt, null, "Applying an image invalidates any approval");
        const after = store.packagePreview(applied.manifest).imageSlots.find((slot) => slot.sectionId === targetSectionId)!;
        assert.equal(after.count, slotWithRoom.count + 1);
        assert.ok(after.assets.some((asset) => asset?.assetKey === applied.assetKey));
        const retry = await generation.applyExternalGeneratedBrandPostImage({
          brandLinkId: id, manifest: applied.manifest, productName: current.title, sectionId: targetSectionId, rawPath: externalRaw,
        });
        assert.equal(retry.alreadyApplied, true, "Same bytes to the same slot are idempotent");
        assert.equal(retry.assetKey, applied.assetKey);
        const afterRetry = store.packagePreview(store.readBrandPostPackage(id) as ManifestV2).imageSlots.find((slot) => slot.sectionId === targetSectionId)!;
        assert.equal(afterRetry.count, after.count, "Retry must not attach a second copy");
        const anotherSlot = store.packagePreview(applied.manifest).imageSlots.find((slot) =>
          slot.sectionId !== targetSectionId && slot.maximum > 0 && slot.count < slot.maximum);
        assert.ok(anotherSlot, "fixture must leave another section for the cross-slot duplicate check");
        await assert.rejects(generation.applyExternalGeneratedBrandPostImage({
          brandLinkId: id, manifest: applied.manifest, productName: current.title,
          sectionId: anotherSlot.sectionId, rawPath: externalRaw,
        }), /동일한 파일/u, "Identical bytes in another slot are a duplicate, not an idempotent retry");
        await assert.rejects(generation.applyExternalGeneratedBrandPostImage({
          brandLinkId: id, manifest: store.readBrandPostPackage(id) as ManifestV2, productName: current.title, sectionId: "missing-section", rawPath: externalRaw,
        }), /본문 파트를 찾을 수 없습니다/u);
      }
    }

    const bindId = "fixture-source-binding";
    const bindDir = store.getBrandPostPackageDir(bindId);
    fs.mkdirSync(bindDir, { recursive: true });
    const bindHero = path.join(bindDir, "hero.png");
    const bindSource = path.join(bindDir, "reviewed-source.jpg");
    fs.writeFileSync(bindHero, "source-binding-hero");
    fs.writeFileSync(bindSource, "source-binding-body");
    const bindMarkdown = path.join(bindDir, "post.md");
    fs.writeFileSync(bindMarkdown, "검증 원본 배정 테스트");
    const bindComposition = resolvePostDocument({
      connectKind: "SHOPPING", title: "검증 원본 배정 테스트",
      sections: Array.from({ length: 7 }, (_, index) => `상품 파트 ${index + 1}\n\n${"검증된 제품 사실과 구매 판단을 연결합니다. ".repeat(8)}`),
      imagePaths: [bindHero, bindSource], hashtags: ["상품"], connectUrl: "https://example.test/", qualityPreset: "PREMIUM",
    });
    const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const sourceHash = hash(bindSource);
    const bindManifest: import("../src/lib/brand-post-package").BrandPostPackageManifestV2 = {
      version: "brand-post-package/v2", brandLinkId: bindId, connectKind: "SHOPPING", title: bindComposition.title,
      generationSource: "AI", markdownPath: bindMarkdown, heroImagePath: bindHero, bodyImagePaths: [bindSource],
      imageAssets: [
        { path: bindHero, sourcePath: bindHero, sha256: hash(bindHero), role: "hero", provenance: "LOCKED_PRODUCT", creationMethod: "source" },
        { path: bindSource, sourcePath: bindSource, sha256: sourceHash, role: "body", sectionId: null, provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false },
      ],
      hashtags: ["상품"], imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", createdAt: new Date().toISOString(), approvedAt: null,
      contractVersion: "post-composition-contract/v1", composition: bindComposition,
      contentQuality: { canPublish: false, code: "composition-quality", reason: "이미지 부족", score: 100, summary: "이미지 준비", signals: [{ key: "composition-quality", label: "구성", status: "fail" }] } as never,
      thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1080, height: 1080, aspect: "1:1" }, style: "test", sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL", sourceImagePath: bindHero },
    };
    store.writeBrandPostPackageManifest(bindManifest);
    const target = bindComposition.sections.find(section => (section.imageMin || 0) > 0)!;
    const bound = store.applyGeneratedBrandPostImage({
      brandLinkId: bindId, sectionId: target.id, generatedPath: bindSource, bindExistingAssetKey: sourceHash,
      provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
      imageIntent: target.imageIntent,
      sourceReview: { version: "product-photo-source-review/v1", sourceSha256: sourceHash,
        usage: "section-matched-product-evidence", sectionIntent: target.imageIntent,
        reviewClass: "product-photo", reason: "fixture match", reviewedAt: new Date().toISOString() },
    });
    assert.equal(bound.imageAssets?.length, 2, "binding reuses the reviewed bytes instead of copying a duplicate");
    assert.equal(bound.bodyImagePaths.filter(file => path.resolve(file) === path.resolve(bindSource)).length, 1);
    assert.deepEqual(bound.composition.sections.find(section => section.id === target.id)?.imagePaths, [bindSource]);
    assert.equal(bound.imageAssets?.find(asset => asset.sha256 === sourceHash)?.sourceReview?.reviewClass, "product-photo");
    const refreshed = store.applyGeneratedBrandPostImage({
      brandLinkId: bindId, sectionId: target.id, slotId: `${target.id}:image:1`,
      generatedPath: bindSource, bindExistingAssetKey: sourceHash, replaceAssetKey: sourceHash,
      provenance: "ORIGINAL", creationMethod: "source", remoteGenerated: false,
      imageIntent: target.imageIntent,
      sourceReview: { version: "product-photo-source-review/v1", sourceSha256: sourceHash,
        usage: "section-matched-product-evidence", sectionIntent: target.imageIntent,
        reviewClass: "feature-evidence", reason: "fixture re-review", reviewedAt: new Date().toISOString() },
    });
    assert.equal(refreshed.imageAssets?.length, 2, "same-SHA re-review updates metadata without copying an asset");
    assert.equal(refreshed.imageAssets?.find(asset => asset.sha256 === sourceHash)?.path, bindSource);
    assert.equal(refreshed.imageAssets?.find(asset => asset.sha256 === sourceHash)?.sourceReview?.reviewClass, "feature-evidence");
    assert.equal(refreshed.imageAssets?.find(asset => asset.sha256 === sourceHash)?.slotId, `${target.id}:image:1`);
    assert.throws(() => store.applyGeneratedBrandPostImage({
      brandLinkId: bindId, sectionId: bindComposition.sections[1].id, generatedPath: bindSource,
      bindExistingAssetKey: sourceHash, provenance: "ORIGINAL", creationMethod: "source",
      sourceReview: { version: "product-photo-source-review/v1", sourceSha256: sourceHash,
        usage: "general-product-context", sectionIntent: bindComposition.sections[1].imageIntent, reviewedAt: new Date().toISOString() },
    }), /미배정/u, "one reviewed source cannot satisfy multiple section slots");

    assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [{ key: "composition-quality", status: "fail" }] }), true);
    assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [{ key: "fact-grounding", status: "fail" }] }), false);
    console.log("PASS: all-section planning, 2-image minima, partial success persistence, late sections, retry-only deficits, score isolation (travel + shopping), external image apply (idempotent)");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

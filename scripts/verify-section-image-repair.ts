import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDraftEditorialQualityPassed } from "../src/lib/brand-post-quality-display";

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
      store.writeBrandPostPackageManifest(fixture);
      const plan = planSectionImageRequests(store.packagePreview(fixture).imageSlots);
      assert.ok(plan.length > 4, "All sections must be planned, not just first four");
      assert.equal(new Set(plan.map((r) => r.sectionId)).size, composition.sections.length);
      assert.equal(new Set(plan.filter((r) => r.replaceAssetKey).map((r) => r.replaceAssetKey)).size, plan.filter((r) => r.replaceAssetKey).length);
      const deps: import("../src/lib/brand-post-image-repair").ImageRepairDependencies = {
        read: store.readBrandPostPackage, write: store.writeBrandPostPackageManifest, apply: store.applyGeneratedBrandPostImage,
        generate: async (options) => {
          const results: import("../src/lib/brand-post-image-generation").BrandPostImageGenerationResult[] = [];
          for (const [i, request] of options.requests.entries()) {
            const file = path.join(dir, `new-${request.requestId}.png`);
            fs.writeFileSync(file, `generated-${request.requestId}`);
            const result = { ...request, generatedPath: i === 0 ? null : file, error: i === 0 ? "fixture timeout" : undefined, provenance: "GENERATED_BACKGROUND" as const, imageIntent: "해당 섹션 장면" };
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
        return [{ ...request, generatedPath: file, provenance: "GENERATED_BACKGROUND", imageIntent: "장면" }];
      };
      const final = await repairBrandPostImages({ brandLinkId: id }, deps);
      assert.equal(final.remaining, 0);
      assert.equal(final.manifest.composition.qualityReport.imageCoverage.missingSectionIds.length, 0);
      assert.equal(final.manifest.contentQuality?.score, 100);
      assert.equal(fs.readFileSync(markdown, "utf8"), "검증된 본문은 이미지 보강 중 바뀌지 않습니다.");
      assert.ok(final.manifest.composition.sections.every((s) => s.imagePaths.length >= 1));
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
      assert.ok(missingPreview.imageSlots[0].generationMissing > 0, "Missing files cannot satisfy generated coverage");
      assert.throws(() => store.approveBrandPostPackage(id), /섹션 이미지 품질 게이트/u);
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
    }
    assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [{ key: "composition-quality", status: "fail" }] }), true);
    assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [{ key: "fact-grounding", status: "fail" }] }), false);
    console.log("PASS: all-section planning, 2-image minima, partial success persistence, late sections, retry-only deficits, score isolation (travel + shopping)");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

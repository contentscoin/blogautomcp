/** Offline regression: source recovery, provenance, download bounds and strict photo QC. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
import * as provenance from "./lib/product-photo-provenance";
import { copyProductPhotoSource, preserveProductPhotoSource, readProductPhotoSource } from "./lib/product-photo-provenance";
import { downloadProductSourcePhoto, isAllowedProductPhotoUrl, selectShoppingProductSource, selectShoppingProductSources } from "./lib/product-photo-source";
import { createLockedProductThumbnail, createLockedProductThumbnailOnBackground, createLockedProductEditorialScene,
  createOriginalProductPhotoThumbnail, createOriginalProductPhotoOnBackground } from "./lib/product-image-lock";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shopping-source-regression-"));
  const originalFetch = globalThis.fetch;
  // Runtime test guard: any accidental provider/network use fails immediately.
  globalThis.fetch = async () => { throw new Error("Network forbidden in this fixture"); };
  try {
    const source = path.join(dir, "source.png");
    const canvas = Buffer.alloc(120 * 100 * 4, 255);
    for (let y = 20; y < 85; y++) for (let x = 35; x < 90; x++) {
      const pixel = (y * 120 + x) * 4;
      canvas[pixel] = 17; canvas[pixel + 1] = 99; canvas[pixel + 2] = 181;
    }
    await sharp(canvas, { raw: { width: 120, height: 100, channels: 4 } }).png().toFile(source);
    const originalBytes = fs.readFileSync(source);
    const background = path.join(dir, "background.png");
    await sharp({ create: { width: 1200, height: 900, channels: 4, background: "#cbd5e1" } }).png().toFile(background);
    const options = { sourcePath: source, outputDir: path.join(dir, "worker"), productName: "테스트 상품", headline: "원본 사진", subline: "확인된 정보" };
    const composites = [
      await createLockedProductThumbnail(options),
      await createLockedProductThumbnailOnBackground({ ...options, backgroundPath: background }),
      await createLockedProductEditorialScene({ ...options, backgroundPath: background }),
      await createOriginalProductPhotoThumbnail(options),
      await createOriginalProductPhotoOnBackground({ ...options, backgroundPath: background }),
    ];
    for (const [index, composite] of composites.entries()) {
      const record = readProductPhotoSource(composite.outputPath);
      assert.ok(record, `every output retains source provenance (${index})`);
      assert.deepEqual(fs.readFileSync(record.sourcePath), originalBytes);
      assert.equal(record.segmented, index === 1 || index === 2);
      assert.equal(record.provenance, index === 0 || index === 3 ? "PHOTO_TEXT_THUMBNAIL" : index < 3 ? "LOCKED_PRODUCT" : "EDITORIAL_CARD");
    }
    const packaged = path.join(dir, "package", "hero.png");
    fs.mkdirSync(path.dirname(packaged), { recursive: true });
    fs.copyFileSync(composites[0].outputPath, packaged);
    assert.equal(copyProductPhotoSource(composites[0].outputPath, packaged), true);
    fs.unlinkSync(source);
    fs.rmSync(options.outputDir, { recursive: true, force: true });
    const recovered = readProductPhotoSource(packaged);
    assert.ok(recovered, "hero-only package retains the original after complete worker-temp cleanup");
    assert.ok(recovered.sourcePath.startsWith(path.dirname(packaged) + path.sep));
    assert.deepEqual(fs.readFileSync(recovered.sourcePath), originalBytes);
    // Exercise the real generation preflight on the former failure shape:
    // a sole photo thumbnail, no ORIGINAL assets, and deleted worker paths.
    const generationModule = { exports: {} as { prepareBrandPostImageReferenceContext: (options: unknown) => Promise<{ reference: { path: string } }> } };
    const generationDependencies: Record<string, unknown> = {
      "../../scripts/lib/product-photo-provenance": provenance,
      "../../scripts/lib/product-photo-source": {
        readSavedProductSourceCandidates: () => [],
        collectShoppingProductSourceCandidates: async (input: { localCandidates: string[] }) => input.localCandidates.filter(file => fs.readFileSync(file).equals(originalBytes)),
      },
      "../../scripts/lib/shopping-reference-scene": {
        SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION: "shopping-reference-scene/v2",
        selectShoppingSceneReference: async (input: { paths: string[] }) => {
          assert.equal(input.paths.length, 1, "only retained original pixels are collected; the headline thumbnail is not a scene reference");
          return { path: input.paths[0], sha256: crypto.createHash("sha256").update(fs.readFileSync(input.paths[0])).digest("hex"),
            subject: "selected product", geometry: "intact product", labels: "none visible", reviewedAt: "fixture" };
        },
        buildShoppingReferenceScenePrompt: () => "natural photo with attached original",
      },
      "../../scripts/lib/product-photo-review": { selectVerifiedProductSectionImages: async () => [] },
      "../../scripts/lib/product-image-lock": {}, "../../scripts/lib/product-thumbnail": {},
      "../../scripts/lib/travel-content": {}, "../../scripts/lib/travel-thumbnail": {},
      "../../scripts/lib/image-timeout-policy": { imageJobBudgetMs: () => 1 },
      "./chatgpt-browser-automation": {},
      "./brand-post-package": { getBrandPostPackageDir: () => path.dirname(packaged), normalizePackageImageAssets: (manifest: { imageAssets: unknown[] }) => manifest.imageAssets },
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/brand-post-image-generation.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, {
      module: generationModule, exports: generationModule.exports, process,
      require: (name: string) => name in generationDependencies ? generationDependencies[name] : createRequire(path.resolve("src/lib/brand-post-image-generation.ts"))(name),
    });
    const referenceContext = await generationModule.exports.prepareBrandPostImageReferenceContext({
      manifest: { brandLinkId: "hero-only", title: "미닉스 상품", connectKind: "SHOPPING", sourceSnapshot: { snapshotId: "fixture", product: { name: "미닉스 상품", features: [] } },
        composition: { sections: [], renderNodes: [] },
        imageAssets: [{ path: packaged, sourcePath: composites[0].outputPath, provenance: "PHOTO_TEXT_THUMBNAIL" }] },
      productName: "미닉스 상품", target: { role: "body", imageSource: "staged-ai", imageIntent: "자연스러운 AI 연출 이미지", request: { slotId: "scene:image:1" } },
    });
    assert.equal(referenceContext.reference.path, recovered.sourcePath);
    // A record cannot bless edited output bytes or edited source bytes.
    const outputBytes = fs.readFileSync(packaged);
    fs.writeFileSync(packaged, "changed output");
    assert.equal(readProductPhotoSource(packaged), null);
    fs.writeFileSync(packaged, outputBytes);
    fs.writeFileSync(recovered.sourcePath, "changed source");
    assert.equal(readProductPhotoSource(packaged), null);
    fs.writeFileSync(recovered.sourcePath, originalBytes);
    assert.ok(readProductPhotoSource(packaged));
    const badCopy = path.join(dir, "different.png");
    fs.writeFileSync(badCopy, "different bytes");
    assert.throws(() => copyProductPhotoSource(packaged, badCopy), /일치하지/);
    assert.equal(copyProductPhotoSource(badCopy, packaged), false, "unrecorded outputs cannot invent provenance");

    // New records always preserve source bytes, not the displayed thumbnail.
    preserveProductPhotoSource({ sourcePath: recovered.sourcePath, outputPath: packaged, segmented: true });
    const oldRecord = { ...readProductPhotoSource(packaged)!, version: "original-photo-background/v1", segmented: false, provenance: "EDITORIAL_CARD" };
    fs.writeFileSync(`${packaged}.source.json`, JSON.stringify(oldRecord));
    assert.equal(readProductPhotoSource(packaged)?.sourcePath, recovered.sourcePath, "legacy full-photo records remain readable");

    const urls = ["https://shop-phinf.pstatic.net/deleted.jpg", "https://shop-phinf.pstatic.net/notice.jpg", "https://shop-phinf.pstatic.net/product.jpg"];
    const downloaded: string[] = [];
    const reviewed: string[][] = [];
    const deps = {
      download: async (url: string) => { downloaded.push(url); if (url === urls[0]) throw new Error("HTTP404"); return url === urls[1] ? "notice" : "actual-product"; },
      verify: async (files: string[], name: string) => { reviewed.push(files); assert.equal(name, "미닉스 미니건조기"); return files.includes("actual-product") ? "actual-product" : null; },
    };
    assert.equal(await selectShoppingProductSource({ localCandidates: ["old-composite"], productName: "미닉스 미니건조기", sourceImageUrls: urls, outputDir: dir }, deps), "actual-product");
    assert.deepEqual(downloaded, urls, "removed photo and rejected notice do not starve a valid seller photo");
    assert.deepEqual(reviewed, [["old-composite"], ["notice"], ["actual-product"]]);
    downloaded.length = 0;
    assert.equal(await selectShoppingProductSource({ localCandidates: ["actual-product"], productName: "미닉스 미니건조기", sourceImageUrls: urls, outputDir: dir }, deps), "actual-product");
    assert.equal(downloaded.length, 0, "existing verified source avoids all network retrieval");
    await assert.rejects(selectShoppingProductSource({ localCandidates: [], productName: "상품", sourceImageUrls: urls, outputDir: dir }, {
      download: deps.download, verify: async () => { throw new Error("CODEX_MODEL_INCOMPATIBLE"); },
    }), /CODEX_MODEL_INCOMPATIBLE/);
    await assert.rejects(selectShoppingProductSource({ localCandidates: [], productName: "미닉스 미니건조기", sourceImageUrls: urls.slice(0, 1), outputDir: dir }, deps), /PRODUCT_SOURCE_DOWNLOAD_FAILED/);
    assert.equal(await selectShoppingProductSource({ localCandidates: [], productName: "미닉스 미니건조기", sourceImageUrls: urls.slice(1, 2), outputDir: dir }, deps), null, "all rejected photos must block generation");
    const freshSource = path.join(dir, "fresh-source.png");
    fs.writeFileSync(freshSource, "fresh source pixels");
    const usedSourceHash = crypto.createHash("sha256").update(originalBytes).digest("hex");
    const selectedFresh = await selectShoppingProductSources({
      localCandidates: [recovered.sourcePath, freshSource],
      productName: "미닉스 미니건조기",
      outputDir: dir,
      maximum: 2,
      excludeSha256: [usedSourceHash],
    }, {
      verify: async (files, _name, maximum) => files.slice(0, maximum),
      download: async () => { throw new Error("no download expected"); },
    });
    assert.deepEqual(selectedFresh, [freshSource], "partial resume seeks fresh source hashes before reusing its safe palette");
    assert.equal(isAllowedProductPhotoUrl("https://d15zs6bxpcjiwz.cloudfront.net/Home/Dryers/DV21DG8600BW_spec.jpg"), true);
    for (const invalid of ["http://shop-phinf.pstatic.net/a", "https://pstatic.net.evil.test/a", "https://localhost/a", "https://user:pass@shop-phinf.pstatic.net/a", "https://shop-phinf.pstatic.net:8443/a",
      "https://other.cloudfront.net/a", "https://d15zs6bxpcjiwz.cloudfront.net.evil.test/a", "https://sub.d15zs6bxpcjiwz.cloudfront.net/a",
      "http://d15zs6bxpcjiwz.cloudfront.net/a", "https://user@d15zs6bxpcjiwz.cloudfront.net/a", "https://d15zs6bxpcjiwz.cloudfront.net:8443/a"])
      assert.equal(isAllowedProductPhotoUrl(invalid), false);

    // Fetch is stubbed, including redirect mode and streaming size limits.
    globalThis.fetch = async (_input, init) => { assert.equal(init?.redirect, "error"); return new Response(originalBytes, { headers: { "content-type": "image/png" } }); };
    const download = await downloadProductSourcePhoto(urls[2], path.join(dir, "downloads"));
    assert.deepEqual(fs.readFileSync(download), originalBytes);
    globalThis.fetch = async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } });
    await assert.rejects(downloadProductSourcePhoto(urls[2], dir), /형식/);
    globalThis.fetch = async () => new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\"/>", { headers: { "content-type": "image/svg+xml" } });
    await assert.rejects(downloadProductSourcePhoto(urls[2], dir), /사진 파일/);
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(13 * 1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "image/png" } });
    await assert.rejects(downloadProductSourcePhoto(urls[2], dir), /크기를 초과/);
    assert.equal(cancelled, true);
    globalThis.fetch = async () => { throw new Error("Network forbidden in this fixture"); };

    // Offline provider response fixture exercises real QC candidate deduplication.
    const copies = Array.from({ length: 13 }, (_, i) => path.join(dir, `notice-${i}.png`));
    copies.forEach(file => fs.writeFileSync(file, originalBytes));
    const actual = path.join(dir, "actual.png");
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#c5ad99" } }).png().toFile(actual);
    const code = ts.transpileModule(fs.readFileSync("scripts/lib/product-photo-review.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const photoReviewModule = { exports: {} as typeof import("./lib/product-photo-review") };
    let reviews = 0;
    vm.runInNewContext(code, { exports: photoReviewModule.exports, module: photoReviewModule, require: (name: string) => name === "./codex-draft-provider" ? {
      runCodexDraft: async (input: { imagePaths: string[] }) => { reviews++; return JSON.stringify({ productPhoto: input.imagePaths[0] === actual,
        reason: input.imagePaths[0] === actual ? "Selected product is visible" : "Notice, not the selected product" }); },
    } : createRequire(path.resolve("scripts/lib/product-photo-review.ts"))(name) });
    assert.equal(await photoReviewModule.exports.selectVerifiedProductPhoto([dir, "missing.png", ...copies, actual], "상품"), actual);
    assert.equal(reviews, 2, "13 copies of one notice consume only one review, preserving the true-photo candidate");
    assert.equal(await photoReviewModule.exports.selectVerifiedProductPhoto(copies, "상품"), null);
    assert.equal(reviews, 2, "negative byte reviews remain cached");
    const malformedAnswers = [
      JSON.stringify({ reason: "Missing decision" }),
      ...["true", "false", null, 1].map(productPhoto => JSON.stringify({ productPhoto, reason: "Wrong decision type" })),
      JSON.stringify({ productPhoto: true }), JSON.stringify({ productPhoto: false }),
      ...["", "   ", null, 1, {}].map(reason => JSON.stringify({ productPhoto: false, reason })),
      "broken JSON", "[]", "null", "true", JSON.stringify([{ productPhoto: true, reason: "Wrong top-level array" }]),
    ];
    for (const [index, malformed] of malformedAnswers.entries()) {
      let calls = 0;
      const rejected: unknown[] = [];
      const name = `malformed-photo-${index}`;
      const dependencies = { review: async () => {
        calls++;
        return calls === 1 ? malformed : JSON.stringify({ productPhoto: true, reason: "Valid complete selected product" });
      }, onRejection: (diagnostic: unknown) => rejected.push(diagnostic) };
      await assert.rejects(photoReviewModule.exports.selectVerifiedProductPhotos([actual], name, 1, dependencies), /REFERENCE_SCENE_REVIEW_INVALID/,
        `malformed response must not become a semantic photo rejection (${index})`);
      assert.equal(rejected.length, 0, "invalid response has no semantic rejection diagnostic");
      assert.deepEqual([...await photoReviewModule.exports.selectVerifiedProductPhotos([actual], name, 1, dependencies)], [actual],
        "a corrected response for the same bytes reaches fresh review instead of a malformed negative cache");
      assert.equal(calls, 2);
    }
    const candidateSha256 = crypto.createHash("sha256").update(fs.readFileSync(actual)).digest("hex");
    const diagnostics: Array<{ stage: string; candidateSha256: string; failedChecks: string[]; reason: string }> = [];
    let rejectionCalls = 0;
    const rejectedPhoto = { review: async () => { rejectionCalls++; return JSON.stringify({ productPhoto: false, reason: "Visible product is a different model" }); },
      onRejection: (diagnostic: unknown) => diagnostics.push(JSON.parse(JSON.stringify(diagnostic))) };
    assert.deepEqual([...await photoReviewModule.exports.selectVerifiedProductPhotos([actual, actual], "valid-rejection", 12, rejectedPhoto)], []);
    assert.equal(rejectionCalls, 1);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].stage, "seller-product-photo");
    assert.equal(diagnostics[0].candidateSha256, candidateSha256);
    assert.deepEqual(diagnostics[0].failedChecks, ["productPhoto"]);
    assert.equal(diagnostics[0].reason, "Visible product is a different model");
    assert.deepEqual([...await photoReviewModule.exports.selectVerifiedProductPhotos([actual], "valid-rejection", 12, rejectedPhoto)], []);
    assert.equal(rejectionCalls, 1, "valid false verdict reuses the negative byte cache");
    assert.equal(diagnostics.length, 2, "cached rejection still reports the candidate and reason");
    assert.deepEqual(diagnostics[1], diagnostics[0], "reusing a valid rejection preserves its exact diagnostic");
    const distinct = await Promise.all(Array.from({ length: 13 }, async (_, index) => {
      const file = path.join(dir, `distinct-${index}.png`);
      await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: index + 1, g: 22, b: 33 } } }).png().toFile(file);
      return file;
    }));
    let budgetCalls = 0;
    const acceptedPhoto = { review: async () => { budgetCalls++; return JSON.stringify({ productPhoto: true, reason: "Selected product is intact and identifiable" }); } };
    assert.deepEqual([...await photoReviewModule.exports.selectVerifiedProductPhotos(distinct, "review-budget", 20, acceptedPhoto)], distinct.slice(0, 12));
    assert.equal(budgetCalls, 12, "the existing twelve distinct-candidate review budget remains bounded");
    budgetCalls = 0;
    assert.deepEqual([...await photoReviewModule.exports.selectVerifiedProductPhotos(distinct, "accepted-maximum", 2, acceptedPhoto)], distinct.slice(0, 2));
    assert.equal(budgetCalls, 2, "the accepted-photo maximum stops review once filled");
    const longPhoto = path.join(dir, "long-photo.png");
    await sharp({ create: { width: 320, height: 1000, channels: 3, background: "white" } }).png().toFile(longPhoto);
    budgetCalls = 0;
    assert.deepEqual([...await photoReviewModule.exports.selectVerifiedProductPhotos([dir, "missing.png", badCopy, longPhoto, actual], "geometry-filter", 12, acceptedPhoto)], [actual]);
    assert.equal(budgetCalls, 1, "directories, missing, invalid and overly long files never reach photo review");
    console.log(`PASS strict seller photo verdicts: ${malformedAnswers.length} invalid responses fail closed without negative caching; valid true/false, cached SHA diagnostics, geometry, twelve-candidate budget and accepted maximum preserved`);
    console.log("PASS shopping source recovery: all 5 composites retain originals; package survives temp cleanup; hashes, strict QC, duplicate notices, seller fallback, URL and streaming bounds verified offline");
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

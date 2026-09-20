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
      assert.equal(record.segmented, index < 3);
      assert.equal(record.provenance, index < 3 ? "LOCKED_PRODUCT" : "EDITORIAL_CARD");
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
    // a sole LOCKED_PRODUCT hero, no ORIGINAL assets, and deleted worker paths.
    const generationModule = { exports: {} as { resolveSource: (manifest: unknown, target: unknown) => Promise<string | null> } };
    const generationDependencies: Record<string, unknown> = {
      "../../scripts/lib/product-photo-provenance": provenance,
      "../../scripts/lib/product-photo-source": { selectShoppingProductSource: (input: Parameters<typeof selectShoppingProductSource>[0]) => selectShoppingProductSource(input, {
        verify: async files => files.find(file => fs.readFileSync(file).equals(originalBytes)) || null,
        download: async () => { throw new Error("retained source must avoid download"); },
      }) },
      "../../scripts/lib/product-photo-review": { selectVerifiedProductSectionImages: async () => [] },
      "../../scripts/lib/product-image-lock": {}, "../../scripts/lib/product-thumbnail": {},
      "../../scripts/lib/travel-content": {}, "../../scripts/lib/travel-thumbnail": {},
      "../../scripts/lib/image-timeout-policy": { imageJobBudgetMs: () => 1 },
      "./chatgpt-browser-automation": {},
      "./brand-post-package": { getBrandPostPackageDir: () => path.dirname(packaged), normalizePackageImageAssets: (manifest: { imageAssets: unknown[] }) => manifest.imageAssets },
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/brand-post-image-generation.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText + "\nmodule.exports.resolveSource = existingShoppingSource;", {
      module: generationModule, exports: generationModule.exports, process,
      require: (name: string) => name in generationDependencies ? generationDependencies[name] : createRequire(path.resolve("src/lib/brand-post-image-generation.ts"))(name),
    });
    assert.equal(await generationModule.exports.resolveSource({ brandLinkId: "hero-only", title: "미닉스 상품", connectKind: "SHOPPING",
      imageAssets: [{ path: packaged, sourcePath: composites[0].outputPath, provenance: "LOCKED_PRODUCT" }],
    }, { role: "body" }), recovered.sourcePath);
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
    for (const invalid of ["http://shop-phinf.pstatic.net/a", "https://pstatic.net.evil.test/a", "https://localhost/a", "https://user:pass@shop-phinf.pstatic.net/a", "https://shop-phinf.pstatic.net:8443/a"]) assert.equal(isAllowedProductPhotoUrl(invalid), false);

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

    // Offline provider response fixture exercises real QC candidate deduplication.
    const copies = Array.from({ length: 13 }, (_, i) => path.join(dir, `notice-${i}.png`));
    copies.forEach(file => fs.writeFileSync(file, "same notice pixels"));
    const actual = path.join(dir, "actual.png"); fs.writeFileSync(actual, "actual product pixels");
    const code = ts.transpileModule(fs.readFileSync("scripts/lib/product-photo-review.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} as typeof import("./lib/product-photo-review") };
    let reviews = 0;
    vm.runInNewContext(code, { exports: module.exports, module, require: (name: string) => name === "./codex-draft-provider" ? {
      runCodexDraft: async (input: { imagePaths: string[] }) => { reviews++; return JSON.stringify({ productPhoto: input.imagePaths[0] === actual }); },
    } : createRequire(path.resolve("scripts/lib/product-photo-review.ts"))(name) });
    assert.equal(await module.exports.selectVerifiedProductPhoto([dir, "missing.png", ...copies, actual], "상품"), actual);
    assert.equal(reviews, 2, "13 copies of one notice consume only one review, preserving the true-photo candidate");
    assert.equal(await module.exports.selectVerifiedProductPhoto(copies, "상품"), null);
    assert.equal(reviews, 2, "negative byte reviews remain cached");
    console.log("PASS shopping source recovery: all 5 composites retain originals; package survives temp cleanup; hashes, strict QC, duplicate notices, seller fallback, URL and streaming bounds verified offline");
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

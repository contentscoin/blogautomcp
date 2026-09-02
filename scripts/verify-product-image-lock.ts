import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  createLockedProductEditorialScene,
  createLockedProductThumbnail,
  extractLockedProductPng,
} from "./lib/product-image-lock";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product-lock-"));
  const sourcePath = path.join(dir, "source.png");
  const width = 120;
  const height = 100;
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 20; y < 85; y += 1) {
    for (let x = 35; x < 90; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = 17; rgba[i + 1] = 99; rgba[i + 2] = 181; rgba[i + 3] = 255;
    }
  }
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(sourcePath);
  const manifest = await extractLockedProductPng(sourcePath, dir);
  const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer();
  const locked = await sharp(manifest.lockedPngPath).ensureAlpha().raw().toBuffer();
  assert.equal(source.length, locked.length);
  for (let i = 0; i < source.length; i += 4) {
    assert.equal(source[i], locked[i]);
    assert.equal(source[i + 1], locked[i + 1]);
    assert.equal(source[i + 2], locked[i + 2]);
  }
  assert.equal(manifest.rgbPreserved, true);
  const thumbnail = await createLockedProductThumbnail({ sourcePath, outputDir: dir, productName: "원본 잠금 테스트 상품", headline: "형태 그대로", subline: "배경만 연출" });
  assert.ok(fs.existsSync(thumbnail.outputPath));
  const backgroundPath = path.join(dir, "background.png");
  await sharp({ create: { width: 1200, height: 900, channels: 4, background: "#dbeafe" } })
    .png()
    .toFile(backgroundPath);
  const scene = await createLockedProductEditorialScene({
    sourcePath,
    backgroundPath,
    outputDir: dir,
    variant: 1,
  });
  assert.ok(fs.existsSync(scene.outputPath));
  const sceneMetadata = await sharp(scene.outputPath).metadata();
  assert.equal(sceneMetadata.width, 1200);
  assert.equal(sceneMetadata.height, 900);
  console.log(JSON.stringify({ ok: true, rgbPreserved: true, confidence: manifest.confidence, thumbnail: thumbnail.outputPath, scene: scene.outputPath }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

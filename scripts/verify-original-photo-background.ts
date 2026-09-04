import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createOriginalProductPhotoOnBackground } from "./lib/product-image-lock";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-card-test-"));
  const sourcePath = path.join(dir, "source.png");
  const backgroundPath = path.join(dir, "background.png");
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "#d02040" } }).png().toFile(sourcePath);
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#204080" } }).png().toFile(backgroundPath);
  const original = fs.readFileSync(sourcePath);
  const result = await createOriginalProductPhotoOnBackground({ sourcePath, backgroundPath, outputDir: dir });
  const metadata = await sharp(result.outputPath).metadata();
  assert.equal(metadata.width, 1200); assert.equal(metadata.height, 900);
  const preserved = await sharp(result.outputPath).extract({ left: 84, top: 350, width: 300, height: 200 }).removeAlpha().raw().toBuffer();
  assert.deepEqual(preserved, await sharp(sourcePath).removeAlpha().raw().toBuffer());
  assert.deepEqual(fs.readFileSync(sourcePath), original);
  const record = JSON.parse(fs.readFileSync(`${result.outputPath}.source.json`, "utf8"));
  assert.equal(record.provenance, "EDITORIAL_CARD"); assert.equal(record.segmented, false);
  const longDir = path.join(dir, ...Array(9).fill("nested-package-image-artifacts"));
  const longResult = await createOriginalProductPhotoOnBackground({ sourcePath, backgroundPath, outputDir: longDir });
  assert.ok(longResult.outputPath.length > 260);
  assert.equal((await sharp(fs.readFileSync(longResult.outputPath)).metadata()).width, 1200);
  await assert.rejects(createOriginalProductPhotoOnBackground({ sourcePath, backgroundPath: path.join(dir, "missing.png"), outputDir: dir }));
  console.log("PASS full-photo preservation, original unchanged, dimensions, honest provenance and invalid input");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

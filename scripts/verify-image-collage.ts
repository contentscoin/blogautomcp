import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createThreeImageCollage } from "./lib/image-collage";

async function main() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-collage-"));
  const colors = ["#164e63", "#f59e0b", "#be123c"];
  const sourcePaths = await Promise.all(
    colors.map(async (background, index) => {
      const sourcePath = path.join(outputDir, `source-${index}.jpg`);
      await sharp({
        create: { width: 800 + index * 100, height: 700, channels: 3, background },
      })
        .jpeg()
        .toFile(sourcePath);
      return sourcePath;
    }),
  );
  const outputPath = await createThreeImageCollage({ sourcePaths, outputDir });
  const metadata = await sharp(outputPath).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
  assert.ok(fs.statSync(outputPath).size > 1_000);
  console.log(JSON.stringify({ ok: true, outputPath, width: metadata.width, height: metadata.height }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

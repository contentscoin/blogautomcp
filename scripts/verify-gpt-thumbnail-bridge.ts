import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createLockedProductThumbnailOnBackground } from "./lib/product-image-lock";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-thumbnail-bridge-"));
  const sourcePath = path.join(dir, "source.png");
  const backgroundPath = path.join(dir, "background.png");
  await sharp({ create: { width: 900, height: 900, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from('<svg width="900" height="900" xmlns="http://www.w3.org/2000/svg"><rect x="260" y="130" width="380" height="640" rx="80" fill="#1769aa"/></svg>') }])
    .png()
    .toFile(sourcePath);
  await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#d8c7a8" } })
    .composite([{ input: Buffer.from('<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="760" width="1080" height="320" fill="#8a6b4a"/><circle cx="870" cy="190" r="120" fill="#fff4cf"/></svg>') }])
    .png()
    .toFile(backgroundPath);
  const result = await createLockedProductThumbnailOnBackground({ sourcePath, backgroundPath, outputDir: dir, productName: "원본 잠금 테스트", headline: "실사 배경 합성", subline: "상품은 생성하지 않음" });
  assert.ok(fs.existsSync(result.outputPath));
  assert.equal(result.lock.rgbPreserved, true);
  const metadata = await sharp(result.outputPath).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
  console.log(JSON.stringify({ ok: true, rgbPreserved: true, width: metadata.width, height: metadata.height }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

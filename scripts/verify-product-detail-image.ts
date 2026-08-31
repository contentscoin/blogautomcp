import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createProductDetailImageSegments } from "./lib/product-detail-image";

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-detail-"));
  const sourcePath = path.join(tempDir, "detail.png");
  try {
    await sharp({
      create: {
        width: 860,
        height: 13_196,
        channels: 3,
        background: { r: 244, g: 246, b: 248 },
      },
    }).png().toFile(sourcePath);
    const segments = await createProductDetailImageSegments({
      imagePath: sourcePath,
      outputDir: tempDir,
      filePrefix: "fixture",
      index: 0,
      width: 860,
      height: 13_196,
      timestamp: 1,
    });
    assert.equal(segments.length, 8, "860x13196 상세이미지는 전체를 8구간으로 보존해야 합니다.");
    assert.ok(segments.every((segment) => segment.width === 1080));
    assert.ok(segments.every((segment) => segment.height >= 1900));
    assert.ok(segments.every((segment) => fs.existsSync(segment.path) && segment.size > 1_000));
    console.log(JSON.stringify({ ok: true, segmentCount: segments.length, first: segments[0] }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

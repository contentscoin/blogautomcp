import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildProductThumbnailCopy, compactProductDisplayName, inferCategoryName } from "./lib/product-thumbnail";
import { createOriginalProductPhotoThumbnail } from "./lib/product-image-lock";
import { readProductPhotoSource } from "./lib/product-photo-provenance";
import { fitThumbnailHeadline } from "./lib/thumbnail-layout-v2";

async function main() {
  const sellerName = "향좋은 아비노 고보습 민감피부 저자극 스트레스릴리프 바디워시";
  const copy = buildProductThumbnailCopy("헤어드라이기와 함께 두는 욕실 상품", sellerName);
  assert.equal(copy.productNameLabel, "아비노 스트레스릴리프 바디워시");
  assert.equal(copy.headline, "향·용량 구성");
  assert.doesNotMatch(JSON.stringify(copy), /사용감|실사용|써보|바람|무게/);
  assert.equal(inferCategoryName("", sellerName), "바디케어");
  for (const name of ["헤어 샴푸", "바디 로션", "핸드크림", "샤워 젤"]) {
    assert.equal(buildProductThumbnailCopy("", name).headline, "향·용량 구성");
  }
  assert.match(buildProductThumbnailCopy("", "헤어드라이기").subline, /바람/);
  assert.equal(inferCategoryName("", "헤어 샴푸"), "헤어케어");
  assert.equal(compactProductDisplayName("브랜드X 미확인변형 ABC-123 바디워시"), "브랜드X 미확인변형 ABC-123 바디워시");
  assert.equal(compactProductDisplayName("아비노 바디워시"), "아비노 바디워시");
  assert.equal(compactProductDisplayName("고보습"), "고보습");
  const fitted = await fitThumbnailHeadline({ text: copy.productNameLabel, maxWidth: 500, maxHeight: 40, minFontSize: 24, maxFontSize: 30, maxLines: 1 });
  assert.equal(fitted.truncated, false, "Brand, variant and category must remain visible");
  const heading = await fitThumbnailHeadline({ text: copy.headline, maxWidth: 500, maxHeight: 286, minFontSize: 58, maxFontSize: 96 });
  assert.ok(heading.lines.some((line) => line.includes("구성")), "Do not split the category label inside a word");

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopping-thumbnail-copy-"));
  // Synthetic offline photo fixture: asymmetric corner markers expose crops or flips.
  // This is a layout diagnostic, not a fabricated seller/product photograph.
  const sourcePath = path.join(outputDir, "offline-photo-fixture.png");
  await sharp(Buffer.from('<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="320" fill="#ded3bc"/><rect width="20" height="20" fill="#b52128"/><rect x="220" y="300" width="20" height="20" fill="#235da1"/><rect x="65" y="65" width="110" height="225" rx="18" fill="#efdcab"/><rect x="85" y="40" width="70" height="35" fill="#584334"/><rect x="75" y="140" width="90" height="85" fill="#476738"/></svg>')).png().toFile(sourcePath);
  const sourceBefore = fs.readFileSync(sourcePath);
  const artifacts: string[] = [];
  for (const style of ["shopping-clean", "shopping-bold", "shopping-soft"] as const) {
    const result = await createOriginalProductPhotoThumbnail({ sourcePath, outputDir, productName: sellerName, headline: copy.headline, subline: copy.subline, style });
    artifacts.push(result.outputPath);
    const expected = await sharp(sourcePath).rotate().resize(470, 900, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(expected.info.width, 470, "Small source should fill the available photo width");
    const actual = await sharp(result.outputPath).extract({ left: 570, top: Math.floor((1080 - expected.info.height) / 2), width: expected.info.width, height: expected.info.height }).removeAlpha().raw().toBuffer();
    assert.deepEqual(actual, expected.data, "Entire photo must survive layout without recoloring or cropping");
    const record = readProductPhotoSource(result.outputPath);
    assert.ok(record);
    assert.equal(record.segmented, false);
    assert.equal(record.provenance, "EDITORIAL_CARD");
    assert.deepEqual(fs.readFileSync(record.sourcePath), sourceBefore);
    // Below the rectangular photo the panel must have no detached ellipse.
    const pixels = await sharp(result.outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sample = (x: number, y: number) => Array.from(pixels.data.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3));
    const a = sample(815, 900), b = sample(815, 950);
    assert.ok(a.every((value, i) => Math.abs(value - b[i]) <= 3), "No fake ground shadow under an unsegmented photo");
  }
  assert.deepEqual(fs.readFileSync(sourcePath), sourceBefore);
  console.log(JSON.stringify({ ok: true, outputDir, artifacts, copy }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

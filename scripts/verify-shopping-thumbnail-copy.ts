import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  buildProductThumbnailCopy,
  compactProductDisplayName,
  inferCategoryName,
  isProductThumbnailCopyCompatible,
} from "./lib/product-thumbnail";
import { createOriginalProductPhotoThumbnail } from "./lib/product-image-lock";
import { copyProductPhotoSource, readProductPhotoSource } from "./lib/product-photo-provenance";
import { buildProduct9Canvas } from "./lib/product-9canvas";
import { buildShoppingPhotoHeadlineOverlay, fitThumbnailHeadline, normalizeShoppingThumbnailHeadline, SHOPPING_THUMBNAIL_MIN_FONT_SIZE } from "./lib/thumbnail-layout-v2";
import { isReusableShoppingThumbnail, parseProductThumbnailSettings } from "./lib/product-thumbnail-settings";

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
  const humidifier = buildProductThumbnailCopy("캠핑 차량용 제품", "풀라스 UV 살균 초음파 미니 가습기 캠핑 차량용");
  assert.equal(humidifier.headline, "가습 방식 체크");
  assert.doesNotMatch(JSON.stringify(humidifier), /보냉|흡입/u);
  const humidifierUnderstanding = buildProduct9Canvas({ name: "풀라스 UV 살균 초음파 미니 가습기 캠핑 차량용" });
  assert.equal(isProductThumbnailCopyCompatible({
    headline: "보냉력 체크",
    subline: "용량·수납·휴대성",
    cta: "사용 포인트",
  }, humidifierUnderstanding), false, "A saved cooler thumbnail must not override a humidifier contract");
  assert.equal(isProductThumbnailCopyCompatible({
    headline: humidifier.headline,
    subline: humidifier.subline,
    cta: humidifier.cta,
  }, humidifierUnderstanding), true);
  const persimmon = buildProductThumbnailCopy("선물세트 기준", "상주곶감 건시 반건시 호두말이 크림치즈 선물세트");
  assert.equal(persimmon.headline, "구성·보관 확인");
  assert.equal(inferCategoryName("", "헤어 샴푸"), "헤어케어");
  assert.equal(compactProductDisplayName("브랜드X 미확인변형 ABC-123 바디워시"), "브랜드X 미확인변형 ABC-123 바디워시");
  assert.equal(compactProductDisplayName("아비노 바디워시"), "아비노 바디워시");
  assert.equal(compactProductDisplayName("고보습"), "고보습");
  assert.equal(buildProductThumbnailCopy("", "남성 와이드 슬랙스 바지").headline, "핏·디테일 체크");
  const fitted = await fitThumbnailHeadline({ text: copy.productNameLabel, maxWidth: 500, maxHeight: 40, minFontSize: 24, maxFontSize: 30, maxLines: 1 });
  assert.equal(fitted.truncated, false, "Brand, variant and category must remain visible");
  const heading = await fitThumbnailHeadline({ text: copy.headline, maxWidth: 500, maxHeight: 286, minFontSize: 58, maxFontSize: 96 });
  assert.ok(heading.lines.some((line) => line.includes("구성")), "Do not split the category label inside a word");
  for (const headline of [copy.headline, "핏·디테일 체크", "아주 길고 긴 상품 제목을 그대로 쓰면 작은 글씨가 됩니다"]) {
    const overlay = (await buildShoppingPhotoHeadlineOverlay({ headline })).toString();
    assert.ok(Number(overlay.match(/data-font-size="(\d+)"/u)?.[1]) >= SHOPPING_THUMBNAIL_MIN_FONT_SIZE);
    assert.ok((overlay.match(/<text /gu) || []).length <= 2, "Only a short headline, not product label, badge and explanation");
    assert.doesNotMatch(overlay, /<ellipse|<rect x=|<image|rx=/u, "No inset frame, floating shadow or card panel");
    assert.ok(Array.from(normalizeShoppingThumbnailHeadline(headline)).length <= 14);
  }

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
    const expected = await sharp(sourcePath).rotate().resize(1080, 1080, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(expected.info.width, 810, "Portrait photo occupies 75% of the square width, not a small inset");
    assert.equal(expected.info.height, 1080, "Entire original portrait reaches the canvas edges without cropping");
    const expectedUpper = await sharp(expected.data, { raw: { width: expected.info.width, height: expected.info.height, channels: expected.info.channels } }).extract({ left: 0, top: 0, width: 810, height: 400 }).raw().toBuffer();
    const actualUpper = await sharp(result.outputPath).extract({ left: 135, top: 0, width: 810, height: 400 }).removeAlpha().raw().toBuffer();
    assert.equal(actualUpper.equals(expectedUpper), true, "Original photograph geometry and colors survive outside the headline shade");
    const record = readProductPhotoSource(result.outputPath);
    assert.ok(record);
    assert.equal(record.segmented, false);
    assert.equal(record.provenance, "PHOTO_TEXT_THUMBNAIL");
    const saved = parseProductThumbnailSettings(JSON.stringify({ version: 1, generatedPath: result.outputPath, copy }));
    assert.ok(saved);
    assert.equal(isReusableShoppingThumbnail(saved), true, "Verified source/output receipt approves the new photo thumbnail");
    assert.deepEqual(fs.readFileSync(record.sourcePath), sourceBefore);
    const copied = path.join(outputDir, `copy-${style}.png`);
    fs.copyFileSync(result.outputPath, copied);
    assert.equal(copyProductPhotoSource(result.outputPath, copied), true);
    assert.equal(readProductPhotoSource(copied)?.provenance, "PHOTO_TEXT_THUMBNAIL", "Package copies preserve honest thumbnail provenance");
  }
  const previews = fs.readdirSync(outputDir);
  assert.ok(previews.some((file) => file.endsWith("-120.jpg")));
  assert.ok(previews.some((file) => file.endsWith("-240.jpg")));
  const versionedOutput = path.join(outputDir, "versioned-thumbnail.png");
  fs.copyFileSync(artifacts[0], versionedOutput);
  const makeSettings = (extra: Record<string, unknown> = {}) => parseProductThumbnailSettings(JSON.stringify({ version: 1, generatedPath: versionedOutput, copy, ...extra }))!;
  assert.equal(isReusableShoppingThumbnail(makeSettings()), false, "Old square cards cannot be approved merely by their size");
  assert.equal(isReusableShoppingThumbnail(makeSettings({ layoutVersion: "shopping-photo-headline/v1" })), false, "A version label alone is not evidence");
  const versioned = makeSettings({ layoutVersion: "shopping-photo-headline/v1", generatedSha256: crypto.createHash("sha256").update(fs.readFileSync(versionedOutput)).digest("hex") });
  assert.equal(versioned.layoutVersion, "shopping-photo-headline/v1", "Parser preserves current layout version");
  assert.equal(isReusableShoppingThumbnail(versioned), true, "Server-saved current version must bind the exact output bytes");
  assert.equal(makeSettings({ layoutVersion: "shopping-photo-headline/v0", generatedSha256: "invalid" }).layoutVersion, undefined);
  fs.appendFileSync(versionedOutput, "changed");
  assert.equal(isReusableShoppingThumbnail(versioned), false, "Replacing a saved file invalidates its layout approval");
  const banner = path.join(outputDir, "long-detail-page.png");
  await sharp({ create: { width: 120, height: 900, channels: 3, background: "#fff" } }).png().toFile(banner);
  await assert.rejects(createOriginalProductPhotoThumbnail({ sourcePath: banner, outputDir, productName: sellerName, headline: copy.headline, subline: "" }), /긴 상세페이지/u,
    "A long seller banner must not return as a tiny inset photo");
  assert.deepEqual(fs.readFileSync(sourcePath), sourceBefore);
  console.log(JSON.stringify({ ok: true, outputDir, artifacts, copy }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

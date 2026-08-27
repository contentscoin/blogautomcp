import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateProductThumbnail } from "./lib/product-thumbnail";
import { normalizeProductThumbnailCopy } from "./lib/product-thumbnail-settings";

async function main() {
  const sourcePath = path.resolve(
    "docs/naver-blog-drafts/assets/2026-07-08-finecaddie-upl2000-product-flatlay.png",
  );
  assert.equal(fs.existsSync(sourcePath), true, "제품 사진 QA fixture가 필요합니다.");

  const copy = normalizeProductThumbnailCopy({
    productNameLabel: "파인캐디 UPL2000",
    headline: "거리 측정 체크",
    subline: "화면·속도·휴대성",
    badge: "구매 체크",
    cta: "장단점 보기",
  }, "파인캐디 UPL2000");
  assert.throws(
    () => normalizeProductThumbnailCopy({ headline: "무조건 최저가 1위" }, "테스트 상품"),
    /근거 없는/,
  );

  const outputDir = path.join(os.tmpdir(), "blogautomcp-thumbnail-studio-qa");
  await fs.promises.mkdir(outputDir, { recursive: true });
  const result = await generateProductThumbnail({
    imagePaths: [sourcePath],
    preferredImagePath: sourcePath,
    postTitle: "파인캐디 UPL2000 구매 전 확인",
    productName: "파인캐디 UPL2000",
    outputDir,
    copy,
    enabled: true,
  });
  assert.ok(result?.outputPath && fs.existsSync(result.outputPath), "완성 썸네일이 생성되어야 합니다.");
  const metadata = await sharp(result.outputPath).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 900);
  assert.ok((await fs.promises.stat(result.outputPath)).size > 100_000, "완성 이미지가 비정상적으로 작습니다.");
  assert.equal(result.backgroundPath, sourcePath);

  console.log(JSON.stringify({
    ok: true,
    outputPath: result.outputPath,
    width: metadata.width,
    height: metadata.height,
    copy,
  }, null, 2));
}

void main();

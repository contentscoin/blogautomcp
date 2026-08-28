import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateProductThumbnail } from "./lib/product-thumbnail";
import { normalizeProductThumbnailCopy } from "./lib/product-thumbnail-settings";
import {
  isPreferredThumbnailImageUrl,
  isRepresentativeTravelImageDimension,
  normalizeCandidateImageUrl,
} from "./lib/product-image-selection";
import { buildLocalTravelPostJson, buildTravelThumbnailCopy, extractTravelProductFacts } from "./lib/travel-content";

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

  const travelUrl = "https://pkgtour-phinf.pstatic.net/example/landscape.JPEG?type=w860";
  assert.equal(isPreferredThumbnailImageUrl(travelUrl), true, "여행커넥트 사진은 대표 사진 후보여야 합니다.");
  assert.equal(normalizeCandidateImageUrl(travelUrl).includes("?type="), false, "여행 사진의 404 변환 쿼리를 제거해야 합니다.");
  assert.equal(isRepresentativeTravelImageDimension(1200, 800), true, "여행 풍경 가로 사진을 허용해야 합니다.");
  const travelName = "[출발확정][노쇼핑/노옵션/팁포함] 스위스 이탈리아 9일 <융프라우/루체른/피사>";
  const travelFacts = extractTravelProductFacts(travelName);
  assert.equal(travelFacts.duration, "9일");
  assert.ok(travelFacts.conditions.some((value) => /쇼핑/u.test(value)));
  const travelCopy = buildTravelThumbnailCopy(travelName);
  assert.match(travelCopy.headline, /일정 체크/u);
  const travelDraft = JSON.parse(buildLocalTravelPostJson({ name: travelName, description: "", features: [], price: "" }, 6));
  assert.equal(travelDraft.sections.length, 6);
  assert.doesNotMatch(travelDraft.sections.join("\n"), /배송|구성품|택배|교환\/반품/u);

  const travelResult = await generateProductThumbnail({
    imagePaths: [sourcePath],
    preferredImagePath: sourcePath,
    postTitle: "스위스 이탈리아 9일 일정과 포함조건",
    productName: travelName,
    outputDir,
    contentKind: "TRAVEL",
    enabled: true,
  });
  assert.ok(travelResult?.outputPath && fs.existsSync(travelResult.outputPath));
  const travelMetadata = await sharp(travelResult.outputPath).metadata();
  assert.equal(travelMetadata.width, 1600);
  assert.equal(travelMetadata.height, 900);

  console.log(JSON.stringify({
    ok: true,
    outputPath: result.outputPath,
    width: metadata.width,
    height: metadata.height,
    copy,
    travelCopy,
  }, null, 2));
}

void main();

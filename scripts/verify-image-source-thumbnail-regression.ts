import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildTravelThumbnailCopy, extractTravelProductFacts } from "./lib/travel-content";
import { buildThumbnailOverlayV2 } from "./lib/thumbnail-layout-v2";

async function main() {
  const name = "[노팁/노옵션] [다낭/호이안] 5성 호텔 37만원 상당 혜택 포함 자유시간 제공 식사 UP 5일";
  assert.deepEqual(extractTravelProductFacts(name).destinations, ["다낭", "호이안"]);
  const copy = buildTravelThumbnailCopy(name);
  assert.equal(copy.headline, "다낭 · 호이안");
  assert.equal(copy.productNameLabel, "5일 여행 가이드");
  assert.equal(buildTravelThumbnailCopy("37만원 상당 혜택 포함 5일").headline, "여행 코스");
  const svg = await buildThumbnailOverlayV2({ eyebrow: copy.productNameLabel, headline: copy.headline, subline: copy.subline, style: "travel-cinematic" });
  assert.ok(svg.toString().includes(copy.subline));
  assert.ok(!svg.toString().includes("37만원"));
  const output = path.resolve("temp/image-contract-qa/travel-overlay.png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await sharp(svg).png().toFile(output);
  console.log("Image/thumbnail regression passed:", output);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createLockedProductThumbnail, type ShoppingThumbnailStyle } from "./lib/product-image-lock";
import { createTravelEditorialThumbnail, type TravelThumbnailStyle } from "./lib/travel-thumbnail";

async function main() {
  const outputDir = path.resolve(process.argv[2] || "out/qa-thumbnails");
  fs.mkdirSync(outputDir, { recursive: true });
  const productSource = path.join(outputDir, "fixture-product.png");
  const svg = Buffer.from(`<svg width="900" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="900" fill="#fff"/><rect x="280" y="130" width="340" height="630" rx="90" fill="#2563eb"/><circle cx="450" cy="260" r="80" fill="#bfdbfe"/><rect x="365" y="450" width="170" height="45" rx="22" fill="#0f172a"/><text x="450" y="650" text-anchor="middle" font-family="Arial" font-size="54" font-weight="900" fill="#fff">LOCK</text></svg>`);
  await sharp(svg).png().toFile(productSource);
  const fixtureTravelSource = path.join(outputDir, "fixture-travel.jpg");
  const travelSvg = Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#8fd3ff"/><stop offset=".62" stop-color="#f7d7b0"/><stop offset="1" stop-color="#2f6f77"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#sky)"/><circle cx="830" cy="250" r="92" fill="#fff4c7" opacity=".85"/><path d="M0 590 L220 360 L390 570 L590 260 L820 560 L1080 390 L1080 770 L0 770Z" fill="#5a7f8e"/><path d="M0 700 C240 620 380 760 560 680 C760 590 900 710 1080 620 L1080 1080 L0 1080Z" fill="#1d5261"/><rect x="120" y="620" width="110" height="210" fill="#f3ead7"/><rect x="260" y="650" width="150" height="180" fill="#d78863"/><rect x="450" y="590" width="120" height="240" fill="#f4c8a3"/><rect x="610" y="670" width="180" height="160" fill="#f3ead7"/><rect x="830" y="610" width="130" height="220" fill="#c46c52"/></svg>`);
  await sharp(travelSvg).jpeg({ quality: 94 }).toFile(fixtureTravelSource);
  const travelSource = process.argv[3] && fs.existsSync(process.argv[3]) ? path.resolve(process.argv[3]) : fixtureTravelSource;
  const outputs: string[] = [];
  for (const style of ["shopping-clean", "shopping-bold", "shopping-soft"] as ShoppingThumbnailStyle[]) {
    const result = await createLockedProductThumbnail({ sourcePath: productSource, outputDir, productName: "블루 에어 써큘레이터", headline: "풍량·휴대성 체크", subline: "크기·소음·사용 공간", style });
    const target = path.join(outputDir, `${style}.png`); fs.copyFileSync(result.outputPath, target); outputs.push(target);
  }
  for (const style of ["travel-editorial", "travel-postcard", "travel-route"] as TravelThumbnailStyle[]) {
    const result = await createTravelEditorialThumbnail({ sourcePath: travelSource, outputDir, destination: "타이페이·단수이 4일", headline: "타이페이 여행", subline: "야시장·온천·단수이 노을", badge: "일정 한눈에", style });
    const target = path.join(outputDir, `${style}.png`); fs.copyFileSync(result.outputPath, target); outputs.push(target);
  }
  for (const file of outputs) { const meta = await sharp(file).metadata(); assert.equal(meta.width, 1080); assert.equal(meta.height, 1080); }
  const thumbs = await Promise.all(outputs.map((file) => sharp(file).resize(360, 360).png().toBuffer()));
  const sheet = path.join(outputDir, "thumbnail-style-contact-sheet.png");
  await sharp({ create: { width: 1080, height: 720, channels: 4, background: "#e2e8f0" } }).composite(thumbs.map((input, index) => ({ input, left: (index % 3) * 360, top: Math.floor(index / 3) * 360 }))).png().toFile(sheet);
  console.log(JSON.stringify({ ok: true, styles: outputs.length, contactSheet: sheet }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

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
  const travelSource = process.argv[3] && fs.existsSync(process.argv[3]) ? path.resolve(process.argv[3]) : productSource;
  const outputs: string[] = [];
  for (const style of ["shopping-clean", "shopping-bold", "shopping-soft"] as ShoppingThumbnailStyle[]) {
    const result = await createLockedProductThumbnail({ sourcePath: productSource, outputDir, productName: "블루 에어 써큘레이터", headline: "풍량·휴대성 체크", subline: "크기·소음·사용 공간", style });
    const target = path.join(outputDir, `${style}.png`); fs.copyFileSync(result.outputPath, target); outputs.push(target);
  }
  for (const style of ["travel-editorial", "travel-postcard", "travel-route"] as TravelThumbnailStyle[]) {
    const result = await createTravelEditorialThumbnail({ sourcePath: travelSource, outputDir, destination: "타이페이·단수이 4일", headline: "타이페이 여행", subline: "야시장·온천·단수이 노을", badge: "일정 한눈에", style });
    const target = path.join(outputDir, `${style}.png`); fs.copyFileSync(result.outputPath, target); outputs.push(target);
  }
  for (const file of outputs) { const meta = await sharp(file).metadata(); assert.equal(meta.width, 1600); assert.equal(meta.height, 900); }
  const thumbs = await Promise.all(outputs.map((file) => sharp(file).resize(640, 360).png().toBuffer()));
  const sheet = path.join(outputDir, "thumbnail-style-contact-sheet.png");
  await sharp({ create: { width: 1280, height: 1080, channels: 4, background: "#e2e8f0" } }).composite(thumbs.map((input, index) => ({ input, left: (index % 2) * 640, top: Math.floor(index / 2) * 360 }))).png().toFile(sheet);
  console.log(JSON.stringify({ ok: true, styles: outputs.length, contactSheet: sheet }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

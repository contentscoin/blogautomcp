import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { assessTravelImageQuality } from "./lib/travel-image-quality";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-image-quality-"));
  try {
    const flat = path.join(dir, "flat.jpg");
    const detailed = path.join(dir, "detailed.jpg");
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#dbeafe" } })
      .jpeg({ quality: 80 })
      .toFile(flat);
    const noise = Buffer.alloc(1200 * 800 * 3);
    for (let index = 0; index < noise.length; index += 1) noise[index] = (index * 73 + Math.floor(index / 97)) % 256;
    await sharp(noise, { raw: { width: 1200, height: 800, channels: 3 } })
      .jpeg({ quality: 90 })
      .toFile(detailed);

    const flatResult = await assessTravelImageQuality(flat);
    const detailedResult = await assessTravelImageQuality(detailed);
    assert.equal(flatResult.pass, false, "flat placeholder must be rejected");
    assert.equal(detailedResult.pass, true, `detailed image must pass: ${detailedResult.reasons.join(", ")}`);
    console.log("✅ 여행 이미지 품질 게이트 검증 완료");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

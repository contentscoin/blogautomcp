import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { deduplicateImagePaths } from "./lib/image-dedup";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-dedup-"));
  const first = path.join(dir, "first.png");
  const exact = path.join(dir, "exact.png");
  const near = path.join(dir, "near.jpg");
  const different = path.join(dir, "different.png");
  await sharp({ create: { width: 200, height: 200, channels: 3, background: "#f5f5f5" } })
    .composite([{ input: Buffer.from('<svg width="200" height="200"><rect x="35" y="30" width="130" height="140" rx="25" fill="#2563eb"/></svg>') }])
    .png()
    .toFile(first);
  fs.copyFileSync(first, exact);
  await sharp(first).jpeg({ quality: 94 }).toFile(near);
  await sharp({ create: { width: 200, height: 200, channels: 3, background: "#111827" } })
    .composite([{ input: Buffer.from('<svg width="200" height="200"><circle cx="100" cy="100" r="62" fill="#f97316"/></svg>') }])
    .png()
    .toFile(different);

  const result = await deduplicateImagePaths([first, exact, near, different], 6);
  assert.equal(result.paths.length, 2);
  assert.equal(result.removed.some((item) => item.reason === "sha256"), true);
  assert.equal(result.removed.some((item) => item.reason === "perceptual"), true);
  console.log("image dedup verified", result.removed);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";

export interface ImageFingerprint {
  path: string;
  sha256: string;
  differenceHash: [number, number];
}

export interface ImageDeduplicationResult {
  paths: string[];
  fingerprints: ImageFingerprint[];
  removed: Array<{ path: string; duplicateOf: string; reason: "sha256" | "perceptual"; distance: number }>;
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function differenceHash(filePath: string): Promise<[number, number]> {
  const { data } = await sharp(filePath)
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let low = 0;
  let high = 0;
  let bit = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x] || 0;
      const right = data[y * 9 + x + 1] || 0;
      if (left > right) {
        if (bit < 32) low = (low | (1 << bit)) >>> 0;
        else high = (high | (1 << (bit - 32))) >>> 0;
      }
      bit += 1;
    }
  }
  return [low, high];
}

function popcount32(value: number): number {
  let current = value >>> 0;
  current -= (current >>> 1) & 0x55555555;
  current = (current & 0x33333333) + ((current >>> 2) & 0x33333333);
  return (((current + (current >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hammingDistance(left: [number, number], right: [number, number]): number {
  return popcount32((left[0] ^ right[0]) >>> 0) + popcount32((left[1] ^ right[1]) >>> 0);
}

export async function fingerprintImage(filePath: string): Promise<ImageFingerprint> {
  if (!fs.existsSync(filePath)) throw new Error(`이미지 파일을 찾을 수 없습니다: ${filePath}`);
  return {
    path: filePath,
    sha256: sha256(filePath),
    differenceHash: await differenceHash(filePath),
  };
}

export async function deduplicateImagePaths(
  paths: string[],
  perceptualDistanceThreshold = 5,
): Promise<ImageDeduplicationResult> {
  const fingerprints: ImageFingerprint[] = [];
  const removed: ImageDeduplicationResult["removed"] = [];
  for (const imagePath of paths) {
    if (!fs.existsSync(imagePath)) continue;
    let fingerprint: ImageFingerprint;
    try {
      fingerprint = await fingerprintImage(imagePath);
    } catch {
      continue;
    }
    const exact = fingerprints.find((candidate) => candidate.sha256 === fingerprint.sha256);
    if (exact) {
      removed.push({ path: imagePath, duplicateOf: exact.path, reason: "sha256", distance: 0 });
      continue;
    }
    const near = fingerprints
      .map((candidate) => ({ candidate, distance: hammingDistance(candidate.differenceHash, fingerprint.differenceHash) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (near && near.distance <= perceptualDistanceThreshold) {
      removed.push({
        path: imagePath,
        duplicateOf: near.candidate.path,
        reason: "perceptual",
        distance: near.distance,
      });
      continue;
    }
    fingerprints.push(fingerprint);
  }
  return { paths: fingerprints.map((item) => item.path), fingerprints, removed };
}

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export interface ProductDetailImageSegment {
  path: string;
  width: number;
  height: number;
  size: number;
}

export async function createProductDetailImageSegments(input: {
  imagePath: string;
  outputDir: string;
  filePrefix: string;
  index: number;
  width: number;
  height: number;
  timestamp?: number;
}): Promise<ProductDetailImageSegment[]> {
  const { imagePath, outputDir, filePrefix, index, width, height } = input;
  if (width < 600 || height < 900 || height / width < 1.35) return [];

  const segmentCount = Math.max(1, Math.min(8, Math.ceil(height / (width * 1.9))));
  const segmentHeight = Math.ceil(height / segmentCount);
  const timestamp = input.timestamp ?? Date.now();
  const segments: ProductDetailImageSegment[] = [];

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const top = segmentIndex * segmentHeight;
    const actualHeight = Math.min(segmentHeight, height - top);
    if (actualHeight < 300) continue;
    const segmentPath = path.join(
      outputDir,
      `${filePrefix}_detail_${timestamp}_${index}_${segmentIndex}.jpg`,
    );

    try {
      await sharp(imagePath)
        .rotate()
        .extract({ left: 0, top, width, height: actualHeight })
        .resize({ width: 1080, withoutEnlargement: false })
        .jpeg({ quality: 94, mozjpeg: true })
        .toFile(segmentPath);
      const metadata = await sharp(segmentPath).metadata();
      const stats = fs.statSync(segmentPath);
      segments.push({
        path: segmentPath,
        width: metadata.width ?? 1080,
        height: metadata.height ?? Math.round((actualHeight / width) * 1080),
        size: stats.size,
      });
    } catch {
      try { fs.unlinkSync(segmentPath); } catch {}
    }
  }

  return segments;
}

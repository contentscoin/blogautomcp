import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  buildThumbnailOverlayV2,
  generateThumbnailCropPreviews,
  type ThumbnailV2Style,
} from "./thumbnail-layout-v2";

export type TravelThumbnailStyle = "travel-editorial" | "travel-postcard" | "travel-route";

function thumbnailV2Style(style: TravelThumbnailStyle): ThumbnailV2Style {
  if (style === "travel-postcard") return "travel-emotional-record";
  if (style === "travel-route") return "travel-route";
  return "travel-cinematic";
}

export async function createTravelEditorialThumbnail(options: {
  sourcePath: string;
  outputDir: string;
  destination: string;
  headline: string;
  subline: string;
  badge: string;
  style?: TravelThumbnailStyle;
}): Promise<{ outputPath: string }> {
  if (!fs.existsSync(options.sourcePath)) throw new Error("여행 대표 사진을 찾을 수 없습니다.");
  fs.mkdirSync(options.outputDir, { recursive: true });
  const style = options.style || "travel-editorial";
  const photo = await sharp(options.sourcePath)
    .resize(1080, 1080, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.98, saturation: 1.04 })
    .png()
    .toBuffer();
  const svg = await buildThumbnailOverlayV2({
    eyebrow: options.destination || options.badge,
    headline: options.headline || options.subline,
    subline: options.subline,
    style: thumbnailV2Style(style),
    subjectSide: "full",
    transparentBackground: true,
  });
  const outputPath = path.join(options.outputDir, `travel-thumbnail-${Date.now()}.png`);
  await sharp(photo).composite([{ input: svg }]).png({ compressionLevel: 9 }).toFile(outputPath);
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  return { outputPath };
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CANVAS_SIZE = 1080;
const GAP = 12;
const LEFT_WIDTH = 710;
const RIGHT_WIDTH = CANVAS_SIZE - LEFT_WIDTH - GAP;
const RIGHT_HEIGHT = Math.floor((CANVAS_SIZE - GAP) / 2);

async function cover(sourcePath: string, width: number, height: number): Promise<Buffer> {
  return sharp(sourcePath)
    .rotate()
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
export async function createThreeImageCollage(options: {
  sourcePaths: string[];
  outputDir: string;
}): Promise<string> {
  const sourcePaths = options.sourcePaths.slice(0, 3);
  if (sourcePaths.length !== 3 || sourcePaths.some((sourcePath) => !fs.existsSync(sourcePath))) {
    throw new Error("3장 콜라주에는 실제 이미지 파일 3개가 필요합니다.");
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  const [left, rightTop, rightBottom] = await Promise.all([
    cover(sourcePaths[0], LEFT_WIDTH, CANVAS_SIZE),
    cover(sourcePaths[1], RIGHT_WIDTH, RIGHT_HEIGHT),
    cover(sourcePaths[2], RIGHT_WIDTH, RIGHT_HEIGHT),
  ]);
  const outputPath = path.join(
    options.outputDir,
    `travel-collage-${crypto.randomUUID()}.jpg`,
  );
  await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: rightTop, left: LEFT_WIDTH + GAP, top: 0 },
      {
        input: rightBottom,
        left: LEFT_WIDTH + GAP,
        top: RIGHT_HEIGHT + GAP,
      },
    ])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  return outputPath;
}

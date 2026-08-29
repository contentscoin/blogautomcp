import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  buildThumbnailOverlayV2,
  generateThumbnailCropPreviews,
  type ThumbnailV2Style,
} from "./thumbnail-layout-v2";

export interface ProductImageLockManifest {
  version: "product-image-lock/v1";
  sourcePath: string;
  sourceSha256: string;
  lockedPngPath: string;
  lockedPngSha256: string;
  width: number;
  height: number;
  extraction: "near-white-alpha";
  removedPixelRatio: number;
  confidence: number;
  rgbPreserved: true;
}

export interface LockedProductThumbnailResult {
  outputPath: string;
  lock: ProductImageLockManifest;
}

export type ShoppingThumbnailStyle = "shopping-clean" | "shopping-bold" | "shopping-soft";

function thumbnailV2Style(style: ShoppingThumbnailStyle | undefined): ThumbnailV2Style {
  if (style === "shopping-bold") return "shopping-color-block";
  if (style === "shopping-soft") return "shopping-soft-lifestyle";
  return "shopping-clean-editorial";
}

const sha256File = (filePath: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

function edgeWhiteness(data: Buffer, width: number, height: number, channels: number): number {
  let white = 0;
  let sampled = 0;
  const visit = (x: number, y: number) => {
    const offset = (y * width + x) * channels;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    sampled += 1;
    if (r >= 242 && g >= 242 && b >= 242 && Math.max(r, g, b) - Math.min(r, g, b) <= 10) white += 1;
  };
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 100))) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 100))) {
    visit(0, y);
    visit(width - 1, y);
  }
  return sampled > 0 ? white / sampled : 0;
}

/**
 * 원본 RGB는 한 바이트도 바꾸지 않고 alpha 채널만 만든다.
 * 가장자리 대부분이 흰색인 스튜디오 사진에서만 동작하며, 확신이 낮으면 실패한다.
 */
export async function extractLockedProductPng(
  sourcePath: string,
  outputDir: string,
): Promise<ProductImageLockManifest> {
  if (!fs.existsSync(sourcePath)) throw new Error(`상품 원본 이미지를 찾을 수 없습니다: ${sourcePath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const decoded = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  const edgeRatio = edgeWhiteness(decoded.data, width, height, channels);
  if (edgeRatio < 0.84) {
    throw new Error(`상품 분리 신뢰도가 낮아 원본 상세 이미지를 유지합니다. edge=${edgeRatio.toFixed(3)}`);
  }

  const output = Buffer.from(decoded.data);
  let removed = 0;
  for (let offset = 0; offset < output.length; offset += channels) {
    const r = output[offset] ?? 0;
    const g = output[offset + 1] ?? 0;
    const b = output[offset + 2] ?? 0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const neutral = max - min <= 12;
    // RGB는 그대로 두고 alpha만 조정한다. 반투명 경계는 색을 섞지 않는다.
    if (neutral && min >= 248) {
      output[offset + 3] = 0;
      removed += 1;
    } else if (neutral && min >= 238) {
      output[offset + 3] = Math.max(0, Math.min(255, Math.round((248 - min) * 25.5)));
    }
  }

  const removedPixelRatio = removed / (width * height);
  if (removedPixelRatio < 0.08 || removedPixelRatio > 0.94) {
    throw new Error(`상품 분리 결과가 안전 범위를 벗어나 원본 상세 이미지를 유지합니다. removed=${removedPixelRatio.toFixed(3)}`);
  }

  const lockedPngPath = path.join(outputDir, `locked-product-${Date.now()}.png`);
  await sharp(output, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toFile(lockedPngPath);
  const manifest: ProductImageLockManifest = {
    version: "product-image-lock/v1",
    sourcePath: path.resolve(sourcePath),
    sourceSha256: sha256File(sourcePath),
    lockedPngPath: path.resolve(lockedPngPath),
    lockedPngSha256: sha256File(lockedPngPath),
    width,
    height,
    extraction: "near-white-alpha",
    removedPixelRatio,
    confidence: Math.min(1, edgeRatio * 0.65 + Math.min(1, removedPixelRatio * 2) * 0.35),
    rgbPreserved: true,
  };
  fs.writeFileSync(`${lockedPngPath}.lock.json`, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function createLockedProductThumbnail(options: {
  sourcePath: string;
  outputDir: string;
  productName: string;
  headline: string;
  subline: string;
  style?: ShoppingThumbnailStyle;
}): Promise<LockedProductThumbnailResult> {
  const lock = await extractLockedProductPng(options.sourcePath, options.outputDir);
  const product = await sharp(lock.lockedPngPath)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .resize(430, 720, { fit: "contain", withoutEnlargement: true, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const svg = await buildThumbnailOverlayV2({
    eyebrow: options.productName,
    headline: options.headline || options.subline,
    style: thumbnailV2Style(options.style),
    subjectSide: "right",
  });
  const outputPath = path.join(options.outputDir, `locked-product-thumbnail-${Date.now()}.png`);
  await sharp(svg)
    .composite([{ input: product, left: 620, top: 190 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  return { outputPath, lock };
}

/** GPT가 만든 상품 없는 실사 배경 위에 잠긴 원본 상품과 검증된 한글 카피만 합성한다. */
export async function createLockedProductThumbnailOnBackground(options: {
  sourcePath: string;
  backgroundPath: string;
  outputDir: string;
  productName: string;
  headline: string;
  subline: string;
  style?: ThumbnailV2Style;
}): Promise<LockedProductThumbnailResult> {
  if (!fs.existsSync(options.backgroundPath)) throw new Error("GPT 생성 배경 이미지를 찾을 수 없습니다.");
  const lock = await extractLockedProductPng(options.sourcePath, options.outputDir);
  const background = await sharp(options.backgroundPath)
    .resize(1080, 1080, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.96, saturation: 0.94 })
    .png()
    .toBuffer();
  const product = await sharp(lock.lockedPngPath)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .resize(430, 720, { fit: "contain", withoutEnlargement: true, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const overlay = await buildThumbnailOverlayV2({
    eyebrow: options.productName,
    headline: options.headline || options.subline,
    style: options.style || "shopping-color-block",
    subjectSide: "right",
    transparentBackground: true,
  });
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `gpt-background-product-thumbnail-${Date.now()}.png`);
  await sharp(background)
    .composite([{ input: overlay }, { input: product, left: 620, top: 190 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  return { outputPath, lock };
}

/** 배경 분리가 불확실할 때 상세페이지 원본 사진을 그대로 카드에 배치한다. */
export async function createOriginalProductPhotoThumbnail(options: {
  sourcePath: string;
  outputDir: string;
  productName: string;
  headline: string;
  subline: string;
  style?: ShoppingThumbnailStyle;
}): Promise<{ outputPath: string; sourceSha256: string }> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const photo = await sharp(options.sourcePath)
    .resize(410, 690, {
      fit: "contain",
      withoutEnlargement: true,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
  const svg = await buildThumbnailOverlayV2({
    eyebrow: options.productName,
    headline: options.headline || options.subline,
    style: thumbnailV2Style(options.style),
    subjectSide: "right",
  });
  const outputPath = path.join(options.outputDir, `original-product-thumbnail-${Date.now()}.png`);
  await sharp(svg)
    .composite([{ input: photo, left: 630, top: 200 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  return { outputPath, sourceSha256: sha256File(options.sourcePath) };
}

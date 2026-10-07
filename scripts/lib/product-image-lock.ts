import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { preserveProductPhotoSource } from "./product-photo-provenance";
import { compactProductDisplayName } from "./product-thumbnail";
import {
  buildThumbnailOverlayV2,
  generateThumbnailCropPreviews,
  renderShoppingPhotoThumbnail,
  type ThumbnailV2Style,
} from "./thumbnail-layout-v2";
import { inferProductPhysicalScale, type ProductPhysicalScale } from "./product-9canvas";

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

export interface ProductCompositionProfile {
  physicalScale: ProductPhysicalScale;
  maxWidth: number;
  maxHeight: number;
  bottomOffset: number;
  minimumShadowRadius: number;
  shadowHeight: number;
}

const COMPOSITION_PROFILES: Record<ProductPhysicalScale, Omit<ProductCompositionProfile, "physicalScale">> = {
  wearable: { maxWidth: 260, maxHeight: 360, bottomOffset: 150, minimumShadowRadius: 45, shadowHeight: 14 },
  handheld: { maxWidth: 340, maxHeight: 520, bottomOffset: 105, minimumShadowRadius: 60, shadowHeight: 18 },
  desktop: { maxWidth: 430, maxHeight: 610, bottomOffset: 85, minimumShadowRadius: 78, shadowHeight: 22 },
  floor: { maxWidth: 500, maxHeight: 700, bottomOffset: 80, minimumShadowRadius: 100, shadowHeight: 26 },
  package: { maxWidth: 400, maxHeight: 540, bottomOffset: 95, minimumShadowRadius: 72, shadowHeight: 20 },
};

export function resolveProductCompositionProfile(
  productName = "",
  physicalScale?: ProductPhysicalScale,
): ProductCompositionProfile {
  const resolvedScale = physicalScale || inferProductPhysicalScale(productName);
  return { physicalScale: resolvedScale, ...COMPOSITION_PROFILES[resolvedScale] };
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
  const outputPath = path.join(options.outputDir, `locked-product-thumbnail-${Date.now()}.png`);
  await renderShoppingPhotoThumbnail({ sourcePath: options.sourcePath, outputPath,
    headline: options.headline || options.subline, style: thumbnailV2Style(options.style) });
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  preserveProductPhotoSource({ sourcePath: options.sourcePath, outputPath, segmented: false, provenance: "PHOTO_TEXT_THUMBNAIL" });
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
    .resize(740, 900, { fit: "inside", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const overlay = await buildThumbnailOverlayV2({
    eyebrow: compactProductDisplayName(options.productName),
    headline: options.headline || options.subline,
    subline: options.subline,
    style: options.style || "shopping-color-block",
    subjectSide: "right",
    transparentBackground: true,
  });
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `gpt-background-product-thumbnail-${Date.now()}.png`);
  const productSize = await sharp(product).metadata();
  await sharp(background)
    .composite([{ input: product, left: Math.floor((1080 - productSize.width!) / 2), top: 50 }, { input: overlay }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  preserveProductPhotoSource({ sourcePath: options.sourcePath, outputPath, segmented: true });
  return { outputPath, lock };
}

/** 본문용 실사 연출컷. GPT는 상품 없는 배경만 만들고, 원본 상품 RGB는 그대로 합성한다. */
export async function createLockedProductEditorialScene(options: {
  sourcePath: string;
  backgroundPath: string;
  outputDir: string;
  variant?: number;
  productName?: string;
  physicalScale?: ProductPhysicalScale;
}): Promise<LockedProductThumbnailResult> {
  if (!fs.existsSync(options.backgroundPath)) throw new Error("GPT 생성 배경 이미지를 찾을 수 없습니다.");
  const lock = await extractLockedProductPng(options.sourcePath, options.outputDir);
  const canvasWidth = 1200;
  const canvasHeight = 900;
  const profile = resolveProductCompositionProfile(options.productName, options.physicalScale);
  const placeOnLeft = (options.variant || 0) % 2 === 1;
  const background = await sharp(options.backgroundPath)
    .resize(canvasWidth, canvasHeight, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.98, saturation: 0.92 })
    .png()
    .toBuffer();
  const product = await sharp(lock.lockedPngPath)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .resize(profile.maxWidth, profile.maxHeight, {
      fit: "contain",
      withoutEnlargement: true,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const metadata = await sharp(product).metadata();
  const productWidth = metadata.width || profile.maxWidth;
  const productHeight = metadata.height || profile.maxHeight;
  const left = placeOnLeft ? 90 : canvasWidth - productWidth - 90;
  const top = Math.max(80, canvasHeight - productHeight - profile.bottomOffset);
  const shadow = Buffer.from(
    `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${left + productWidth / 2}" cy="${Math.min(canvasHeight - 35, top + productHeight - 5)}" rx="${Math.max(profile.minimumShadowRadius, productWidth * 0.34)}" ry="${profile.shadowHeight}" fill="#111827" opacity=".18" filter="blur(12px)"/></svg>`,
  );
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `locked-product-scene-${Date.now()}.png`);
  const disclosure = Buffer.from(`<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="842" width="480" height="40" rx="8" fill="white" fill-opacity=".92"/><text x="36" y="869" font-family="Malgun Gothic, sans-serif" font-size="22" fill="#334155">AI 연출 이미지 · 실제 사용 사진 아님</text></svg>`);
  await sharp(background)
    .composite([{ input: shadow }, { input: product, left, top }, { input: disclosure }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  preserveProductPhotoSource({ sourcePath: options.sourcePath, outputPath, segmented: true });
  return { outputPath, lock };
}

/** Keep the entire original photo visible when safe alpha extraction is impossible.
 * This is an editorial card, NOT a segmented/locked product or an actual scene photo.
 */
export async function createOriginalProductPhotoOnBackground(options: {
  sourcePath: string;
  backgroundPath: string;
  outputDir: string;
}): Promise<{ outputPath: string; sourceSha256: string }> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const photo = await sharp(fs.readFileSync(options.sourcePath)).rotate()
    .resize(680, 680, { fit: "inside", withoutEnlargement: true })
    .png().toBuffer();
  const metadata = await sharp(photo).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  const padding = 20;
  const card = await sharp({ create: {
    width: width + padding * 2, height: height + padding * 2,
    channels: 4, background: "#ffffff",
  } }).composite([{ input: photo, left: padding, top: padding }]).png().toBuffer();
  const left = 64;
  const top = Math.floor((900 - height - padding * 2) / 2);
  const outputPath = path.join(options.outputDir, `original-photo-background-${crypto.randomUUID()}.png`);
  // Node supports long Windows package paths that native libvips file I/O may reject.
  const bytes = await sharp(fs.readFileSync(options.backgroundPath)).resize(1200, 900, { fit: "cover" })
    .composite([{ input: card, left, top }]).png().toBuffer();
  fs.writeFileSync(outputPath, bytes);
  const sourceSha256 = sha256File(options.sourcePath);
  preserveProductPhotoSource({ sourcePath: options.sourcePath, outputPath, segmented: false });
  return { outputPath, sourceSha256 };
}

/** Thumbnail-only fallback: a large complete original photo and a prominent title, never a card. */
export async function createOriginalProductPhotoThumbnail(options: {
  sourcePath: string;
  outputDir: string;
  productName: string;
  headline: string;
  subline: string;
  style?: ShoppingThumbnailStyle;
}): Promise<{ outputPath: string; sourceSha256: string }> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `original-product-thumbnail-${Date.now()}.png`);
  await renderShoppingPhotoThumbnail({ sourcePath: options.sourcePath, outputPath,
    headline: options.headline || options.subline, style: thumbnailV2Style(options.style) });
  await generateThumbnailCropPreviews(outputPath, options.outputDir);
  preserveProductPhotoSource({ sourcePath: options.sourcePath, outputPath, segmented: false, provenance: "PHOTO_TEXT_THUMBNAIL" });
  return { outputPath, sourceSha256: sha256File(options.sourcePath) };
}

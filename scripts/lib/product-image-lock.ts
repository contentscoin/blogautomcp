import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

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

function shoppingPalette(style: ShoppingThumbnailStyle) {
  if (style === "shopping-bold") return { start: "#09090b", end: "#312e81", halo: "#fef3c7", accent: "#f97316", label: "#fdba74" };
  if (style === "shopping-soft") return { start: "#f8fafc", end: "#dbeafe", halo: "#ffffff", accent: "#2563eb", label: "#1d4ed8", darkText: true };
  return { start: "#07111f", end: "#243b53", halo: "#e9f2f9", accent: "#facc15", label: "#8bd3ff" };
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

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const palette = shoppingPalette(options.style || "shopping-clean");
  const headlineColor = palette.darkText ? "#0f172a" : "#ffffff";
  const sublineColor = palette.darkText ? "#334155" : "#d9e7f2";
  const product = await sharp(lock.lockedPngPath)
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .resize(760, 720, { fit: "contain", withoutEnlargement: true, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const svg = Buffer.from(`<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.start}"/><stop offset="1" stop-color="${palette.end}"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-opacity=".22"/></filter></defs>
    <rect width="1600" height="900" fill="url(#bg)"/><circle cx="1220" cy="420" r="390" fill="${palette.halo}" opacity=".98"/>
    <rect x="34" y="34" width="1532" height="832" rx="34" fill="none" stroke="${palette.darkText ? "#94a3b8" : "#fff"}" stroke-width="5" opacity=".9"/>
    <text x="100" y="165" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="38" font-weight="800" fill="${palette.label}">${escapeXml(options.productName.slice(0, 34))}</text>
    <text x="100" y="330" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="92" font-weight="900" fill="${headlineColor}">${escapeXml(options.headline)}</text>
    <text x="100" y="415" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="42" font-weight="700" fill="${sublineColor}">${escapeXml(options.subline)}</text>
    <rect x="100" y="700" width="330" height="82" rx="41" fill="${palette.accent}" filter="url(#shadow)"/><text x="265" y="755" text-anchor="middle" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="36" font-weight="900" fill="#111827">구매 포인트</text>
  </svg>`);
  const outputPath = path.join(options.outputDir, `locked-product-thumbnail-${Date.now()}.png`);
  await sharp(svg)
    .composite([{ input: product, left: 850, top: 100 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
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
  const palette = shoppingPalette(options.style || "shopping-clean");
  const photo = await sharp(options.sourcePath).resize(760, 720, { fit: "contain", withoutEnlargement: true, background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
  const headlineColor = palette.darkText ? "#0f172a" : "#fff";
  const svg = Buffer.from(`<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg"><stop stop-color="${palette.start}"/><stop offset="1" stop-color="${palette.end}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#bg)"/><rect x="805" y="70" width="745" height="760" rx="42" fill="#fff"/><text x="92" y="165" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="36" font-weight="800" fill="${palette.label}">${escapeXml(options.productName.slice(0, 34))}</text><text x="92" y="330" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="88" font-weight="900" fill="${headlineColor}">${escapeXml(options.headline)}</text><text x="92" y="420" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="40" font-weight="700" fill="${palette.darkText ? "#334155" : "#dbeafe"}">${escapeXml(options.subline)}</text><rect x="92" y="700" width="330" height="82" rx="41" fill="${palette.accent}"/><text x="257" y="755" text-anchor="middle" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="36" font-weight="900" fill="#111827">원본 사진 사용</text></svg>`);
  const outputPath = path.join(options.outputDir, `original-product-thumbnail-${Date.now()}.png`);
  await sharp(svg).composite([{ input: photo, left: 800, top: 90 }]).png({ compressionLevel: 9 }).toFile(outputPath);
  return { outputPath, sourceSha256: sha256File(options.sourcePath) };
}

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const THUMBNAIL_V2_WIDTH = 1080;
export const THUMBNAIL_V2_HEIGHT = 1080;
export const SHOPPING_THUMBNAIL_MIN_FONT_SIZE = 132;
export const SHOPPING_THUMBNAIL_MAX_FONT_SIZE = 170;
export const SHOPPING_THUMBNAIL_LAYOUT_VERSION = "shopping-photo-headline/v1";
export const SHOPPING_THUMBNAIL_SOURCE_MIN_ASPECT = 0.55;
export const SHOPPING_THUMBNAIL_SOURCE_MAX_ASPECT = 1.85;

/** The same intact-photo aspect requirement applies before selection and rendering. */
export function isShoppingThumbnailSourceAspectAllowed(metadata: { width?: number; height?: number }): boolean {
  const { width, height } = metadata;
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) &&
    width > 0 && height > 0 && width / height >= SHOPPING_THUMBNAIL_SOURCE_MIN_ASPECT &&
    width / height <= SHOPPING_THUMBNAIL_SOURCE_MAX_ASPECT;
}

/** Read metadata only; an unreadable source never becomes a thumbnail candidate. */
export async function isShoppingThumbnailSourceEligible(sourcePath: string): Promise<boolean> {
  try { return isShoppingThumbnailSourceAspectAllowed(await sharp(fs.readFileSync(sourcePath)).metadata()); }
  catch { return false; }
}

/** Shopping thumbnails have one photographic scene and one short, prominent title. */
export const SHOPPING_THUMBNAIL_LAYOUT_RULES = [
  "- 1080 x 1080, 1:1 square Korean Naver blog thumbnail; one continuous full-bleed natural photograph.",
  "- A YouTube-thumbnail-size Korean headline is the only added text: at most two lines, about 6-14 Korean characters, 132-170 px bold lettering on the 1080 px canvas. It must be immediately readable at BOTH 120 x 120 and 240 x 240 previews.",
  "- Keep headline glyphs inside a safe zone 6% away from every edge. Place them in real negative space, with a restrained dark shadow/outline or soft photographic gradient for contrast.",
  "- The product is large, sharp and naturally present in the same photograph, occupying roughly 55-75% of the frame height. Preserve its full silhouette, garment waistband and hems, packaging, proportions and identifying details.",
  "- No editorial card, explanatory frame, white border, inset product photo, split panel, color-block layout, badge, bullet list, CTA button or floating mockup. Do not shrink the photograph to make room for text.",
  "- Text and the product must both be prominent; use light and camera composition to find space, never cover distinguishing product features or fabricate claims.",
] as const;

export function normalizeShoppingThumbnailHeadline(text: string): string {
  const cleaned = text.replace(/\s+/gu, " ").trim();
  if (!cleaned) return "구매 전 확인";
  const characters = Array.from(cleaned);
  if (characters.length <= 14) return cleaned;
  const candidate = characters.slice(0, 14).join("");
  const lastSpace = candidate.lastIndexOf(" ");
  return (lastSpace >= 6 ? candidate.slice(0, lastSpace) : candidate).trim();
}

export type ThumbnailV2Style =
  | "shopping-clean-editorial"
  | "shopping-color-block"
  | "shopping-soft-lifestyle"
  | "travel-cinematic"
  | "travel-emotional-record"
  | "travel-route";

export interface FittedThumbnailText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  width: number;
  height: number;
  truncated: boolean;
}

const FONT_FAMILY = "Pretendard,Malgun Gothic,Apple SD Gothic Neo,Noto Sans CJK KR,sans-serif";
let cachedFontCss: string | null | undefined;

function embeddedFontCss(): string {
  if (cachedFontCss !== undefined) return cachedFontCss || "";
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "fonts", "Pretendard-ExtraBold.woff2") : "",
    path.join(process.cwd(), "node_modules", "pretendard", "dist", "web", "static", "woff2", "Pretendard-ExtraBold.woff2"),
    path.resolve(__dirname, "..", "..", "node_modules", "pretendard", "dist", "web", "static", "woff2", "Pretendard-ExtraBold.woff2"),
  ].filter(Boolean);
  const fontPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!fontPath) {
    cachedFontCss = null;
    return "";
  }
  const data = fs.readFileSync(fontPath).toString("base64");
  cachedFontCss = `@font-face{font-family:'Pretendard';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  return cachedFontCss;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(value),
      (item) => item.segment,
    );
  }
  return Array.from(value);
}

async function measureText(text: string, fontSize: number, fontWeight = 900): Promise<{ width: number; height: number }> {
  if (!text) return { width: 0, height: 0 };
  const margin = Math.ceil(fontSize * 0.6);
  const svg = Buffer.from(
    `<svg width="2400" height="500" xmlns="http://www.w3.org/2000/svg"><style>${embeddedFontCss()}</style><text x="${margin}" y="${fontSize + margin}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${fontWeight}" fill="#000">${escapeXml(text)}</text></svg>`,
  );
  const { info } = await sharp(svg).trim().png().toBuffer({ resolveWithObject: true });
  return { width: info.width || 0, height: info.height || fontSize };
}

async function wrapToTwoLines(text: string, fontSize: number, maxWidth: number): Promise<string[] | null> {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return ["선택 기준"];
  if ((await measureText(normalized, fontSize)).width <= maxWidth) return [normalized];

  const units = normalized.includes(" ") ? normalized.split(" ") : graphemes(normalized);
  const separator = normalized.includes(" ") ? " " : "";
  let first = "";
  let breakIndex = 0;
  for (let index = 0; index < units.length; index += 1) {
    const candidate = first ? `${first}${separator}${units[index]}` : units[index];
    if ((await measureText(candidate, fontSize)).width > maxWidth) break;
    first = candidate;
    breakIndex = index + 1;
  }
  if (!first || breakIndex >= units.length) return null;
  const second = units.slice(breakIndex).join(separator);
  if ((await measureText(second, fontSize)).width > maxWidth) return null;
  return [first, second];
}

async function ellipsize(text: string, fontSize: number, maxWidth: number): Promise<string> {
  const units = graphemes(text);
  while (units.length > 1) {
    const candidate = `${units.join("").trim()}…`;
    if ((await measureText(candidate, fontSize)).width <= maxWidth) return candidate;
    units.pop();
  }
  return "…";
}

export async function fitThumbnailHeadline(options: {
  text: string;
  maxWidth: number;
  maxHeight: number;
  minFontSize?: number;
  maxFontSize?: number;
  maxLines?: 1 | 2;
}): Promise<FittedThumbnailText> {
  const minFontSize = options.minFontSize || 54;
  const maxFontSize = options.maxFontSize || 116;
  let low = minFontSize;
  let high = maxFontSize;
  let best: FittedThumbnailText | null = null;

  while (low <= high) {
    const fontSize = Math.floor((low + high) / 2);
    const lines = await wrapToTwoLines(options.text, fontSize, options.maxWidth);
    const lineHeight = Math.round(fontSize * 1.14);
    const height = (lines?.length || 3) * lineHeight;
    if (lines && lines.length <= (options.maxLines || 2) && height <= options.maxHeight) {
      const widths = await Promise.all(lines.map((line) => measureText(line, fontSize)));
      best = {
        lines,
        fontSize,
        lineHeight,
        width: Math.max(...widths.map((item) => item.width)),
        height,
        truncated: false,
      };
      low = fontSize + 1;
    } else {
      high = fontSize - 1;
    }
  }

  if (best) return best;
  const fontSize = minFontSize;
  const normalized = options.text.replace(/\s+/g, " ").trim();
  if (options.maxLines === 1) {
    return { lines: [await ellipsize(normalized, fontSize, options.maxWidth)], fontSize, lineHeight: Math.round(fontSize * 1.14), width: options.maxWidth, height: Math.round(fontSize * 1.14), truncated: true };
  }
  const midpoint = Math.max(1, Math.ceil(graphemes(normalized).length / 2));
  const chars = graphemes(normalized);
  const first = await ellipsize(chars.slice(0, midpoint).join(""), fontSize, options.maxWidth);
  const second = await ellipsize(chars.slice(midpoint).join(""), fontSize, options.maxWidth);
  return {
    lines: [first, second].filter((line) => line !== "…" || first === "…"),
    fontSize,
    lineHeight: Math.round(fontSize * 1.14),
    width: options.maxWidth,
    height: Math.round(fontSize * 2.28),
    truncated: true,
  };
}

function styleTokens(style: ThumbnailV2Style) {
  switch (style) {
    case "shopping-color-block":
      return { background: "#172554", accent: "#f97316", text: "#ffffff", eyebrow: "#fed7aa", panel: "#1e3a8a" };
    case "shopping-soft-lifestyle":
      return { background: "#f6f1ea", accent: "#2563eb", text: "#172033", eyebrow: "#1d4ed8", panel: "#ffffff" };
    case "travel-cinematic":
      return { background: "#07111f", accent: "#f59e0b", text: "#ffffff", eyebrow: "#fde68a", panel: "#07111f" };
    case "travel-emotional-record":
      return { background: "#3f2d24", accent: "#fb7185", text: "#fffaf3", eyebrow: "#fecdd3", panel: "#3f2d24" };
    case "travel-route":
      return { background: "#082f49", accent: "#38bdf8", text: "#f0f9ff", eyebrow: "#bae6fd", panel: "#082f49" };
    default:
      return { background: "#f8fafc", accent: "#2563eb", text: "#0f172a", eyebrow: "#1d4ed8", panel: "#ffffff" };
  }
}

export async function buildThumbnailOverlayV2(options: {
  eyebrow: string;
  headline: string;
  subline?: string;
  style: ThumbnailV2Style;
  subjectSide?: "left" | "right" | "full";
  transparentBackground?: boolean;
}): Promise<Buffer> {
  if (options.style.startsWith("shopping-")) return buildShoppingPhotoHeadlineOverlay(options);
  const tokens = styleTokens(options.style);
  const isTravel = options.style.startsWith("travel-");
  const subjectSide = options.subjectSide || (isTravel ? "full" : "right");
  const textBox = subjectSide === "full" ? { x: 64, width: 780 } : { x: 62, width: 500 };
  const fitted = await fitThumbnailHeadline({
    text: options.headline,
    maxWidth: textBox.width,
    maxHeight: 286,
    minFontSize: 58,
    maxFontSize: subjectSide === "full" ? 112 : 96,
  });
  const headlineY = subjectSide === "full" ? 700 : 310;
  const eyebrow = await fitThumbnailHeadline({ text: options.eyebrow, maxWidth: textBox.width, maxHeight: 40, minFontSize: 24, maxFontSize: 30, maxLines: 1 });
  const subline = options.subline ? await fitThumbnailHeadline({ text: options.subline, maxWidth: textBox.width, maxHeight: 45, minFontSize: 24, maxFontSize: 32, maxLines: 1 }) : null;
  const textElements = (subline ? `<text x="${textBox.x}" y="${headlineY + fitted.lines.length * fitted.lineHeight + 32}" font-family="${FONT_FAMILY}" font-size="${subline.fontSize}" fill="${tokens.text}">${escapeXml(subline.lines[0])}</text>` : "") + fitted.lines
    .map(
      (line, index) =>
        `<text x="${textBox.x}" y="${headlineY + index * fitted.lineHeight}" font-family="${FONT_FAMILY}" font-size="${fitted.fontSize}" font-weight="900" fill="${tokens.text}" filter="url(#textShadow)">${escapeXml(line)}</text>`,
    )
    .join("");
  const shade = isTravel
    ? `<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".05"/><stop offset=".48" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="${tokens.panel}" stop-opacity=".94"/></linearGradient>`
      : `<linearGradient id="shade" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${tokens.background}"/><stop offset="1" stop-color="${tokens.panel}"/></linearGradient>`;
  const readableShade = options.transparentBackground
    ? `<linearGradient id="readable" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#07111f" stop-opacity=".84"/><stop offset=".56" stop-color="#07111f" stop-opacity=".48"/><stop offset="1" stop-color="#07111f" stop-opacity=".08"/></linearGradient>`
    : "";
  const route = options.style === "travel-route"
    ? `<path d="M720 180 C850 300 710 420 930 520" fill="none" stroke="${tokens.accent}" stroke-width="7" stroke-linecap="round" stroke-dasharray="10 18" opacity=".9"/><circle cx="720" cy="180" r="11" fill="${tokens.accent}"/><circle cx="930" cy="520" r="11" fill="${tokens.accent}"/>`
    : "";
  const subjectGuide = !isTravel
    ? `<rect x="610" y="72" width="410" height="936" rx="52" fill="${tokens.panel}" fill-opacity=".78"/><ellipse cx="815" cy="900" rx="180" ry="30" fill="#0f172a" opacity=".11"/>`
    : "";

  const backgroundRect = options.transparentBackground
    ? `<rect width="1080" height="1080" fill="url(#${isTravel ? "shade" : "readable"})"/>`
    : `<rect width="1080" height="1080" fill="url(#shade)"/>`;
  return Buffer.from(`<svg width="${THUMBNAIL_V2_WIDTH}" height="${THUMBNAIL_V2_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><style>${embeddedFontCss()}</style>${shade}${readableShade}<filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#000" flood-opacity=".26"/></filter></defs>${backgroundRect}${subjectGuide}${route}<rect x="${textBox.x}" y="${subjectSide === "full" ? 490 : 126}" width="86" height="8" rx="4" fill="${tokens.accent}"/><text x="${textBox.x}" y="${subjectSide === "full" ? 554 : 198}" font-family="${FONT_FAMILY}" font-size="${eyebrow.fontSize}" font-weight="800" fill="${tokens.eyebrow}" letter-spacing="1">${escapeXml(eyebrow.lines[0])}</text>${textElements}</svg>`);
}

export async function buildShoppingPhotoHeadlineOverlay(options: {
  headline: string;
  style?: ThumbnailV2Style;
}): Promise<Buffer> {
  const headline = normalizeShoppingThumbnailHeadline(options.headline);
  const fitted = await fitThumbnailHeadline({
    text: headline, maxWidth: 948, maxHeight: 398,
    minFontSize: SHOPPING_THUMBNAIL_MIN_FONT_SIZE,
    maxFontSize: SHOPPING_THUMBNAIL_MAX_FONT_SIZE,
  });
  const accent = options.style === "shopping-soft-lifestyle" ? "#fff2c2" : "#ffe75a";
  const firstBaseline = 960 - (fitted.lines.length - 1) * fitted.lineHeight;
  const words = fitted.lines.map((line, index) => `<text x="66" y="${firstBaseline + index * fitted.lineHeight}" font-family="${FONT_FAMILY}" font-size="${fitted.fontSize}" font-weight="900" fill="${index === fitted.lines.length - 1 ? accent : "#ffffff"}" stroke="#111827" stroke-opacity=".84" stroke-width="5" stroke-linejoin="round" paint-order="stroke fill">${escapeXml(line)}</text>`).join("");
  return Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg" data-layout="${SHOPPING_THUMBNAIL_LAYOUT_VERSION}" data-font-size="${fitted.fontSize}"><defs><style>${embeddedFontCss()}</style><linearGradient id="photoShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07111f" stop-opacity="0"/><stop offset=".45" stop-color="#07111f" stop-opacity="0"/><stop offset=".72" stop-color="#07111f" stop-opacity=".5"/><stop offset="1" stop-color="#07111f" stop-opacity=".76"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#photoShade)"/>${words}</svg>`);
}

/** Preserve the complete photo; extend only its surroundings to fill a square. */
export async function renderShoppingPhotoThumbnail(options: {
  sourcePath: string;
  outputPath: string;
  headline: string;
  style?: ThumbnailV2Style;
}): Promise<void> {
  const source = fs.readFileSync(options.sourcePath);
  const metadata = await sharp(source).metadata();
  if (!isShoppingThumbnailSourceAspectAllowed(metadata)) {
    throw new Error("썸네일에는 긴 상세페이지나 가로 배너 대신 상품 전체가 크게 보이는 사진을 선택하세요.");
  }
  const { data: photo, info } = await sharp(source).rotate()
    .resize(1080, 1080, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  const background = await sharp(source).rotate()
    .resize(1080, 1080, { fit: "cover", position: "centre" }).blur(28).png().toBuffer();
  const overlay = await buildShoppingPhotoHeadlineOverlay(options);
  const bytes = await sharp(background).composite([
    { input: photo, left: Math.floor((1080 - info.width) / 2), top: Math.floor((1080 - info.height) / 2) },
    { input: overlay },
  ]).png({ compressionLevel: 9 }).toBuffer();
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, bytes);
}

export async function generateThumbnailCropPreviews(
  sourcePath: string,
  outputDir: string,
): Promise<{ square: string; fourThree: string; wide: string; tiny: string; small: string }> {
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = Date.now();
  const square = path.join(outputDir, `thumbnail-preview-${stamp}-1x1.jpg`);
  const fourThree = path.join(outputDir, `thumbnail-preview-${stamp}-4x3.jpg`);
  const wide = path.join(outputDir, `thumbnail-preview-${stamp}-16x9.jpg`);
  const tiny = path.join(outputDir, `thumbnail-preview-${stamp}-120.jpg`);
  const small = path.join(outputDir, `thumbnail-preview-${stamp}-240.jpg`);
  await Promise.all([
    sharp(sourcePath).resize(540, 540, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toFile(square),
    sharp(sourcePath).resize(540, 405, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toFile(fourThree),
    sharp(sourcePath).resize(540, 304, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toFile(wide),
    sharp(sourcePath).resize(120, 120, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toFile(tiny),
    sharp(sourcePath).resize(240, 240, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toFile(small),
  ]);
  return { square, fourThree, wide, tiny, small };
}

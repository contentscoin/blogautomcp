import fs from "fs";
import path from "path";
import sharp, { type OverlayOptions } from "sharp";
import { buildTravelThumbnailCopy } from "./travel-content";

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;

export interface ProductThumbnailCopy {
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

interface ResolvedThumbnailImages {
  backgroundPath: string;
  heroPath: string;
}

interface HeroImageScore {
  imagePath: string;
  score: number;
}

export interface GenerateProductThumbnailOptions {
  imagePaths: string[];
  postTitle: string;
  productName: string;
  outputDir: string;
  enabled?: boolean;
  copy?: Partial<ProductThumbnailCopy>;
  preferredImagePath?: string;
  contentKind?: "SHOPPING" | "TRAVEL";
}

export interface ProductThumbnailResult {
  outputPath: string;
  backgroundPath: string;
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

export interface BuildProductThumbnailGenerationPromptOptions {
  postTitle: string;
  productName: string;
  categoryName?: string;
  description?: string;
  features?: string[];
  price?: string;
}

export interface ProductThumbnailGenerationPrompt {
  prompt: string;
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

type ThumbnailTheme = {
  keywords: RegExp[];
  headline: string;
  subline: string;
  cta: string;
};

const THUMBNAIL_THEMES: ThumbnailTheme[] = [
  {
    keywords: [/꼬리뼈|치질|자세교정|방석|쿠션|의자/],
    headline: "착석감 체크",
    subline: "두께·좌판·커버 확인",
    cta: "앉는 자리 체크",
  },
  {
    keywords: [/보냉백|쿨러백|아이스박스|소프트쿨러|캠핑|피크닉/],
    headline: "보냉력 체크",
    subline: "용량·수납·휴대성",
    cta: "사용 포인트",
  },
  {
    keywords: [/드라이기|헤어|고데기|트리머|면도기|뷰티|바디/],
    headline: "사용감 체크",
    subline: "바람·무게·구성 확인",
    cta: "장단점 확인",
  },
  {
    keywords: [/청소기|로봇청소기|침구청소|물걸레|흡입|살균/],
    headline: "흡입력 체크",
    subline: "공간별 사용 포인트",
    cta: "구매 전 체크",
  },
  {
    keywords: [/선풍기|서큘레이터|냉각|쿨링|에어컨/],
    headline: "쿨링감 체크",
    subline: "휴대성·풍량 비교",
    cta: "실사용 포인트",
  },
  {
    keywords: [/냉장고|냉동고|주방|가전|오븐|전자레인지/],
    headline: "용량 체크",
    subline: "설치·구성 확인",
    cta: "구매 전 확인",
  },
  {
    keywords: [/노트북|태블릿|모니터|키보드|마우스|충전|케이블|스마트|카플레이|안드로이드오토/],
    headline: "기능 체크",
    subline: "연결·호환성 확인",
    cta: "스펙 확인",
  },
  {
    keywords: [/식품|영양제|커피|차|간식|오메가|비타민/],
    headline: "구성 확인",
    subline: "맛·용량·섭취 포인트",
    cta: "후기 보기",
  },
  {
    keywords: [/골프|스포츠|운동|캠핑|레저/],
    headline: "활용도 체크",
    subline: "착용감·수납·내구성",
    cta: "포인트 확인",
  },
];

const DEFAULT_COPY: Omit<ProductThumbnailCopy, "productNameLabel"> = {
  headline: "구매 전 확인",
  subline: "장단점 빠르게 체크",
  badge: "오늘 추천",
  cta: "리뷰 보기",
};

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string): string {
  return sanitizeText(value)
    .replace(/\[[^\]]+\]|\([^)]+\)/g, " ")
    .replace(/[|·]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sanitizeFileNamePart(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized || "thumbnail";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitTextLines(text: string, maxChars: number, maxLines = 3): string[] {
  const normalized = sanitizeText(text);
  if (!normalized) return [];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
    } else if (!current && word.length > maxChars) {
      lines.push(word.slice(0, maxChars));
      current = word.slice(maxChars);
    } else {
      current = next;
    }

    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function pickTheme(productName: string, postTitle: string): ThumbnailTheme | null {
  const target = normalizeForMatch(`${productName} ${postTitle}`);
  return THUMBNAIL_THEMES.find((theme) => theme.keywords.some((keyword) => keyword.test(target))) ?? null;
}

function inferCategoryName(categoryName: string, productName: string): string {
  const given = sanitizeText(categoryName);
  if (given && given !== "상품리뷰") return given;

  const target = productName;
  if (/드라이기|헤어|고데기/.test(target)) return "헤어드라이기";
  if (/꼬리뼈|치질|자세교정|방석|쿠션|의자/.test(target)) return "자세교정 방석";
  if (/보냉백|쿨러백|아이스박스|소프트쿨러|캠핑|피크닉/.test(target)) return "보냉백";
  if (/청소기|로봇청소기/.test(target)) return "청소기";
  if (/선풍기|서큘레이터|냉각/.test(target)) return "휴대용 선풍기";
  if (/냉장고|냉동고/.test(target)) return "주방가전";
  if (/카플레이|안드로이드오토|노트북|모니터|키보드|마우스/.test(target)) return "디지털 기기";
  return "상품리뷰";
}

export function buildProductThumbnailCopy(
  postTitle: string,
  productName: string,
  contentKind: "SHOPPING" | "TRAVEL" = "SHOPPING",
): ProductThumbnailCopy {
  if (contentKind === "TRAVEL") return buildTravelThumbnailCopy(productName);
  const productNameLabel = sanitizeText(productName) || "추천 상품";
  const theme = pickTheme(productNameLabel, postTitle);

  return {
    productNameLabel,
    headline: theme?.headline || DEFAULT_COPY.headline,
    subline: theme?.subline || DEFAULT_COPY.subline,
    badge: DEFAULT_COPY.badge,
    cta: theme?.cta || DEFAULT_COPY.cta,
  };
}

async function buildTravelAccentPng(): Promise<Buffer> {
  const svg = Buffer.from(`<svg width="1600" height="900" viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg">
    <path d="M865 170 C1080 30 1410 130 1490 315" fill="none" stroke="#ffffff" stroke-opacity="0.82" stroke-width="8" stroke-linecap="round" stroke-dasharray="15 18"/>
    <g transform="translate(1430 270) rotate(26)"><path d="M0 20 L104 0 L68 34 L105 57 L88 67 L50 45 L27 70 L13 67 L25 38 L0 28 Z" fill="#ffffff"/></g>
    <circle cx="865" cy="170" r="11" fill="#fbbf24" stroke="#fff" stroke-width="5"/>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

function inferScenePrompt(categoryName: string, productName: string): string {
  const target = normalizeForMatch(`${categoryName} ${productName}`);
  if (/드라이기|헤어|고데기|뷰티|바디|트리머|면도기/.test(target)) {
    return "Photorealistic vanity or clean bathroom counter scene, product as the hero object, premium beauty review mood, realistic shadow and material texture.";
  }
  if (/꼬리뼈|치질|자세교정|방석|쿠션|의자/.test(target)) {
    return "Photorealistic office chair or desk seating scene, seat cushion clearly visible as the hero object, realistic fabric, thickness, chair scale, clean Korean product review lighting.";
  }
  if (/보냉백|쿨러백|아이스박스|소프트쿨러|캠핑|피크닉/.test(target)) {
    return "Photorealistic camping picnic or car trunk packing scene, cooler bag clearly visible as the hero object, realistic fabric, handles, storage scale, clean outdoor review lighting.";
  }
  if (/청소기|로봇청소기|침구청소|물걸레|살균/.test(target)) {
    return "Photorealistic modern Korean home cleaning scene, product clearly visible in use or staged with floor/bed context, premium review lighting.";
  }
  if (/선풍기|냉각|쿨링|서큘레이터|에어컨/.test(target)) {
    return "Photorealistic summer desk or outdoor carry scene, product large and recognizable, cool clean lighting, mobile review thumbnail mood.";
  }
  if (/카플레이|안드로이드오토|디지털|노트북|모니터|키보드|마우스|충전|케이블/.test(target)) {
    return "Photorealistic desk or car interior setup, product as the hero object, realistic accessories, premium tech review mood. Do not add a phone screen unless the product itself requires it.";
  }
  if (/냉장고|냉동고|주방|오븐|전자레인지|가전/.test(target)) {
    return "Photorealistic modern kitchen or appliance showroom scene, product large and clear, clean premium lighting, realistic scale and shadows.";
  }
  if (/식품|영양제|커피|차|간식/.test(target)) {
    return "Photorealistic kitchen or dining table scene, product package and serving visible, appetizing clean lighting.";
  }
  return "Photorealistic everyday Korean home scene, product large and recognizable, clean premium review lighting, realistic shadows and material.";
}

export function buildProductThumbnailGenerationPrompt(
  options: BuildProductThumbnailGenerationPromptOptions
): ProductThumbnailGenerationPrompt {
  const copy = buildProductThumbnailCopy(options.postTitle, options.productName);
  const categoryName = inferCategoryName(options.categoryName || "", options.productName);
  const features = (options.features || [])
    .map((item) => sanitizeText(item))
    .filter(Boolean)
    .slice(0, 4);
  const scenePrompt = inferScenePrompt(categoryName, options.productName);

  const prompt = [
    "Generate ONE finished premium Korean Naver blog product thumbnail image in a single generation.",
    "Everything must be created inside the image: photorealistic product scene, exact product name text, large Korean headline, badge, CTA, product-focused layout, and border.",
    "Use the attached product image as the strict visual reference for shape, color, material, and package impression.",
    "Keep the product recognizable and faithful. Do not invent a different model, color, logo, or unrelated package.",
    "",
    "Product:",
    `- Product name: ${copy.productNameLabel}`,
    `- Exact visible product name label: ${copy.productNameLabel}`,
    `- Category: ${categoryName}`,
    options.description ? `- Product description: ${sanitizeText(options.description).slice(0, 220)}` : "",
    features.length > 0 ? `- Key features: ${features.join(", ")}` : "",
    options.price ? `- Price only if useful and clearly readable: ${sanitizeText(options.price)}` : "",
    "",
    "Canvas and layout:",
    "- 16:9 landscape Korean Naver blog thumbnail.",
    "- Layout A: left dark editorial text panel, right large photorealistic product hero scene.",
    "- Product must be large, sharp, and immediately recognizable.",
    "- Do not trap the product inside a small card, shopping screen, phone, laptop, or mockup.",
    "- Thin white rounded inner border, top red badge, bottom yellow CTA.",
    "- Safe margins around all text. Text must not cover the product body.",
    "",
    "Visible text, exactly these Korean strings:",
    `- Product name label: \"${copy.productNameLabel}\"`,
    `- Main headline: \"${copy.headline}\"`,
    `- Subline: \"${copy.subline}\"`,
    `- Badge: \"${copy.badge}\"`,
    `- CTA: \"${copy.cta}\"`,
    "",
    "Photorealistic product scene:",
    `- ${scenePrompt}`,
    "- Realistic hands, shadows, reflections, product material, package texture where appropriate.",
    // 실사감은 디테일을 더해서가 아니라 광고 화보 쪽 기본 끌림을 상쇄해서 얻는다.
    // 부정문은 모델이 흘리기 쉬우므로 남길 것을 긍정문으로 함께 지목한다(photoreal 스킬).
    "- The scene looks like a real photo taken for a blog with a good camera, not a staged stock advertisement.",
    "- Natural daylight or believable indoor lighting with one consistent shadow direction; keep contact shadows under the product.",
    "- Keep the subtle texture of a real photograph (slight grain, natural color temperature); avoid CG-perfect gloss and heavy retouching.",
    "- Slightly off-center, believable composition instead of perfectly symmetric catalog framing.",
    "- No flat vector illustration, cheap icons, cartoon, or abstract placeholder background — render the product as a physical object in a real place.",
    "",
    "Hard negatives:",
    "- No misspelled Korean, malformed Hangul, fake letters, random extra captions, or cropped text.",
    "- No affiliate commission text, commission rate, seller backend data, watermark, or unverified No.1/lowest-price claim.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    prompt,
    ...copy,
  };
}

function svgTextLines(
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  options: {
    fill: string;
    weight?: number;
    stroke?: string;
    strokeWidth?: number;
    anchor?: "start" | "middle";
  }
): string {
  const anchor = options.anchor ?? "start";
  const stroke =
    options.stroke && options.strokeWidth
      ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth}" paint-order="stroke"`
      : "";
  return [
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="${fontSize}" font-weight="${
      options.weight ?? 800
    }" fill="${options.fill}"${stroke}>`,
    ...lines.map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    }),
    "</text>",
  ].join("");
}

function buildOverlaySvg(copy: ProductThumbnailCopy): string {
  const productLines = splitTextLines(copy.productNameLabel, 17, 3);
  const productFontSize = productLines.length >= 3 ? 43 : 48;
  const productLineHeight = productLines.length >= 3 ? 54 : 60;
  const headlineLines = splitTextLines(copy.headline, 7, 2);
  const sublineLines = splitTextLines(copy.subline, 17, 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="leftPanel" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#07111f" stop-opacity="0.98"/>
      <stop offset="72%" stop-color="#07111f" stop-opacity="0.90"/>
      <stop offset="100%" stop-color="#07111f" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.42"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="760" height="${CANVAS_HEIGHT}" fill="url(#leftPanel)"/>
  <rect x="0" y="610" width="${CANVAS_WIDTH}" height="290" fill="url(#bottomShade)"/>
  <rect x="32" y="32" width="${CANVAS_WIDTH - 64}" height="${CANVAS_HEIGHT - 64}" rx="34" fill="none" stroke="#ffffff" stroke-width="8" opacity="0.96"/>

  <rect x="82" y="72" width="238" height="66" rx="33" fill="#e11d2e" filter="url(#shadow)"/>
  <text x="201" y="117" text-anchor="middle" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="36" font-weight="900" fill="#ffffff">${escapeXml(
    copy.badge
  )}</text>

  <rect x="88" y="198" width="14" height="${Math.max(96, productLines.length * productLineHeight + 14)}" rx="7" fill="#facc15"/>
  ${svgTextLines(productLines, 124, 246, productFontSize, productLineHeight, {
    fill: "#ffffff",
    weight: 900,
    stroke: "#000000",
    strokeWidth: 2,
  })}

  <rect x="88" y="430" width="16" height="190" rx="8" fill="#38bdf8"/>
  ${svgTextLines(headlineLines, 126, 510, 96, 104, {
    fill: "#fff1a8",
    weight: 950,
    stroke: "#000000",
    strokeWidth: 5,
  })}

  ${svgTextLines(sublineLines, 126, 686, 40, 44, {
    fill: "#ffffff",
    weight: 850,
    stroke: "#000000",
    strokeWidth: 2,
  })}

  <rect x="88" y="760" width="392" height="84" rx="42" fill="#facc15" filter="url(#shadow)"/>
  <text x="284" y="815" text-anchor="middle" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="44" font-weight="950" fill="#111827">${escapeXml(
    copy.cta
  )}</text>
</svg>`;
}

function buildHeroStageSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rightShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#07111f" stop-opacity="0"/>
      <stop offset="32%" stop-color="#07111f" stop-opacity="0.36"/>
      <stop offset="100%" stop-color="#030712" stop-opacity="0.56"/>
    </linearGradient>
    <radialGradient id="heroLight" cx="50%" cy="45%" r="56%">
      <stop offset="0%" stop-color="#f8fafc" stop-opacity="0.66"/>
      <stop offset="48%" stop-color="#cbd5e1" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="650" y="0" width="950" height="${CANVAS_HEIGHT}" fill="url(#rightShade)"/>
  <ellipse cx="1160" cy="444" rx="470" ry="356" fill="url(#heroLight)"/>
</svg>`;
}

async function resolveUsableBackgroundPath(imagePaths: string[]): Promise<string | null> {
  for (const imagePath of imagePaths) {
    if (!fs.existsSync(imagePath)) continue;
    try {
      const metadata = await sharp(imagePath).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width >= 500 && height >= 500) return imagePath;
    } catch {
      // Try the next downloaded image if this one cannot be decoded.
    }
  }

  return null;
}

async function scoreProductHeroImage(imagePath: string): Promise<HeroImageScore | null> {
  if (!fs.existsSync(imagePath)) return null;

  try {
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 500 || height < 500) return null;

    const sampleSize = 96;
    const { data, info } = await sharp(imagePath)
      .rotate()
      .resize(sampleSize, sampleSize, { fit: "cover", position: "centre" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const luminanceAt = (x: number, y: number): number => {
      const index = (y * info.width + x) * info.channels;
      return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    };

    const cornerValues: number[] = [];
    const cornerSize = 18;
    for (let y = 0; y < sampleSize; y += 1) {
      for (let x = 0; x < sampleSize; x += 1) {
        const isCorner =
          (x < cornerSize && y < cornerSize) ||
          (x >= sampleSize - cornerSize && y < cornerSize) ||
          (x < cornerSize && y >= sampleSize - cornerSize) ||
          (x >= sampleSize - cornerSize && y >= sampleSize - cornerSize);
        if (isCorner) cornerValues.push(luminanceAt(x, y));
      }
    }

    const centerValues: number[] = [];
    for (let y = 34; y < 62; y += 1) {
      for (let x = 34; x < 62; x += 1) centerValues.push(luminanceAt(x, y));
    }

    const average = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const cornerMean = average(cornerValues);
    const cornerVariance = average(cornerValues.map((value) => (value - cornerMean) ** 2));
    const cornerStddev = Math.sqrt(cornerVariance);
    const centerMean = average(centerValues);

    const aspectRatio = width / height;
    const squareScore = Math.max(0, 24 - Math.abs(1 - aspectRatio) * 42);
    const cleanCornerScore = Math.max(0, 28 - cornerStddev * 1.1);
    const brightBackgroundScore = cornerMean >= 232 ? 26 : cornerMean >= 200 ? 18 : cornerMean >= 165 ? 9 : 0;
    const contrastScore = Math.min(18, Math.abs(cornerMean - centerMean) / 4);
    const resolutionScore = Math.min(8, Math.max(width, height) / 220);

    return {
      imagePath,
      score: squareScore + cleanCornerScore + brightBackgroundScore + contrastScore + resolutionScore,
    };
  } catch {
    return null;
  }
}

async function resolveThumbnailImages(imagePaths: string[]): Promise<ResolvedThumbnailImages | null> {
  const backgroundPath = await resolveUsableBackgroundPath(imagePaths);
  if (!backgroundPath) return null;

  const scores = (
    await Promise.all(imagePaths.map((imagePath) => scoreProductHeroImage(imagePath)))
  ).filter((score): score is HeroImageScore => Boolean(score));

  const representativeScore = scores.find(
    (score) => path.resolve(score.imagePath) === path.resolve(backgroundPath)
  );

  return {
    backgroundPath,
    heroPath: representativeScore?.imagePath || backgroundPath,
  };
}

async function buildFadeMask(width: number, height: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#fff" stop-opacity="0.18"/>
          <stop offset="10%" stop-color="#fff" stop-opacity="0.92"/>
          <stop offset="100%" stop-color="#fff" stop-opacity="1"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#fade)"/>
    </svg>`
  );
  return sharp(mask).extractChannel("alpha").toBuffer();
}

async function buildCleanProductAlpha(heroImage: Buffer): Promise<Buffer | null> {
  if ((process.env.PRODUCT_THUMBNAIL_CLEAN_CUTOUT_ENABLED || "false").toLowerCase() !== "true") {
    return null;
  }

  const { data, info } = await sharp(heroImage)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const width = info.width;
  const height = info.height;
  const cornerSize = Math.max(18, Math.round(Math.min(width, height) * 0.08));

  const cornerPixels: Array<[number, number, number, number]> = [];
  const centerLuminance: number[] = [];

  const readPixel = (x: number, y: number): [number, number, number, number] => {
    const index = (y * width + x) * channels;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    return [red, green, blue, luminance];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isCorner =
        (x < cornerSize && y < cornerSize) ||
        (x >= width - cornerSize && y < cornerSize) ||
        (x < cornerSize && y >= height - cornerSize) ||
        (x >= width - cornerSize && y >= height - cornerSize);
      if (isCorner) cornerPixels.push(readPixel(x, y));
    }
  }

  const centerLeft = Math.round(width * 0.34);
  const centerRight = Math.round(width * 0.66);
  const centerTop = Math.round(height * 0.34);
  const centerBottom = Math.round(height * 0.66);
  for (let y = centerTop; y < centerBottom; y += 1) {
    for (let x = centerLeft; x < centerRight; x += 1) {
      centerLuminance.push(readPixel(x, y)[3]);
    }
  }

  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const cornerRed = average(cornerPixels.map((pixel) => pixel[0]));
  const cornerGreen = average(cornerPixels.map((pixel) => pixel[1]));
  const cornerBlue = average(cornerPixels.map((pixel) => pixel[2]));
  const cornerLuminance = average(cornerPixels.map((pixel) => pixel[3]));
  const cornerStddev = Math.sqrt(
    average(cornerPixels.map((pixel) => (pixel[3] - cornerLuminance) ** 2))
  );
  const centerMean = average(centerLuminance);

  const canRemoveBackground =
    cornerLuminance >= 218 && cornerStddev <= 28 && centerMean <= cornerLuminance - 18;

  if (!canRemoveBackground) return null;

  const alpha = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, luminance] = readPixel(x, y);
      const colorDistance = Math.sqrt(
        (red - cornerRed) ** 2 + (green - cornerGreen) ** 2 + (blue - cornerBlue) ** 2
      );
      const index = y * width + x;
      if (colorDistance < 36 && luminance >= 188) {
        alpha[index] = 0;
      } else if (colorDistance < 58 && luminance >= 204) {
        alpha[index] = 120;
      } else {
        alpha[index] = 255;
      }
    }
  }

  return sharp(alpha, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .blur(0.7)
    .raw()
    .toBuffer();
}

async function buildHeroLayer(heroImage: Buffer, width: number, height: number): Promise<Buffer> {
  const cleanProductAlpha = await buildCleanProductAlpha(heroImage);
  const alpha = cleanProductAlpha || (await buildFadeMask(width, height));
  const { data, info } = await sharp(heroImage)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const rgbIndex = index * info.channels;
    const rgbaIndex = index * 4;
    rgba[rgbaIndex] = data[rgbIndex];
    rgba[rgbaIndex + 1] = data[rgbIndex + 1];
    rgba[rgbaIndex + 2] = data[rgbIndex + 2];
    rgba[rgbaIndex + 3] = alpha[index] ?? 255;
  }

  return sharp(rgba, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

export async function generateProductThumbnail(
  options: GenerateProductThumbnailOptions
): Promise<ProductThumbnailResult | null> {
  if (options.enabled === false) return null;
  if (options.imagePaths.length === 0) return null;

  const preferredImagePath = options.preferredImagePath && fs.existsSync(options.preferredImagePath)
    ? options.preferredImagePath
    : null;
  const resolvedImages = preferredImagePath
    ? { backgroundPath: preferredImagePath, heroPath: preferredImagePath }
    : await resolveThumbnailImages(options.imagePaths);
  if (!resolvedImages) return null;

  const suggestedCopy = buildProductThumbnailCopy(options.postTitle, options.productName, options.contentKind);
  const copy: ProductThumbnailCopy = {
    productNameLabel: sanitizeText(options.copy?.productNameLabel || suggestedCopy.productNameLabel),
    headline: sanitizeText(options.copy?.headline || suggestedCopy.headline),
    subline: sanitizeText(options.copy?.subline || suggestedCopy.subline),
    badge: sanitizeText(options.copy?.badge || suggestedCopy.badge),
    cta: sanitizeText(options.copy?.cta || suggestedCopy.cta),
  };
  const timestamp = Date.now();
  const outputPath = path.join(
    options.outputDir,
    `thumb_${timestamp}_${sanitizeFileNamePart(copy.productNameLabel)}.jpg`
  );

  const isTravel = options.contentKind === "TRAVEL";
  const fullBackground = await sharp(resolvedImages.backgroundPath)
    .rotate()
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover", position: "centre" })
    .blur(isTravel ? 8 : 22)
    .modulate(isTravel ? { brightness: 0.72, saturation: 1.06 } : { brightness: 0.64, saturation: 0.78 })
    .jpeg({ quality: 92 })
    .toBuffer();

  const heroWidth = 868;
  const heroHeight = CANVAS_HEIGHT - 64;
  const heroImage = await sharp(resolvedImages.heroPath)
    .rotate()
    .resize(heroWidth, heroHeight, { fit: "cover", position: "south" })
    .modulate({ brightness: 1.03, saturation: 1.08 })
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();

  const heroWithAlpha = isTravel
    ? await sharp(heroImage)
        .composite([{ input: Buffer.from(`<svg width="${heroWidth}" height="${heroHeight}" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="${heroWidth - 16}" height="${heroHeight - 16}" rx="42" fill="none" stroke="white" stroke-width="16"/></svg>`) }])
        .png()
        .toBuffer()
    : await buildHeroLayer(heroImage, heroWidth, heroHeight);
  const heroLeft = CANVAS_WIDTH - 32 - heroWidth;
  const heroTop = 32;

  await fs.promises.mkdir(options.outputDir, { recursive: true });
  const layers: OverlayOptions[] = [
      { input: Buffer.from(buildHeroStageSvg()), top: 0, left: 0 },
      { input: heroWithAlpha, top: heroTop, left: heroLeft },
  ];
  if (isTravel) layers.push({ input: await buildTravelAccentPng(), top: 0, left: 0 });
  layers.push({ input: Buffer.from(buildOverlaySvg(copy)), top: 0, left: 0 });
  await sharp(fullBackground)
    .composite(layers)
    .jpeg({ quality: 95, mozjpeg: true })
    .toFile(outputPath);

  return {
    outputPath,
    backgroundPath: resolvedImages.backgroundPath,
    ...copy,
  };
}

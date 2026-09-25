import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { productSignalCoveredBySentence } from "./product-editorial-plan";
import { preserveProductPhotoSource } from "./product-photo-provenance";
import { SHOPPING_FACT_CARD_FILE_PREFIX } from "./shopping-fact-card-rule";

/**
 * 누끼를 딸 수 없는 상품을 위한 정보 카드.
 * 판매자 원본 사진 전체를 흰 액자에 넣고, 판매처 상세에서 확인한 사실 몇 줄을 옆에 적는다.
 * 사진은 자르거나 색을 바꾸지 않고, 생성 배경 위에 합성하지도 않는다(연출 장면처럼 보이지 않게).
 */

const FONT = "Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif";
const PALETTES = [
  { background: "#f3f6fb", accent: "#2f6fed", ink: "#14233c", muted: "#5b6b82" },
  { background: "#f6f3ec", accent: "#c26a1b", ink: "#2b2118", muted: "#6f6252" },
  { background: "#eef6f1", accent: "#1f8a5b", ink: "#13301f", muted: "#546b5d" },
];
export const SHOPPING_FACT_CARD_LIMIT = 3;
// Text column is ~460px wide beside the 560px frame: Korean glyphs are about one em wide.
const TITLE_CHARS = 9;
const FACT_CHARS = 14;
export const SHOPPING_FACT_CARD_FOOTER = "판매처 상세 정보 기준 요약";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** 띄어쓰기 기준으로 줄을 나누고, 너무 긴 낱말은 글자 단위로 자른다. 줄 수를 넘으면 버린다(말줄임 없음). */
export function wrapCardText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean)
    .flatMap((word) => word.length <= maxChars ? [word] : word.match(new RegExp(`.{1,${maxChars}}`, "gu")) || []);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length <= maxLines ? lines : [];
}

/**
 * 카드에 넣을 사실 줄을 고른다. 섹션 본문이 언급한 사실을 먼저, 이미 다른 카드에 쓴 사실은 뒤로 둔다.
 * 긴 줄(카드 두 줄 초과)은 잘라 쓰지 않고 건너뛴다.
 */
export function selectShoppingFactCardFacts(options: {
  facts: string[]; sectionText: string; used?: Set<string>; limit?: number;
}): string[] {
  const limit = options.limit ?? 4;
  const used = options.used ?? new Set<string>();
  const candidates = [...new Set(options.facts.map((fact) => fact.replace(/\s+/gu, " ").trim()))]
    .filter((fact) => fact.length >= 4 && wrapCardText(fact, FACT_CHARS, 2).length > 0);
  const score = (fact: string) =>
    (productSignalCoveredBySentence(fact, options.sectionText) ? 2 : 0) + (used.has(fact) ? -3 : 0);
  return candidates
    .map((fact, index) => ({ fact, index, score: score(fact) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.fact);
}

export async function createShoppingFactCard(options: {
  sourcePath: string;
  title: string;
  facts: string[];
  variant: number;
  outputDir: string;
}): Promise<{ outputPath: string; sourceSha256: string }> {
  const facts = options.facts.slice(0, 4);
  if (facts.length < 2) throw new Error("SHOPPING_FACT_CARD_FACTS_REQUIRED: 정보 카드에는 확인된 사실이 2개 이상 필요합니다.");
  const palette = PALETTES[Math.abs(options.variant) % PALETTES.length];
  const photoLeft = options.variant % 2 === 0;
  const width = 1200;
  const height = 900;
  const frame = { width: 560, height: 700, padding: 22 };
  const photo = await sharp(fs.readFileSync(options.sourcePath)).rotate()
    .resize(frame.width - frame.padding * 2, frame.height - frame.padding * 2, { fit: "inside", withoutEnlargement: false })
    .png().toBuffer();
  const photoMeta = await sharp(photo).metadata();
  const framed = await sharp({ create: {
    width: photoMeta.width! + frame.padding * 2, height: photoMeta.height! + frame.padding * 2, channels: 4, background: "#ffffff",
  } }).composite([{ input: photo, left: frame.padding, top: frame.padding }]).png().toBuffer();
  const framedMeta = await sharp(framed).metadata();
  const frameX = photoLeft ? 60 + Math.floor((frame.width - framedMeta.width!) / 2) : width - 60 - frame.width + Math.floor((frame.width - framedMeta.width!) / 2);
  const frameY = Math.floor((height - framedMeta.height!) / 2) - 10;
  const textX = photoLeft ? 670 : 70;
  const wrappedTitle = wrapCardText(options.title, TITLE_CHARS, 3);
  const titleLines = wrappedTitle.length ? wrappedTitle : [options.title.slice(0, TITLE_CHARS)];
  let y = 170 + (titleLines.length - 1) * 56;
  const factBlocks = facts.map((fact) => {
    const lines = wrapCardText(fact, FACT_CHARS, 2);
    const top = y + 70;
    y = top + (lines.length - 1) * 40 + 20;
    return `<circle cx="${textX + 10}" cy="${top - 11}" r="7" fill="${palette.accent}"/>` +
      `<text x="${textX + 34}" y="${top}" font-family="${FONT}" font-size="30" font-weight="700" fill="${palette.ink}">${
        lines.map((line, index) => `<tspan x="${textX + 34}" dy="${index === 0 ? 0 : 40}">${escapeXml(line)}</tspan>`).join("")}</text>`;
  }).join("");
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="${palette.background}"/>
    <rect x="${textX}" y="92" width="64" height="8" rx="4" fill="${palette.accent}"/>
    <text x="${textX}" y="170" font-family="${FONT}" font-size="46" font-weight="900" fill="${palette.ink}">${
      titleLines.map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : 56}">${escapeXml(line)}</tspan>`).join("")}</text>
    ${factBlocks}
    <text x="${textX}" y="${height - 70}" font-family="${FONT}" font-size="22" font-weight="600" fill="${palette.muted}">${SHOPPING_FACT_CARD_FOOTER}</text>
  </svg>`;
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `${SHOPPING_FACT_CARD_FILE_PREFIX}${crypto.randomUUID()}.png`);
  const bytes = await sharp(Buffer.from(svg)).composite([{ input: framed, left: frameX, top: frameY }]).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(outputPath, bytes);
  preserveProductPhotoSource({ sourcePath: options.sourcePath, outputPath, segmented: false });
  return { outputPath, sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(options.sourcePath)).digest("hex") };
}

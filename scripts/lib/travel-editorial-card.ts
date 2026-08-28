import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractTravelProductFacts } from "./travel-content";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitLines(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function tspans(lines: string[], x: number, lineHeight: number): string {
  return lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
}

export interface TravelEditorialCardOptions {
  productName: string;
  description?: string;
  features?: string[];
  price?: string;
  outputDir: string;
}

export async function generateTravelEditorialSummaryCard(
  options: TravelEditorialCardOptions,
): Promise<string> {
  const facts = extractTravelProductFacts(
    options.productName,
    options.description || "",
    options.features || [],
  );
  const destination = facts.destinations.slice(0, 2).join(" · ") || "여행 코스";
  const highlights = facts.highlights.slice(0, 6).join(" · ") || "상세 일정표에서 확인";
  const conditions = facts.conditions.slice(0, 4).join(" · ") || "출발일별 확인";
  const price = options.price?.replace(/\s+/g, " ").trim() || "출발일별 확인";
  const destinationLines = splitLines(`${destination} ${facts.duration || "여행"}`, 21, 2);
  const highlightLines = splitLines(highlights, 27, 3);
  const conditionLines = splitLines(conditions, 27, 2);
  const priceLines = splitLines(price, 27, 2);

  const svg = `<svg width="1200" height="1200" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#eef7ff"/>
        <stop offset="1" stop-color="#fff8ec"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#0f2d4a" flood-opacity="0.13"/>
      </filter>
    </defs>
    <rect width="1200" height="1200" fill="url(#bg)"/>
    <circle cx="1050" cy="120" r="210" fill="#d9edff" opacity="0.75"/>
    <path d="M80 960 C260 850 370 1020 560 900 S880 760 1110 850" fill="none" stroke="#2d7ff9" stroke-width="8" stroke-linecap="round" stroke-dasharray="14 24" opacity="0.55"/>
    <path d="M1078 823 l39 14 -39 14 10-14z" fill="#2d7ff9" opacity="0.8"/>

    <text x="86" y="105" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="6" fill="#2d7ff9">TRAVEL PLAN</text>
    <text x="86" y="190" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="64" font-weight="900" fill="#102a43">${tspans(destinationLines, 86, 72)}</text>
    <text x="88" y="335" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="28" font-weight="600" fill="#52657a">상품명과 수집된 상세정보에서 확인한 일정 요약</text>

    <g filter="url(#shadow)">
      <rect x="70" y="390" width="1060" height="650" rx="42" fill="#ffffff"/>
    </g>
    <line x1="110" y1="585" x2="1090" y2="585" stroke="#e4edf5" stroke-width="2"/>
    <line x1="110" y1="790" x2="1090" y2="790" stroke="#e4edf5" stroke-width="2"/>

    <circle cx="145" cy="475" r="28" fill="#dff0ff"/><text x="145" y="486" text-anchor="middle" font-size="28">✈</text>
    <text x="205" y="457" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="27" font-weight="800" fill="#718096">핵심 코스</text>
    <text x="205" y="510" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="40" font-weight="800" fill="#152b46">${tspans(highlightLines, 205, 48)}</text>

    <circle cx="145" cy="675" r="28" fill="#fff0d8"/><text x="145" y="687" text-anchor="middle" font-size="28">✓</text>
    <text x="205" y="652" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="27" font-weight="800" fill="#718096">예약 조건</text>
    <text x="205" y="706" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="40" font-weight="800" fill="#152b46">${tspans(conditionLines, 205, 48)}</text>

    <circle cx="145" cy="875" r="28" fill="#e8e4ff"/><text x="145" y="887" text-anchor="middle" font-size="28">₩</text>
    <text x="205" y="852" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="27" font-weight="800" fill="#718096">표시 가격</text>
    <text x="205" y="906" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="40" font-weight="800" fill="#152b46">${tspans(priceLines, 205, 48)}</text>

    <text x="600" y="1118" text-anchor="middle" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="25" font-weight="600" fill="#5f7185">출발일별 일정 · 포함사항 · 최종 가격은 예약 페이지에서 다시 확인하세요</text>
  </svg>`;

  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputPath = path.join(options.outputDir, `travel-plan-${Date.now()}.png`);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outputPath);
  return outputPath;
}

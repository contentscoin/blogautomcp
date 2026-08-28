import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export type TravelThumbnailStyle = "travel-editorial" | "travel-postcard" | "travel-route";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function palette(style: TravelThumbnailStyle) {
  if (style === "travel-postcard") return { accent: "#ef4444", label: "POSTCARD JOURNEY", panel: "#fff7ed", text: "#431407", sub: "#9a3412" };
  if (style === "travel-route") return { accent: "#0ea5e9", label: "ROUTE NOTE", panel: "#082f49", text: "#f0f9ff", sub: "#bae6fd" };
  return { accent: "#f59e0b", label: "TRAVEL EDITORIAL", panel: "#0f172a", text: "#ffffff", sub: "#cbd5e1" };
}

function editorialOverlay(options: { destination: string; headline: string; subline: string; badge: string }): Buffer {
  return Buffer.from(`<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="photoShade" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#07111f" stop-opacity=".88"/><stop offset=".42" stop-color="#07111f" stop-opacity=".58"/><stop offset=".72" stop-color="#07111f" stop-opacity=".08"/><stop offset="1" stop-color="#07111f" stop-opacity="0"/></linearGradient><filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity=".22"/></filter></defs><rect width="1600" height="900" fill="url(#photoShade)"/><rect x="78" y="76" width="238" height="54" rx="27" fill="#ffffff" fill-opacity=".16" stroke="#ffffff" stroke-opacity=".56" stroke-width="2"/><text x="197" y="112" text-anchor="middle" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="27" font-weight="800" fill="#ffffff">${escapeXml(options.badge.slice(0, 12))}</text><text x="82" y="238" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="42" font-weight="700" fill="#dcecff">${escapeXml(options.destination.slice(0, 22))}</text><text x="82" y="356" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="78" font-weight="900" fill="#ffffff" filter="url(#softShadow)">${escapeXml(options.headline.slice(0, 18))}</text><text x="82" y="430" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="36" font-weight="700" fill="#e2e8f0">${escapeXml(options.subline.slice(0, 24))}</text><rect x="82" y="724" width="390" height="2" fill="#ffffff" fill-opacity=".65"/><text x="82" y="780" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="28" font-weight="600" fill="#ffffff" fill-opacity=".88">실제 여행상품 기준 · 핵심 일정 한눈에</text></svg>`);
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
  const colors = palette(style);
  const photo = await sharp(options.sourcePath).resize(1600, 900, { fit: "cover", position: "attention" }).png().toBuffer();
  if (style === "travel-editorial") {
    const outputPath = path.join(options.outputDir, `travel-thumbnail-${Date.now()}.png`);
    await sharp(photo).composite([{ input: editorialOverlay(options) }]).png({ compressionLevel: 9 }).toFile(outputPath);
    return { outputPath };
  }
  const routeDecoration = style === "travel-route" ? `<path d="M940 710 C1080 560 1260 650 1490 420" fill="none" stroke="#7dd3fc" stroke-width="8" stroke-dasharray="16 18"/><circle cx="940" cy="710" r="12" fill="#f59e0b"/><circle cx="1490" cy="420" r="12" fill="#f59e0b"/>` : "";
  const svg = Buffer.from(`<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${colors.panel}" stop-opacity=".98"/><stop offset=".46" stop-color="${colors.panel}" stop-opacity=".88"/><stop offset=".72" stop-color="${colors.panel}" stop-opacity=".12"/><stop offset="1" stop-color="${colors.panel}" stop-opacity="0"/></linearGradient></defs><rect width="1600" height="900" fill="url(#shade)"/><rect x="70" y="65" width="390" height="62" rx="31" fill="${colors.accent}"/><text x="265" y="106" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="900" fill="#fff" letter-spacing="4">${colors.label}</text><text x="82" y="230" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="42" font-weight="800" fill="${colors.sub}">${escapeXml(options.destination.slice(0, 28))}</text><text x="82" y="365" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="86" font-weight="900" fill="${colors.text}">${escapeXml(options.headline.slice(0, 18))}</text><text x="82" y="455" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="40" font-weight="700" fill="${colors.sub}">${escapeXml(options.subline.slice(0, 30))}</text><rect x="82" y="705" width="340" height="78" rx="39" fill="#fff" fill-opacity=".94"/><text x="252" y="757" text-anchor="middle" font-family="Malgun Gothic,Noto Sans CJK KR,sans-serif" font-size="34" font-weight="900" fill="#0f172a">${escapeXml(options.badge.slice(0, 14))}</text>${routeDecoration}<rect x="28" y="28" width="1544" height="844" rx="34" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="4"/></svg>`);
  const outputPath = path.join(options.outputDir, `travel-thumbnail-${Date.now()}.png`);
  await sharp(photo).composite([{ input: svg }]).png({ compressionLevel: 9 }).toFile(outputPath);
  return { outputPath };
}

/**
 * gpt-image 썸네일 프롬프트 — 문구까지 생성 단계에서 한 번에 그린다 (ProductThumbnail.md §7~§9).
 * 네이버 1:1 노출에 맞춘 정사각 레이아웃: 상단 큰 한글 제목, 하단 실사 제품/여행 장면, 10% 세이프존.
 */

import { inferCategoryName, inferScenePrompt } from "../product-thumbnail";
import type { TravelProductFacts } from "../travel-content";

export type ThumbnailKind = "SHOPPING" | "TRAVEL";

export interface ThumbnailCopy {
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

export interface ThumbnailMood {
  id: string;
  label: string;
  description: string;
  scene: string;
}

export const SHOPPING_MOODS: ThumbnailMood[] = [
  { id: "auto", label: "카테고리 자동", description: "상품 종류에 맞는 실사 장면", scene: "" },
  { id: "studio-clean", label: "클린 스튜디오", description: "밝은 배경, 제품만 또렷하게", scene: "Photorealistic bright studio tabletop, soft daylight from a large window, neutral light-gray backdrop, product large and centered, subtle real shadow, no props competing with the product." },
  { id: "lifestyle-home", label: "생활 공간", description: "집에서 실제 쓰는 장면", scene: "Photorealistic cozy Korean apartment living room or kitchen scene, product placed where it is actually used, warm natural light, a couple of everyday props for scale, realistic shadows and textures." },
  { id: "premium-dark", label: "프리미엄 다크", description: "어두운 배경, 고급스러운 조명", scene: "Photorealistic dark charcoal backdrop with a single soft key light, product rendered as a premium hero object with realistic reflections, minimal props, cinematic but still a real photograph." },
  { id: "outdoor-natural", label: "야외 자연광", description: "밝은 야외, 자연스러운 그림자", scene: "Photorealistic outdoor scene in soft natural daylight (park, terrace or campsite depending on the product), product large and sharp, believable environment, real sunlight direction and contact shadows." },
];

export const TRAVEL_MOODS: ThumbnailMood[] = [
  { id: "golden-hour", label: "골든아워", description: "노을빛 여행지 풍경", scene: "Photorealistic wide landscape or landmark of the destination at golden hour, warm low sunlight, travel-magazine cover feeling, no people in focus, real photograph look." },
  { id: "bright-day", label: "맑은 낮", description: "선명한 하늘, 밝고 상쾌하게", scene: "Photorealistic destination landmark or street on a clear bright day, vivid but natural colors, crisp detail, real travel photo taken with a good camera." },
  { id: "blue-hour", label: "블루아워 야경", description: "저녁 도시 불빛", scene: "Photorealistic destination cityscape or landmark at blue hour with lights on, deep blue sky, warm street lights, still a real photograph, no neon exaggeration." },
  { id: "cozy-local", label: "로컬 골목", description: "현지 거리와 먹거리 분위기", scene: "Photorealistic local street or market scene of the destination, lanterns or shop signs of the region, warm inviting atmosphere, believable details, real travel photo." },
];

export function listThumbnailMoods(kind: ThumbnailKind): ThumbnailMood[] {
  return kind === "TRAVEL" ? TRAVEL_MOODS : SHOPPING_MOODS;
}

function clean(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function textLines(copy: ThumbnailCopy, includeBadge: boolean): string[] {
  const lines = [
    `- Main headline (largest text, top area): "${copy.headline}"`,
    copy.subline ? `- Subline (smaller, under the headline): "${copy.subline}"` : "",
    `- Product name label (small, one line): "${copy.productNameLabel}"`,
    includeBadge && copy.badge ? `- Badge (small rounded pill, top-left): "${copy.badge}"` : "",
  ];
  return lines.filter(Boolean);
}

const COMMON_LAYOUT = [
  "Canvas and layout:",
  "- 1:1 square Korean Naver blog thumbnail. It will be shown as a small square in search results, so the design must read at 20% size.",
  "- Keep every text and the subject inside a safe zone 10% away from all edges. Nothing important near the borders.",
  "- Top ~40%: the Korean headline, very large, bold, high contrast against its background. Bottom ~60%: the photorealistic scene.",
  "- Use at most 3 text elements. Fewer, larger words beat many small words.",
  "- Text must never cover the product/landmark body. Add a soft gradient or a clean panel behind the text if needed for contrast.",
  "",
  "Korean text rules:",
  "- Render each Korean string exactly as given, character for character. Do not add, translate, abbreviate, or invent any other text.",
  "- Clean modern Korean sans-serif lettering, perfectly legible, no broken or fake Hangul, no cropped glyphs.",
];

const HARD_NEGATIVES = [
  "Hard negatives:",
  "- No misspelled Korean, malformed Hangul, fake letters, extra captions, or cropped text.",
  "- No affiliate commission text, commission rate, seller backend data, watermark, fake logos, or unverified No.1/lowest-price claim.",
  "- No flat vector illustration, icons, cartoon, or abstract placeholder background.",
  "- No phone, laptop, or shopping-screen mockup unless the product itself is a screen device.",
];

export interface ShoppingPromptInput {
  productName: string;
  categoryName?: string;
  description?: string;
  features?: string[];
  price?: string;
  copy: ThumbnailCopy;
  moodId?: string;
}

export function buildShoppingThumbnailPrompt(input: ShoppingPromptInput): string {
  const categoryName = inferCategoryName(clean(input.categoryName), input.productName);
  const mood = SHOPPING_MOODS.find((item) => item.id === input.moodId && item.scene) || null;
  const scene = mood?.scene || inferScenePrompt(categoryName, input.productName);
  const features = (input.features || []).map(clean).filter(Boolean).slice(0, 4);
  return [
    "Generate ONE finished premium Korean Naver blog product thumbnail in a single generation.",
    "Everything is created inside the image: photorealistic product scene, the exact Korean headline, the exact product name label, and layout. No separate compositing will happen afterward.",
    "Use the attached product photo as the strict visual reference for shape, color, material, and package impression. Keep the product recognizable and faithful; do not invent a different model, color, logo, or package.",
    "",
    "Product:",
    `- Product name: ${clean(input.productName)}`,
    `- Category: ${categoryName}`,
    input.description ? `- Description: ${clean(input.description).slice(0, 220)}` : "",
    features.length ? `- Key features: ${features.join(", ")}` : "",
    "",
    ...COMMON_LAYOUT,
    "",
    "Visible text, exactly these Korean strings and nothing else:",
    ...textLines(input.copy, true),
    "",
    "Photorealistic product scene:",
    `- ${scene}`,
    "- Product is the large, sharp hero object occupying most of the lower area.",
    "- The scene looks like a real photo taken for a blog with a good camera: natural light, one consistent shadow direction, contact shadow under the product, subtle grain, no CG-perfect gloss.",
    "",
    ...HARD_NEGATIVES,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface TravelPromptInput {
  productName: string;
  facts: TravelProductFacts | null;
  copy: ThumbnailCopy;
  moodId?: string;
  hasReferenceImage: boolean;
}

export function buildTravelThumbnailPrompt(input: TravelPromptInput): string {
  const destination = input.facts?.destinations.slice(0, 2).join(", ") || clean(input.productName);
  const highlights = input.facts?.highlights.slice(0, 4).join(", ") || "";
  const mood = TRAVEL_MOODS.find((item) => item.id === input.moodId) || TRAVEL_MOODS[0];
  return [
    "Generate ONE finished premium Korean Naver blog travel thumbnail in a single generation.",
    "Everything is created inside the image: a photorealistic destination scene, the exact Korean headline, and a small duration/condition label. No separate compositing will happen afterward.",
    input.hasReferenceImage
      ? "Use the attached travel photo as the visual reference for the place, season, and atmosphere. Keep the landmark and scenery recognizable; do not swap in a different city."
      : "Depict a well-known, recognizable real scene of the destination. Do not invent fictional landmarks.",
    "",
    "Trip:",
    `- Destination: ${destination}`,
    input.facts?.duration ? `- Duration: ${input.facts.duration}` : "",
    highlights ? `- Highlights: ${highlights}` : "",
    input.facts?.conditions.length ? `- Confirmed conditions: ${input.facts.conditions.join(", ")}` : "",
    "",
    ...COMMON_LAYOUT,
    "",
    "Visible text, exactly these Korean strings and nothing else:",
    ...textLines(input.copy, true),
    "",
    "Photorealistic travel scene:",
    `- ${mood.scene}`,
    "- Travel magazine cover feeling with a real photograph, natural colors, no HDR halos, no oversaturation.",
    "",
    ...HARD_NEGATIVES,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 상품 유형 템플릿 레지스트리.
 *
 * - selectTopicTemplate: 상품명·설명·특징(·OCR)으로 결정론적으로 유형을 고른다.
 * - applyTopicTemplateToSections: 렌더 계약 섹션(ID 유지)에 유형별 오버레이를 적용한다.
 * - formatTopicTemplateForPrompt: 원고 작성 프롬프트에 넣을 템플릿 블록.
 */

import { SHOPPING_SECTION_ORDER, SHOPPING_TOPIC_TEMPLATES } from "./shopping";
import { TRAVEL_SECTION_ORDER, TRAVEL_TOPIC_TEMPLATES } from "./travel";
import type {
  ShoppingTopicTemplateId,
  TopicConnectKind,
  TopicImageSource,
  TopicSectionOverlay,
  TopicTemplate,
  TopicTemplateId,
  TopicTemplateSelection,
  TravelTopicTemplateId,
} from "./types";

export * from "./types";
export { SHOPPING_SECTION_ORDER, SHOPPING_TOPIC_TEMPLATES, TRAVEL_SECTION_ORDER, TRAVEL_TOPIC_TEMPLATES };

export const TOPIC_TEMPLATES: Record<TopicTemplateId, TopicTemplate> = {
  ...SHOPPING_TOPIC_TEMPLATES,
  ...TRAVEL_TOPIC_TEMPLATES,
};

export function isTopicTemplateId(value: unknown): value is TopicTemplateId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOPIC_TEMPLATES, value);
}

export function getTopicTemplate(id: TopicTemplateId): TopicTemplate {
  return TOPIC_TEMPLATES[id];
}

export function defaultTopicTemplateId(kind: TopicConnectKind): TopicTemplateId {
  return kind === "TRAVEL" ? "generic_travel" : "generic_shopping";
}

/** 요청 ID가 해당 커넥트 종류의 템플릿일 때만 인정한다. */
export function resolveTopicTemplateId(kind: TopicConnectKind, requested?: string | null): TopicTemplateId | null {
  return isTopicTemplateId(requested) && TOPIC_TEMPLATES[requested].kind === kind ? requested : null;
}

export interface TopicTemplateInput {
  name?: string | null;
  description?: string | null;
  features?: readonly string[] | null;
  /** 상세페이지 OCR·비전 판독 줄 */
  ocrLines?: readonly string[] | null;
  /** 스토어 카테고리 경로가 있으면 가장 강한 신호로 쓴다 */
  categoryPath?: string | null;
}

/** 같은 점수일 때 더 구체적인 유형을 먼저 고른다(예: 골프 거리측정기 → 스포츠). */
const SHOPPING_PRIORITY: ShoppingTopicTemplateId[] = [
  "baby_pet",
  "food_supplement",
  "beauty_body",
  "fashion_goods",
  "sports_leisure",
  "home_appliance",
  "digital_it",
  "living_health",
];

function uniqueHits(text: string, keywords: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => keyword && lower.includes(keyword.toLowerCase()));
}

function selectShopping(input: TopicTemplateInput): TopicTemplateSelection {
  const name = input.name || "";
  const category = input.categoryPath || "";
  const detail = [input.description || "", ...(input.features || []), ...(input.ocrLines || [])].join("\n");
  let best: { id: ShoppingTopicTemplateId; score: number; hits: string[] } | null = null;
  for (const id of SHOPPING_PRIORITY) {
    const keywords = SHOPPING_TOPIC_TEMPLATES[id].keywords;
    const categoryHits = uniqueHits(category, keywords);
    const nameHits = uniqueHits(name, keywords);
    const detailHits = uniqueHits(detail, keywords).filter((hit) => !nameHits.includes(hit));
    const score = categoryHits.length * 5 + nameHits.length * 3 + Math.min(3, detailHits.length);
    if (score > 0 && (!best || score > best.score)) {
      best = { id, score, hits: [...categoryHits, ...nameHits, ...detailHits].slice(0, 4) };
    }
  }
  if (!best) return { id: "generic_shopping", reason: "상품 유형 신호 없음: 쇼핑 기본형" };
  return { id: best.id, reason: `상품 유형 신호: ${best.hits.join(", ")}` };
}

const AIRTEL_PATTERN = /에어텔|자유\s*여행|항공\s*\+\s*호텔|자유\s*일정/u;
const ITINERARY_PATTERN = /\d+\s*일차|패키지|\d+\s*박\s*\d+\s*일/u;
const HOTEL_PATTERN = /호텔|리조트|료칸|숙박권|풀빌라|스테이\b/u;
const TICKET_PATTERN = /입장권|티켓|패스\b|액티비티|체험권|케이블카|테마파크|유니버설|디즈니|공연|스노클링|다이빙|투어\s*상품/u;

function selectTravel(input: TopicTemplateInput): TopicTemplateSelection {
  const name = input.name || "";
  const all = [input.categoryPath || "", name, input.description || "", ...(input.features || []), ...(input.ocrLines || [])].join("\n");
  const signal = (pattern: RegExp, text = all) => text.match(pattern)?.[0];
  let hit: string | undefined;
  let id: TravelTopicTemplateId;
  if ((hit = signal(AIRTEL_PATTERN))) id = "airtel_freetour";
  else if ((hit = signal(ITINERARY_PATTERN))) id = "package_tour";
  else if ((hit = signal(HOTEL_PATTERN, name))) id = "hotel_resort";
  else if ((hit = signal(TICKET_PATTERN, name))) id = "activity_ticket";
  else if ((hit = signal(/\d+\s*일/u))) id = "package_tour";
  else return { id: "generic_travel", reason: "여행 유형 신호 없음: 여행 기본형" };
  return { id, reason: `여행 유형 신호: ${hit}` };
}

/** 근거에 없는 유형을 추측하지 않는다. 신호가 없으면 각 커넥트의 기본형을 쓴다. */
export function selectTopicTemplate(kind: TopicConnectKind, input: TopicTemplateInput = {}): TopicTemplateSelection {
  return kind === "TRAVEL" ? selectTravel(input) : selectShopping(input);
}

export interface TopicContractSectionLike {
  id: string;
  title: string;
  purpose: string;
  evidenceRule: string;
  image: { intent: string };
}

export function topicSectionOverlay(id: TopicTemplateId, sectionId: string): TopicSectionOverlay | null {
  return TOPIC_TEMPLATES[id].sections.find(([key]) => key === sectionId)?.[1] ?? null;
}

const IMAGE_SOURCE_LABELS: Record<TopicImageSource, string> = {
  "seller-original": "상품 페이지 원본 사진",
  "seller-crop": "상세페이지 근거 구간(원본 크롭)",
  "staged-ai": "상품 이미지 기반 연출컷",
  "editorial-card": "요약 카드",
  none: "이미지 없음",
};

export function topicImageSourceLabel(source: TopicImageSource): string {
  return IMAGE_SOURCE_LABELS[source];
}

/**
 * 계약 섹션에 유형별 오버레이를 적용한다. 섹션 ID·순서·글자수·이미지 개수는 그대로 두고
 * 제목·목적·근거 규칙·이미지 의도만 바꾼다. 이미지 출처와 연출 지시는 별도 필드로 붙인다
 * (image.intent는 발행 대체텍스트가 되므로 내부 지시를 넣지 않는다).
 */
export function applyTopicTemplateToSections<T extends TopicContractSectionLike>(
  sections: readonly T[],
  id: TopicTemplateId,
): Array<T & { imageSource?: TopicImageSource; promptRecipe?: string }> {
  return sections.map((section) => {
    const overlay = topicSectionOverlay(id, section.id);
    if (!overlay) return section;
    return {
      ...section,
      title: overlay.headingHint,
      purpose: overlay.purpose,
      evidenceRule: overlay.evidenceRule || section.evidenceRule,
      // intent는 발행 이미지의 대체텍스트로도 쓰이므로 독자용 문구만 둔다.
      // 출처·연출 지시는 별도 필드로 붙여 프롬프트와 이미지 생성에서만 쓴다.
      image: { ...section.image, intent: overlay.imageIntent },
      imageSource: overlay.imageSource,
      ...(overlay.promptRecipe ? { promptRecipe: overlay.promptRecipe } : {}),
    };
  });
}

const FORMAT_HINTS: Record<NonNullable<TopicSectionOverlay["format"]>, string> = {
  prose: "짧은 모바일 문단",
  "facts-list": "\"• 항목: 값\" 세로 목록(확인된 값만)",
  checklist: "\"▸ \" 체크리스트 3~5줄",
  qa: "본문 뒤 \"Q. / A.\" 최대 3쌍(근거 있을 때만)",
  tips: "본문 끝에 \"💡 현지 꿀팁: …\" 한 줄",
};

export interface TopicPromptOptions {
  experienceMode?: "AI_ASSISTED_INFORMATION" | "VERIFIED_EXPERIENCE";
  /** 섹션 구성이 이미 고정된 경로(spec-first)는 계약 섹션 흐름을 빼고 유형 정보만 넣는다. */
  includeFlow?: boolean;
  /** 글자 예산이 빡빡한 브라우저 직접 프롬프트용 1~2줄 요약 */
  minimal?: boolean;
}

export function formatTopicTemplateForPrompt(
  selection: TopicTemplateSelection,
  options: TopicPromptOptions = {},
): string {
  const template = TOPIC_TEMPLATES[selection.id];
  if (options.minimal) {
    return [
      `- 상품 유형: ${template.label}. 독자 관심: ${template.readerIntent}`,
      template.kind === "TRAVEL" ? "- 코스마다 근거 있는 '💡 현지 꿀팁' 한 줄을 붙입니다." : "",
    ].filter(Boolean).join("\n");
  }
  const verified = options.experienceMode === "VERIFIED_EXPERIENCE";
  const includeFlow = options.includeFlow !== false;
  const flow = template.sections.map(([sectionId, overlay], index) => {
    const format = overlay.format ? ` | 형식=${FORMAT_HINTS[overlay.format]}` : "";
    const experience = overlay.experienceSlot && verified ? " | 체험 메모의 1인칭 문장 자리" : "";
    return `  ${index + 1}. ${sectionId} | 소제목 방향="${overlay.headingHint}" | ${overlay.purpose} | 이미지=${IMAGE_SOURCE_LABELS[overlay.imageSource]}: ${overlay.imageIntent}${format}${experience}`;
  });
  const lines = [
    `[상품 유형 템플릿: ${template.label} (${template.id})]`,
    `- 선택 근거: ${selection.reason}`,
    `- 독자가 알고 싶은 것: ${template.readerIntent}`,
    includeFlow
      ? "- 아래 흐름과 이미지 출처를 우선 따릅니다. 근거가 없는 섹션은 빈 문단으로 채우지 말고 병합하거나 생략합니다. 소제목 방향은 그대로 복사하지 말고 상품에 맞게 자연스럽게 바꿉니다."
      : "",
    "- 이미지: 상세페이지 근거 구간은 스펙·성분·사이즈·일정표 섹션, 연출컷은 사용 장면·분위기 섹션. 연출컷을 실제 촬영이나 성능 증거로 설명하지 않습니다.",
    ...(includeFlow ? flow : []),
    includeFlow ? "- 첫 섹션은 AI 요약이 인용하기 좋게 3줄 요약(무엇인지·누구에게·핵심 조건)으로 시작합니다." : "",
    template.faqSeeds.length
      ? `- FAQ 후보(확인된 답이 있을 때만, 최대 3쌍): ${template.faqSeeds.slice(0, 3).join(" / ")}`
      : "",
    `- 리서치 확인 항목: ${template.researchFocus.join(", ")}`,
    template.kind === "TRAVEL"
      ? "- 여행 꿀팁 컨셉: 코스 섹션마다 '💡 현지 꿀팁' 한 줄, 준비 섹션은 '▸ 꿀팁:' 체크리스트. 근거(체험 메모·상품 상세·확인된 여행 정보) 없는 팁은 쓰지 않고, 이모지는 💡만 씁니다."
      : "",
    // 요약 블록(공유 계약용)은 계약에 이미 있는 체험 규칙을 반복하지 않는다.
    !includeFlow
      ? ""
      : verified
        ? "- 체험 모드: '체험 메모의 1인칭 문장 자리'에는 사용자가 준 체험 메모에 있는 사실만 1인칭(써보니·가보니)으로 풀어 씁니다. 메모에 없는 체험·수치·기간은 만들지 않습니다."
        : "- 정보형 모드: 직접 구매·사용·방문 경험을 만들지 않습니다.",
  ];
  return lines.filter(Boolean).join("\n");
}

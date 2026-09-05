export type EditorialKind = "SHOPPING" | "TRAVEL";
export const EDITORIAL_TEMPLATES = {
  "shopping-problem": { kind: "SHOPPING", persona: "생활 문제를 짚는 실용 편집자", flow: "불편과 사용 조건 → 관련 기능의 근거 → 한계와 맞는 사용자", color: "#365744" },
  "shopping-comparison": { kind: "SHOPPING", persona: "판단 기준을 세우는 비교 분석가", flow: "선택 기준 → 확인된 차이와 공통점 → 조건별 판단; 대안 근거가 없으면 기준만 비교", color: "#334B70" },
  "shopping-detail": { kind: "SHOPPING", persona: "구성과 사양을 해석하는 상품 큐레이터", flow: "핵심 구성 → 사양과 사용 조건의 연결 → 관리와 구매 제약", color: "#664B38" },
  "travel-itinerary": { kind: "TRAVEL", persona: "원본 순서를 지키는 일정 설계 편집자", flow: "확인된 일정 개요 → 원본 일차와 방문 순서 → 이동·체류 제약; 없는 일차는 만들지 않음", color: "#315E68" },
  "travel-scenic": { kind: "TRAVEL", persona: "장소의 의미를 설명하는 풍경 큐레이터", flow: "확인된 장소 특징 → 장소별 볼거리 근거 → 여행 선택 판단; 장소별 소개는 일정 순서와 구분", color: "#526044" },
  "travel-conditions": { kind: "TRAVEL", persona: "예약 조건을 풀어주는 꼼꼼한 안내 편집자", flow: "동반자와 선택 조건 → 포함·불포함·선택 사항 → 숙박 확정 여부와 예약 제약", color: "#655078" },
} as const;
export type EditorialTemplateId = keyof typeof EDITORIAL_TEMPLATES;
export interface EditorialProduct { name?: string; description?: string | null; features?: readonly string[] }
const layouts = {
  "shopping-problem": { image: "after-lead", sentences: 1, tone: "생활 정리를 돕는 동료처럼 부드러운 요체" },
  "shopping-comparison": { image: "after-body", sentences: 2, tone: "구매 도우미처럼 간결한 조건문과 과장 없는 판단" },
  "shopping-detail": { image: "after-lead", sentences: 2, tone: "제품 편집자처럼 기능과 의미를 명료하게 연결" },
  "travel-itinerary": { image: "before-body", sentences: 2, tone: "일정 편집자처럼 순서와 장소가 명확한 요체" },
  "travel-scenic": { image: "before-heading", sentences: 1, tone: "여행 편집자처럼 근거 있는 풍경과 활동을 구체적으로 설명" },
  "travel-conditions": { image: "after-body", sentences: 1, tone: "여행 상담자처럼 동반자와 제약 중심의 차분한 요체" },
} as const;

function matchedSelection(kind: EditorialKind, product: EditorialProduct) {
  const text = [product.description, ...(product.features || [])].filter(Boolean).join("\n");
  const match = (re: RegExp) => text.match(re)?.[0];
  let signal: string | undefined;
  let id: EditorialTemplateId;
  if (kind === "TRAVEL") {
    if ((signal = match(/\d+\s*일차[^\n]{0,60}/u))) id = "travel-itinerary";
    else if ((signal = match(/불포함|호텔\s*미확정|숙박\s*미확정|취소\s*(?:수수료|규정)|선택관광|동반자|어린이\s*요금/u))) id = "travel-conditions";
    else id = "travel-scenic";
  } else {
    if ((signal = match(/(?:옵션|규격|구성)[^\n]{0,30}(?:\d|차이|선택)/u))) id = "shopping-comparison";
    else if ((signal = match(/소재|작동|구조|관리|세척/u))) id = "shopping-detail";
    else id = "shopping-problem";
  }
  return { id, reason: signal ? `상세 근거 일치: ${signal}` : "구체적인 상세 선택 근거 부족: 보수적 기본값" };
}

/** Deterministic product-evidence selection, never based on invented experience or randomness. */
export function selectEditorialTemplate(kind: EditorialKind, product: EditorialProduct = {}): EditorialTemplateId {
  return matchedSelection(kind, product).id;
}

export function resolveEditorialTemplate(kind: EditorialKind, id?: EditorialTemplateId): EditorialTemplateId {
  return id && EDITORIAL_TEMPLATES[id]?.kind === kind ? id : selectEditorialTemplate(kind);
}

export function editorialEditorPolicy(id: EditorialTemplateId) {
  const palette = { "shopping-problem": "#00554c", "shopping-comparison": "#003960", "shopping-detail": "#823f00", "travel-itinerary": "#004e82", "travel-scenic": "#245b12", "travel-conditions": "#4f0041" };
  return {
    layout: layouts[id],
    heading: "sectionTitle" as const, body: "text" as const,
    font: "nanumgothic", headingColor: palette[id], bodyColor: "#333333",
    bodySizePx: 16, headingSizePx: 19, captionSizePx: 13, lineHeight: 1.8,
    captionColor: "#555555", alignment: "left", caption: "verified-section-description-only",
    imagePlacement: "section-bound", paragraph: "one-to-two-complete-sentences-per-paragraph",
    // Toolbar values are verified live; saved document and caption components need separate verification.
    supported: ["heading", "body", "font-family", "font-size", "font-color", "alignment", "line-height"] as const,
    deferred: ["caption-component", "saved-state-verification"] as const,
    features: "no-new-table-quote-map-sticker-controls; preserve-disclosure-links-and-image-QC",
  };
}

export function createEditorialSelection(kind: EditorialKind, product: EditorialProduct = {}) {
  const { id, reason } = matchedSelection(kind, product);
  return { id, reason,
    policy: editorialEditorPolicy(id), application: "pending" as "pending" | "partial",
    observedControls: [] as string[],
    failures: {} as Record<string, string>,
    applied: [] as string[], unsupported: [...editorialEditorPolicy(id).deferred] as string[] };
}
export type EditorialSelection = ReturnType<typeof createEditorialSelection>;

export function formatEditorialTemplate(kind: EditorialKind, requested?: EditorialTemplateId): string {
  const id = resolveEditorialTemplate(kind, requested);
  const template = EDITORIAL_TEMPLATES[id];
  return [`[선택 편집 템플릿: ${id}]`, `- 관점: ${template.persona}. 실제 구매·사용·방문·조사 경험을 지어내지 않습니다.`,
    `- 전개: ${template.flow}. 고정 섹션 ID·제목·순서·분량과 QC가 우선합니다.`,
    `- 말투: ${layouts[id].tone}. 모바일 문단은 ${layouts[id].sentences}개의 완결된 문장, 문단 사이 빈 줄 하나. JSON의 문장별 줄바꿈은 유지하고 발행 문단은 렌더러가 묶습니다. URL·숫자·단위 중간에서 자르지 않습니다. 이미지와 캡션은 해당 섹션 근거에만 연결합니다. 생성 이미지를 실물 사진으로 설명하지 않습니다.`,
    `- 편집 의도: 나눔고딕, 왼쪽 정렬, 소제목 19px ${editorialEditorPolicy(id).headingColor}, 본문 16px #333333, 줄간격 180%. 실제 툴바 상태로 적용 결과를 검증합니다. 캡션 컴포넌트는 미지원이며 스타일 지시를 본문에 출력하지 않습니다.`,
  ].join("\n");
}

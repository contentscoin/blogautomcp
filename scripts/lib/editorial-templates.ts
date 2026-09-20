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

export type EditorialSectionRole =
  | "hook"
  | "overview"
  | "feature"
  | "howto"
  | "review"
  | "comparison"
  | "caution"
  | "fit"
  | "verdict"
  | "itinerary"
  | "place"
  | "conditions"
  | "closing";

export interface EditorialSectionDesign {
  role: EditorialSectionRole;
  /** How this section should introduce the category story. */
  purpose: string;
  headingStyle: "quotation" | "sectionTitle";
  image: "before-heading" | "before-body" | "after-lead" | "after-body";
  /** Mobile paragraph packing used when composing render nodes. */
  sentences: 1 | 2;
}

const layouts = {
  "shopping-problem": { image: "after-lead" as const, sentences: 1 as const, tone: "생활 정리를 돕는 동료처럼 부드러운 요체" },
  "shopping-comparison": { image: "after-body" as const, sentences: 2 as const, tone: "구매 도우미처럼 간결한 조건문과 과장 없는 판단" },
  "shopping-detail": { image: "after-lead" as const, sentences: 2 as const, tone: "제품 편집자처럼 기능과 의미를 명료하게 연결" },
  "travel-itinerary": { image: "before-body" as const, sentences: 2 as const, tone: "일정 편집자처럼 순서와 장소가 명확한 요체" },
  "travel-scenic": { image: "before-heading" as const, sentences: 1 as const, tone: "여행 편집자처럼 근거 있는 풍경과 활동을 구체적으로 설명" },
  "travel-conditions": { image: "after-body" as const, sentences: 1 as const, tone: "여행 상담자처럼 동반자와 제약 중심의 차분한 요체" },
} as const;

/** Per-template section design: fixed before typing so the publisher batches text. */
const sectionDesignByTemplate: Record<EditorialTemplateId, Record<string, EditorialSectionDesign>> = {
  "shopping-problem": {
    "shopping-hook": { role: "hook", purpose: "생활 불편과 제품 정체를 한 화면에 소개", headingStyle: "quotation", image: "before-body", sentences: 1 },
    "shopping-summary": { role: "overview", purpose: "카테고리와 일반 제품과의 차이를 소개", headingStyle: "sectionTitle", image: "after-lead", sentences: 1 },
    "shopping-package": { role: "feature", purpose: "핵심 기능이 만드는 생활 차이를 소개", headingStyle: "quotation", image: "after-lead", sentences: 1 },
    "shopping-design": { role: "feature", purpose: "특장점을 사용 장면과 연결해 소개", headingStyle: "quotation", image: "after-lead", sentences: 1 },
    "shopping-feature-1": { role: "howto", purpose: "보조 강점·사용 장면을 소개", headingStyle: "quotation", image: "after-lead", sentences: 1 },
    "shopping-feature-2": { role: "howto", purpose: "처음부터 쓰는 방법을 소개", headingStyle: "quotation", image: "after-lead", sentences: 1 },
    "shopping-feature-3": { role: "review", purpose: "후기 근거가 있을 때만 반복 장점을 소개", headingStyle: "quotation", image: "after-lead", sentences: 1 },
    "shopping-scale": { role: "comparison", purpose: "비슷한 제품과 갈리는 기준을 소개", headingStyle: "sectionTitle", image: "after-lead", sentences: 1 },
    "shopping-pros-cautions": { role: "caution", purpose: "구조상 한계와 확인 항목을 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "shopping-fit": { role: "fit", purpose: "추천·비추천 대상을 소개", headingStyle: "sectionTitle", image: "after-lead", sentences: 1 },
    "shopping-verdict": { role: "verdict", purpose: "조건부 최종 판단을 소개", headingStyle: "quotation", image: "after-lead", sentences: 1 },
  },
  "shopping-comparison": {
    "shopping-hook": { role: "hook", purpose: "선택 기준을 먼저 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "shopping-summary": { role: "overview", purpose: "비교 축이 되는 제품 구조를 소개", headingStyle: "sectionTitle", image: "after-body", sentences: 2 },
    "shopping-package": { role: "feature", purpose: "확인된 기능 차이를 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-design": { role: "feature", purpose: "특장점 비교 포인트를 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-feature-1": { role: "comparison", purpose: "두 번째 비교 축을 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-feature-2": { role: "howto", purpose: "사용·관리 조건 차이를 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-feature-3": { role: "review", purpose: "후기 근거 비교를 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-scale": { role: "comparison", purpose: "대안과 갈리는 기준을 정리", headingStyle: "sectionTitle", image: "after-body", sentences: 2 },
    "shopping-pros-cautions": { role: "caution", purpose: "조건별 한계를 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-fit": { role: "fit", purpose: "조건별 추천을 소개", headingStyle: "sectionTitle", image: "after-body", sentences: 2 },
    "shopping-verdict": { role: "verdict", purpose: "기준에 맞는 최종 선택을 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
  },
  "shopping-detail": {
    "shopping-hook": { role: "hook", purpose: "제품 구성의 핵심을 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "shopping-summary": { role: "overview", purpose: "카테고리·사양 골격을 소개", headingStyle: "sectionTitle", image: "after-lead", sentences: 2 },
    "shopping-package": { role: "feature", purpose: "핵심 구성·작동을 소개", headingStyle: "quotation", image: "after-lead", sentences: 2 },
    "shopping-design": { role: "feature", purpose: "소재·구조 디테일을 소개", headingStyle: "quotation", image: "after-lead", sentences: 2 },
    "shopping-feature-1": { role: "feature", purpose: "추가 사양 의미를 소개", headingStyle: "quotation", image: "after-lead", sentences: 2 },
    "shopping-feature-2": { role: "howto", purpose: "사용·관리 순서를 소개", headingStyle: "quotation", image: "after-lead", sentences: 2 },
    "shopping-feature-3": { role: "review", purpose: "실사용 근거가 있을 때만 소개", headingStyle: "quotation", image: "after-lead", sentences: 2 },
    "shopping-scale": { role: "comparison", purpose: "스펙 비교 축을 소개", headingStyle: "sectionTitle", image: "after-lead", sentences: 2 },
    "shopping-pros-cautions": { role: "caution", purpose: "관리·구매 제약을 소개", headingStyle: "quotation", image: "after-body", sentences: 2 },
    "shopping-fit": { role: "fit", purpose: "사양에 맞는 사용자를 소개", headingStyle: "sectionTitle", image: "after-lead", sentences: 2 },
    "shopping-verdict": { role: "verdict", purpose: "구성·사양 기준 결론을 소개", headingStyle: "quotation", image: "after-lead", sentences: 2 },
  },
  "travel-itinerary": {
    "travel-hook": { role: "hook", purpose: "여행지 성격과 일정 개요를 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "travel-route": { role: "itinerary", purpose: "원본 일정 순서를 소개", headingStyle: "sectionTitle", image: "before-body", sentences: 2 },
    "travel-day": { role: "itinerary", purpose: "일차별 방문 순서를 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "travel-place": { role: "place", purpose: "일정 안 장소를 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "travel-move": { role: "conditions", purpose: "이동·체류 제약을 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "travel-stay": { role: "conditions", purpose: "숙박·포함 조건을 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "travel-tips": { role: "howto", purpose: "준비·유의사항을 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
    "travel-fit": { role: "fit", purpose: "일정 속도에 맞는 여행자를 소개", headingStyle: "sectionTitle", image: "before-body", sentences: 2 },
    "travel-verdict": { role: "closing", purpose: "일정 기준 최종 판단을 소개", headingStyle: "quotation", image: "before-body", sentences: 2 },
  },
  "travel-scenic": {
    "travel-hook": { role: "hook", purpose: "대표 풍경과 장소 성격을 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
    "travel-route": { role: "overview", purpose: "장소 흐름을 소개", headingStyle: "sectionTitle", image: "before-heading", sentences: 1 },
    "travel-day": { role: "place", purpose: "장면별 볼거리를 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
    "travel-place": { role: "place", purpose: "장소 의미를 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
    "travel-move": { role: "howto", purpose: "이동 동선을 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
    "travel-stay": { role: "conditions", purpose: "체류·휴식 포인트를 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
    "travel-tips": { role: "howto", purpose: "감상·활동 팁을 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
    "travel-fit": { role: "fit", purpose: "풍경형 여행 적합자를 소개", headingStyle: "sectionTitle", image: "before-heading", sentences: 1 },
    "travel-verdict": { role: "closing", purpose: "장소 매력 기준 결론을 소개", headingStyle: "quotation", image: "before-heading", sentences: 1 },
  },
  "travel-conditions": {
    "travel-hook": { role: "hook", purpose: "동반자·선택 조건을 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "travel-route": { role: "overview", purpose: "조건이 붙는 일정을 소개", headingStyle: "sectionTitle", image: "after-body", sentences: 1 },
    "travel-day": { role: "itinerary", purpose: "조건이 바뀌는 일차를 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "travel-place": { role: "place", purpose: "선택관광·포함 장소를 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "travel-move": { role: "conditions", purpose: "이동·요금 조건을 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "travel-stay": { role: "conditions", purpose: "숙박 확정·미확정을 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "travel-tips": { role: "caution", purpose: "취소·포함 제약을 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
    "travel-fit": { role: "fit", purpose: "조건에 맞는 여행자를 소개", headingStyle: "sectionTitle", image: "after-body", sentences: 1 },
    "travel-verdict": { role: "closing", purpose: "조건 기준 최종 판단을 소개", headingStyle: "quotation", image: "after-body", sentences: 1 },
  },
};

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

function defaultSectionDesign(id: EditorialTemplateId): EditorialSectionDesign {
  const layout = layouts[id];
  return {
    role: EDITORIAL_TEMPLATES[id].kind === "TRAVEL" ? "place" : "feature",
    purpose: "카테고리 기본 소개",
    headingStyle: "sectionTitle",
    image: layout.image,
    sentences: layout.sentences,
  };
}

/** Resolve section design from fixed template map; freeform/day ids fall back by prefix. */
export function resolveEditorialSectionDesign(
  id: EditorialTemplateId,
  sectionId: string,
): EditorialSectionDesign {
  const exact = sectionDesignByTemplate[id][sectionId];
  if (exact) return exact;
  const designs = sectionDesignByTemplate[id];
  const prefixHit = Object.entries(designs).find(([key]) => sectionId.startsWith(key) || key.startsWith(sectionId.split("-").slice(0, 2).join("-")));
  if (prefixHit) return prefixHit[1]!;
  if (/day|일차|itinerary|route/iu.test(sectionId)) {
    return { ...defaultSectionDesign(id), role: "itinerary", purpose: "일정·동선 소개" };
  }
  if (/hook|summary|overview/iu.test(sectionId)) {
    return { ...defaultSectionDesign(id), role: "hook", purpose: "카테고리 도입 소개" };
  }
  return defaultSectionDesign(id);
}

export function listEditorialSectionDesigns(id: EditorialTemplateId): EditorialSectionDesign[] {
  return Object.values(sectionDesignByTemplate[id]);
}

/** Logod / Naver AI Briefing citation shape shared by all category templates. */
export const NAVER_AI_CITATION_POLICY = {
  headingForm: "question" as const,
  maxQuestionHeadings: 4,
  answerFirstSentences: 2,
  faqPairs: 3,
  comparisonChunk: "vertical-3" as const, // target / asked value / when to choose
  uniqueVerifiedLine: true,
  maxCoreKeywordMentions: 5,
  preferInformationalOverCommercial: true,
} as const;

export function editorialEditorPolicy(id: EditorialTemplateId) {
  const palette = { "shopping-problem": "#00554c", "shopping-comparison": "#003960", "shopping-detail": "#823f00", "travel-itinerary": "#004e82", "travel-scenic": "#245b12", "travel-conditions": "#4f0041" };
  return {
    layout: layouts[id],
    /** Apply toolbar once per section, then type the full body block. */
    writeMode: "batch" as const,
    sectionDesigns: sectionDesignByTemplate[id],
    citation: NAVER_AI_CITATION_POLICY,
    heading: "sectionTitle" as const, body: "text" as const,
    font: "nanumgothic", headingColor: palette[id], bodyColor: "#333333",
    bodySizePx: 16, headingSizePx: 19, captionSizePx: 13, lineHeight: 1.8,
    captionColor: "#555555", alignment: "left", caption: "verified-section-description-only",
    imagePlacement: "section-bound", paragraph: "section-batched-complete-sentences",
    // Toolbar values are verified live; saved document and caption components need separate verification.
    supported: ["heading", "body", "font-family", "font-size", "font-color", "alignment", "line-height", "batch-section-write"] as const,
    deferred: ["caption-component", "saved-state-verification"] as const,
    features: "no-new-table-quote-map-sticker-controls; preserve-disclosure-links-and-image-QC; batch-write-per-section; question-headings; faq-3; vertical-comparison-chunks",
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
  const sectionLines = Object.entries(sectionDesignByTemplate[id])
    .slice(0, 6)
    .map(([sectionId, design]) => `  · ${sectionId}: ${design.purpose} / ${design.headingStyle} / image=${design.image}`)
    .join("\n");
  return [`[선택 편집 템플릿: ${id}]`, `- 관점: ${template.persona}. 실제 구매·사용·방문·조사 경험을 지어내지 않습니다.`,
    `- 전개: ${template.flow}. 고정 섹션 ID·제목·순서·분량과 QC가 우선합니다.`,
    `- 말투: ${layouts[id].tone}. 모바일 문단은 ${layouts[id].sentences}개의 완결된 문장, 문단 사이 빈 줄 하나. JSON의 문장별 줄바꿈은 유지하고 발행 문단은 렌더러가 섹션 단위로 묶습니다. URL·숫자·단위 중간에서 자르지 않습니다. 이미지와 캡션은 해당 섹션 근거에만 연결합니다. 생성 이미지를 실물 사진으로 설명하지 않습니다.`,
    `- 답 중심 편집 권고: 전체 섹션 중 질문형은 최대 ${NAVER_AI_CITATION_POLICY.maxQuestionHeadings}개를 권장합니다. 질문 바로 아래 ${NAVER_AI_CITATION_POLICY.answerFirstSentences}문장에 답을 넣습니다. FAQ는 확인된 질문·답 근거가 있을 때 최대 ${NAVER_AI_CITATION_POLICY.faqPairs}쌍, 없으면 생략합니다. 비교도 근거가 있을 때만 대상/비교 항목/선택 조건으로 정리합니다. 표·FAQ는 이미지로 올리지 않습니다. 확인된 고유 근거를 넣고, 핵심 키워드는 ${NAVER_AI_CITATION_POLICY.maxCoreKeywordMentions}회 이하를 권장합니다. 검색 인용·노출은 보장하지 않습니다.`,
    `- 섹션 디자인(미리 고정):`, sectionLines,
    `- 발행 방식: 카테고리 템플릿의 글꼴·크기·색·정렬을 섹션당 1회만 적용한 뒤 본문을 일괄 입력합니다. 문장마다 텍스트 옵션을 다시 클릭하지 않습니다.`,
    `- 편집 의도: 나눔고딕, 왼쪽 정렬, 소제목 19px ${editorialEditorPolicy(id).headingColor}, 본문 16px #333333, 줄간격 180%. 실제 툴바 상태로 적용 결과를 검증합니다. 캡션 컴포넌트는 미지원이며 스타일 지시를 본문에 출력하지 않습니다.`,
  ].join("\n");
}

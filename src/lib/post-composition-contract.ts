export type BrandConnectKind = "SHOPPING" | "TRAVEL";

export type PostQualityPreset = "STANDARD" | "PREMIUM";

export type PostExperienceMode =
  | "AI_ASSISTED_INFORMATION"
  | "VERIFIED_EXPERIENCE";

export type PostHeadingStyle = "quotation" | "sectionTitle" | "plain";

export interface PostImageSlotContract {
  min: number;
  max: number;
  intent: string;
  placement: "before-body" | "after-lead" | "after-body";
  layout?: "single" | "sequence" | "collage-3";
}

export interface PostSectionContractV1 {
  id: string;
  title: string;
  purpose: string;
  evidenceRule: string;
  headingStyle: PostHeadingStyle;
  minChars: number;
  maxChars: number;
  image: PostImageSlotContract;
}

export interface PostCompositionContractV1 {
  version: "post-composition-contract/v1";
  connectKind: BrandConnectKind;
  targetCharacters: { min: number; max: number };
  targetImages: { min: number; recommended: number; max: number };
  targetSections: { min: number; max: number };
  earlyConnectAfterSectionId: string;
  finalConnectBeforeDisclosure: boolean;
  sections: PostSectionContractV1[];
}

export type PostRenderNode =
  | {
      kind: "disclosure";
      disclosureType: "affiliate" | "ai";
      placement: "top" | "bottom";
      text: string;
    }
  | {
      kind: "image";
      assetPath: string;
      sectionId: string | null;
      role: "thumbnail" | "hero" | "detail" | "scene" | "summary";
      altText: string;
      layout: "single" | "sequence" | "collage-3";
      sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
    }
  | { kind: "quotation"; sectionId: string; text: string }
  | { kind: "heading"; sectionId: string; text: string }
  | { kind: "paragraph"; sectionId: string | null; text: string }
  | { kind: "divider"; sectionId: string | null }
  | {
      kind: "connectCard";
      connectKind: BrandConnectKind;
      placement: "early" | "final";
      url: string;
    }
  | { kind: "hashtags"; values: string[] };

export interface ResolvedPostSectionV1 {
  id: string;
  title: string;
  body: string[];
  characterCount: number;
  imagePaths: string[];
  imageIntent: string;
  headingStyle: PostHeadingStyle;
  /** 명시적 플랜 또는 자유형 섹션의 이미지 하한·상한. 둘 다 없는 레거시는 읽을 때 정규화한다. */
  imageMin?: number;
  imageMax?: number;
}

/**
 * Spec-first 파이프라인이 글을 쓰기 전에 확정한 섹션별 이미지 플랜.
 * 이 플랜이 있으면 렌더 계약은 고정 팔레트(travel-hook, travel-day-1 …)에 섹션을 순서대로 끼워 맞추지 않고,
 * 실제 섹션 역할·이미지 의도·슬롯 배정을 그대로 따른다.
 */
export interface PostSectionPlanV1 {
  /** Preserve this identity when revising or reordering a prepared section. */
  sectionId?: string;
  /** 섹션 역할(itinerary-overview, day-course …). id 를 만드는 데 쓴다. */
  role: string;
  /** 이 섹션 앞에 오는 본문 이미지 경로(플랜이 확정한 순서) */
  imagePaths: string[];
  imageIntent: string;
  imageMin: number;
  imageMax: number;
  headingStyle?: PostHeadingStyle;
  /** 이 섹션 뒤에 첫 커넥트 카드를 놓는다 */
  earlyConnectCard?: boolean;
}

/** 섹션의 이미지 하한·상한. 플랜 값이 있으면 그것을, 없으면 계약 팔레트의 값을 돌려준다. */
export function sectionImageBounds(
  contract: PostCompositionContractV1,
  section: Pick<ResolvedPostSectionV1, "id" | "imageMin" | "imageMax">,
): { min: number; max: number } {
  const palette = contract.sections.find((candidate) => candidate.id === section.id);
  const min = Math.max(0, section.imageMin ?? palette?.image.min ?? 0);
  const max = section.imageMax ?? palette?.image.max ?? Math.max(1, min);
  // An explicit zero is meaningful: the contract intentionally makes later
  // sections optional so a five/seven-image post does not fan out into ten
  // slow, repetitive generation jobs.
  return { min, max: Math.max(min, max) };
}

export interface PostQualityReportV1 {
  preset: PostQualityPreset;
  canAutoPublish: boolean;
  score: number;
  actual: { characters: number; sections: number; images: number };
  target: {
    characters: { min: number; max: number };
    sections: { min: number; max: number };
    images: { min: number; recommended: number; max: number };
  };
  imageCoverage: {
    requiredSlots: number;
    filledRequiredSlots: number;
    missingSectionIds: string[];
  };
  blockers: string[];
  warnings: string[];
}

export interface ResolvedPostDocumentV1 {
  editorial?: import("../../scripts/lib/editorial-templates").EditorialSelection;
  version: "resolved-post-document/v1";
  contractVersion: "post-composition-contract/v1";
  connectKind: BrandConnectKind;
  qualityPreset: PostQualityPreset;
  experienceMode: PostExperienceMode;
  title: string;
  sections: ResolvedPostSectionV1[];
  renderNodes: PostRenderNode[];
  qualityReport: PostQualityReportV1;
}

const shoppingSections: PostSectionContractV1[] = [
  {
    id: "shopping-hook",
    title: "먼저 내린 한 줄 결론",
    purpose: "제품의 정체와 가장 큰 장점·제약을 첫 화면에서 함께 제시",
    evidenceRule: "상품명과 상세정보에서 확인되는 구조를 근거로 조건부 결론을 내린다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 250,
    image: { min: 1, max: 1, intent: "AI 연출 이미지: 검증된 상품 원형을 보존한 생활 공간 배치. 기능 시연이나 실제 사용 후기 사진이 아님", placement: "before-body" },
  },
  {
    id: "shopping-summary",
    title: "어떤 제품인지부터 보면",
    purpose: "카테고리와 핵심 구조, 일반 제품과 갈리는 지점을 설명",
    evidenceRule: "상품명·설명에서 확인된 용도와 구조만 사용한다.",
    headingStyle: "sectionTitle",
    minChars: 140,
    maxChars: 230,
    image: { min: 1, max: 1, intent: "전체 구성 또는 패키지 사진", placement: "after-lead" },
  },
  {
    id: "shopping-package",
    title: "핵심 기능이 실제로 만드는 차이",
    purpose: "기능·구조·수치를 작동 방식과 사용자 이점으로 번역",
    evidenceRule: "확인된 기능을 나열하지 말고 어떤 불편을 어떻게 줄이는지 연결한다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 240,
    image: {
      min: 1,
      max: 2,
      intent: "해당 핵심 기능·작동 방식·조작부를 직접 보여주거나 공식 설명하는 판매페이지 근거 이미지",
      placement: "after-lead",
      layout: "sequence",
    },
  },
  {
    id: "shopping-design",
    title: "이 제품만의 가장 분명한 특장점",
    purpose: "핵심 기능과 구조가 실제 사용 장면에서 주는 이점을 해석",
    evidenceRule: "확인된 기능에서 직접 이어지는 효익만 쓰고 성능을 과장하지 않는다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: {
      min: 1,
      max: 2,
      intent: "해당 특장점·작동 방식·조작부를 직접 보여주거나 공식 설명하는 판매페이지 근거 이미지",
      placement: "after-lead",
      layout: "sequence",
    },
  },
  {
    id: "shopping-feature-1",
    title: "두 번째로 눈에 띄는 강점",
    purpose: "보조 기능이나 형태상의 이점을 다른 사용 장면으로 설명",
    evidenceRule: "첫 장점과 같은 말을 반복하지 않고 별도의 선택 이유를 제시한다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 0, max: 1, intent: "첫 번째 핵심 기능 상세 사진", placement: "after-lead" },
  },
  {
    id: "shopping-feature-2",
    title: "처음부터 제대로 쓰는 방법",
    purpose: "설치·조작·충전·세척·보관 순서와 기능별 활용법을 구체화",
    evidenceRule: "설명서가 없으면 버튼 조작을 만들지 않고 확인된 구조에서 이어지는 사용법만 제시한다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 0, max: 1, intent: "두 번째 핵심 기능 상세 사진", placement: "after-lead" },
  },
  {
    id: "shopping-feature-3",
    title: "구매후기에서 반복된 좋은 점",
    purpose: "수집된 후기 원문이 있을 때 반복 장점과 실제 사용 맥락을 요약",
    evidenceRule: "후기 문장이 없으면 이 섹션을 생략하고 후기 수·평점만으로 만족도를 만들지 않는다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 0, max: 2, intent: "제품 원형을 보존한 연출컷 또는 원본 사용 장면", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-scale",
    title: "비슷한 제품과 갈리는 기준",
    purpose: "대안 제품과 비교할 기능·크기·관리·사용 환경을 설명",
    evidenceRule: "경쟁 제품의 미확인 수치·순위는 쓰지 않고 비교 축만 제시한다.",
    headingStyle: "sectionTitle",
    minChars: 130,
    maxChars: 220,
    image: { min: 0, max: 1, intent: "크기 비교 또는 스펙 이미지", placement: "after-lead" },
  },
  {
    id: "shopping-pros-cautions",
    title: "아쉬운 점과 구조상 한계",
    purpose: "제품 자체의 제약과 구매 전 검증할 성능을 설명",
    evidenceRule: "배송·쿠폰을 단점으로 대체하지 않고 구조상 제약과 미확인 성능을 구분한다.",
    headingStyle: "quotation",
    minChars: 180,
    maxChars: 280,
    image: { min: 0, max: 1, intent: "옵션·주의사항·구성 비교 이미지", placement: "after-body" },
  },
  {
    id: "shopping-fit",
    title: "누구에게 잘 맞고 누구에게는 과한지",
    purpose: "사용 빈도와 환경에 따라 추천·비추천 대상을 분리",
    evidenceRule: "모든 사람에게 좋다는 단정 없이 어떤 기능을 실제로 쓸지를 기준으로 나눈다.",
    headingStyle: "sectionTitle",
    minChars: 140,
    maxChars: 220,
    image: { min: 0, max: 1, intent: "AI 연출 이미지: 추천 환경의 공간 배치. 실제 사용이나 성능 증명이 아님", placement: "after-lead" },
  },
  {
    id: "shopping-verdict",
    title: "기능과 사용성을 종합한 최종 리뷰",
    purpose: "특장점·사용법·후기 근거·제약을 종합해 명확한 조건부 결론을 제시",
    evidenceRule: "어떤 조건에서 추천하고 어떤 조건에서 대안이 나은지 끝맺는다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 240,
    image: { min: 0, max: 1, intent: "제품 대표 원본 사진 재노출", placement: "after-lead" },
  },
];

const LEGACY_SHOPPING_FEATURE_IMAGE_INTENTS = new Map<string, string>([
  ["shopping-hook", "제품이 한눈에 보이는 대표 사진"],
  ["shopping-fit", "추천 사용 장면"],
  ["shopping-package", "구성품·패키지 원본 사진"],
  ["shopping-design", "재질·마감·크기 디테일 사진"],
]);

const travelSections: PostSectionContractV1[] = [
  {
    id: "travel-hook",
    title: "이 여행지에서 시작되는 장면",
    purpose: "도착 순간의 대표 풍경과 여행지의 성격을 선명하게 제시",
    evidenceRule: "일정에 실제 등장하는 장소와 안정적인 여행지 사실만 사용한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "목적지를 대표하는 실사 풍경", placement: "before-body" },
  },
  {
    id: "travel-differentiators",
    title: "알고 가면 더 깊어지는 배경",
    purpose: "지역의 역사·문화·지리적 배경을 여행 장면과 연결",
    evidenceRule: "공식 관광청·공공기관 등 신뢰 가능한 자료로 확인한 사실을 사용한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "코스 성격을 보여주는 대표 풍경", placement: "after-lead" },
  },
  {
    id: "travel-highlights",
    title: "하이라이트를 따라가는 하루",
    purpose: "핵심 방문지를 브이로그처럼 연결해 장면 변화를 보여준다.",
    evidenceRule: "실제 상품 코스와 연결되는 장소 이미지만 사용한다.",
    headingStyle: "sectionTitle",
    minChars: 180,
    maxChars: 280,
    image: { min: 2, max: 3, intent: "서로 다른 핵심 방문지 2~3장", placement: "after-lead", layout: "collage-3" },
  },
  {
    id: "travel-basics",
    title: "거리와 골목에서 만나는 분위기",
    purpose: "건축·거리·자연·사람의 움직임을 감각적인 현장 묘사로 전달",
    evidenceRule: "거짓 1인칭 경험 없이 실제 공간의 확인된 특징을 장면형 문장으로 쓴다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 380,
    image: { min: 1, max: 2, intent: "항공·교통 또는 일정 요약 이미지", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-lodging",
    title: "첫 번째 명소에서 꼭 볼 것",
    purpose: "첫 핵심 장소의 배경·풍경·즐길 거리·관람 팁을 구체적으로 설명",
    evidenceRule: "장소의 안정적인 정보와 실제 일정에 표기된 방문지만 사용한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 2, intent: "숙소 또는 핵심 장소와 주변 동선 1~2장", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-route",
    title: "두 번째 명소에서 즐길 것",
    purpose: "두 번째 장소의 고유한 분위기와 현지 활동을 구체적으로 설명",
    evidenceRule: "변동 운영정보는 만들지 않고 안정적인 장소 사실을 사용한다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 400,
    image: { min: 0, max: 1, intent: "일정 요약 카드 또는 이동 동선 이미지", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-1",
    title: "세 번째 명소에서 기억할 것",
    purpose: "세 번째 장소의 대표 장면과 문화적 맥락을 여행 팁과 연결",
    evidenceRule: "확인된 방문지와 안정적인 지역 정보만 사용한다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 420,
    image: { min: 0, max: 2, intent: "첫 일정 구간의 실제 장소 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-2",
    title: "현지의 맛과 쉬어가는 시간",
    purpose: "지역 음식·시장·카페·산책을 일정 주변 경험으로 소개",
    evidenceRule: "지역의 대표 음식문화와 일정 장소 주변에서 가능한 경험만 쓴다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 420,
    image: { min: 0, max: 2, intent: "중심 일정의 실제 장소 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-3",
    title: "사진으로 남기기 좋은 순간",
    purpose: "시간대·빛·구도에 따라 살아나는 대표 장면을 안내",
    evidenceRule: "실제 장소의 방향과 경관 특성에 맞는 촬영 포인트만 사용한다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 400,
    image: { min: 0, max: 2, intent: "후반 일정 또는 지역 분위기 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-inclusions",
    title: "처음 가도 바로 쓰는 현지 팁",
    purpose: "교통·걷기·복장·예절·준비물을 장소와 연결해 안내",
    evidenceRule: "공식 교통·관광 정보와 장소의 관람 특성에 근거한다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 380,
    image: { min: 0, max: 1, intent: "식사·교통·포함 조건을 설명하는 사진", placement: "after-body" },
  },
  {
    id: "travel-preparation",
    title: "하루를 더 풍성하게 만드는 작은 팁",
    purpose: "짧은 자유시간과 이동 사이에서 놓치기 쉬운 경험을 제안",
    evidenceRule: "일정에 없는 확정 방문을 만들지 않고 주변 선택지로 분명히 구분한다.",
    headingStyle: "sectionTitle",
    minChars: 220,
    maxChars: 340,
    image: { min: 0, max: 1, intent: "계절감·현지 이동이 드러나는 사진", placement: "after-lead" },
  },
  {
    id: "travel-fit",
    title: "이 여행지의 분위기를 한 문장으로",
    purpose: "장소들을 관통하는 정서와 여행지 고유 매력을 정리",
    evidenceRule: "과장어 대신 앞서 설명한 구체적인 장면을 근거로 홍보한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 0, max: 1, intent: "여행자와 목적지 분위기가 함께 보이는 사진", placement: "after-lead" },
  },
  {
    id: "travel-close",
    title: "여행의 마지막에 남는 장면",
    purpose: "대표 풍경과 감정을 연결해 여행 욕구를 선명하게 마무리",
    evidenceRule: "본문에 나온 여행지 사실과 장면만 사용하고 예약 압박 문구는 쓰지 않는다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 0, max: 1, intent: "여행의 여운을 남기는 마지막 풍경", placement: "after-lead" },
  },
];

export const SHOPPING_POST_CONTRACT_V1: PostCompositionContractV1 = {
  version: "post-composition-contract/v1",
  connectKind: "SHOPPING",
  targetCharacters: { min: 1200, max: 2800 },
  targetImages: { min: 5, recommended: 8, max: 14 },
  targetSections: { min: 5, max: 10 },
  earlyConnectAfterSectionId: "shopping-summary",
  finalConnectBeforeDisclosure: true,
  sections: shoppingSections,
};

export const TRAVEL_POST_CONTRACT_V1: PostCompositionContractV1 = {
  version: "post-composition-contract/v1",
  connectKind: "TRAVEL",
  targetCharacters: { min: 1750, max: 3600 },
  targetImages: { min: 7, recommended: 10, max: 18 },
  targetSections: { min: 7, max: 12 },
  earlyConnectAfterSectionId: "travel-highlights",
  finalConnectBeforeDisclosure: true,
  sections: travelSections,
};

export function getPostCompositionContract(
  connectKind: BrandConnectKind,
): PostCompositionContractV1 {
  return connectKind === "TRAVEL" ? TRAVEL_POST_CONTRACT_V1 : SHOPPING_POST_CONTRACT_V1;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Remove tag lists only; inline references and prose beginning with a tag survive. */
export function stripHashtagOnlyLines(value: string): string {
  return value.split(/\r?\n/u)
    .filter(line => !/^\s*(?:#[\p{L}\p{N}\p{M}_]+\s*)+$/u.test(line))
    .join("\n").trim();
}

export function normalizeSystemHashtags(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim().replace(/^#+/u, "").replace(/\s+/gu, "")).filter(Boolean))];
}

/** Repair detached labels and repeated answer labels without dropping answer sentences. */
export function normalizePublishedBodyLines(values: string[]): string[] {
  const lines = stripHashtagOnlyLines(values.join("\n")).split(/\r?\n/u).map(clean).filter(Boolean);
  const result: string[] = [];
  let active: "Q" | "A" | null = null;
  let question: string[] = [];
  let answer: string[] = [];
  const flush = () => {
    if (question.length) result.push(`Q. ${question.join(" ")}`);
    if (answer.length) result.push(`A. ${answer.join(" ")}`);
    question = []; answer = []; active = null;
  };
  for (const line of lines) {
    const marker = /^(Q|A|질문|답변)\s*[.:：)](?:\s+|$)(.*)$/iu.exec(line);
    if (marker) {
      const kind = /^(?:Q|질문)$/iu.test(marker[1]) ? "Q" : "A";
      if (kind === "Q") flush();
      active = kind;
      if (marker[2]) (kind === "Q" ? question : answer).push(marker[2]);
    } else if (active) {
      (active === "Q" ? question : answer).push(line);
    } else result.push(line);
  }
  flush();
  return result;
}

function parseGeneratedSection(value: string): { title: string; body: string[] } {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => clean(line))
    .filter(Boolean);
  const title = lines.shift() || "본문";
  const body = normalizePublishedBodyLines(lines.length ? lines : [title]);
  return { title, body };
}

/** Remove only the standard disclosure sentence, never a whole mixed section. */
export function splitAffiliateDisclosure(value: string): { content: string; disclosure: string } {
  const notices: string[] = [];
  const content = value.replace(/(?:(?:이\s*(?:글|포스팅)은|본\s*글은)\s*(?:네이버\s*)?|네이버\s*)(?:쇼핑|여행)\s*커넥트\s*활동[^.!?\n#]*수수료[^.!?\n#]*(?:[.!?]|(?=#|\n|$))/gu, sentence => {
    notices.push(sentence.trim());
    return "";
  }).replace(/자세한 (?:일정과 예약|상품) 정보는 아래 (?:여행|쇼핑)커넥트에서 확인해보세요\./gu, "").trim();
  return { content, disclosure: notices[0] || "" };
}

/** 제휴 고지문은 제목이나 본문 섹션에 섞여 들어와도 항상 시스템 노드로 분리한다. */
export function stripAffiliateDisclosureFromTitle(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .replace(/\s*(?:이\s*(?:글|포스팅)은|본\s*글은)\s*(?:네이버\s*)?(?:쇼핑|여행)\s*커넥트[\s\S]*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSectionContracts(
  contract: PostCompositionContractV1,
  count: number,
): PostSectionContractV1[] {
  if (count >= contract.sections.length) return contract.sections.slice(0, count);
  if (count <= 1) return contract.sections.slice(0, Math.max(1, count));
  return [
    ...contract.sections.slice(0, Math.max(1, count - 1)),
    contract.sections[contract.sections.length - 1],
  ];
}

function allocateFreeformImages(sectionCount: number, imagePaths: string[]): string[][] {
  // Unclassified source order is not evidence of relevance to a paragraph.
  // Keep these files available as material candidates, never auto-publish them.
  void imagePaths;
  return Array.from({ length: sectionCount }, () => [] as string[]);
}

/** Browser-safe deterministic identity; independent of section position. */
export function stableFreeformSectionId(connectKind: BrandConnectKind, title: string): string {
  let hash = 2166136261;
  for (const character of clean(title).normalize("NFKC")) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `${connectKind.toLowerCase()}-section-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function freeformImageRules(
  section: Pick<ResolvedPostSectionV1, "title" | "body" | "imagePaths">,
  contractSection?: PostSectionContractV1,
) {
  const minimum = Math.max(0, contractSection?.image.min ?? 0);
  const maximum = Math.max(minimum, contractSection?.image.max ?? 1, section.imagePaths.length);
  return {
    imageMin: minimum,
    imageMax: maximum,
    // Body prose changes during quality repair. Keep the visual contract tied
    // to the section's semantic role so a text-only revision is a cache hit.
    imageIntent: `${section.title}: ${contractSection?.image.intent || "본문 주제를 설명하는 서로 다른 실사 장면"}`,
    headingStyle: contractSection?.headingStyle || ("sectionTitle" as const),
  };
}

/**
 * Replace only the two obsolete shopping feature intents emitted by the old
 * positional contract. Matching is exact after whitespace normalization and
 * role-scoped, so a real section that deliberately mentions a package or its
 * dimensions is left untouched.
 */
function currentSectionImageIntent(
  connectKind: BrandConnectKind,
  sectionTitle: string,
  imageIntent: string,
  contractSection?: PostSectionContractV1,
): string {
  if (connectKind !== "SHOPPING" || !contractSection) return imageIntent;
  const legacyIntent = LEGACY_SHOPPING_FEATURE_IMAGE_INTENTS.get(contractSection.id);
  if (!legacyIntent) return imageIntent;
  const normalizedIntent = clean(imageIntent);
  const normalizedTitle = clean(sectionTitle);
  if (normalizedIntent === clean(legacyIntent)) return contractSection.image.intent;
  if (normalizedIntent === `${normalizedTitle}: ${clean(legacyIntent)}`) {
    return `${normalizedTitle}: ${contractSection.image.intent}`;
  }
  return imageIntent;
}

export function buildPostQualityReport(options: {
  contract: PostCompositionContractV1;
  preset: PostQualityPreset;
  sections: ResolvedPostSectionV1[];
  imageCount: number;
}): PostQualityReportV1 {
  const characterCount = options.sections.reduce((sum, section) => sum + section.characterCount, 0);
  const actual = {
    characters: characterCount,
    sections: options.sections.length,
    images: options.imageCount,
  };
  const blockers: string[] = [];
  const warnings: string[] = [];
  const target = {
    characters: options.contract.targetCharacters,
    sections: options.contract.targetSections,
    images: options.contract.targetImages,
  };
  const minimumOf = (section: ResolvedPostSectionV1) => sectionImageBounds(options.contract, section).min;
  const missingSectionIds = options.sections
    .filter((section) => section.imagePaths.length < minimumOf(section))
    .map((section) => section.id);
  const requiredBodySlots = options.sections.reduce((sum, section) => sum + minimumOf(section), 0);
  const filledRequiredBodySlots = options.sections.reduce(
    (sum, section) => sum + Math.min(minimumOf(section), section.imagePaths.length),
    0,
  );
  const imageCoverage = {
    requiredSlots: requiredBodySlots + 1,
    filledRequiredSlots: filledRequiredBodySlots + (options.imageCount > 0 ? 1 : 0),
    missingSectionIds,
  };
  const register = (ok: boolean, message: string) => {
    if (ok) return;
    (options.preset === "PREMIUM" ? blockers : warnings).push(message);
  };
  register(actual.characters >= target.characters.min, `본문이 ${target.characters.min}자보다 짧습니다 (${actual.characters}자).`);
  register(actual.sections >= target.sections.min, `본문 섹션이 ${target.sections.min}개보다 적습니다 (${actual.sections}개).`);
  register(actual.images >= target.images.min, `이미지가 ${target.images.min}장보다 적습니다 (${actual.images}장).`);
  register(
    missingSectionIds.length === 0,
    `이미지 최소 장수를 못 채운 파트가 있습니다: ${missingSectionIds.join(", ")}.`,
  );
  if (actual.images >= target.images.min && actual.images < target.images.recommended) {
    warnings.push(`이미지 최소 기준은 통과했지만 권장 ${target.images.recommended}장보다 적습니다 (${actual.images}장).`);
  }
  if (actual.characters > target.characters.max) warnings.push(`본문이 권장 최대 ${target.characters.max}자를 넘었습니다.`);
  if (actual.images > target.images.max) warnings.push(`이미지가 권장 최대 ${target.images.max}장을 넘었습니다.`);
  const deductions = blockers.length * 22 + warnings.length * 6;
  return {
    preset: options.preset,
    canAutoPublish: blockers.length === 0,
    score: Math.max(0, 100 - deductions),
    actual,
    target,
    imageCoverage,
    blockers,
    warnings,
  };
}

/** 플랜 역할에서 안정적인 섹션 id 를 만든다 (같은 역할이 반복되면 -2, -3 …). */
function planSectionIds(connectKind: BrandConnectKind, plan: PostSectionPlanV1[]): string[] {
  const prefix = connectKind.toLowerCase();
  const seen = new Map<string, number>();
  return plan.map((section) => {
    if (section.sectionId) return section.sectionId;
    const base = `${prefix}-${section.role.replace(/[^a-z0-9-]+/giu, "-").toLowerCase() || "section"}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

/**
 * 플랜이 배정한 이미지만 섹션에 적용한다. 의미가 검증되지 않은 잔여 이미지는 미배정으로 둔다.
 * 업로드 목록에 없는 경로(교체·삭제된 파일)는 조용히 버린다.
 */
function allocatePlannedImages(plan: PostSectionPlanV1[], bodyImagePaths: string[]): string[][] {
  const available = new Set(bodyImagePaths);
  const used = new Set<string>();
  const allocations = plan.map((section) =>
    section.imagePaths.filter((imagePath) => {
      if (!available.has(imagePath) || used.has(imagePath)) return false;
      used.add(imagePath);
      return true;
    }),
  );
  return allocations;
}

export function resolvePostDocument(options: {
  editorial?: import("../../scripts/lib/editorial-templates").EditorialSelection;
  connectKind: BrandConnectKind;
  title: string;
  sections: string[];
  hashtags: string[];
  imagePaths: string[];
  /** Spec-first가 이미 계산한 섹션별 이미지 배치를 보존한다. 미지정 시에만 기존 순차 배치를 사용한다. */
  sectionImagePaths?: string[][];
  /** Explicit reviewed mappings for freeform sections; keyed by stable section ID. */
  sectionImageBindings?: Record<string, string[]>;
  connectUrl: string;
  qualityPreset?: PostQualityPreset;
  experienceMode?: PostExperienceMode;
  /** Spec-first 섹션 플랜. 본문 섹션 수와 길이가 같을 때만 적용된다. */
  sectionPlan?: PostSectionPlanV1[] | null;
}): ResolvedPostDocumentV1 {
  const contract = getPostCompositionContract(options.connectKind);
  const qualityPreset = options.qualityPreset || "PREMIUM";
  const experienceMode = options.experienceMode || "AI_ASSISTED_INFORMATION";
  const separated = options.sections.map(value => {
    const separated = splitAffiliateDisclosure(value);
    return { ...separated, content: stripHashtagOnlyLines(separated.content) };
  });
  const disclosureSection = separated.find(section => section.disclosure)?.disclosure;
  const contentSections = separated.flatMap(section => section.content ? [section.content] : []);
  const plan =
    options.sectionPlan && options.sectionPlan.length === contentSections.length ? options.sectionPlan : null;
  const sectionContracts = resolveSectionContracts(contract, contentSections.length);
  const thumbnailPath = options.imagePaths[0] || "";
  const bodyImagePaths = thumbnailPath ? options.imagePaths.slice(1) : options.imagePaths;
  const freeformIds = contentSections.map(section => stableFreeformSectionId(options.connectKind, parseGeneratedSection(section).title));
  // Identical headings need disambiguation. Existing prepared plans preserve explicit IDs.
  const seenIds = new Map<string, number>();
  freeformIds.forEach((id, index) => {
    const occurrence = (seenIds.get(id) || 0) + 1;
    seenIds.set(id, occurrence);
    if (occurrence > 1) freeformIds[index] = `${id}-${occurrence}`;
  });
  const availableBody = new Set(bodyImagePaths);
  const allocations = options.sectionImageBindings && !plan
    ? freeformIds.map(id => [...new Set(options.sectionImageBindings?.[id] || [])].filter(file => availableBody.has(file)))
    : options.sectionImagePaths && options.sectionImagePaths.length === contentSections.length
    ? contentSections.map((_, index) => Array.from(new Set(options.sectionImagePaths?.[index] || [])).filter(file => availableBody.has(file)))
    : plan
      ? allocatePlannedImages(plan, bodyImagePaths)
      : allocateFreeformImages(contentSections.length, bodyImagePaths);
  const planIds = plan ? planSectionIds(options.connectKind, plan) : [];
  const sections = contentSections.map((section, index): ResolvedPostSectionV1 => {
    const parsed = parseGeneratedSection(section);
    if (plan) {
      const planned = plan[index];
      return {
        id: planIds[index],
        title: parsed.title,
        body: parsed.body,
        characterCount: parsed.body.join("").length,
        imagePaths: allocations[index] || [],
        imageIntent: currentSectionImageIntent(
          options.connectKind,
          parsed.title,
          planned.imageIntent,
          sectionContracts[index],
        ),
        headingStyle: planned.headingStyle || "sectionTitle",
        imageMin: Math.max(0, planned.imageMin),
        imageMax: Math.max(planned.imageMin, planned.imageMax),
      };
    }
    return {
      id: freeformIds[index],
      title: parsed.title,
      body: parsed.body,
      characterCount: parsed.body.join("").length,
      imagePaths: allocations[index] || [],
      ...freeformImageRules({ ...parsed, imagePaths: allocations[index] || [] }, sectionContracts[index]),
    };
  });
  const earlyConnectSectionId = plan
    ? planIds[plan.findIndex((section) => section.earlyConnectCard)] ?? null
    : sections[Math.max(0, sectionContracts.findIndex(section => section.id === contract.earlyConnectAfterSectionId))]?.id;

  const renderNodes: PostRenderNode[] = [];
  if (thumbnailPath) {
    renderNodes.push({
      kind: "image",
      assetPath: thumbnailPath,
      sectionId: null,
      role: "thumbnail",
      altText: clean(options.title),
      layout: "single",
      sourcePolicy:
        options.connectKind === "SHOPPING" ? "LOCKED_PRODUCT_OR_ORIGINAL" : "TRAVEL_EDITORIAL",
    });
  }

  const pushImage = (section: ResolvedPostSectionV1, imagePath: string, index: number) => {
    const summaryRole = plan && /summary|overview|key-facts|travel-route/u.test(section.id);
    renderNodes.push({
      kind: "image",
      assetPath: imagePath,
      sectionId: section.id,
      role: summaryRole ? "summary" : index === 0 ? "detail" : "scene",
      altText: `${section.title} - ${section.imageIntent}`,
      layout: section.imagePaths.length > 1 ? "sequence" : "single",
      sourcePolicy:
        options.connectKind === "SHOPPING" ? "LOCKED_PRODUCT_OR_ORIGINAL" : "TRAVEL_EDITORIAL",
    });
  };

  for (const section of sections) {
    renderNodes.push({ kind: "divider", sectionId: section.id });
    const layout = options.editorial?.policy.layout;
    const sectionDesign = options.editorial
      ? (options.editorial.policy.sectionDesigns?.[section.id]
        ?? Object.entries(options.editorial.policy.sectionDesigns || {}).find(([key]) => section.id.startsWith(key))?.[1])
      : undefined;
    const imageLayout = sectionDesign?.image ?? layout?.image ?? "after-lead";
    const sentencesPerParagraph = sectionDesign?.sentences ?? layout?.sentences ?? 1;
    const pushSectionImages = () => section.imagePaths.forEach((imagePath, index) => pushImage(section, imagePath, index));
    if (imageLayout === "before-heading") pushSectionImages();
    // 네이버 자동 입력에서는 인용구 컴포넌트가 빈 채로 남을 수 있으므로 모든
    // 섹션 제목을 실제 소제목 서식 노드로 정규화한다.
    renderNodes.push({ kind: "heading", sectionId: section.id, text: section.title });
    if (imageLayout === "before-body") pushSectionImages();

    // Batch write: pack sentences into at most two body blocks per section so
    // the publisher applies toolbar styles once, then types the whole block.
    const step = Math.max(1, sentencesPerParagraph);
    const paragraphs: string[] = [];
    for (let i = 0; i < section.body.length;) {
      // Keep each question and its complete answer together, regardless of template batching.
      if (/^Q\. /u.test(section.body[i]) && /^A\. /u.test(section.body[i + 1] || "")) {
        paragraphs.push(`${section.body[i]}\n${section.body[i + 1]}`);
        i += 2;
        continue;
      }
      const chunk: string[] = [];
      do { chunk.push(section.body[i++].trim()); }
      while (i < section.body.length && chunk.length < step && !/^Q\. /u.test(section.body[i]));
      if (chunk.length) paragraphs.push(chunk.join(" "));
    }
    const batchWrite = options.editorial?.policy.writeMode === "batch";
    if (batchWrite) {
      if (paragraphs.length > 0) {
        if (imageLayout === "after-lead" && paragraphs.length > 1) {
          renderNodes.push({ kind: "paragraph", sectionId: section.id, text: paragraphs[0]! });
          pushSectionImages();
          renderNodes.push({ kind: "paragraph", sectionId: section.id, text: paragraphs.slice(1).join("\n\n") });
        } else {
          renderNodes.push({ kind: "paragraph", sectionId: section.id, text: paragraphs.join("\n\n") });
          if (imageLayout === "after-lead" || imageLayout === "after-body") pushSectionImages();
        }
      } else if (imageLayout === "after-lead" || imageLayout === "after-body") {
        pushSectionImages();
      }
    } else {
      paragraphs.forEach((paragraph, paragraphIndex) => {
        renderNodes.push({ kind: "paragraph", sectionId: section.id, text: paragraph });
        if (paragraphIndex === 0 && imageLayout === "after-lead") {
          pushSectionImages();
        }
      });
      if (imageLayout === "after-body" || (section.body.length === 0 && imageLayout === "after-lead")) {
        pushSectionImages();
      }
    }
    if (earlyConnectSectionId && section.id === earlyConnectSectionId && options.connectUrl) {
      renderNodes.push({
        kind: "connectCard",
        connectKind: options.connectKind,
        placement: "early",
        url: options.connectUrl,
      });
    }
  }

  if (contract.finalConnectBeforeDisclosure && options.connectUrl) {
    renderNodes.push({
      kind: "connectCard",
      connectKind: options.connectKind,
      placement: "final",
      url: options.connectUrl,
    });
  }
  renderNodes.push({ kind: "hashtags", values: normalizeSystemHashtags(options.hashtags) });
  renderNodes.push({
    kind: "disclosure",
    disclosureType: "affiliate",
    placement: "bottom",
    text:
      clean(disclosureSection || "") ||
      (options.connectKind === "TRAVEL"
        ? "이 글은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받을 수 있습니다."
        : "이 글은 네이버 쇼핑 커넥트 활동의 일환으로, 구매 발생 시 수수료를 제공받을 수 있습니다."),
  });

  return {
    version: "resolved-post-document/v1",
    editorial: options.editorial,
    contractVersion: contract.version,
    connectKind: options.connectKind,
    qualityPreset,
    experienceMode,
    title: stripAffiliateDisclosureFromTitle(options.title),
    sections,
    renderNodes,
    qualityReport: buildPostQualityReport({
      contract,
      preset: qualityPreset,
      sections,
      imageCount: renderNodes.filter(node => node.kind === "image").length,
    }),
  };
}

/** Browser-safe read-time repair for prepared documents; keeps image/card order. */
export function normalizePublishedPostText(document: ResolvedPostDocumentV1): ResolvedPostDocumentV1 {
  const sections = document.sections.map(section => {
    const body = normalizePublishedBodyLines(section.body.map(value => splitAffiliateDisclosure(value).content));
    return { ...section, body, characterCount: body.join("").length };
  });
  const renderNodes: PostRenderNode[] = [];
  const tags = normalizeSystemHashtags(document.renderNodes.flatMap(node => node.kind === "hashtags" ? node.values : []));
  let tagsWritten = false;
  for (let i = 0; i < document.renderNodes.length; i++) {
    const node = document.renderNodes[i];
    if (node.kind === "hashtags") {
      if (!tagsWritten) renderNodes.push({ kind: "hashtags", values: tags });
      tagsWritten = true;
    } else if (node.kind === "paragraph") {
      const text = [splitAffiliateDisclosure(node.text).content];
      while (i + 1 < document.renderNodes.length) {
        const next = document.renderNodes[i + 1];
        if (next.kind !== "paragraph" || next.sectionId !== node.sectionId) break;
        text.push(splitAffiliateDisclosure(next.text).content);
        i++;
      }
      if (text.some(value => /(?:^|\n)\s*(?:Q|A|질문|답변)\s*[.:：)](?:\s|$)/iu.test(value))) {
        const normalized = normalizePublishedBodyLines(text).join("\n");
        if (normalized) renderNodes.push({ ...node, text: normalized });
      } else {
        // Ordinary paragraphs keep their existing template boundaries and spacing.
        for (const value of text) {
          const normalized = stripHashtagOnlyLines(value);
          if (normalized) renderNodes.push({ ...node, text: normalized });
        }
      }
    } else if (node.kind === "disclosure") {
      renderNodes.push({ ...node, text: splitAffiliateDisclosure(node.text).disclosure || stripHashtagOnlyLines(node.text) });
    } else renderNodes.push(node);
  }
  return refreshPostDocumentQuality({ ...document, sections, renderNodes });
}

/** Pure migration for bounded/spec-first documents created with stale role intents. */
export function normalizeLegacyPostImageIntents(
  document: ResolvedPostDocumentV1,
): ResolvedPostDocumentV1 {
  if (document.connectKind !== "SHOPPING") return document;
  const contractSections = resolveSectionContracts(
    getPostCompositionContract(document.connectKind),
    document.sections.length,
  );
  const migrated = new Map<string, ResolvedPostSectionV1>();
  const sections = document.sections.map((section, index) => {
    const imageIntent = currentSectionImageIntent(
      document.connectKind,
      section.title,
      section.imageIntent,
      contractSections[index],
    );
    if (imageIntent === section.imageIntent) return section;
    const normalized = { ...section, imageIntent };
    migrated.set(section.id, normalized);
    return normalized;
  });
  if (migrated.size === 0) return document;
  const renderNodes = document.renderNodes.map((node): PostRenderNode => {
    if (node.kind !== "image" || node.sectionId === null) return node;
    const section = migrated.get(node.sectionId);
    return section ? { ...node, altText: `${section.title} - ${section.imageIntent}` } : node;
  });
  return { ...document, sections, renderNodes };
}

/**
 * Pure read-time migration: absence of BOTH bounds identifies legacy freeform
 * sections. Never replace either explicit bound (including text-only 0/0).
 * Preserve text, assets, IDs, node order and link anchors; refresh QC separately.
 */
export function normalizeLegacyFreeformImageRules(
  document: ResolvedPostDocumentV1,
): ResolvedPostDocumentV1 {
  const intentNormalized = normalizeLegacyPostImageIntents(document);
  const contractSections = resolveSectionContracts(
    getPostCompositionContract(intentNormalized.connectKind),
    intentNormalized.sections.length,
  );
  const migrated = new Map<string, ResolvedPostSectionV1>();
  const sections = intentNormalized.sections.map((section, index) => {
    if (section.imageMin !== undefined || section.imageMax !== undefined) return section;
    const normalized = { ...section, ...freeformImageRules(section, contractSections[index]) };
    migrated.set(section.id, normalized);
    return normalized;
  });
  if (migrated.size === 0) return intentNormalized;
  const renderNodes = intentNormalized.renderNodes.map((node): PostRenderNode => {
    if (node.kind !== "image" || node.sectionId === null) return node;
    const section = migrated.get(node.sectionId);
    if (!section) return node;
    return {
      ...node,
      role: section.imagePaths.indexOf(node.assetPath) > 0 ? "scene" : "detail",
      layout: section.imagePaths.length > 1 ? "sequence" : "single",
      altText: `${section.title} - ${section.imageIntent}`,
    };
  });
  return { ...intentNormalized, sections, renderNodes };
}

export function refreshPostDocumentQuality(
  document: ResolvedPostDocumentV1,
): ResolvedPostDocumentV1 {
  const contract = getPostCompositionContract(document.connectKind);
  const imageCount = document.renderNodes.filter((node) => node.kind === "image").length;
  return {
    ...document,
    qualityReport: buildPostQualityReport({
      contract,
      preset: document.qualityPreset,
      sections: document.sections,
      imageCount,
    }),
  };
}

export function formatPostContractForPrompt(contract: PostCompositionContractV1): string {
  return [
    `[유연한 렌더링 계약 ${contract.version}]`,
    `- 권장 범위: 섹션 ${contract.targetSections.min}~${contract.targetSections.max}개, 본문 ${contract.targetCharacters.min}~${contract.targetCharacters.max}자, 이미지 최소 ${contract.targetImages.min}장·권장 ${contract.targetImages.recommended}장·상한 ${contract.targetImages.max}장`,
    "- 위 숫자는 품질 점검 범위이며 정확한 할당량이 아닙니다. 정보가 빈약한 섹션을 만들거나 같은 내용을 반복하지 마세요.",
    "- 아래 항목은 에디터 이미지 배치를 위한 역할 팔레트입니다. 모든 제목·순서를 복사하지 말고, 분석 결과에 맞춰 필요한 역할을 선택·병합·재배열하세요.",
    ...contract.sections.map(
      (section, index) =>
        `${index + 1}. 역할=${section.id} | 목적=${section.purpose} | 근거=${section.evidenceRule} | 이미지=${section.image.intent}`,
    ),
  ].join("\n");
}

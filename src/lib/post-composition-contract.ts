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
    image: { min: 1, max: 1, intent: "제품이 한눈에 보이는 대표 사진", placement: "before-body" },
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
    image: { min: 1, max: 2, intent: "구성품·패키지 원본 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-design",
    title: "이 제품만의 가장 분명한 특장점",
    purpose: "핵심 기능과 구조가 실제 사용 장면에서 주는 이점을 해석",
    evidenceRule: "확인된 기능에서 직접 이어지는 효익만 쓰고 성능을 과장하지 않는다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 1, max: 2, intent: "재질·마감·크기 디테일 사진", placement: "after-lead", layout: "sequence" },
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
    image: { min: 0, max: 1, intent: "추천 사용 장면", placement: "after-lead" },
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

function parseGeneratedSection(value: string): { title: string; body: string[] } {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => clean(line))
    .filter(Boolean);
  const title = lines.shift() || "본문";
  const body = lines.length ? lines : [title];
  return { title, body };
}

function isDisclosureSection(value: string): boolean {
  return /(?:쇼핑|여행)\s*커넥트/u.test(value) && /수수료/u.test(value);
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

function allocateImages(
  sectionContracts: PostSectionContractV1[],
  imagePaths: string[],
): string[][] {
  const allocations = sectionContracts.map(() => [] as string[]);
  let cursor = 0;
  for (let index = 0; index < sectionContracts.length && cursor < imagePaths.length; index += 1) {
    const minimum = Math.min(sectionContracts[index].image.min, imagePaths.length - cursor);
    allocations[index].push(...imagePaths.slice(cursor, cursor + minimum));
    cursor += minimum;
  }
  while (cursor < imagePaths.length) {
    let added = false;
    for (let index = 0; index < sectionContracts.length && cursor < imagePaths.length; index += 1) {
      if (allocations[index].length >= sectionContracts[index].image.max) continue;
      allocations[index].push(imagePaths[cursor]);
      cursor += 1;
      added = true;
    }
    if (!added) break;
  }
  // 슬롯별 max는 권장 배치 밀도다. 전체 계약 범위 안의 유효 이미지를
  // 조용히 버리지 않도록, 여분은 본문 흐름에 순환 배치한다.
  while (cursor < imagePaths.length && allocations.length > 0) {
    const index = cursor % allocations.length;
    allocations[index].push(imagePaths[cursor]);
    cursor += 1;
  }
  return allocations;
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
  const sectionContractById = new Map(
    options.contract.sections.map((section) => [section.id, section]),
  );
  const missingSectionIds = options.sections
    .filter((section) => {
      const minimum = sectionContractById.get(section.id)?.image.min || 0;
      return section.imagePaths.length < minimum;
    })
    .map((section) => section.id);
  const requiredBodySlots = options.sections.reduce(
    (sum, section) => sum + (sectionContractById.get(section.id)?.image.min || 0),
    0,
  );
  const filledRequiredBodySlots = options.sections.reduce((sum, section) => {
    const minimum = sectionContractById.get(section.id)?.image.min || 0;
    return sum + Math.min(minimum, section.imagePaths.length);
  }, 0);
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

export function resolvePostDocument(options: {
  connectKind: BrandConnectKind;
  title: string;
  sections: string[];
  hashtags: string[];
  imagePaths: string[];
  connectUrl: string;
  qualityPreset?: PostQualityPreset;
  experienceMode?: PostExperienceMode;
}): ResolvedPostDocumentV1 {
  const contract = getPostCompositionContract(options.connectKind);
  const qualityPreset = options.qualityPreset || "PREMIUM";
  const experienceMode = options.experienceMode || "AI_ASSISTED_INFORMATION";
  const disclosureSection = options.sections.find(isDisclosureSection);
  const contentSections = options.sections.filter((section) => !isDisclosureSection(section));
  const sectionContracts = resolveSectionContracts(contract, contentSections.length);
  const thumbnailPath = options.imagePaths[0] || "";
  const bodyImagePaths = thumbnailPath ? options.imagePaths.slice(1) : options.imagePaths;
  const allocations = allocateImages(sectionContracts, bodyImagePaths);
  const sections = contentSections.map((section, index): ResolvedPostSectionV1 => {
    const parsed = parseGeneratedSection(section);
    const sectionContract = sectionContracts[index] || contract.sections.at(-1)!;
    return {
      id: sectionContract.id,
      title: parsed.title,
      body: parsed.body,
      characterCount: parsed.body.join("").length,
      imagePaths: allocations[index] || [],
      imageIntent: sectionContract.image.intent,
      headingStyle: sectionContract.headingStyle,
    };
  });

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
    const sectionContract = contract.sections.find((item) => item.id === section.id);
    renderNodes.push({
      kind: "image",
      assetPath: imagePath,
      sectionId: section.id,
      role: section.id.includes("summary") || section.id === "travel-route" ? "summary" : index === 0 ? "detail" : "scene",
      altText: `${section.title} - ${section.imageIntent}`,
      layout: sectionContract?.image.layout || "single",
      sourcePolicy:
        options.connectKind === "SHOPPING" ? "LOCKED_PRODUCT_OR_ORIGINAL" : "TRAVEL_EDITORIAL",
    });
  };

  for (const section of sections) {
    const sectionContract = contract.sections.find((item) => item.id === section.id);
    renderNodes.push({ kind: "divider", sectionId: section.id });
    // 네이버 자동 입력에서는 인용구 컴포넌트가 빈 채로 남을 수 있으므로 모든
    // 섹션 제목을 실제 소제목 서식 노드로 정규화한다.
    renderNodes.push({ kind: "heading", sectionId: section.id, text: section.title });
    const placement = sectionContract?.image.placement || "after-lead";
    if (placement === "before-body") {
      section.imagePaths.forEach((imagePath, index) => pushImage(section, imagePath, index));
    }
    section.body.forEach((paragraph, paragraphIndex) => {
      renderNodes.push({ kind: "paragraph", sectionId: section.id, text: paragraph });
      if (placement === "after-lead" && paragraphIndex === 0) {
        section.imagePaths.forEach((imagePath, index) => pushImage(section, imagePath, index));
      }
    });
    if (placement === "after-body") {
      section.imagePaths.forEach((imagePath, index) => pushImage(section, imagePath, index));
    }
    if (section.id === contract.earlyConnectAfterSectionId && options.connectUrl) {
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
  renderNodes.push({ kind: "hashtags", values: options.hashtags });
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
      imageCount: options.imagePaths.length,
    }),
  };
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

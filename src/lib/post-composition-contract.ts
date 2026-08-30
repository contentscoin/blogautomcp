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
    title: "상세정보에서 확인한 사실",
    purpose: "장단점 판단의 근거가 된 기능·구성·수치를 공개",
    evidenceRule: "확인된 사실과 추론을 구분하고 없는 스펙은 만들지 않는다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 240,
    image: { min: 1, max: 2, intent: "구성품·패키지 원본 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-design",
    title: "가장 분명한 장점",
    purpose: "핵심 기능이 사용 장면에서 주는 이점을 해석",
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
    title: "실제로 잘 맞는 사용 장면",
    purpose: "누가 어디에서 어떤 문제를 해결할 때 유용한지 구체화",
    evidenceRule: "직접 써봤다는 표현 없이 구조와 용도에서 이어지는 상황만 제시한다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 0, max: 1, intent: "두 번째 핵심 기능 상세 사진", placement: "after-lead" },
  },
  {
    id: "shopping-feature-3",
    title: "비슷한 제품과 갈리는 기준",
    purpose: "대안 제품과 비교할 항목과 이 제품이 우선되는 조건을 설명",
    evidenceRule: "경쟁 제품의 미확인 수치·순위는 쓰지 않고 비교 축만 제시한다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 0, max: 2, intent: "제품 원형을 보존한 연출컷 또는 원본 사용 장면", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-scale",
    title: "아쉬운 점과 구조상 한계",
    purpose: "제품 자체의 제약과 구매 전 검증할 성능을 설명",
    evidenceRule: "배송·쿠폰을 단점으로 대체하지 않고 구조상 제약과 미확인 성능을 구분한다.",
    headingStyle: "sectionTitle",
    minChars: 130,
    maxChars: 220,
    image: { min: 0, max: 1, intent: "크기 비교 또는 스펙 이미지", placement: "after-lead" },
  },
  {
    id: "shopping-pros-cautions",
    title: "추천 대상과 비추천 대상",
    purpose: "잘 맞는 사람과 다른 형태가 나은 사람을 동시에 제시",
    evidenceRule: "모든 사람에게 좋다는 단정 없이 사용 환경에 따라 적합도를 나눈다.",
    headingStyle: "quotation",
    minChars: 180,
    maxChars: 280,
    image: { min: 0, max: 1, intent: "옵션·주의사항·구성 비교 이미지", placement: "after-body" },
  },
  {
    id: "shopping-fit",
    title: "가격까지 놓고 판단하면",
    purpose: "가격과 구성을 제품 가치 및 대안 비교로 연결",
    evidenceRule: "제공된 가격만 쓰고 할인·배송은 최종 화면 재확인 항목으로 둔다.",
    headingStyle: "sectionTitle",
    minChars: 140,
    maxChars: 220,
    image: { min: 0, max: 1, intent: "추천 사용 장면", placement: "after-lead" },
  },
  {
    id: "shopping-verdict",
    title: "최종 리뷰와 선택 기준",
    purpose: "장점과 제약을 저울질해 명확한 조건부 결론을 제시",
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
    title: "이 여행의 한 줄 결론",
    purpose: "상품의 강점과 가장 큰 대가를 첫 화면에서 함께 제시",
    evidenceRule: "실제 방문 체험을 만들지 않고 상품 정보 기반 판단임을 유지한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "목적지를 대표하는 실사 풍경", placement: "before-body" },
  },
  {
    id: "travel-differentiators",
    title: "이 상품이 주는 여행 경험",
    purpose: "기간과 목적지를 여행 경험의 성격으로 해석",
    evidenceRule: "상품명과 상세 일정에서 확인된 차이만 사용한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "코스 성격을 보여주는 대표 풍경", placement: "after-lead" },
  },
  {
    id: "travel-highlights",
    title: "하이라이트가 만드는 코스의 매력",
    purpose: "핵심 방문지가 전체 코스에서 맡는 역할을 해석한다.",
    evidenceRule: "실제 상품 코스와 연결되는 장소 이미지만 사용한다.",
    headingStyle: "sectionTitle",
    minChars: 180,
    maxChars: 280,
    image: { min: 2, max: 3, intent: "서로 다른 핵심 방문지 2~3장", placement: "after-lead", layout: "collage-3" },
  },
  {
    id: "travel-basics",
    title: "전체 동선과 여행 강도",
    purpose: "넓게 보는 장점과 이동 부담을 같은 저울에 올린다.",
    evidenceRule: "날짜별 순서가 없으면 장소 목록만 사용하고 이동 강도는 조건형으로 표현한다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 380,
    image: { min: 1, max: 2, intent: "항공·교통 또는 일정 요약 이미지", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-lodging",
    title: "여행지 리뷰 1",
    purpose: "첫 번째 핵심 장소의 여행 가치와 감수할 점을 함께 설명",
    evidenceRule: "장소의 안정적인 정보와 상품에 표기된 방문 방식만 사용한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 2, intent: "숙소 또는 핵심 장소와 주변 동선 1~2장", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-route",
    title: "여행지 리뷰 2",
    purpose: "두 번째 핵심 장소가 코스에 주는 장면 변화와 대가를 설명",
    evidenceRule: "체류 시간과 운영 정보를 만들지 않고 상품 정보의 범위를 밝힌다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 400,
    image: { min: 0, max: 1, intent: "일정 요약 카드 또는 이동 동선 이미지", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-1",
    title: "여행지 리뷰 3",
    purpose: "세 번째 핵심 장소의 여행 가치와 이동 대비 체류 가치를 설명",
    evidenceRule: "확인된 방문지·활동만 쓰고 체류 시간을 만들지 않는다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 420,
    image: { min: 0, max: 2, intent: "첫 일정 구간의 실제 장소 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-2",
    title: "항공·숙박·식사가 좌우하는 만족도",
    purpose: "아직 확인되지 않은 기본 조건을 상품의 리스크로 명시",
    evidenceRule: "확인되지 않은 항공편·호텔명·식사를 추정하지 않는다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 420,
    image: { min: 0, max: 2, intent: "중심 일정의 실제 장소 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-3",
    title: "상품 구성에서 읽히는 장점",
    purpose: "패키지 자체의 구체적인 선택 이유를 근거와 함께 정리",
    evidenceRule: "일정·조건에서 직접 이어지는 장점만 쓰고 홍보 문구를 반복하지 않는다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 400,
    image: { min: 0, max: 2, intent: "후반 일정 또는 지역 분위기 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-inclusions",
    title: "아쉬운 점과 예약 리스크",
    purpose: "상품 자체의 단점과 정보 부족을 구분해 제시",
    evidenceRule: "이동·체력·자유시간의 대가와 미확인 조건을 구분한다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 380,
    image: { min: 0, max: 1, intent: "식사·교통·포함 조건을 설명하는 사진", placement: "after-body" },
  },
  {
    id: "travel-preparation",
    title: "추천 여행자와 비추천 여행자",
    purpose: "여행 스타일에 따라 적합도를 양쪽으로 판단",
    evidenceRule: "모든 여행자에게 좋다는 단정 없이 넓게 보기와 깊게 머물기의 차이를 밝힌다.",
    headingStyle: "sectionTitle",
    minChars: 220,
    maxChars: 340,
    image: { min: 0, max: 1, intent: "계절감·현지 이동이 드러나는 사진", placement: "after-lead" },
  },
  {
    id: "travel-fit",
    title: "가격과 포함 조건의 실제 의미",
    purpose: "표시가를 코스 가치와 추가 지출 관점에서 해석",
    evidenceRule: "명시된 포함 조건만 단정하고 변동 가격은 최신 화면을 기준으로 둔다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 0, max: 1, intent: "여행자와 목적지 분위기가 함께 보이는 사진", placement: "after-lead" },
  },
  {
    id: "travel-close",
    title: "최종 리뷰와 예약 판단",
    purpose: "강점과 제약을 저울질해 조건부 결론을 제시",
    evidenceRule: "취소·변경·출발 확정 조건은 예약 화면을 기준으로 안내한다.",
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

  const renderNodes: PostRenderNode[] = [
    {
      kind: "disclosure",
      disclosureType: "affiliate",
      placement: "top",
      text:
        options.connectKind === "TRAVEL"
          ? "이 글은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받을 수 있습니다."
          : "이 글은 네이버 쇼핑 커넥트 활동의 일환으로, 구매 발생 시 수수료를 제공받을 수 있습니다.",
    },
  ];
  if (experienceMode === "AI_ASSISTED_INFORMATION") {
    renderNodes.push({
      kind: "disclosure",
      disclosureType: "ai",
      placement: "top",
      text: "상품·여행 정보를 바탕으로 AI의 도움을 받아 정리한 정보형 초안이며, 실제 체험 후기는 아닙니다.",
    });
  }
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
    renderNodes.push(
      section.headingStyle === "quotation"
        ? { kind: "quotation", sectionId: section.id, text: section.title }
        : { kind: "heading", sectionId: section.id, text: section.title },
    );
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
  renderNodes.push({
    kind: "disclosure",
    disclosureType: "affiliate",
    placement: "bottom",
    text:
      clean(disclosureSection || "") ||
      (options.connectKind === "TRAVEL"
        ? "네이버 여행 커넥트 활동을 통해 수수료를 제공받을 수 있습니다."
        : "네이버 쇼핑 커넥트 활동을 통해 수수료를 제공받을 수 있습니다."),
  });
  renderNodes.push({ kind: "hashtags", values: options.hashtags });

  return {
    version: "resolved-post-document/v1",
    contractVersion: contract.version,
    connectKind: options.connectKind,
    qualityPreset,
    experienceMode,
    title: options.title,
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

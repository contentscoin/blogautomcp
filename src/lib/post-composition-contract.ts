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
  targetImages: { min: number; max: number };
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
    images: { min: number; max: number };
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
    title: "구매 전에 먼저 볼 기준",
    purpose: "독자의 문제와 결론을 첫 화면에서 제시",
    evidenceRule: "일반적인 선택 고민만 쓰고 직접 사용 경험은 만들지 않는다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 250,
    image: { min: 1, max: 1, intent: "제품이 한눈에 보이는 대표 사진", placement: "before-body" },
  },
  {
    id: "shopping-summary",
    title: "핵심 정보 한눈에 보기",
    purpose: "가격·구성·핵심 기능을 빠르게 요약",
    evidenceRule: "판매 페이지에서 확인된 사실과 수치만 사용한다.",
    headingStyle: "sectionTitle",
    minChars: 140,
    maxChars: 230,
    image: { min: 1, max: 1, intent: "전체 구성 또는 패키지 사진", placement: "after-lead" },
  },
  {
    id: "shopping-package",
    title: "구성과 패키지",
    purpose: "옵션과 구성품을 시각적으로 확인",
    evidenceRule: "사진 또는 상세 설명에서 확인되지 않은 구성품은 쓰지 않는다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 240,
    image: { min: 1, max: 2, intent: "구성품·패키지 원본 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-design",
    title: "디자인과 소재 디테일",
    purpose: "형태·마감·재질·크기감을 확인",
    evidenceRule: "이미지와 명시된 스펙으로 확인 가능한 표현만 사용한다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 1, max: 2, intent: "재질·마감·크기 디테일 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-feature-1",
    title: "핵심 기능 1",
    purpose: "가장 중요한 기능을 독자 효익으로 번역",
    evidenceRule: "확인된 기능에서 합리적으로 이어지는 조건형 효익만 쓴다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 1, max: 1, intent: "첫 번째 핵심 기능 상세 사진", placement: "after-lead" },
  },
  {
    id: "shopping-feature-2",
    title: "핵심 기능 2",
    purpose: "두 번째 기능과 차별점을 구체화",
    evidenceRule: "경쟁 제품과의 미확인 우열·순위는 쓰지 않는다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 1, max: 1, intent: "두 번째 핵심 기능 상세 사진", placement: "after-lead" },
  },
  {
    id: "shopping-feature-3",
    title: "사용 장면과 체감 포인트",
    purpose: "어떤 상황에서 유용한지 구체화",
    evidenceRule: "직접 써봤다는 표현 없이 적합한 상황을 조건형으로 설명한다.",
    headingStyle: "quotation",
    minChars: 170,
    maxChars: 260,
    image: { min: 1, max: 2, intent: "제품 원형을 보존한 연출컷 또는 원본 사용 장면", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "shopping-scale",
    title: "크기와 사용감 판단",
    purpose: "보관·휴대·설치에 필요한 크기감을 설명",
    evidenceRule: "스펙이 없으면 정확한 치수를 추정하지 않는다.",
    headingStyle: "sectionTitle",
    minChars: 130,
    maxChars: 220,
    image: { min: 1, max: 1, intent: "크기 비교 또는 스펙 이미지", placement: "after-lead" },
  },
  {
    id: "shopping-pros-cautions",
    title: "장점과 확인할 점",
    purpose: "장점과 구매 전 주의사항을 균형 있게 정리",
    evidenceRule: "배송·교환·재고 정책은 최종 판매 화면 확인 항목으로 표현한다.",
    headingStyle: "quotation",
    minChars: 180,
    maxChars: 280,
    image: { min: 1, max: 1, intent: "옵션·주의사항·구성 비교 이미지", placement: "after-body" },
  },
  {
    id: "shopping-fit",
    title: "이런 분께 잘 맞아요",
    purpose: "추천 대상을 체크리스트처럼 좁혀 제시",
    evidenceRule: "강매·최저가·품절 임박 문구를 사용하지 않는다.",
    headingStyle: "sectionTitle",
    minChars: 140,
    maxChars: 220,
    image: { min: 0, max: 1, intent: "추천 사용 장면", placement: "after-lead" },
  },
  {
    id: "shopping-verdict",
    title: "마지막 선택 기준",
    purpose: "독자의 조건에 맞는 최종 판단과 링크 확인으로 연결",
    evidenceRule: "결제 전 최신 옵션·가격·배송 조건 재확인을 안내한다.",
    headingStyle: "quotation",
    minChars: 150,
    maxChars: 240,
    image: { min: 0, max: 1, intent: "제품 대표 원본 사진 재노출", placement: "after-lead" },
  },
];

const travelSections: PostSectionContractV1[] = [
  {
    id: "travel-hook",
    title: "이 여행, 누구에게 맞을까",
    purpose: "독자의 고민과 코스 결론을 첫 화면에서 제시",
    evidenceRule: "실제 방문 체험을 만들지 않고 상품 정보 기반 판단임을 유지한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "목적지를 대표하는 실사 풍경", placement: "before-body" },
  },
  {
    id: "travel-differentiators",
    title: "이 상품의 핵심 차이",
    purpose: "기간·동선·여행 성격을 비교 가능한 언어로 정리",
    evidenceRule: "상품명과 상세 일정에서 확인된 차이만 사용한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "코스 성격을 보여주는 대표 풍경", placement: "after-lead" },
  },
  {
    id: "travel-highlights",
    title: "사진으로 먼저 보는 하이라이트",
    purpose: "핵심 방문지를 세 장의 흐름으로 보여준다.",
    evidenceRule: "실제 상품 코스와 연결되는 장소 이미지만 사용한다.",
    headingStyle: "sectionTitle",
    minChars: 180,
    maxChars: 280,
    image: { min: 3, max: 3, intent: "서로 다른 핵심 방문지 3장", placement: "after-lead", layout: "collage-3" },
  },
  {
    id: "travel-basics",
    title: "항공·기간·숙박·식사",
    purpose: "예약 판단에 필요한 기본 조건을 묶어서 제시",
    evidenceRule: "확인되지 않은 항공편·호텔명·식사를 추정하지 않는다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 380,
    image: { min: 1, max: 2, intent: "항공·교통 또는 일정 요약 이미지", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-lodging",
    title: "숙소에서 확인할 포인트",
    purpose: "위치·연박·객실 조건이 일정에 미치는 영향을 설명",
    evidenceRule: "확정 숙소 정보가 없으면 선택 기준만 제공한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 2, max: 2, intent: "숙소 외관과 객실 또는 주변 동선 2장", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-route",
    title: "전체 동선 한눈에 보기",
    purpose: "도시와 방문지의 순서를 이동 강도 관점에서 정리",
    evidenceRule: "날짜별 데이터가 없으면 확인된 코스 포인트 순서만 사용한다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 400,
    image: { min: 1, max: 2, intent: "일정 요약 카드 또는 이동 동선 이미지", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-1",
    title: "코스 1 · 첫 장면",
    purpose: "첫 번째 일정 구간을 정보와 장면으로 설명",
    evidenceRule: "확인된 방문지·활동만 쓰고 체류 시간을 만들지 않는다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 420,
    image: { min: 1, max: 2, intent: "첫 일정 구간의 실제 장소 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-2",
    title: "코스 2 · 여행의 중심",
    purpose: "중심 일정의 볼거리와 사전 정보를 설명",
    evidenceRule: "운영시간 등 변동 정보는 공식 페이지 재확인을 안내한다.",
    headingStyle: "quotation",
    minChars: 260,
    maxChars: 420,
    image: { min: 1, max: 2, intent: "중심 일정의 실제 장소 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-day-3",
    title: "코스 3 · 놓치기 쉬운 포인트",
    purpose: "후반 일정과 놓치기 쉬운 준비 정보를 설명",
    evidenceRule: "확인된 코스가 부족하면 별도 날짜를 만들지 않고 준비 정보로 대체한다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 400,
    image: { min: 1, max: 2, intent: "후반 일정 또는 지역 분위기 사진", placement: "after-lead", layout: "sequence" },
  },
  {
    id: "travel-inclusions",
    title: "포함·불포함과 추가 비용",
    purpose: "표시가보다 실제 예상 지출을 판단하게 한다.",
    evidenceRule: "명시된 포함 조건만 단정하고 나머지는 확인 항목으로 쓴다.",
    headingStyle: "quotation",
    minChars: 240,
    maxChars: 380,
    image: { min: 1, max: 1, intent: "식사·교통·포함 조건을 설명하는 사진", placement: "after-body" },
  },
  {
    id: "travel-preparation",
    title: "날씨·교통·준비물",
    purpose: "출발 전 실용 정보를 빠짐없이 점검",
    evidenceRule: "날씨와 운영 정보는 출발일 기준 최신 정보 확인을 안내한다.",
    headingStyle: "sectionTitle",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "계절감·현지 이동이 드러나는 사진", placement: "after-lead" },
  },
  {
    id: "travel-fit",
    title: "이런 여행자에게 잘 맞아요",
    purpose: "동행·체력·자유시간 선호에 따라 적합도를 판단",
    evidenceRule: "모든 사람에게 좋다는 단정 대신 조건별 적합도를 제시한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "여행자와 목적지 분위기가 함께 보이는 사진", placement: "after-lead" },
  },
  {
    id: "travel-close",
    title: "예약 전 마지막 체크",
    purpose: "최신 일정과 조건 확인 후 레퍼럴 카드로 연결",
    evidenceRule: "취소·변경·출발 확정 조건은 예약 화면을 기준으로 안내한다.",
    headingStyle: "quotation",
    minChars: 220,
    maxChars: 340,
    image: { min: 1, max: 1, intent: "여행의 여운을 남기는 마지막 풍경", placement: "after-lead" },
  },
];

export const SHOPPING_POST_CONTRACT_V1: PostCompositionContractV1 = {
  version: "post-composition-contract/v1",
  connectKind: "SHOPPING",
  targetCharacters: { min: 1800, max: 2600 },
  targetImages: { min: 10, max: 14 },
  targetSections: { min: 9, max: 12 },
  earlyConnectAfterSectionId: "shopping-summary",
  finalConnectBeforeDisclosure: true,
  sections: shoppingSections,
};

export const TRAVEL_POST_CONTRACT_V1: PostCompositionContractV1 = {
  version: "post-composition-contract/v1",
  connectKind: "TRAVEL",
  targetCharacters: { min: 3200, max: 4800 },
  targetImages: { min: 18, max: 26 },
  targetSections: { min: 10, max: 14 },
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
  return allocations;
}

function buildQualityReport(options: {
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
  const register = (ok: boolean, message: string) => {
    if (ok) return;
    (options.preset === "PREMIUM" ? blockers : warnings).push(message);
  };
  register(actual.characters >= target.characters.min, `본문이 ${target.characters.min}자보다 짧습니다 (${actual.characters}자).`);
  register(actual.sections >= target.sections.min, `본문 섹션이 ${target.sections.min}개보다 적습니다 (${actual.sections}개).`);
  register(actual.images >= target.images.min, `이미지가 ${target.images.min}장보다 적습니다 (${actual.images}장).`);
  if (actual.characters > target.characters.max) warnings.push(`본문이 권장 최대 ${target.characters.max}자를 넘었습니다.`);
  if (actual.images > target.images.max) warnings.push(`이미지가 권장 최대 ${target.images.max}장을 넘었습니다.`);
  const deductions = blockers.length * 22 + warnings.length * 6;
  return {
    preset: options.preset,
    canAutoPublish: blockers.length === 0,
    score: Math.max(0, 100 - deductions),
    actual,
    target,
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
    qualityReport: buildQualityReport({
      contract,
      preset: qualityPreset,
      sections,
      imageCount: options.imagePaths.length,
    }),
  };
}

export function formatPostContractForPrompt(contract: PostCompositionContractV1): string {
  return [
    `[고정 포스트 계약 ${contract.version}]`,
    `- 섹션 ${contract.targetSections.min}~${contract.targetSections.max}개`,
    `- 본문 ${contract.targetCharacters.min}~${contract.targetCharacters.max}자`,
    `- 이미지 ${contract.targetImages.min}~${contract.targetImages.max}장`,
    "- 아래 id와 순서를 그대로 유지하고, 구조나 이미지 위치를 임의로 바꾸지 마세요.",
    ...contract.sections.map(
      (section, index) =>
        `${index + 1}. id=${section.id} | 제목=${section.title} | 목적=${section.purpose} | 근거=${section.evidenceRule} | ${section.minChars}~${section.maxChars}자 | 이미지=${section.image.intent}`,
    ),
  ].join("\n");
}

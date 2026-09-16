import { assessRepetition } from "./draft-quality-signals";
import { explicitProductFunctionKey, isUnusableProductFactValue, normalizeTypedProductFact, PRODUCT_MEASUREMENT_PATTERN } from "./product-source-facts";

export type ProductEditorialRole =
  | "review-hook"
  | "product-identity"
  | "source-evidence"
  | "review-evidence"
  | "primary-strength"
  | "secondary-strength"
  | "use-case"
  | "comparison"
  | "limitations"
  | "fit"
  | "offer"
  | "verdict";

export type ProductReviewCategory =
  | "fan"
  | "cooler-bag"
  | "seat-cushion"
  | "hair-care"
  | "food"
  | "generic";

export interface ProductEditorialPlanInput {
  productName: string;
  description?: string | null;
  features?: string[];
  price?: string | null;
  originalPrice?: string | null;
  discountRate?: string | null;
  couponInfo?: string | null;
  deliveryInfo?: string | null;
  reviewCount?: string | null;
  rating?: string | null;
  targetSectionCount: number;
}

export interface ProductReviewAngle {
  key: string;
  label: string;
  evidence: string[];
  readerImpact: string[];
  appliesWhen: string[];
  verificationNeeds: string[];
}

export interface ProductReviewAnalysis {
  category: ProductReviewCategory;
  categoryLabel: string;
  primaryUse: string;
  verifiedSignals: string[];
  reviewEvidence: string[];
  strengths: ProductReviewAngle[];
  limitations: ProductReviewAngle[];
  bestFor: string[];
  notFor: string[];
  comparisonAxes: string[];
  decisionCriteria: string[];
  unresolvedFacts: string[];
  evidenceLevel: "rich" | "usable" | "sparse";
  forbiddenCategoryTerms: string[];
}

export interface ProductEditorialSection {
  role: ProductEditorialRole;
  title: string;
  purpose: string;
  evidenceRule: string;
  imageRole: string;
}

export interface ProductEditorialPlan {
  framework: "source-backed-product-review-v3";
  verifiedFactLines: string[];
  blockedClaimRules: string[];
  reviewAnalysis: ProductReviewAnalysis;
  sections: ProductEditorialSection[];
}

export interface ProductReviewSubstanceAssessment {
  pass: boolean;
  missingElements: string[];
  genericGuidanceCount: number;
  sentenceCount: number;
  repeatedSentenceCount: number;
  coveredSignals: string[];
  requiredSignalCount: number;
  evidenceJudgementCount: number;
  requiredEvidenceJudgementCount: number;
  categoryMismatchTerms: string[];
  usageInstructionCount: number;
  detailReadingCount: number;
  coveredReviewEvidence: string[];
  /** false면 확인 가능한 텍스트 신호가 없어 근거 항목을 요구하지 않은 것. */
  signalEvidenceAvailable: boolean;
  /** 원고가 아니라 저장된 상품 출처에서 계산한 근거 수준. */
  sourceEvidenceLevel: ProductReviewAnalysis["evidenceLevel"];
  /** 서로 다른 상품 근거가 실제 판단 문장에 연결된 개수. */
  groundedSignalCount: number;
  requiredGroundedSignalCount: number;
}

const SECTION_LIBRARY: ProductEditorialSection[] = [
  {
    role: "review-hook",
    title: "먼저 내린 한 줄 결론",
    purpose: "제품의 정체, 가장 큰 장점, 가장 큰 제약을 첫 화면에서 함께 제시",
    evidenceRule: "상품명과 상세정보에서 확인되는 구조를 근거로 조건부 결론을 내린다.",
    imageRole: "제품의 형태와 사용 방식을 한눈에 보여주는 대표 이미지",
  },
  {
    role: "product-identity",
    title: "어떤 제품인지부터 보면",
    purpose: "제품 카테고리와 핵심 구조, 일반 제품과 갈리는 지점을 설명",
    evidenceRule: "상품명·설명·판매페이지에서 확인된 용도와 구조만 사용한다.",
    imageRole: "전체 형태 또는 설치·사용 방식이 보이는 이미지",
  },
  {
    role: "source-evidence",
    title: "핵심 기능이 실제로 만드는 차이",
    purpose: "기능·구조·수치를 나열하지 않고 작동 방식과 사용자 이점으로 번역",
    evidenceRule: "확인된 기능 → 작동 원리 또는 구조 → 실제로 줄여주는 불편을 연결한다.",
    imageRole: "기능이 작동하는 방식과 사용 결과를 이해할 수 있는 원본 이미지",
  },
  {
    role: "primary-strength",
    title: "가장 분명한 장점",
    purpose: "핵심 기능이 실제 사용 장면에서 주는 이점을 구체적으로 해석",
    evidenceRule: "확인된 기능에서 직접 이어지는 효익만 쓰고 성능을 과장하지 않는다.",
    imageRole: "첫 번째 핵심 기능 또는 대표 사용 장면 이미지",
  },
  {
    role: "secondary-strength",
    title: "두 번째로 눈에 띄는 강점",
    purpose: "보조 기능이나 형태상의 이점을 별도 사용 장면으로 설명",
    evidenceRule: "첫 장점과 같은 말을 반복하지 않고 다른 선택 이유를 제시한다.",
    imageRole: "두 번째 기능 또는 디테일을 보여주는 이미지",
  },
  {
    role: "use-case",
    title: "어디에서 어떻게 쓰면 좋은지",
    purpose: "설치·조작·충전·세척·보관을 포함해 사용 순서와 활용 장면을 구체화",
    evidenceRule: "직접 써봤다는 표현 없이 구조와 용도에서 이어지는 상황만 제시한다.",
    imageRole: "제품 원형을 보존한 실제 사용 장면 또는 원본 연출 이미지",
  },
  {
    role: "review-evidence",
    title: "구매후기에서 반복된 좋은 점",
    purpose: "실제 후기 원문이 수집된 경우에만 반복되는 장점과 사용 맥락을 요약",
    evidenceRule: "후기 수·평점만으로 만족도를 만들지 않고, 수집된 후기 문장에 있는 내용만 사용한다.",
    imageRole: "후기에서 언급된 사용 장면과 연결되는 제품 원본 이미지",
  },
  {
    role: "comparison",
    title: "비슷한 제품과 갈리는 기준",
    purpose: "대안 제품과 비교할 항목 및 이 제품이 우선되는 조건을 설명",
    evidenceRule: "경쟁 제품의 미확인 수치나 순위를 만들지 않고 비교 축만 제시한다.",
    imageRole: "형태·옵션·크기 차이를 비교할 수 있는 이미지",
  },
  {
    role: "limitations",
    title: "아쉬운 점과 구조상 한계",
    purpose: "배송·쿠폰이 아닌 제품 자체의 제약과 구매 전 검증할 성능을 설명",
    evidenceRule: "확정된 단점과 구조상 예상되는 제약을 구분하고 미확인 성능은 단정하지 않는다.",
    imageRole: "설치, 크기, 충전, 관리 등 제약을 판단할 수 있는 상세 이미지",
  },
  {
    role: "fit",
    title: "추천 대상과 비추천 대상",
    purpose: "잘 맞는 사람과 다른 형태가 나은 사람을 동시에 좁혀 제시",
    evidenceRule: "모든 사람에게 좋다는 표현 없이 사용 환경에 따라 적합도를 나눈다.",
    imageRole: "추천 사용 환경을 보여주는 이미지",
  },
  {
    role: "offer",
    title: "가격까지 놓고 판단하면",
    purpose: "가격·구성·혜택을 제품 가치와 연결해 해석",
    evidenceRule: "제공된 가격만 쓰고 할인·배송은 최종 결제 화면 재확인 항목으로 둔다.",
    imageRole: "옵션 또는 구성 확인 이미지",
  },
  {
    role: "verdict",
    title: "최종 리뷰와 선택 기준",
    purpose: "장점과 제약을 다시 저울질해 명확한 조건부 결론 제시",
    evidenceRule: "강매·최저가·품절 임박 표현 없이 어떤 조건에서 추천하는지 끝맺는다.",
    imageRole: "제품 대표 원본 이미지 재노출 또는 이미지 없음",
  },
];

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean))).slice(0, limit);
}

function meaningfulDescription(value: string | null | undefined, productName: string): string {
  const normalized = clean(value);
  if (normalized.length < 12) return "";
  if (/^(?:www\.)?[\w.-]+\.(?:com|co\.kr|kr)$/iu.test(normalized)) return "";
  if (normalized === clean(productName)) return "";
  if (/(?:스마트스토어|공식스토어|공식몰).{0,24}(?:생활|주방|가전|전문|브랜드)/u.test(normalized)) return "";
  return normalized.slice(0, 180);
}

const SEO_ONLY_FEATURE_PATTERN = /^(?:휴대|가정|거실|캠핑|탁상|충전|저소음|무선|유선|여름|생활|주방|미니)?(?:용)?(?:선풍기|서큘레이터|써큘레이터|가전|추천|제품|상품|핫딜)$/u;

const NON_SUBSTANTIVE_FACT_LINE = /^(?:상품명|제품명|품명|모델명|브랜드|제조자|제조사|판매자|스토어|설명|가격|원가|할인율|쿠폰\s*\/\s*혜택|배송|리뷰\s*수|평점|인증사항|상세페이지\s*참조)\s*[:：]/u;
const SUBSTANTIVE_FACT_LINE = /^상세\s*근거\s*[:：]\s*/u;

/** Commerce and crawler metadata can contain convincing-looking numbers, but
 * none of it proves how the product is built or works. Keep it out before both
 * generation-time evidence grading and saved-draft revalidation. */
function isNonSubstantiveProductMetadata(value: string): boolean {
  const normalized = clean(value).normalize("NFKC");
  if (!normalized) return true;
  return (
    /^(?:[\d,.]+\s*원)(?:\s*(?:부터|대|정도))?$/u.test(normalized) ||
    /^(?:가격|판매가|정가|원가|할인가|최저가|특가|세일가|쿠폰가|혜택가|적립금|배송비)(?:\s|[:：]|$)/u.test(normalized) ||
    /^(?:할인|쿠폰|적립|혜택|특가|세일|무료배송|오늘출발)(?:\s|[:：]|$).*(?:\d|원|%)/u.test(normalized) ||
    /^(?:리뷰|후기)\s*(?:수|개수)?\s*[:：]?\s*[\d,.]+\s*(?:개|건)?$/u.test(normalized) ||
    /^(?:평점|별점)\s*[:：]?\s*[\d.]+(?:\s*\/\s*5)?$/u.test(normalized) ||
    /^(?:(?:상세|상품|대표|원본|생성)\s*)?(?:이미지|사진|썸네일|컷)\s*[:：]?\s*[\d,.]+\s*(?:개|장|컷)?$/u.test(normalized) ||
    /^[\d,.]+\s*(?:개|장|컷)\s*(?:이미지|사진|썸네일|컷)$/u.test(normalized)
  );
}

/**
 * 생성 시 쓰는 `라벨: 값` 사실 줄과 재검사 시 쓰는 원본 feature를 같은
 * 상품 근거로 정규화한다. 상품명·가격·쿠폰 같은 거래 메타데이터는 글에
 * 사용할 수 있지만 제품의 기능·구조를 입증하지는 않는다.
 */
export function normalizeProductSubstanceFeatures(values: string[] | undefined): string[] {
  return unique((values || []).flatMap((value) => {
    const normalized = clean(value);
    if (!normalized || isReviewEvidenceFeature(normalized) || NON_SUBSTANTIVE_FACT_LINE.test(normalized) ||
        isNonSubstantiveProductMetadata(normalized)) return [];
    const fact = normalized.replace(SUBSTANTIVE_FACT_LINE, "");
    if (isUnusableProductFactValue(fact)) return [];
    return [normalizeTypedProductFact(fact) || fact];
  }), 12);
}

export function isMeaningfulProductEvidenceFeature(value: string): boolean {
  const normalized = clean(value);
  if (normalized.length < 4 || normalized.length > 220) return false;
  if (isUnusableProductFactValue(normalized)) return false;
  if (isNonSubstantiveProductMetadata(normalized)) return false;
  if (SEO_ONLY_FEATURE_PATTERN.test(normalized.replace(/\s+/gu, ""))) return false;
  if (/^(?:추천|인기|베스트|신상품|핫딜|특가|무료배송|오늘출발)$/u.test(normalized)) return false;

  const hasMeasurement = PRODUCT_MEASUREMENT_PATTERN.test(normalized);
  const hasSpecificationRelation = /(?:최대|약|기준|사용시간|충전시간|소비전력|크기|무게|사이즈|구성품|구성|헤드|트리머|인디케이터|잠금|회전|각도|풍속|풍량|배터리|리모컨|방수|소재|모드|단계|분리|접이식|칸막이|손잡이|변환|호환|보증)/u.test(normalized);
  const hasTypedPair = Boolean(normalizeTypedProductFact(normalized));
  return hasMeasurement || hasSpecificationRelation || hasTypedPair;
}

function isProductNameFragment(value: string, productName: string): boolean {
  const nameKey = evidenceFeatureKey(productName);
  const featureKey = evidenceFeatureKey(value.replace(SUBSTANTIVE_FACT_LINE, ""));
  if (!nameKey || !featureKey) return false;
  const tokens = featureKey.split(" ").filter(Boolean);
  const nameTokens = new Set(nameKey.split(" ").filter(Boolean));
  return nameKey === featureKey || nameKey.includes(featureKey) ||
    (tokens.length > 0 && tokens.every((token) => nameTokens.has(token)));
}

function evidenceFeatureKey(value: string): string {
  return clean(value).normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function meaningfulFeatures(values: string[] | undefined, productName = ""): string[] {
  return unique(normalizeProductSubstanceFeatures(values)
    .filter(isMeaningfulProductEvidenceFeature)
    .filter((value) => !productName || !isProductNameFragment(value, productName)), 12);
}

function semanticallyUniqueSignals(values: string[], limit = 12): string[] {
  const output: string[] = [];
  const keys: string[] = [];
  for (const value of values.map(clean).filter(Boolean)) {
    const key = value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || keys.some((existing) => existing.includes(key) || key.includes(existing))) continue;
    output.push(value);
    keys.push(key);
    if (output.length >= limit) break;
  }
  return output;
}

function isReviewEvidenceFeature(value: string): boolean {
  return /^구매후기\s*근거\s*:/u.test(clean(value));
}

function reviewEvidenceFeatures(values: string[] | undefined): string[] {
  return unique((values || [])
    .filter(isReviewEvidenceFeature)
    .map((value) => clean(value).replace(/^구매후기\s*근거\s*:\s*/u, "")), 6);
}

function isFoodProductName(name: string): boolean {
  // Cooking appliances and storage containers can mention food in their use cases.
  if (/(?:에어프라이어|오븐|그릴|냄비|프라이팬|보관함|용기|도마|청소기|가습기|건조기)/u.test(name)) return false;
  return /(?:갈비살|소갈비|갈비|소곱창|곱창|막창|대창|소고기|돼지고기|닭고기|김치|밀키트|볶음밥|냉동만두)/u.test(name);
}

function detectCategory(source: string, productName: string): ProductReviewCategory {
  if (/(?:보냉백|쿨러백|아이스박스|소프트\s*쿨러|냉장\s*가방)/u.test(source)) return "cooler-bag";
  if (/(?:선풍기|써큘레이터|서큘레이터|실링\s*팬|실링팬|파우치팬|손풍기)/u.test(source)) return "fan";
  if (/(?:꼬리뼈|치질|자세교정|방석|좌식\s*쿠션|의자\s*쿠션)/u.test(source)) return "seat-cushion";
  if (/(?:드라이기|헤어\s*드라이어|고데기|스타일러)/u.test(source)) return "hair-care";
  if (isFoodProductName(productName)) return "food";
  return "generic";
}

function collectSignals(source: string, category: ProductReviewCategory): string[] {
  if (category === "food") {
    // Preserve the words actually supplied by the seller instead of manufacturing
    // appliance-style labels such as "캠핑 사용 맥락" that the prose cannot match.
    const patterns = [
      /\d[\d,.]*\s*(?:kg|g)(?![a-z])/iu,
      /(?:소갈비살|갈비살|소갈비|LA\s*갈비|la\s*갈비|소곱창|곱창|막창|대창|소고기|돼지고기|닭고기|김치|밀키트|볶음밥|냉동만두)/u,
      /(?:양념|초벌|비양념|무양념)/u,
      /(?:냉동|냉장|실온)/u,
      /(?:캠핑|구이|찜|탕|볶음)/u,
    ];
    return unique(patterns.flatMap((pattern) => source.match(pattern)?.[0] || []), 8);
  }
  const rules: Array<[RegExp, string]> = [
    [/무선/u, "무선 방식"],
    [/(?:타프|천장)/u, "타프·상부 설치 용도"],
    [/(?:실링\s*팬|실링팬)/u, "실링 팬 구조"],
    [/캠핑/u, "캠핑 사용 맥락"],
    [/(?:자동\s*회전|회전형)/u, "회전 기능"],
    [/클립/u, "클립 고정 방식"],
    [/미스트/u, "미스트 기능"],
    [/(?:넥밴드|목걸이)/u, "목걸이형 착용 방식"],
    [/(?:휴대용|미니|손풍기)/u, "휴대형 설계"],
    [/(?:접이식|폴딩)/u, "접이식 구조"],
    [/(?:보냉|쿨러|아이스)/u, "보냉 용도"],
    [/(?:어깨끈|숄더)/u, "어깨끈 휴대 방식"],
    [/(?:세탁|분리형\s*커버)/u, "분리·관리 구조"],
    [/(?:메모리폼|젤\s*쿠션)/u, "쿠션 소재"],
  ];
  const signals = rules.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
  return unique(signals, 10);
}

function isVerifiableProductDescription(description: string, category: ProductReviewCategory): boolean {
  if (!description) return false;
  if (isMeaningfulProductEvidenceFeature(description)) return true;
  if (collectSignals(description, category).length > 0) return true;
  return /(?:충전식|분리형|접이식|회전형|유무선|냉온풍|자동\s*센서|BLDC|올스텐|로티세리)|(?:밝기|세기|온도|속도|풍량|풍속|각도|높이|길이).{0,12}(?:조절|설정|선택|변경)|(?:모터|센서|필터|브러시|헤드|트레이|칸막이|손잡이|커버|탱크|배터리|리모컨).{0,20}(?:탑재|내장|포함|구성|분리|교체|고정|사용|적용)|(?:가열|살균|건조|세척|흡입|회전|잠금).{0,12}(?:기능|방식|지원|가능)/iu.test(description);
}

function angle(input: ProductReviewAngle): ProductReviewAngle {
  return {
    key: clean(input.key),
    label: clean(input.label),
    evidence: unique(input.evidence, 6),
    readerImpact: unique(input.readerImpact, 6),
    appliesWhen: unique(input.appliesWhen, 6),
    verificationNeeds: unique(input.verificationNeeds, 6),
  };
}

function uniqueAngles(values: ProductReviewAngle[], limit = 6): ProductReviewAngle[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalizedKey = clean(value.key).replace(/[^\p{L}\p{N}]/gu, "");
    if (!normalizedKey || seen.has(normalizedKey)) return false;
    seen.add(normalizedKey);
    return true;
  }).slice(0, limit);
}

function fanAnalysis(source: string, signals: string[]): Omit<ProductReviewAnalysis, "evidenceLevel" | "reviewEvidence"> {
  const mounted = /(?:타프|천장|실링\s*팬|실링팬)/u.test(source);
  const wireless = /무선/u.test(source);
  const clip = /클립/u.test(source);
  const oscillating = /(?:자동\s*회전|회전형)/u.test(source);
  const mist = /미스트/u.test(source);
  const strengths: ProductReviewAngle[] = [];
  const limitations: ProductReviewAngle[] = [];

  if (mounted) {
    strengths.push(angle({
      key: "upper-space-placement",
      label: "상부 공간 활용",
      evidence: ["타프·실링 팬 표기"],
      readerImpact: ["바닥·테이블 점유 감소", "상부 중심 공기 순환"],
      appliesWhen: ["타프·천장 고정 지점 확보"],
      verificationNeeds: ["걸이 방식", "허용 하중", "설치 높이"],
    }));
    limitations.push(angle({
      key: "mount-compatibility",
      label: "설치 호환성 의존",
      evidence: ["타프·실링 팬 구조"],
      readerImpact: ["고정 지점 부재 시 핵심 효익 상실"],
      appliesWhen: ["상부 설치 환경"],
      verificationNeeds: ["고정부 규격", "허용 하중", "안전 고정 방식"],
    }));
  }
  if (wireless) {
    strengths.push(angle({
      key: "wireless-placement",
      label: "전원선 없는 배치 자유도",
      evidence: ["무선 표기"],
      readerImpact: ["야외·텐트 배치 제약 감소"],
      appliesWhen: ["콘센트 접근이 어려운 공간"],
      verificationNeeds: ["배터리 지속시간", "충전시간", "충전 단자"],
    }));
    limitations.push(angle({
      key: "battery-runtime",
      label: "연속 사용시간 제약",
      evidence: ["무선 방식"],
      readerImpact: ["사용 중 충전 가능성", "장시간 운전 제약"],
      appliesWhen: ["장시간 야외 사용"],
      verificationNeeds: ["풍량별 배터리 지속시간", "충전 중 사용 가능 여부"],
    }));
  }
  if (clip) {
    strengths.push(angle({
      key: "clip-placement",
      label: "클립 고정형 공간 활용",
      evidence: ["클립형 표기"],
      readerImpact: ["좁은 공간 설치", "프레임·선반 활용"],
      appliesWhen: ["클립 체결 가능한 구조"],
      verificationNeeds: ["체결 가능 두께", "클립 고정력"],
    }));
    limitations.push(angle({
      key: "clip-fit",
      label: "체결 규격 의존",
      evidence: ["클립 고정 구조"],
      readerImpact: ["두께 불일치 시 설치 불안정"],
      appliesWhen: ["곡면·두꺼운 프레임"],
      verificationNeeds: ["최대 체결 두께", "미끄럼 방지 구조"],
    }));
  }
  if (oscillating) strengths.push(angle({
    key: "oscillation",
    label: "바람 범위 분산",
    evidence: ["자동회전 표기"],
    readerImpact: ["한 방향 집중 완화", "복수 사용자 커버"],
    appliesWhen: ["넓은 좌석·텐트 공간"],
    verificationNeeds: ["회전 각도", "회전 모드"],
  }));
  if (mist) {
    strengths.push(angle({
      key: "mist-cooling",
      label: "미스트 결합 냉감",
      evidence: ["미스트 기능 표기"],
      readerImpact: ["건조한 야외의 체감 냉각 보조"],
      appliesWhen: ["물 사용 가능한 환경"],
      verificationNeeds: ["물통 용량", "분사 단계"],
    }));
    limitations.push(angle({
      key: "mist-maintenance",
      label: "급수·세척 관리 부담",
      evidence: ["미스트 구조"],
      readerImpact: ["급수 빈도", "물때·위생 관리"],
      appliesWhen: ["미스트 상시 사용"],
      verificationNeeds: ["물통 분리 방식", "세척 방법", "누수 방지"],
    }));
  }
  if (strengths.length === 0) strengths.push(angle({
    key: "air-circulation",
    label: "직접 공기 순환",
    evidence: ["선풍기 카테고리"],
    readerImpact: ["사용 지점의 바람 확보"],
    appliesWhen: ["국소 공기 순환 필요"],
    verificationNeeds: ["풍량 단계", "바람 도달 범위"],
  }));
  if (limitations.length < 2) limitations.push(angle({
    key: "unverified-core-performance",
    label: "핵심 성능 근거 부족",
    evidence: ["풍량·소음·소비전력 수치 미확인"],
    readerImpact: ["강풍·저소음 판단 보류"],
    appliesWhen: ["성능 우선 구매"],
    verificationNeeds: ["풍량 단계", "소음 수치", "소비전력"],
  }));

  return {
    category: "fan",
    categoryLabel: mounted ? "캠핑용 실링 팬" : "선풍기",
    primaryUse: mounted ? "타프·천장 상부 설치형 공기 순환" : "사용 지점 중심 공기 순환",
    verifiedSignals: signals,
    strengths: strengths.slice(0, 4),
    limitations: uniqueAngles(limitations, 4),
    bestFor: [mounted ? "타프·텐트 상부 공간 활용 사용자" : "이동식 배치가 필요한 사용자", wireless ? "콘센트 접근이 어려운 야외 사용자" : "고정 전원 사용 환경"],
    notFor: [mounted ? "상부 고정 지점이 없는 환경" : "강한 직진풍만 필요한 환경", "확인된 풍량·소음 수치를 최우선으로 보는 사용자"],
    comparisonAxes: unique([mounted ? "걸이 방식과 허용 하중" : "받침과 고정 방식", "풍량 단계", "소음", wireless ? "배터리 지속시간과 충전 방식" : "전원선 길이", "무게와 보관 부피"], 6),
    decisionCriteria: [mounted ? "설치 호환성 대 공간 절약" : "배치 자유도 대 고정 안정성", wireless ? "배터리 지속시간 대 무선 편의" : "풍량·소음 대 소비전력"],
    unresolvedFacts: unique(limitations.flatMap((item) => item.verificationNeeds), 8),
    forbiddenCategoryTerms: ["보냉백", "어깨끈", "식재료", "음료를 넣"],
  };
}

function coolerBagAnalysis(source: string, signals: string[]): Omit<ProductReviewAnalysis, "evidenceLevel" | "reviewEvidence"> {
  const foldable = /(?:접이식|폴딩|소프트)/u.test(source);
  const shoulder = /(?:어깨끈|숄더)/u.test(source);
  return {
    category: "cooler-bag",
    categoryLabel: "보냉 가방",
    primaryUse: "식품·음료 이동 중 온도 변화 지연",
    verifiedSignals: signals,
    strengths: [
      angle({ key: "portable-cold-storage", label: "이동형 보냉 수납", evidence: ["보냉 가방 표기"], readerImpact: ["식품·음료 일괄 이동", "온도 변화 지연"], appliesWhen: ["장보기·피크닉·캠핑"], verificationNeeds: ["실사용 용량", "보냉 지속시간"] }),
      angle({ key: "soft-storage", label: foldable ? "접이식 보관" : "가방형 휴대", evidence: [foldable ? "접이식·소프트 표기" : "가방형 카테고리"], readerImpact: [foldable ? "미사용 시 보관 부피 감소" : "하드 쿨러 대비 이동 편의"], appliesWhen: ["차량·가정 보관 공간 제한"], verificationNeeds: ["접었을 때 크기", "자립 여부"] }),
      ...(shoulder ? [angle({ key: "shoulder-carry", label: "어깨 휴대", evidence: ["어깨끈 표기"], readerImpact: ["양손 사용 여유"], appliesWhen: ["복수 짐 동시 이동"], verificationNeeds: ["끈 길이", "패드", "허용 하중"] })] : []),
    ],
    limitations: [
      angle({ key: "container-fit", label: "용기 규격 호환성", evidence: ["가방형 수납 구조"], readerImpact: ["입구·내부 크기 불일치 가능성"], appliesWhen: ["도시락·대형 용기 수납"], verificationNeeds: ["내부 치수", "입구 폭", "실사용 용량"] }),
      angle({ key: "cold-leak-proof", label: "보냉·누수 성능 미확인", evidence: ["시험값·소재 정보 부족"], readerImpact: ["장시간 보냉 판단 보류", "누수 위험 판단 보류"], appliesWhen: ["장거리 이동·얼음 사용"], verificationNeeds: ["단열재", "보냉 지속시간", "봉제·지퍼 누수 구조"] }),
    ],
    bestFor: ["피크닉·장보기 이동형 보냉 사용자", foldable ? "보관 부피 최소화 사용자" : "가방형 쿨러 선호 사용자"],
    notFor: ["장시간 냉장 수준 유지 목적", "외부 충격 보호·의자 대용 목적"],
    comparisonAxes: ["실사용 용량", "단열재와 보냉 지속시간", "누수 방지", "손잡이·어깨끈", "세척 방식"],
    decisionCriteria: ["이동 편의 대 장시간 보냉", "수납 부피 대 외형 보호"],
    unresolvedFacts: ["내부 치수", "단열재", "보냉 지속시간", "누수 방지", "세척 방식"],
    forbiddenCategoryTerms: ["풍량", "바람 단계", "실링 팬"],
  };
}

function seatCushionAnalysis(source: string, signals: string[]): Omit<ProductReviewAnalysis, "evidenceLevel" | "reviewEvidence"> {
  const washable = /(?:세탁|분리형\s*커버)/u.test(source);
  return {
    category: "seat-cushion",
    categoryLabel: "착석 보조 쿠션",
    primaryUse: "기존 의자 착석감·하중 분산 보조",
    verifiedSignals: signals,
    strengths: [
      angle({ key: "seat-adjustment", label: "기존 좌판 보완", evidence: ["방석·쿠션 구조"], readerImpact: ["의자 교체 없이 착석 조건 조절"], appliesWhen: ["기존 좌판 불편"], verificationNeeds: ["가로·세로 크기", "두께"] }),
      ...(washable ? [angle({ key: "washable-cover", label: "분리 세탁 관리", evidence: ["분리·세탁 표기"], readerImpact: ["일상 위생 관리 부담 감소"], appliesWhen: ["매일 장시간 사용"], verificationNeeds: ["세탁 방법", "건조 조건"] })] : []),
    ],
    limitations: [
      angle({ key: "seat-height-change", label: "좌판 높이 변화", evidence: ["좌판 위 추가 구조"], readerImpact: ["책상·팔걸이 높이 불일치 가능성"], appliesWhen: ["두꺼운 쿠션", "낮은 책상"], verificationNeeds: ["실측 두께", "착석 후 압축 높이"] }),
      angle({ key: "body-fit-variance", label: "체형별 체감 편차", evidence: ["개인차가 큰 착석 제품"], readerImpact: ["압력 분산 체감 차이", "치료 효과 판단 불가"], appliesWhen: ["장시간 착석", "통증 완화 기대"], verificationNeeds: ["좌판 크기", "충전재 복원력", "의학적 효능 근거"] }),
    ],
    bestFor: ["기존 좌판 착석감 보완 사용자", "좌판·쿠션 실측 비교 가능 사용자"],
    notFor: ["질환 치료 효과 기대", "추가 좌판 높이를 수용하기 어려운 환경"],
    comparisonAxes: ["가로·세로 크기", "두께", "충전재 복원력", "미끄럼 방지", "커버 세탁 방식"],
    decisionCriteria: ["착석감 보완 대 좌판 높이 변화", "관리 편의 대 소재 복원력"],
    unresolvedFacts: ["실측 크기", "압축 두께", "충전재", "미끄럼 방지", "세탁 조건"],
    forbiddenCategoryTerms: ["보냉", "풍량", "배터리"],
  };
}

function hairCareAnalysis(source: string, signals: string[]): Omit<ProductReviewAnalysis, "evidenceLevel" | "reviewEvidence"> {
  const portable = /(?:휴대|여행|무선|미니)/u.test(source);
  return {
    category: "hair-care",
    categoryLabel: "헤어 케어 기기",
    primaryUse: portable ? "휴대형 모발 건조·스타일링" : "모발 건조·스타일링",
    verifiedSignals: signals,
    strengths: [angle({ key: portable ? "portable-hair-care" : "focused-hair-care", label: portable ? "휴대·보관 편의" : "건조·스타일링 목적 집중", evidence: [portable ? "휴대·무선 표기" : "헤어 케어 카테고리"], readerImpact: [portable ? "여행·외출 준비 편입" : "기능 비교 범위 축소"], appliesWhen: [portable ? "이동 중 사용" : "일상 건조·스타일링"], verificationNeeds: ["무게", "크기", portable ? "배터리 지속시간" : "소비전력"] })],
    limitations: [
      angle({ key: "thermal-airflow-evidence", label: "열·풍량 성능 미확인", evidence: ["열 단계·풍량·소비전력 값 부족"], readerImpact: ["건조 속도 판단 보류", "모발 열 노출 판단 보류"], appliesWhen: ["성능 우선 선택"], verificationNeeds: ["풍량", "온도 단계", "소비전력"] }),
      angle({ key: portable ? "portable-runtime" : "handheld-ergonomics", label: portable ? "휴대성과 연속 사용의 절충" : "손목 부담 가능성", evidence: [portable ? "휴대형 구조" : "손으로 드는 기기 구조"], readerImpact: [portable ? "배터리·크기 제약" : "장시간 사용 피로"], appliesWhen: [portable ? "긴 모발·연속 사용" : "장시간 스타일링"], verificationNeeds: [portable ? "배터리 지속시간" : "무게", portable ? "충전시간" : "손잡이 균형"] }),
    ],
    bestFor: [portable ? "여행 짐 부피를 줄이려는 사용자" : "건조·스타일링 기능 비교 사용자"],
    notFor: ["확인된 열·풍량 수치 없이 전문가용 성능 기대"],
    comparisonAxes: ["풍량", "온도 단계", "무게", portable ? "배터리 지속시간" : "소비전력", "노즐 구성"],
    decisionCriteria: ["휴대성 대 연속 사용 성능", "건조 속도 대 열 제어", "무게 대 노즐 구성"],
    unresolvedFacts: ["풍량", "온도 단계", "무게", portable ? "배터리 지속시간" : "소비전력", "노즐 구성"],
    forbiddenCategoryTerms: ["보냉백", "착석", "좌판"],
  };
}

function genericAnalysis(input: ProductEditorialPlanInput, signals: string[]): Omit<ProductReviewAnalysis, "evidenceLevel" | "reviewEvidence"> {
  const features = meaningfulFeatures(input.features, input.productName).slice(0, 6);
  const description = meaningfulDescription(input.description, input.productName);
  const strongestFact = features[0] || description || clean(input.productName);
  return {
    category: "generic",
    categoryLabel: "제품",
    primaryUse: "판매페이지 근거 기반 용도 분류",
    verifiedSignals: unique([...signals, ...features.slice(0, 3)], 8),
    strengths: [angle({ key: "strongest-verified-feature", label: "최우선 확인 기능", evidence: [strongestFact, features[0] ? "판매페이지 특징" : description ? "판매페이지 설명" : "상품명"], readerImpact: ["사용 목적과 기능 일치 여부"], appliesWhen: ["해당 기능이 필수 조건"], verificationNeeds: ["기능 작동 범위", "관련 규격"] })],
    limitations: [
      angle({ key: "insufficient-category-evidence", label: "카테고리별 판단 근거 부족", evidence: ["현재 수집 정보 범위"], readerImpact: ["제품 고유 장단점 판단 보류"], appliesWhen: ["상품명 외 정보 부족"], verificationNeeds: ["핵심 기능", "규격", "소재"] }),
      angle({ key: "unverified-usage-factors", label: "사용감 핵심 항목 미확인", evidence: ["크기·소재·성능 값 부족"], readerImpact: ["사용 적합도 추정 금지"], appliesWhen: ["사용감 중심 선택"], verificationNeeds: ["크기", "소재", "성능", "관리 방식"] }),
    ],
    bestFor: [features[0] ? `${features[0]} 필수 사용자` : "추가 규격 확인 가능 사용자"],
    notFor: ["상품명·가격만으로 즉시 결정하려는 사용자"],
    comparisonAxes: ["핵심 기능", "크기와 소재", "관리 방식", "옵션 구성", "보증·교환 조건"],
    decisionCriteria: ["확인 기능 대 사용 목적", "규격 충족 여부", "대안 제품 대비 근거 밀도"],
    unresolvedFacts: ["핵심 기능", "크기", "소재", "성능", "관리 방식"],
    forbiddenCategoryTerms: [],
  };
}

function foodAnalysis(input: ProductEditorialPlanInput, signals: string[]): Omit<ProductReviewAnalysis, "evidenceLevel" | "reviewEvidence"> {
  const fact = signals[0] || clean(input.productName);
  return {
    category: "food",
    categoryLabel: "식품",
    primaryUse: "확인된 식재료·조리 구성에 따른 식사 준비",
    verifiedSignals: signals,
    strengths: [angle({ key: "verified-food-composition", label: "식재료와 구성의 선택 가치", evidence: signals.length ? signals : [fact], readerImpact: ["식사 계획과 구성의 적합성"], appliesWhen: ["확인된 부위·중량·가공 형태가 필요한 경우"], verificationNeeds: ["섭취 인원은 확인된 중량만으로 단정하지 않기"] })],
    limitations: [angle({ key: "food-source-boundary", label: "확인된 구성과 미확인 식품 정보", evidence: ["수집된 판매 정보 범위"], readerImpact: ["보관과 식사 준비 계획에 필요한 정보 구분"], appliesWhen: ["원산지·원재료·보관 조건이 제공되지 않은 경우"], verificationNeeds: ["원산지", "원재료와 알레르기 표시", "보관 조건", "소비기한"] })],
    bestFor: ["확인된 식재료와 구성에 맞춰 식사를 준비하려는 사람"],
    notFor: ["미확인 맛·식감·원산지·섭취 인원을 확정하고 구매하려는 사람"],
    comparisonAxes: ["부위와 원재료", "표시 중량", "양념·초벌 여부", "보관·조리 조건"],
    decisionCriteria: ["식사 계획과 표시 구성의 일치", "미확인 식품 조건의 중요도"],
    unresolvedFacts: ["원산지·원재료·보관·소비기한은 출처에 제공된 항목만 확정", "직접 먹은 후기와 맛·식감은 제공되지 않으면 생성 금지"],
    forbiddenCategoryTerms: [],
  };
}

export function buildProductReviewAnalysis(input: ProductEditorialPlanInput): ProductReviewAnalysis {
  const productName = clean(input.productName) || "상품";
  const description = meaningfulDescription(input.description, productName);
  const features = meaningfulFeatures(input.features, productName).slice(0, 8);
  const reviewEvidence = reviewEvidenceFeatures(input.features);
  const categorySource = clean([productName, description, ...features].join(" "));
  // The product name can select an editorial category, but it is not evidence
  // that the named function or form factor is actually present. Derive verified
  // signals only from seller description and typed/strong specification facts.
  const category = detectCategory(categorySource, productName);
  const evidenceDescription = isVerifiableProductDescription(description, category) ? description : "";
  const evidenceSource = clean([evidenceDescription, ...features].join(" "));
  const signals = collectSignals(evidenceSource, category);
  const base = category === "fan"
    ? fanAnalysis(evidenceSource, signals)
    : category === "cooler-bag"
      ? coolerBagAnalysis(evidenceSource, signals)
      : category === "seat-cushion"
        ? seatCushionAnalysis(evidenceSource, signals)
        : category === "hair-care"
          // Portable wording in the seller-supplied product identity may select
          // the editorial angle, but it never enters verifiedSignals or the
          // evidence score calculated below.
          ? hairCareAnalysis(clean([productName, evidenceDescription].join(" ")), signals)
          : category === "food"
            ? foodAnalysis(input, signals)
            : genericAnalysis(input, signals);
  const measuredFeatureCount = features.filter((value) => PRODUCT_MEASUREMENT_PATTERN.test(value)).length;
  const functionalDetail = new Set(features.map(explicitProductFunctionKey).filter(Boolean)).size >= 2 ? 1 : 0;
  const evidencePoints = Math.min(signals.length, 2) + features.length + measuredFeatureCount + functionalDetail + (evidenceDescription ? 1 : 0);
  const evidenceLevel = evidencePoints >= 7 && features.length >= 3 ? "rich" : evidencePoints >= 3 && features.length >= 1 ? "usable" : "sparse";
  return {
    ...base,
    // Prefer the concise category fact (for example `1kg`) over a labelled
    // duplicate (`중량: 1kg`). One source fact must count only once.
    verifiedSignals: semanticallyUniqueSignals([...base.verifiedSignals, ...features], 12),
    reviewEvidence,
    evidenceLevel,
  };
}

export function hasSufficientProductReviewEvidence(input: ProductEditorialPlanInput): boolean {
  const analysis = buildProductReviewAnalysis(input);
  return analysis.evidenceLevel !== "sparse";
}

/** 판매 페이지에서 확인된 사실을 `라벨: 값` 줄로 만든다. 프롬프트와 품질 채점이 같은 줄을 본다. */
export function buildProductVerifiedFactLines(input: ProductEditorialPlanInput): string[] {
  const description = meaningfulDescription(input.description, input.productName);
  return [
    clean(input.productName) ? `상품명: ${clean(input.productName)}` : "",
    description ? `설명: ${description}` : "",
    ...meaningfulFeatures(input.features, input.productName).slice(0, 10).map((value) => `상세 근거: ${value}`),
    ...reviewEvidenceFeatures(input.features).slice(0, 4).map((value) => `구매후기 원문 근거: ${value}`),
    clean(input.price) ? `가격: ${clean(input.price)}` : "",
    clean(input.originalPrice) ? `원가: ${clean(input.originalPrice)}` : "",
    clean(input.discountRate) ? `할인율: ${clean(input.discountRate)}` : "",
    clean(input.couponInfo) ? `쿠폰/혜택: ${clean(input.couponInfo)}` : "",
    clean(input.deliveryInfo) ? `배송: ${clean(input.deliveryInfo)}` : "",
    clean(input.reviewCount) ? `리뷰 수: ${clean(input.reviewCount)}` : "",
    clean(input.rating) ? `평점: ${clean(input.rating)}` : "",
  ].filter(Boolean);
}

/**
 * 품질 채점용 근거 목록. 키워드 태그(러닝, 메쉬 …)만 있는 상품도 `상품명: …`, `가격: …`, `원가: …` 같은
 * 구조화된 사실 줄은 근거로 인정되도록 사실 줄과 구매후기 근거를 합친다. 생성 전 게이트(evidenceLevel)에는 쓰지 않는다.
 */
export function buildProductScoringFeatures(input: ProductEditorialPlanInput): string[] {
  return unique([
    ...buildProductVerifiedFactLines(input).filter((line) => !line.startsWith("구매후기 원문 근거:")),
    ...(input.features || []).filter(isReviewEvidenceFeature),
  ], 24);
}

export function buildProductEditorialPlan(input: ProductEditorialPlanInput): ProductEditorialPlan {
  const factLines = buildProductVerifiedFactLines(input);
  const reviewAnalysis = buildProductReviewAnalysis(input);
  return {
    framework: "source-backed-product-review-v3",
    verifiedFactLines: factLines,
    reviewAnalysis,
    blockedClaimRules: [
      "직접 구매·수령·사용·재구매 경험을 제공받지 않았다면 체험 사실을 만들지 않기",
      "출처 없는 가격·할인율·평점·리뷰 수·순위·최저가·성능 수치를 만들지 않기",
      "상품명·가격·할인·쿠폰·배송 정보를 제품 고유 기능·구조·규격의 대체 근거로 사용하지 않기",
      "서로 다른 확인 근거를 각각 같은 문단의 사용 이점 또는 제약과 연결하고 한 근거를 여러 판단의 근거처럼 반복하지 않기",
      "제품 자체의 장단점 대신 배송·쿠폰·교환 확인 문구로 섹션을 채우지 않기",
      "상세페이지 문장을 읽어주는 데 그치지 말고 기능이 왜 유용한지와 어떻게 쓰는지를 설명하기",
      "구매후기 원문이 있을 때만 반복 장점을 요약하고 후기 수·평점만으로 만족 내용을 만들지 않기",
      "장점에는 근거가 된 기능을, 단점에는 제품 구조상 제약 또는 미확인 핵심 성능을 함께 쓰기",
      "추천 대상과 비추천 대상을 모두 제시하고 마지막에 조건부 결론을 내리기",
    ],
    sections: SECTION_LIBRARY,
  };
}

export function formatProductEditorialPlanForPrompt(plan: ProductEditorialPlan): string {
  const review = plan.reviewAnalysis;
  const formatAngle = (item: ProductReviewAngle, index: number, kind: "장점" | "제약") =>
    `- ${kind} 후보 ${index + 1}: 주제=${item.label} | 근거=${item.evidence.join(", ") || "없음"} | 독자 영향=${item.readerImpact.join(", ") || "추론 금지"} | 적용 조건=${item.appliesWhen.join(", ") || "추가 확인"} | 확인 필요=${item.verificationNeeds.join(", ") || "없음"}`;
  return [
    "[근거 기반 상품 리뷰 하네스 v3 · 문장 생성 금지 데이터]",
    "- 아래 항목은 고정 목차가 아니라 선택 가능한 판단 렌즈입니다. 근거가 충분한 렌즈만 골라 합치거나 순서를 바꾸세요.",
    "- 글 전체는 사실 → 의미 → 구매 판단의 인과만 유지하고, 섹션 수와 제목은 자유롭게 정합니다.",
    "- 상세페이지를 읽어주는 문장을 반복하지 말고 제품의 작동 방식·사용 가치·사용법·제약을 설명합니다.",
    "- 아래 해석 카드는 완성 원고가 아니라 의미 단위입니다. 표현을 복사하지 말고 상품별 문맥으로 새 문장을 작성합니다.",
    "- 구성표 이름과 역할 라벨은 본문에 노출하지 마세요.",
    ...plan.sections.map((section) => `- 렌즈 ${section.role} | 목적: ${section.purpose} | 근거: ${section.evidenceRule} | 이미지 역할: ${section.imageRole}`),
    "",
    "[제품 해석 데이터]",
    `- 분류: ${review.categoryLabel}`,
    `- 1차 용도: ${review.primaryUse}`,
    `- 근거 수준: ${review.evidenceLevel}`,
    `- 확인 신호: ${review.verifiedSignals.join(", ") || "추가 수집 필요"}`,
    `- 구매후기 원문 근거: ${review.reviewEvidence.join(" / ") || "수집된 후기 문장 없음 · 후기 내용을 만들지 말 것"}`,
    ...review.strengths.map((item, index) => formatAngle(item, index, "장점")),
    ...review.limitations.map((item, index) => formatAngle(item, index, "제약")),
    `- 잘 맞는 대상: ${review.bestFor.join(" / ")}`,
    `- 맞지 않을 수 있는 대상: ${review.notFor.join(" / ")}`,
    `- 비교 기준: ${review.comparisonAxes.join(", ")}`,
    `- 결론 판단축: ${review.decisionCriteria.join(" / ")}`,
    `- 미확인 사실: ${review.unresolvedFacts.join(", ") || "없음"}`,
    "",
    "[사용 가능한 확인 사실]",
    ...(plan.verifiedFactLines.length ? plan.verifiedFactLines.map((line) => `- ${line}`) : ["- 상품명 외 확인된 사실 없음"]),
    "",
    "[금지 주장]",
    ...plan.blockedClaimRules.map((line) => `- ${line}`),
  ].join("\n");
}

/**
 * 제품 제약은 반드시 "단점"이라는 단어로만 쓰이지 않는다. 특히 근거가 부족한
 * 성능, 취향 의존성, 대용량 구성 부담처럼 독자에게 더 정확한 표현도 제약으로
 * 인정해야 한다.
 */
export const PRODUCT_LIMITATION_PATTERN = /(?:아쉬|단점|한계|제약|주의|부담|반면|비추천|맞지\s*않|적합하지\s*않|민감(?:한|하다)|확인되지\s*않|수치(?:는|가)?\s*(?:없|미확인)|체감(?:은|이)?\s*달라|과하게\s*(?:늘리|사용)|처음\s*접하는)/u;

export function hasProductLimitationLanguage(value: string): boolean {
  return PRODUCT_LIMITATION_PATTERN.test(clean(value));
}

const ROLE_PATTERNS: Record<ProductEditorialRole, RegExp> = {
  "review-hook": /한\s*줄|먼저\s*내린|첫\s*결론|갈리는\s*(?:지점|기준)|먼저\s*보이는/u,
  "product-identity": /어떤\s*제품|제품\s*정체|핵심\s*구조|상품\s*성격|올인원|쪽에\s*가깝|제품(?:은|이에요|입니다)|기기(?:는|예요|입니다)/u,
  "source-evidence": /핵심\s*기능|작동\s*(?:방식|원리)|구조가|기능이|스펙|수치|배터리|소재/u,
  "primary-strength": /가장\s*분명한\s*장점|핵심\s*장점|주요\s*기능\s*1|선택\s*이유|장점(?:은|이|으로|을)|강점(?:은|이|으로)|줄여\s*주|덜어\s*주|실용적|편의성|의미가\s*있|유용|수월|간편/u,
  "secondary-strength": /두\s*번째|또\s*다른\s*강점|주요\s*기능\s*2/u,
  "use-case": /사용\s*(?:장면|방법|순서)|활용|설치|조작|충전|세척|관리|보관|잘\s*맞는\s*상황/u,
  "review-evidence": /구매\s*후기|사용자\s*후기|후기에서|구매자(?:가|는|들)|반복(?:해서|되는)?\s*(?:언급|평가)/u,
  comparison: /비슷한\s*제품|비교|갈리는\s*기준/u,
  limitations: PRODUCT_LIMITATION_PATTERN,
  fit: /추천\s*대상|비추천|이런\s*분|누구|어떤\s*사람|사람에게\s*(?:더\s*)?(?:맞|적합|어울)|잘\s*맞|맞지\s*않|다른\s*제품이\s*낫|큰\s*제품이\s*낫/u,
  offer: /가격|혜택|할인/u,
  verdict: /최종|결론|마지막\s*선택|후보에\s*올|선택\s*기준|가격까지\s*놓고|구매\s*기준|고르기\s*전|따져보면\s*선택/u,
};

export function inferProductEditorialRole(title: string): ProductEditorialRole {
  const normalized = clean(title);
  return (Object.entries(ROLE_PATTERNS) as Array<[ProductEditorialRole, RegExp]>).find(([, pattern]) => pattern.test(normalized))?.[0] || "source-evidence";
}

export function assessProductEditorialCoverage(sections: string[], productName = ""): { coveredRoles: ProductEditorialRole[]; missingCoreRoles: ProductEditorialRole[] } {
  const corpus = sections.join("\n");
  const foodPatterns: Partial<Record<ProductEditorialRole, RegExp>> = isFoodProductName(productName) ? {
    "product-identity": /(?:갈비|곱창|막창|대창|소고기|돼지고기|닭고기|김치|밀키트|볶음밥|만두).{0,45}(?:구성|식재료|식품|부위|양념|초벌)/u,
    "source-evidence": /(?:\d[\d,.]*\s*(?:kg|g)|부위|원재료|양념|초벌|냉장|냉동|원산지)/iu,
    "use-case": /(?:조리|해동|소분|굽|구워|끓|볶|익혀|익히|보관|식사\s*준비)/u,
  } : {};
  const coveredRoles = (Object.keys(ROLE_PATTERNS) as ProductEditorialRole[]).filter((role) => ROLE_PATTERNS[role].test(corpus) || foodPatterns[role]?.test(corpus));
  const coreRoles: ProductEditorialRole[] = ["product-identity", "source-evidence", "primary-strength", "use-case", "limitations", "fit", "verdict"];
  return { coveredRoles, missingCoreRoles: coreRoles.filter((role) => !coveredRoles.includes(role)) };
}

export function hasConditionalProductVerdict(sections: string[]): boolean {
  const body = sections.join("\n");
  if (/(?:최종\s*리뷰|조건부\s*결론|후보(?:로|에\s*올)|더\s*실용적|고르는\s*편이\s*맞|선택\s*기준)/u.test(body)) {
    return true;
  }

  // 자연스러운 총평은 "조건부 결론"이나 "선택 기준"이라는 정답 문구를
  // 그대로 쓰지 않는다. 마지막 두 섹션 안에서 조건과 구매 판단이 같은
  // 문장에 함께 있으면 의미상 조건부 결론으로 인정한다.
  const conclusionScope = sections.slice(-2).join("\n");
  const conclusionSentences = conclusionScope
    .split(/[\n.!?。]+/u)
    .map(clean)
    .filter((sentence) => sentence.length >= 8);
  const conditionPattern = /(?:이라면|라면(?=[,\s])|한다면|원한다면|필요하다면|우선이면|사람에게|분에게|경우(?:에|에는|라면)?|조건(?:에서는|이라면|에\s*따라)|환경(?:에서는|이라면)|용도(?:에서는|라면))/u;
  const judgementPattern = /(?:추천|비추천|잘\s*맞|맞지\s*않|맞을\s*수|비교할\s*만|더\s*(?:낫|적합|실용)|강점|선택\s*이유|후보|어울|적합|구성\s*과잉)/u;
  return conclusionSentences.some((sentence) => conditionPattern.test(sentence) && judgementPattern.test(sentence));
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))).length;
}

/** 정확히 같은 문장뿐 아니라 숫자·어미만 바뀐 근사 중복까지 반복으로 센다. */
function repeatedSentenceCount(sections: string[]): number {
  return assessRepetition(sections).nearDuplicateCount;
}

export function assessProductReviewSubstance(input: {
  productName: string;
  sections: string[];
  sourceDescription?: string | null;
  sourceFeatures?: string[];
}): ProductReviewSubstanceAssessment {
  // The section contract is heading + blank line + body. A single newline
  // heading is also supported; headings never supply evidence or role labels.
  const paragraphs = input.sections.flatMap((section) => {
    const normalized = section.replace(/\r\n?/gu, "\n").trim();
    const lines = normalized.split("\n");
    const hasHeading = lines.length > 1 && !/[.!?。]$/u.test(lines[0].trim());
    return (hasHeading ? lines.slice(1).join("\n") : normalized)
      .split(/\n\s*\n/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  });
  const body = paragraphs.join("\n\n");
  const analysis = buildProductReviewAnalysis({
    productName: input.productName,
    description: input.sourceDescription,
    features: input.sourceFeatures,
    targetSectionCount: 11,
  });
  const paragraphSentences = paragraphs.map((paragraph) =>
    paragraph.split(/[\n.!?。]+/u).map(clean).filter(Boolean));
  const sentences = paragraphSentences.flat().filter((item) => item.length >= 8);
  const sentenceCount = Math.max(1, sentences.length);
  const genericGuidanceCount = countMatches(body, /(?:확인(?:해|하|해야|하세요)|살펴보|비교해보|보는\s*게\s*좋|안전해요)/u);
  const categoryMismatchTerms = analysis.forbiddenCategoryTerms.filter((term) => body.includes(term));
  const signalCoveredBySentence = (signal: string, sentence: string): boolean => {
    const tokens = unique(signal.split(/[^\p{L}\p{N}]+/u), 12)
      .filter((token) => token.length >= 2 && !/(?:상품|제품|기능|표기|판매페이지|카테고리|방식|구조|기준)/u.test(token));
    if (tokens.length === 0) return false;
    const numericTokens = tokens.filter((token) => /\d/u.test(token));
    const descriptiveTokens = tokens.filter((token) => !/\d/u.test(token));
    if (numericTokens.length > 0) {
      return numericTokens.some((token) => sentence.includes(token)) &&
        (descriptiveTokens.length === 0 || descriptiveTokens.some((token) => sentence.includes(token)));
    }
    const required = Math.min(2, tokens.length);
    return tokens.filter((token) => sentence.includes(token)).length >= required;
  };
  const coveredSignals = analysis.verifiedSignals.filter((signal) =>
    sentences.some((sentence) => signalCoveredBySentence(signal, sentence))
  );
  const signalEvidenceAvailable = analysis.verifiedSignals.length > 0;
  // 상품명은 신원 확인에는 쓰지만 기능·구조 근거로 승격하지 않는다. 출처가
  // 키워드 태그뿐이면 새 원고를 반복 생성해도 품질 근거가 생기지 않는다.
  const judgementAnchors = analysis.verifiedSignals;
  const coveredReviewEvidence = analysis.reviewEvidence.filter((evidence) => {
    const tokens = unique(evidence.split(/[^\p{L}\p{N}]+/u), 16)
      .filter((token) => token.length >= 2 && !/(?:제품|상품|사용|구매|정말|너무|좋아요|좋습니다)/u.test(token));
    return tokens.some((token) => body.includes(token));
  });
  const usageInstructionCount = sentences.filter((sentence) =>
    /(?:사용\s*(?:방법|순서)|설치|조작|버튼|모드|충전|세척|관리|보관|연결|착용|분리|조절|조리|섭취|해동|굽|구워|소분|끓|볶|익혀|익히|바르|도포|흡수|두고\s*쓰|놓고\s*쓰)/u.test(sentence)
  ).length;
  const detailReadingCount = sentences.filter((sentence) =>
    /(?:상세\s*페이지|상세\s*정보|상품\s*설명에는|판매\s*페이지|사진에는|이미지에는|적혀\s*있|표시되어\s*있|확인됩니다)/u.test(sentence)
  ).length;
  const benefitPattern = /(?:장점|강점|선택\s*이유|효율|편의|편리|편하|편해|유리|실용|도움|유용|줄(?:여|어|일)|덜(?:어|\s*번거|\s*필요)|넓(?:혀|힐)|수월|간편|쉽게|쉬워|확보)/u;
  const fitPattern = /(?:추천\s*대상|잘\s*맞|비추천\s*대상|맞지\s*않|어울|적합|사람에게.*(?:맞|실용|유용|후보|추천)|(?:분|사용자|가정|환경|경우|용도)(?:에게|에는|에|라면|이라면).*(?:맞|편리|유용|실용|낫|후보)|(?:라면|다면).*(?:추천|후보|낫|맞))/u;
  const judgementPattern = /(?:장점|강점|선택\s*이유|효율|편의|유리|실용|중요|의미|가치|도움|현실적|유용|어울|후보|줄(?:여|어|일)|늘(?:려|어|릴)|대신|반면|아쉬|부담|한계|제약|잘\s*맞|적합|비추천|더\s*낫)/u;
  const matchingAnchors = (sentence: string) => judgementAnchors.filter((signal) => signalCoveredBySentence(signal, sentence));
  // Only the immediately preceding fact can support an explanation. Do not
  // flatten sections, skip intervening sentences, or chain inferred benefits.
  const groundedJudgements = paragraphSentences.flatMap((group) => group.flatMap((sentence, index) => {
    // Bare labels (even with a product token) are not explanatory prose.
    if (!/(?:다|요|죠)["'”’]?$/u.test(sentence)) return [];
    if (sentence.length < 8 || !(judgementPattern.test(sentence) || benefitPattern.test(sentence) || fitPattern.test(sentence))) return [];
    const previous = group[index - 1];
    const explanatory = /(?:그래서|따라서|덕분에|이\s*(?:구조|구성|기능|방식|점)|그만큼|때문|줄|덜|편리|수월|실용|유용|유리|어울|적합|잘\s*맞)/u.test(sentence);
    const anchors = matchingAnchors(sentence);
    const previousAnchors = previous && explanatory ? matchingAnchors(previous) : [];
    const groundedSignals = anchors.length > 0 ? anchors : previousAnchors;
    return groundedSignals.length > 0 ? [{ sentence, groundedSignals }] : [];
  }));
  const evidenceJudgementCount = groundedJudgements.length;
  const requiredSignalCount = signalEvidenceAvailable
    ? Math.min(
        analysis.evidenceLevel === "rich" ? 4 : analysis.evidenceLevel === "usable" ? 3 : 1,
        analysis.verifiedSignals.length,
      )
    : 0;
  const requiredEvidenceJudgementCount = analysis.evidenceLevel === "rich" ? 3 : analysis.evidenceLevel === "usable" ? 2 : 1;
  const groundedSignals = unique(groundedJudgements.flatMap((item) => item.groundedSignals), 12);
  const groundedSignalCount = groundedSignals.length;
  const requiredGroundedSignalCount = Math.min(requiredEvidenceJudgementCount, requiredSignalCount);
  const repeats = repeatedSentenceCount(input.sections);
  const checks: Array<[boolean, string]> = [
    [groundedJudgements.some((item) => benefitPattern.test(item.sentence)), "구체적인 장점"],
    [hasProductLimitationLanguage(body), "제품 자체의 단점·제약"],
    [groundedJudgements.some((item) => fitPattern.test(item.sentence)), "추천·비추천 대상"],
    [hasConditionalProductVerdict(input.sections), "조건부 최종 결론"],
    [coveredSignals.length >= requiredSignalCount, "상품 고유 구조·기능 근거"],
    [evidenceJudgementCount >= requiredEvidenceJudgementCount && groundedSignalCount >= requiredGroundedSignalCount, "서로 다른 근거와 사용 가치가 연결된 판단"],
    [usageInstructionCount >= 2, "구체적인 사용·설치·관리 방법"],
    [analysis.reviewEvidence.length === 0 || (coveredReviewEvidence.length >= 1 && /후기|구매자|사용자/u.test(body)), "구매후기 근거의 장점 요약"],
    [detailReadingCount / sentenceCount <= 0.15, "상세페이지 낭독형 문장 제거"],
    [genericGuidanceCount / sentenceCount <= 0.24, "확인 안내가 아닌 리뷰 판단"],
    [categoryMismatchTerms.length === 0, "상품 카테고리 일치"],
    [repeats <= 2, "반복 문장 제거"],
  ];
  const missingElements = checks.filter(([pass]) => !pass).map(([, label]) => label);
  return {
    pass: missingElements.length === 0,
    missingElements,
    genericGuidanceCount,
    sentenceCount,
    repeatedSentenceCount: repeats,
    coveredSignals,
    requiredSignalCount,
    evidenceJudgementCount,
    requiredEvidenceJudgementCount,
    categoryMismatchTerms,
    usageInstructionCount,
    detailReadingCount,
    coveredReviewEvidence,
    signalEvidenceAvailable,
    sourceEvidenceLevel: analysis.evidenceLevel,
    groundedSignalCount,
    requiredGroundedSignalCount,
  };
}

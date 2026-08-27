export type ProductEditorialRole =
  | "hook-problem"
  | "product-reveal"
  | "benefit"
  | "proof"
  | "use-case"
  | "comparison"
  | "offer-check"
  | "faq-caution"
  | "cta";

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

export interface ProductEditorialSection {
  role: ProductEditorialRole;
  title: string;
  purpose: string;
  evidenceRule: string;
  imageRole: string;
}

export interface ProductEditorialPlan {
  framework: "source-backed-product-story-v1";
  verifiedFactLines: string[];
  blockedClaimRules: string[];
  sections: ProductEditorialSection[];
}

const SECTION_LIBRARY: ProductEditorialSection[] = [
  {
    role: "hook-problem",
    title: "구매 전에 먼저 볼 기준",
    purpose: "독자가 해결하려는 문제와 선택 기준을 짧게 제시",
    evidenceRule: "독자의 일반적인 고민으로 표현하고 작성자의 구매·사용 경험을 만들지 않기",
    imageRole: "대표 이미지 또는 제품이 한눈에 보이는 히어로 이미지",
  },
  {
    role: "product-reveal",
    title: "상품 구성과 핵심 특징",
    purpose: "상품이 무엇이고 어떤 구성인지 명확히 소개",
    evidenceRule: "상품명·설명·판매페이지에서 확인된 구성만 사용",
    imageRole: "전체 구성 또는 패키지 이미지",
  },
  {
    role: "benefit",
    title: "기능이 주는 실제 이점",
    purpose: "기능 나열을 독자 관점의 효익으로 번역",
    evidenceRule: "확인된 기능에서 합리적으로 이어지는 이점만 쓰고 성능을 과장하지 않기",
    imageRole: "핵심 기능을 보여주는 상세 이미지",
  },
  {
    role: "proof",
    title: "스펙과 상세 정보로 확인",
    purpose: "앞선 효익을 스펙·구성·평점 등 확인 가능한 정보로 뒷받침",
    evidenceRule: "가격·할인·리뷰·평점 수치는 제공된 값이 있을 때만 사용",
    imageRole: "스펙, 재질, 디테일을 확인할 수 있는 이미지",
  },
  {
    role: "use-case",
    title: "어떤 상황에 잘 맞는지",
    purpose: "사용 장면과 추천 대상을 구체화",
    evidenceRule: "직접 써봤다는 표현 없이 적합한 상황을 조건형으로 설명",
    imageRole: "사용 장면 또는 크기감을 보여주는 이미지",
  },
  {
    role: "comparison",
    title: "비슷한 제품과 비교할 기준",
    purpose: "무근거 순위 대신 선택 기준과 차이를 설명",
    evidenceRule: "경쟁 제품의 미확인 수치·우열은 쓰지 않고 비교 항목만 제시",
    imageRole: "옵션, 구성, 크기 차이를 비교할 수 있는 이미지",
  },
  {
    role: "offer-check",
    title: "가격과 혜택 확인 포인트",
    purpose: "가격·쿠폰·배송을 구매 판단 정보로 정리",
    evidenceRule: "현재 확인된 값만 쓰고 최종 결제 화면 재확인을 안내",
    imageRole: "옵션 또는 구성 확인 이미지",
  },
  {
    role: "faq-caution",
    title: "구매 전 자주 놓치는 부분",
    purpose: "옵션·배송·교환 등 반론과 주의사항 해소",
    evidenceRule: "확인되지 않은 정책을 단정하지 말고 확인 항목으로 제시",
    imageRole: "주의사항 또는 옵션 안내 이미지",
  },
  {
    role: "cta",
    title: "이런 분이라면 확인해보세요",
    purpose: "추천 대상을 요약하고 다음 행동 안내",
    evidenceRule: "강매·품절 임박·최저가 단정을 피하고 상세 조건 확인으로 연결",
    imageRole: "제품 대표 이미지 재노출 또는 이미지 없음",
  },
];

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function buildProductEditorialPlan(input: ProductEditorialPlanInput): ProductEditorialPlan {
  const factLines = [
    clean(input.productName) ? `상품명: ${clean(input.productName)}` : "",
    clean(input.description) ? `설명: ${clean(input.description)}` : "",
    ...(input.features || []).map((value) => clean(value)).filter(Boolean).slice(0, 8).map((value) => `특징: ${value}`),
    clean(input.price) ? `가격: ${clean(input.price)}` : "",
    clean(input.originalPrice) ? `원가: ${clean(input.originalPrice)}` : "",
    clean(input.discountRate) ? `할인율: ${clean(input.discountRate)}` : "",
    clean(input.couponInfo) ? `쿠폰/혜택: ${clean(input.couponInfo)}` : "",
    clean(input.deliveryInfo) ? `배송: ${clean(input.deliveryInfo)}` : "",
    clean(input.reviewCount) ? `리뷰 수: ${clean(input.reviewCount)}` : "",
    clean(input.rating) ? `평점: ${clean(input.rating)}` : "",
  ].filter(Boolean);

  const count = Math.max(4, Math.min(9, Math.trunc(input.targetSectionCount || 0)));
  const narrativeRoles: ProductEditorialRole[] = [
    "hook-problem",
    "product-reveal",
    "benefit",
    "proof",
    "use-case",
    "comparison",
    "offer-check",
    "faq-caution",
    "cta",
  ];
  const priorityRoles: ProductEditorialRole[] = [
    "hook-problem",
    "product-reveal",
    "benefit",
    "proof",
    "use-case",
    "faq-caution",
    "offer-check",
    "comparison",
  ];
  const selectedRoles = count >= narrativeRoles.length
    ? narrativeRoles
    : narrativeRoles.filter((role) =>
        role === "cta" || priorityRoles.slice(0, count - 1).includes(role),
      );
  const sections = selectedRoles
    .map((role) => SECTION_LIBRARY.find((section) => section.role === role)!)
    .filter(Boolean);

  return {
    framework: "source-backed-product-story-v1",
    verifiedFactLines: factLines,
    blockedClaimRules: [
      "직접 구매·수령·사용·재구매 경험을 제공받지 않았다면 체험 사실을 만들지 않기",
      "출처 없는 가격·할인율·평점·리뷰 수·순위·최저가·성능 수치를 만들지 않기",
      "확인되지 않은 배송·교환·환불·재고 정책을 확정적으로 쓰지 않기",
      "기능 설명과 독자 효익을 구분하고, 효익은 조건형 표현으로 작성하기",
    ],
    sections,
  };
}

export function formatProductEditorialPlanForPrompt(plan: ProductEditorialPlan): string {
  return [
    "[근거 기반 상품 글 흐름]",
    "- 아래 순서는 상세페이지의 설득 흐름을 블로그 글에 맞게 축약한 내부 구성표입니다.",
    "- 구성표 이름과 역할 라벨은 본문에 노출하지 마세요.",
    ...plan.sections.map(
      (section, index) =>
        `${index + 1}. ${section.title} | 목적: ${section.purpose} | 근거: ${section.evidenceRule} | 이미지 역할: ${section.imageRole}`,
    ),
    "",
    "[사용 가능한 확인 사실]",
    ...(plan.verifiedFactLines.length ? plan.verifiedFactLines.map((line) => `- ${line}`) : ["- 상품명 외 확인된 사실 없음"]),
    "",
    "[금지 주장]",
    ...plan.blockedClaimRules.map((line) => `- ${line}`),
  ].join("\n");
}

const ROLE_PATTERNS: Record<ProductEditorialRole, RegExp> = {
  "hook-problem": /구매\s*전|고민|선택\s*기준|확인\s*포인트/u,
  "product-reveal": /구성|패키지|첫인상|디자인|상품\s*특징/u,
  benefit: /기능|장점|이점|도움|편리/u,
  proof: /스펙|크기|재질|상세|평점|리뷰|수치/u,
  "use-case": /사용\s*장면|상황|추천\s*대상|잘\s*맞/u,
  comparison: /비교|차이|선택/u,
  "offer-check": /가격|할인|쿠폰|배송|혜택/u,
  "faq-caution": /주의|아쉬운|놓치|교환|반품|옵션/u,
  cta: /확인해|살펴|추천|마무리/u,
};

export function assessProductEditorialCoverage(sections: string[]): {
  coveredRoles: ProductEditorialRole[];
  missingCoreRoles: ProductEditorialRole[];
} {
  const corpus = sections.join("\n");
  const coveredRoles = (Object.keys(ROLE_PATTERNS) as ProductEditorialRole[]).filter((role) =>
    ROLE_PATTERNS[role].test(corpus),
  );
  const coreRoles: ProductEditorialRole[] = ["hook-problem", "product-reveal", "benefit", "proof", "use-case", "faq-caution"];
  return {
    coveredRoles,
    missingCoreRoles: coreRoles.filter((role) => !coveredRoles.includes(role)),
  };
}

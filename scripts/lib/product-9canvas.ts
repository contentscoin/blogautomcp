import crypto from "node:crypto";
import type { ShoppingTopicTemplateId } from "./topic-templates/types";

export type ProductPhysicalScale = "wearable" | "handheld" | "desktop" | "floor" | "package";
export type ProductOptionStatus = "not-applicable" | "confirmed" | "ambiguous";
export type ProductClaimStatus = "candidate" | "validated" | "promoted" | "rejected";

export interface Product9CanvasInput {
  name: string;
  description?: string | null;
  features?: readonly string[] | null;
  categoryPath?: string | null;
  sourceUrl?: string | null;
  externalProductId?: string | null;
}

export interface Product9Canvas {
  version: "product-9canvas/v1";
  subject: {
    productName: string;
    externalProductId: string | null;
    selectedOption: { status: ProductOptionStatus; label: string | null; candidates: string[] };
  };
  resource: Array<{
    id: string;
    kind: "product-title" | "seller-description" | "seller-feature" | "category-path";
    text: string;
    sourceLocator: string | null;
  }>;
  evidence: Array<{
    id: string;
    resourceId: string;
    text: string;
    sourceLocator: string | null;
    sourceHashOrExternalId: string;
    collectedAt: string;
    derivedBy: "product-9canvas";
    derivationVersion: "1";
  }>;
  concept: {
    categoryId: ShoppingTopicTemplateId;
    categoryConfidence: "high" | "medium" | "low";
    categorySignals: string[];
    productKind: string;
    physicalScale: ProductPhysicalScale;
    useContexts: string[];
  };
  claim: Array<{
    id: string;
    text: string;
    status: ProductClaimStatus;
    evidenceIds: string[];
  }>;
  community: {
    catalogOptions: string[];
    comparisonAllowed: boolean;
  };
  outcome: {
    supportedBenefits: string[];
    unresolvedConstraints: string[];
  };
  lever: {
    topicTemplateId: ShoppingTopicTemplateId;
    thumbnailThemeId: string;
    compositionProfile: ProductPhysicalScale;
  };
  policy: {
    forbidMixedOptionVisuals: boolean;
    requireSingleOptionVisual: boolean;
    allowCatalogComparisonInText: boolean;
    writingDirective: string;
    imageDirective: string;
    blockers: string[];
  };
}

type CategoryRule = {
  id: Exclude<ShoppingTopicTemplateId, "generic_shopping">;
  strong: RegExp[];
  broad: RegExp[];
};

// Strong product nouns determine identity. Use-context words such as "캠핑" are
// deliberately excluded: they describe where a product is used, not what it is.
const CATEGORY_RULES: CategoryRule[] = [
  {
    id: "food_supplement",
    strong: [
      /곶감|반건시|건시|호두말이|크림치즈|한우|소고기|꽃등심|올리브\s*(?:오일|유)|침향(?:환|원)|영양제|비타민|유산균|오메가/u,
    ],
    broad: [/식품|간식|선물\s*세트|건강\s*기능\s*식품/u],
  },
  {
    id: "home_appliance",
    strong: [/가습기|청소기|건조기|세탁기|냉장고|냉동고|선풍기|서큘레이터|에어컨|공기청정기|제습기|드라이기|드라이어/u],
    broad: [/생활\s*가전|주방\s*가전|가전/u],
  },
  {
    id: "sports_leisure",
    strong: [/골프\s*거리\s*측정기|거리\s*측정기|골프\s*워치|보이스캐디|타프|텐트|등산|스포츠/u],
    broad: [/골프|레저|아웃도어/u],
  },
  {
    id: "digital_it",
    strong: [/노트북|태블릿|모니터|스마트\s*tv|키보드|마우스|카플레이|안드로이드\s*오토|이어폰|헤드폰/u],
    broad: [/디지털|컴퓨터|전자\s*기기/u],
  },
  {
    id: "beauty_body",
    strong: [/선크림|톤업|바디\s*(?:워시|로션|크림|클렌저)|수딩\s*크림|핸드\s*(?:워시|크림)|샴푸|린스|트리트먼트|컨디셔너|화장품/u],
    broad: [/스킨케어|바디케어|뷰티/u],
  },
  {
    id: "baby_pet",
    strong: [/강아지|고양이|반려\s*(?:견|묘|동물)|유아|아기|기저귀/u],
    broad: [/반려동물|출산|육아/u],
  },
  {
    id: "fashion_goods",
    strong: [/의류|반바지|원피스|재킷|가방|신발|운동화|모자|지갑/u],
    broad: [/패션|잡화/u],
  },
  {
    id: "living_health",
    strong: [/방석|쿠션|수납|정리함|욕실|마사지|안마|칫솔|구강/u],
    broad: [/생활|건강|주방\s*용품/u],
  },
];

const clean = (value: unknown, maximum = 500): string => String(value || "")
  .normalize("NFKC")
  .replace(/[\r\n\u0000-\u001f]+/gu, " ")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, maximum);

function stableEvidenceId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(2, "0")}`;
}

function classifyCategory(input: Product9CanvasInput): Product9Canvas["concept"] {
  const name = clean(input.name, 400);
  const category = clean(input.categoryPath, 400);
  const detail = clean([input.description || "", ...(input.features || [])].join(" "), 6_000);
  let best: { id: CategoryRule["id"]; score: number; signals: string[] } | null = null;
  for (const rule of CATEGORY_RULES) {
    const signals: string[] = [];
    let score = 0;
    for (const pattern of rule.strong) {
      const categoryHit = category.match(pattern)?.[0];
      const nameHit = name.match(pattern)?.[0];
      const detailHit = detail.match(pattern)?.[0];
      if (categoryHit) { score += 12; signals.push(categoryHit); }
      if (nameHit) { score += 8; signals.push(nameHit); }
      if (detailHit && !signals.includes(detailHit)) { score += 2; signals.push(detailHit); }
    }
    for (const pattern of rule.broad) {
      const categoryHit = category.match(pattern)?.[0];
      const nameHit = name.match(pattern)?.[0];
      if (categoryHit) { score += 7; signals.push(categoryHit); }
      if (nameHit) { score += 3; signals.push(nameHit); }
    }
    if (!best || score > best.score) best = { id: rule.id, score, signals: [...new Set(signals)].slice(0, 5) };
  }
  const categoryId = best && best.score > 0 ? best.id : "generic_shopping";
  const categoryConfidence = !best || best.score === 0 ? "low" : best.score >= 8 ? "high" : "medium";
  const productKind = inferProductKind(name);
  const physicalScale = inferPhysicalScale(name, categoryId);
  return {
    categoryId,
    categoryConfidence,
    categorySignals: best?.signals || [],
    productKind,
    physicalScale,
    useContexts: inferUseContexts(`${name} ${detail}`),
  };
}

function inferProductKind(name: string): string {
  const kinds: Array<[RegExp, string]> = [
    [/가습기/u, "가습기"], [/골프\s*거리\s*측정기|보이스캐디/u, "시계형 골프 거리측정기"],
    [/곶감|반건시|건시/u, "곶감 선물세트"], [/청소기/u, "무선청소기"], [/건조기/u, "건조기"],
    [/드라이기|드라이어/u, "헤어드라이기"],
    [/바디\s*(?:워시|로션|크림|클렌저)|샤워\s*젤|핸드\s*(?:워시|크림)|샴푸|린스|트리트먼트|컨디셔너/u, "바디·헤어케어"],
    [/보냉백|쿨러백|아이스박스|소프트쿨러/u, "보냉용품"],
    [/이어폰/u, "이어폰"], [/노트북/u, "노트북"], [/스마트\s*tv|모니터/u, "디스플레이"],
    [/선크림|톤업/u, "톤업 선크림"], [/한우|소고기/u, "한우 선물세트"], [/타프/u, "캠핑 타프"],
  ];
  return kinds.find(([pattern]) => pattern.test(name))?.[1] || "상품";
}

export function inferProductPhysicalScale(productName: string, categoryId: ShoppingTopicTemplateId = "generic_shopping"): ProductPhysicalScale {
  const name = clean(productName, 400);
  if (/시계형|워치|이어폰|헤드폰|반지|팔찌/u.test(name)) return "wearable";
  if (/청소기|건조기|세탁기|냉장고|냉동고|스탠드\s*tv|이동식\s*(?:tv|모니터)|타프|텐트/u.test(name)) return "floor";
  if (/가습기|노트북|태블릿|모니터|키보드|스피커/u.test(name)) return "desktop";
  if (/거리\s*측정기|면도기|드라이기|드라이어|마우스|리모컨|휴대용/u.test(name)) return "handheld";
  if (/선물\s*세트|곶감|한우|소고기|캡슐|침향|식품|영양제|화장품|선크림/u.test(name) || categoryId === "food_supplement" || categoryId === "beauty_body") return "package";
  return categoryId === "home_appliance" ? "floor" : "desktop";
}

function inferPhysicalScale(name: string, categoryId: ShoppingTopicTemplateId): ProductPhysicalScale {
  return inferProductPhysicalScale(name, categoryId);
}

function inferUseContexts(text: string): string[] {
  const rules: Array<[RegExp, string]> = [
    [/캠핑|차박/u, "캠핑"], [/차량|자동차/u, "차량"], [/책상|탁상|사무실/u, "책상·사무실"],
    [/원룸|가정용|거실|집/u, "가정"], [/골프|필드|코스/u, "골프 코스"], [/선물|명절|추석|설날/u, "선물"],
    [/휴대|무선/u, "이동"], [/대학생|인강|업무|사무/u, "학업·업무"],
  ];
  return rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

const EXPLICIT_OPTION_PATTERN = /^(?:선택\s*옵션|선택\s*상품|주문\s*옵션|구성|수량|개수|용량|중량|향|색상|사이즈)\s*[:：]\s*(.+)$/u;

function optionState(name: string, features: readonly string[]): Product9Canvas["subject"]["selectedOption"] {
  const explicit = features.map(value => clean(value, 300)).map(value => value.match(EXPLICIT_OPTION_PATTERN)?.[1]?.trim()).find(Boolean);
  const candidates = [
    // Named catalogue variants are alternatives. Bare numeric specs are not:
    // e.g. a laptop's 16GB RAM and 512GB SSD form one configuration.
    ...name.matchAll(/(?:반건시|건시|호두말이|크림치즈)/giu),
  ].map(match => clean(match[0], 80));
  const distinct = [...new Set(candidates)];
  if (explicit) return { status: "confirmed", label: explicit, candidates: distinct };
  if (distinct.length >= 2) return { status: "ambiguous", label: null, candidates: distinct };
  return { status: "not-applicable", label: null, candidates: distinct };
}

function thumbnailThemeId(categoryId: ShoppingTopicTemplateId, productKind: string): string {
  if (productKind === "가습기") return "humidifier";
  if (productKind === "시계형 골프 거리측정기") return "golf-rangefinder";
  if (productKind === "곶감 선물세트") return "food-gift";
  if (productKind === "헤어드라이기") return "hair-dryer";
  if (productKind === "바디·헤어케어") return "beauty-body";
  if (productKind === "보냉용품") return "cooler";
  return categoryId;
}

export function buildProduct9Canvas(input: Product9CanvasInput): Product9Canvas {
  const productName = clean(input.name, 400);
  if (!productName) throw new Error("PRODUCT_ONTOLOGY_REQUIRED: 상품명이 없어 Product 9Canvas를 만들 수 없습니다.");
  const collectedAt = new Date().toISOString();
  const sourceLocator = clean(input.sourceUrl, 2_000) || null;
  const rawResources = [
    { kind: "product-title" as const, text: productName },
    ...(clean(input.categoryPath, 400) ? [{ kind: "category-path" as const, text: clean(input.categoryPath, 400) }] : []),
    ...(clean(input.description, 3_000) ? [{ kind: "seller-description" as const, text: clean(input.description, 3_000) }] : []),
    ...(input.features || []).map(value => ({ kind: "seller-feature" as const, text: clean(value, 500) })).filter(value => value.text),
  ];
  const resource = rawResources.map((item, index) => ({ id: stableEvidenceId("resource", index), ...item, sourceLocator }));
  const evidence = resource.map((item, index) => ({
    id: stableEvidenceId("evidence", index), resourceId: item.id, text: item.text, sourceLocator,
    sourceHashOrExternalId: clean(input.externalProductId, 200) ||
      `sha256:${crypto.createHash("sha256").update(item.text).digest("hex")}`,
    collectedAt, derivedBy: "product-9canvas" as const, derivationVersion: "1" as const,
  }));
  const concept = classifyCategory(input);
  const selectedOption = optionState(productName, input.features || []);
  const claim = evidence.slice(1).map((item, index) => {
    const source = resource.find(candidate => candidate.id === item.resourceId);
    return {
      id: stableEvidenceId("claim", index),
      text: item.text,
      // Scraped description copy remains a candidate. Only the existing
      // sanitizer's atomic feature rows enter the prompt as validated facts.
      status: source?.kind === "seller-feature" ? "validated" as const : "candidate" as const,
      evidenceIds: [item.id],
    };
  });
  const ambiguous = selectedOption.status === "ambiguous";
  const optionNames = selectedOption.candidates.join(", ");
  const policy = {
    forbidMixedOptionVisuals: true,
    requireSingleOptionVisual: ambiguous,
    allowCatalogComparisonInText: ambiguous,
    writingDirective: ambiguous
      ? `상품명의 ${optionNames}은 카탈로그 선택지 후보입니다. 모두 포함된 구성으로 쓰지 말고, 확인된 선택 옵션이 없으므로 옵션별 차이만 비교합니다.`
      : selectedOption.status === "confirmed"
        ? `선택 옵션 ${selectedOption.label}만 현재 상품 구성으로 설명합니다.`
        : "확인된 단일 상품 정체성과 공통 사양만 설명합니다.",
    imageDirective: ambiguous
      ? `한 이미지에는 식별 가능한 한 옵션만 사용합니다. ${optionNames}을 한 상자나 한 장면에 섞지 않습니다.`
      : "선택 상품과 일치하는 단일 제품 또는 확인된 구성만 사용합니다.",
    blockers: ambiguous ? ["SELECTED_OPTION_UNRESOLVED"] : [],
  };
  return {
    version: "product-9canvas/v1",
    subject: { productName, externalProductId: clean(input.externalProductId, 200) || null, selectedOption },
    resource,
    evidence,
    concept,
    claim,
    community: { catalogOptions: selectedOption.candidates, comparisonAllowed: ambiguous },
    outcome: {
      supportedBenefits: [],
      unresolvedConstraints: ambiguous ? ["선택 옵션 미확정"] : [],
    },
    lever: {
      topicTemplateId: concept.categoryId,
      thumbnailThemeId: thumbnailThemeId(concept.categoryId, concept.productKind),
      compositionProfile: concept.physicalScale,
    },
    policy,
  };
}

export function formatProduct9CanvasForPrompt(canvas: Product9Canvas): string {
  const evidenceLines = canvas.claim.filter(item => item.status === "validated").slice(0, 12).map(item => `  - ${item.text}`);
  return [
    `[Product 9Canvas · ${canvas.version}]`,
    `- Subject: ${canvas.subject.productName}`,
    `- Concept: ${canvas.concept.productKind} / ${canvas.concept.categoryId} / scale=${canvas.concept.physicalScale}`,
    `- Use contexts: ${canvas.concept.useContexts.join(", ") || "확인된 장면 없음"}`,
    `- Selected option: ${canvas.subject.selectedOption.status}${canvas.subject.selectedOption.label ? ` (${canvas.subject.selectedOption.label})` : ""}`,
    `- Writing policy: ${canvas.policy.writingDirective}`,
    `- Image policy: ${canvas.policy.imageDirective}`,
    "- Evidence: 아래 검증된 판매자 근거만 제품 사실로 사용합니다.",
    ...evidenceLines,
  ].join("\n");
}

export function selectedProductContextFrom9Canvas(canvas: Product9Canvas): string {
  return JSON.stringify({
    selectedTitle: canvas.subject.productName,
    selectedOption: canvas.subject.selectedOption,
    category: canvas.concept.categoryId,
    productKind: canvas.concept.productKind,
    optionPolicy: {
      forbidMixedOptionVisuals: canvas.policy.forbidMixedOptionVisuals,
      requireSingleOptionVisual: canvas.policy.requireSingleOptionVisual,
      directive: canvas.policy.imageDirective,
    },
    rule: "선택 상품과 이미지의 브랜드·제품 종류·모델·옵션이 일치해야 합니다. 카탈로그 선택지 후보를 한 구성으로 합치지 마세요.",
  });
}

export type ProductRecoveryStage = "source" | "understanding" | "writing" | "image-plan" | "image-source" | "composition";

/** Route a failed gate to the earliest stage that can actually remove its cause. */
export function productRecoveryStageForFailure(error: unknown): ProductRecoveryStage {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/SOURCE_EVIDENCE_REQUIRED|PRODUCT_SOURCE|SHOPPING_SETUP_REQUIRED/u.test(message)) return "source";
  if (/SELECTED_OPTION|MIXED_OPTION|상품과 시각적 일치|혼합 옵션|Thumbnail.*오도|제품 정체/u.test(message)) return "understanding";
  if (/기능-사용 장면 연결|QUALITY_REPAIR|본문 섹션|SEO 글 생성/u.test(message)) return "writing";
  if (/IMAGE_SOURCE_BINDING_REQUIRED|기능 근거 부족/u.test(message)) return "image-source";
  if (/PRODUCT_CUTOUT_REQUIRED|비정상적으로 크게|접촉|그림자|배치 기준/u.test(message)) return "composition";
  return "image-plan";
}

/**
 * 섹션 라이브러리 — 쇼핑/여행 글의 구성표.
 *
 * 참고 샘플(쇼핑: 제품 리뷰형 인용구 챕터, 여행: "상품 한눈에 보기 → 일정+현지 팁 → 가격
 * 포함/불포함 → 추천 이유 3가지 → 예약 전 체크 → 마무리")의 구조와 톤만 차용한다.
 * 문장을 복사하지 않고, 역할·형식·이미지 의도·근거 규칙만 코드화한다.
 * GEO(생성엔진 최적화) 블록 — 한눈에 보기 요약, 핵심 사실 목록, FAQ, 추천 대상, 근거 라인 —
 * 은 별도 후처리가 아니라 섹션 자체로 들어간다.
 */

import type { TravelProductFacts } from "../travel-content";
import {
  buildHighlightCourseLines,
  classifyHighlight,
  findDestinationKnowledge,
  topicParticle,
  usesGenericCopy,
  type HighlightKind,
} from "./travel-knowledge";
import type { ConnectKind, HeaderFormat, SectionRole, SectionShape } from "./types";

export interface LibraryContext {
  kind: ConnectKind;
  productName: string;
  shortName: string;
  price: string;
  factLines: string[];
  travel: TravelProductFacts | null;
  primaryKeyword: string;
  destination: string;
  duration: string;
  highlights: string[];
  hasReviewProof: boolean;
  collectedAt: string;
}

export interface SectionTemplate {
  role: SectionRole;
  title: string;
  headerFormat: HeaderFormat;
  shape: SectionShape;
  purpose: string;
  evidenceRule: string;
  imageIntent: string;
  imageCount: [number, number];
  requiredKeywords: string[];
  hints: string[];
  fallbackLines: string[];
}

export interface ShapeRule {
  minLines: number;
  maxLines: number;
  minChars: number;
  maxChars: number;
  formatHint: string;
  linePrefix: string | null;
}

export const FACT_PREFIX = "• ";
export const CHECK_PREFIX = "▸ ";

export const SHAPE_RULES: Record<SectionShape, ShapeRule> = {
  prose: {
    minLines: 4,
    maxLines: 6,
    minChars: 110,
    maxChars: 340,
    formatHint: "문장 4~6개, 한 문장 25~45자, 문장마다 줄바꿈. 한 문단에 정보 하나.",
    linePrefix: null,
  },
  "lines-3": {
    minLines: 3,
    maxLines: 3,
    minChars: 60,
    maxChars: 180,
    formatHint: "정확히 3줄. 1줄: 무엇인지, 2줄: 누구에게 맞는지, 3줄: 핵심 조건이나 결론.",
    linePrefix: null,
  },
  "facts-list": {
    minLines: 4,
    maxLines: 7,
    minChars: 60,
    maxChars: 300,
    formatHint: `각 줄은 "${FACT_PREFIX}항목: 값" 형식. 확인된 값만 쓰고 모르면 "예약/판매 페이지 확인"으로 표기.`,
    linePrefix: FACT_PREFIX,
  },
  "qa-3": {
    minLines: 6,
    maxLines: 6,
    minChars: 150,
    maxChars: 420,
    formatHint: '정확히 3쌍. "Q. 질문" 줄 다음에 "A. 답변" 줄. 근거 없는 답은 "상세 페이지 확인"으로 안내.',
    linePrefix: null,
  },
  checklist: {
    minLines: 3,
    maxLines: 5,
    minChars: 60,
    maxChars: 260,
    formatHint: `각 줄은 "${CHECK_PREFIX}항목" 형식으로 3~5줄. 조건형으로 쓰고 체험 단정 금지.`,
    linePrefix: CHECK_PREFIX,
  },
};

function pick(lines: string[], limit: number): string[] {
  return lines.filter(Boolean).slice(0, limit);
}

function factValue(ctx: LibraryContext, label: string): string | null {
  const line = ctx.factLines.find((value) => value.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim() : null;
}

// ---------------------------------------------------------------------------
// 쇼핑커넥트
// ---------------------------------------------------------------------------

function shoppingTemplates(ctx: LibraryContext): Record<string, SectionTemplate> {
  const name = ctx.shortName;
  const keyword = ctx.primaryKeyword;
  const price = factValue(ctx, "가격") || ctx.price || "판매 페이지 확인";
  // 확인 사실 줄은 "상세 근거: …" 형식이다 (product-editorial-plan.buildProductEditorialPlan 참고).
  const features = ctx.factLines.filter((line) => /^(?:상세 근거|특징):/u.test(line)).map((line) => line.replace(/^(?:상세 근거|특징):\s*/u, "").trim());
  const feature1 = features[0] || "핵심 기능";
  const feature2 = features[1] || "구성";
  return {
    "summary-glance": {
      role: "summary-glance",
      title: `${keyword} 한눈에 보기`,
      headerFormat: "quotation",
      shape: "lines-3",
      purpose: "검색·AI 요약이 그대로 인용할 수 있는 3줄 요약. 무엇인지, 누구에게 맞는지, 핵심 조건.",
      evidenceRule: "상품명·확인된 특징·가격만 사용. 첫 줄에 상품명을 그대로 포함.",
      imageIntent: "대표 이미지(썸네일)가 이 섹션 앞에 온다.",
      imageCount: [0, 0],
      requiredKeywords: [name],
      hints: ["첫 줄은 상품명으로 시작", "광고 문구 대신 사실 요약", "3줄을 넘기지 않기"],
      fallbackLines: [
        `${name}은 ${feature1}을 중심으로 살펴볼 ${keyword} 상품이에요.`,
        `${feature2}까지 함께 확인하면 어떤 분께 맞는지 판단하기 쉬워요.`,
        `표시 가격은 ${price} 기준이고 옵션에 따라 달라질 수 있어요.`,
      ],
    },
    "hook-problem": {
      role: "hook-problem",
      title: "구매 전에 먼저 볼 기준",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "독자가 해결하려는 문제와 선택 기준을 짧게 제시하고 공감으로 연다.",
      evidenceRule: "독자의 일반적인 고민으로 표현하고 작성자의 구매·사용 경험을 만들지 않기.",
      imageIntent: "이미지 없음(요약 바로 뒤)",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["인사말 없이 상황으로 바로 시작", "고민을 1~2문장으로 공감", "이 글에서 확인할 기준 예고"],
      fallbackLines: [
        `${keyword}를 고를 때는 기능 이름보다 실제로 어디에 쓸지가 먼저예요.`,
        "비슷한 상품이 많아서 비교 기준이 없으면 가격만 보게 되더라고요.",
        `그래서 ${name}은 구성, 핵심 기능, 가격 조건 순서로 정리했어요.`,
        "확인된 정보만 담았고 판단은 독자 상황에 맞게 하시면 돼요.",
      ],
    },
    "product-reveal": {
      role: "product-reveal",
      title: "상품 구성과 핵심 특징",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "상품이 무엇이고 어떤 구성인지 명확히 소개.",
      evidenceRule: "상품명·설명·판매페이지에서 확인된 구성만 사용.",
      imageIntent: "전체 구성 또는 패키지가 보이는 이미지",
      imageCount: [1, 2],
      requiredKeywords: [name],
      hints: ["앞 이미지가 보여주는 구성을 문장으로 설명", "특징은 나열 대신 하나씩 풀어쓰기"],
      fallbackLines: [
        `${name}의 기본 구성은 판매 페이지에 표시된 항목 그대로예요.`,
        `${feature1}이 이 상품의 첫 번째 특징으로 보여요.`,
        `${feature2}도 함께 확인해두면 사용 장면이 그려져요.`,
        "옵션별로 구성이 달라질 수 있으니 주문 화면에서 다시 확인해보세요.",
      ],
    },
    "key-facts": {
      role: "key-facts",
      title: "핵심 정보 정리",
      headerFormat: "sectionTitle",
      shape: "facts-list",
      purpose: "GEO 엔티티 블록. 가격·구성·소재·크기·배송처럼 확인된 값을 항목별로 정리.",
      evidenceRule: "제공된 확인 사실만 사용. 없는 항목은 만들지 말고 '판매 페이지 확인'으로 표기.",
      imageIntent: "스펙, 재질, 디테일을 확인할 수 있는 이미지",
      imageCount: [1, 1],
      requiredKeywords: [],
      hints: ["항목: 값 형식", "숫자·단위는 원문 그대로", "4~7줄"],
      fallbackLines: [
        `${FACT_PREFIX}상품명: ${ctx.productName}`,
        `${FACT_PREFIX}가격: ${price}`,
        ...pick(features.map((value) => `${FACT_PREFIX}특징: ${value}`), 3),
        `${FACT_PREFIX}배송: ${factValue(ctx, "배송") || "판매 페이지 확인"}`,
      ],
    },
    benefit: {
      role: "benefit",
      title: "기능이 주는 실제 이점",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "기능 나열을 독자 관점의 효익으로 번역.",
      evidenceRule: "확인된 기능에서 합리적으로 이어지는 이점만 쓰고 성능을 과장하지 않기.",
      imageIntent: "핵심 기능을 보여주는 상세 이미지",
      imageCount: [1, 2],
      requiredKeywords: [],
      hints: ["기능 → 그래서 독자에게 무엇이 편한지", "조건형 표현(~라면 ~하기 좋겠어요)"],
      fallbackLines: [
        `${feature1}은 매일 쓰는 상황에서 손이 덜 가게 해주는 부분이에요.`,
        "기능 이름보다 그 기능이 줄여주는 수고를 기준으로 보면 판단이 쉬워요.",
        `${feature2}까지 있으면 보관이나 정리 단계도 함께 편해질 수 있어요.`,
        "다만 사용 환경에 따라 체감이 달라서 상세 설명을 한 번 더 보는 편이 좋아요.",
      ],
    },
    "use-case": {
      role: "use-case",
      title: "어떤 상황에 잘 맞는지",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "사용 장면과 추천 대상을 구체화.",
      evidenceRule: "직접 써봤다는 표현 없이 적합한 상황을 조건형으로 설명.",
      imageIntent: "사용 장면 또는 크기감을 보여주는 이미지",
      imageCount: [1, 2],
      requiredKeywords: [],
      hints: ["장면 2~3개를 구체적으로", "누구에게는 덜 맞는지도 한 줄"],
      fallbackLines: [
        `${name}은 집이나 사무실처럼 자주 손이 가는 자리에 두고 쓰기 좋아 보여요.`,
        "이동이 잦은 분이라면 크기와 무게를 먼저 확인하는 편이 안전해요.",
        "선물용이라면 구성품과 포장 상태를 상세 이미지에서 확인해보세요.",
        "반대로 특정 기능 하나만 필요하다면 더 단순한 상품이 맞을 수도 있어요.",
      ],
    },
    proof: {
      role: "proof",
      title: "스펙과 상세 정보로 확인",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "앞선 효익을 스펙·구성·평점 등 확인 가능한 정보로 뒷받침.",
      evidenceRule: "가격·할인·리뷰·평점 수치는 제공된 값이 있을 때만 사용.",
      imageIntent: "스펙, 재질, 디테일 이미지",
      imageCount: [1, 1],
      requiredKeywords: [],
      hints: ["숫자는 원문 그대로", "확인 안 된 수치는 쓰지 않기"],
      fallbackLines: [
        "상세 페이지의 스펙 표는 크기, 재질, 구성 순서로 보면 빠르게 읽혀요.",
        `${feature1}과 관련된 항목은 표에서 단위까지 같이 확인해보세요.`,
        factValue(ctx, "리뷰 수")
          ? `리뷰 수는 ${factValue(ctx, "리뷰 수")}로 표시되어 있어 참고 지표가 돼요.`
          : "리뷰와 평점은 판매 페이지에서 최신 값을 확인하는 편이 정확해요.",
        "사진과 스펙이 다르게 느껴지면 옵션 설명을 한 번 더 읽어보세요.",
      ],
    },
    comparison: {
      role: "comparison",
      title: "비슷한 제품과 비교할 기준",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "무근거 순위 대신 선택 기준과 차이를 설명.",
      evidenceRule: "경쟁 제품의 미확인 수치·우열은 쓰지 않고 비교 항목만 제시.",
      imageIntent: "옵션, 구성, 크기 차이를 비교할 수 있는 이미지",
      imageCount: [0, 1],
      requiredKeywords: [],
      hints: ["비교 항목 3개 정도", "우열 단정 금지"],
      fallbackLines: [
        `${keyword}를 비교할 때는 구성, 크기, 관리 방법 세 가지를 먼저 놓고 보면 좋아요.`,
        "가격 차이는 구성 차이에서 오는 경우가 많아서 같은 조건으로 맞춰 비교해야 해요.",
        `${name}은 ${feature1}이 기준이 되는 상품이라 이 항목을 중심으로 보면 돼요.`,
        "다른 상품이 더 나은 상황도 있으니 사용 목적을 먼저 정해두세요.",
      ],
    },
    "offer-check": {
      role: "offer-check",
      title: "가격과 혜택 확인 포인트",
      headerFormat: "sectionTitle",
      shape: "facts-list",
      purpose: "가격·쿠폰·배송을 구매 판단 정보로 정리.",
      evidenceRule: "현재 확인된 값만 쓰고 최종 결제 화면 재확인을 안내.",
      imageIntent: "옵션 또는 구성 확인 이미지",
      imageCount: [0, 1],
      requiredKeywords: [],
      hints: ["항목: 값", "최저가·1위 같은 단정 금지"],
      fallbackLines: [
        `${FACT_PREFIX}표시 가격: ${price}`,
        `${FACT_PREFIX}할인: ${factValue(ctx, "할인율") || "판매 페이지 확인"}`,
        `${FACT_PREFIX}쿠폰/혜택: ${factValue(ctx, "쿠폰/혜택") || "결제 화면에서 적용 여부 확인"}`,
        `${FACT_PREFIX}배송: ${factValue(ctx, "배송") || "판매 페이지 확인"}`,
        `${FACT_PREFIX}확인 시점: ${ctx.collectedAt} 기준, 이후 변동 가능`,
      ],
    },
    faq: {
      role: "faq",
      title: "자주 묻는 질문",
      headerFormat: "sectionTitle",
      shape: "qa-3",
      purpose: "GEO Q&A 블록. 구매 전 궁금한 점 3가지를 질문-답 형식으로.",
      evidenceRule: "확인되지 않은 정책·성능은 단정하지 말고 확인 방법을 답으로 제시.",
      imageIntent: "이미지 없음",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["Q. / A. 형식 3쌍", "옵션·배송·관리처럼 실제로 검색하는 질문"],
      fallbackLines: [
        `Q. ${name}은 어떤 용도에 맞나요?`,
        `A. ${feature1}이 필요한 상황에 맞고, 자세한 용도는 상세 설명을 참고하면 돼요.`,
        "Q. 옵션은 어떻게 고르나요?",
        "A. 주문 화면의 옵션 표에서 구성과 가격 차이를 비교한 뒤 고르면 돼요.",
        "Q. 배송과 교환 조건은요?",
        "A. 판매 페이지의 배송·교환 안내가 기준이라 결제 전에 한 번 확인해보세요.",
      ],
    },
    "fit-checklist": {
      role: "fit-checklist",
      title: "이런 분께 잘 맞아요",
      headerFormat: "sectionTitle",
      shape: "checklist",
      purpose: "추천 대상을 조건형 체크리스트로 요약하고 다음 행동을 안내.",
      evidenceRule: "강매·품절 임박·최저가 단정을 피하고 상세 조건 확인으로 연결.",
      imageIntent: "대표 이미지 재노출 또는 이미지 없음",
      imageCount: [0, 1],
      requiredKeywords: [],
      hints: ["3~5줄 체크리스트", "마지막 줄에 아래 링크에서 확인 안내"],
      fallbackLines: [
        `${CHECK_PREFIX}${feature1}이 필요한 분`,
        `${CHECK_PREFIX}${keyword}를 처음 고르며 구성부터 비교하고 싶은 분`,
        `${CHECK_PREFIX}가격 조건을 확인한 뒤 결정하고 싶은 분`,
        `${CHECK_PREFIX}자세한 옵션과 가격은 아래 링크에서 확인해보세요`,
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 여행커넥트
// ---------------------------------------------------------------------------

function travelTemplates(ctx: LibraryContext, usedKnowledge: Set<string>): Record<string, SectionTemplate> {
  const destination = ctx.destination || "여행지";
  const duration = ctx.duration || "일정";
  const conditions = ctx.travel?.conditions || [];
  const conditionText = conditions.join(", ") || "예약 페이지 확인";
  const highlights = ctx.highlights;
  const highlightText = highlights.slice(0, 4).join(", ") || "상세 일정표의 주요 방문지";
  const price = ctx.price || "출발일별 확인 필요";
  const keyword = ctx.primaryKeyword || `${destination} 패키지`;
  // 목적지 배경 지식: 일정 흐름 섹션에서 최대 2줄. 코스 포인트가 같은 장소를 다루면 그쪽이 우선 쓰도록 여기서는 예약만 한다.
  const overviewKnowledge: string[] = [];
  for (const name of ctx.travel?.destinations.slice(0, 3) || [destination]) {
    if (overviewKnowledge.length >= 2) break;
    const found = findDestinationKnowledge(name, usedKnowledge);
    if (found) {
      usedKnowledge.add(found.key);
      overviewKnowledge.push(found.line);
    }
  }
  return {
    "summary-glance": {
      role: "summary-glance",
      title: `${destination} ${duration} 여행, 결론부터`,
      headerFormat: "quotation",
      shape: "lines-3",
      purpose: "결론 선행 요약. 어떤 상품인지, 누구에게 맞는지, 확인된 핵심 조건.",
      evidenceRule: "상품명·기간·목적지·확인된 조건만. 방문 경험은 만들지 않기.",
      imageIntent: "대표 이미지(썸네일)가 이 섹션 앞에 온다.",
      imageCount: [0, 0],
      requiredKeywords: [destination],
      hints: ['첫 줄은 "결론부터 말하면"처럼 결론을 먼저', "확인된 조건(직항·노쇼핑 등)만", "3줄"],
      fallbackLines: [
        `결론부터 말하면 ${ctx.shortName}${topicParticle(ctx.shortName)} ${destination}을 ${duration}에 묶어 보는 패키지예요.`,
        "동선 짜는 시간을 아끼고 핵심 명소를 놓치기 싫은 분께 맞는 구성이에요.",
        `확인된 조건은 ${conditionText}이고, 세부 조건은 예약 페이지 기준으로 정리했어요.`,
      ],
    },
    "key-facts": {
      role: "key-facts",
      title: "상품 한눈에 보기",
      headerFormat: "sectionTitle",
      shape: "facts-list",
      purpose: "GEO 엔티티 블록. 여행사·기간·항공·숙박·최소 출발 인원·쇼핑/옵션·포함 범위를 항목별로.",
      evidenceRule: "상품명과 수집 정보에서 확인된 값만. 없는 항목은 '예약 페이지 확인'.",
      imageIntent: "이미지 없음",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["항목: 값 형식 4~7줄", "마지막 줄에 가격 변동 안내"],
      fallbackLines: [
        `${FACT_PREFIX}상품명: ${ctx.productName}`,
        `${FACT_PREFIX}여행 기간: ${duration}`,
        `${FACT_PREFIX}주요 방문지: ${highlightText}`,
        `${FACT_PREFIX}확인된 조건: ${conditionText}`,
        `${FACT_PREFIX}표시 가격: ${price} (출발일·인원·객실에 따라 변동)`,
      ],
    },
    "itinerary-overview": {
      role: "itinerary-overview",
      title: "전체 일정 흐름",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "긴 상품명을 코스 흐름으로 풀어 독자가 전체 그림을 잡게 한다.",
      evidenceRule: "상품명에 없는 날짜별 순서와 자유시간은 임의로 붙이지 않기.",
      imageIntent: "일정 요약 카드 또는 여러 목적지가 보이는 풍경",
      imageCount: [1, 1],
      requiredKeywords: [],
      hints: ["방문 포인트를 순서 있는 흐름으로", "일자 배정이 확인되지 않으면 '일정표 기준' 표기"],
      fallbackLines: [
        `${keyword}를 고를 때는 ${highlightText}를 어떤 순서로 도는지부터 보면 ${ctx.shortName}의 흐름이 잡혀요.`,
        ...overviewKnowledge,
        "상품명에 적힌 방문지를 순서대로 따라가면 하루 단위 동선이 대략 그려져요.",
        "정확한 일자별 순서와 자유시간은 예약 페이지의 일정표가 기준이에요.",
      ],
    },
    "day-course": {
      role: "day-course",
      title: "코스 포인트",
      headerFormat: "quotation",
      shape: "prose",
      purpose: "방문지 하나를 장면처럼 소개하고 현지 팁(시간대·사진·먹거리)을 덧붙인다.",
      evidenceRule: "널리 알려진 사실만. 운영시간·입장료처럼 변동 정보는 '출발 전 확인'으로. 방문 경험 단정 금지.",
      imageIntent: "해당 방문지의 실제 풍경 사진",
      imageCount: [1, 2],
      requiredKeywords: [],
      hints: ["장소가 어떤 곳인지 1~2문장", "현지 팁 1~2문장(찾아보니 ~라고 해요 식)", "일정 안에서의 위치"],
      fallbackLines: [],
    },
    inclusions: {
      role: "inclusions",
      title: "가격, 포함과 불포함",
      headerFormat: "sectionTitle",
      shape: "facts-list",
      purpose: "포함/불포함·현지 지불·1인실 추가·유류할증 변동처럼 예산에 영향을 주는 항목 정리.",
      evidenceRule: "확인된 조건만. 미확인 항목은 '예약 페이지 확인'으로.",
      imageIntent: "숙박, 식사, 교통 중 상품 조건을 설명할 수 있는 사진",
      imageCount: [1, 1],
      requiredKeywords: [],
      hints: ["항목: 값", "표시 가격 외 현지 지불 항목을 강조"],
      fallbackLines: [
        `${FACT_PREFIX}표시 가격: ${price}`,
        `${FACT_PREFIX}포함 범위: 항공·숙박·차량·입장료 포함 여부는 예약 페이지 확인`,
        `${FACT_PREFIX}불포함 항목: 개인 경비, 선택 관광, 현지 지불 경비 확인`,
        `${FACT_PREFIX}변동 요소: 유류할증료·환율은 예약 시점에 따라 달라짐`,
        `${FACT_PREFIX}조건 메모: ${conditionText} 상품이라 표시 가격 외 현지 지불 항목은 예약 페이지 기준`,
      ],
    },
    "reasons-3": {
      role: "reasons-3",
      title: "이 상품을 고르는 이유 3가지",
      headerFormat: "sectionTitle",
      shape: "checklist",
      purpose: "확인된 조건에서 나오는 장점 3가지를 짧게.",
      evidenceRule: "상품명·조건에서 확인된 장점만. 과장 금지.",
      imageIntent: "이미지 없음",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["정확히 3줄", '각 줄은 "이유: 한 문장 설명"'],
      fallbackLines: [
        `${CHECK_PREFIX}효율 동선: ${duration} 안에 ${highlightText}를 묶어 볼 수 있어요`,
        `${CHECK_PREFIX}조건 확인: ${conditionText}처럼 상품에 표시된 조건을 기준으로 비교할 수 있어요`,
        `${CHECK_PREFIX}준비 부담 감소: 교통·숙소를 따로 예약하지 않아도 돼요`,
      ],
    },
    "booking-check": {
      role: "booking-check",
      title: "예약 전 체크리스트",
      headerFormat: "sectionTitle",
      shape: "checklist",
      purpose: "입국 서류·날씨/옷차림·환전/결제·준비물·취소 규정처럼 출발 전 확인 항목.",
      evidenceRule: "변동되는 제도·날씨·환율은 '출발 전 확인'으로 표기.",
      imageIntent: "이미지 없음",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["3~5줄", "각 줄에 왜 확인해야 하는지 짧게"],
      fallbackLines: [
        `${CHECK_PREFIX}입국 서류: ${destination} 입국 요건은 출발 전 최신 안내로 확인`,
        `${CHECK_PREFIX}날씨와 옷차림: 출발 시기의 예보를 보고 겉옷·우비 준비`,
        `${CHECK_PREFIX}환전과 결제: 현지 결제 수단과 환율은 출발 직전 확인`,
        `${CHECK_PREFIX}취소·변경 규정: 출발 확정 여부와 함께 예약 페이지에서 확인`,
      ],
    },
    faq: {
      role: "faq",
      title: "자주 묻는 질문",
      headerFormat: "sectionTitle",
      shape: "qa-3",
      purpose: "GEO Q&A 블록. 예약 전 궁금한 점 3가지.",
      evidenceRule: "확인되지 않은 일정·가격·정책은 단정하지 말고 확인 방법을 답으로.",
      imageIntent: "이미지 없음",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["Q. / A. 형식 3쌍", "출발 인원·자유시간·추가 비용처럼 실제 검색 질문"],
      fallbackLines: [
        "Q. 최소 출발 인원이 안 되면 어떻게 되나요?",
        ctx.travel?.departureConfirmed
          ? "A. 이 상품은 출발확정 표시가 있어 인원 미달로 취소될 걱정이 적고, 세부 규정은 예약 페이지 기준을 따라요."
          : "A. 출발 확정 여부는 예약 시점에 안내되고, 인원 미달 시 처리 방식은 예약 페이지에 적힌 기준을 따라요.",
        "Q. 자유시간은 얼마나 있나요?",
        "A. 일정표에 자유시간이 표시된 날을 기준으로 보고, 그 시간에 맞춰 근처 산책이나 카페 방문을 계획하면 알차요.",
        "Q. 표시 가격 외에 더 내는 비용이 있나요?",
        "A. 현지 지불 경비, 선택 관광, 1인실 추가 요금은 상품 조건에 따로 적혀 있어 예약 전에 합산해 두면 예산이 맞아요.",
      ],
    },
    "fit-checklist": {
      role: "fit-checklist",
      title: "이런 분께 잘 맞아요",
      headerFormat: "sectionTitle",
      shape: "checklist",
      purpose: "여행 방식과 맞는지 판단하게 하는 추천 대상 체크리스트.",
      evidenceRule: "장점 나열 대신 조건형. 다른 방식이 맞는 분도 한 줄.",
      imageIntent: "이미지 없음",
      imageCount: [0, 0],
      requiredKeywords: [],
      hints: ["3~5줄", "마지막 줄은 자유여행이 더 맞는 경우"],
      fallbackLines: [
        `${CHECK_PREFIX}${keyword}로 ${destination} 핵심 명소를 ${duration} 안에 보고 싶은 분`,
        `${CHECK_PREFIX}동선과 숙소 예약에 시간을 쓰기 어려운 분`,
        `${CHECK_PREFIX}가족·부모님과 함께라 이동 부담을 줄이고 싶은 분`,
        `${CHECK_PREFIX}반대로 자유시간이 가장 중요한 분께는 자유여행 쪽을 더 추천해요`,
      ],
    },
    closing: {
      role: "closing",
      title: "마무리",
      headerFormat: "sectionTitle",
      shape: "prose",
      purpose: "한 줄 정리 + 아래 링크에서 출발일별 가격·잔여 좌석 확인 안내.",
      evidenceRule: "체험 단정 없이 검토 소감으로. 링크 URL 은 본문에 쓰지 않기(카드로 삽입됨).",
      imageIntent: "여운을 남기는 마지막 풍경",
      imageCount: [0, 1],
      requiredKeywords: [],
      hints: ["한 줄 정리로 시작", "아래 링크에서 확인 안내", "댓글 유도 한 줄"],
      fallbackLines: [
        `${keyword} 중에서 ${ctx.shortName}${topicParticle(ctx.shortName)} ${duration} 안에 ${destination}의 핵심을 알차게 묶은 구성이라는 점이 눈에 들어와요.`,
        "동선 고민 없이 편하게 다니면서 가성비도 챙기고 싶은 분께 먼저 추천드리고 싶어요.",
        "정확한 출발일별 가격과 잔여 좌석은 아래 여행커넥트 링크에서 확인할 수 있어요.",
        "궁금한 점은 댓글로 남겨주시면 아는 범위에서 답변드릴게요.",
      ],
    },
  };
}

interface DayCourseOptions {
  highlight: string;
  index: number;
  /** 같은 유형의 앞선 코스 수 */
  variant: number;
  /** generic 문장 세트 번호(글 전체 기준) */
  genericVariant: number;
  usedKnowledge: Set<string>;
}

function dayCourseTemplate(base: SectionTemplate, ctx: LibraryContext, options: DayCourseOptions): SectionTemplate {
  const { highlight, index } = options;
  const title = highlight ? `코스 포인트 ${index + 1} · ${highlight}` : `코스 포인트 ${index + 1} · 주요 방문지`;
  const place = highlight || "주요 방문지";
  const destinations = ctx.travel?.destinations || [];
  // 코스 포인트가 특정 목적지를 이름에 품고 있으면(호이안 야시장 등) 그 목적지를, 아니면 첫 목적지를 쓴다.
  const primaryDestination = destinations.find((name) => highlight.includes(name)) || destinations[0] || ctx.destination || "이 지역";
  const knowledge = highlight ? findDestinationKnowledge(highlight, options.usedKnowledge) : null;
  if (knowledge) options.usedKnowledge.add(knowledge.key);
  const courseLines = buildHighlightCourseLines({
    highlight: place,
    destination: primaryDestination,
    variant: options.variant,
    genericVariant: options.genericVariant,
  });
  // 배경 지식은 소개 문장 바로 뒤에 넣어 "어떤 곳인지 → 풍경 → 즐길 거리 → 팁" 순서를 유지한다.
  const fallbackLines = knowledge ? [courseLines[0], knowledge.line, ...courseLines.slice(1)] : courseLines;
  return {
    ...base,
    title,
    imageIntent: `${place}와 연결되는 실제 여행지 사진`,
    requiredKeywords: highlight ? [highlight] : [],
    hints: [...base.hints, ...(knowledge ? [`널리 알려진 배경(그대로 인용 가능): ${knowledge.line}`] : [])],
    fallbackLines,
  };
}

export function buildSectionTemplates(ctx: LibraryContext, count: number): SectionTemplate[] {
  if (ctx.kind === "SHOPPING") {
    const lib = shoppingTemplates(ctx);
    const proofOrComparison = ctx.hasReviewProof ? lib.proof : lib.comparison;
    const full: SectionTemplate[] = [
      lib["summary-glance"],
      lib["hook-problem"],
      lib["product-reveal"],
      lib["key-facts"],
      lib.benefit,
      lib["use-case"],
      proofOrComparison,
      lib["offer-check"],
      lib.faq,
      lib["fit-checklist"],
    ];
    const target = Math.max(8, Math.min(10, count));
    const dropOrder: SectionRole[] = ["proof", "comparison", "offer-check"];
    const selected = [...full];
    for (const role of dropOrder) {
      if (selected.length <= target) break;
      const at = selected.findIndex((section) => section.role === role);
      if (at >= 0) selected.splice(at, 1);
    }
    return selected.slice(0, target);
  }

  const target = Math.max(10, Math.min(12, count));
  const dayCount = Math.max(1, Math.min(3, target - 9));
  const highlights = ctx.highlights.slice(0, dayCount);
  while (highlights.length < dayCount) highlights.push("");
  // 코스 포인트 문장이 서로 겹치지 않도록 유형별 변형 번호와 generic 번호를 글 단위로 센다.
  const usedKnowledge = new Set<string>();
  const kindCounts = new Map<HighlightKind, number>();
  let genericVariant = 0;
  const dayCourseOptions: DayCourseOptions[] = highlights.map((highlight, index) => {
    const kind = classifyHighlight(highlight);
    const variant = kindCounts.get(kind) || 0;
    kindCounts.set(kind, variant + 1);
    const options: DayCourseOptions = { highlight, index, variant, genericVariant, usedKnowledge };
    if (usesGenericCopy(kind, variant)) genericVariant += 1;
    return options;
  });
  // 코스 포인트가 먼저 배경 지식을 가져가고, 남은 목적지 지식만 일정 흐름 섹션이 쓴다.
  const dayCourseBase = travelTemplates(ctx, new Set<string>())["day-course"];
  const dayCourses = dayCourseOptions.map((options) => dayCourseTemplate(dayCourseBase, ctx, options));
  const lib = travelTemplates(ctx, usedKnowledge);
  return [
    lib["summary-glance"],
    lib["key-facts"],
    lib["itinerary-overview"],
    ...dayCourses,
    lib.inclusions,
    lib["reasons-3"],
    lib["booking-check"],
    lib.faq,
    lib["fit-checklist"],
    lib.closing,
  ].slice(0, target);
}

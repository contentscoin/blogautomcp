import { SHOPPING_POST_STRATEGY } from "../../src/lib/shopping-post-strategy";

export type AdaptiveEditorialKind = "SHOPPING" | "TRAVEL";

export interface AdaptiveEditorialProfile {
  sourcePackId: string;
  sourceCount: number;
  collectedAt: string;
  observedBodyChars: { p25: number; median: number; p75: number };
  observedImages: { p25: number; median: number; p75: number };
  sectionRange: { min: number; preferred: number; max: number };
  essentialDecisionLenses: string[];
  optionalNarrativeMoves: string[];
  styleSignals: string[];
  avoidPatterns: string[];
}

export const ADAPTIVE_EDITORIAL_PROFILES: Record<AdaptiveEditorialKind, AdaptiveEditorialProfile> = {
  SHOPPING: {
    sourcePackId: "naver-shopping-top-post-patterns-2026-08-30",
    sourceCount: 132,
    collectedAt: "2026-08-30",
    observedBodyChars: { p25: 1220, median: 1843, p75: 2398 },
    observedImages: { p25: 9, median: 15, p75: 21 },
    sectionRange: { ...SHOPPING_POST_STRATEGY.sections },
    essentialDecisionLenses: [
      "독자가 겪는 생활 문제 또는 선택 기준과 정확한 상품 정체",
      "선택 옵션에서 확인된 용량·수량·구성과 사용 대상",
      "서로 다른 확인 특징이 어떤 구매 판단에 도움이 되는지, 판매자 설명과 실측·체험 근거의 차이",
      "확인된 주의사항·사용기간·관리 조건에 맞춘 사용 계획; 없는 사용법이나 작동 원리를 만들지 않기",
      "어떤 조건의 독자에게 맞는지와 구매 전 확인할 핵심 항목",
    ],
    optionalNarrativeMoves: [
      "설명서로 확인되는 개봉·설치·사용 순서",
      "근거가 있는 옵션 또는 대안 비교",
      "사용 빈도와 환경에 따른 기능 조합 추천",
      "수집된 후기 원문이나 검증된 체험 메모가 있을 때만 실제 사용 맥락",
    ],
    styleSignals: [
      "짧은 모바일 문단과 사진·설명의 교차 배치",
      "부드러운 요체와 근거가 보이는 조건부 판단",
      "제품명·카테고리 키워드는 제목과 초반에 자연스럽게 한 번씩",
      "정보 나열보다 사실이 독자에게 주는 의미를 설명",
      "확인된 특징을 선택 조건과 연결하되 사용감·효능을 추정하지 않기",
    ],
    avoidPatterns: [
      "고정된 소제목 수와 순서를 맞추기 위한 빈 문단",
      "하네스의 역할명·근거 라벨·판단 문구 복사",
      "배송·쿠폰·확인 안내만으로 제품 리뷰 대체",
      "상품 설명에는·상세페이지에 적혀 있다는 문장을 반복하는 낭독형 전개",
      "후기 수·평점만 보고 실제 후기 내용을 만들어내는 문장",
      "검증되지 않은 직접 구매·사용 경험과 성능 수치",
      "직접 써보지 않았다는 고백·검증 작업 보고·같은 미확인 안내를 절마다 반복",
      "주어 없는 선동·근거 없는 고민 과장·모든 독자에게 필요한 것처럼 구매 압박",
      "키워드 반복·가격 나열·강추 문구 중심의 자동홍보형 전개",
    ],
  },
  TRAVEL: {
    sourcePackId: "naver-travel-top-post-patterns-2026-08-30",
    sourceCount: 137,
    collectedAt: "2026-08-30",
    observedBodyChars: { p25: 1777, median: 2197, p75: 2742 },
    observedImages: { p25: 18, median: 29, p75: 39 },
    sectionRange: { min: 7, preferred: 9, max: 12 },
    essentialDecisionLenses: [
      "여행지의 역사·문화·지리적 배경과 이 장소가 특별한 이유",
      "핵심 장소에서 실제로 마주치는 풍경·소리·거리 분위기",
      "현지에서 보고 걷고 먹고 사진 찍으며 즐길 수 있는 경험",
      "일정 순서에 따라 장면이 어떻게 바뀌고 하루가 어떻게 흐르는지",
      "처음 가는 독자에게 바로 도움이 되는 교통·복장·시간대·관람 팁",
      "장소마다 놓치지 말아야 할 포인트와 여행을 더 깊게 만드는 배경지식",
      "여행을 마친 뒤 기억에 남을 대표 장면과 감정적 여운",
    ],
    optionalNarrativeMoves: [
      "일차별 브이로그 흐름 또는 장소 중심 흐름 중 장면이 풍부한 방식 선택",
      "지역 음식·시장·카페·산책로처럼 일정 주변에서 누릴 수 있는 경험",
      "아침·낮·노을·야경에 따라 달라지는 장소의 분위기",
      "사진이 잘 나오는 구도와 걷기 좋은 동선, 쉬어가기 좋은 지점",
    ],
    styleSignals: [
      "여행지를 처음 알아보는 독자가 눈앞에 장면을 그릴 수 있는 설명",
      "짧은 모바일 문단과 여행 사진의 촘촘한 교차 배치",
      "확인된 사실은 단정적인 정보형 문장으로, 장면은 생생한 현장형 문장으로 표현",
      "상품 홍보는 가격 설명이 아니라 여행지의 매력과 경험을 선명하게 보여주는 방식으로 수행",
      "여행지·기간 키워드는 제목과 초반에 자연스럽게 배치",
    ],
    avoidPatterns: [
      "쇼핑 제품의 배송·구성품·스펙·교환 문구",
      "모든 여행상품에 동일한 일차별 목차 강요",
      "가격·할인·포함조건·예약 확인을 반복하는 상품 상세페이지 요약",
      "보입니다·인 것 같아요·일 듯해요 같은 모호한 추정형 말투",
      "장소 이름만 바꾸면 그대로 재사용할 수 있는 겉핥기 설명",
      "검증되지 않은 직접 방문·탑승·숙박·식사 경험",
      "확인되지 않은 운영시간·입장료·날씨·호텔 등급 단정",
      "키워드 반복·예약 압박 중심의 자동홍보형 전개",
    ],
  },
};

export function getAdaptiveEditorialProfile(kind: AdaptiveEditorialKind): AdaptiveEditorialProfile {
  return ADAPTIVE_EDITORIAL_PROFILES[kind];
}

export function formatAdaptiveEditorialHarnessForPrompt(kind: AdaptiveEditorialKind): string {
  const profile = getAdaptiveEditorialProfile(kind);
  return [
    `[분석 우선 자유 생성 하네스 v1 · ${profile.sourcePackId}]`,
    `- 근거 표본: ${profile.sourceCount}건, 수집일 ${profile.collectedAt}`,
    "- 이 하네스는 완성 문장이나 고정 목차가 아니라 판단 방향을 제공합니다.",
    "- 관측 분포와 선택 렌즈는 참고이며, 공유 필수 작성 계약의 최소 분량·섹션·출력 형식을 완화하지 않습니다.",
    "- 근거가 없는 배경·장면·실용 정보는 생략합니다. 문체를 확정형으로 바꾸거나 evidenceFacts에 적는 것만으로 검증된 사실이 되지 않습니다.",
    "- 먼저 상품 사실·이미지·미확인 정보를 분석한 뒤, 한 문장짜리 편집 논지를 스스로 정하세요.",
    `- 본문은 근거 밀도에 따라 대략 ${profile.sectionRange.min}~${profile.sectionRange.max}개 흐름으로 자유롭게 묶습니다. 정확한 개수·제목·순서는 강제하지 않습니다.`,
    `- 관측 분포 참고: 본문 ${profile.observedBodyChars.p25}~${profile.observedBodyChars.p75}자(중앙 ${profile.observedBodyChars.median}), 이미지 ${profile.observedImages.p25}~${profile.observedImages.p75}장(중앙 ${profile.observedImages.median}). 목표 할당량이 아니라 정보 밀도 점검용입니다.`,
    ...(kind === "SHOPPING" ? [
      `- 현재 쇼핑 전략 ${SHOPPING_POST_STRATEGY.version}: 글 중심 ${SHOPPING_POST_STRATEGY.sections.min}~${SHOPPING_POST_STRATEGY.sections.max}절, 이미지 ${SHOPPING_POST_STRATEGY.images.recommended}장 중심입니다. 과거 관측 이미지 수를 채우려고 슬롯이나 내용을 늘리지 않습니다.`,
      "- 대표·구성·생활 맥락은 참조 연출 또는 원본으로, 기능·수치·비교 근거는 검증된 원본 구간이나 그 사실을 옮긴 자료 카드로 설명합니다. 연출 이미지는 효능·실측·실제 체험의 증거가 아닙니다.",
    ] : []),
    "",
    "[반드시 답해야 할 독자 판단 질문 · 여러 질문을 한 섹션에 합쳐도 됨]",
    ...profile.essentialDecisionLenses.map((item) => `- ${item}`),
    "",
    "[근거가 충분할 때만 선택하는 전개]",
    ...profile.optionalNarrativeMoves.map((item) => `- ${item}`),
    "",
    "[문체·배치 힌트]",
    ...profile.styleSignals.map((item) => `- ${item}`),
    "",
    "[금지]",
    ...profile.avoidPatterns.map((item) => `- ${item}`),
    "- 분석 데이터의 라벨이나 하네스 문구를 원고에 그대로 복사하지 마세요.",
  ].join("\n");
}

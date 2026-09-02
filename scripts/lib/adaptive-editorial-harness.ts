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
    sectionRange: { min: 5, preferred: 7, max: 10 },
    essentialDecisionLenses: [
      "제품이 해결하려는 문제와 정확한 제품 정체",
      "핵심 기능이 어떤 구조로 작동하고 무엇을 더 편하게 만드는지",
      "설치·조작·충전·세척·보관을 포함한 구체적인 사용 방법",
      "기능과 규격이 실제 사용 장면에서 주는 이점",
      "실제 구매후기 원문이 있을 때 반복되는 좋은 점과 사용 맥락",
      "제품 자체의 장점과 구조상 제약 또는 미확인 핵심 성능",
      "잘 맞는 사용자·맞지 않는 사용자·대안 선택 기준",
      "기능·사용성·한계를 종합한 조건부 최종 판단",
    ],
    optionalNarrativeMoves: [
      "처음 개봉한 뒤 설치하고 사용하는 실제 순서",
      "기존 제품 또는 대안 카테고리와의 비교",
      "사용 빈도와 환경에 따른 기능 조합 추천",
      "이미지에서 직접 확인되는 디테일 해석",
    ],
    styleSignals: [
      "짧은 모바일 문단과 사진·설명의 교차 배치",
      "부드러운 요체와 근거가 보이는 조건부 판단",
      "제품명·카테고리 키워드는 제목과 초반에 자연스럽게 한 번씩",
      "정보 나열보다 사실이 독자에게 주는 의미를 설명",
      "스펙을 말한 직후 실제 사용법과 체감 가능한 이점을 연결",
    ],
    avoidPatterns: [
      "고정된 소제목 수와 순서를 맞추기 위한 빈 문단",
      "하네스의 역할명·근거 라벨·판단 문구 복사",
      "배송·쿠폰·확인 안내만으로 제품 리뷰 대체",
      "상품 설명에는·상세페이지에 적혀 있다는 문장을 반복하는 낭독형 전개",
      "후기 수·평점만 보고 실제 후기 내용을 만들어내는 문장",
      "검증되지 않은 직접 구매·사용 경험과 성능 수치",
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

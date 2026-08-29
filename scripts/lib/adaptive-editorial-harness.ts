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
      "판매페이지·이미지에서 확인된 기능·구조·규격",
      "확인 사실이 실제 사용 장면에서 주는 이점",
      "제품 자체의 장점과 구조상 제약 또는 미확인 핵심 성능",
      "잘 맞는 사용자·맞지 않는 사용자·대안 선택 기준",
      "가격과 구성을 포함한 조건부 최종 판단",
    ],
    optionalNarrativeMoves: [
      "구성품·디자인·설치·관리 과정",
      "기존 제품 또는 대안 카테고리와의 비교",
      "구매 전 짧은 체크리스트",
      "이미지에서 직접 확인되는 디테일 해석",
    ],
    styleSignals: [
      "짧은 모바일 문단과 사진·설명의 교차 배치",
      "부드러운 요체와 근거가 보이는 조건부 판단",
      "제품명·카테고리 키워드는 제목과 초반에 자연스럽게 한 번씩",
      "정보 나열보다 사실이 독자에게 주는 의미를 설명",
    ],
    avoidPatterns: [
      "고정된 소제목 수와 순서를 맞추기 위한 빈 문단",
      "하네스의 역할명·근거 라벨·판단 문구 복사",
      "배송·쿠폰·확인 안내만으로 제품 리뷰 대체",
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
      "이 상품이 만드는 여행 경험과 전체 일정·동선",
      "핵심 여행지의 위치·볼거리·코스 안에서의 가치",
      "항공·교통·숙박·식사 중 상품 정보로 확인되는 조건",
      "이동시간·보행·날씨·자유시간이 만드는 여행 강도",
      "포함·불포함·선택관광·가격 변동 등 예약 판단 조건",
      "상품 고유 장점과 아쉬운 점",
      "잘 맞는 여행자·맞지 않는 여행자·최종 예약 판단",
    ],
    optionalNarrativeMoves: [
      "일차별 흐름 또는 장소 중심 흐름 중 정보가 풍부한 방식 선택",
      "여행 준비물·옷차림·환전 등 근거가 있는 사전 준비",
      "사진이 보여주는 풍경·공간·이동 장면 해석",
      "비슷한 패키지나 자유여행과 갈리는 선택 기준",
    ],
    styleSignals: [
      "여행지를 처음 알아보는 독자가 장면을 그릴 수 있는 설명",
      "짧은 모바일 문단과 여행 사진의 촘촘한 교차 배치",
      "감각적 장면과 실용 정보 뒤에 상품 판단을 연결",
      "여행지·기간 키워드는 제목과 초반에 자연스럽게 배치",
    ],
    avoidPatterns: [
      "쇼핑 제품의 배송·구성품·스펙·교환 문구",
      "모든 여행상품에 동일한 일차별 목차 강요",
      "관광지 백과사전 설명만 있고 상품 동선·조건 판단이 없는 글",
      "검증되지 않은 직접 방문·탑승·숙박·식사 경험",
      "확인되지 않은 운영시간·입장료·날씨·호텔 등급 단정",
      "키워드 반복·가격 나열·예약 압박 중심의 자동홍보형 전개",
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

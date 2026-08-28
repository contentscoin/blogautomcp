export interface TravelProductFacts {
  duration: string | null;
  destinations: string[];
  highlights: string[];
  conditions: string[];
  departureConfirmed: boolean;
}

export interface TravelEditorialSection {
  title: string;
  purpose: string;
  imageIntent: string;
  body: string[];
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map(clean).filter((value) => value.length >= 2))).slice(0, limit);
}

function withTopicParticle(value: string): string {
  const last = value.at(-1) || "";
  const code = last.charCodeAt(0);
  const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${value}${hasBatchim ? "은" : "는"}`;
}

export function extractTravelProductFacts(
  productName: string,
  description = "",
  features: string[] = [],
): TravelProductFacts {
  const source = clean([productName, description, ...features].join(" "));
  const duration = source.match(/(?:\d+박\s*\d+일|\d+일)/u)?.[0]?.replace(/\s+/g, "") || null;
  const bracketHighlights = Array.from(source.matchAll(/[<〈]([^>〉]+)[>〉]/gu))
    .flatMap((match) => match[1].split(/[\/,+·]/u));
  const conditionMatchers = [
    /(?:출발확정|무조건출발)/gu,
    /(?:노|NO)\s*쇼핑/giu,
    /(?:노|NO)\s*옵션/giu,
    /(?:노|NO)\s*팁|팁\s*포함/giu,
    /(?:직항|국적기|인솔자\s*동반|전일정\s*\d성|시내\s*숙박)/giu,
  ];
  const conditions = unique(conditionMatchers.flatMap((matcher) => source.match(matcher) || []), 10);
  const highlights = unique(
    bracketHighlights.filter(
      (value) =>
        !/(?:출발확정|무조건출발|여행핫딜|깜짝특가|노\s*쇼핑|no\s*shopping|노\s*옵션|노\s*팁|직항|국적기|인솔자|특가|할인)/iu.test(
          value,
        ),
    ),
    12,
  );
  const destinationSource = source
    .replace(/\[[^\]]+\]|[<〈][^>〉]+[>〉]/gu, " ")
    .replace(/(?:출발확정|무조건출발|여행핫딜|깜짝특가|베스트셀러|패키지|일주|직항|\d+박\s*\d+일|\d+일)/gu, " ");
  const destinations = unique(
    destinationSource
      .split(/[\s/,+·()]+/u)
      .filter((token) => /[가-힣]{2,}/u.test(token) && token.length <= 12),
    8,
  );

  return {
    duration,
    destinations,
    highlights,
    conditions,
    departureConfirmed: /(?:출발확정|무조건출발)/u.test(source),
  };
}

export function formatTravelFactsForPrompt(facts: TravelProductFacts): string {
  return [
    "## 여행상품 전용 사실 카드",
    `- 여행 기간: ${facts.duration || "확인 필요"}`,
    `- 목적지 후보: ${facts.destinations.join(", ") || "상품명에서 확인 필요"}`,
    `- 일정/관광 포인트: ${facts.highlights.join(", ") || "상세 예약 페이지에서 확인 필요"}`,
    `- 확인된 조건: ${facts.conditions.join(", ") || "상세 예약 페이지에서 확인 필요"}`,
    "- 이 카드는 상품명과 수집된 상세정보에서 추출한 범위만 사용합니다.",
  ].join("\n");
}

function destinationLabel(facts: TravelProductFacts): string {
  return facts.destinations.slice(0, 2).join("·") || "여행지";
}

function highlightsLabel(facts: TravelProductFacts, limit = 4): string {
  return facts.highlights.slice(0, limit).join(", ") || "상세 일정표의 주요 방문지";
}

/**
 * 여행 인플루언서형 글의 독서 흐름을 재사용 가능한 구조로 만든다.
 * 실제 방문 경험은 만들지 않고 상품명/상세정보에서 확인된 사실만 장면형 문장으로 배치한다.
 */
export function buildTravelEditorialPlan(
  product: { name: string; description: string; features: string[]; price: string },
  targetSectionCount: number,
): TravelEditorialSection[] {
  const facts = extractTravelProductFacts(product.name, product.description, product.features);
  const destination = destinationLabel(facts);
  const duration = facts.duration || "일정";
  const highlights = highlightsLabel(facts);
  const conditions = facts.conditions.join(", ") || "출발일·포함사항·추가 비용";
  const confirmedHighlights = facts.highlights.slice(0, 4);

  const sections: TravelEditorialSection[] = [
    {
      title: `${destination} 여행, 먼저 보는 핵심`,
      purpose: "검색 독자가 첫 화면에서 지역·기간·상품 성격을 바로 이해하게 한다.",
      imageIntent: "여행지를 한눈에 보여주는 대표 풍경 또는 썸네일",
      body: [
        `${product.name}은 ${destination} 중심으로 살펴보는 ${duration} 여행상품이에요.`,
        `${highlights}가 상품명과 수집 정보에서 확인되는 주요 포인트예요.`,
        `${conditions}은 예약 버튼을 누르기 전에 한 번 더 확인하는 편이 좋아요.`,
        "먼저 전체 코스를 보고, 그다음 이동 강도와 포함 조건을 차례로 살펴볼게요.",
        "짧은 홍보 문구보다 실제 선택에 필요한 정보가 어디에 있는지 중심으로 정리했어요.",
      ],
    },
    {
      title: "전체 일정 한눈에 보기",
      purpose: "긴 상품명을 독자가 이해하기 쉬운 코스 흐름으로 바꾼다.",
      imageIntent: "일정 요약 카드 또는 여러 목적지가 보이는 풍경",
      body: [
        `이 상품은 ${highlights}를 중심으로 전체 흐름을 읽으면 이해하기 쉬워요.`,
        "상품명에 없는 날짜별 방문 순서와 자유시간은 임의로 붙이지 않았어요.",
        "실제 일자별 동선은 예약 페이지의 일정표를 기준으로 확인해야 해요.",
        "명소 개수보다 연속 이동 구간과 같은 지역에서 머무는 시간을 먼저 표시해두면 비교가 쉬워요.",
        "꼭 가고 싶은 장소가 있다면 선택한 출발일의 일정에도 그대로 포함되는지 확인하세요.",
      ],
    },
    {
      title: "출발 시기와 예약 조건",
      purpose: "날씨를 지어내지 않고 출발 가능 여부와 변동 조건을 먼저 점검한다.",
      imageIntent: "계절감이 드러나는 여행지 사진",
      body: [
        facts.departureConfirmed
          ? "상품명에는 출발확정 조건이 표시되어 있어 해당 출발일을 먼저 비교하기 좋아요."
          : "출발 확정 여부와 최소 출발 인원은 선택한 날짜 기준으로 확인해야 해요.",
        "같은 코스라도 출발일에 따라 항공편과 체류 시간이 달라질 수 있어요.",
        `${product.price || "표시 가격"}도 날짜·인원·객실 조건을 적용한 최종 단계에서 다시 확인하세요.`,
        "원하는 날짜가 정해졌다면 좌석 상태와 상품 조건을 같은 화면에서 함께 보는 편이 안전해요.",
        "출발일 후보를 두세 개 열어두면 일정과 가격 차이를 비교하기 한결 편해져요.",
      ],
    },
    ...confirmedHighlights.map((highlight, index): TravelEditorialSection => ({
      title: `코스 포인트 ${index + 1} · ${highlight}`,
      purpose: "상품에 실제 표기된 방문 포인트를 한 장면씩 풀어 독자가 여행을 상상하게 한다.",
      imageIntent: `${highlight}와 연결되는 실제 여행지 사진`,
      body: [
        `${withTopicParticle(highlight)} 이 상품이 전면에 내세운 주요 코스 중 하나예요.`,
        "사진만 보기보다 앞뒤 이동 순서와 현지 체류 시간을 함께 보는 게 중요해요.",
        "선택한 출발일의 상세 일정표에서 방문 방식과 포함 범위를 확인해보세요.",
        `${highlight}에서 기대하는 풍경이나 활동이 있다면 실제 일정에 확보된 시간이 충분한지도 비교해보세요.`,
        `사진 속 ${highlight}의 분위기와 실제 방문 계절이 다를 수 있다는 점도 같이 생각해두면 좋아요.`,
      ],
    })),
    {
      title: "이동 강도와 하루 리듬",
      purpose: "명소 개수보다 이동 횟수·체류 시간·휴식 여유를 판단하게 한다.",
      imageIntent: "차창, 열차, 도보 동선처럼 이동감을 보여주는 사진",
      body: [
        `${duration} 동안 여러 지역을 보는 상품이라면 이동 횟수와 연박 여부가 만족도를 크게 좌우해요.`,
        "관광지 수만 세기보다 하루에 머무는 시간과 자유시간을 같이 봐야 해요.",
        "아이·부모님과 함께라면 이른 출발과 장거리 이동 구간도 체크해보세요.",
        "연박 구간과 숙소 이동 횟수를 표시해두면 짐을 자주 옮겨야 하는지도 가늠할 수 있어요.",
        "하루 마지막 일정이 늦게 끝나는 날 다음 날의 출발 시간까지 이어서 보면 체감 강도가 보여요.",
      ],
    },
    {
      title: "포함 사항과 추가 비용",
      purpose: "쇼핑 상품의 스펙 대신 여행상품의 포함·불포함 판단 기준을 제공한다.",
      imageIntent: "숙박, 식사, 교통 중 상품 조건을 설명할 수 있는 사진",
      body: [
        `${conditions}이 현재 확인되는 예약 조건이에요.`,
        "항공, 숙박, 식사, 입장료가 어디까지 포함되는지는 상세표를 기준으로 봐야 해요.",
        "현지 선택 일정과 개인 경비처럼 별도 결제가 필요한 항목도 마지막에 비교하세요.",
        "표시 가격만 보지 말고 필수 현지 비용까지 합친 예상 지출로 비교하면 판단이 더 정확해져요.",
        "포함된 항목과 현장에서 직접 선택할 항목을 나눠 적어두면 예상 밖 지출을 줄이기 좋아요.",
      ],
    },
    {
      title: "이런 여행자에게 잘 맞아요",
      purpose: "장점 나열 대신 독자가 자신의 여행 방식과 맞는지 판단하게 한다.",
      imageIntent: "가족, 커플, 소규모 일행 등 여행 분위기가 느껴지는 사진",
      body: [
        `${destination}의 핵심 포인트를 ${duration} 안에 묶어서 보고 싶은 분께 먼저 눈에 들어오는 구성이에요.`,
        "교통과 숙소를 따로 예약하기보다 정해진 동선을 선호할 때 비교하기 좋아요.",
        "반대로 자유시간이 가장 중요하다면 일자별 체류 시간부터 확인하는 편이 맞아요.",
        "동행자의 체력과 꼭 보고 싶은 장소가 이 코스의 우선순위와 맞는지도 함께 이야기해보세요.",
        "정해진 일정의 편리함과 자유시간의 여유 중 무엇을 더 중요하게 보는지가 선택 기준이에요.",
      ],
    },
    {
      title: "예약 전 마지막 체크",
      purpose: "결제 직전 확인할 항목을 남기고 자연스럽게 제휴 링크 카드로 연결한다.",
      imageIntent: "여행의 여운을 남기는 마지막 대표 풍경",
      body: [
        "출발 확정 여부, 취소·변경 규정, 포함·불포함 항목을 마지막으로 확인하세요.",
        "상품명에 적힌 혜택도 선택한 날짜와 인원에서 동일하게 적용되는지 봐야 해요.",
        "아래 여행커넥트 링크 카드에서 실제 일정과 예약 조건을 비교할 수 있어요.",
        "최종 결제 전에는 예약 화면에 표시된 최신 조건을 기준으로 결정하는 것이 가장 중요해요.",
        "동행자와 일정표를 함께 보면서 모두가 동의한 코스인지 확인한 뒤 예약해도 늦지 않아요.",
      ],
    },
  ];

  const inserts: TravelEditorialSection[] = [
    {
      title: "사진으로 보는 여행 분위기",
      purpose: "상품 사진과 본문을 연결해 광고 설명보다 실제 여행 장면 중심으로 읽히게 한다.",
      imageIntent: "가장 현장감 있는 여행지 사진",
      body: [
        `${destination} 여행은 일정표와 함께 실제 풍경 사진을 보면 코스의 분위기가 더 빨리 잡혀요.`,
        "본문 사진은 상품 페이지에서 확인된 여행지 이미지 위주로 배치했어요.",
        "사진과 일정표를 함께 보면서 내가 기대하는 장면이 포함됐는지 비교해보세요.",
        "비슷한 풍경이 반복되면 이동 동선이나 포함 조건처럼 판단에 도움이 되는 정보로 시선을 돌려보세요.",
        "대표 사진 한 장보다 여러 장소의 분위기가 고르게 담겼는지 보는 편이 실제 코스를 이해하기 좋아요.",
      ],
    },
    {
      title: "여행지 미리 알아보기",
      purpose: "처음 검색하는 독자가 지역의 분위기와 대표 장면을 출발 전에 이해하게 한다.",
      imageIntent: "도시 전경, 지역 상징, 현지 거리의 실제 사진",
      body: [
        `${destination}은 어떤 분위기의 여행지인지 대표 풍경과 생활권을 먼저 찾아보면 일정이 훨씬 잘 보입니다.`,
        `이번 상품에서 확인되는 방문 포인트는 ${highlights}이고, 각 장소의 성격이 서로 어떻게 다른지 비교해보세요.`,
        "유명한 장소 이름만 저장하기보다 오전·오후·저녁 중 언제 어울리는지까지 메모해두면 동선이 편해요.",
        "최신 운영시간과 휴무일처럼 바뀔 수 있는 정보는 출발 전에 공식 페이지에서 다시 확인해야 합니다.",
      ],
    },
    {
      title: "교통과 이동 동선 확인",
      purpose: "관광지 목록을 실제 이동 가능한 하루 흐름으로 바꿔 체력과 시간을 판단하게 한다.",
      imageIntent: "역, 공항, 골목, 차창처럼 이동 방식이 보이는 실제 사진",
      body: [
        "여행지에서는 명소 사이의 거리가 가까워 보여도 환승과 대기 시간이 하루 리듬을 바꿀 수 있어요.",
        "상품 일정표에서 이동 수단과 출발·도착 시각이 확인되는 구간을 먼저 표시해두세요.",
        "자유시간이 있는 날에는 가장 보고 싶은 장소를 먼저 정하고, 남은 시간에 식사와 쇼핑을 배치하면 무리가 적습니다.",
        "정확한 소요 시간과 교통 상황은 출발일과 현지 운영 상태에 따라 달라질 수 있어 최신 정보를 확인해야 해요.",
      ],
    },
    {
      title: "날씨와 여행 준비",
      purpose: "계절·복장·짐·현지 결제처럼 출발 전에 검색하는 실용 정보를 빠뜨리지 않는다.",
      imageIntent: "계절감과 복장이 자연스럽게 드러나는 실제 여행 사진",
      body: [
        `${destination} 여행은 출발 시기의 날씨와 걷는 일정에 따라 체감 난도가 달라질 수 있어요.`,
        "기온만 보지 말고 비 예보, 일교차, 실내외 이동 비중을 함께 확인하면 준비물이 구체적으로 정리됩니다.",
        "편한 신발과 가벼운 겉옷처럼 여러 일정에 공통으로 쓰는 준비물을 먼저 챙기는 편이 안전해요.",
        "환전·결제수단·통신·여행자보험처럼 상품에 포함되지 않을 수 있는 항목도 출발 전에 따로 점검하세요.",
      ],
    },
  ];
  const desiredCount = Math.max(8, Math.min(12, targetSectionCount));
  const prefix = sections.slice(0, 3);
  const highlightSections = sections.slice(3, 3 + confirmedHighlights.length);
  const suffix = sections.slice(3 + confirmedHighlights.length);
  const orderedInserts = [inserts[1], inserts[2], inserts[3], inserts[0]];
  const closing = suffix.at(-1)!;
  if (desiredCount <= 8) {
    // 짧은 폴백도 이동·포함·추천 판단을 잃지 않게 한다.
    const core = suffix.slice(0, 3);
    const info = orderedInserts.slice(0, Math.max(0, desiredCount - prefix.length - core.length - 1));
    return [...prefix, ...core, ...info, closing].slice(0, desiredCount);
  }
  const highlightLimit = Math.min(highlightSections.length, desiredCount >= 11 ? 4 : 3);
  const infoCount = Math.max(1, desiredCount - prefix.length - highlightLimit - 1 - 1);
  const selected = [...prefix, ...highlightSections.slice(0, highlightLimit), ...suffix.slice(0, 1), ...orderedInserts.slice(0, infoCount), closing];
  return selected.slice(0, desiredCount);
}

export function formatTravelEditorialPlanForPrompt(sections: TravelEditorialSection[]): string {
  return [
    "## 여행 인플루언서형 편집 설계",
    "- 흐름: 대표 장면 → 핵심 요약 → 여행지 사전정보 → 전체 일정 한눈에 보기 → 코스/이동/준비 → 비용/예약 판단 → 예약 링크",
    "- 여행지를 처음 알아보는 독자가 출발 전에 검색할 정보를 우선하고, 각 섹션은 120~220자 안팎으로 씁니다.",
    "- 실제 체험이 없으면 1인칭 방문 후기처럼 쓰지 않습니다.",
    ...sections.map(
      (section, index) =>
        `${index + 1}. ${section.title}\n   목적: ${section.purpose}\n   이미지: ${section.imageIntent}`,
    ),
  ].join("\n");
}

export function buildTravelThumbnailCopy(productName: string) {
  const facts = extractTravelProductFacts(productName);
  const destination = facts.destinations.slice(0, 2).join(" · ") || "여행 코스";
  return {
    productNameLabel: `${destination} ${facts.duration || "여행"}`.slice(0, 36),
    headline: `${destination} 일정 체크`.slice(0, 24),
    subline: [facts.duration, ...facts.conditions.slice(0, 2)].filter(Boolean).join(" · ").slice(0, 44) || "일정·포함사항·예약조건",
    badge: facts.departureConfirmed ? "출발 조건 확인" : "여행 코스 체크",
    cta: "일정과 조건 보기",
  };
}

export function buildLocalTravelPostJson(product: {
  name: string;
  description: string;
  features: string[];
  price: string;
}, targetSectionCount: number): string {
  const facts = extractTravelProductFacts(product.name, product.description, product.features);
  const destination = destinationLabel(facts);
  const duration = facts.duration || "일정";
  const editorialSections = buildTravelEditorialPlan(product, targetSectionCount);
  const sections = editorialSections.map(
    (section) => `${section.title}\n\n${section.body.join("\n")}\n`,
  );
  return JSON.stringify({
    title: `${destination} 여행 코스 ${duration} | 일정과 예약조건`.slice(0, 35),
    sections,
    hashtags: unique([destination.replace(/·/g, ""), "여행커넥트", "패키지여행", ...(facts.destinations.slice(0, 2))], 5),
  });
}

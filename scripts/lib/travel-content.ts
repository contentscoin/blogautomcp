export interface TravelProductFacts {
  duration: string | null;
  destinations: string[];
  highlights: string[];
  conditions: string[];
  departureConfirmed: boolean;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map(clean).filter((value) => value.length >= 2))).slice(0, limit);
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
    highlights: unique(bracketHighlights, 12),
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
  const destination = facts.destinations.slice(0, 2).join("·") || "여행지";
  const duration = facts.duration || "일정";
  const pointText = facts.highlights.slice(0, 3).join(", ") || "세부 방문 코스";
  const conditionText = facts.conditions.join(", ") || "포함·불포함 조건";
  const seeds = [
    ["여행상품 한눈에 보기", `${product.name}은 ${destination} 중심의 ${duration} 여행상품이에요.`, `${pointText}가 상품명에서 확인되는 핵심 포인트예요.`, `${conditionText}은 예약 전에 다시 확인해야 해요.`, "실제 출발일과 인원에 따라 가능한 조건이 달라질 수 있어요."],
    ["코스와 이동 흐름", `이 상품은 ${pointText} 순으로 여행 흐름을 살펴보면 이해하기 쉬워요.`, "하루에 여러 도시를 이동하는 날은 체류 시간과 이동 시간을 같이 봐야 해요.", "상세 일정표에 없는 방문 순서나 자유시간은 임의로 단정하지 않았어요.", "예약 페이지의 일자별 일정을 열어 실제 동선을 확인해보세요."],
    ["여행의 매력 포인트", `${destination}의 대표 풍경과 명소를 한 일정에서 만나는 구성이 눈에 들어와요.`, "관광지 개수보다 꼭 보고 싶은 장소가 포함됐는지 확인하는 편이 중요해요.", "사진 촬영, 휴식, 현지 체험 중 무엇을 우선할지도 생각해보면 좋아요.", "동행자 취향과 코스 강도가 맞는지 함께 비교해보세요."],
    ["포함 조건 체크", `${conditionText}이 현재 상품명에서 확인되는 조건이에요.`, "항공, 숙박, 식사, 입장료의 포함 범위는 상세표 기준으로 확인해야 해요.", "유류할증료와 선택관광, 가이드 비용은 출발일에 따라 달라질 수 있어요.", `${product.price || "가격"}도 최종 예약 단계의 인원·출발일 기준으로 다시 확인하세요.`],
    ["이런 여행자에게 맞아요", `${duration} 동안 ${destination}의 핵심 코스를 한 번에 보고 싶은 분께 맞는 구성이에요.`, "직접 교통과 숙소를 나눠 예약하기보다 정해진 동선을 선호할 때 편해요.", "반대로 자유시간을 길게 원하는 분은 일자별 체류 시간을 먼저 봐야 해요.", "걷는 양과 이동 횟수도 동행자와 함께 확인해보세요."],
    ["예약 전 마지막 확인", "출발 확정 여부와 최소 출발 인원은 결제 직전에 다시 확인하세요.", "여권 유효기간, 비자, 수하물 조건은 항공편과 목적지 기준으로 준비해야 해요.", "취소·변경 수수료는 예약 시점과 출발일까지 남은 기간에 따라 달라질 수 있어요.", "상품 상세 일정과 약관을 확인한 뒤 본인 여행 스타일과 비교해보세요."],
  ];
  const sections = Array.from({ length: Math.max(4, targetSectionCount) }, (_, index) => {
    const seed = seeds[index % seeds.length];
    return `${seed[0]}\n\n${seed.slice(1).join("\n")}\n`;
  });
  return JSON.stringify({
    title: `${destination} ${duration} | 일정과 포함조건 확인`.slice(0, 35),
    sections,
    hashtags: unique([destination.replace(/·/g, ""), "여행커넥트", "패키지여행", ...(facts.destinations.slice(0, 2))], 5),
  });
}

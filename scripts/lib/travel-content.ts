export interface TravelProductFacts {
  duration: string | null;
  destinations: string[];
  highlights: string[];
  conditions: string[];
  departureConfirmed: boolean;
}

export interface TravelPageSchedule {
  day: number;
  activities: string[];
  meals: string[];
  transport: string | null;
}

export interface TravelPageResearch {
  source: "naver-package-next-data";
  durationDays: number | null;
  destinations: string[];
  highlights: Array<{ name: string; description: string }>;
  schedules: TravelPageSchedule[];
  flights: string[];
  shopping: string[];
}

export interface TravelEditorialSection {
  title: string;
  purpose: string;
  imageIntent: string;
  requiredEvidence: string[];
  decisionFocus: string[];
}

export interface TravelHighlightReview {
  name: string;
  experienceTags: string[];
  routeRole: string;
  riskTags: string[];
  verificationNeeds: string[];
}

export interface TravelReviewAngle {
  key: string;
  label: string;
  evidence: string[];
  travelerValue: string[];
  tradeoffs: string[];
  verificationNeeds: string[];
}

export interface TravelReviewAnalysis {
  productType: "package-tour";
  routeScope: string[];
  verifiedConditions: string[];
  strengths: TravelReviewAngle[];
  limitations: TravelReviewAngle[];
  bestFor: string[];
  notFor: string[];
  highlightReviews: TravelHighlightReview[];
  decisionCriteria: string[];
  unresolvedFacts: string[];
  evidenceLevel: "rich" | "usable" | "sparse";
}

export interface TravelReviewSubstanceAssessment {
  pass: boolean;
  missingElements: string[];
  genericGuidanceCount: number;
  sentenceCount: number;
  repeatedSentenceCount: number;
  coveredPlaces: string[];
  requiredPlaceCount: number;
  evidenceJudgementCount: number;
  requiredEvidenceJudgementCount: number;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map(clean).filter((value) => value.length >= 2))).slice(0, limit);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  const normalized = clean(value.replace(/<[^>]+>/gu, " "));
  if (!normalized || /^https?:\/\//iu.test(normalized)) return "";
  return normalized.slice(0, maxLength);
}

function strings(value: unknown, limit = 24): string[] {
  const result: string[] = [];
  const visit = (item: unknown) => {
    if (result.length >= limit) return;
    if (typeof item === "string") {
      const normalized = text(item);
      if (normalized) result.push(normalized);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const itemRecord = record(item);
    if (!itemRecord) return;
    if (Array.isArray(itemRecord.contents)) visit(itemRecord.contents);
    if (Array.isArray(itemRecord.editors)) visit(itemRecord.editors);
  };
  visit(value);
  return unique(result, limit);
}

function findNaverPackageProduct(root: unknown): Record<string, unknown> | null {
  const visited = new Set<object>();
  let found: Record<string, unknown> | null = null;
  const visit = (value: unknown, depth: number) => {
    if (found || depth > 14 || !value || typeof value !== "object" || visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const valueRecord = value as Record<string, unknown>;
    if (typeof valueRecord.productName === "string" && Array.isArray(valueRecord.schedules)) {
      found = valueRecord;
      return;
    }
    Object.values(valueRecord).forEach((item) => visit(item, depth + 1));
  };
  visit(root, 0);
  return found;
}

function formatFlight(value: unknown, direction: "출국" | "귀국"): string {
  const flight = record(value);
  if (!flight) return "";
  const airline = text(flight.airlineName, 40);
  const flightName = text(flight.flightName, 24);
  const departure = text(flight.departureCityName, 40);
  const arrival = text(flight.arrivalCityName, 40);
  const departureTime = text(flight.departureTime, 10);
  const arrivalTime = text(flight.arrivalTime, 10);
  const flightTime = text(flight.flightTime, 16);
  const route = [departure, arrival].filter(Boolean).join("→");
  const times = departureTime && arrivalTime ? `${departureTime}→${arrivalTime}` : "";
  const carrier = [airline, flightName].filter(Boolean).join(" ");
  return clean([direction, carrier, route, times, flightTime ? `비행 ${flightTime}` : ""].filter(Boolean).join(" · "));
}

/** 네이버 패키지 페이지의 __NEXT_DATA__에서 일정·항공·식사·쇼핑 근거를 추출한다. */
export function extractTravelPageResearch(nextData: unknown): TravelPageResearch | null {
  const product = findNaverPackageProduct(nextData);
  if (!product) return null;

  const visitAreas = Array.isArray(product.visitAreas) ? product.visitAreas : [];
  const destinations = unique(visitAreas.flatMap((item) => {
    const area = record(item);
    return area ? [text(area.countryName, 40), text(area.cityName, 40)] : [];
  }), 8);

  const mustSeeTours = record(product.mustSeeTours)?.tours;
  const highlights = (Array.isArray(mustSeeTours) ? mustSeeTours : []).flatMap((item) => {
    const tour = record(item);
    const name = text(tour?.name, 80);
    if (!name) return [];
    return [{ name, description: strings(tour?.desc, 2).join(" ").slice(0, 260) }];
  }).slice(0, 24);

  const schedules = (Array.isArray(product.schedules) ? product.schedules : []).flatMap((item, index) => {
    const schedule = record(item);
    if (!schedule) return [];
    const day = typeof schedule.dayOfSchedule === "number" ? schedule.dayOfSchedule : index + 1;
    const activities = strings(record(schedule.info)?.editors, 24);
    const tripPlaces = (Array.isArray(schedule.tripPlaces) ? schedule.tripPlaces : []).flatMap((place) => {
      const placeRecord = record(place);
      return placeRecord ? [text(placeRecord.placeName, 80)] : [];
    });
    const mealsRecord = record(schedule.meals);
    const meals = mealsRecord
      ? unique(["breakfast", "lunch", "dinner"].map((key) => text(mealsRecord[key], 40)).filter((value) => value && value !== "없음"), 3)
      : [];
    const transport = text(record(schedule.localTransport)?.name, 40) || null;
    return [{ day, activities: unique([...tripPlaces, ...activities], 24), meals, transport }];
  });

  const flightDetail = record(record(product.trafficAir)?.detail);
  const flights = flightDetail
    ? [formatFlight(flightDetail.departure, "출국"), formatFlight(flightDetail.return, "귀국")].filter(Boolean)
    : [];
  const shoppingDetails = record(product.shopping)?.details;
  const shopping = (Array.isArray(shoppingDetails) ? shoppingDetails : []).flatMap((item) => {
    const shop = record(item);
    if (!shop) return [];
    const placeName = text(shop.placeName, 100);
    const takeTime = text(shop.takeTime, 30);
    return placeName ? [clean([placeName, takeTime].filter(Boolean).join(" · "))] : [];
  });

  return {
    source: "naver-package-next-data",
    durationDays: typeof product.dayPeriod === "number" ? product.dayPeriod : schedules.length || null,
    destinations,
    highlights,
    schedules,
    flights,
    shopping,
  };
}

export function travelPageResearchFeatures(research: TravelPageResearch): string[] {
  const highlights = research.highlights.map((item) => item.name);
  const dayFeatures = research.schedules.map((schedule) => {
    // 판매페이지의 긴 홍보 문단은 원고에 그대로 복사되지 않도록 제외하고,
    // 장소명·이동·체험처럼 일정 판단에 필요한 짧은 근거만 전달한다.
    const activities = schedule.activities.filter((item) => item.length <= 80).slice(0, 10);
    return `${schedule.day}일차 일정: ${activities.join(" → ")}`;
  });
  return [
    `핵심 방문지: ${highlights.slice(0, 20).join(", ")}`,
    ...research.flights,
    ...dayFeatures,
    research.shopping.length ? `쇼핑 일정: ${research.shopping.join(" / ")}` : "",
  ].filter(Boolean);
}

export function formatTravelPageResearchForPrompt(research: TravelPageResearch): string {
  return [
    "## 원본 여행상품 일정 근거 v1",
    "- 아래 내용은 네이버 패키지 원본 페이지의 구조화 데이터에서 수집했습니다. 상품 구성과 일정 판단의 1차 근거로 사용합니다.",
    `- 여행 기간: ${research.durationDays ? `${research.durationDays}일` : "확인 필요"}`,
    `- 목적지: ${research.destinations.join(", ") || "확인 필요"}`,
    `- 항공: ${research.flights.join(" / ") || "확인 필요"}`,
    `- 핵심 방문지: ${research.highlights.map((item) => item.name).join(", ") || "확인 필요"}`,
    ...research.schedules.map((schedule) => `- ${schedule.day}일차: ${schedule.activities.filter((item) => item.length <= 80).slice(0, 14).join(" → ") || "이동 일정"}${schedule.meals.length ? ` | 식사 ${schedule.meals.join(", ")}` : ""}${schedule.transport ? ` | 교통 ${schedule.transport}` : ""}`),
    `- 쇼핑 일정: ${research.shopping.join(" / ") || "별도 표기 없음"}`,
    "- 상품 판매 문구의 수식어는 사실로 확대하지 말고, 일정에 실제 포함된 장소·이동·식사·쇼핑만 평가합니다.",
  ].join("\n");
}

const NON_DESTINATION_TOKEN_PATTERN = /(?:여행|상품|패키지|투어|관광|일정|예약|출발|확정|변경|조건|특가|핫딜|할인|회원|적립|가격|표시가|숙박|호텔|객실|식사|조식|중식|석식|쇼핑|특전|기념품|비누|쿠폰|포함|불포함|교통|항공|직항|시내|자유시간|가이드|인솔자|제공|기준|전용|베스트|추천|리뷰|해외|국내|레스토랑|마사지\d*분?|사파리|엔티|[가-힣]+몰)$/u;

function looksLikeDestinationToken(token: string): boolean {
  return (
    /[가-힣]{2,}/u.test(token) &&
    token.length <= 12 &&
    !NON_DESTINATION_TOKEN_PATTERN.test(token) &&
    !/^\d+(?:개|명|원|국|도시|박|일)?$/u.test(token)
  );
}

export function extractTravelProductFacts(
  productName: string,
  description = "",
  features: string[] = [],
): TravelProductFacts {
  const source = clean([productName, description, ...features].join(" "));
  const duration = source.match(/(?:\d+박\s*\d+일|\d+일)/u)?.[0]?.replace(/\s+/g, "") || null;
  const bracketHighlights = Array.from(source.matchAll(/[<〈]([^>〉]+)[>〉]/gu))
    .flatMap((match) => match[1].split(/[\/, +·]/u));
  const structuredHighlights = features.flatMap((feature) => {
    const match = clean(feature).match(/^핵심\s*방문지\s*:\s*(.+)$/u);
    return match ? match[1].split(/[,/·]/u) : [];
  });
  const conditionMatchers = [
    /(?:출발확정|무조건출발)/gu,
    /(?:노|NO)\s*쇼핑/giu,
    /(?:노|NO)\s*옵션/giu,
    /(?:노|NO)\s*팁|팁\s*포함/giu,
    /(?:직항|국적기|인솔자\s*동반|전일정\s*\d성|시내\s*숙박)/giu,
  ];
  const conditions = unique(conditionMatchers.flatMap((matcher) => source.match(matcher) || []), 10);
  const highlights = unique(
    [...structuredHighlights, ...bracketHighlights].filter(
      (value) =>
        !/(?:출발확정|무조건출발|여행핫딜|깜짝특가|노\s*쇼핑|no\s*shopping|노\s*옵션|노\s*팁|직항|국적기|인솔자|특가|할인)/iu.test(
          value,
        ),
    ),
    12,
  );
  // 세부 일정·항공·쇼핑 문장을 목적지로 오인하지 않도록 상품명만 사용한다.
  const destinationSource = clean(productName)
    .replace(/\[[^\]]+\]|[<〈][^>〉]+[>〉]/gu, " ")
    .replace(/(?:출발확정|무조건출발|여행핫딜|깜짝특가|베스트셀러|패키지|일주|직항|전일정\s*\d성|\d+박\s*\d+일|\d+일|변경)/gu, " ");
  const destinations = unique(
    destinationSource
      .split(/[\s\/, +·()]+/u)
      .filter(looksLikeDestinationToken),
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

interface HighlightKnowledge {
  pattern: RegExp;
  experienceTags: string[];
  routeRole: string;
  riskTags: string[];
  verificationNeeds: string[];
}

const HIGHLIGHT_KNOWLEDGE: HighlightKnowledge[] = [
  { pattern: /융프라우/u, experienceTags: ["고산 풍경", "산악 교통"], routeRole: "스위스 자연 하이라이트", riskTags: ["고도", "날씨", "운행 변동"], verificationNeeds: ["체류 시간", "대체 일정", "탑승 방식"] },
  { pattern: /루체른/u, experienceTags: ["호수", "구시가지", "도시 산책"], routeRole: "산악 구간 사이 완급 조절", riskTags: ["짧은 체류", "혼잡"], verificationNeeds: ["자유시간", "호숫가·구시가지 동선"] },
  { pattern: /관광열차/u, experienceTags: ["차창 풍경", "이동형 관광"], routeRole: "이동 시간을 관광 경험으로 전환", riskTags: ["좌석 조건", "운행 변동", "날씨"], verificationNeeds: ["열차명", "탑승 구간", "좌석·예약 방식"] },
  { pattern: /피사/u, experienceTags: ["랜드마크", "광장"], routeRole: "이탈리아 상징 장면", riskTags: ["단일 명소 중심", "짧은 체류"], verificationNeeds: ["입장 범위", "체류 시간"] },
  { pattern: /폼페이/u, experienceTags: ["고대 도시", "야외 유적", "역사"], routeRole: "역사 구간의 밀도 강화", riskTags: ["야외 보행", "더위·비", "그늘 부족"], verificationNeeds: ["관람 범위", "가이드 방식", "보행 시간"] },
  { pattern: /콜로세움/u, experienceTags: ["고대 건축", "내부 동선", "로마 역사"], routeRole: "로마 핵심 유적", riskTags: ["대기", "혼잡", "보행"], verificationNeeds: ["내부 입장 여부", "예약 시간", "가이드 방식"] },
  { pattern: /바르셀로나/u, experienceTags: ["건축", "도시 문화", "해안 도시"], routeRole: "스페인 구간의 시각적 중심", riskTags: ["분산된 명소", "도시 이동"], verificationNeeds: ["입장 명소", "도심 자유시간"] },
  { pattern: /마드리드/u, experienceTags: ["미술", "광장", "수도 문화"], routeRole: "스페인 도시 문화 축", riskTags: ["근교 결합 시 자유시간 감소"], verificationNeeds: ["미술관 입장", "자유시간"] },
  { pattern: /리스본/u, experienceTags: ["언덕", "트램", "강변"], routeRole: "포르투갈 도시 분위기 중심", riskTags: ["오르막", "돌길", "보행"], verificationNeeds: ["이동 수단", "도보 구간", "자유시간"] },
  { pattern: /그라나다/u, experienceTags: ["이슬람 건축", "유럽 문화 교차"], routeRole: "스페인 남부 문화 대비", riskTags: ["시간 지정 입장", "보행"], verificationNeeds: ["핵심 유적 입장", "예약 시간"] },
  { pattern: /론다/u, experienceTags: ["협곡", "절벽 도시", "전망"], routeRole: "대도시 일정의 장면 전환", riskTags: ["이동 대비 짧은 체류"], verificationNeeds: ["전망 포인트", "체류 시간"] },
  { pattern: /타이(?:베이|페이)/u, experienceTags: ["도시 먹거리", "역사", "현대 도심"], routeRole: "대만 일정의 도시 거점", riskTags: ["근교 결합 시 도심 시간 감소"], verificationNeeds: ["도심 자유시간", "근교 이동 방식"] },
  { pattern: /단수이/u, experienceTags: ["강변", "노을", "근교 산책"], routeRole: "도심 일정의 느린 반나절", riskTags: ["날씨", "방문 시간대"], verificationNeeds: ["방문 시간", "귀환 동선"] },
  { pattern: /오키나와/u, experienceTags: ["바다", "섬 문화", "휴양"], routeRole: "일본 대도시와 다른 휴양 축", riskTags: ["차량 이동", "날씨"], verificationNeeds: ["이동 수단", "해변 체류 시간"] },
  { pattern: /삿포로/u, experienceTags: ["도시 먹거리", "홋카이도 거점"], routeRole: "도시 체류와 근교 이동의 중심", riskTags: ["계절 교통", "복장 난도"], verificationNeeds: ["숙소 위치", "근교 이동 시간"] },
  { pattern: /오타루/u, experienceTags: ["운하", "상점가", "근교 산책"], routeRole: "삿포로와 대비되는 근교 장면", riskTags: ["운하 주변 경험 집중"], verificationNeeds: ["체류 시간", "이동 수단"] },
  { pattern: /다낭/u, experienceTags: ["해변", "도시 편의", "휴양"], routeRole: "베트남 중부 휴양 거점", riskTags: ["근교 이동 증가 시 휴식 감소"], verificationNeeds: ["리조트 체류 시간", "근교 이동"] },
  { pattern: /호이안/u, experienceTags: ["구시가지", "야간 풍경", "산책"], routeRole: "중부 일정의 야간 분위기 전환", riskTags: ["혼잡", "방문 시간대"], verificationNeeds: ["야간 체류", "귀환 교통"] },
  { pattern: /프라하/u, experienceTags: ["구시가지", "강변", "성곽"], routeRole: "중부 유럽의 시각적 중심", riskTags: ["도보", "혼잡"], verificationNeeds: ["성 입장", "자유시간"] },
  { pattern: /부다페스트/u, experienceTags: ["도나우강", "야경", "도시 전망"], routeRole: "중부 유럽 코스의 야간 장면", riskTags: ["긴 하루 일정"], verificationNeeds: ["야경 포함 여부", "숙소 귀환 시간"] },
  { pattern: /할슈타트/u, experienceTags: ["호수", "산", "마을"], routeRole: "도시 일정 속 자연 쉼표", riskTags: ["이동 대비 체류", "혼잡"], verificationNeeds: ["체류 시간", "이동 방식"] },
  { pattern: /이스탄불/u, experienceTags: ["건축", "시장", "해협", "문화 교차"], routeRole: "튀르키예 여행 정체성 중심", riskTags: ["교통 혼잡", "넓은 동선"], verificationNeeds: ["입장 명소", "자유시간", "교통 방식"] },
  { pattern: /에페소스/u, experienceTags: ["대규모 고대 유적", "야외 보행"], routeRole: "튀르키예 역사 구간", riskTags: ["더위", "그늘 부족", "보행"], verificationNeeds: ["관람 범위", "보행 시간"] },
];

function highlightReview(name: string): TravelHighlightReview {
  const known = HIGHLIGHT_KNOWLEDGE.find((item) => item.pattern.test(name));
  return known
    ? { name, experienceTags: known.experienceTags, routeRole: known.routeRole, riskTags: known.riskTags, verificationNeeds: known.verificationNeeds }
    : { name, experienceTags: ["상품명 강조 방문지"], routeRole: "코스 차별화 포인트", riskTags: ["체류 깊이 미확인"], verificationNeeds: ["체류 시간", "방문 방식", "포함 범위"] };
}

function reviewAngle(input: TravelReviewAngle): TravelReviewAngle {
  return {
    key: clean(input.key),
    label: clean(input.label),
    evidence: unique(input.evidence, 8),
    travelerValue: unique(input.travelerValue, 8),
    tradeoffs: unique(input.tradeoffs, 8),
    verificationNeeds: unique(input.verificationNeeds, 8),
  };
}

export function buildTravelReviewAnalysis(product: {
  name: string;
  description: string;
  features: string[];
  price: string;
}): TravelReviewAnalysis {
  const facts = extractTravelProductFacts(product.name, product.description, product.features);
  const destination = destinationLabel(facts);
  const duration = facts.duration || "기간 미확인";
  const source = clean([product.name, product.description, ...product.features].join(" "));
  const places = unique(facts.highlights.length ? facts.highlights : facts.destinations, 8);
  const highlightReviews = places.slice(0, 5).map(highlightReview);
  const strengths: TravelReviewAngle[] = [];
  const limitations: TravelReviewAngle[] = [];

  if (facts.departureConfirmed) strengths.push(reviewAngle({ key: "departure-certainty", label: "출발 불확실성 감소", evidence: ["출발확정 표기"], travelerValue: ["출발일 선택 리스크 축소"], tradeoffs: ["선택 출발일별 재확인 필요"], verificationNeeds: ["출발일별 확정 상태"] }));
  if (/(?:노|NO)\s*쇼핑/iu.test(source)) strengths.push(reviewAngle({ key: "no-shopping-route", label: "쇼핑센터 방문 최소화 조건", evidence: ["노쇼핑 표기"], travelerValue: ["관광 동선 시간 확보"], tradeoffs: ["실제 일정표 조건 일치 필요"], verificationNeeds: ["쇼핑 방문 횟수", "선택 관광 조건"] }));
  if (/직항/u.test(source)) strengths.push(reviewAngle({ key: "direct-flight", label: "환승 부담 감소", evidence: ["직항 표기"], travelerValue: ["첫날·마지막 날 이동 복잡도 축소"], tradeoffs: ["출도착 시각에 따른 현지 체류 차이"], verificationNeeds: ["항공편", "출도착 시각"] }));
  if (places.length >= 3) strengths.push(reviewAngle({ key: "scene-diversity", label: "코스 장면 다양성", evidence: places.slice(0, 5), travelerValue: ["자연·도시·유적 경험 결합", "개별 예약 부담 감소"], tradeoffs: ["장소별 체류시간 감소 가능성"], verificationNeeds: ["일자별 순서", "장소별 체류시간"] }));
  if (strengths.length < 2) strengths.push(reviewAngle({ key: "packaged-logistics", label: "교통·숙박 통합 준비", evidence: ["패키지 여행상품"], travelerValue: ["도시 간 예약 부담 감소"], tradeoffs: ["동선 변경 자유도 감소"], verificationNeeds: ["교통 수단", "숙소 위치", "자유시간"] }));

  if (facts.destinations.length >= 2 || places.length >= 5) limitations.push(reviewAngle({ key: "wide-route-intensity", label: "넓은 커버리지의 이동 부담", evidence: [duration, ...places.slice(0, 5)], travelerValue: ["다수 지역 압축 경험"], tradeoffs: ["도시 간 이동", "짐 정리", "장소별 체류 단축"], verificationNeeds: ["연박 횟수", "버스·열차 이동시간", "이른 출발 횟수"] }));
  const weatherSensitivePlaces = places.filter((place) => /융프라우|알프스|고산|산악|관광열차|할슈타트/u.test(place));
  if (weatherSensitivePlaces.length > 0) limitations.push(reviewAngle({ key: "weather-operation-sensitivity", label: "날씨·운행 조건 민감도", evidence: weatherSensitivePlaces, travelerValue: ["고산·차창 풍경"], tradeoffs: ["시야 제한", "운행 변경", "대체 일정 가능성"], verificationNeeds: ["대체 일정", "운행 중단 대응"] }));
  if (places.some((place) => /폼페이|콜로세움|에페소스|구시가지|성/u.test(place))) limitations.push(reviewAngle({ key: "walking-load", label: "유적·구시가지 보행 부담", evidence: places.filter((place) => /폼페이|콜로세움|에페소스|구시가지|성/u.test(place)), travelerValue: ["역사·도시 현장 경험"], tradeoffs: ["장시간 도보", "노면·계단", "계절 피로"], verificationNeeds: ["하루 보행 구간", "휴식 시간", "접근성"] }));
  if (!/(?:호텔|숙소|항공|식사|조식|중식|석식)/u.test(source)) limitations.push(reviewAngle({ key: "base-service-unknown", label: "항공·숙소·식사 조건 미확인", evidence: ["현재 수집 정보 범위"], travelerValue: ["패키지 편의성 판단"], tradeoffs: ["실제 현지 체류시간·편안함·총비용 판단 보류"], verificationNeeds: ["항공편", "숙소 위치·연박", "포함 식사", "입장료·현지 비용"] }));
  if (limitations.length < 2) limitations.push(reviewAngle({ key: "stay-depth-unknown", label: "장소별 체류 깊이 미확인", evidence: ["자유시간·체류시간 정보 부족"], travelerValue: ["대표 장소 방문"], tradeoffs: ["명소 수 대비 경험 깊이 불확실"], verificationNeeds: ["자유시간", "장소별 체류시간", "입장·차창 관광 구분"] }));

  const broadRoute = facts.destinations.length >= 2 || places.length >= 4;
  const unresolvedFacts = unique([...limitations.flatMap((item) => item.verificationNeeds), ...(!product.price ? ["출발일별 최종 가격"] : [])], 12);
  const evidencePoints = places.length + facts.conditions.length + (facts.duration ? 1 : 0) + (product.description ? 1 : 0) + product.features.length;
  const evidenceLevel = evidencePoints >= 8 ? "rich" : evidencePoints >= 3 ? "usable" : "sparse";

  return {
    productType: "package-tour",
    routeScope: unique([destination, duration, ...places.slice(0, 6)], 8),
    verifiedConditions: facts.conditions,
    strengths: strengths.slice(0, 5),
    limitations: limitations.slice(0, 5),
    bestFor: [broadRoute ? "대표 장면을 한 번에 넓게 보는 여행자" : "핵심 코스를 정해진 동선으로 보는 여행자", "항공·숙소·도시 간 교통의 개별 예약 부담을 줄이려는 여행자"],
    notFor: [broadRoute ? "한 도시 장기 체류·골목 탐색 중심 여행자" : "즉흥적 일정 변경·긴 자유시간 중심 여행자", "장거리 이동·이른 출발에 부담이 큰 동행"],
    highlightReviews,
    decisionCriteria: ["대표 장소 커버리지 대 장소별 체류시간", "예약 편의 대 일정 자유도", "표시 가격 대 포함·현지 추가비용", "장면 다양성 대 이동·보행 강도"],
    unresolvedFacts,
    evidenceLevel,
  };
}

export function hasSufficientTravelReviewEvidence(product: { name: string; description: string; features: string[]; price: string }): boolean {
  return buildTravelReviewAnalysis(product).evidenceLevel !== "sparse";
}

function formatReviewAngle(item: TravelReviewAngle, index: number, kind: "장점" | "제약"): string {
  return `- ${kind} 후보 ${index + 1}: 주제=${item.label} | 근거=${item.evidence.join(", ") || "없음"} | 여행자 가치=${item.travelerValue.join(", ") || "추론 금지"} | 대가=${item.tradeoffs.join(", ") || "없음"} | 확인 필요=${item.verificationNeeds.join(", ") || "없음"}`;
}

export function formatTravelReviewAnalysisForPrompt(analysis: TravelReviewAnalysis): string {
  return [
    "## 여행상품 리뷰 해석 데이터 v3 · 문장 생성 금지",
    "- 아래 항목은 완성 원고가 아닌 의미 단위입니다. 표현을 복사하지 말고 상품별 문맥으로 새 문장을 작성합니다.",
    `- 상품 유형: ${analysis.productType}`,
    `- 코스 범위: ${analysis.routeScope.join(", ") || "추가 수집 필요"}`,
    `- 확인 조건: ${analysis.verifiedConditions.join(", ") || "추가 수집 필요"}`,
    `- 근거 수준: ${analysis.evidenceLevel}`,
    ...analysis.strengths.map((item, index) => formatReviewAngle(item, index, "장점")),
    ...analysis.limitations.map((item, index) => formatReviewAngle(item, index, "제약")),
    ...analysis.highlightReviews.map((item) => `- 장소 데이터 ${item.name}: 경험=${item.experienceTags.join(", ")} | 코스 역할=${item.routeRole} | 위험=${item.riskTags.join(", ")} | 확인 필요=${item.verificationNeeds.join(", ")}`),
    `- 추천 대상: ${analysis.bestFor.join(" / ")}`,
    `- 비추천 대상: ${analysis.notFor.join(" / ")}`,
    `- 결론 판단축: ${analysis.decisionCriteria.join(" / ")}`,
    `- 미확인 사실: ${analysis.unresolvedFacts.join(", ") || "없음"}`,
    "- 각 장소 문단은 장소 정보, 이 상품 안에서의 역할, 이동·시간·체력의 대가를 GPT가 새 문장으로 연결합니다.",
  ].join("\n");
}

function editorialSection(title: string, purpose: string, imageIntent: string, requiredEvidence: string[], decisionFocus: string[]): TravelEditorialSection {
  return { title, purpose, imageIntent, requiredEvidence, decisionFocus };
}

export function buildTravelContractEditorialPlan(product: {
  name: string;
  description: string;
  features: string[];
  price: string;
}): TravelEditorialSection[] {
  const facts = extractTravelProductFacts(product.name, product.description, product.features);
  const review = buildTravelReviewAnalysis(product);
  const destination = destinationLabel(facts);
  const points = review.highlightReviews;
  const point = (index: number) => points[index] || highlightReview(facts.destinations[index] || `${destination} 코스 ${index + 1}`);

  return [
    editorialSection("이 여행의 한 줄 결론", "가장 큰 여행 가치와 가장 큰 대가를 동시에 판단", `${destination} 대표 실사 풍경`, ["기간", "목적지", "대표 장점", "대표 제약"], ["추천 조건", "대안이 나은 조건"]),
    editorialSection("이 상품이 주는 여행 경험", "기간과 목적지 조합이 만드는 경험 성격 해석", "서로 다른 코스 장면 2~3장", ["코스 범위", "확인 조건", "장면 유형"], ["개별 예약 대비 편의", "일정 자유도"]),
    editorialSection("하이라이트가 만드는 코스의 매력", "핵심 방문지의 서로 다른 역할과 장면 변화 해석", `${point(0).name}, ${point(1).name}, ${point(2).name} 실사 사진`, points.slice(0, 3).flatMap((item) => [item.name, ...item.experienceTags]), ["장면 다양성", "장소별 체류 깊이"]),
    editorialSection("전체 동선과 여행 강도", "방문지 수를 이동·보행·짐 정리 강도로 변환", "일정 요약 카드 또는 이동 동선", ["방문지 순서", "기간", "연박·이동 정보"], ["커버리지", "현지 체류시간", "동행 체력"]),
    ...[0, 1, 2].map((index) => {
      const item = point(index);
      return editorialSection(`여행지 리뷰 ${index + 1} · ${item.name}`, `${item.name}의 코스 역할과 감수할 조건을 근거로 판단`, `${item.name} 실제 장소 사진 1~2장`, [item.name, ...item.experienceTags, item.routeRole], [item.routeRole, ...item.riskTags, ...item.verificationNeeds]);
    }),
    editorialSection("항공·숙박·식사가 좌우하는 만족도", "패키지 기본 서비스가 실제 체류·휴식·총비용에 미치는 영향 판단", "항공·숙소·식사 또는 일정표 이미지", ["항공편", "숙소 위치·연박", "포함 식사"], ["현지 체류시간", "저녁 자유시간", "추가 지출"]),
    editorialSection("상품 구성에서 읽히는 장점", "확인 근거가 있는 상품 고유 장점을 중요도에 따라 종합", "각 장점과 연결되는 여행 장면", review.strengths.flatMap((item) => item.evidence), review.strengths.flatMap((item) => [item.label, ...item.travelerValue])),
    editorialSection("아쉬운 점과 예약 리스크", "상품 고유 제약과 정보 부족을 중요도에 따라 구분해 판단", "이동·보행·날씨 제약 장면", review.limitations.flatMap((item) => item.evidence), review.limitations.flatMap((item) => [item.label, ...item.tradeoffs, ...item.verificationNeeds])),
    editorialSection("추천 여행자와 비추천 여행자", "여행 방식·체력·자유시간 선호에 따른 적합도 분리", "동행 유형과 여행 분위기 사진", [...review.bestFor, ...review.notFor], ["적합 조건", "부적합 조건", "대안 여행 방식"]),
    editorialSection("가격과 포함 조건의 실제 의미", "표시가를 포함 범위와 추가 지출까지 합쳐 판단", "교통·식사·입장 포함 조건 이미지", [product.price || "출발일별 가격", ...facts.conditions], ["총 예상 지출", "필수 현지 비용", "선택 관광"]),
    editorialSection("최종 리뷰와 예약 판단", "장점과 제약을 동일 기준으로 저울질해 조건부 결론 작성", "마지막 대표 실사 풍경", review.decisionCriteria, ["추천 조건", "보류 조건", "대안 코스 기준"]),
  ];
}

export function formatTravelEditorialPlanForPrompt(sections: TravelEditorialSection[]): string {
  return [
    "## 여행상품 체험가치 리뷰 설계 v3",
    "- 아래 구성은 고정 목차가 아니라 선택 가능한 여행 판단 렌즈와 근거 슬롯입니다.",
    "- 상품 정보가 풍부한 렌즈만 선택하고, 독자 질문에 맞춰 합치거나 순서를 바꾸세요. 모든 항목을 억지로 채우지 않습니다.",
    "- 하네스 문구와 역할명을 본문으로 복사하지 않습니다.",
    "- 실제 체험이 없으면 1인칭 방문 후기처럼 쓰지 않고 상품 구성 기준의 분석임을 유지합니다.",
    ...sections.map((section, index) => [
      `${index + 1}. 선택 렌즈: ${section.title}`,
      `   목적: ${section.purpose}`,
      `   필수 근거: ${section.requiredEvidence.join(", ") || "추가 수집 필요"}`,
      `   판단 초점: ${section.decisionFocus.join(", ") || "추가 수집 필요"}`,
      `   이미지: ${section.imageIntent}`,
    ].join("\n")),
  ].join("\n");
}

export function buildTravelThumbnailCopy(productName: string) {
  const facts = extractTravelProductFacts(productName);
  const destination = facts.destinations.slice(0, 2).join(" · ") || "여행 코스";
  return {
    productNameLabel: `${destination} ${facts.duration || "여행"}`.slice(0, 36),
    headline: `${destination} 코스 리뷰`.slice(0, 24),
    subline: [facts.duration, ...facts.conditions.slice(0, 2)].filter(Boolean).join(" · ").slice(0, 44) || "장점·동선·예약조건",
    badge: facts.departureConfirmed ? "출발확정 코스" : "여행상품 리뷰",
    cta: "코스 장단점 보기",
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))).length;
}

function repeatedSentenceCount(value: string): number {
  const counts = new Map<string, number>();
  const sentences = value.split(/[\n.!?。]+/u).map((item) => clean(item).replace(/[^\p{L}\p{N}]/gu, "")).filter((item) => item.length >= 18);
  for (const item of sentences) counts.set(item, (counts.get(item) || 0) + 1);
  return Array.from(counts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

export function assessTravelReviewSubstance(input: {
  productName: string;
  sections: string[];
  sourceText?: string;
}): TravelReviewSubstanceAssessment {
  const body = input.sections.join("\n");
  const facts = extractTravelProductFacts(input.productName, input.sourceText || "");
  const places = unique([...facts.highlights, ...facts.destinations], 8);
  const coveredPlaces = places.filter((place) => body.includes(place));
  const sentences = body.split(/[\n.!?。]+/u).map(clean).filter((item) => item.length >= 8);
  const sentenceCount = Math.max(1, sentences.length);
  const genericGuidanceCount = countMatches(
    body,
    /(?:확인(?:해|하|해야|하세요)|살펴보|비교해보|체크해|보는\s*게\s*좋|알기\s*어렵|판단하기\s*어렵|단정하기\s*어렵|현재\s*(?:정보|수집)|공개되지\s*않|담겨\s*있지\s*않|확정하기\s*어렵|다시\s*볼\s*필요)/u,
  );
  const evidenceJudgementCount = sentences.filter((sentence) =>
    places.some((place) => sentence.includes(place)) &&
    /(?:매력|가치|역할|동선|이동|체류|완급|밀도|장점|선택\s*이유|대신|반면|아쉬|부담|제약|리스크|잘\s*맞|추천|비추천)/u.test(sentence)
  ).length;
  const requiredPlaceCount = Math.min(places.length >= 3 ? 3 : Math.max(1, places.length), Math.max(1, places.length));
  const requiredEvidenceJudgementCount = places.length >= 3 ? 3 : Math.max(1, places.length);
  const repeats = repeatedSentenceCount(body);
  const checks: Array<[boolean, string]> = [
    [/(?:장점|매력|선택\s*이유)/u.test(body), "패키지의 구체적인 장점"],
    [/(?:아쉬운|단점|한계|제약|리스크|이동\s*부담)/u.test(body), "패키지의 아쉬운 점·리스크"],
    [/(?:추천\s*대상|추천\s*여행자)/u.test(body) && /비추천/u.test(body), "추천·비추천 여행자"],
    [/(?:최종\s*리뷰|한\s*줄\s*결론|폭넓게|깊게\s*머무)/u.test(body), "상품별 최종 판단"],
    [coveredPlaces.length >= requiredPlaceCount, "여행지별 가치 해석"],
    [evidenceJudgementCount >= requiredEvidenceJudgementCount, "여행지 근거와 코스 가치가 연결된 판단"],
    [genericGuidanceCount / sentenceCount <= 0.22, "확인 안내가 아닌 여행 가치 판단"],
    [!/(?:배송|교환|반품|구성품|제품\s*스펙)/u.test(body), "쇼핑 문구 미혼입"],
    [repeats <= 2, "반복 문장 제거"],
  ];
  const missingElements = checks.filter(([pass]) => !pass).map(([, label]) => label);
  return {
    pass: missingElements.length === 0,
    missingElements,
    genericGuidanceCount,
    sentenceCount,
    repeatedSentenceCount: repeats,
    coveredPlaces,
    requiredPlaceCount,
    evidenceJudgementCount,
    requiredEvidenceJudgementCount,
  };
}

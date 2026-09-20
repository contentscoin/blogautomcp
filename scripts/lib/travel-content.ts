import { assessRepetition } from "./draft-quality-signals";

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

export interface TravelSourceCoverage {
  durationDays: number | null;
  visitCount: number;
  itineraryDayCount: number;
  requiredVisitCount: number;
  requiredItineraryDayCount: number;
  sufficient: boolean;
}

export function requiredTravelSourceCoverage(durationDays: number | null | undefined): {
  requiredVisitCount: number;
  requiredItineraryDayCount: number;
} {
  const duration = typeof durationDays === "number" && Number.isFinite(durationDays) && durationDays >= 1
    ? Math.floor(durationDays)
    : null;
  if (!duration) return { requiredVisitCount: 1, requiredItineraryDayCount: 1 };
  return {
    requiredVisitCount: duration <= 1 ? 1 : duration <= 4 ? 2 : 3,
    // Airport-only first/last days exist, so require broad itinerary coverage
    // without insisting that every advertised day contain a sightseeing stop.
    requiredItineraryDayCount: Math.max(1, Math.ceil(duration * 0.6)),
  };
}

/** Only explicit collector labels count as visits and itinerary rows. A duration
 * parsed from the product identity may raise the required coverage, but cannot
 * create any missing itinerary evidence. */
export function assessTravelFeatureCoverage(
  sourceFeatures: string[] | undefined,
  fallbackDurationDays: number | null = null,
): TravelSourceCoverage {
  const lines = (sourceFeatures || []).flatMap((value) => value.split(/\r?\n/u)).map(clean).filter(Boolean);
  const visits = new Set<string>();
  const itineraryDays = new Set<number>();
  let durationDays: number | null = fallbackDurationDays && Number.isFinite(fallbackDurationDays) && fallbackDurationDays >= 1
    ? Math.floor(fallbackDurationDays)
    : null;
  for (const line of lines) {
    const durationMatch = line.match(/^여행\s*기간\s*[:：]\s*(\d{1,2})\s*일\s*$/u);
    if (durationMatch) durationDays = Math.max(durationDays || 0, Number(durationMatch[1]));
    const visitMatch = line.match(/^핵심\s*방문지\s*[:：]\s*(.+)$/u);
    if (visitMatch) {
      for (const place of visitMatch[1].split(/\s*(?:,|\/|→)\s*/u).map(clean).filter(Boolean)) visits.add(place);
    }
    const itineraryMatch = line.match(/^(\d{1,2})\s*일차\s*일정\s*[:：]\s*(.+)$/u);
    if (itineraryMatch && itineraryMatch[2].split(/\s*(?:→|,|\/)\s*/u).map(clean).some(Boolean)) {
      const day = Number(itineraryMatch[1]);
      if (day >= 1 && (!durationDays || day <= durationDays)) itineraryDays.add(day);
    }
  }
  const required = requiredTravelSourceCoverage(durationDays);
  return {
    durationDays,
    visitCount: visits.size,
    itineraryDayCount: itineraryDays.size,
    ...required,
    sufficient: visits.size >= required.requiredVisitCount && itineraryDays.size >= required.requiredItineraryDayCount,
  };
}

export function assessTravelPageResearchCoverage(research: TravelPageResearch | null | undefined): TravelSourceCoverage {
  if (!research) {
    const required = requiredTravelSourceCoverage(null);
    return { durationDays: null, visitCount: 0, itineraryDayCount: 0, ...required, sufficient: false };
  }
  const validHighlights = new Set(research.highlights.map((item) => clean(item.name)).filter(Boolean));
  const validScheduleDays = new Set(research.schedules
    .filter((schedule) => Number.isInteger(schedule.day) && schedule.day >= 1 &&
      (!research.durationDays || schedule.day <= research.durationDays) && schedule.activities.map(clean).some(Boolean))
    .map((schedule) => schedule.day));
  const required = requiredTravelSourceCoverage(research.durationDays);
  return {
    durationDays: research.durationDays,
    visitCount: validHighlights.size,
    itineraryDayCount: validScheduleDays.size,
    ...required,
    sufficient: validHighlights.size >= required.requiredVisitCount &&
      validScheduleDays.size >= required.requiredItineraryDayCount,
  };
}

/** 실패 후 재시도에서도 원본 일정 근거를 잃지 않도록 저장 JSON을 검증해 복원한다. */
export function parseStoredTravelPageResearch(raw: string | null | undefined): TravelPageResearch | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    const root = record(value);
    if (!root || root.source !== "naver-package-next-data") return null;
    if (!Array.isArray(root.destinations) || !Array.isArray(root.highlights) || !Array.isArray(root.schedules)) return null;
    const destinations = unique(root.destinations.filter((item): item is string => typeof item === "string"), 8);
    const highlights = root.highlights.flatMap((item) => {
      const highlight = record(item);
      const name = text(highlight?.name, 80);
      return name ? [{ name, description: text(highlight?.description, 260) }] : [];
    }).slice(0, 24);
    const schedules = root.schedules.flatMap((item) => {
      const schedule = record(item);
      const day = typeof schedule?.day === "number" && Number.isFinite(schedule.day) ? schedule.day : null;
      if (!day || !Array.isArray(schedule?.activities)) return [];
      return [{
        day,
        activities: unique(schedule.activities.filter((entry): entry is string => typeof entry === "string"), 24),
        meals: Array.isArray(schedule.meals)
          ? unique(schedule.meals.filter((entry): entry is string => typeof entry === "string"), 3)
          : [],
        transport: typeof schedule.transport === "string" ? text(schedule.transport, 40) || null : null,
      }];
    });
    if (schedules.length === 0 && highlights.length === 0) return null;
    return {
      source: "naver-package-next-data",
      durationDays: typeof root.durationDays === "number" && Number.isFinite(root.durationDays)
        ? root.durationDays
        : schedules.length || null,
      destinations,
      highlights,
      schedules,
      flights: Array.isArray(root.flights)
        ? unique(root.flights.filter((item): item is string => typeof item === "string"), 4)
        : [],
      shopping: Array.isArray(root.shopping)
        ? unique(root.shopping.filter((item): item is string => typeof item === "string"), 8)
        : [],
    };
  } catch {
    return null;
  }
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
  uncoveredPlaces: string[];
  requiredPlaceCount: number;
  evidenceJudgementCount: number;
  requiredEvidenceJudgementCount: number;
  backgroundFactCount: number;
  atmosphereCount: number;
  activityCount: number;
  practicalTipCount: number;
  vagueToneCount: number;
  productDetailCount: number;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map(clean).filter((value) => value.length >= 2))).slice(0, limit);
}

function normalizedPlaceText(value: string): string {
  return clean(value).replace(/[\s·・,，/()（）\[\]]+/gu, "").toLowerCase();
}

/** 판매페이지의 "밀라노 관광", "바티칸박물관 입장" 같은 일정 역할 꼬리표를
 * 실제 본문 지명과 비교할 때만 제거한다. 원본 장소명과 출력 문구는 바꾸지 않는다. */
function placeCoverageAliases(place: string): string[] {
  const exact = normalizedPlaceText(place);
  // Source labels sometimes append a parenthetical descriptor, while the
  // article naturally uses the shorter place name (e.g. "사바 주립 모스크"
  // vs. "사바 주립 모스크 (이슬람사원)"). Keep both forms as aliases so
  // descriptive source text does not create a false missing-place failure.
  const descriptorFree = normalizedPlaceText(
    place.replace(/(?:\([^)]*\)|（[^）]*）)/gu, ""),
  );
  const base = descriptorFree
    .replace(/(?:시내)?관광$/u, "")
    .replace(/(?:내부)?입장$/u, "")
    .replace(/유적지$/u, "");
  const known = [
    ["나라사슴공원", "나라공원"],
    ["청수사", "기요미즈데라"],
    ["동대사", "도다이지"],
  ].find((group) => group.includes(base)) || [];
  return unique([exact, descriptorFree, base, ...known].filter((value) => value.length >= 2));
}

function textCoversPlace(value: string, place: string): boolean {
  const normalized = normalizedPlaceText(value);
  return placeCoverageAliases(place).some((alias) => normalized.includes(alias));
}

/** Bound implicit references to the immediately following sentence in the same
 * paragraph and section. Never borrow an unrelated section's activity text. */
export function travelSceneEvidence(sections: string[], places: string[]): string[] {
  const scene = /(?:역사|문화|풍경|분위기|골목|거리|전망|즐기|걷|산책|관람|사진|먹|맛보|팁|동선|시간대)/u;
  const detail = /(?:기둥|무대|다리|강|대불|사슴|사찰|건축|목조|성벽|해자|숲|계단|항구|상점|산|전통|세기|\d+\s*(?:년|미터))/u;
  const generic = /(?:확인하세요|확인해|알아보|좋은\s*곳|추천합니다)/u;
  const evidence: string[] = [];
  for (const section of sections) {
    for (const paragraph of section.split(/\n\s*\n/u)) {
      const lines = paragraph.split(/[.!?。]+|\n/u).map(clean).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const anchors = places.filter((place) => textCoversPlace(line, place));
        if (!anchors.length) continue;
        if (scene.test(line)) { evidence.push(line); continue; }
        const next = lines[i + 1];
        if (!next || !scene.test(next) || generic.test(next) || !detail.test(line + next)) continue;
        // An explicit different known destination starts a new topic.
        if (places.some((place) => !anchors.includes(place) && textCoversPlace(next, place))) continue;
        evidence.push(`${line} → ${next}`);
      }
    }
  }
  return [...new Set(evidence)];
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
    research.durationDays ? `여행 기간: ${research.durationDays}일` : "",
    `핵심 방문지: ${highlights.slice(0, 20).join(", ")}`,
    ...research.flights,
    ...dayFeatures,
    research.shopping.length ? `쇼핑 일정: ${research.shopping.join(" / ")}` : "",
  ].filter(Boolean);
}

export function formatTravelPageResearchForPrompt(research: TravelPageResearch): string {
  return [
    "## 여행지 리서치용 원본 일정 v2",
    "- 아래 내용은 네이버 패키지 원본 페이지에서 수집한 방문지 식별 자료입니다. 본문에는 가격·포함조건을 요약하지 말고, 등장 장소를 조사하는 데만 사용합니다.",
    `- 여행 기간: ${research.durationDays ? `${research.durationDays}일` : "확인 필요"}`,
    `- 목적지: ${research.destinations.join(", ") || "확인 필요"}`,
    `- 핵심 방문지: ${research.highlights.map((item) => item.name).join(", ") || "확인 필요"}`,
    ...research.schedules.map((schedule) => `- ${schedule.day}일차 방문 흐름: ${schedule.activities.filter((item) => item.length <= 80).slice(0, 14).join(" → ") || "이동 일정"}`),
    "- 상품 판매 수식어는 버리고, 일정에 실제 등장한 장소의 역사·문화·풍경·활동·음식·사진·동선 팁을 별도로 조사합니다.",
  ].join("\n");
}

const NON_DESTINATION_TOKEN_PATTERN = /(?:여행|상품|패키지|투어|관광|일정|예약|출발|확정|변경|조건|특가|핫딜|할인|회원|적립|가격|표시가|숙박|호텔|객실|식사|조식|중식|석식|쇼핑|특전|기념품|비누|쿠폰|포함|불포함|교통|항공|직항|시내|자유시간|가이드|인솔자|제공|기준|전용|베스트|추천|리뷰|해외|국내|레스토랑|마사지\d*분?|사파리|엔티|[가-힣]+몰|오전|오후|저녁|새벽|야간|심야|주간|아침|출발일|당일|익일)$/u;
/** "- 인천 오후 출발변경" 처럼 상품명 끝에 붙는 출발지·출발 시간 꼬리표. 목적지가 아니다. */
const DEPARTURE_TAIL_PATTERN = /[-–—~]\s*(?:인천|김포|김해|부산|대구|청주|제주|무안|양양)?\s*(?:오전|오후|저녁|새벽|야간|심야|주간|아침)?\s*출발[^\s]*.*$/u;

function looksLikeDestinationToken(token: string): boolean {
  return (
    /[가-힣]{2,}/u.test(token) &&
    token.length <= 12 &&
    !/[0-9]/u.test(token) &&
    !/^(?:노팁|노옵션|노쇼핑|상당|혜택|무료|증정|특별|럭셔리|프리미엄|인기|성급|출발임박|마감임박|단독|한정)$/u.test(token) &&
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
    const match = clean(feature).match(/핵심\s*방문지\s*:\s*(.+?)(?=\s+(?:출국|귀국|\d+일차\s*일정|쇼핑\s*일정)\s*[:·]|$)/u);
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
    .replace(DEPARTURE_TAIL_PATTERN, " ")
    .replace(/[<〈][^>〉]+[>〉]/gu, " ")
    .replace(/\[([^\]]+)\]/gu, (_match, group: string) => /(?:호텔|숙박|신축|\d|출발|마감|특가)/u.test(group) ? " " : ` ${group} `)
    .replace(/[\[\]]/gu, " ")
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

function travelDurationDays(value: string | null): number | null {
  if (!value) return null;
  const matched = value.match(/(?:\d+박\s*)?(\d{1,2})일/u);
  const days = matched ? Number(matched[1]) : Number.NaN;
  return Number.isInteger(days) && days >= 1 ? days : null;
}

export function formatTravelFactsForPrompt(facts: TravelProductFacts): string {
  return [
    "## 여행지 조사 대상 카드",
    `- 여행 기간: ${facts.duration || "확인 필요"}`,
    `- 목적지 후보: ${facts.destinations.join(", ") || "상품명에서 확인 필요"}`,
    `- 일정/관광 포인트: ${facts.highlights.join(", ") || "상세 예약 페이지에서 확인 필요"}`,
    "- 이 카드는 상품 설명용이 아니라 여행지 웹 리서치 대상을 정하는 데만 사용합니다.",
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
  // Collector features occasionally omit the duration label even though the
  // trusted product title says "10일". Use that duration to set the threshold;
  // it is never counted as an itinerary row by itself.
  const sourceCoverage = assessTravelFeatureCoverage(product.features, travelDurationDays(facts.duration));
  const evidenceLevel = !sourceCoverage.sufficient
    ? "sparse"
    : evidencePoints >= 8 ? "rich" : evidencePoints >= 3 ? "usable" : "sparse";

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

export function formatTravelReviewAnalysisForPrompt(analysis: TravelReviewAnalysis): string {
  return [
    "## 여행지 리서치 시드 v4 · 상품평 문장 생성 금지",
    "- 아래 항목은 일정에서 여행지 이름과 이동 범위를 찾기 위한 내부 시드입니다. 상품 장단점 문장으로 옮기지 마세요.",
    `- 상품 유형: ${analysis.productType}`,
    `- 조사할 지역·장소 후보: ${analysis.routeScope.join(", ") || "추가 수집 필요"}`,
    `- 일정 식별 표기: ${analysis.verifiedConditions.join(", ") || "없음"}`,
    `- 근거 수준: ${analysis.evidenceLevel}`,
    ...analysis.highlightReviews.map((item) => `- 조사 대상 ${item.name}: 장면 후보=${item.experienceTags.join(", ")} | 일정 속 역할=${item.routeRole}`),
    "- 각 장소를 웹에서 조사해 역사·문화 배경, 대표 풍경, 현지 활동, 음식 또는 산책, 촬영 포인트, 실용 팁을 새로 구성합니다.",
    "- 상품의 장점·단점·추천 대상·가격·포함조건은 본문 핵심 주제로 사용하지 않습니다.",
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
    editorialSection(`${destination}, 어떤 여행지일까`, "도시와 지역의 지리·역사·문화 배경을 짧고 선명하게 소개", `${destination} 대표 실사 풍경`, ["공식 관광 자료", "지역 배경", "대표 정체성"], ["이 여행지만의 분위기", "첫 장면"]),
    editorialSection("도착하면 먼저 만나는 풍경", "거리·건축·자연·사람의 움직임을 독자가 눈앞에 그리도록 묘사", "도착 장면과 거리 풍경 2~3장", ["실제 거리와 경관", "안정적인 장소 사실"], ["빛", "소리", "색감", "공간 분위기"]),
    editorialSection("일정의 하이라이트를 따라가는 하루", "일정 순서를 브이로그처럼 연결하고 장소마다 장면이 바뀌는 이유를 설명", `${point(0).name}, ${point(1).name}, ${point(2).name} 실사 사진`, points.slice(0, 3).flatMap((item) => [item.name, ...item.experienceTags]), ["하루 흐름", "장면 전환", "놓치지 말아야 할 순간"]),
    ...[0, 1, 2].map((index) => {
      const item = point(index);
      return editorialSection(`${item.name}에서 꼭 보고 즐길 것`, `${item.name}의 배경지식, 대표 풍경, 할 수 있는 경험과 현장 팁을 구체적으로 전달`, `${item.name} 실제 장소 사진 1~2장`, [item.name, "공식 관광 자료", ...item.experienceTags], ["역사·문화", "현장 분위기", "즐길 거리", "촬영·관람 팁"]);
    }),
    editorialSection("현지에서 맛과 분위기를 즐기는 법", "대표 음식·시장·카페·산책 구간을 일정 장소와 연결해 소개", "음식·시장·카페·골목 사진", ["지역 음식 문화", "일정 주변 상권", "공공 관광 자료"], ["무엇을 먹을지", "어떤 분위기인지", "짧은 자유시간 활용"]),
    editorialSection("사진으로 남기기 좋은 순간", "시간대와 구도에 따라 살아나는 대표 장면을 구체적으로 안내", "노을·야경·건축·자연 풍경", ["대표 전망", "공간 방향", "안정적인 시간대 특성"], ["사진 포인트", "빛과 색감", "사람이 붐빌 때의 대안 구도"]),
    editorialSection("처음 가도 바로 써먹는 여행 팁", "교통·걷기·복장·예절·준비물을 핵심 장소에 연결해 전달", "교통·보행·준비물 장면", ["공식 교통·관광 정보", "장소별 관람 특성"], ["동선", "신발과 복장", "현지 예절", "시간 활용"]),
    editorialSection("여행의 마지막에 남는 장면", "여행지의 대표 장면과 감정을 연결해 독자가 떠나고 싶게 마무리", "여운을 남기는 마지막 실사 풍경", [destination, ...review.routeScope], ["기억에 남는 장면", "여행지의 고유한 매력"]),
  ];
}

export function formatTravelEditorialPlanForPrompt(sections: TravelEditorialSection[]): string {
  return [
    "## 여행지 브이로그 콘텐츠 설계 v4",
    "- 아래 구성은 고정 목차가 아니라 여행지 리서치와 장면 구성을 위한 선택 렌즈입니다.",
    "- 상품 페이지에서는 일정과 장소만 식별하고, 본문은 여행지 정보·분위기·체험·팁으로 채웁니다.",
    "- 공식 관광청·공공기관 등 신뢰 가능한 출처로 조사한 안정적인 사실을 사용합니다.",
    "- 하네스 문구와 역할명을 본문으로 복사하지 않습니다.",
    "- 실제 체험이 없어도 장면 중심으로 생생하게 쓰되, 1인칭 방문 경험은 만들지 않습니다.",
    ...sections.map((section, index) => [
      `${index + 1}. 선택 렌즈: ${section.title}`,
      `   목적: ${section.purpose}`,
      `   필수 근거: ${section.requiredEvidence.join(", ") || "추가 수집 필요"}`,
      `   장면 초점: ${section.decisionFocus.join(", ") || "추가 수집 필요"}`,
      `   이미지: ${section.imageIntent}`,
    ].join("\n")),
  ].join("\n");
}

export function buildTravelThumbnailCopy(productName: string) {
  const facts = extractTravelProductFacts(productName);
  const destination = facts.destinations.slice(0, 2).join(" · ") || "여행 코스";
  return {
    productNameLabel: facts.duration ? `${facts.duration} 여행 가이드` : "여행 가이드",
    headline: destination,
    subline: "명소 · 분위기 · 현지 팁",
    badge: "여행지 집중 리뷰",
    cta: "여행 장면 미리보기",
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))).length;
}

/** 정확히 같은 문장뿐 아니라 숫자·어미만 바뀐 근사 중복까지 반복으로 센다. */
function repeatedSentenceCount(sections: string[]): number {
  return assessRepetition(sections).nearDuplicateCount;
}

export function assessTravelReviewSubstance(input: {
  productName: string;
  sections: string[];
  sourceText?: string;
}): TravelReviewSubstanceAssessment {
  const body = input.sections.join("\n");
  // The editorial gate receives the product description and features as one
  // sourceText string. Pass that source through the feature parser as well so
  // structured lines such as "핵심 방문지: ..." remain exact place evidence.
  const sourceText = input.sourceText || "";
  const facts = extractTravelProductFacts(input.productName, sourceText, sourceText ? [sourceText] : []);
  // Prefer explicit itinerary places over product-title tokens such as hotel
  // nights or optional attractions; those are not scene evidence.
  const places = unique((facts.highlights.length ? facts.highlights : facts.destinations)
    .flatMap((place) => place.split(/\s*[&＆]\s*/u)), 24);
  const coveredPlaces = places.filter((place) => textCoversPlace(body, place));
  const uncoveredPlaces = places.filter((place) => !textCoversPlace(body, place));
  // 발행 게이트는 섹션 공백을 한 줄로 접어 넘기므로 "• 항목" 형식의 사실 목록이 한 문장으로 붙는다.
  // 글머리표 앞에서도 문장을 끊어 항목 하나가 문장 하나로 세어지게 한다.
  const sentences = body.split(/[\n.!?。]+|\s+(?=[•▸])/u).map(clean).filter((item) => item.length >= 8);
  const sentenceCount = Math.max(1, sentences.length);
  const genericGuidanceCount = countMatches(
    body,
    /(?:확인(?:해|하|해야|하세요)|살펴보|비교해보|체크해|보는\s*게\s*좋|알기\s*어렵|판단하기\s*어렵|단정하기\s*어렵|현재\s*(?:정보|수집)|공개되지\s*않|담겨\s*있지\s*않|확정하기\s*어렵|다시\s*볼\s*필요)/u,
  );
  const backgroundFactCount = sentences.filter((sentence) =>
    /(?:역사|문화|유래|건축|전통|시대|세기|왕조|항구|구시가|지형|화산|사원|성당|박물관|유산)/u.test(sentence)
  ).length;
  const atmosphereCount = sentences.filter((sentence) =>
    /(?:분위기|풍경|골목|거리|광장|강변|해안|노을|야경|빛|색감|전망|스카이라인|바람|파도|정취)/u.test(sentence)
  ).length;
  const activityCount = sentences.filter((sentence) =>
    /(?:걷|산책|관람|감상|사진|촬영|먹|맛보|즐기|둘러보|오르|타고|체험|쇼핑|카페|시장)/u.test(sentence)
  ).length;
  const practicalTipCount = sentences.filter((sentence) =>
    /(?:팁|교통|이동|복장|신발|우산|예절|준비|시간대|동선|입구|출구|카드|현금|예약|혼잡|붐비)/u.test(sentence)
  ).length;
  const vagueToneCount = countMatches(
    body,
    /(?:보입니다|보여요|보이네요|인\s*것\s*같아요|것\s*같습니다|것으로\s*보여요|일\s*듯해요|일\s*듯합니다|판단됩니다)/u,
  );
  // "• 항목: 값" 형식의 사실 목록(가격·포함/불포함 블록)은 독자가 예산을 잡는 데 필요한 정리라
  // 상품 설명 비율에서 제외하고, 산문 문장이 가격·조건 나열에 치우쳤는지만 본다.
  const proseSentences = sentences.filter((sentence) => !/^[•▸\-*]\s/u.test(sentence));
  const productDetailCount = proseSentences.filter((sentence) =>
    /(?:표시\s*가격|할인|적립|포함\s*조건|불포함|선택관광|결제|취소\s*규정|예약\s*조건|상품명에는|상품에\s*표시)/u.test(sentence)
  ).length;
  const proseSentenceCount = Math.max(1, proseSentences.length);
  const evidenceJudgementCount = travelSceneEvidence(input.sections, places).length;
  const requiredPlaceCount = Math.min(places.length >= 3 ? 3 : Math.max(1, places.length), Math.max(1, places.length));
  const requiredEvidenceJudgementCount = places.length >= 3 ? 3 : Math.max(1, places.length);
  const repeats = repeatedSentenceCount(input.sections);
  const checks: Array<[boolean, string]> = [
    [backgroundFactCount >= 2, "여행지의 역사·문화·지리 배경"],
    [atmosphereCount >= 3, "현장 풍경과 분위기 묘사"],
    [activityCount >= 4, "여행지에서 실제로 즐길 거리"],
    [practicalTipCount >= 2, "처음 가는 여행자를 위한 실용 팁"],
    [coveredPlaces.length >= requiredPlaceCount, "핵심 여행지별 구체적인 정보"],
    [evidenceJudgementCount >= requiredEvidenceJudgementCount, "여행지 사실과 현장 경험의 연결"],
    [genericGuidanceCount / sentenceCount <= 0.16, "확인 안내가 아닌 여행지 정보"],
    [vagueToneCount === 0, "보입니다·인 것 같아요 같은 모호한 말투 제거"],
    [productDetailCount / proseSentenceCount <= 0.08, "가격·포함조건 중심 상품 설명 제거"],
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
    uncoveredPlaces,
    requiredPlaceCount,
    evidenceJudgementCount,
    requiredEvidenceJudgementCount,
    backgroundFactCount,
    atmosphereCount,
    activityCount,
    practicalTipCount,
    vagueToneCount,
    productDetailCount,
  };
}

import assert from "node:assert/strict";
import {
  assessTravelReviewSubstance,
  buildTravelContractEditorialPlan,
  buildTravelReviewAnalysis,
  extractTravelPageResearch,
  extractTravelProductFacts,
  formatTravelEditorialPlanForPrompt,
  formatTravelPageResearchForPrompt,
  formatTravelReviewAnalysisForPrompt,
  travelPageResearchFeatures,
} from "./lib/travel-content";

const pageResearch = extractTravelPageResearch({
  props: {
    pageProps: {
      initialApolloState: {
        ROOT_QUERY: {
          product: {
            productName: "시드니 일주 6일",
            dayPeriod: 6,
            visitAreas: [{ countryName: "오스트레일리아", cityName: "시드니" }],
            mustSeeTours: {
              tours: [
                { name: "오페라하우스", desc: ["시드니 항구의 대표 공연예술 건축물"] },
                { name: "블루마운틴", desc: ["사암 고원과 계곡 풍경"] },
                { name: "본다이 비치", desc: ["시드니 동부 해안"] },
              ],
            },
            trafficAir: {
              detail: {
                departure: { airlineName: "제트스타항공", flightName: "JQ048", departureCityName: "인천", arrivalCityName: "시드니", departureTime: "21:50", arrivalTime: "10:05", flightTime: "10:15" },
                return: { airlineName: "제트스타항공", flightName: "JQ047", departureCityName: "시드니", arrivalCityName: "인천", departureTime: "11:40", arrivalTime: "20:15", flightTime: "10:30" },
              },
            },
            shopping: { details: [{ placeName: "건강식품 매장", takeTime: "60분" }] },
            schedules: [
              { dayOfSchedule: 1, info: { editors: [{ contents: ["인천 출발"] }] }, meals: { dinner: "기내식" } },
              { dayOfSchedule: 2, info: { editors: [{ contents: ["본다이 비치", "시드니 하버크루즈", "오페라하우스"] }] }, meals: { breakfast: "기내식", lunch: "현지식", dinner: "한식" } },
              { dayOfSchedule: 3, info: { editors: [{ contents: ["저비스베이", "돌핀크루즈"] }] }, meals: { breakfast: "호텔식" } },
              { dayOfSchedule: 4, info: { editors: [{ contents: ["시드니 ZOO", "블루마운틴", "로라 빌리지"] }] }, meals: { breakfast: "호텔식" } },
              { dayOfSchedule: 5, info: { editors: [{ contents: ["NSW 미술관", "바랑가루", "달링하버"] }] }, meals: { breakfast: "호텔식" } },
              { dayOfSchedule: 6, info: { editors: [{ contents: ["시드니 공항 출발", "인천 도착"] }] }, meals: { breakfast: "호텔식" } },
            ],
          },
        },
      },
    },
  },
});
assert.ok(pageResearch);
assert.equal(pageResearch.schedules.length, 6);
assert.equal(pageResearch.highlights.length, 3);
assert.match(pageResearch.flights[0], /JQ048/u);
assert.match(travelPageResearchFeatures(pageResearch).join("\n"), /4일차 일정:.*블루마운틴/u);
const pageResearchPrompt = formatTravelPageResearchForPrompt(pageResearch);
assert.match(pageResearchPrompt, /원본 여행상품 일정 근거/u);
assert.match(pageResearchPrompt, /2일차:.*본다이 비치.*오페라하우스/u);
assert.match(pageResearchPrompt, /쇼핑 일정:.*60분/u);
const pageResearchFacts = extractTravelProductFacts(
  "[출발임박] 시드니 일주 6일 (전일정4성)변경",
  "",
  travelPageResearchFeatures(pageResearch),
);
assert.deepEqual(pageResearchFacts.destinations, ["시드니"]);
assert.ok(pageResearchFacts.highlights.includes("오페라하우스"));
assert.ok(pageResearchFacts.highlights.includes("블루마운틴"));

const phuQuocFacts = extractTravelProductFacts(
  "푸꾸옥 패키지 3박5일 쇼핑엔티 혼똔섬 빈펄사파리 빈산레스토랑 마사지60분 티웨이항공변경",
);
assert.deepEqual(phuQuocFacts.destinations, ["푸꾸옥", "혼똔섬"]);
const phuQuocAnalysis = buildTravelReviewAnalysis({
  name: "푸꾸옥 패키지 3박5일 쇼핑엔티 혼똔섬 빈펄사파리 빈산레스토랑 마사지60분 티웨이항공변경",
  description: "",
  features: [],
  price: "530,007원",
});
assert.equal(
  phuQuocAnalysis.limitations.some((item) => item.key === "weather-operation-sensitivity"),
  false,
  "빈산레스토랑의 '산'을 고산 여행 신호로 오인하면 안 됩니다.",
);

const product = {
  name: "[출발확정/여행핫딜] 스위스/이탈리아 2국 9일 <노쇼핑/융프라우/루체른/관광열차/피사/폼페이/콜로세움내부>",
  description: "",
  features: [],
  price: "3,149,000원",
};

const analysis = buildTravelReviewAnalysis(product);
assert.equal(analysis.evidenceLevel, "rich");
assert.equal(analysis.productType, "package-tour");
assert.ok(analysis.strengths.length >= 3);
assert.ok(analysis.limitations.length >= 3);
assert.ok(analysis.decisionCriteria.some((item) => /체류시간/u.test(item)));
assert.ok(analysis.highlightReviews.some((item) => item.name === "융프라우" && item.experienceTags.includes("고산 풍경")));
assert.ok(analysis.highlightReviews.some((item) => item.name === "루체른" && item.experienceTags.includes("호수")));

const analysisJson = JSON.stringify(analysis);
assert.doesNotMatch(
  analysisJson,
  /(?:예요|해요|돼요|있어요|좋아요|어려워요|맞아요)[.!]?/u,
  "여행 분석 하네스에 발행 가능한 완성 문장을 저장하면 안 됩니다.",
);
assert.doesNotMatch(analysisJson, /"(?:identity|verdict|value|tradeoff)"/u);

const plan = buildTravelContractEditorialPlan(product);
const titles = plan.map((section) => section.title);
assert.equal(plan.length, 13, "여행 상품별로 고를 수 있는 판단 렌즈 후보를 보존해야 합니다.");
assert.equal(new Set(titles).size, titles.length, "여행 소제목을 반복하면 안 됩니다.");
assert.match(titles[0], /한 줄 결론/u);
assert.match(titles.at(-1) || "", /최종 리뷰/u);
assert.ok(titles.some((title) => title.includes("융프라우")));
assert.ok(titles.some((title) => /장점/u.test(title)));
assert.ok(titles.some((title) => /아쉬운/u.test(title)));
assert.ok(titles.some((title) => /비추천/u.test(title)));
assert.ok(plan.every((section) => section.requiredEvidence.length > 0));
assert.ok(plan.every((section) => section.decisionFocus.length > 0));
assert.equal(plan.some((section) => "body" in section), false, "여행 하네스가 완성 본문을 보유하면 안 됩니다.");

const prompt = `${formatTravelReviewAnalysisForPrompt(analysis)}\n${formatTravelEditorialPlanForPrompt(plan)}`;
assert.match(prompt, /문장 생성 금지/u);
assert.match(prompt, /표현을 복사하지 말고/u);
assert.match(prompt, /장점 후보 1/u);
assert.match(prompt, /제약 후보 1/u);
assert.match(prompt, /추천 대상/u);
assert.match(prompt, /고정 목차가 아니라 선택 가능한 여행 판단 렌즈/u);
assert.match(prompt, /상품 정보가 풍부한 렌즈만 선택/u);
assert.doesNotMatch(prompt, /(?:최소 3개|최소 2개|아래 순서를 유지)/u);
assert.doesNotMatch(prompt, /고산 풍경과 산악 교통 경험이/u);

const reviewSections = [
  "이 여행의 한 줄 결론\n\n스위스와 이탈리아의 대표 장면을 9일에 폭넓게 보는 매력이 큰 상품이에요. 이동과 짐 정리 비중도 큰 편이라 넓은 커버리지를 원하는 여행자에게 맞습니다.",
  "이 상품이 주는 여행 경험\n\n융프라우와 루체른의 자연, 피사와 폼페이의 역사 장면이 이어져 코스 변화가 선명해요. 노쇼핑 조건은 관광 동선에 시간을 쓰는 장점으로 읽힙니다.",
  "하이라이트가 만드는 코스의 매력\n\n융프라우는 고산 풍경, 루체른은 호수와 구시가지, 관광열차는 이동형 관광을 맡아요. 서로 다른 장면이 짧은 일정의 밀도를 높이는 선택 이유입니다.",
  "전체 동선과 여행 강도\n\n스위스와 이탈리아를 잇는 만큼 도시 간 이동과 장거리 버스 구간이 아쉬운 점이 될 수 있어요. 연박 횟수와 실제 장소별 체류시간이 만족도를 가릅니다.",
  "여행지 리뷰 1 · 융프라우\n\n융프라우의 고산 풍경은 자연 중심 여행의 핵심 매력이에요. 다만 고도와 날씨, 산악 교통 운행에 민감해 대체 일정이 중요한 제약입니다.",
  "여행지 리뷰 2 · 루체른\n\n루체른의 호수와 구시가지는 산악 구간 사이에 도시 산책의 완급을 더해요. 체류가 짧으면 두 장면을 모두 깊게 보기 어렵다는 한계가 있습니다.",
  "여행지 리뷰 3 · 관광열차\n\n관광열차는 이동 시간을 차창 풍경으로 바꾸는 장점이 있어요. 탑승 구간과 좌석, 운행 시간이 불분명하면 기대한 경험과 달라질 리스크가 있습니다.",
  "항공·숙박·식사가 좌우하는 만족도\n\n항공 시각은 실제 현지 체류시간을 바꾸고 숙소 위치는 저녁 자유시간을 좌우해요. 현재 정보가 부족해 편안함과 총비용 판단을 보류해야 하는 제약입니다.",
  "상품 구성에서 읽히는 장점\n\n출발확정과 노쇼핑, 다양한 방문지 조합이 이 상품의 구체적인 장점이에요. 개별 교통과 숙소 예약 부담을 줄이면서 대표 장면을 묶어 볼 수 있습니다.",
  "아쉬운 점과 예약 리스크\n\n가장 큰 아쉬운 점은 넓은 코스에서 생기는 이동 부담이에요. 날씨 민감 구간과 유적지 보행이 이어져 동행자의 체력에 따라 리스크가 커질 수 있습니다.",
  "추천 여행자와 비추천 여행자\n\n추천 여행자는 여러 대표 장소를 한 번에 보고 싶은 사람이고, 비추천 여행자는 한 도시에 오래 머물고 싶은 사람이에요. 일정 자유도보다 예약 편의를 우선할 때 잘 맞습니다.",
  "가격과 포함 조건의 실제 의미\n\n표시 가격 3,149,000원은 항공과 숙박, 식사, 입장 범위까지 합쳐 판단해야 해요. 필수 현지 비용이 많다면 표시가의 장점이 줄어드는 구조입니다.",
  "최종 리뷰와 예약 판단\n\n최종 리뷰는 폭넓은 코스와 출발확정의 장점이 이동·보행 제약보다 큰지에 달려 있어요. 긴 체류가 우선이면 느린 코스가, 대표 장면 커버리지가 우선이면 이 상품이 후보입니다.",
];
const substance = assessTravelReviewSubstance({ productName: product.name, sections: reviewSections });
assert.equal(substance.pass, true, substance.missingElements.join(", "));
assert.ok(substance.coveredPlaces.includes("융프라우"));
assert.ok(substance.coveredPlaces.includes("루체른"));

console.log(JSON.stringify({
  ok: true,
  sectionTitles: titles,
  strengths: analysis.strengths.length,
  limitations: analysis.limitations.length,
  coveredPlaces: substance.coveredPlaces,
}, null, 2));

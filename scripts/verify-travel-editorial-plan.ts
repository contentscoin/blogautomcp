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
assert.match(pageResearchPrompt, /여행지 리서치용 원본 일정/u);
assert.match(pageResearchPrompt, /2일차 방문 흐름:.*본다이 비치.*오페라하우스/u);
assert.doesNotMatch(pageResearchPrompt, /쇼핑 일정:/u);
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
assert.equal(plan.length, 10, "여행지별로 고를 수 있는 브이로그 렌즈 후보를 보존해야 합니다.");
assert.equal(new Set(titles).size, titles.length, "여행 소제목을 반복하면 안 됩니다.");
assert.match(titles[0], /어떤 여행지/u);
assert.match(titles.at(-1) || "", /마지막에 남는 장면/u);
assert.ok(titles.some((title) => title.includes("융프라우")));
assert.ok(titles.some((title) => /맛과 분위기/u.test(title)));
assert.ok(titles.some((title) => /사진/u.test(title)));
assert.ok(titles.some((title) => /여행 팁/u.test(title)));
assert.equal(titles.some((title) => /가격|포함 조건|비추천|예약 판단/u.test(title)), false);
assert.ok(plan.every((section) => section.requiredEvidence.length > 0));
assert.ok(plan.every((section) => section.decisionFocus.length > 0));
assert.equal(plan.some((section) => "body" in section), false, "여행 하네스가 완성 본문을 보유하면 안 됩니다.");

const prompt = `${formatTravelReviewAnalysisForPrompt(analysis)}\n${formatTravelEditorialPlanForPrompt(plan)}`;
assert.match(prompt, /문장 생성 금지/u);
assert.match(prompt, /여행지 리서치 시드/u);
assert.match(prompt, /여행지 브이로그 콘텐츠 설계/u);
assert.match(prompt, /역사·문화 배경/u);
assert.match(prompt, /상품의 장점·단점·추천 대상·가격·포함조건은 본문 핵심 주제로 사용하지 않습니다/u);
assert.doesNotMatch(prompt, /(?:최소 3개|최소 2개|아래 순서를 유지)/u);
assert.doesNotMatch(prompt, /고산 풍경과 산악 교통 경험이/u);

const reviewSections = [
  "알프스가 만든 스위스의 풍경\n\n융프라우 지역은 빙하와 고봉이 이어지는 베르너 오버란트의 중심입니다. 산악열차를 타고 고도가 높아질수록 초원과 암벽, 설원이 차례로 바뀌어요. 전망 구간에서는 깊은 계곡과 빙하의 규모를 한눈에 감상할 수 있습니다. 고산에서는 천천히 걷고 물을 자주 마시는 편이 좋아요.",
  "융프라우에서 꼭 남길 장면\n\n융프라우의 전망은 맑은 날 설원과 능선이 겹쳐지는 순간 가장 선명합니다. 창가에서는 관광열차가 마을과 초원을 통과하는 장면을 사진으로 남길 수 있어요. 바깥 전망대에서는 바람이 강해 얇은 겉옷보다 방풍 재킷이 실용적입니다. 눈부심을 줄일 선글라스도 챙기세요.",
  "호수와 구시가지가 만나는 루체른\n\n루체른은 로이스강이 호수에서 흘러나오는 자리에 형성된 도시입니다. 목조 지붕이 이어지는 카펠교와 구시가지의 채색 건물이 중세 도시의 분위기를 만들어요. 강변을 따라 산책하면 다리와 교회 첨탑, 산 능선이 한 프레임에 들어옵니다. 골목 카페에서 쉬며 도시의 느린 리듬을 즐기기 좋아요.",
  "루체른에서 맛보는 도시의 시간\n\n구시가지 광장에는 오래된 길드 건물과 상점이 이어집니다. 호숫가에서는 유람선이 오가는 풍경을 바라보며 산책할 수 있어요. 스위스 치즈와 감자 요리를 맛보면 산악 지역의 음식문화를 이해하기 쉽습니다. 돌바닥 골목이 많아 밑창이 편한 신발이 잘 맞아요.",
  "관광열차가 여행 장면이 되는 이유\n\n스위스 관광열차는 도시 사이 이동을 차창 풍경 감상으로 바꿔줍니다. 호수와 목초지, 산악 마을이 이어지며 같은 알프스도 구간마다 색이 달라져요. 창문 반사를 줄이려면 카메라 렌즈를 유리에 가까이 대고 촬영하세요. 큰 짐은 통로를 막지 않도록 지정 보관 공간에 두는 편이 편합니다.",
  "고대 도시 폼페이를 걷는 법\n\n폼페이는 베수비오 화산 분화로 묻힌 로마 시대 도시 유적입니다. 포장도로와 공공건물, 주택 벽화가 남아 당시 생활의 규모를 구체적으로 보여줘요. 유적 사이를 걸으며 광장과 목욕장, 상점 흔적을 관람할 수 있습니다. 그늘이 적고 바닥이 고르지 않아 모자와 물, 편한 신발이 필수예요.",
  "로마의 시간을 품은 콜로세움\n\n콜로세움은 로마 제국의 대형 원형경기장으로 도시 역사의 상징입니다. 아치가 반복되는 외벽은 낮에는 석재 질감이, 해 질 무렵에는 따뜻한 색감이 살아나요. 주변을 걸으며 포로 로마노 방향과 함께 촬영하면 고대 도시의 규모가 드러납니다. 혼잡한 구간에서는 소지품을 몸 앞쪽에 두세요.",
  "여행 끝에 남는 두 가지 표정\n\n스위스에서는 설원과 호수, 열차가 만드는 차분한 풍경을 즐길 수 있어요. 이탈리아에서는 폼페이와 콜로세움의 돌길을 걸으며 고대 역사를 가까이 만납니다. 자연과 도시 유적이 번갈아 이어져 사진의 색과 분위기도 계속 바뀌어요. 배경 이야기를 알고 걸으면 익숙한 명소가 훨씬 입체적으로 기억됩니다.",
];
const substance = assessTravelReviewSubstance({ productName: product.name, sections: reviewSections });
assert.equal(substance.pass, true, substance.missingElements.join(", "));
assert.ok(substance.coveredPlaces.includes("융프라우"));
assert.ok(substance.coveredPlaces.includes("루체른"));
assert.equal(substance.vagueToneCount, 0);
assert.equal(substance.productDetailCount, 0);

const daNangSource =
  "럭셔리 상품 설명 핵심 방문지: 다낭 대성당, 호이안 구시가지, 내원교, 쩐가사당, 풍흥고가, 광조회관, 바나산 국립공원, 영흥사 2일차 일정: 미케비치";
const daNangSubstance = assessTravelReviewSubstance({
  productName: "[노옵션다낭/호이안] 5성호텔 5일",
  sourceText: daNangSource,
  sections: [
    "다낭 대성당의 문화와 건축을 살펴보고 주변 거리의 색을 사진으로 남겨보세요.",
    "호이안 구시가지는 오래된 골목과 강변 풍경이 이어져 천천히 걷고 야경을 즐기기 좋습니다.",
    "내원교는 호이안의 역사와 분위기를 함께 느낄 수 있는 장소라 해 질 무렵 동선과 촬영 시간을 잡는 팁이 유용합니다.",
  ],
});
assert.ok(daNangSubstance.evidenceJudgementCount >= 3);
assert.ok(daNangSubstance.coveredPlaces.includes("다낭 대성당"));
assert.ok(daNangSubstance.coveredPlaces.includes("호이안 구시가지"));
assert.ok(daNangSubstance.coveredPlaces.includes("내원교"));

console.log(JSON.stringify({
  ok: true,
  sectionTitles: titles,
  strengths: analysis.strengths.length,
  limitations: analysis.limitations.length,
  coveredPlaces: substance.coveredPlaces,
}, null, 2));

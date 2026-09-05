import assert from "node:assert/strict";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import * as travelContent from "./lib/travel-content";

const productName = "출발확정 여행핫딜 시내숙박 대마도 2일 패키지";
const disclosure = "이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받습니다.";
const strongerSections = [
  "부산에서 가장 가까운 일본 섬\n\n대마도는 한반도와 규슈 사이에 길게 놓인 국경의 섬입니다. 예부터 한반도와 일본을 잇는 해상 교류의 길목이어서 항구와 마을 곳곳에 두 문화의 흔적이 남아 있어요. 배에서 내리면 높은 건물보다 산 능선과 잔잔한 만이 먼저 시야를 채웁니다. 대도시 일본과 다른 조용하고 느린 분위기가 여행의 첫 장면을 만듭니다.",
  "히타카츠 항구에서 시작하는 아침\n\n히타카츠는 대마도 북부의 관문으로 낮은 상점과 항구 풍경이 가까이 붙어 있습니다. 항구 주변을 걸으면 정박한 배와 산으로 둘러싸인 만을 한 프레임에 담을 수 있어요. 골목의 작은 가게를 둘러보고 바닷바람을 맞으며 산책하는 시간이 잘 어울립니다. 배에서 내린 직후에는 차량 동선을 먼저 확인하면 짧은 체류를 효율적으로 쓸 수 있어요.",
  "미우다 해변의 투명한 물빛\n\n대마도 북쪽 미우다 해변은 밝은 모래와 맑은 바다가 대비되는 장소입니다. 언덕과 해안선이 감싸는 작은 만이라 파도 소리가 가까이 들리고 시야가 아늑해요. 해변 가장자리에서 산책하고 물빛이 바뀌는 구간을 사진으로 남기기 좋습니다. 바위 구간은 미끄러울 수 있어 밑창이 단단한 신발을 챙기세요.",
  "와타즈미 신사가 들려주는 바다 이야기\n\n와타즈미 신사는 바다 신앙과 연결된 오래된 신사입니다. 조수에 따라 바닷물 위에 선 도리이의 높이가 달라져 같은 장소도 전혀 다른 풍경을 만들어요. 붉은 도리이와 잔잔한 만을 바라보며 신사 주변을 천천히 걸을 수 있습니다. 참배 공간에서는 큰 소리를 줄이고 현지 예절을 지키는 편이 좋습니다.",
  "이즈하라 골목에서 만나는 생활 풍경\n\n이즈하라는 대마도 남부의 중심 마을로 상점가와 행정 시설, 오래된 골목이 모여 있습니다. 돌담과 낮은 건물이 이어지는 길에서는 관광지보다 현지의 일상 분위기가 더 또렷해요. 골목을 걸으며 작은 식당과 카페를 찾고 항구 쪽 풍경까지 이어서 즐길 수 있습니다. 보행 구간이 길어질 수 있으니 가벼운 가방과 편한 신발이 실용적입니다.",
  "대마도에서 맛보는 바다의 한 끼\n\n섬 여행에서는 붕장어와 해산물처럼 바다와 가까운 식재료가 식탁의 중심이 됩니다. 따뜻한 국물과 구이 메뉴는 이동 뒤 쉬어가는 시간에 잘 어울려요. 지역 식당에서는 계절과 수급에 따라 메뉴가 달라지므로 그날의 추천 메뉴를 물어보는 재미도 있습니다. 짧은 자유시간에는 주문과 식사 시간을 함께 계산해 동선을 잡으세요.",
  "사진은 항구와 골목에서 완성돼요\n\n대마도의 사진은 거대한 랜드마크보다 바다와 산, 낮은 마을이 겹치는 구도에서 매력이 살아납니다. 항구에서는 배를 전경에 두고 뒤쪽 산 능선을 함께 담으면 섬의 지형이 선명해요. 골목에서는 돌담과 오래된 표지판을 따라 시선을 깊게 넣으면 생활감 있는 장면이 됩니다. 흐린 날에도 물빛과 숲의 초록이 차분한 색감을 만들어줍니다.",
  "짧은 여행을 편하게 만드는 준비\n\n대마도는 항구와 해안, 신사, 마을 골목을 오가며 걷는 시간이 많습니다. 바람을 막는 얇은 겉옷과 편한 신발, 작은 우산을 한 가방에 넣어두면 이동이 가벼워요. 휴대전화 지도는 미리 내려받고 배터리도 충분히 준비하세요. 장소의 배경을 하나씩 알고 걸으면 조용한 섬 풍경이 훨씬 깊게 기억됩니다.",
  disclosure,
];

const assess = (sections: string[]) => getBrandLinkContentReadiness({
  productName,
  title: "대마도 2일 패키지 출발확정 시내숙박 예약 조건",
  sections,
  hashtags: ["대마도여행", "대마도2일", "대마도패키지", "여행커넥트"],
  brandLink: "https://brandconnect.naver.com/travel-fixture",
  generationSource: "AI",
  hasRepresentativeImage: true,
  requireRepresentativeImage: false,
  thumbnailGenerated: true,
  connectKind: "TRAVEL",
  experienceMode: "AI_ASSISTED_INFORMATION",
  sourceDescription: "히타카츠 이즈하라 시내숙박 출발확정 티아라몰 쇼핑",
  sourceFeatures: ["1박 2일", "표시가 126,003원"],
  mode: "editorial",
});


const passing = assess(strongerSections);
assert.equal(passing.canPublish, true, passing.summary);
assert.deepEqual(passing.qualityFailures, []);
assert.deepEqual(passing.blockers, []);

// Isolate readiness from evolving travel heuristics: reproduce the audited 2/3 gate.
const originalAssess = travelContent.assessTravelReviewSubstance;
try {
  Object.assign(travelContent, { assessTravelReviewSubstance: (input: Parameters<typeof originalAssess>[0]) => ({
    ...originalAssess(input), evidenceJudgementCount: 2, requiredEvidenceJudgementCount: 3,
  }) });
  const audited = assess(strongerSections);
  assert.equal(audited.score, 91);
  assert.equal(audited.canPublish, false);
  assert.equal(audited.code, "low-evidence-density");
  assert.deepEqual(audited.blockers, []);
  assert.deepEqual(audited.qualityFailures!.map((item) => item.key), ["sceneLinkage"]);
  assert.match(audited.reason || "", /2\/3/);
  assert.match(audited.summary, /필수 품질 조건 미충족/);
} finally {
  Object.assign(travelContent, { assessTravelReviewSubstance: originalAssess });
}

// A mandatory language condition must fail even when the aggregate score passes.
const unlinked = strongerSections.map((section, index) => index === 0
  ? `${section} 조용한 섬인 것 같아요. 항구가 인상적으로 보입니다.` : section);
const mandatory = assess(unlinked);
assert.ok(mandatory.score >= mandatory.quality.passScore, mandatory.summary);
assert.equal(mandatory.canPublish, false);
assert.equal(mandatory.verdict, "quality");
assert.notEqual(mandatory.code, "quality-score-below-threshold");
assert.ok(mandatory.qualityFailures!.length > 0);
assert.deepEqual(mandatory.qualityFailures, mandatory.quality.categories.filter((item) => item.status === "fail"));
assert.deepEqual(mandatory.blockers, []);
assert.match(mandatory.reason || "", /필수 품질 조건 미충족/);
assert.match(mandatory.summary, /필수 품질 조건 미충족/);

// Safety takes precedence even when mandatory quality conditions also fail.
const unsafe = assess(unlinked.map((section, index) => index === 0 ? section + " 직접 다녀왔습니다." : section));
assert.equal(unsafe.verdict, "blocked");
assert.equal(unsafe.code, "unsupported-experience-claim");
assert.ok(unsafe.blockers.some((item) => item.tier === "safety"));
assert.ok(unsafe.qualityFailures!.length > 0);
const short = assess(["대마도 여행", disclosure]);
assert.equal(short.verdict, "blocked");
assert.ok(short.blockers.some((item) => item.code === "too-few-sections"));
console.log("Content readiness: pass, high-score mandatory failure, safety and structural gates passed", mandatory.score);

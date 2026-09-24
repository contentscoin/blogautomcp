import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { assessProductReviewSubstance, buildProductScoringFeatures } from "./lib/product-editorial-plan";
import { buildBrandPostImagePrompt } from "../src/lib/brand-post-image-generation";
import { parsePreparedBrandPostSections } from "./lib/prepared-post-markdown";
import { formatDraftSubmissionNextAction } from "./lib/writing-prompt-contract";
import {
  SHOPPING_POST_CONTRACT_V1,
  TRAVEL_POST_CONTRACT_V1,
} from "../src/lib/post-composition-contract";

const productName = "출발확정 여행핫딜 시내숙박 대마도 2일 패키지";
const disclosure = "이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받습니다.";
const travelSourceFeatures = [
  "핵심 방문지: 히타카츠, 이즈하라, 미우다 해변, 와타즈미 신사",
  "1일차 일정: 히타카츠 → 미우다 해변 → 와타즈미 신사",
  "2일차 일정: 이즈하라 골목 → 항구",
];
const weakSections = [
  "여행 시기와 조건\n\n대마도 2일 상품을 조건 중심으로 살펴봤어요. 선택한 출발일도 확정인지 다시 확인해야 해요. 세부 순서가 공개되지 않아 판단하기 어렵습니다. 현재 정보만으로 자유시간을 알기 어려워요.",
  "2일 일정\n\n대마도는 짧게 다녀오기 좋아요. 도착 시각을 확인해야 실제 관광 시간을 알 수 있어요. 방문지 수보다 체류시간을 살펴보는 게 좋아요. 이동 강도도 일정표에서 체크해야 합니다.",
  "출발확정\n\n출발확정 표기는 장점이에요. 다만 특정 날짜인지 예약 화면에서 다시 볼 필요가 있어요. 예약 가능 인원도 확인하세요. 현재 수집 정보만으로 최종 상태를 단정하기 어렵습니다.",
  "시내숙박\n\n시내숙박은 편리할 수 있어요. 호텔명이 공개되지 않아 위치를 알기 어려워요. 객실 형태를 확인해야 해요. 체크인 시간과 다음 날 집결도 살펴보는 게 좋습니다.",
  "쇼핑과 특전\n\n티아라몰 쇼핑이 포함돼 있어요. 의무 구매 여부를 확인해야 해요. 라벤더비누 수량도 현재 정보에는 담겨 있지 않아요. 특전 수령 방식도 체크하세요.",
  "가격 조건\n\n표시가는 126,003원이에요. 실제 적용가는 최종 화면에서 확인해야 합니다. 현지 필수경비는 알기 어렵습니다. 포함 식사와 입장료도 다시 확인하세요.",
  "교통과 식사\n\n교통편 시간이 중요해요. 출발지와 집결 시각을 확인해야 해요. 식사 횟수는 현재 정보로 단정하기 어렵습니다. 수하물 조건도 체크해보세요.",
  "추천 여행자\n\n짧은 휴가 여행자에게 맞을 수 있어요. 자유시간을 원하는 여행자에게는 아쉬운 점이 있어요. 추천 여행자와 비추천 여행자는 상세 일정 확인 후 판단해야 합니다. 최종 리뷰도 예약 화면을 다시 보는 편이 안전합니다.",
  disclosure,
];

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
  sourceFeatures: travelSourceFeatures,
  mode: "editorial",
});

const weak = assess(weakSections);
// 분량을 채우는 보강 문장은 섹션마다 다른 뜻이어야 한다. 숫자만 바뀐 문장은
// 반복으로 잡히므로(의도된 동작) 여기서는 서로 다른 판단 문장을 쓴다.
const DISTINCT_FILLERS = [
  "출발확정 표기는 모객 실패로 취소될 걱정을 덜어 줘서 휴가를 먼저 확정해야 하는 직장인에게 실질적인 장점이에요.",
  "시내숙박 조건은 저녁 시간에 이즈하라 골목을 따로 걸어볼 여유를 만들어 주는 대신 아침 집결이 빨라질 수 있어요.",
  "1박 2일이라는 짧은 일정은 이동 시간을 줄이는 대신 한 장소에 오래 머무는 여유는 포기해야 한다는 뜻이에요.",
  "표시가 126,003원은 교통과 숙박이 묶인 값이라 부산 출발 자유여행과 비교할 때는 현지 이동비를 더해 봐야 해요.",
  "티아라몰 쇼핑 일정은 기념품을 한 번에 사기에는 편하지만 자유 산책 시간이 그만큼 줄어드는 선택이에요.",
  "항구 도착 직후 일정이 이어지는 구조라 멀미가 있는 여행자라면 배 안에서 쉬는 자세를 미리 정해 두는 편이 좋아요.",
  "사진 위주 여행자라면 미우다 해변과 와타즈미 신사가 같은 날에 묶이는지 일정표에서 먼저 보는 게 실속 있어요.",
  "짐이 가벼운 짧은 여행이라 편한 신발과 얇은 겉옷만 챙겨도 이동 부담이 크지 않아요.",
];
const stronger = assess(strongerSections.map((section, index) => (
  index === strongerSections.length - 1
    ? section
    : `${section}\n\n${DISTINCT_FILLERS[index % DISTINCT_FILLERS.length]}`
)));

const naturalTravelSections = strongerSections;
const naturalTravel = assess(naturalTravelSections);
assert.equal(naturalTravel.canPublish, true, naturalTravel.reason || naturalTravel.summary);
const vagueTravel = assess(naturalTravelSections.map((section, index) =>
  index === 0 ? `${section}\n\n조용한 섬인 것 같아요. 항구가 인상적으로 보입니다.` : section
));
// 2026-09-24 보정: 모호한 말투는 안전 문제가 아니므로 총점이 기준 이상이면 권고로 남긴다.
const vagueNotes = vagueTravel.quality.categories.flatMap((category) => category.notes).join(" ");
assert.match(`${vagueTravel.reason || ""} ${vagueNotes}`, /모호한 말투/u, "모호한 말투는 경고로 계속 보고한다.");
if (vagueTravel.quality.score >= vagueTravel.quality.passScore) {
  assert.equal(vagueTravel.canPublish, true, "경고만 남은 여행 원고는 통과한다.");
} else {
  assert.equal(vagueTravel.canPublish, false);
}
assert.equal(
  naturalTravel.reason?.includes("편집 역할 preparation") ?? false,
  false,
  "내부 편집 역할명은 사용자 QC 사유에 노출되면 안 됩니다.",
);
const lowEvidence = assess(strongerSections.map((section, index) => {
  const withoutSpecificPlaces = section
    .split("히타카츠").join("첫 번째 지역")
    .split("이즈하라").join("두 번째 지역")
    .split("대마도").join("목적지");
  const withProductToken = index === 0
    ? `${withoutSpecificPlaces}\n\n대마도 상품 정보를 바탕으로 정리합니다.`
    : withoutSpecificPlaces;
  return index === strongerSections.length - 1
    ? withProductToken
    : `${withProductToken}\n\n${DISTINCT_FILLERS[index % DISTINCT_FILLERS.length].split("히타카츠").join("첫 번째 지역").split("이즈하라").join("두 번째 지역").split("대마도").join("목적지")}`;
}));
assert.equal(weak.canPublish, false);
assert.ok(
  ["too-short-content", "generic-guidance-heavy", "missing-review-substance"].includes(weak.code),
  `확인 안내형 여행 원고를 차단해야 합니다. 실제 코드: ${weak.code}`,
);
assert.equal(
  weak.signals.find((signal) => signal.key === "generic-guidance")?.status,
  "fail",
  "분량 차단이 먼저 걸려도 확인 안내 반복 문제를 함께 보여줘야 합니다.",
);
assert.ok(stronger.score > weak.score, `보강 원고 점수가 개선되어야 합니다: ${weak.score} -> ${stronger.score}`);
assert.equal(lowEvidence.canPublish, false);
assert.equal(lowEvidence.code, "low-evidence-density", lowEvidence.reason || lowEvidence.summary);
assert.equal(lowEvidence.signals.find((signal) => signal.key === "evidence-density")?.status, "fail");
assert.equal(stronger.signals.find((signal) => signal.key === "evidence-density")?.status, "pass");

const coverageOnlyFailure = getBrandLinkContentReadiness({
  productName,
  title: "대마도 2일 패키지 여행지 정보",
  sections: strongerSections.map((section, index) => {
    const withoutThirdPlace = section.replaceAll("미우다 해변", "북쪽 해변").replaceAll("대마도", "목적지");
    return index === 0
      ? `${withoutThirdPlace}\n\n2일 패키지 일정의 핵심 장소를 중심으로 설명합니다. 히타카츠에서는 항구 풍경을 걸으며 사진으로 남길 수 있어요. 이즈하라 골목은 현지 거리 분위기를 즐기기 좋습니다. 히타카츠 이동 동선은 배 도착 시간대에 맞춰 잡는 팁이 유용합니다.`
      : withoutThirdPlace;
  }),
  hashtags: ["대마도여행", "대마도2일", "대마도패키지", "여행커넥트"],
  brandLink: "https://brandconnect.naver.com/travel-fixture",
  generationSource: "AI",
  hasRepresentativeImage: true,
  requireRepresentativeImage: false,
  thumbnailGenerated: true,
  connectKind: "TRAVEL",
  experienceMode: "AI_ASSISTED_INFORMATION",
  sourceDescription: "",
  sourceFeatures: [
    "핵심 방문지: 히타카츠, 이즈하라, 미우다 해변",
    "1일차 일정: 히타카츠 → 이즈하라 → 미우다 해변",
  ],
  mode: "editorial",
});
assert.equal(coverageOnlyFailure.code, "low-evidence-density", coverageOnlyFailure.reason || coverageOnlyFailure.summary);
assert.match(coverageOnlyFailure.reason || "", /핵심 방문지 2\/3곳/u);
assert.doesNotMatch(
  coverageOnlyFailure.reason || "",
  /연결 3\/3|연결한 (?:내용|문장)이 부족/u,
  "장면 연결을 통과한 원고에 연결 부족이라는 모순된 사유를 표시하면 안 된다",
);

// --- 하드 차단과 품질 점수의 분리 ---
assert.equal(weak.verdict, "blocked");
assert.ok(weak.blockers.some((blocker) => blocker.code === "too-short-content" && blocker.tier === "structure"));
assert.ok(weak.quality.categories.find((category) => category.key === "clarity")?.status === "fail", "차단과 별개로 품질 카테고리도 함께 계산해야 함");
assert.equal(naturalTravel.verdict, "pass");
assert.ok(naturalTravel.quality.score >= naturalTravel.quality.passScore);
assert.equal(lowEvidence.verdict, "quality");
assert.equal(lowEvidence.blockers.length, 0, "품질 미달은 하드 차단이 아니다");

// 숫자·어미만 바뀐 문장이 섹션마다 반복되면 정규식으로 같은 문장이 아니어도 반복으로 본다.
const numberedRepeat = assess(strongerSections.map((section, index) =>
  index === strongerSections.length - 1
    ? section
    : `${section}\n\n판단 포인트 ${index + 1}은 상품의 표기 조건을 여행자의 시간과 예산에 연결해 장점과 대가를 함께 읽는 것입니다.`
));
assert.equal(numberedRepeat.code, "repetitive-content", numberedRepeat.reason || numberedRepeat.summary);
assert.equal(numberedRepeat.verdict, "quality");
assert.ok(numberedRepeat.quality.repetition.nearDuplicateCount >= 5);
assert.ok(numberedRepeat.score < naturalTravel.score, "반복 원고 점수는 자연 원고보다 낮아야 함");

// 여행 글에 쇼핑 문구(배송·교환·구성품)가 섞이면 카테고리 혼입 하드 차단.
const travelWithShopping = assess(strongerSections.map((section, index) =>
  index === 2 ? `${section}\n\n구성품과 배송 조건은 판매 페이지에서 확인해야 해요.` : section
));
assert.equal(travelWithShopping.code, "category-mismatch", travelWithShopping.reason || travelWithShopping.summary);
assert.equal(travelWithShopping.verdict, "blocked");
assert.ok(travelWithShopping.blockers.some((blocker) => blocker.tier === "safety"));

// 편집 단계에서는 대표 이미지가 아직 없어도 차단하지 않는다(발행 단계에서만 요구).
const editorialWithoutHero = getBrandLinkContentReadiness({
  productName,
  title: "대마도 2일 패키지 출발확정 시내숙박 예약 조건",
  sections: naturalTravelSections,
  hashtags: ["대마도여행", "대마도2일", "대마도패키지"],
  brandLink: "https://brandconnect.naver.com/travel-fixture",
  generationSource: "AI",
  hasRepresentativeImage: false,
  requireRepresentativeImage: true,
  thumbnailGenerated: false,
  connectKind: "TRAVEL",
  sourceDescription: "히타카츠 이즈하라 시내숙박 출발확정 티아라몰 쇼핑",
  sourceFeatures: travelSourceFeatures,
  mode: "editorial",
});
assert.equal(editorialWithoutHero.canPublish, true, editorialWithoutHero.reason || editorialWithoutHero.summary);
assert.ok(!editorialWithoutHero.signals.some((signal) => signal.key === "representative-image"), "편집 모드 신호에는 이미지 항목이 없어야 함");
const publishWithoutHero = getBrandLinkContentReadiness({
  productName,
  title: "대마도 2일 패키지 출발확정 시내숙박 예약 조건",
  sections: naturalTravelSections,
  hashtags: ["대마도여행", "대마도2일", "대마도패키지"],
  brandLink: "https://brandconnect.naver.com/travel-fixture",
  generationSource: "AI",
  hasRepresentativeImage: false,
  requireRepresentativeImage: true,
  thumbnailGenerated: false,
  connectKind: "TRAVEL",
  sourceDescription: "히타카츠 이즈하라 시내숙박 출발확정 티아라몰 쇼핑",
  sourceFeatures: travelSourceFeatures,
  mode: "publish",
});
assert.equal(publishWithoutHero.code, "missing-representative-image");
assert.equal(publishWithoutHero.score, editorialWithoutHero.score, "하드 차단은 품질 점수를 바꾸지 않는다");

const shoppingGuideSections = [
  "한 대를 여러 위치에서 쓰고 싶을 때\n\n샤크 플렉스브리즈 FA200KR은 유무선 올인원 선풍기예요. 한곳에 고정하기보다 필요한 곳으로 옮겨 쓰는 방향이 뚜렷해요. 콘센트가 멀어도 배치할 수 있다는 점이 선택 이유예요. 다만 배터리 조건도 함께 따져봐야 해요.",
  "유무선 구조가 만드는 차이\n\n일반 유선 선풍기는 전원선 범위 안에서 위치를 정해요. 무선으로도 쓸 수 있어 콘센트 영향을 덜 받아요. 거실에서 작업 공간으로 옮기기 편해요. 야외에서도 배치 선택지가 넓어집니다.",
  "스탠드형과 탁상형\n\n스탠드형과 탁상형을 함께 쓸 수 있어요. 거실에서 쓰다가 책상 주변으로 옮기는 활용을 생각할 수 있습니다. 한 대를 옮겨 쓰려는 집에 잘 맞아요. 형태를 바꾸는 과정은 상세 구성에서 살펴볼 부분이에요.",
  "선풍기와 서큘레이터\n\n사람 가까이에 바람을 보내면서 실내 공기 순환도 고려한 구성이에요. 거실 한쪽이나 공기가 머무는 지점에 둘 수 있어요. 위치를 자주 바꿀 때 장점이 커져요. 넓은 공간 성능은 자료를 보고 판단해야 합니다.",
  "무선 편의와 사용시간\n\n전원선 없이 움직일 수 있다는 점이 편리해요. 배터리가 줄어들면 무선 운전도 이어가기 어려워요. 야외 사용이 목적이라면 지속시간을 먼저 봐야 합니다. 충전 시간도 실제 활용 범위를 가르는 항목이에요.",
  "저소음과 풍량\n\n제품명에는 저소음 표현이 포함돼 있어요. 침실이나 업무 공간에서 쓸 계획이라면 풍량별 소음을 확인하는 편이 좋아요. 강한 바람이 필요하면 도달거리도 중요해요. 수치 비교가 필요합니다.",
  "비슷한 선풍기와 비교\n\n배치 자유도와 다양한 형태에 무게를 둔 제품이에요. 자주 옮길 예정이라면 무게와 보관 부피를 봐야 해요. 야외 활용이 많다면 충전 방식이 중요해져요. 강한 바람만 필요하면 일반 스탠드형도 후보예요.",
  "가격이 어울리는 조건\n\n판매 가격은 179,900원이에요. 보조용 탁상팬만 찾는다면 부담이 커요. 여러 활용을 한 대로 묶고 싶다면 판단이 달라져요. 사용 조건이 분명할 때 후보가 될 수 있습니다.",
  "최종 선택 기준\n\n유무선과 형태 전환이 필요한 사용자에게 잘 맞아요. 비추천 대상은 확인된 성능 수치 없이 강풍만 기대하는 사용자예요. 편의와 구조적 제약 중 어느 쪽이 큰지가 최종 기준이에요. 조건이 맞으면 선택 후보가 됩니다.",
  "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.",
];
const shoppingGuide = getBrandLinkContentReadiness({
  productName: "샤크 플렉스브리즈 FA200KR",
  title: "무선선풍기 샤크 플렉스브리즈 FA200KR 선택 기준",
  sections: shoppingGuideSections,
  hashtags: ["샤크플렉스브리즈", "FA200KR", "무선선풍기", "서큘레이터"],
  brandLink: "https://naver.me/shark-fixture",
  generationSource: "AI",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
  sourceDescription: "스탠드형에서 탁상형으로 분리 전환하는 유무선 서큘레이터",
  sourceFeatures: [
    "3단 풍속과 별도 브리즈부스트 모드",
    "1단·회전 미사용 기준 최대 24시간",
    "배터리 3,800mAh, 충전시간 약 6시간",
    "최대 20m 바람 도달거리",
    "좌우 최대 180도 회전",
    "크기 350 x 350 x 940mm, 무게 5.95kg",
  ],
  mode: "editorial",
});
assert.equal(shoppingGuide.canPublish, false, "제품 고유 사양을 쓰지 않은 선택 가이드형 쇼핑 원고는 차단해야 합니다.");
assert.equal(shoppingGuide.signals.find((signal) => signal.key === "evidence-density")?.status, "fail");

const naturalShoppingReview = getBrandLinkContentReadiness({
  productName: "블라우풍트 5in1 3헤드 면도기 IPX7 프리미엄 방수 전기면도기",
  title: "전기면도기 블라우풍트 5in1 선택 기준",
  sections: [
    "비슷한 제품과 갈리는 지점\n\n블라우풍트 5in1 3헤드 면도기는 면도만 보는 제품은 아니에요. 3헤드 전동면도기에 트리머 기능을 묶은 올인원 쪽에 가깝습니다. 헤드 구성과 관리 범위가 선택 이유예요. 수염 정리와 잔털 손질을 한 기기로 줄이고 싶은 사람에게 더 맞습니다.",
    "3헤드 구조가 만드는 차이\n\n3개의 원형 면도 헤드는 3D 플렉스 방식으로 얼굴 굴곡을 따라 움직입니다. 턱선처럼 각도가 바뀌는 구간에서 헤드 접촉을 유지하는 데 유리한 구조예요. 버튼 하나로 작동해 조작 순서도 단순합니다. 면도 뒤에는 헤드를 열어 수염 찌꺼기를 털어내면 됩니다.",
    "5in1 구성은 왜 의미가 있을까\n\n팝업트리머, 정밀트리머, 코털트리머를 바꿔 끼워 손질 범위를 넓힙니다. 구레나룻과 잔털까지 한 기기로 정리하는 사람에게 실용적입니다. 구매후기에서도 여행 가방에 넣을 기기 수가 줄어 편하다는 점이 반복됩니다. 사용 뒤에는 각 헤드를 말린 다음 한곳에 모아 보관하는 편이 좋아요.",
    "방수와 관리 편의\n\n습식과 건식 겸용 방수 설계가 표시되어 있습니다. 원터치 헤드 오픈 구조는 세척 편의성이 분명해요. 물기가 있는 공간에서는 방수 등급 차이가 중요합니다. 상품명은 IPX7, 이미지 일부는 IPX6라 최종 등급은 구매 화면을 기준으로 봐야 합니다.",
    "휴대용으로 볼 때\n\n1회 충전 60분 사용이라고 적혀 있습니다. 디지털 LED 인디케이터는 배터리 상태를 눈으로 확인하는 데 유용합니다. 안전 잠금 장치는 이동 중 버튼 눌림을 줄여줘요. 실제 무게가 없다면 휴대성 판단은 남겨둬야 합니다.",
    "아쉬운 점도 분명해요\n\n8,400rpm 표기는 확인되지만 체감 절삭력을 그대로 말해주지는 않습니다. 사용자 후기가 없어 소음과 피부 자극 판단도 비어 있어요. 민감한 피부라면 교체날 정보가 제품 자체의 제약이 됩니다. 면도 성능 하나만 원한다면 단일 고급 면도기가 더 나을 수 있어요.",
    "잘 맞는 사람과 덜 맞는 사람\n\n면도와 그루밍을 한 번에 정리하려는 사람에게 잘 맞습니다. 출장 때 트리머를 따로 챙기기 번거로운 사람에게도 어울려요. 이미 별도 트리머가 있다면 5in1 장점은 줄어듭니다. 절삭력만 우선하는 사람에게는 비추천 대상입니다.",
    "가격까지 놓고 보면\n\n가격과 5in1 구성을 함께 보면 여러 손질을 한 기기로 줄이고 싶은 사람에게 후보가 됩니다. 기능을 실제로 모두 쓸 때 가격의 의미가 살아나요. 반대로 면도만 필요하면 구성 과잉일 수 있습니다. 사용 목적이 맞는지가 최종 선택 기준입니다.",
    "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.",
  ],
  hashtags: ["전기면도기", "블라우풍트면도기", "남자전기면도기", "여행용면도기"],
  brandLink: "https://naver.me/shaver-fixture",
  generationSource: "AI",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
  sourceDescription: "블라우풍트 5in1 3헤드 전기면도기 팝업트리머 정밀트리머 코털트리머",
  sourceFeatures: [
    "3D 플렉스 3헤드 시스템",
    "5in1 멀티그루밍 올인원 구성",
    "습식 건식 겸용 방수 설계",
    "원터치 헤드 오픈",
    "1회 충전 60분 사용",
    "디지털 LED 인디케이터",
    "안전 잠금 장치",
    "8,400rpm",
    "구매후기 근거: 여행 가방에 면도기와 트리머를 따로 넣지 않아도 되어 편합니다",
  ],
  mode: "editorial",
});
assert.equal(naturalShoppingReview.canPublish, true, naturalShoppingReview.reason || naturalShoppingReview.summary);
assert.equal(naturalShoppingReview.signals.find((signal) => signal.key === "editorial-flow")?.status, "pass");
assert.equal(naturalShoppingReview.signals.find((signal) => signal.key === "review-substance")?.status, "pass");
assert.equal(naturalShoppingReview.signals.find((signal) => signal.key === "evidence-density")?.status, "pass");
const naturalShoppingSubstance = assessProductReviewSubstance({
  productName: "블라우풍트 5in1 3헤드 면도기 IPX7 프리미엄 방수 전기면도기",
  sections: naturalShoppingReview.canPublish ? [
    "5in1 구성과 사용법\n\n3헤드와 트리머를 바꿔 끼워 수염과 잔털을 정리합니다. 사용 뒤에는 원터치 헤드를 열어 세척하고 물기를 말려 보관합니다. 구매후기에서도 여행 가방에 면도기와 트리머를 따로 넣지 않아 편하다는 점이 반복됩니다. 여러 손질을 한 기기로 줄이는 것이 핵심 장점입니다.",
    "방수와 충전 관리\n\nLED로 배터리를 확인하고 충전한 뒤 안전 잠금을 켜서 보관합니다. 방수 구조는 세척 시간을 줄여줍니다. 다만 확인된 등급 차이는 최종 규격을 기준으로 판단합니다. 면도 성능만 필요하면 구성 과잉일 수 있습니다.",
  ] : [],
  sourceDescription: "블라우풍트 5in1 3헤드 전기면도기",
  sourceFeatures: [
    "3D 플렉스 3헤드 시스템",
    "원터치 헤드 오픈",
    "1회 충전 60분 사용",
    "구매후기 근거: 여행 가방에 면도기와 트리머를 따로 넣지 않아도 되어 편합니다",
  ],
});
assert.equal(naturalShoppingSubstance.coveredReviewEvidence.length, 1);
assert.ok(naturalShoppingSubstance.usageInstructionCount >= 2);
const semanticLimitationSubstance = assessProductReviewSubstance({
  productName: "칸토 섬유유연제 1.3L 3개입",
  sections: [
    "향과 사용량\n\n칸토 섬유유연제는 1.3L 파우치 3개 구성입니다. 권장량을 계량해 사용하고 원래 용기에 밀봉해 보관합니다. 향은 건조 환경과 취향에 따라 체감이 달라질 수 있습니다.",
    "구성을 고를 때\n\n향이 맞아 꾸준히 쓰는 가정에는 편리합니다. 반대로 처음 접하는 향이라면 3개 구성이 부담이 될 수 있어요. 객관적인 탈취 성능 수치는 확인되지 않았습니다.",
  ],
  sourceDescription: "고농축 퍼퓸 섬유유연제 일반 드럼 세탁기 겸용",
  sourceFeatures: ["1.3L 파우치 3개", "7~10kg 세탁물 14~23ml"],
});
assert.equal(
  semanticLimitationSubstance.missingElements.includes("제품 자체의 단점·제약"),
  false,
  "부담·취향 의존·미확인 성능을 명시한 문장은 제품 제약으로 인정해야 합니다.",
);
const semanticConditionalVerdict = assessProductReviewSubstance({
  productName: "엔산마운트 FS-100 캠핑 TV스탠드",
  sections: [
    "호환 규격과 조절 범위\n\nFS-100은 15~32인치, 10kg 미만 화면을 지원합니다. 높이와 방향을 바꿀 수 있다는 점이 장점이고, VESA 규격이 맞지 않으면 설치할 수 없다는 점은 제품 자체의 제약입니다. 설치할 때는 다리를 펼치고 고정핀을 체결한 뒤 화면 각도를 조절합니다. 캠핑 장비를 자주 옮기는 사용자에게 잘 맞아요.",
    "구매 전에는 이동성보다 호환 규격을 먼저 보세요\n\n캠핑이나 야외처럼 설치 위치와 시청 방향이 계속 달라지는 환경이라면 조절 기능이 제품 선택 이유가 될 수 있어요. 반대로 한 자리에 고정할 화면이라면 더 단순한 거치 방식이 맞을 수도 있습니다. 결국 FS-100은 호환 규격이 맞는 화면을 가지고 다니면서 높이와 방향을 자주 바꾸려는 경우에 강점이 분명한 제품이에요.",
  ],
  sourceDescription: "15~32인치 캠핑용 접이식 TV 모니터 스탠드",
  sourceFeatures: ["10kg 미만", "VESA 75×75mm와 100×100mm", "높이와 방향 조절"],
});
assert.equal(
  semanticConditionalVerdict.missingElements.includes("조건부 최종 결론"),
  false,
  "조건과 판단을 함께 제시한 자연스러운 마지막 총평은 고정 문구 없이도 조건부 결론으로 인정해야 합니다.",
);
const conditionWithoutVerdict = assessProductReviewSubstance({
  productName: "엔산마운트 FS-100 캠핑 TV스탠드",
  sections: [
    "확인할 조건\n\nFS-100은 15~32인치 화면을 지원합니다. 캠핑에서 사용한다면 설치 전에 VESA 규격을 확인해야 합니다. 높이 조절은 장점이고, 10kg을 넘는 화면을 설치할 수 없는 점은 제약입니다. 화면 규격이 맞는 사용자에게 잘 맞아요.",
    "마지막 안내\n\n구매하는 경우 배송 일정은 결제 화면에서 확인하세요. 캠핑 라면은 조리 편의가 강점인 별도 식품입니다.",
  ],
  sourceDescription: "15~32인치 캠핑용 접이식 TV 모니터 스탠드",
  sourceFeatures: ["10kg 미만", "VESA 75×75mm와 100×100mm", "높이 조절"],
});
assert.equal(
  conditionWithoutVerdict.missingElements.includes("조건부 최종 결론"),
  true,
  "마지막 섹션에 조건만 있고 제품 선택 판단이 없으면 조건부 결론으로 통과시키면 안 됩니다.",
);
const detailReadingSubstance = assessProductReviewSubstance({
  productName: "블라우풍트 5in1 3헤드 전기면도기",
  sections: Array.from({ length: 6 }, (_, index) =>
    `상세정보 ${index + 1}\n\n상세페이지에는 3헤드가 적혀 있습니다. 상품 설명에는 트리머가 표시되어 있습니다. 이미지에는 방수 기능이 보입니다. 판매페이지에서 충전 기능이 확인됩니다.`
  ),
  sourceDescription: "블라우풍트 5in1 3헤드 전기면도기",
  sourceFeatures: ["3D 플렉스 3헤드 시스템", "원터치 헤드 오픈", "1회 충전 60분 사용"],
});
assert.ok(detailReadingSubstance.missingElements.includes("상세페이지 낭독형 문장 제거"));

const approvedShoppingMarkdown = `# 휴대용선풍기 프롬비 FB150 선택 기준

## 기능 수보다 쓰는 조건을 봤어요

프롬비 빅팬 휴대용 폴더블 선풍기 FB150은 손에 드는 선풍기와 탁상용 선풍기를 함께 노린 제품이에요. 상품 설명에는 5,200mAh 배터리와 최대 40시간 사용이 적혀 있어요. 무선 배치가 가장 분명한 장점이고, 풍량 수치가 없는 점은 제약이에요.

## 핸디형과 탁상용을 오가는 구조

핸디형과 탁상용을 하나로 쓸 수 있어 책상과 야외를 오가는 사람에게 실용적이에요. 받침 안정성과 휴대 부피는 사용 전에 비교할 부분입니다.

## 아쉬운 점은 성능 정보가 적다는 것

풍량과 소음 수치가 없어 강한 직진풍을 우선하는 사람에게는 아쉬워요. 작은 가방에 넣을 초소형 제품을 원하는 사람에게도 부피가 제약입니다.

## 잘 맞는 사람과 덜 맞는 사람

책상과 야외를 오가며 쓰는 사람에게 잘 맞습니다. 강한 바람과 낮은 소음의 확인된 수치를 우선하는 사람에게는 비추천 대상입니다.

## 가격까지 놓고 보면

무선 배치와 큰 팬 형태가 필요하다면 프롬비 FB150은 후보에 올릴 만해요. 성능 수치가 우선이면 비교 제품을 고르는 편이 더 낫습니다.
이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.
자세한 상품 정보는 아래 쇼핑커넥트에서 확인해보세요.

#휴대용선풍기 #프롬비FB150 #무선선풍기 #탁상용선풍기`;
const approvedShoppingSections = parsePreparedBrandPostSections(approvedShoppingMarkdown);
assert.equal(approvedShoppingSections.length, 6, "마지막 결론과 커넥트 고지 문구가 별도 섹션으로 복원되어야 합니다.");
assert.match(approvedShoppingSections.at(-2) || "", /후보에 올릴/u);
assert.match(approvedShoppingSections.at(-1) || "", /쇼핑 커넥트 활동/u);
assert.doesNotMatch(approvedShoppingSections.at(-1) || "", /#휴대용선풍기/u);

const approvedShoppingRoundTrip = getBrandLinkContentReadiness({
  productName: "프롬비 빅팬 휴대용 폴더블 선풍기 FB150",
  title: "휴대용선풍기 프롬비 FB150 선택 기준",
  sections: approvedShoppingSections,
  hashtags: ["휴대용선풍기", "프롬비FB150", "무선선풍기", "탁상용선풍기"],
  brandLink: "https://naver.me/fb150-fixture",
  generationSource: "PREPARED_APPROVED",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
  sourceDescription: "핸디형과 탁상형을 오가는 무선 폴더블 선풍기",
  sourceFeatures: ["5,200mAh 배터리", "최대 40시간 사용", "핸디형과 탁상용"],
  mode: "publish",
});
assert.equal(
  approvedShoppingRoundTrip.reason?.includes("여행") ?? false,
  false,
  "쇼핑 발행 품질 사유에 여행 전용 역할명이 노출되면 안 됩니다.",
);
assert.equal(SHOPPING_POST_CONTRACT_V1.targetImages.min, 5);
assert.equal(SHOPPING_POST_CONTRACT_V1.targetImages.recommended, 8);
assert.equal(TRAVEL_POST_CONTRACT_V1.targetImages.min, 7);
assert.equal(TRAVEL_POST_CONTRACT_V1.targetImages.recommended, 10);

const shoppingPrompt = buildBrandPostImagePrompt({
  connectKind: "SHOPPING",
  productName: "무선 선풍기",
  sectionTitle: "바람 세기와 사용 장면",
  imageIntent: "여름 책상 위 사용 장면",
  role: "body",
});
assert.match(shoppingPrompt, /environment only/u);
assert.match(shoppingPrompt, /Do not draw, imitate, redesign, recolor/u);
assert.doesNotMatch(shoppingPrompt, /must generate (?:nine|eighteen)|18 images/iu);

const travelPrompt = buildBrandPostImagePrompt({
  connectKind: "TRAVEL",
  productName,
  sectionTitle: "히타카츠와 이즈하라",
  imageIntent: "항구와 시내 분위기",
  role: "body",
});
assert.match(travelPrompt, /photorealistic travel editorial photograph/iu);
assert.match(travelPrompt, /do not invent a named hotel/iu);

const simpleAgentSource = fs.readFileSync(path.join(process.cwd(), "scripts", "simple-agent.ts"), "utf8");
const writingStyleSource = fs.readFileSync(path.join(process.cwd(), "scripts", "lib", "blog-writing-style.ts"), "utf8");
const sitesMcpSource = fs.readFileSync(
  path.join(process.cwd(), "apps", "sites", "app", "api", "mcp", "[credential]", "route.ts"),
  "utf8",
);
assert.match(simpleAgentSource, /brand-draft-quality-checklist\/v1/u);
assert.match(simpleAgentSource, /눈앞의 장면 → 즐길 거리 또는 실용 팁/u);
assert.match(writingStyleSource, /도착 장면 → 장소의 배경 → 현장에서 할 일/u);
assert.match(writingStyleSource, /거리·소요시간·입장료·운영시간·교통비/u);
assert.match(formatDraftSubmissionNextAction(), /contentQuality\.canPublish가 false/u);
assert.match(formatDraftSubmissionNextAction(), /이미지·배치 실패만 있으면 원고를 재작성하거나 재제출하지 마세요/u);
// The deployed repair policy was raised to three attempts; retain the bounded
// loop assertion rather than assuming the obsolete two-attempt constant.
assert.match(simpleAgentSource, /maximumRepairAttempts = 1;/u, "2026-09-24 보정: 보강은 1회로 끝낸다");
assert.match(simpleAgentSource, /repairAttempt <= maximumRepairAttempts && !editorialQuality.canPublish/u);
assert.match(simpleAgentSource, /shouldAcceptQualityRepair\(editorialQuality, repairedQuality\)/u);
assert.doesNotMatch(simpleAgentSource, /편집 역할 \$\{role\}/u);
assert.match(sitesMcpSource, /실제 원고 내용 실패\(텍스트 signals\)는 새 idempotencyKey로 post_revise_draft를 호출/u);
assert.match(sitesMcpSource, /품질검사 기준을 우회하지 마세요/u);
assert.match(sitesMcpSource, /이미지 부족만으로는 원고를 다시 제출하지 않습니다/u);
const step2CallIndex = simpleAgentSource.indexOf("await step2_generatePost(");
const persistedEvidenceIndex = simpleAgentSource.indexOf(
  "productFeatures: product.features.length > 0 ? JSON.stringify(product.features) : null",
  step2CallIndex,
);
assert.ok(step2CallIndex >= 0, "step2_generatePost call must exist");
assert.ok(
  persistedEvidenceIndex > step2CallIndex,
  "GPT evidence facts must be persisted after step2_generatePost",
);

// 키워드 태그만 있는 상품은 원고 문구를 늘려도 제품 근거가 생기지 않는다.
const vestProductName = "RNRN 러닝조끼 메쉬 남녀공용 러닝 베스트";
const vestKeywordTags = ["러닝조끼", "메쉬", "러닝", "조끼", "러닝베스트", "여름", "운동"];
const vestSections = [
  "가벼운 러닝조끼가 필요한 순간\n\n새벽이나 퇴근 후에 달리면 얇은 티셔츠 위에 뭔가 한 겹이 더 필요할 때가 있어요. RNRN 러닝조끼는 통기용 메쉬 소재라 땀이 차는 구간의 열 배출에 유리합니다. 남녀공용 사이즈라 러닝 크루가 같은 옷을 맞추기 수월해요. 바람막이처럼 체온을 가두는 옷은 아니라는 점을 먼저 알고 고르는 게 좋습니다.",
  "메쉬 소재가 만드는 차이\n\n메쉬는 구멍이 촘촘한 직조라 공기가 통과하면서 등판의 열기를 빼 줍니다. 그래서 RNRN 러닝조끼는 한여름 인터벌처럼 땀이 많이 나는 훈련에서 장점이 뚜렷해요. 반면 초겨울 새벽처럼 바람이 차가운 날에는 보온이 거의 없어서 한계가 분명합니다. 계절에 따라 역할이 갈리는 옷이라고 보면 이해가 빨라요.",
  "착용과 세척은 이렇게\n\n착용은 러닝 티셔츠 위에 조끼를 겹쳐 입고 어깨선이 뒤로 밀리지 않게 정리하면 됩니다. 세척은 메쉬 올이 늘어나지 않도록 세탁망에 넣어 찬물로 돌리는 편이 안전해요. 보관은 옷걸이에 걸기보다 접어서 서랍에 두는 쪽이 형태가 오래 갑니다. 건조기는 열에 약한 합성 소재라 피하는 편이 좋아요.",
  "가격을 어떻게 볼까\n\n판매가는 13,700원이고 할인 전 가격은 59,800원으로 표시돼 있어요. 할인 폭이 큰 대신 이 가격에서 기대할 수 있는 건 기본 메쉬 조끼의 역할까지라고 보는 게 현실적입니다. Npay Plus 적립까지 더하면 러닝 크루 단체 구매처럼 여러 벌을 맞출 때 부담이 줄어요. 고기능 러닝 베스트 가격대와 비교하면 입문용으로 시험해 보기 좋은 값이에요.",
  "아쉬운 부분\n\n메쉬 특성상 얇아서 가방끈이나 벨트에 걸리면 올이 나가기 쉽다는 점은 제품 자체의 제약이에요. 수납 포켓이나 반사 소재 여부는 확인된 정보가 없어서 야간 러닝 안전장비로 기대하면 안 됩니다. 사이즈 표기도 남녀공용 기준이라 체형에 따라 품이 넉넉하게 느껴질 수 있어요. 러닝 외 등산처럼 배낭을 메는 활동에는 어울리지 않는 옷입니다.",
  "이런 러너에게 잘 맞아요\n\n여름 새벽 러닝이나 트랙 훈련처럼 땀 배출이 우선인 러너에게 잘 맞습니다. 러닝 크루에서 같은 옷을 저렴하게 맞추고 싶은 경우에도 어울려요. 반대로 반사 소재나 보온이 필요한 러너에게는 비추천 대상이에요. 한 벌로 사계절을 버티려는 계획이라면 다른 형태가 더 낫습니다.",
  "최종 판단\n\nRNRN 러닝조끼는 여름 훈련용 메쉬 베스트가 필요하고 13,700원 안에서 해결하고 싶을 때 선택할 만한 후보예요. 보온과 야간 시인성까지 원한다면 이 제품이 아니라 반사 소재가 들어간 러닝 베스트를 고르는 편이 맞습니다. 조건이 맞으면 부담 없이 시험해 볼 수 있는 값이라는 게 결론이에요.",
  "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.",
];
const assessVest = (sourceFeatures: string[], sourceDescription = "RNRN 공식스토어 러닝 용품") => getBrandLinkContentReadiness({
  productName: vestProductName,
  title: "러닝조끼 RNRN 메쉬 베스트 여름 훈련용으로 볼 때",
  sections: vestSections,
  hashtags: ["러닝조끼", "메쉬조끼", "러닝베스트", "여름러닝"],
  brandLink: "https://naver.me/vest-fixture",
  generationSource: "AI",
  hasRepresentativeImage: true,
  thumbnailGenerated: true,
  connectKind: "SHOPPING",
  sourceDescription,
  sourceFeatures,
  mode: "editorial",
});
const vestCategory = (readiness: ReturnType<typeof getBrandLinkContentReadiness>, key: string) =>
  readiness.quality.categories.find((category) => category.key === key)!;
const vestKeywordOnly = assessVest(vestKeywordTags);
assert.equal(vestKeywordOnly.canPublish, false, "키워드와 상품명만으로 구체적인 기능·세척법을 쓴 원고를 자동 승인하면 안 됩니다.");
assert.equal(vestCategory(vestKeywordOnly, "productEvidence").status, "fail");
assert.match(vestCategory(vestKeywordOnly, "productEvidence").notes.join(" "), /상세 정보를 다시 수집/u);
assert.equal(vestKeywordOnly.quality.sourceEvidence?.level, "sparse");
assert.equal(vestKeywordOnly.quality.sourceEvidence?.sufficient, false);
const vestEvidenceFeatures = ["통기용 메쉬 소재", "남녀공용 사이즈"];
const vestScoringFeatures = buildProductScoringFeatures({
  productName: vestProductName,
  description: "통기용 메쉬 소재를 사용한 남녀공용 러닝 조끼",
  features: vestEvidenceFeatures,
  price: "13,700원",
  originalPrice: "59,800원",
  couponInfo: "Npay Plus 적립",
  targetSectionCount: 11,
});
assert.ok(vestScoringFeatures.includes("가격: 13,700원") && vestScoringFeatures.includes("원가: 59,800원"), "가격·원가 사실 줄이 채점 입력에 들어가야 합니다.");
assert.ok(!vestScoringFeatures.some((line) => /^구매후기 원문 근거:/u.test(line)));
const vestWithFacts = assessVest(vestScoringFeatures, "통기용 메쉬 소재를 사용한 남녀공용 러닝 조끼");
const vestSubstance = assessProductReviewSubstance({
  productName: vestProductName,
  sections: vestSections,
  sourceDescription: "통기용 메쉬 소재를 사용한 남녀공용 러닝 조끼",
  sourceFeatures: vestScoringFeatures,
});
assert.equal(vestSubstance.signalEvidenceAvailable, true);
assert.ok(!vestSubstance.coveredSignals.some((signal) => /^가격:/u.test(signal)), "가격은 선택 정보지만 제품 기능 근거로 세면 안 됩니다.");
assert.ok(
  vestSubstance.groundedSignalCount >= vestSubstance.requiredGroundedSignalCount,
  JSON.stringify({
    grounded: vestSubstance.groundedSignalCount,
    required: vestSubstance.requiredGroundedSignalCount,
    covered: vestSubstance.coveredSignals,
    sourceLevel: vestSubstance.sourceEvidenceLevel,
  }),
);
assert.equal(vestCategory(vestWithFacts, "productEvidence").score, 25);
assert.deepEqual(vestCategory(vestWithFacts, "productEvidence").notes, []);
assert.equal(vestCategory(vestWithFacts, "sceneLinkage").score, 20);
const vestNoJudgement = assessProductReviewSubstance({
  productName: vestProductName,
  sections: [
    "러닝조끼 소개\n\nRNRN 러닝조끼는 메쉬 소재로 만든 남녀공용 러닝 베스트입니다. 착용은 티셔츠 위에 겹쳐 입습니다. 세척은 세탁망에 넣어 찬물로 돌립니다.",
    "가격\n\n판매가는 13,700원이고 할인 전 가격은 59,800원입니다. Npay Plus 적립이 표시돼 있습니다.",
  ],
  sourceDescription: "RNRN 공식스토어 러닝 용품",
  sourceFeatures: vestKeywordTags,
});
assert.equal(vestNoJudgement.signalEvidenceAvailable, false);
assert.equal(vestNoJudgement.requiredSignalCount, 0, "신호가 없으면 없는 신호를 요구하지 않습니다.");
assert.equal(vestNoJudgement.evidenceJudgementCount, 0, "상품명 앵커 폴백도 판단 문장이 없으면 0으로 세야 합니다.");
assert.ok(vestNoJudgement.missingElements.includes("서로 다른 근거와 사용 가치가 연결된 판단"));

console.log(JSON.stringify({
  ok: true,
  weak: { code: weak.code, score: weak.score },
  stronger: { code: stronger.code, score: stronger.score },
  lowEvidence: { code: lowEvidence.code, score: lowEvidence.score },
  imageTargets: {
    shopping: SHOPPING_POST_CONTRACT_V1.targetImages,
    travel: TRAVEL_POST_CONTRACT_V1.targetImages,
  },
}));

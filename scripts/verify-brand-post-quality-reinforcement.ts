import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { buildBrandPostImagePrompt } from "../src/lib/brand-post-image-generation";
import {
  SHOPPING_POST_CONTRACT_V1,
  TRAVEL_POST_CONTRACT_V1,
} from "../src/lib/post-composition-contract";

const productName = "출발확정 여행핫딜 시내숙박 대마도 2일 패키지";
const disclosure = "이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받습니다.";
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
  "한 줄 결론\n\n대마도 2일 패키지의 장점은 긴 연차 없이 섬 여행과 숙박을 한 번에 묶는다는 점이에요. 대신 왕복 이동이 들어가는 짧은 일정이라 한 장소에 깊게 머무는 여행과는 거리가 있습니다. 넓게 보고 이동 준비를 줄이고 싶은 여행자에게 선택 이유가 분명합니다.",
  "코스의 성격\n\n히타카츠와 이즈하라를 잇는 동선이라면 대마도의 항구 풍경과 생활권 분위기를 함께 보는 구성이 됩니다. 이 코스의 매력은 서로 다른 지역 인상을 짧게 비교하는 데 있고, 이동 부담은 체류시간이 잘게 나뉠 수 있다는 점입니다. 사진 명소 개수보다 각 구간의 머무는 시간이 만족도를 좌우합니다.",
  "숙소와 저녁\n\n시내숙박은 저녁에 편의점이나 식당을 찾기 쉬운 위치라면 1박 2일의 짧은 체류를 효율적으로 만듭니다. 숙소가 집결지와 가까울수록 이른 출발 부담도 줄어듭니다. 반대로 시내라는 표현의 범위가 넓다면 자유시간 활용도가 낮아질 수 있는 제약이 있습니다.",
  "출발확정의 가치\n\n출발확정은 연차와 국내 이동편을 미리 잡는 여행자에게 실질적인 장점입니다. 출발 취소 가능성을 낮춘다는 점에서 단순 할인보다 일정 안정성의 가치가 큽니다. 다만 날짜별 상태가 달라질 수 있으므로 선택 날짜의 출발 조건이 최종 판단 기준입니다.",
  "포함 조건과 예상 지출\n\n표시가 126,003원은 짧은 해외여행의 진입 가격으로 매력적이지만, 식사·입장료·현지 필수경비가 더해지면 체감 예산이 달라집니다. 티아라몰 쇼핑과 라벤더비누 특전은 부가 요소이고, 핵심 가치는 왕복 교통과 숙박이 어디까지 포함되는지에 달려 있습니다. 가격은 추가 지출까지 합쳐 비교해야 합니다.",
  "준비와 이동 강도\n\n2일 동안 항구 이동과 관광을 함께 소화하려면 작은 짐과 걷기 편한 복장이 유리합니다. 대마도는 날씨 변화와 해상 이동의 영향을 받을 수 있어 출발 시간에 맞춘 준비가 중요합니다. 보행이 부담인 동행이 있다면 이동 횟수와 휴식 구간이 이 상품의 리스크가 됩니다.",
  "추천·비추천 여행자\n\n추천 여행자는 첫 대마도 여행에서 교통과 숙소 예약 수고를 줄이고 대표 지역을 폭넓게 보고 싶은 분입니다. 비추천 여행자는 골목과 카페에 오래 머물거나 쇼핑 일정 없이 자유롭게 움직이고 싶은 분입니다. 짧고 정돈된 패키지를 원하는지, 깊게 머무는 자유여행을 원하는지가 적합도를 가릅니다.",
  "최종 리뷰\n\n최종 리뷰는 출발확정과 시내숙박이 주는 안정성이 분명한 대신, 짧은 일정의 이동 밀도를 감수하는 상품이라는 것입니다. 동행이 이동 중심 코스를 받아들일 수 있고 포함 조건이 예산에 맞는다면 후보에 올릴 만합니다. 자유시간이 최우선이라면 더 긴 일정이나 자유여행이 낫습니다.",
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

const weak = assess(weakSections);
const stronger = assess(strongerSections.map((section, index) => (
  index === strongerSections.length - 1
    ? section
    : `${section}\n\n판단 포인트 ${index + 1}은 상품의 표기 조건을 여행자의 시간·예산·이동 성향에 연결해 장점과 대가를 함께 읽는 것입니다. 선택 차이 ${index + 1}은 단순 예약 안내보다 실제 결정에 필요한 기준을 선명하게 만듭니다.`
)));
const lowEvidence = assess(strongerSections.map((section, index) => {
  const withoutSpecificPlaces = section
    .replaceAll("히타카츠", "첫 번째 지역")
    .replaceAll("이즈하라", "두 번째 지역")
    .replaceAll("대마도", "목적지");
  const withProductToken = index === 0
    ? `${withoutSpecificPlaces}\n\n대마도 상품 정보를 바탕으로 정리합니다.`
    : withoutSpecificPlaces;
  return index === strongerSections.length - 1
    ? withProductToken
    : `${withProductToken}\n\n판단 관점 ${index + 1}은 일정 선택의 장점과 대가를 독자의 시간과 예산에 연결합니다. 선택 기준 ${index + 1}을 놓고 보면 우선순위가 더 분명해집니다.`;
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
const sitesMcpSource = fs.readFileSync(
  path.join(process.cwd(), "apps", "sites", "app", "api", "mcp", "[credential]", "route.ts"),
  "utf8",
);
assert.match(simpleAgentSource, /brand-draft-quality-checklist\/v1/u);
assert.match(simpleAgentSource, /근거 사실 → 사용\/여행 장면의 의미 → 이점 또는 대가/u);
assert.match(simpleAgentSource, /contentQuality\.canPublish가 false/u);
assert.match(sitesMcpSource, /contentQuality\.canPublish가 false/u);

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

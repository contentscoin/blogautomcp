import assert from "node:assert/strict";
import {
  SHOPPING_POST_CONTRACT_V1,
  TRAVEL_POST_CONTRACT_V1,
  resolvePostDocument,
} from "../src/lib/post-composition-contract";

function buildSections(prefix: string, count: number, paragraphLength: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const paragraph = `${prefix} ${index + 1} ${"확인된 정보를 바탕으로 선택 기준을 구체적으로 정리합니다. ".repeat(paragraphLength)}`;
    return `${prefix} ${index + 1}\n\n${paragraph.trim()}`;
  });
}

const shoppingImages = Array.from({ length: 12 }, (_, index) => `C:/fixture/shopping-${index}.png`);
const shopping = resolvePostDocument({
  connectKind: "SHOPPING",
  title: "상품 선택 기준 이 글은 네이버 쇼핑 커넥트 활동의 일환으로, 구매 발생 시 수수료를 제공받을 수 있습니다.",
  sections: [
    ...buildSections("쇼핑 섹션", SHOPPING_POST_CONTRACT_V1.sections.length, 4),
    "네이버 쇼핑 커넥트 활동을 통해 수수료를 제공받을 수 있습니다.",
  ],
  hashtags: ["쇼핑커넥트", "구매가이드", "상품정보"],
  imagePaths: shoppingImages,
  connectUrl: "https://brandconnect.naver.com/shopping-fixture",
  qualityPreset: "STANDARD",
});

assert.equal(shopping.sections.length, SHOPPING_POST_CONTRACT_V1.sections.length);
assert.equal(shopping.renderNodes.filter((node) => node.kind === "connectCard").length, 2);
assert.equal(shopping.renderNodes.filter((node) => node.kind === "image").length, shoppingImages.length);
assert.notEqual(shopping.renderNodes[0].kind, "disclosure");
assert.equal(shopping.renderNodes.at(-2)?.kind, "hashtags");
assert.equal(shopping.renderNodes.at(-1)?.kind, "disclosure");
assert.equal(
  shopping.renderNodes.filter((node) => node.kind === "disclosure" && node.disclosureType === "ai").length,
  0,
  "AI 작성 안내 문구는 본문에 노출하지 않아야 합니다.",
);
assert.equal(
  shopping.renderNodes.filter((node) => node.kind === "quotation").length,
  0,
  "네이버 에디터에 빈 인용구가 생기지 않도록 모든 소제목은 heading 노드여야 합니다.",
);
assert.deepEqual(SHOPPING_POST_CONTRACT_V1.targetImages, { min: 5, recommended: 8, max: 14 });

const travelImages = Array.from({ length: 20 }, (_, index) => `C:/fixture/travel-${index}.jpg`);
const travel = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "타이베이 3박 4일 코스",
  sections: [
    ...buildSections("여행 섹션", TRAVEL_POST_CONTRACT_V1.sections.length, 8),
    "네이버 여행 커넥트 활동을 통해 수수료를 제공받을 수 있습니다.",
  ],
  hashtags: ["여행커넥트", "타이베이여행", "패키지여행"],
  imagePaths: travelImages,
  connectUrl: "https://brandconnect.naver.com/travel-fixture",
  qualityPreset: "PREMIUM",
});

assert.equal(travel.sections.length, TRAVEL_POST_CONTRACT_V1.sections.length);
assert.equal(travel.renderNodes.filter((node) => node.kind === "connectCard").length, 2);
assert.equal(travel.renderNodes.filter((node) => node.kind === "image").length, travelImages.length);
assert.equal(travel.qualityReport.actual.images, 20);
assert.equal(travel.qualityReport.canAutoPublish, true);
assert.equal(travel.renderNodes.filter((node) => node.kind === "quotation").length, 0);
assert.deepEqual(TRAVEL_POST_CONTRACT_V1.targetImages, { min: 7, recommended: 10, max: 18 });
assert.ok(
  travel.renderNodes.some(
    (node) => node.kind === "image" && node.layout === "collage-3",
  ),
  "여행 하이라이트 이미지는 3장 콜라주 의도를 보존해야 합니다.",
);

assert.equal(
  shopping.title,
  "상품 선택 기준",
  "제목에 제휴 고지문이 섞이지 않아야 합니다.",
);
assert.ok(
  travel.renderNodes.some(
    (node) =>
      node.kind === "connectCard" &&
      node.connectKind === "TRAVEL" &&
      node.placement === "early",
  ),
  "여행 레퍼럴 카드는 본문 초반에 한 번 배치되어야 합니다.",
);

const travelMaxImages = Array.from(
  { length: TRAVEL_POST_CONTRACT_V1.targetImages.max },
  (_, index) => `C:/fixture/travel-max-${index}.jpg`,
);
const travelAtMaximum = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "여행 이미지 최대 배치 검증",
  sections: buildSections("여행 최대 섹션", TRAVEL_POST_CONTRACT_V1.sections.length, 8),
  hashtags: ["여행커넥트", "여행이미지", "패키지여행"],
  imagePaths: travelMaxImages,
  connectUrl: "https://brandconnect.naver.com/travel-max-fixture",
  qualityPreset: "PREMIUM",
});
assert.equal(
  travelAtMaximum.renderNodes.filter((node) => node.kind === "image").length,
  travelMaxImages.length,
  "여행 계약 최대 이미지가 모두 실제 렌더 노드로 배치되어야 합니다.",
);
assert.deepEqual(travelAtMaximum.qualityReport.warnings, []);

const premiumBlocked = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "이미지 부족 초안",
  sections: buildSections("짧은 여행 섹션", 5, 1),
  hashtags: ["여행", "코스", "예약"],
  imagePaths: ["C:/fixture/only-one.jpg"],
  connectUrl: "https://brandconnect.naver.com/travel-fixture",
  qualityPreset: "PREMIUM",
});
assert.equal(premiumBlocked.qualityReport.canAutoPublish, false);
assert.ok(premiumBlocked.qualityReport.blockers.length >= 2);
assert.ok(premiumBlocked.qualityReport.imageCoverage.missingSectionIds.length > 0);

console.log("post composition contract verified", {
  shoppingNodes: shopping.renderNodes.length,
  travelNodes: travel.renderNodes.length,
  travelScore: travel.qualityReport.score,
  premiumBlockers: premiumBlocked.qualityReport.blockers,
});

// --- Spec-first 섹션 플랜: 팔레트 순서 대신 실제 슬롯 배정·역할·하한/상한을 따른다 ---
const planImages = Array.from({ length: 9 }, (_, index) => `C:/fixture/plan-${index}.jpg`);
const planSections = [
  "결론부터\n\n첫 줄 요약이에요.\n둘째 줄 요약이에요.\n셋째 줄 요약이에요.",
  "상품 한눈에 보기\n\n• 상품명: 예시\n• 기간: 3박5일",
  "전체 일정 흐름\n\n흐름 설명 문장이에요.\n둘째 문장이에요.",
  "코스 포인트 1 · 야시장\n\n야시장 설명이에요.\n둘째 문장이에요.",
  "코스 포인트 2 · 마사지\n\n마사지 설명이에요.\n둘째 문장이에요.",
  "가격, 포함과 불포함\n\n• 표시 가격: 1,000원",
  "마무리\n\n마무리 문장이에요.",
];
const planned = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "플랜 검증",
  sections: [...planSections, "네이버 여행 커넥트 활동을 통해 수수료를 제공받을 수 있습니다."],
  hashtags: ["여행커넥트", "플랜", "검증"],
  imagePaths: planImages,
  connectUrl: "https://brandconnect.naver.com/plan-fixture",
  qualityPreset: "PREMIUM",
  sectionPlan: [
    { role: "summary-glance", imagePaths: [], imageIntent: "이미지 없음", imageMin: 0, imageMax: 0 },
    { role: "key-facts", imagePaths: [], imageIntent: "이미지 없음", imageMin: 0, imageMax: 0 },
    { role: "itinerary-overview", imagePaths: [planImages[1]], imageIntent: "일정 요약 카드", imageMin: 1, imageMax: 1, earlyConnectCard: true },
    { role: "day-course", imagePaths: [planImages[2], planImages[3]], imageIntent: "야시장 풍경", imageMin: 1, imageMax: 2 },
    { role: "day-course", imagePaths: [planImages[4]], imageIntent: "마사지 숍", imageMin: 1, imageMax: 2 },
    { role: "inclusions", imagePaths: [planImages[5]], imageIntent: "숙소 사진", imageMin: 1, imageMax: 1 },
    { role: "closing", imagePaths: [planImages[6]], imageIntent: "마지막 풍경", imageMin: 0, imageMax: 1 },
  ],
});
assert.deepEqual(
  planned.sections.map((section) => section.id),
  ["travel-summary-glance", "travel-key-facts", "travel-itinerary-overview", "travel-day-course", "travel-day-course-2", "travel-inclusions", "travel-closing"],
  "플랜이 있으면 섹션 id 는 역할에서 만들어진다(팔레트 id 를 끼워 맞추지 않는다).",
);
assert.deepEqual(planned.sections[0].imagePaths, [], "요약 섹션 앞에는 본문 이미지가 없다(썸네일만)");
assert.deepEqual(planned.sections[3].imagePaths.slice(0, 2), [planImages[2], planImages[3]], "코스 포인트는 플랜이 배정한 두 장을 그대로 받는다");
assert.equal(planned.sections[3].imageIntent, "야시장 풍경", "이미지 의도는 실제 섹션 것을 쓴다");
assert.equal(planned.sections[3].imageMin, 1);
assert.equal(planned.sections[3].imageMax, 2);
// 플랜에 없는 여분(planImages[7], [8])은 여유가 있는 섹션에 얹혀 버려지지 않는다.
assert.equal(planned.renderNodes.filter((node) => node.kind === "image").length, planImages.length, "플랜 밖 유효 이미지도 렌더 노드로 배치");
assert.equal(planned.qualityReport.imageCoverage.missingSectionIds.length, 0, "하한을 채운 섹션은 부족으로 보고되지 않는다");
assert.equal(planned.qualityReport.imageCoverage.requiredSlots, 1 + 5, "필요 슬롯 = 썸네일 1 + 그림이 허용된 모든 섹션 하한 합 5");
const earlyCardIndex = planned.renderNodes.findIndex((node) => node.kind === "connectCard" && node.placement === "early");
const overviewHeadingIndex = planned.renderNodes.findIndex((node) => node.kind === "heading" && node.sectionId === "travel-itinerary-overview");
const firstCourseHeadingIndex = planned.renderNodes.findIndex((node) => node.kind === "heading" && node.sectionId === "travel-day-course");
assert.ok(earlyCardIndex > overviewHeadingIndex && earlyCardIndex < firstCourseHeadingIndex, "첫 커넥트 카드는 플랜이 지정한 일정 흐름 섹션 뒤에 온다");

// 하한을 못 채운 플랜 섹션은 프리미엄에서 차단 사유가 된다.
const shortPlan = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "플랜 부족 검증",
  sections: planSections,
  hashtags: ["여행커넥트", "플랜", "검증"],
  imagePaths: planImages.slice(0, 2),
  connectUrl: "https://brandconnect.naver.com/plan-fixture",
  qualityPreset: "PREMIUM",
  sectionPlan: [
    { role: "summary-glance", imagePaths: [], imageIntent: "이미지 없음", imageMin: 0, imageMax: 0 },
    { role: "key-facts", imagePaths: [], imageIntent: "이미지 없음", imageMin: 0, imageMax: 0 },
    { role: "itinerary-overview", imagePaths: [planImages[1]], imageIntent: "일정 요약 카드", imageMin: 1, imageMax: 1 },
    { role: "day-course", imagePaths: [], imageIntent: "야시장 풍경", imageMin: 1, imageMax: 2 },
    { role: "day-course", imagePaths: [], imageIntent: "마사지 숍", imageMin: 1, imageMax: 2 },
    { role: "inclusions", imagePaths: [], imageIntent: "숙소 사진", imageMin: 1, imageMax: 1 },
    { role: "closing", imagePaths: [], imageIntent: "마지막 풍경", imageMin: 0, imageMax: 1 },
  ],
});
assert.deepEqual(shortPlan.qualityReport.imageCoverage.missingSectionIds, ["travel-day-course", "travel-day-course-2", "travel-inclusions", "travel-closing"]);
assert.equal(shortPlan.qualityReport.canAutoPublish, false);

// 플랜 길이가 섹션 수와 다르면 무시하고 팔레트로 돌아간다.
const ignoredPlan = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "플랜 무시 검증",
  sections: planSections,
  hashtags: ["여행커넥트", "플랜", "검증"],
  imagePaths: planImages,
  connectUrl: "https://brandconnect.naver.com/plan-fixture",
  sectionPlan: [{ role: "summary-glance", imagePaths: [], imageIntent: "이미지 없음", imageMin: 0, imageMax: 0 }],
});
assert.equal(ignoredPlan.sections[0].id, "travel-hook");

console.log(JSON.stringify({ ok: true, sectionPlan: true }));

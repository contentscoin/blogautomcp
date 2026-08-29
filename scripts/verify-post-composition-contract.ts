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
  title: "상품 선택 기준",
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
assert.equal(shopping.renderNodes.at(-1)?.kind, "hashtags");
assert.equal(shopping.renderNodes[0].kind, "disclosure");
assert.equal(shopping.renderNodes[1].kind, "disclosure");

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
assert.ok(
  travel.renderNodes.some(
    (node) => node.kind === "image" && node.layout === "collage-3",
  ),
  "여행 하이라이트 이미지는 3장 콜라주 의도를 보존해야 합니다.",
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

console.log("post composition contract verified", {
  shoppingNodes: shopping.renderNodes.length,
  travelNodes: travel.renderNodes.length,
  travelScore: travel.qualityReport.score,
  premiumBlockers: premiumBlocked.qualityReport.blockers,
});

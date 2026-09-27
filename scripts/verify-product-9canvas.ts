import assert from "node:assert/strict";
import { buildProduct9Canvas, productRecoveryStageForFailure } from "./lib/product-9canvas";
import { buildProductThumbnailCopy } from "./lib/product-thumbnail";
import { resolveProductCompositionProfile } from "./lib/product-image-lock";
import { selectTopicTemplate } from "./lib/topic-templates";
import { buildBrandPostImagePrompt } from "../src/lib/brand-post-image-generation";

const humidifier = buildProduct9Canvas({
  name: "[26년 신제품] 풀라스 UV 살균 초음파 대용량 무선 미니 가습기 가정용 탁상용 휴대용 1위 원룸 책상 사무실 소형 무소음 무드등 가열식 탁상 캠핑 차량용 통세척 생수병 미니가습기",
  description: "판매자 소개 문구",
  features: ["UV 살균", "초음파 가습", "탁상용"],
});
assert.equal(humidifier.concept.categoryId, "home_appliance");
assert.equal(humidifier.concept.productKind, "가습기");
assert.equal(humidifier.concept.physicalScale, "desktop", "휴대용은 사용 수식어이며 탁상형 가습기의 물리 크기를 덮지 않는다");
assert.equal(humidifier.lever.thumbnailThemeId, "humidifier");
assert.ok(humidifier.concept.useContexts.includes("캠핑"), "캠핑은 사용 장면으로만 보존한다");
assert.ok(humidifier.claim.some(claim => claim.text === "판매자 소개 문구" && claim.status === "candidate"));
assert.ok(humidifier.claim.some(claim => claim.text === "UV 살균" && claim.status === "validated"));
const humidifierCopy = buildProductThumbnailCopy("캠핑에서도 쓰는 미니 제품", humidifier.subject.productName, "SHOPPING", humidifier);
assert.equal(humidifierCopy.headline, "가습 방식 체크");
assert.doesNotMatch(JSON.stringify(humidifierCopy), /보냉|흡입/u);
assert.equal(selectTopicTemplate("SHOPPING", { name: humidifier.subject.productName, productUnderstanding: humidifier }).id, "home_appliance");

const golfWatch = buildProduct9Canvas({
  name: "[추석선물 EVENT] 2026 보이스캐디 T13 PRO 시계형 골프거리측정기",
});
assert.equal(golfWatch.concept.categoryId, "sports_leisure");
assert.equal(golfWatch.concept.physicalScale, "wearable");
const watchProfile = resolveProductCompositionProfile(golfWatch.subject.productName, golfWatch.concept.physicalScale);
const floorProfile = resolveProductCompositionProfile("삼성 대형 건조기", "floor");
assert.ok(watchProfile.maxWidth < floorProfile.maxWidth && watchProfile.maxHeight < floorProfile.maxHeight,
  "손목형 제품은 바닥형 가전보다 작게 합성한다");
assert.ok(watchProfile.bottomOffset > floorProfile.bottomOffset,
  "손목형 제품은 테이블 표면에 놓인 비율을 위한 여백을 확보한다");
const watchBackgroundPrompt = buildBrandPostImagePrompt({
  connectKind: "SHOPPING",
  productName: golfWatch.subject.productName,
  sectionTitle: "거리 확인을 손목에서 끝내고 싶다면",
  imageIntent: "골프 라운드 중 손목형 제품을 확인하는 장면",
  role: "body",
  physicalScale: golfWatch.concept.physicalScale,
  productImageDirective: golfWatch.policy.imageDirective,
});
assert.match(watchBackgroundPrompt, /compact wearable-sized empty area/u);
assert.match(watchBackgroundPrompt, /clear contact plane|tabletop/u);

const persimmon = buildProduct9Canvas({
  name: "천년빛곶감 상주곶감 건시 반건시 선물세트 호두말이 크림치즈",
});
assert.equal(persimmon.concept.categoryId, "food_supplement");
assert.equal(persimmon.subject.selectedOption.status, "ambiguous");
assert.ok(persimmon.policy.requireSingleOptionVisual);
assert.match(persimmon.policy.writingDirective, /모두 포함된 구성으로 쓰지/u);
assert.equal(selectTopicTemplate("SHOPPING", { name: persimmon.subject.productName }).id, "food_supplement");
const persimmonCopy = buildProductThumbnailCopy("선물세트 선택 기준", persimmon.subject.productName, "SHOPPING", persimmon);
assert.equal(persimmonCopy.headline, "구성·보관 확인");

const selectedPersimmon = buildProduct9Canvas({
  name: persimmon.subject.productName,
  features: ["선택 옵션: 반건시 1.2kg"],
});
assert.equal(selectedPersimmon.subject.selectedOption.status, "confirmed");
assert.equal(selectedPersimmon.subject.selectedOption.label, "반건시 1.2kg");
assert.equal(selectedPersimmon.policy.requireSingleOptionVisual, false);

const soothingCream = buildProduct9Canvas({ name: "닥터지 레드 블레미쉬 수딩 크림" });
assert.equal(soothingCream.concept.categoryId, "beauty_body", "실제 화장품 크림은 뷰티 분류를 유지한다");
const laptop = buildProduct9Canvas({ name: "베이직북 16인치 노트북 16GB 512GB" });
assert.equal(laptop.subject.selectedOption.status, "not-applicable", "서로 다른 규격 수치는 혼합 옵션으로 오인하지 않는다");

assert.equal(productRecoveryStageForFailure("PUBLISH_IMAGE_AUDIT_FAILED: 혼합 옵션 이미지"), "understanding");
assert.equal(productRecoveryStageForFailure("기능 근거 부족: 일반 상품 사진"), "image-source");
assert.equal(productRecoveryStageForFailure("시계가 비정상적으로 크게 합성되고 그림자가 부자연스럽습니다"), "composition");

console.log(JSON.stringify({
  ok: true,
  cases: {
    humidifier: humidifier.lever,
    golfWatch: golfWatch.lever,
    persimmon: { category: persimmon.concept.categoryId, option: persimmon.subject.selectedOption },
  },
}, null, 2));

import assert from "node:assert/strict";
import {
  stableFreeformSectionId,
  SHOPPING_POST_CONTRACT_V1,
  TRAVEL_POST_CONTRACT_V1,
  normalizeLegacyFreeformImageRules,
  refreshPostDocumentQuality,
  resolvePostDocument,
  type ResolvedPostDocumentV1,
} from "../src/lib/post-composition-contract";

function buildSections(prefix: string, count: number, paragraphLength: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const paragraph = `${prefix} ${index + 1} ${"확인된 정보를 바탕으로 선택 기준을 구체적으로 정리합니다. ".repeat(paragraphLength)}`;
    return `${prefix} ${index + 1}\n\n${paragraph.trim()}`;
  });
}

function reviewedBindings(kind: "SHOPPING" | "TRAVEL", sections: string[], images: string[]) {
  const bindings: Record<string, string[]> = Object.fromEntries(sections.map(section => [stableFreeformSectionId(kind, section.split("\n")[0]), []]));
  const keys = Object.keys(bindings);
  images.slice(1).forEach((image, index) => bindings[keys[index % keys.length]].push(image));
  return bindings;
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
  sectionImageBindings: reviewedBindings("SHOPPING", buildSections("쇼핑 섹션", SHOPPING_POST_CONTRACT_V1.sections.length, 4), shoppingImages),
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
  sectionImageBindings: reviewedBindings("TRAVEL", buildSections("여행 섹션", TRAVEL_POST_CONTRACT_V1.sections.length, 8), travelImages),
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
  !travel.renderNodes.some(
    (node) => node.kind === "image" && node.layout === "collage-3",
  ),
  "자유형 섹션에는 위치 기반 하이라이트 콜라주를 강제하지 않습니다.",
);
assert.ok(travel.renderNodes.some((node) => node.kind === "image" && node.layout === "sequence"));

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
  sectionImageBindings: reviewedBindings("TRAVEL", buildSections("여행 최대 섹션", TRAVEL_POST_CONTRACT_V1.sections.length, 8), travelMaxImages),
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
// 의미가 검증되지 않은 여분(planImages[7], [8])은 임의 섹션에 배치하지 않는다.
assert.equal(planned.renderNodes.filter((node) => node.kind === "image").length, 7, "플랜으로 연결한 이미지만 실제 렌더한다");
assert.equal(planned.qualityReport.imageCoverage.missingSectionIds.length, 0, "하한을 채운 섹션은 부족으로 보고되지 않는다");
assert.equal(planned.qualityReport.imageCoverage.requiredSlots, 1 + 4, "필요 슬롯 = 썸네일 1 + 명시된 섹션 하한 합 4");
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
assert.deepEqual(shortPlan.qualityReport.imageCoverage.missingSectionIds, ["travel-day-course", "travel-day-course-2", "travel-inclusions"]);
assert.equal(shortPlan.qualityReport.canAutoPublish, false);

// 플랜 길이가 섹션 수와 다르면 자유형 규칙과 기존 호환 id 를 사용한다.
const ignoredPlan = resolvePostDocument({
  connectKind: "TRAVEL",
  title: "플랜 무시 검증",
  sections: planSections,
  hashtags: ["여행커넥트", "플랜", "검증"],
  imagePaths: planImages,
  connectUrl: "https://brandconnect.naver.com/plan-fixture",
  sectionPlan: [{ role: "summary-glance", imagePaths: [], imageIntent: "이미지 없음", imageMin: 0, imageMax: 0 }],
});
assert.equal(ignoredPlan.sections[0].id, stableFreeformSectionId("TRAVEL", planSections[0].split("\n")[0]));
assert.equal(ignoredPlan.sections[2].imageMin, 2);

// The contract requires only semantically necessary sections; later sections
// may still carry reviewed images without becoming mandatory generation jobs.
const sagaSections = buildSections("사가 산책", 10, 8);
sagaSections[2] = sagaSections[2].replace("사가 산책 3", "도서관에서 쉬어가기");
const sagaImages = Array.from({ length: 11 }, (_, index) => `C:/fixture/saga-${index}.jpg`);
const sagaOptions = {
  connectKind: "TRAVEL" as const,
  title: "사가 여행 기록",
  sections: sagaSections,
  hashtags: ["사가여행"],
  imagePaths: sagaImages,
  sectionImageBindings: reviewedBindings("TRAVEL", sagaSections, sagaImages),
  connectUrl: "https://brandconnect.naver.com/saga-fixture",
  qualityPreset: "PREMIUM" as const,
};
const saga = resolvePostDocument(sagaOptions);
assert.equal(saga.sections.length, 10);
assert.equal(saga.qualityReport.canAutoPublish, false, "the third travel section explicitly needs two distinct images");
assert.equal(saga.qualityReport.actual.images, 11);
assert.deepEqual(saga.qualityReport.imageCoverage, {
  requiredSlots: 7, filledRequiredSlots: 6, missingSectionIds: [stableFreeformSectionId("TRAVEL", "도서관에서 쉬어가기")],
});
assert.equal(saga.sections[2].id, stableFreeformSectionId("TRAVEL", "도서관에서 쉬어가기"), "identity follows meaning");
assert.equal(saga.sections.at(-1)?.id, stableFreeformSectionId("TRAVEL", "사가 산책 10"));
saga.sections.forEach((section, index) => {
  const expectedContract = index < 9 ? TRAVEL_POST_CONTRACT_V1.sections[index] : TRAVEL_POST_CONTRACT_V1.sections.at(-1)!;
  assert.equal(section.imageMin, expectedContract.image.min);
  assert.equal(section.imageMax, Math.max(expectedContract.image.max, 1));
  assert.deepEqual(section.imagePaths, [sagaImages[index + 1]]);
  assert.equal(section.headingStyle, expectedContract.headingStyle);
  assert.equal(section.imageIntent, `${section.title}: ${expectedContract.image.intent}`);
  const paragraphIndex = saga.renderNodes.findIndex((node) => node.kind === "paragraph" && node.sectionId === section.id);
  const imageIndex = saga.renderNodes.findIndex((node) => node.kind === "image" && node.sectionId === section.id);
  assert.equal(imageIndex, paragraphIndex + 1, "images follow the actual section lead");
  const image = saga.renderNodes[imageIndex];
  assert.ok(image.kind === "image");
  assert.equal(image.layout, "single");
  assert.equal(image.role, "detail", "legacy role IDs must not force summary images");
});
assert.match(saga.sections[2].imageIntent, /^도서관에서 쉬어가기:/u);
const sagaEarly = saga.renderNodes.findIndex((node) => node.kind === "connectCard" && node.placement === "early");
assert.equal(saga.renderNodes[sagaEarly - 1].kind, "image");
assert.deepEqual(saga.renderNodes[sagaEarly - 1], saga.renderNodes.find((node) => node.kind === "image" && node.sectionId === saga.sections[2].id));
assert.equal(saga.renderNodes.filter((node) => node.kind === "connectCard").length, 2);

const sagaMapping = saga.sections.map((section) => [...section.imagePaths]);
const explicitTwo = resolvePostDocument({
  ...sagaOptions,
  sectionImagePaths: sagaMapping,
  sectionPlan: saga.sections.map((section, index) => ({
    role: index === 2 ? "library" : `scene-${index}`,
    imagePaths: section.imagePaths,
    imageIntent: section.imageIntent,
    imageMin: index === 2 ? 2 : 1,
    imageMax: index === 2 ? 2 : 1,
  })),
});
assert.deepEqual(explicitTwo.sections.map((section) => section.imagePaths), sagaMapping);
assert.equal(explicitTwo.sections[2].imageMin, 2);
assert.equal(explicitTwo.qualityReport.canAutoPublish, false);
assert.deepEqual(explicitTwo.qualityReport.imageCoverage.missingSectionIds, ["travel-library"]);
assert.equal(normalizeLegacyFreeformImageRules(explicitTwo), explicitTwo);
const explicitTwoFilled = refreshPostDocumentQuality({
  ...explicitTwo,
  sections: explicitTwo.sections.map((section, index) => index === 2
    ? { ...section, imagePaths: [...section.imagePaths, "C:/fixture/library-extra.jpg"] }
    : section),
  renderNodes: [...explicitTwo.renderNodes, {
    kind: "image", sectionId: "travel-library", assetPath: "C:/fixture/library-extra.jpg",
    role: "scene", layout: "sequence", altText: "도서관", sourcePolicy: "TRAVEL_EDITORIAL",
  }],
});
assert.equal(explicitTwoFilled.qualityReport.canAutoPublish, true, "the explicit two-image deficit is the only blocker");
assert.equal(normalizeLegacyFreeformImageRules(planned), planned, "explicit text-only bounds remain untouched");

const missingMapping = sagaMapping.map((paths, index) => index === 2 ? [] : [...paths]);
missingMapping[9].push(sagaMapping[2][0]);
const emptyLibrary = resolvePostDocument({ ...sagaOptions, sectionImageBindings: Object.fromEntries(saga.sections.map((section, index) => [section.id, missingMapping[index]])) });
assert.equal(emptyLibrary.qualityReport.actual.images, 11);
assert.equal(emptyLibrary.qualityReport.canAutoPublish, false, "global image count cannot hide an empty section");
assert.deepEqual(emptyLibrary.qualityReport.imageCoverage.missingSectionIds, [saga.sections[2].id]);
const zeroImages = resolvePostDocument({ ...sagaOptions, imagePaths: [] });
assert.equal(zeroImages.qualityReport.canAutoPublish, false);
assert.equal(zeroImages.qualityReport.imageCoverage.missingSectionIds.length, 5);

function legacyFreeform(document: ResolvedPostDocumentV1): ResolvedPostDocumentV1 {
  return {
    ...document,
    sections: document.sections.map((section) => {
      const legacy = { ...section, imageIntent: "positional palette intent", headingStyle: "quotation" as const };
      delete legacy.imageMin;
      delete legacy.imageMax;
      return legacy;
    }),
    renderNodes: document.renderNodes.map((node) => node.kind === "image" && node.sectionId !== null
      ? { ...node, layout: "collage-3", role: "summary", altText: "positional palette intent" }
      : node),
  };
}
const legacySaga = legacyFreeform(saga);
const legacySnapshot = JSON.stringify(legacySaga);
const normalized = normalizeLegacyFreeformImageRules(legacySaga);
assert.equal(JSON.stringify(legacySaga), legacySnapshot, "migration must not mutate the input");
assert.deepEqual(normalized.sections, saga.sections, "real heading/body intent replaces positional metadata");
assert.deepEqual(normalized.renderNodes, saga.renderNodes, "assets, text, IDs, links and order remain intact");
assert.equal(normalized.qualityReport, legacySaga.qualityReport, "caller refreshes QC after normalization");
assert.equal(normalizeLegacyFreeformImageRules(normalized), normalized, "migration is idempotent");
assert.equal(refreshPostDocumentQuality(normalized).qualityReport.canAutoPublish, false);
assert.equal(refreshPostDocumentQuality(normalizeLegacyFreeformImageRules(legacyFreeform(emptyLibrary))).qualityReport.canAutoPublish, false);
assert.equal(refreshPostDocumentQuality(normalizeLegacyFreeformImageRules(legacyFreeform(zeroImages))).qualityReport.canAutoPublish, false);
const mixedLegacy = legacyFreeform(travel);
mixedLegacy.sections[0].imageMin = 2;
mixedLegacy.sections[1].imageMax = 0;
const mixedNormalized = normalizeLegacyFreeformImageRules(mixedLegacy);
assert.equal(mixedNormalized.sections[0], mixedLegacy.sections[0], "even a single explicit bound is preserved");
assert.equal(mixedNormalized.sections[1], mixedLegacy.sections[1]);
mixedNormalized.sections.slice(2).forEach((section, offset) => {
  assert.equal(section.imageMin, TRAVEL_POST_CONTRACT_V1.sections[offset + 2]?.image.min ?? TRAVEL_POST_CONTRACT_V1.sections.at(-1)!.image.min);
  assert.ok(section.imageMax! >= section.imagePaths.length, "migration retains multi-image capacity");
});

console.log(JSON.stringify({ ok: true, sectionPlan: true, freeformCoverage: true, legacyNormalization: true }));

const explicitFreeform = resolvePostDocument({ ...sagaOptions, sectionImagePaths: sagaMapping });
assert.deepEqual(explicitFreeform.sections.map(section => section.imagePaths), sagaMapping,
  "explicit aligned freeform placement must survive document reconstruction");
assert.equal(explicitFreeform.qualityReport.actual.images, saga.qualityReport.actual.images);
const unavailableMapping = sagaMapping.map(files => [...files, "C:/fixture/not-uploaded.jpg"]);
const filteredMapping = resolvePostDocument({ ...sagaOptions, sectionImagePaths: unavailableMapping });
assert.deepEqual(filteredMapping.sections.map(section => section.imagePaths), sagaMapping);

/** Offline regressions for product-type topic templates (selection, contract overlay, prompts). */
import assert from "node:assert/strict";
import {
  SHOPPING_POST_CONTRACT_V1,
  TRAVEL_POST_CONTRACT_V1,
  getPostCompositionContract,
  resolvePostDocument,
} from "../src/lib/post-composition-contract";
import { createEditorialSelection } from "./lib/editorial-templates";
import { allowsGenericBrandPostProductPhoto, allowsOriginalShoppingScene, isShoppingLifestyleImage } from "../src/lib/brand-post-image-evidence";
import { buildBrandPostImagePrompt } from "../src/lib/brand-post-image-generation";
import {
  SHOPPING_SECTION_ORDER,
  TOPIC_TEMPLATES,
  TRAVEL_SECTION_ORDER,
  formatTopicTemplateForPrompt,
  selectTopicTemplate,
} from "./lib/topic-templates";
import { createWritingPromptContract, formatWritingPromptContract } from "./lib/writing-prompt-contract";

// 1. Every template covers the full contract palette in contract order.
assert.deepEqual([...SHOPPING_SECTION_ORDER], SHOPPING_POST_CONTRACT_V1.sections.map((section) => section.id));
assert.deepEqual([...TRAVEL_SECTION_ORDER], TRAVEL_POST_CONTRACT_V1.sections.map((section) => section.id));
for (const template of Object.values(TOPIC_TEMPLATES)) {
  const order = template.kind === "TRAVEL" ? TRAVEL_SECTION_ORDER : SHOPPING_SECTION_ORDER;
  assert.deepEqual(template.sections.map(([id]) => id), [...order], template.id);
  for (const [id, overlay] of template.sections) {
    assert.ok(overlay.headingHint && overlay.purpose && overlay.imageIntent, `${template.id}/${id}`);
    if (overlay.imageSource === "staged-ai") assert.ok(overlay.promptRecipe, `${template.id}/${id} needs a staging recipe`);
  }
}

// 2. Deterministic selection from product evidence.
const shoppingCases: Array<[string, string]> = [
  ["브리즈온 BLDC 헤어 드라이기", "home_appliance"],
  ["닥터지 레드 블레미쉬 수딩 크림", "beauty_body"],
  ["LG 그램 16인치 노트북", "digital_it"],
  ["닥터바이 프로바이오틱스 유산균 30포", "food_supplement"],
  ["한일 BLDC 서큘레이터 선풍기", "home_appliance"],
  ["오로꼬 퓨어 반바지", "fashion_goods"],
  ["페노비스 오랄벳 강아지 구강 덴탈 겔", "baby_pet"],
  ["스트롱 골프 자동 장우산", "sports_leisure"],
  ["데클 원샷클린 욕실 수납 정리함", "living_health"],
  ["ABC 123 스페셜 에디션", "generic_shopping"],
];
for (const [name, expected] of shoppingCases) {
  const selection = selectTopicTemplate("SHOPPING", { name });
  assert.equal(selection.id, expected, `${name}: ${selection.reason}`);
}
assert.equal(selectTopicTemplate("SHOPPING", { name: "무선 제품", categoryPath: "생활/건강 > 반려동물 > 강아지 용품" }).id, "baby_pet",
  "store category path is the strongest signal");
const travelCases: Array<[Parameters<typeof selectTopicTemplate>[1], string]> = [
  [{ name: "출발확정 여행핫딜 시내숙박 대마도 2일 패키지" }, "package_tour"],
  [{ name: "대만 타이베이 여행", features: ["1일차 일정: 단수이 → 스펀"] }, "package_tour"],
  [{ name: "오사카 에어텔 3박4일" }, "airtel_freetour"],
  [{ name: "힐튼 오사카 호텔 숙박권" }, "hotel_resort"],
  [{ name: "유니버설 스튜디오 재팬 입장권" }, "activity_ticket"],
  [{ name: "제주 감성 여행" }, "generic_travel"],
];
for (const [input, expected] of travelCases) {
  const selection = selectTopicTemplate("TRAVEL", input);
  assert.equal(selection.id, expected, `${input?.name}: ${selection.reason}`);
}

// 3. Contract overlay keeps IDs, sizes and image counts; adds source and intent.
const beauty = getPostCompositionContract("SHOPPING", "beauty_body");
assert.deepEqual(beauty.sections.map((section) => section.id), SHOPPING_POST_CONTRACT_V1.sections.map((section) => section.id));
beauty.sections.forEach((section, index) => {
  const base = SHOPPING_POST_CONTRACT_V1.sections[index]!;
  assert.deepEqual([section.minChars, section.maxChars, section.image.min, section.image.max, section.image.placement],
    [base.minChars, base.maxChars, base.image.min, base.image.max, base.image.placement], section.id);
  assert.ok(section.imageSource, `${section.id} has an image source`);
});
const ingredient = beauty.sections.find((section) => section.id === "shopping-package")!;
assert.equal(ingredient.imageSource, "seller-crop");
assert.match(ingredient.image.intent, /성분/u);
const texture = beauty.sections.find((section) => section.id === "shopping-design")!;
assert.equal(texture.imageSource, "staged-ai");
assert.doesNotMatch(texture.image.intent, /연출:|\[/u, "image intent becomes published alt text: no internal directions");
assert.ok(texture.promptRecipe, "staging recipe travels in its own field");
assert.deepEqual(beauty.targetImages, SHOPPING_POST_CONTRACT_V1.targetImages);
assert.equal(getPostCompositionContract("SHOPPING"), SHOPPING_POST_CONTRACT_V1, "no template keeps the base contract");
assert.equal(getPostCompositionContract("SHOPPING", "package_tour"), SHOPPING_POST_CONTRACT_V1, "a travel template never applies to shopping");
assert.equal(getPostCompositionContract("TRAVEL", "not-a-template"), TRAVEL_POST_CONTRACT_V1);
const tour = getPostCompositionContract("TRAVEL", "package_tour");
assert.equal(tour.sections.find((section) => section.id === "travel-inclusions")?.imageSource, "seller-crop");
assert.match(tour.sections.find((section) => section.id === "travel-preparation")!.purpose, /꿀팁/u);

// 4. Editorial selection carries the topic; weak evidence falls back to the topic's editorial template.
const editorial = createEditorialSelection("SHOPPING", { name: "닥터바이 프로바이오틱스 유산균 30포" });
assert.equal(editorial.topic.id, "food_supplement");
assert.equal(editorial.id, TOPIC_TEMPLATES.food_supplement.editorialTemplateId);
assert.equal(createEditorialSelection("SHOPPING", { name: "유산균", features: ["옵션 2종 차이 선택"] }).id, "shopping-comparison",
  "explicit detail evidence still wins over the topic default");
assert.equal(createEditorialSelection("TRAVEL").id, "travel-scenic", "no evidence keeps the conservative default");

// 5. Prompts: shared contract includes the template; travel carries the 꿀팁 concept; modes differ.
const contract = createWritingPromptContract({
  kind: "TRAVEL", product: { name: "출발확정 대마도 2일 패키지" }, minimumSections: 7, maximumSections: 12,
  targetCharacters: { min: 1750, max: 3600 }, hashtagCount: 4,
});
const prompt = formatWritingPromptContract(contract);
assert.match(prompt, /\[상품 유형 템플릿: 패키지 여행/u);
assert.match(prompt, /💡 현지 꿀팁/u);
assert.match(prompt, /실제 구매·사용·방문·탑승·숙박·식사 경험을 만들지 않습니다/u, "information mode rule comes from the shared contract");
const verified = formatTopicTemplateForPrompt(selectTopicTemplate("SHOPPING", { name: "LG 그램 노트북" }), { experienceMode: "VERIFIED_EXPERIENCE" });
assert.match(verified, /체험 메모의 1인칭 문장 자리/u);
assert.match(verified, /메모에 없는 체험·수치·기간은 만들지 않습니다/u);
assert.doesNotMatch(verified, /꿀팁/u, "shopping prompts do not carry the travel tip concept");
const compact = formatTopicTemplateForPrompt(selectTopicTemplate("SHOPPING", { name: "LG 그램 노트북" }), { includeFlow: false });
assert.doesNotMatch(compact, /shopping-hook/u, "spec-first keeps its own fixed section list");

// 6. The resolved render document uses the same overlay through the editorial selection.
const document = resolvePostDocument({
  editorial: createEditorialSelection("SHOPPING", { name: "닥터지 레드 블레미쉬 수딩 크림" }),
  connectKind: "SHOPPING",
  title: "수딩 크림 닥터지 레드 블레미쉬 정리",
  sections: ["도입\n\n브리즈온 BLDC 헤어 드라이기는 가벼운 무게가 특징입니다.", "성분이 아닌 구조\n\nBLDC 모터가 바람 세기를 만듭니다."],
  hashtags: ["드라이기"],
  imagePaths: [],
  connectUrl: "https://naver.me/fixture",
});
assert.ok(document.sections.some((section) => section.imageIntent.endsWith(TOPIC_TEMPLATES.beauty_body.sections[0]![1].imageIntent)),
  "overlay image intents reach the render document");
for (const node of document.renderNodes) {
  if (node.kind === "image") assert.doesNotMatch(node.altText, /연출:|상세페이지 근거 구간\(|\[/u, "alt text carries no internal directions");
}

// 7. Image classifiers honour the template's explicit image source before intent wording.
const staged = { imageIntent: "추천 사용 환경 연출컷", imageSource: "staged-ai" as const };
assert.equal(isShoppingLifestyleImage(staged), true, "staged cut is a lifestyle slot even without legacy wording");
assert.equal(allowsOriginalShoppingScene(staged), true, "a verified original scene may fill a staged slot");
assert.equal(allowsGenericBrandPostProductPhoto({ sectionTitle: "성분에서 확인한 것", imageIntent: "성분표 근거 구간", imageSource: "seller-crop" }), false,
  "detail-crop slots need feature evidence, not a packshot");
assert.equal(isShoppingLifestyleImage({ imageIntent: "성분표 근거 구간", imageSource: "seller-crop" }), false);
assert.equal(allowsGenericBrandPostProductPhoto({ sectionTitle: "어떤 제품인지부터", imageIntent: "전체 구성 원본 사진", imageSource: "seller-original" }), true);
assert.equal(isShoppingLifestyleImage({ imageIntent: "AI 연출 이미지: 추천 환경의 공간 배치" }), true, "legacy packages keep wording rules");
const staged7 = resolvePostDocument({
  editorial: createEditorialSelection("SHOPPING", { name: "브리즈온 BLDC 헤어 드라이기" }),
  connectKind: "SHOPPING", title: "헤어 드라이기 브리즈온 정리",
  sections: Array.from({ length: 7 }, (_, index) => `소제목 ${index + 1}\n\n브리즈온 드라이기 설명 ${index + 1}입니다.`),
  hashtags: ["드라이기"], imagePaths: [], connectUrl: "https://naver.me/fixture",
});
assert.equal(staged7.sections[0]!.imageSource, "staged-ai");
assert.ok(staged7.sections[0]!.promptRecipe, "staging recipe persists for image generation");
assert.equal(staged7.sections.at(-1)!.imageSource, "seller-original", "the verdict slot maps to the last contract section");
assert.ok(staged7.sections.every((section) => !/연출:/u.test(section.imageIntent)));
const stagingPrompt = buildBrandPostImagePrompt({ connectKind: "SHOPPING", productName: "브리즈온", sectionTitle: "사용감",
  imageIntent: staged7.sections[0]!.imageIntent, role: "body", stagingRecipe: staged7.sections[0]!.promptRecipe });
assert.match(stagingPrompt, /Staging direction/u);
assert.match(stagingPrompt, /Generate the environment only/u, "staging never overrides the locked-product rule");

console.log(`PASS: topic templates (${Object.keys(TOPIC_TEMPLATES).length}), selection, contract overlay, editorial fallback, prompts, render document`);

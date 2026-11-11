import assert from "node:assert/strict";
import { SHOPPING_PERSUASION_STRUCTURE } from "./lib/blog-writing-style";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { scanAiTells } from "./lib/humanize-korean";
import { decorateShoppingHeading, decorateShoppingSection, pickShoppingHeadingEmoji, stripHeadingEmoji } from "./lib/shopping-heading-emoji";

// 소제목 낱말에 맞는 이모지를 고른다.
assert.equal(decorateShoppingHeading("가격과 혜택은 어떤가요?"), "💰 가격과 혜택은 어떤가요?");
assert.equal(decorateShoppingHeading("세척과 보관 방법"), "🧼 세척과 보관 방법");
assert.equal(decorateShoppingHeading("이런 분께 맞아요"), "🙋 이런 분께 맞아요");
assert.equal(decorateShoppingHeading("자주 묻는 질문"), "❓ 자주 묻는 질문");
assert.equal(decorateShoppingHeading("아쉬운 점과 주의할 점"), "⚠️ 아쉬운 점과 주의할 점");
assert.equal(pickShoppingHeadingEmoji("펼친 크기와 무게"), "📏");

// 맞는 낱말이 없으면 섹션 순서로 고르고, 같은 입력은 항상 같은 결과다.
assert.equal(decorateShoppingHeading("거실 한쪽에 두기", 0), decorateShoppingHeading("거실 한쪽에 두기", 0));
assert.notEqual(pickShoppingHeadingEmoji("거실 한쪽에 두기", 0), pickShoppingHeadingEmoji("거실 한쪽에 두기", 1));

// 이미 붙은 이모지는 맨 앞 1개만 남기고, 여러 번 적용해도 늘어나지 않는다.
assert.equal(decorateShoppingHeading("🎁 구성품 살펴보기 🎉"), "🎁 구성품 살펴보기");
const once = decorateShoppingHeading("접어서 보관하는 구조", 2);
assert.equal(decorateShoppingHeading(once, 2), once);
assert.equal(stripHeadingEmoji(once), "접어서 보관하는 구조");
assert.equal(decorateShoppingHeading("   "), "");

// 섹션은 첫 줄만 바꾸고 본문은 그대로 둔다.
const section = "가격과 구성\n\n본품 1개 구성이에요.\n옵션은 두 가지예요.\n";
assert.equal(decorateShoppingSection(section), `💰 가격과 구성\n\n본품 1개 구성이에요.\n옵션은 두 가지예요.\n`);

// 소제목 이모지는 AI 티(이모지 남발)로 세지 않고, 본문에 과하게 쓰면 여전히 잡는다.
const eightHeadings = Array.from({ length: 8 }, (_, index) => `${decorateShoppingHeading(`소제목 ${index}`, index)}\n\n평범한 문장이에요.`).join("\n\n");
assert.equal(scanAiTells(eightHeadings).findings.some((finding) => finding.label === "이모지 남발"), false);
assert.equal(scanAiTells(`${eightHeadings}\n좋아요 😀😀😀😀`).findings.some((finding) => finding.label === "이모지 남발"), true);

// 이모지 소제목이 발행 검사를 깨지 않는다(상품명·고지·구조 판정은 그대로).
const body = [
  "빨래 널 자리가 부족할 때\n\n모던홈 접이식 빨래건조대는 베란다가 좁은 집에서 꺼내 쓰기 좋은 건조대예요.\n비 오는 날이 이어지면 빨래를 널 곳부터 고민하게 되죠.\n거실 한쪽에 펼쳐 두고 쓰는 방식이라 자리를 정해 두면 편해요.\n다 쓰고 나면 접어서 벽에 세워 둘 수 있어요.\n빨래가 밀리는 장마철에는 하루에 두 번씩 돌려 널기도 하잖아요.\n그럴 때 건조대 자리가 정해져 있으면 집안일 순서가 한결 단순해져요.",
  "접어서 보관하는 구조\n\n접이식이라 쓰지 않을 때는 부피가 많이 줄어요.\n세탁기 옆 틈이나 문 뒤에 세워 두는 집이 많아요.\n펼칠 때는 양쪽 날개를 올려 고정하면 돼요.\n날개를 한쪽만 펼쳐 쓰면 좁은 방에서도 놓을 수 있어요.\n접을 때는 날개를 먼저 내리고 다리를 모으는 순서로 하면 손이 끼일 일이 적어요.\n자주 접었다 펴는 집이라면 손이 닿기 쉬운 곳을 보관 자리로 정해 두세요.",
  "이불과 수건 널기\n\n수건처럼 자주 빠는 빨래는 위쪽에 널면 걷기 편해요.\n이불은 가운데에 걸쳐 두면 양쪽으로 늘어져서 자리를 덜 차지해요.\n양말이나 속옷은 아래쪽 봉에 따로 모아 두면 찾기 쉬워요.\n빨래 사이 간격을 조금 띄우면 마르는 시간이 줄어요.\n두꺼운 후드나 청바지는 바깥쪽 봉에 걸어야 바람이 잘 통해요.\n선풍기나 제습기를 건조대 쪽으로 틀어 두면 실내 건조 냄새가 덜 남아요.",
  "이런 집에 어울려요\n\n베란다가 없거나 확장한 집이라면 실내 건조대가 하나 있으면 든든해요.\n자취방처럼 공간이 작은 곳에서도 접어 둘 수 있어 부담이 적어요.\n다만 한 번에 너는 빨래 양이 많은 집은 크기를 먼저 확인해 보세요.\n펼친 크기가 방 동선을 막지 않는지도 같이 보면 좋아요.\n아이 옷처럼 작은 빨래가 많은 집은 봉 간격이 촘촘한지 보는 게 좋아요.\n반대로 이불 빨래가 잦다면 가운데 폭이 넉넉한지가 더 중요해요.",
];
const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";
const check = (sections: string[]) => getBrandLinkContentReadiness({
  productName: "모던홈 접이식 빨래건조대", title: "모던홈 접이식 빨래건조대 좁은 집 실내 건조 정리",
  sections: [...sections, disclosure], hashtags: ["빨래건조대", "접이식건조대", "실내건조"], brandLink: "https://naver.me/abcd1234",
  generationSource: "AI", hasRepresentativeImage: true, connectKind: "SHOPPING", mode: "editorial", gateProfile: "essential",
});
const plain = check(body);
const decorated = check(body.map((item, index) => decorateShoppingSection(item, index)));
assert.equal(plain.canPublish, true, plain.summary);
assert.equal(decorated.canPublish, true, decorated.summary);
assert.deepEqual(decorated.blockers, []);
assert.equal(decorated.sectionCount, plain.sectionCount);

// 설득 구조 안내는 과장·긴급성 문구를 금지한다.
assert.match(SHOPPING_PERSUASION_STRUCTURE, /품절 임박/u);
assert.match(SHOPPING_PERSUASION_STRUCTURE, /상품 카드/u);
console.log("shopping heading emoji ok");

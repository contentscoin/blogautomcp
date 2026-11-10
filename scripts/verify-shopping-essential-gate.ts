import assert from "node:assert/strict";
import {
  detectUnsupportedHealthClaims,
  getBrandLinkContentReadiness,
  resolveBrandLinkGateProfile,
  type BrandLinkContentReadinessInput,
} from "./lib/brandlink-content-readiness";

const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";
const productName = "모던홈 접이식 빨래건조대";
// 상품에서 벗어나지 않았지만 근거 연결·역할 구성이 약한 평범한 원고.
const plainSections = [
  "빨래 널 자리가 부족할 때\n\n모던홈 접이식 빨래건조대는 베란다가 좁은 집에서 꺼내 쓰기 좋은 건조대예요.\n비 오는 날이 이어지면 빨래를 널 곳부터 고민하게 되죠.\n거실 한쪽에 펼쳐 두고 쓰는 방식이라 자리를 정해 두면 편해요.\n다 쓰고 나면 접어서 벽에 세워 둘 수 있어요.\n빨래가 밀리는 장마철에는 하루에 두 번씩 돌려 널기도 하잖아요.\n그럴 때 건조대 자리가 정해져 있으면 집안일 순서가 한결 단순해져요.\n손님이 올 때만 잠깐 접어 두는 식으로 쓰는 분도 많아요.",
  "접어서 보관하는 구조\n\n접이식이라 쓰지 않을 때는 부피가 많이 줄어요.\n세탁기 옆 틈이나 문 뒤에 세워 두는 집이 많아요.\n펼칠 때는 양쪽 날개를 올려 고정하면 돼요.\n날개를 한쪽만 펼쳐 쓰면 좁은 방에서도 놓을 수 있어요.\n접을 때는 날개를 먼저 내리고 다리를 모으는 순서로 하면 손이 끼일 일이 적어요.\n자주 접었다 펴는 집이라면 손이 닿기 쉬운 곳을 보관 자리로 정해 두세요.\n바닥이 미끄러운 곳에서는 다리가 벌어지지 않는지 한 번 눌러 보고 쓰면 좋아요.",
  "이불과 수건 널기\n\n수건처럼 자주 빠는 빨래는 위쪽에 널면 걷기 편해요.\n이불은 가운데에 걸쳐 두면 양쪽으로 늘어져서 자리를 덜 차지해요.\n양말이나 속옷은 아래쪽 봉에 따로 모아 두면 찾기 쉬워요.\n빨래 사이 간격을 조금 띄우면 마르는 시간이 줄어요.\n두꺼운 후드나 청바지는 바깥쪽 봉에 걸어야 바람이 잘 통해요.\n선풍기나 제습기를 건조대 쪽으로 틀어 두면 실내 건조 냄새가 덜 남아요.\n셔츠는 옷걸이에 건 채로 봉에 걸어 두면 주름이 덜 생겨요.",
  "이런 집에 어울려요\n\n베란다가 없거나 확장한 집이라면 실내 건조대가 하나 있으면 든든해요.\n자취방처럼 공간이 작은 곳에서도 접어 둘 수 있어 부담이 적어요.\n다만 한 번에 너는 빨래 양이 많은 집은 크기를 먼저 확인해 보세요.\n펼친 크기가 방 동선을 막지 않는지도 같이 보면 좋아요.\n아이 옷처럼 작은 빨래가 많은 집은 봉 간격이 촘촘한지 보는 게 좋아요.\n반대로 이불 빨래가 잦다면 가운데 폭이 넉넉한지가 더 중요해요.\n우리 집 빨래 양과 놓을 자리를 먼저 떠올려 보면 고르기 쉬워져요.",
];
const base = (overrides: Partial<BrandLinkContentReadinessInput> = {}): BrandLinkContentReadinessInput => ({
  productName,
  title: "모던홈 접이식 빨래건조대 좁은 집 실내 건조 정리",
  sections: [...plainSections, disclosure],
  hashtags: ["빨래건조대", "접이식건조대", "실내건조"],
  brandLink: "https://naver.me/abcd1234",
  generationSource: "AI",
  hasRepresentativeImage: true,
  connectKind: "SHOPPING",
  mode: "editorial",
  ...overrides,
});

// 프로필 해석: 여행은 항상 strict, 쇼핑은 기본 essential.
const savedProfile = process.env.SHOPPING_GATE_PROFILE;
delete process.env.SHOPPING_GATE_PROFILE;
assert.equal(resolveBrandLinkGateProfile("SHOPPING"), "essential");
assert.equal(resolveBrandLinkGateProfile("TRAVEL"), "strict");
assert.equal(resolveBrandLinkGateProfile("SHOPPING", "strict"), "strict");
process.env.SHOPPING_GATE_PROFILE = "strict";
assert.equal(resolveBrandLinkGateProfile("SHOPPING"), "strict");
delete process.env.SHOPPING_GATE_PROFILE;

// 평범한 원고: strict는 품질 미달로 막고 essential은 권고만 남기고 통과시킨다.
const strict = getBrandLinkContentReadiness(base({ gateProfile: "strict" }));
assert.equal(strict.canPublish, false, "strict는 채점 미달 원고를 막아야 이 검증이 의미가 있다");
assert.equal(strict.verdict, "quality");
const essential = getBrandLinkContentReadiness(base());
assert.equal(essential.gateProfile, "essential");
assert.equal(essential.canPublish, true, essential.summary);
assert.equal(essential.code, "ok");
assert.equal(essential.advisory?.code, strict.code, "권고는 strict 판정 코드를 그대로 전달한다");
assert.equal(essential.score, strict.score, "점수는 프로필과 무관하게 같다");
assert.equal(essential.signals.some((signal) => signal.status === "fail"), false, essential.signals.filter((signal) => signal.status === "fail").map((signal) => signal.key).join(","));
assert.equal(essential.quality.categories.some((category) => category.status === "fail"), false);
assert.equal(essential.qualityFailures?.length, 0);

// 잘못된 글은 essential에서도 막는다.
const blocked = (label: string, input: BrandLinkContentReadinessInput, code: string) => {
  const result = getBrandLinkContentReadiness(input);
  assert.equal(result.canPublish, false, `${label}: 차단되어야 합니다`);
  assert.equal(result.verdict, "blocked", label);
  assert.ok(result.blockers.some((blocker) => blocker.code === code), `${label}: ${result.blockers.map((blocker) => blocker.code).join(",")}`);
};
const withExtra = (line: string) => base({ sections: [`${plainSections[0]}\n${line}`, ...plainSections.slice(1), disclosure] });
blocked("고지 누락", base({ sections: [...plainSections, "마무리\n\n필요한 크기를 확인하고 골라 보세요."] }), "missing-disclosure");
blocked("본문 URL", withExtra("자세한 내용은 https://naver.me/abcd1234 에서 볼 수 있어요."), "link-in-body");
blocked("수수료율", withExtra("이 상품은 수수료 5%가 붙는 상품이에요."), "commission-rate-exposed");
blocked("허위 체험", withExtra("직접 구매해서 한 달 동안 써보니 정말 튼튼했어요."), "unsupported-experience-claim");
blocked("효능 단정", withExtra("이 건조대를 쓰면 비염을 치료해 줍니다."), "unsupported-health-claim");
blocked("부작용 단정", withExtra("부작용이 전혀 없어요."), "unsupported-health-claim");
blocked("상품명 누락", base({
  title: "좁은 집 실내 건조 정리",
  sections: [...plainSections.map((section) => section.replaceAll("모던홈 접이식 빨래건조대", "이 제품").replaceAll("건조대", "거치대")), disclosure],
}), "missing-product-name");
blocked("로컬 폴백", base({ generationSource: "LOCAL_FALLBACK" as BrandLinkContentReadinessInput["generationSource"] }), "non-generative-fallback");
blocked("섹션 2개", base({ sections: [plainSections[0], plainSections[1], disclosure] }), "too-few-sections");
blocked("분량 부족", base({ sections: [...plainSections.slice(0, 3).map((section) => section.split("\n").slice(0, 3).join("\n")), disclosure] }), "too-short-content");

// 하한 완화: 섹션 3개·800자 이상이면 구조로는 막지 않는다(strict는 4개·960자).
const threeSections = base({ sections: [plainSections[0], plainSections[1], `${plainSections[2]}\n${plainSections[3].split("\n\n")[1]}`, disclosure] });
assert.equal(getBrandLinkContentReadiness(threeSections).canPublish, true);
assert.ok(getBrandLinkContentReadiness({ ...threeSections, gateProfile: "strict" }).blockers.some((blocker) => blocker.code === "too-few-sections"));

// 효능 패턴은 유보·부정 문장을 잡지 않는다.
assert.deepEqual(detectUnsupportedHealthClaims("질환 치료 효과를 단정하지 않습니다."), []);
assert.deepEqual(detectUnsupportedHealthClaims("피부 고민은 개인차가 있어 통증을 치료해 준다고 보기는 어려워요."), []);
assert.deepEqual(detectUnsupportedHealthClaims("세탁 후 통풍이 잘 되는 곳에 말려 주세요."), []);
assert.equal(detectUnsupportedHealthClaims("관절염을 완치해 주는 제품입니다.").length, 1);
assert.equal(detectUnsupportedHealthClaims("의학적으로 입증된 효과예요.").length, 1);

// 여행은 프로필 요청이 없으면 strict 그대로다.
const travel = getBrandLinkContentReadiness(base({ connectKind: "TRAVEL", productName: "오사카 3일 패키지", title: "오사카 3일 패키지" }));
assert.equal(travel.gateProfile, "strict");
assert.equal(travel.advisory, undefined);
assert.equal(travel.quality.passScore, 62);

if (savedProfile === undefined) delete process.env.SHOPPING_GATE_PROFILE;
else process.env.SHOPPING_GATE_PROFILE = savedProfile;
console.log("shopping essential gate ok");

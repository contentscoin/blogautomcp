/** Offline regressions for SEO title planning. */
import assert from "node:assert/strict";
import { stripClickbaitFromTitle } from "./lib/blog-writing-style";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { buildTitleKeywordBrief, cleanTitleProductIdentity } from "./lib/title-keyword-brief";
import { buildTitleCandidates, formatTitleCandidatesForPrompt, hasUnsupportedTitleExperience, planTitle, scoreTitle, type TitlePlanContext } from "./lib/topic-templates/title-planner";

const shopping: TitlePlanContext = {
  kind: "SHOPPING", productName: "[특가] RNRN 러닝조끼 메쉬 남녀공용", topicId: "sports_leisure",
  verifiedExperience: false, minChars: 25, maxChars: 35,
};
const info = buildTitleCandidates(shopping);
assert.ok(info.length >= 2);
assert.ok(info.every((title) => !/후기|실사용|써본/u.test(title)), `information mode never plans experience titles: ${info.join(" | ")}`);
assert.ok(info.every((title) => !/\{|\}/u.test(title)), "all placeholders are filled");
assert.ok(info.every((title) => !/특가/u.test(title)), "promotion tokens never reach titles");
const verified = buildTitleCandidates({ ...shopping, verifiedExperience: true });
assert.ok(verified.some((title) => /후기/u.test(title)), "verified experience may use review wording");

// Model titles are kept unless a hard rule fails.
const good = planTitle("러닝조끼 RNRN 메쉬 베스트 착용감과 사이즈 정리", shopping);
assert.equal(good.replaced, false, good.reason);
const experience = planTitle("RNRN 러닝조끼 한 달 실사용 솔직 후기", shopping);
assert.equal(experience.replaced, true, "experience wording without notes is replaced");
assert.ok(!/후기|실사용/u.test(experience.title));
const verifiedKeep = planTitle("RNRN 러닝조끼 한 달 착용 후기와 사이즈 선택", { ...shopping, verifiedExperience: true });
assert.equal(verifiedKeep.replaced, false, verifiedKeep.reason);
const offTopic = planTitle("여름 운동할 때 입기 좋은 옷 고르는 법 알아보기", shopping);
assert.equal(offTopic.replaced, true, "a title without any product identity is replaced");
const sibling = planTitle("러닝조끼 RNRN 메쉬 베스트 착용감과 사이즈 정리", { ...shopping, siblingTitles: ["러닝조끼 RNRN 메쉬 베스트 착용감과 사이즈 정리해봤어요"] });
assert.equal(sibling.replaced, true, "near-duplicate sibling titles are replaced");
assert.ok(scoreTitle("🔥 러닝조끼 RNRN 완벽 가이드 총정리", shopping).hardFailures.length > 0);

// Travel: tips concept, destination first, angle-aware.
const travel: TitlePlanContext = {
  kind: "TRAVEL", productName: "출발확정 여행핫딜 시내숙박 대마도 2일 패키지", topicId: "package_tour",
  verifiedExperience: false, minChars: 25, maxChars: 35,
};
const travelCandidates = buildTitleCandidates(travel);
assert.ok(travelCandidates.some((title) => /^대마도/u.test(title) && /꿀팁/u.test(title)), travelCandidates.join(" | "));
assert.ok(travelCandidates.every((title) => stripClickbaitFromTitle(title) === title), "plain 꿀팁 survives the clickbait filter");
const prep = buildTitleCandidates({ ...travel, angleId: "prep-tips" });
assert.match(prep[0]!, /대마도 여행 준비물/u, "angle keyword leads topic-post titles");
assert.match(formatTitleCandidatesForPrompt(travel), /SEO 제목 후보/u);

// Actual noisy seller names must not turn their rating/promotion into identity/search seeds.
const toner: TitlePlanContext = { kind: "SHOPPING", topicId: "beauty_body", verifiedExperience: false,
  productName: "(2주 잡티 개선) [평점 4.93] 달바 비타 토닝 세럼 토너 180ml 3종 세트",
  primaryKeyword: "토너 2주 잡티 개선", sourceFeatures: ["토너 180ml와 세럼의 구성 안내"], bodySections: ["구성품과 용량 표기를 읽는 방법"] };
const tonerBrief = buildTitleKeywordBrief(toner);
assert.equal(tonerBrief.primaryKeyword, "토너");
assert.match(tonerBrief.cleanIdentity, /달바.*토너/u);
assert.doesNotMatch(tonerBrief.cleanIdentity, /잡티|평점|4\.93/u);
assert.equal(planTitle("토너 2주 잡티 개선 특징과 선택 기준", toner).replaced, true);
assert.equal(planTitle("4.93 추천 | 상황별로 고르는 기준", toner).replaced, true);
assert.equal(planTitle("4.93 평점 1등급 특징과 선택 기준", toner).replaced, true);
assert.ok(buildTitleCandidates(toner).every((title) => !/잡티|개선|평점|4\.93|후기|장단점|특징과 선택 기준/u.test(title)));
assert.ok(buildTitleCandidates(toner).some((title) => /구성/u.test(title)), "fallback asks about a source/body-supported axis");
assert.equal(scoreTitle("토너 잡티 개선을 기대하기 전 확인할 구성", toner).hardFailures.length, 0, "expectation warning is not a medical promise");
assert.ok(scoreTitle("토너 2주 만에 잡티 개선", toner).hardFailures.includes("의료·효능 단정 표현"));
assert.equal(planTitle("달바 토너 구성", toner).replaced, false, "good short model title survives soft length preference");
assert.equal(planTitle("달바 토너 구성품을 하나씩 살펴보며 용량 표기를 읽고 구매 전에 확인할 점", toner).replaced, false, "long readable title is not mechanically replaced");
assert.equal(planTitle("달바 토너 특징과 선택 기준", toner).replaced, false, "bland suffix is advisory");
assert.ok(scoreTitle("달바 토너 특징과 선택 기준", toner).softSignals?.includes("정형적인 제목 후미"));

const shokz = buildTitleKeywordBrief({ productName: "[샥즈] (증정 이벤트) 오픈스윔 프로 수영 이어폰 S710" });
assert.match(shokz.cleanIdentity, /^\[샥즈\]/u);
assert.match(shokz.shortIdentity, /^\[샥즈\].*S710/u, "brand brackets and a late model code are preserved");
assert.equal(shokz.categorySeed, "이어폰");
const jmw: TitlePlanContext = { ...shopping, topicId: "home_appliance",
  productName: "스테디셀러 JMW 에어젯 울트라 PRO 고성능 터보 항공모터 헤어 드라이기 AMH4502" };
const jmwBrief = buildTitleKeywordBrief(jmw);
assert.match(jmwBrief.shortIdentity, /^JMW 에어젯 울트라 PRO/u);
assert.match(jmwBrief.shortIdentity, /AMH4502/u);
assert.doesNotMatch(jmwBrief.shortIdentity, /스테디셀러|고성능/u);
assert.equal(scoreTitle("드라이기 구매 전 무엇을 볼까", jmw).hardFailures.length, 0, "generic category intent is permitted");
assert.ok(scoreTitle("삼성 드라이기 구매 전 무엇을 볼까", jmw).hardFailures.some((reason) => /다른 브랜드/u.test(reason)));
assert.ok(scoreTitle("JMW AMH4503 드라이기", jmw).hardFailures.some((reason) => /다른 브랜드·모델/u.test(reason)));
assert.ok(scoreTitle("JMW 드라이기 10시간 사용", jmw).hardFailures.includes("본문·출처 근거 없는 수치 스펙"));
assert.equal(scoreTitle("JMW AMH4502 드라이기", jmw).hardFailures.length, 0);
assert.ok(scoreTitle("JMW AMH450 드라이기", jmw).hardFailures.some((reason) => /다른 브랜드·모델/u.test(reason)), "a source code substring is not the selected model");
assert.equal(scoreTitle("샥즈 오픈스윔 프로 IPX8, 수영 전에 확인할 점", { ...shopping,
  productName: "[샥즈] 오픈스윔 프로 수영 이어폰 S710", sourceFeatures: ["방수 등급 IPX8"] }).hardFailures.length, 0);
assert.equal(scoreTitle("AAWireless 2, 애플 CarPlay에도 연결될까", { ...shopping,
  productName: "AAWireless 2 무선 안드로이드 오토", sourceFeatures: ["애플 CarPlay 지원 안함"] }).hardFailures.length, 0);
assert.ok(scoreTitle("JMW 드라이기 10시간 사용", { ...jmw, bodySections: ["배터리 사용시간은 10시간입니다"] }).hardFailures.includes("본문·출처 근거 없는 수치 스펙"), "generated body cannot authenticate an invented spec");
assert.ok(scoreTitle("삼성 드라이기 구매 전 무엇을 볼까", { ...jmw, bodySections: ["삼성 드라이기와 비교했습니다"] }).hardFailures.some((reason) => /다른 브랜드/u.test(reason)), "generated body cannot authenticate another brand");
assert.match(cleanTitleProductIdentity("스마트카라 음식물처리기 1.5L 0.5kg"), /1\.5L 0\.5kg/u, "decimal capacities are not mistaken for ratings");
const smartcara = { ...jmw, productName: "스마트카라 스톤 음식물처리기 2L" };
assert.ok(scoreTitle("스마트카라 음식물처리기 50% 할인", smartcara).hardFailures.includes("본문·출처 근거 없는 수치 스펙"));
assert.ok(scoreTitle("스마트카라 음식물처리기 하루 전기료 30원", smartcara).hardFailures.includes("본문·출처 근거 없는 수치 스펙"));
assert.equal(scoreTitle("스마트카라 음식물처리기 가격은 어떻게 확인할까", smartcara).hardFailures.length, 0);
assert.ok(scoreTitle("JMW 드라이기 400W", { ...jmw, sourceFeatures: ["소비전력 1400W"] }).hardFailures.includes("본문·출처 근거 없는 수치 스펙"), "400W is not attested by a 1400W substring");
assert.equal(scoreTitle("JMW 드라이기 1400W", { ...jmw, sourceFeatures: ["소비전력 1400W"] }).hardFailures.length, 0);
assert.ok(scoreTitle("스마트카라 음식물처리기 15L", { ...smartcara, sourceFeatures: ["처리 용량 1.5L"] }).hardFailures.includes("본문·출처 근거 없는 수치 스펙"), "decimal punctuation preserves 1.5L vs 15L");
assert.equal(scoreTitle("스마트카라 음식물처리기 1.5L", { ...smartcara, sourceFeatures: ["처리 용량 1.5 L"] }).hardFailures.length, 0);
assert.equal(scoreTitle("스마트카라 음식물처리기 전기료 3000원", { ...smartcara, sourceFeatures: ["전기료 예시 3,000원"] }).hardFailures.length, 0, "thousands separator normalization preserves exact amount/unit");
assert.equal(planTitle("스마트카라 스톤 음식물처리기 관리", { ...smartcara, siblingTitles: ["스마트카라 스톤 음식물처리기"] }).replaced, false, "product-only sibling is not a clone of a new decision axis");
assert.equal(buildTitleKeywordBrief({ productName: "안성 한우 1등급 1200g 선물 세트" }).categorySeed, "한우 선물세트");
assert.equal(buildTitleKeywordBrief({ productName: "해피달링 시그니처 워터탭 아기비데" }).categorySeed, "비데");
assert.equal(buildTitleKeywordBrief({ productName: "초음파 가습기" }).categorySeed, "가습기");
assert.equal(buildTitleKeywordBrief({ productName: "프린터 토너 카트리지" }).categorySeed, "토너 카트리지");
assert.equal(buildTitleKeywordBrief({ productName: "크림색 커튼" }).categorySeed, "커튼");
assert.equal(buildTitleKeywordBrief({ productName: "헤드폰 스탠드" }).categorySeed, "헤드폰 스탠드");

const queries = buildTitleKeywordBrief({ productName: "JMW AMH4502 드라이기", searchSuggestions: [
  "드라이기 추천", "JMW 드라이기 관리", "삼성 드라이기 추천", "JMW AMH4503 드라이기", "드라이기 후기", "드라이기 최저가", "드라이기 검색량 10000", "드라이기 추천",
] });
assert.deepEqual(queries.searchExpressions, ["드라이기 추천", "JMW 드라이기 관리"]);
assert.equal(queries.decisionAxes.some((axis) => axis.label === "관리"), false, "query intent is not source evidence");
assert.ok(buildTitleCandidates({ ...jmw, searchSuggestions: ["드라이기 비교"] }).every((title) => !/비교/u.test(title)));
assert.ok(buildTitleCandidates({ ...jmw, bodySections: ["세척 후 보관 방법"] }).some((title) => /관리/u.test(title)));
assert.ok(buildTitleCandidates(jmw).every((title) => !/관리|효과|비교|가격|후기/u.test(title)), "absent body facts are not fabricated");

assert.equal(hasUnsupportedTitleExperience("후기만 보고 골라도 될까?"), false);
assert.equal(hasUnsupportedTitleExperience("내돈내산 후기 없이 사양 확인하기"), false);
assert.equal(hasUnsupportedTitleExperience("실사용 전 확인할 구성"), false);
assert.equal(hasUnsupportedTitleExperience("JMW 실사용 후기"), true);
assert.equal(hasUnsupportedTitleExperience("직접 써봤어요, 후기는 없습니다"), true, "a later denial cannot erase an earlier claim");
assert.equal(scoreTitle("러닝조끼 후기만 보고 골라도 될까?", shopping).hardFailures.length, 0);
assert.equal(planTitle("러닝조끼 RNRN 메쉬 사이즈는 어떻게 고를까", { ...shopping,
  siblingTitles: ["러닝조끼 RNRN 메쉬 소재는 어떻게 볼까"] }).replaced, false, "shared identity does not force a distinct angle replacement");

const turkey: TitlePlanContext = { ...travel, productName: "월드체인 튀르키예 9일 패키지", primaryKeyword: "월드체인" };
const turkeyBrief = buildTitleKeywordBrief(turkey);
assert.equal(turkeyBrief.destination, "튀르키예");
assert.equal(turkeyBrief.primaryKeyword, "튀르키예");
assert.equal(turkeyBrief.duration, "9일");
assert.ok(buildTitleCandidates(turkey).every((title) => /^튀르키예/u.test(title) && !/월드체인/u.test(title)));
assert.equal(planTitle("월드체인 9일 패키지 여행 꿀팁 | 일정·포함사항 정리", turkey).replaced, true);
const hotelPromotion = buildTitleKeywordBrief({ kind: "TRAVEL", productName: "대한항공 노쇼핑 VVIP 풀패키지 [신축 M 호텔 다낭 3박5일] 바나힐/호이안 1일 1마사지 - 인천 오후 출발변경" });
assert.equal(hotelPromotion.destination, "바나힐", "original brackets preserve hotel-promotion exclusion semantics");
assert.equal(hotelPromotion.duration, "3박5일");
assert.doesNotMatch(hotelPromotion.shortIdentity, /신축|인천/u);

const prompt = formatTitleCandidatesForPrompt({ ...toner, sourceDescription: "긴 원본 설명 ".repeat(400), bodySections: ["긴 원고 ".repeat(400)] });
assert.match(prompt, /후보 3개/u);
assert.match(prompt, /기계적으로 복사하지/u);
assert.match(prompt, /검색량·수요 수치를 추정하지/u);
assert.doesNotMatch(prompt, /긴 원본 설명|긴 원고/u, "mandatory suffix exposes brief signals rather than full source content");
assert.ok(prompt.length < 1200, `full title guidance stays bounded: ${prompt.length}`);
const compactPrompt = formatTitleCandidatesForPrompt(toner, true);
assert.ok(compactPrompt.length <= 160, `minimal browser title guidance stays compact: ${compactPrompt.length}`);
assert.doesNotMatch(compactPrompt, /표현 참고/u);
assert.match(compactPrompt, /후보 3개/u);

// The final material gate must use the same identity instead of the first six promotional tokens.
function titleIdentityVerdict(kind: "SHOPPING" | "TRAVEL", productName: string, title: string) {
  return getBrandLinkContentReadiness({ connectKind: kind, productName, title, sections: [], hashtags: [],
    brandLink: "", generationSource: "AI", hasRepresentativeImage: false,
  }).signals.find((signal) => signal.key === "product-title")?.status;
}
assert.equal(titleIdentityVerdict("SHOPPING", toner.productName, "달바 토너, 구성부터 확인할까?"), "pass");
assert.equal(titleIdentityVerdict("SHOPPING", toner.productName, "4.93 평점 잡티 개선"), "fail");
const hotelPromoName = "[대한항공/노쇼핑] VVIP 풀패키지 [신축 M 호텔 다낭 3박5일] 바나힐/호이안";
assert.equal(titleIdentityVerdict("TRAVEL", hotelPromoName, "바나힐 3박5일 여행 꿀팁 | 코스·준비물"), "pass");
assert.equal(titleIdentityVerdict("TRAVEL", hotelPromoName, "신축 호텔 VVIP 풀패키지"), "fail");

console.log("PASS: source-grounded identity/search intent, soft title preferences, actual noisy inputs, conservative claims, sibling distinction and final material title gate");

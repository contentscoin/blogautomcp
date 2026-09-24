/** Offline regressions for SEO title planning. */
import assert from "node:assert/strict";
import { stripClickbaitFromTitle } from "./lib/blog-writing-style";
import { buildTitleCandidates, formatTitleCandidatesForPrompt, planTitle, scoreTitle, type TitlePlanContext } from "./lib/topic-templates/title-planner";

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

console.log("PASS: title candidates (mode-aware), hard-rule replacement, sibling similarity, travel tips and angles");

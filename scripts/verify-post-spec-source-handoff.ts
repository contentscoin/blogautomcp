import assert from "node:assert/strict";
import { sourceFeaturesForValidation } from "./lib/post-spec/validate";
import { assessTravelFeatureCoverage } from "./lib/travel-content";
import { buildProductVerifiedFactLines } from "./lib/product-editorial-plan";

const check = (lines: string[]) => assessTravelFeatureCoverage(sourceFeaturesForValidation({
  connectKind: "TRAVEL",
  facts: { lines, blockedClaimRules: [], travel: {
    duration: "3박5일", destinations: ["다낭"], highlights: [], conditions: [], departureConfirmed: false,
  } },
}));
const visits = "상세 근거: 핵심 방문지: 바나힐, 호이안, 다낭";
const days = [2, 3, 4].map((day) => `상세 근거: ${day}일차 일정: 다낭 관광`);
assert.equal(check([visits, ...days]).sufficient, true);
assert.equal(check([visits]).sufficient, false);
assert.equal(check([visits, ...days.slice(0, 2)]).sufficient, false, "Five days still requires three itinerary days");
assert.equal(check([visits, days[0], days[0], days[0]]).sufficient, false);
assert.equal(check([visits, ...days.slice(0, 2), "상세 근거: 여행 기간: 1일"]).sufficient, false, "Shorter source duration cannot manufacture coverage");
assert.equal(check(["상품명: 핵심 방문지: 바나힐, 호이안, 다낭", ...days]).sufficient, false);
assert.equal(check(["설명: 핵심 방문지: 바나힐, 호이안, 다낭", ...days]).sufficient, false);
const collector = ["여행 기간: 5일", "핵심 방문지: 바나힐, 호이안, 다낭",
  "1일차 일정: 인천 출발 → 다낭 도착", "2일차 일정: 바나힐 관광", "3일차 일정: 호이안 관광"];
const facts = (features: string[]) => buildProductVerifiedFactLines({
  productName: "다낭 3박5일", features, targetSectionCount: 9,
});
const preserved = facts(collector);
for (const line of collector) assert.ok(preserved.includes(line), `Collector row preserved verbatim: ${line}`);
assert.equal(check(preserved).sufficient, true);
assert.equal(check(facts(collector.slice(0, 4))).sufficient, false);
assert.equal(check(facts(collector.slice(0, 2))).sufficient, false);
const longSchedule = Array.from({ length: 12 }, (_, i) => `${i + 1}일차 일정: 목적지 관광`);
for (const line of longSchedule) assert.ok(facts(longSchedule).includes(line), "Shopping feature limit must not truncate collected days");
assert.equal(check(facts(["핵심 방문지:", "0일차 일정: 도착", "1일차 일정:"])).sufficient, false);
assert.ok(facts([collector.join("\n")]).includes(collector[2]), "Multiline collector rows preserved");
console.log(JSON.stringify({ ok: true, sourceHandoff: true, itineraryGatePreserved: true }));

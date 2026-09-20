import assert from "node:assert/strict";
import { assessTravelReviewSubstance, travelSceneEvidence } from "./lib/travel-content";

assert.equal(travelSceneEvidence(["청수사의 무대는 목조 기둥이 받칩니다. 무대에서는 도시 전망을 감상합니다."], ["청수사"]).length, 1);
assert.equal(travelSceneEvidence(["청수사의 무대는 목조 기둥이 받칩니다.", "도시 전망을 감상합니다."], ["청수사"]).length, 0);
assert.equal(travelSceneEvidence(["청수사의 무대는 목조 기둥이 받칩니다.\n\n도시 전망을 감상합니다."], ["청수사"]).length, 0);
assert.equal(travelSceneEvidence(["청수사는 목조 사찰입니다. 도톤보리에서 사진을 찍습니다."], ["청수사", "도톤보리"]).length, 1);
assert.equal(travelSceneEvidence(["청수사를 소개합니다. 여행 사진을 확인하세요."], ["청수사"]).length, 0);
const result = assessTravelReviewSubstance({productName:"오사카 여행", sourceText:"핵심 방문지: 나라사슴공원, 신사이바시&도톤보리, 청수사", sections:["나라공원의 사슴을 사진으로 남깁니다.", "신사이바시의 상점 거리를 걷습니다.", "도톤보리 강변을 산책합니다."]});
assert.ok(!result.uncoveredPlaces.includes("나라사슴공원"));
assert.ok(!result.uncoveredPlaces.includes("신사이바시"));
assert.ok(!result.uncoveredPlaces.includes("도톤보리"));
assert.ok(result.uncoveredPlaces.includes("청수사"));
const parentheticalPlace = assessTravelReviewSubstance({
  productName: "코타키나발루 5일",
  sourceText: "핵심 방문지: KK Star Lounge 스타라운지, 사바 주립 모스크 (이슬람사원), 사바 주청사",
  sections: [
    "KK Star Lounge 스타라운지에서 출국 전 샤워와 휴식을 할 수 있습니다.",
    "사바 주립 모스크의 흰 외벽과 미나렛을 사진으로 남깁니다.",
    "사바 주청사의 원형 건축을 차창 너머로 감상합니다.",
  ],
});
assert.deepEqual(parentheticalPlace.coveredPlaces, ["KK Star Lounge 스타라운지", "사바 주립 모스크 (이슬람사원)", "사바 주청사"]);
assert.deepEqual(parentheticalPlace.uncoveredPlaces, []);
console.log("PASS travel aliases, compound places, bounded scene context and negative controls");

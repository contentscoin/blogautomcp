import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getMobileSectionLinePolicy } from "./lib/blog-writing-style";
import { parseStoredTravelPageResearch, type TravelPageResearch } from "./lib/travel-content";

const fixture: TravelPageResearch = {
  source: "naver-package-next-data",
  durationDays: 4,
  destinations: ["일본", "홋카이도"],
  highlights: [
    { name: "노보리베츠", description: "온천 마을" },
    { name: "죠잔케이", description: "계곡 온천" },
  ],
  schedules: [
    { day: 1, activities: ["신치토세 공항", "노보리베츠 이동"], meals: ["석식"], transport: "전용버스" },
    { day: 2, activities: ["노보리베츠", "죠잔케이"], meals: ["조식", "중식"], transport: "전용버스" },
  ],
  flights: ["출국 · 인천→신치토세"],
  shopping: [],
};

const restored = parseStoredTravelPageResearch(JSON.stringify(fixture));
assert.ok(restored, "저장된 여행 일정 JSON을 복원해야 합니다.");
assert.equal(restored.durationDays, 4);
assert.equal(restored.schedules.length, 2);
assert.equal(restored.highlights.length, 2);
assert.equal(parseStoredTravelPageResearch("not-json"), null, "손상된 JSON은 안전하게 무시해야 합니다.");

const travelPolicy = getMobileSectionLinePolicy("TRAVEL");
assert.deepEqual(travelPolicy, { preferred: 5, hardMinimum: 3 });
assert.ok(4 >= travelPolicy.hardMinimum, "여행 4문장 섹션은 즉시 실패하지 않고 품질검사로 넘겨야 합니다.");

const agentSource = fs.readFileSync(path.join(__dirname, "simple-agent.ts"), "utf8");
for (const requiredSnippet of [
  "needsTravelResearchRefresh",
  "travelResearchJson: product.travelPageResearch ? JSON.stringify(product.travelPageResearch) : null",
  "expandProductDetailSections(page)",
]) {
  assert.ok(agentSource.includes(requiredSnippet), `회귀 방지 코드가 필요합니다: ${requiredSnippet}`);
}

console.log(JSON.stringify({ ok: true, restoredSchedules: restored.schedules.length, travelPolicy }));

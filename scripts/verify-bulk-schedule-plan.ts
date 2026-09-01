import assert from "node:assert/strict";
import {
  addDaysToYmd,
  compactedScheduleDate,
  normalizeBulkScheduleStartDate,
  ymdInTimeZone,
} from "../src/lib/bulk-schedule-plan";

assert.equal(addDaysToYmd("2026-09-30", 1), "2026-10-01");
assert.equal(compactedScheduleDate("2026-09-02", 0, 1), "2026-09-02");
assert.equal(compactedScheduleDate("2026-09-02", 1, 1), "2026-09-03");
assert.equal(compactedScheduleDate("2026-09-02", 2, 1), "2026-09-04");
assert.equal(ymdInTimeZone(new Date("2026-09-02T00:00:00Z"), "Asia/Seoul"), "2026-09-02");
assert.equal(
  normalizeBulkScheduleStartDate("2026-09-01", new Date("2026-09-01T10:40:00Z"), "Asia/Seoul"),
  "2026-09-02",
);
assert.equal(
  normalizeBulkScheduleStartDate("2026-09-03", new Date("2026-09-01T10:40:00Z"), "Asia/Seoul"),
  "2026-09-03",
);

// 첫 시도가 실패하면 successfulCount는 증가하지 않으므로 다음 후보가 같은
// 날짜를 이어받고, 성공한 뒤에만 다음 날짜로 이동한다.
const datesAfterFailure = [
  compactedScheduleDate("2026-09-02", 0, 1),
  compactedScheduleDate("2026-09-02", 0, 1),
  compactedScheduleDate("2026-09-02", 1, 1),
];
assert.deepEqual(datesAfterFailure, ["2026-09-02", "2026-09-02", "2026-09-03"]);

console.log("bulk schedule compact date plan verified");

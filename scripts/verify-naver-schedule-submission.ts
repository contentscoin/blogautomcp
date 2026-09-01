import assert from "node:assert/strict";
import { inspectNaverScheduleSubmissionSignal } from "../src/lib/naver-schedule-submission";

const targetYmd = "2026-09-03";

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/publish",
    postData: JSON.stringify({ radio_time: "pre", preDate: targetYmd }),
    status: 200,
    targetYmd,
  }).confirmed,
  true
);

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/publish",
    postData: JSON.stringify({ publish: true }),
    status: 200,
    targetYmd,
  }).confirmed,
  false
);

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/reserve",
    postData: JSON.stringify({ radio_time: "pre", preDate: "2026-09-04" }),
    status: 200,
    targetYmd,
  }).confirmed,
  false
);

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/reserve",
    postData: `radio_time=pre&preDate=${targetYmd}`,
    status: 500,
    targetYmd,
  }).confirmed,
  false
);

console.log("naver schedule submission signal verified");

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Page } from "playwright";
import { inspectNaverScheduleSubmissionSignal } from "../src/lib/naver-schedule-submission";
import { createScheduleSubmissionTracker, waitForConfirmedScheduleSubmission } from "./lib/naver-schedule-tracker";

const targetYmd = "2026-09-03";

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/publish",
    postData: JSON.stringify({ radio_time: "pre", preDate: targetYmd }),
    status: 200,
    responseBody: { success: true, result: { reservationId: "reservation-fixture" } },
    targetYmd,
  }).confirmed,
  true
);

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/reserve?radio_time=pre&preDate=2026.9.3",
    postData: JSON.stringify({ publish: true }),
    status: 200,
    responseBody: { success: true, result: { reservationId: "query-fixture" } },
    targetYmd,
  }).confirmed,
  true,
  "reservation date/mode may be carried in the URL query"
);

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/reserve",
    postData: JSON.stringify({ publishType: "예약", preDate: "2026년 9월 3일" }),
    status: 200,
    responseBody: { success: true, result: { reservationId: "korean-date-fixture" } },
    targetYmd,
  }).confirmed,
  true,
  "Korean/unpadded date values are recognized"
);

assert.equal(
  inspectNaverScheduleSubmissionSignal({
    url: "https://blog.naver.com/api/post/rabbit",
    postData: JSON.stringify({ radio_time: "pre", publishAt: 1788393600000 }),
    status: 200,
    responseBody: { success: true, result: { reservationId: "epoch-date-fixture" } },
    targetYmd,
  }).confirmed,
  true,
  "timestamp reservation payloads are recognized"
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

const validInput = {
  url: "https://blog.naver.com/api/post/publish",
  postData: JSON.stringify({ radio_time: "pre", preDate: targetYmd }),
  status: 200, targetYmd,
  responseBody: { success: true, result: { reservationId: "reservation-fixture" } } as unknown,
};
for (const responseBody of [
  undefined, "<html>login</html>", { success: false, result: { reservationId: "existing-id" } },
  { success: true, error: "denied", result: { reservationId: "existing-id" } },
  { success: true, result: { success: false, reservationId: "existing-id" } },
  { result: { reservationId: "existing-id" } }, { success: true },
  { success: true, result: { reservationId: 0 } },
  { success: true, result: { reservationId: 9007199254740992 } },
]) {
  assert.equal(inspectNaverScheduleSubmissionSignal({ ...validInput, responseBody }).confirmed, false);
}
for (const url of ["https://naver.com.evil.example/post/publish", "https://blog.naver.com/login?returnUrl=post/publish"]) {
  assert.equal(inspectNaverScheduleSubmissionSignal({ ...validInput, url }).confirmed, false);
}
assert.equal(inspectNaverScheduleSubmissionSignal({ ...validInput, status: 302 }).confirmed, false);
assert.equal(inspectNaverScheduleSubmissionSignal({ ...validInput, postData: "radio_time=now" }).confirmed, false);
assert.equal(inspectNaverScheduleSubmissionSignal({ ...validInput, targetYmd: "2026-09-04" }).confirmed, false);

function fakeRequest(url = validInput.url, postData = validInput.postData) {
  return { url: () => url, postData: () => postData, method: () => "POST" };
}
function fakeResponse(request: ReturnType<typeof fakeRequest>, text: () => Promise<string>) {
  return { request: () => request, url: request.url, status: () => 200, headers: () => ({}), text };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function main() {
  // The response event arrives before its body. Confirmation must await the body even if
  // the page navigates; none of these tests needs a browser, session or live post.
  const events = new EventEmitter();
  const tracker = createScheduleSubmissionTracker(events as unknown as Pick<Page, "on" | "off">, targetYmd, { responseBodyTimeoutMs: 200 });
  const request = fakeRequest("https://blog.naver.com/api/post/publish?token=do-not-log-me");
  let resolveBody!: (value: string) => void;
  const body = new Promise<string>((resolve) => { resolveBody = resolve; });
  events.emit("request", request);
  events.emit("response", fakeResponse(request, () => body));
  assert.equal(tracker.hasAnyPublishRequest(), true);
  assert.equal(tracker.hasConfirmedScheduleRequest(), false);
  assert.equal(tracker.getPendingResponseCount(), 1);
  const verified = waitForConfirmedScheduleSubmission(tracker, 150);
  resolveBody(JSON.stringify({ success: true, result: { reservationId: "private-id", message: "private-user-text", access_token: "private-secret" } }));
  assert.equal(await verified, true);
  assert.equal(tracker.getReservationId(), "private-id");
  const diagnostics = tracker.getRecentEvents().join(" ");
  for (const secret of ["do-not-log-me", "private-id", "private-user-text", "private-secret", "access_token"]) assert.equal(diagnostics.includes(secret), false);
  assert.match(diagnostics, /"body":"json"/);
  assert.equal(tracker.getPendingResponseCount(), 0);
  tracker.stop();
  assert.equal(events.listenerCount("request"), 0);
  assert.equal(events.listenerCount("response"), 0);
  assert.equal(events.listenerCount("requestfailed"), 0);

  const unavailableEvents = new EventEmitter();
  const unavailable = createScheduleSubmissionTracker(unavailableEvents as unknown as Pick<Page, "on" | "off">, targetYmd, { responseBodyTimeoutMs: 100 });
  const unavailableRequest = fakeRequest();
  unavailableEvents.emit("request", unavailableRequest);
  unavailableEvents.emit("response", fakeResponse(unavailableRequest, async () => { throw new Error("Response body is unavailable for https://blog.naver.com/private"); }));
  await flush();
  assert.match(unavailable.getRecentEvents().join(" "), /"body":"unavailable"/);
  assert.match(unavailable.getRecentEvents().join(" "), /"bodyError":"Response body is unavailable for <url>"/);
  unavailable.stop();

  const emptyEvents = new EventEmitter();
  const empty = createScheduleSubmissionTracker(emptyEvents as unknown as Pick<Page, "on" | "off">, targetYmd, { responseBodyTimeoutMs: 10 });
  let irrelevantReads = 0;
  emptyEvents.emit("response", fakeResponse(request, async () => { irrelevantReads++; return JSON.stringify(validInput.responseBody); }));
  const unrelated = fakeRequest("https://unrelated.example/api/post");
  emptyEvents.emit("request", unrelated);
  emptyEvents.emit("response", fakeResponse(unrelated, async () => { irrelevantReads++; return "private"; }));
  await flush();
  assert.equal(irrelevantReads, 0, "ignore unrelated responses and requests that predate tracking");
  assert.equal(empty.hasAnyPublishRequest(), false);

  const failed = fakeRequest();
  emptyEvents.emit("request", failed);
  emptyEvents.emit("requestfailed", failed);
  assert.match(empty.getRecentEvents().join(" "), /request_failed/);
  const never = fakeRequest();
  emptyEvents.emit("request", never);
  emptyEvents.emit("response", fakeResponse(never, () => new Promise(() => {})));
  assert.equal(await waitForConfirmedScheduleSubmission(empty, 40), false);
  assert.equal(empty.getPendingResponseCount(), 0);
  assert.match(empty.getRecentEvents().join(" "), /"body":"timeout"/);
  const html = fakeRequest();
  emptyEvents.emit("request", html);
  emptyEvents.emit("response", fakeResponse(html, async () => "<html>private login contents</html>"));
  await flush();
  assert.equal(empty.hasConfirmedScheduleRequest(), false);
  assert.match(empty.getRecentEvents().join(" "), /"body":"html"/);
  assert.equal(empty.getRecentEvents().join(" ").includes("private login contents"), false);
  for (let i = 0; i < 30; i++) emptyEvents.emit("request", fakeRequest());
  assert.equal(empty.getRecentEvents().length, 20, "diagnostics have a bounded event buffer");
  empty.stop();

  const stoppedEvents = new EventEmitter();
  const stopped = createScheduleSubmissionTracker(stoppedEvents as unknown as Pick<Page, "on" | "off">, targetYmd);
  const late = fakeRequest();
  let resolveLate!: (value: string) => void;
  const lateBody = new Promise<string>((resolve) => { resolveLate = resolve; });
  stoppedEvents.emit("request", late);
  stoppedEvents.emit("response", fakeResponse(late, () => lateBody));
  stopped.stop();
  resolveLate(JSON.stringify(validInput.responseBody));
  await flush();
  assert.equal(stopped.getPendingResponseCount(), 0);
  assert.equal(stopped.hasConfirmedScheduleRequest(), false, "late callbacks cannot mutate a stopped attempt");

  const boundedEvents = new EventEmitter();
  const bounded = createScheduleSubmissionTracker(boundedEvents as unknown as Pick<Page, "on" | "off">, targetYmd, { maxResponseBytes: 80 });
  const oversized = fakeRequest();
  boundedEvents.emit("request", oversized);
  boundedEvents.emit("response", fakeResponse(oversized, async () => JSON.stringify({ success: true, result: { reservationId: "oversized-receipt" }, message: "x".repeat(100) })));
  await flush();
  assert.equal(bounded.hasConfirmedScheduleRequest(), false);
  assert.match(bounded.getRecentEvents().join(" "), /"body":"too_large"/);
  for (let i = 0; i < 9; i++) {
    const pending = fakeRequest();
    boundedEvents.emit("request", pending);
    boundedEvents.emit("response", fakeResponse(pending, () => new Promise(() => {})));
  }
  assert.equal(bounded.getPendingResponseCount(), 8);
  assert.match(bounded.getRecentEvents().join(" "), /"body":"concurrency_limit"/);
  bounded.stop();
  assert.equal(bounded.getPendingResponseCount(), 0);
  console.log("naver schedule submission: strict acceptance, delayed responses, bounded waits and redacted diagnostics verified");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

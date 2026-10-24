import assert from "node:assert/strict";
import { test } from "node:test";
import { publicationVerificationSummary as summary } from "./publication-verification-summary";

test("a public URL alone and contradictory audit flags never announce full completion", () => {
  for (const data of [
    { published: true }, { published: true, contentVerified: true },
    { published: true, contentVerified: false, verificationStatus: "verified" },
    { published: true, contentVerified: true, verificationStatus: "partial" },
  ]) {
    assert.match(summary(data), /추가 확인 필요/u);
    assert.doesNotMatch(summary(data), /검증 완료/u);
  }
  assert.match(summary({ published: true, contentVerified: true, verificationStatus: "verified" }), /검증 완료/u);
  assert.match(summary({ published: true, contentVerified: false, verificationStatus: "mismatch" }), /불일치/u);
});
test("reservation receipt and uncertain submission require an outcome check", () => {
  assert.match(summary({ scheduled: true }), /예약 접수 확인.*별도 확인/u);
  assert.match(summary({ outcomeUnknown: true }), /기존 제출 결과/u);
  assert.doesNotMatch(summary({ outcomeUnknown: true }), /검증 완료|다시 발행/u);
  assert.doesNotMatch(summary({ status: "private-secret", errorMessage: "token-secret" }), /private-secret|token-secret/u);
});

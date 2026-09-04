import assert from "node:assert/strict";
import { test } from "node:test";
import { isDraftEditorialQualityPassed } from "./brand-post-quality-display";
import { getDraftApprovalBlockers } from "../app/draft-approval-ui";

const missingFit = {
  canPublish: false, score: 96, reason: "이미지 부족",
  blockers: [{ code: "composition-quality", tier: "structure", reason: "이미지 부족" }],
  quality: { score: 96, passScore: 70, categories: [{ key: "usefulness", label: "구매 판단에 필요한 요소", status: "fail", notes: ["추천·비추천 대상"] }] },
  signals: [
    { key: "review-substance", label: "제품 특장점·활용법·후기 근거 리뷰", status: "fail" },
    { key: "composition-quality", label: "이미지 부족", status: "fail" },
  ],
};

test("96-point missing fit is a content failure despite structure-only blockers", () => {
  assert.equal(isDraftEditorialQualityPassed(missingFit), false);
  const blockers = getDraftApprovalBlockers({ contentQuality: missingFit,
    composition: { qualityReport: { preset: "PREMIUM", canAutoPublish: false, blockers: ["이미지 부족"] } },
  });
  assert.ok(blockers.some((message) => message.startsWith("원고 ·")));
  assert.ok(blockers.includes("이미지 부족"));
});
test("empty blockers and high score cannot erase a failing content signal", () => {
  const noBlockers = { ...missingFit, blockers: [] };
  assert.equal(isDraftEditorialQualityPassed(noBlockers), false);
});
test("low score and actual safety failures stay blocked", () => {
  const lowScore = { ...missingFit, score: 60 };
  assert.equal(isDraftEditorialQualityPassed(lowScore), false);
  const safetyFailure = { ...missingFit, score: 100,
    blockers: [{ code: "internal-guidance-leak", tier: "safety", reason: "내부 지침 노출" }],
    signals: [{ key: "internal-guidance", label: "내부 지침 노출", status: "fail" }],
  };
  assert.equal(isDraftEditorialQualityPassed(safetyFailure), false);
});
test("legacy content failures stay conservative; isolated composition failure is separate", () => {
  assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [{ key: "review-substance", status: "fail" }] }), false);
  assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [{ key: "composition-quality", status: "fail" }] }), true);
  assert.equal(isDraftEditorialQualityPassed({ canPublish: false, signals: [] }), false);
  assert.equal(isDraftEditorialQualityPassed({ canPublish: true, signals: [] }), true);
});

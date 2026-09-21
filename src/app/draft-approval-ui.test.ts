import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { getDraftApprovalBlockers, getRepairStatus, getDraftRecheckError } from "./draft-approval-ui";

const passing = {
  contentQuality: { canPublish: true, reason: null, signals: [] },
  composition: { qualityReport: { preset: "PREMIUM", canAutoPublish: true, blockers: [] as string[] } },
};

test("saved draft auto review is wired to recheck, not generation or approval", () => {
  const component = readFileSync("src/components/SavedDraftAutoReview.tsx", "utf8");
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.match(page, /<SavedDraftAutoReview/);
  assert.doesNotMatch(page, /저장 원고 · 자동 검수 대기/);
  assert.match(component, /method: "PATCH"/);
  assert.match(component, /action: "recheck"/);
  assert.match(component, /payload\.rechecked/);
  assert.match(component, /getDraftApprovalBlockers\(payload\.data\)/);
  assert.doesNotMatch(component, /action: "(?:approve|revise|generate)"/);
});

test("passing text does not hide missing section images, even without a job record", () => {
  assert.deepEqual(getDraftApprovalBlockers({ ...passing, imageSlots: [{ title: "객실", generationMissing: 1 }] }), ["이미지 · 객실: 생성 이미지 1장 필요"]);
});
test("image-only content failure does not tell the user to rewrite passing text", () => {
  const result = getDraftApprovalBlockers({ ...passing,
    contentQuality: { canPublish: false, reason: "이미지 부족", signals: [{ key: "composition-quality", label: "이미지 부족", status: "fail" }] },
    composition: { qualityReport: { preset: "PREMIUM", canAutoPublish: false, blockers: ["객실 이미지 필요"] } },
  });
  assert.deepEqual(result, ["객실 이미지 필요"]);
});
test("text failures and composition blockers remain explicit and deduplicated", () => {
  assert.deepEqual(getDraftApprovalBlockers({ ...passing,
    contentQuality: { canPublish: false, reason: null, signals: [{ key: "facts", label: "출처 확인 필요", status: "fail" }] },
    composition: { qualityReport: { preset: "PREMIUM", canAutoPublish: false, blockers: ["본문 부족", "본문 부족"] } },
  }), ["원고 · 출처 확인 필요", "본문 부족"]);
});
test("running generation and remaining images block approval; missing QC is not success", () => {
  assert.equal(getDraftApprovalBlockers({ ...passing, imageGeneration: { status: "running", remaining: 2 } }).length, 2);
  assert.equal(getDraftApprovalBlockers({ composition: passing.composition }).length, 1);
  assert.deepEqual(getDraftApprovalBlockers(passing), []);
});
test("repair status distinguishes attempt, application, and final readiness", () => {
  assert.equal(getRepairStatus(null), "자동 보강 미시도");
  assert.match(getRepairStatus({ attempted: true, applied: false, beforeScore: 80, afterScore: 80 }), /반영되지/);
  assert.match(getRepairStatus({ attempted: true, applied: true, beforeScore: 80, afterScore: 100 }), /승인 조건은 별도 확인/);
});
test("recheck uses the agreed PATCH endpoint without regeneration and surfaces server rejection", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const handler = page.split("const handleRecheckBrandDraft = async () => {")[1].split("const requestDraftImageAction")[0];
  assert.match(handler, /method: "PATCH"/);
  assert.match(handler, /action: "recheck"/);
  assert.match(handler, /getDraftRecheckError\(payload, id\)/);
  assert.doesNotMatch(handler, /handlePrepareBrandDraft|method: "POST"/);
  assert.match(page, /onClick=\{\(\) => void handleRecheckBrandDraft\(\)\}/);
});

test("text repair rechecks then PATCHes the existing package without restarting draft generation", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const handler = page.split("const handleRepairBrandDraft = async () => {")[1].split("const requestDraftImageAction")[0];
  assert.match(handler, /action: "recheck"/);
  assert.match(handler, /plan\.action !== "repair-text"/);
  assert.match(handler, /action: "revise", qualityConvergence: true, instructions/);
  assert.match(handler, /기존 문단 제목, 순서, 이미지 의도와 검수 완료 이미지는 유지하세요/);
  assert.doesNotMatch(handler, /method: "POST"|forceQualityRepair|handlePrepareBrandDraft/);
  assert.match(page, /onClick=\{\(\) => void handleRepairBrandDraft\(\)\}/);
});

test("missing QC source gives recovery steps and preserves the server reason", () => {
  const message = getDraftRecheckError({ code: "QC_SOURCE_REQUIRED", error: "상품 신원 확인 실패" }, "travel-123");
  for (const text of ["상품 신원 확인 실패", "travel-123", "원본 상품 URL", "컨텍스트를 복구", "최신 기준 재검사", "자동 실행되지 않습니다"]) assert.ok(message.includes(text));
  assert.equal(getDraftRecheckError({ code: "OTHER", error: "잠시 후 재시도" }, "123"), "잠시 후 재시도");
});

test("saved material preview remains read-only and has a matching label", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const row = page.split("onClick={() => void handleOpenOrPrepareBrandDraft(link)}")[1].split("</button>")[0];
  assert.match(row, /저장 원고 보기/);
  assert.match(row, /title="저장된 초안과 이미지를 확인합니다"/);
  const handler = page.split("const handleOpenOrPrepareBrandDraft =")[1].split("const handleBulkPrepareBrandDrafts")[0];
  assert.doesNotMatch(handler, /handlePrepareBrandDraft|method: "POST"/);
});

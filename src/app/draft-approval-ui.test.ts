import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { getDraftApprovalBlockers, getRepairStatus, getDraftRecheckError } from "./draft-approval-ui";

const passing = {
  contentQuality: { canPublish: true, reason: null, signals: [] },
  composition: { qualityReport: { preset: "PREMIUM", canAutoPublish: true, blockers: [] as string[] } },
};

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

test("missing QC source gives recovery steps and preserves the server reason", () => {
  const message = getDraftRecheckError({ code: "QC_SOURCE_REQUIRED", error: "상품 신원 확인 실패" }, "travel-123");
  for (const text of ["상품 신원 확인 실패", "travel-123", "원본 상품 URL", "컨텍스트를 복구", "최신 기준 재검사", "자동 실행되지 않습니다"]) assert.ok(message.includes(text));
  assert.equal(getDraftRecheckError({ code: "OTHER", error: "잠시 후 재시도" }, "123"), "잠시 후 재시도");
});

test("prepared unapproved rows open the saved draft with a matching label and tooltip", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const row = page.split("onClick={() => void handleOpenOrPrepareBrandDraft(link)}")[1].split("</button>")[0];
  assert.match(row, /link.draftPrepared\s*\? "초안 확인·수정"/);
  assert.match(row, /title=\{link.draftPrepared \? "저장된 초안/);
  assert.match(row, /!link.draftPrepared && draftCreationMode === "checking"/);
});

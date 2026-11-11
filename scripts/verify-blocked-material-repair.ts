import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMaterialPreparation, type Call } from "./lib/scheduled-draft-workflow";
import { runMaterialJob } from "../src/lib/material-job-runner";
import { selectMaterialRepairCandidates, hasSavedMaterialDraft } from "../src/lib/material-repair-candidates";
import { getBrandPostPackageDir } from "../src/lib/brand-post-package";
import type { MaterialJob } from "../src/lib/material-job-store";
import type { BrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { selectPreparedRevisionSectionIndexes } from "./lib/prepared-revision-policy";
import { applyFreeformDraftRevision, assertUntargetedSectionHashesUnchanged } from "./lib/freeform-draft-revision";
import { planQualityConvergence } from "./lib/quality-convergence";

const revision = "a".repeat(64);
const readyMaterial = (id: string) => ({ productId: id, revision, title: id, connectKind: "SHOPPING" as const,
  ready: true, blockers: [] as string[], score: 100, imageCount: 4, createdAt: "", approvedAt: "approved" });
function job(count = 1): MaterialJob {
  return { jobId: crypto.randomUUID(), kind: "repair", status: "running", ownerPid: process.pid,
    startedAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
    items: Array.from({ length: count }, (_, index) => ({ productId: `product_${String(index).padStart(4, "0")}`, status: "queued", stage: "대기" })) };
}
const products = Array.from({ length: 3 }, (_, index) => ({ id: `product_${String(index).padStart(4, "0")}`, productName: `상품 ${index}`,
  status: "READY", connectKind: index === 1 ? "TRAVEL" : "SHOPPING" }));
const plannedDate = new Date("2026-10-12T00:00:00.000Z");
const plannedProducts = products.map((product, index) => ({ ...product, status: index === 1 ? "FAILED" : "READY", scheduledPublishAt: plannedDate }));
const candidateDeps = { material: (id: string) => ({ ...readyMaterial(id), ready: false, blockers: ["최종 승인 필요"] }),
  savedDraft: () => true, publicationAttempt: () => null };

async function main() {
  let checks = 0;
  assert.equal(selectMaterialRepairCandidates(products, [], candidateDeps).length, 3); checks++;
  assert.equal(selectMaterialRepairCandidates(products, [], candidateDeps, "SHOPPING").length, 2); checks++;
  const plannedBefore = JSON.stringify(plannedProducts);
  assert.equal(selectMaterialRepairCandidates(plannedProducts, [], candidateDeps).length, 3,
    "a plan date on an unpublished READY/FAILED saved draft is not a Naver reservation"); checks++;
  assert.equal(selectMaterialRepairCandidates(plannedProducts, [], candidateDeps, "SHOPPING").length, 2); checks++;
  assert.equal(JSON.stringify(plannedProducts), plannedBefore, "candidate selection preserves planned dates and product data"); checks++;
  assert.ok(plannedProducts.every(product => product.scheduledPublishAt === plannedDate)); checks++;
  assert.equal(selectMaterialRepairCandidates(products, [], { ...candidateDeps, material: readyMaterial }).length, 0); checks++;
  for (const material of [null, { ready: false, revision, blockers: [] }, { ready: false, revision: "invalid", blockers: ["실패"] },
    { ready: false, revision, blockers: ["실패"], imageGeneration: { status: "running" } },
    { ready: false, revision, blockers: ["실패"], imageGeneration: { status: "failed", recoveryState: "owner-unknown" } }]) {
    for (const input of [products, plannedProducts]) {
      assert.equal(selectMaterialRepairCandidates(input, [], { ...candidateDeps, material: () => material }).length, 0); checks++;
    }
  }
  assert.equal(selectMaterialRepairCandidates(products, [], { ...candidateDeps, savedDraft: () => false }).length, 0); checks++;
  assert.equal(selectMaterialRepairCandidates(products, [], { ...candidateDeps, material: () => { throw new Error("corrupt draft"); } }).length, 0); checks++;
  for (const status of ["PUBLISHED", "SCHEDULED", "PUBLISHING", "DRAFTING", "OUTCOME_UNKNOWN"]) {
    for (const input of [products, plannedProducts]) {
      assert.equal(selectMaterialRepairCandidates(input.map(product => ({ ...product, status })), [], candidateDeps).length, 0); checks++;
    }
  }
  for (const evidence of [{ postUrl: "https://blog.naver.com/x/1" }, { publishedAt: "confirmed" }]) {
    for (const input of [products, plannedProducts]) {
      assert.equal(selectMaterialRepairCandidates(input.map(product => ({ ...product, ...evidence })), [], candidateDeps).length, 0); checks++;
    }
  }
  for (const stage of ["PREPARING", "SUBMITTING", "CONFIRMED", "OUTCOME_UNKNOWN"]) {
    for (const input of [products, plannedProducts]) {
      assert.equal(selectMaterialRepairCandidates(input, [], { ...candidateDeps, publicationAttempt: () => ({ stage }) }).length, 0); checks++;
    }
  }
  assert.equal(selectMaterialRepairCandidates(products, [], { ...candidateDeps, publicationAttempt: () => ({ stage: "FAILED_BEFORE_SUBMIT" }) }).length, 3); checks++;
  assert.equal(selectMaterialRepairCandidates(plannedProducts, [], { ...candidateDeps, publicationAttempt: () => ({ stage: "FAILED_BEFORE_SUBMIT" }) }).length, 3); checks++;
  for (const proof of [{ submittedAt: "2026-10-07T00:00:00.000Z" }, { confirmedAt: "2026-10-07T00:00:01.000Z" },
    { submittedAt: "" }, { confirmedAt: "" }, { evidence: { postUrl: "https://blog.naver.com/x/1" } },
    { evidence: { reservationId: "reservation_1" } }, { evidence: { scheduledDate: "2026-10-12" } },
    { evidence: { reservationId: "" } }]) {
    for (const input of [products, plannedProducts]) {
      assert.equal(selectMaterialRepairCandidates(input, [], { ...candidateDeps,
        publicationAttempt: () => ({ stage: "FAILED_BEFORE_SUBMIT", ...proof }) }).length, 0,
      "a pre-submit failure label cannot override conflicting submission/confirmation/reservation evidence"); checks++;
    }
  }
  assert.equal(selectMaterialRepairCandidates(plannedProducts, [], { ...candidateDeps,
    publicationAttempt: () => ({ stage: "FAILED_BEFORE_SUBMIT", evidence: {} }) }).length, 3,
  "an empty legacy evidence container carries no submission marker"); checks++;
  assert.equal(selectMaterialRepairCandidates(products, [], { ...candidateDeps, publicationAttempt: () => { throw new Error("receipt unreadable"); } }).length, 0); checks++;
  for (const code of ["PREPARATION_RESULT_UNCERTAIN", "AGENT_LOST_UNCERTAIN", "OUTCOME_UNKNOWN", "APP_INTERRUPTED", "WORKFLOW_TIMEOUT"]) {
    const history = job(3); history.status = "failed"; history.items.forEach(item => { item.status = "failed"; item.errorCode = code; });
    for (const input of [products, plannedProducts]) {
      assert.equal(selectMaterialRepairCandidates(input, [history], candidateDeps).length, 0); checks++;
    }
  }
  for (const status of ["queued", "preparing", "publishing", "outcome_unknown"] as const) {
    const active = job(3); active.items.forEach(item => { item.status = status; });
    assert.equal(selectMaterialRepairCandidates(plannedProducts, [active], candidateDeps).length, 0,
      "a planned date must not bypass an active or uncertain material job"); checks++;
  }
  const uncertainPublication = job(3); uncertainPublication.kind = "publish"; uncertainPublication.items.forEach(item => { item.status = "failed"; item.errorCode = "AGENT_LOST_UNCERTAIN"; });
  const recentRepair = job(3); recentRepair.startedAt = "2026-10-08T01:00:00.000Z"; recentRepair.items.forEach(item => item.status = "failed");
  assert.equal(selectMaterialRepairCandidates(products, [uncertainPublication, recentRepair], candidateDeps).length, 0); checks++;
  uncertainPublication.items.forEach(item => item.errorCode = "PUBLISH_FAILED");
  assert.equal(selectMaterialRepairCandidates(products, [uncertainPublication, recentRepair], candidateDeps).length, 3); checks++;
  for (const status of ["scheduled", "published", "outcome_unknown", "publishing", "queued", "interrupted"] as const) {
    const olderUnsafe = job(3); olderUnsafe.kind = "publish"; olderUnsafe.startedAt = "2026-10-07T00:00:00.000Z";
    olderUnsafe.items.forEach(item => { item.status = status; });
    for (const history of [[olderUnsafe, uncertainPublication, recentRepair], [recentRepair, uncertainPublication, olderUnsafe]]) {
      assert.equal(selectMaterialRepairCandidates(plannedProducts, history,
        { ...candidateDeps, publicationAttempt: () => ({ stage: "FAILED_BEFORE_SUBMIT" }) }).length, 0,
      "a newer failed publication cannot clear an older actual/uncertain reservation, regardless of input order"); checks++;
    }
  }
  for (const unsafe of [{ errorCode: "AGENT_LOST_UNCERTAIN" }, { errorCode: "PUBLISH_FAILED", causeCode: "OUTCOME_UNKNOWN" }, { errorCode: "UNCLASSIFIED_FAILURE" }]) {
    const olderUnsafe = job(3); olderUnsafe.kind = "publish"; olderUnsafe.startedAt = "2026-10-07T00:00:00.000Z";
    olderUnsafe.items.forEach(item => { item.status = "failed"; Object.assign(item, unsafe); });
    assert.equal(selectMaterialRepairCandidates(plannedProducts, [recentRepair, uncertainPublication, olderUnsafe], candidateDeps).length, 0,
      "an older non-definitive failed submission remains unsafe after a newer definitive failure"); checks++;
  }
  const olderSafe = job(3); olderSafe.kind = "publish"; olderSafe.startedAt = "2026-10-07T00:00:00.000Z";
  olderSafe.items.forEach(item => { item.status = "failed"; item.errorCode = "MATERIAL_NOT_READY"; });
  for (const history of [[olderSafe, uncertainPublication, recentRepair], [recentRepair, uncertainPublication, olderSafe]]) {
    assert.equal(selectMaterialRepairCandidates(plannedProducts, history,
      { ...candidateDeps, publicationAttempt: () => ({ stage: "FAILED_BEFORE_SUBMIT" }) }).length, 3,
    "plans whose entire publication history failed definitively before submission remain repairable"); checks++;
  }

  for (const mode of ["approval", "images", "text", "late-text"] as const) {
    let approved = false; let filled = mode !== "images" && mode !== "late-text"; let revised = false; let snapshots = 0;
    const actions: string[] = [];
    const originalManuscript = "통과한 기존 본문\n저장 근거에 맞는 판단 문장";
    let manuscript = originalManuscript;
    const textFails = () => !revised && (mode === "text" || (mode === "late-text" && filled));
    const data = () => ({ approvedAt: approved ? "approved" : null, approval: { canApprove: approved },
      imageSlots: [{ missing: filled ? 0 : 1, generationMissing: filled ? 0 : 1 }],
      contentQuality: { signals: [{ key: "review-substance", status: textFails() ? "fail" : "pass" }] } });
    const call: Call = async (url, method, body) => {
      const action = (body as { action?: string; instructions?: string } | undefined)?.action || method;
      if (method !== "GET") assert.equal(snapshots, 1, "even first metadata recheck needs a snapshot");
      assert.ok(!url.endsWith("/publish"));
      assert.ok(!(url.endsWith("/draft") && method === "POST"), "incremental repairs cannot full-write a manuscript");
      actions.push(action);
      if (url.endsWith("/images")) { assert.equal(action, "generate_missing"); filled = true; }
      if (action === "revise") {
        assert.equal((body as { incrementalOnly?: boolean }).incrementalOnly, true, "incremental boundary reaches the draft route");
        assert.match((body as { instructions: string }).instructions, /이미 통과한 문단 역할과 이미지 의미는 유지/u);
        revised = true;
        manuscript += "\n실패 항목에 대한 근거 보강";
      }
      if (action === "approve") approved = true;
      return { success: true, data: data() };
    };
    await runMaterialPreparation(`product_${mode}`, { call, pause: async () => {} }, { incrementalOnly: true, beforeRepair: async () => { snapshots++; } });
    assert.equal(snapshots, 1); assert.equal(approved, true);
    assert.equal(actions.filter(action => action === "revise").length, mode === "text" || mode === "late-text" ? 1 : 0);
    assert.equal(actions.filter(action => action === "generate_missing").length, mode === "images" || mode === "late-text" ? 1 : 0); checks += 4;
    if (mode === "approval" || mode === "images") { assert.equal(manuscript, originalManuscript, "image/approval-only repairs leave the manuscript bytes unchanged"); checks++; }
  }

  let severeApproved = false; let severeRevised = false; let severeSnapshots = 0; let severeFullWrites = 0;
  const severeQuality = () => ({ canPublish: severeRevised, verdict: severeRevised ? "pass" : "quality", code: severeRevised ? "ok" : "quality-score-below-threshold",
    score: severeRevised ? 100 : 20, blockers: [], signals: [],
    qualityFailures: severeRevised ? [] : [{ key: "usefulness", status: "fail", label: "구매 판단", notes: ["대상 보강"], score: 0, maxScore: 10 }],
    quality: { score: severeRevised ? 100 : 20, passScore: 70, sourceEvidence: { level: "rich", sufficient: true },
      categories: [{ key: "usefulness", status: severeRevised ? "pass" : "fail", label: "구매 판단", notes: [], score: severeRevised ? 10 : 0, maxScore: 10 }] } });
  await runMaterialPreparation("product_severe", { pause: async () => {}, call: async (url, method, body) => {
    const action = (body as { action?: string } | undefined)?.action;
    if (url.endsWith("/draft") && method === "POST" && !action) severeFullWrites++;
    if (action === "revise") severeRevised = true;
    if (action === "approve") severeApproved = true;
    return { success: true, data: { approvedAt: severeApproved ? "approved" : null, approval: { canApprove: severeApproved }, imageSlots: [], contentQuality: severeQuality() } };
  } }, { incrementalOnly: true, beforeRepair: async () => { severeSnapshots++; } });
  assert.equal(severeFullWrites, 0); assert.equal(severeRevised, true); assert.equal(severeSnapshots, 1); checks += 3;

  const measuredQuality = {
    canPublish: false, verdict: "quality", code: "quality-score-below-threshold", score: 30, blockers: [], signals: [],
    qualityFailures: [], quality: { score: 30, passScore: 70, sourceEvidence: { level: "rich", sufficient: true },
      repetition: { samples: [], duplicateOpeningCount: 0 }, categories: [
        { key: "clarity", status: "fail", label: "명확한 표현", notes: ["상세페이지 확인 안내 과다"], score: 0, maxScore: 10 },
        { key: "usefulness", status: "fail", label: "추천 근거", notes: ["추천 대상 근거 부족"], score: 0, maxScore: 10 },
        { key: "productEvidence", status: "pass", label: "확인 근거", notes: [], score: 10, maxScore: 10 },
      ] },
  } as unknown as BrandLinkContentReadiness;
  const originalSections = ["확인한 용량\n\n저장 상세의 500 ml 용량을 반영한 정상 문단입니다.",
    "추천 대상\n\n상세 페이지를 확인하세요. 구매 대상을 확인하고 추천해요. 옵션을 확인하세요.",
    "구성품\n\n본품 한 개와 설명서가 포함됩니다.", "커넥트 고지\n\n판매 발생 시 수수료를 받습니다."];
  const linkedPlan = planQualityConvergence({ current: measuredQuality, attempt: 0, maximumAttempts: 3 });
  const policyInput = { current: measuredQuality, sections: originalSections, plan: linkedPlan, requestedIndexes: [], qualityConvergence: true };
  const incrementalTargets = selectPreparedRevisionSectionIndexes({ ...policyInput, incrementalOnly: true });
  assert.deepEqual(incrementalTargets, [1], "severe global scores do not expand a failure-linked paragraph to every body paragraph");
  assert.deepEqual(selectPreparedRevisionSectionIndexes({ ...policyInput, incrementalOnly: false }), [0, 1, 2], "ordinary/rewrite convergence retains its previous severe fallback");
  const repairedText = applyFreeformDraftRevision({ title: "저장 제목", sections: originalSections }, JSON.stringify({ updates: [{ index: 1, body: "500 ml 용량이 필요한 사용 조건에 맞춰 선택 판단을 보강합니다." }] }), incrementalTargets);
  assertUntargetedSectionHashesUnchanged(originalSections, repairedText.sections, incrementalTargets);
  assert.equal(repairedText.sections[0], originalSections[0]); assert.equal(repairedText.sections[2], originalSections[2]); assert.equal(repairedText.sections[3], originalSections[3]);
  assert.throws(() => applyFreeformDraftRevision({ title: "저장 제목", sections: originalSections }, JSON.stringify({ updates: [{ index: 0, body: "허용되지 않은 정상 문단 교체" }] }), incrementalTargets), /식별자/u);
  const contaminated = [...repairedText.sections]; contaminated[2] += "정상 문단 무단 변경";
  assert.throws(() => assertUntargetedSectionHashesUnchanged(originalSections, contaminated, incrementalTargets), /수정 대상이 아닌/u); checks += 7;

  const unmappedQuality = { ...measuredQuality, code: "too-short-content", blockers: [{ code: "too-short-content", tier: "structure", reason: "전체 분량 부족" }],
    qualityFailures: [], quality: { ...measuredQuality.quality, categories: measuredQuality.quality.categories.map(category => ({ ...category, key: `unmapped-${category.key}` })) } } as unknown as BrandLinkContentReadiness;
  const unmappedPlan = planQualityConvergence({ current: unmappedQuality, attempt: 0, maximumAttempts: 3 });
  assert.deepEqual(selectPreparedRevisionSectionIndexes({ ...policyInput, current: unmappedQuality, plan: unmappedPlan, incrementalOnly: true }), [], "unmapped/global failure cannot guess the shortest paragraph or expand all indexes");
  assert.deepEqual(selectPreparedRevisionSectionIndexes({ ...policyInput, current: unmappedQuality, plan: unmappedPlan, requestedIndexes: [0, 1, 2], incrementalOnly: true }), [], "explicit all-index input cannot bypass failure linking");
  assert.deepEqual(selectPreparedRevisionSectionIndexes({ ...policyInput, requestedIndexes: [0], incrementalOnly: true }), [], "a requested healthy paragraph cannot bypass evidence scope"); checks += 3;

  const sourceText = fs.readFileSync("scripts/simple-agent.ts", "utf8");
  const draftRouteText = fs.readFileSync("src/app/api/brandlinks/[id]/draft/route.ts", "utf8");
  assert.match(sourceText, /const allowedIndexes = selectPreparedRevisionSectionIndexes\([\s\S]{0,220}incrementalOnly/u, "actual writer uses the tested policy");
  assert.match(sourceText, /if \(incrementalOnly\) assertUntargetedSectionHashesUnchanged\(prepared\.post\.sections, selected\.sections/u, "writer checks original untouched paragraphs before committing");
  assert.match(draftRouteText, /JSON\.stringify\(\{ instructions, sectionIndexes, qualityConvergence, incrementalOnly/u, "route persists the incremental policy in the actual revision request");
  assert.match(draftRouteText, /body\.qualityConvergence === true, body\.incrementalOnly === true/u, "route forwards the policy to its child process"); checks += 4;

  let sourceRefreshed = false; let sourceRevised = false; let sourceApproved = false; let sourceSnapshots = 0; let sourceFullWrites = 0;
  await runMaterialPreparation("product_source", { pause: async () => {}, call: async (url, method, body) => {
    const action = (body as { action?: string } | undefined)?.action;
    if (method !== "GET") assert.equal(sourceSnapshots, 1);
    if (url.endsWith("/draft") && method === "POST" && !action) sourceFullWrites++;
    if (action === "prepare_context") sourceRefreshed = true;
    if (action === "revise") sourceRevised = true;
    if (action === "approve") sourceApproved = true;
    const category = { key: "productEvidence", status: sourceRevised ? "pass" : "fail", label: "상품 고유 근거", notes: ["근거 보강"], score: sourceRevised ? 10 : 0, maxScore: 10 };
    return { success: true, data: { approvedAt: sourceApproved ? "approved" : null, approval: { canApprove: sourceApproved }, imageSlots: [], contentQuality: {
      canPublish: sourceRevised, verdict: sourceRevised ? "pass" : "quality", code: sourceRevised ? "ok" : "quality-score-below-threshold", score: sourceRevised ? 100 : sourceRefreshed ? 40 : 20,
      blockers: [], signals: [], qualityFailures: sourceRevised ? [] : [category], quality: { score: sourceRevised ? 100 : sourceRefreshed ? 40 : 20, passScore: 70, categories: [category],
        sourceEvidence: { level: sourceRefreshed ? "rich" : "sparse", sufficient: sourceRefreshed } } } } };
  } }, { incrementalOnly: true, beforeRepair: async () => { sourceSnapshots++; } });
  assert.equal(sourceRefreshed, true); assert.equal(sourceRevised, true); assert.equal(sourceFullWrites, 0); assert.equal(sourceSnapshots, 1); checks += 4;

  let missingMutations = 0;
  await assert.rejects(runMaterialPreparation("product_missing", { pause: async () => {}, call: async (_url, method) => {
    if (method !== "GET") missingMutations++; return { success: true, data: null };
  } }, { incrementalOnly: true, beforeRepair: async () => {} }), (error: unknown) => (error as { code?: string }).code === "DRAFT_REQUIRED");
  assert.equal(missingMutations, 0); checks++;
  let backupFailureMutations = 0;
  await assert.rejects(runMaterialPreparation("product_backup", { pause: async () => {}, call: async (_url, method) => {
    if (method !== "GET") backupFailureMutations++; return { success: true, data: { approvedAt: null, imageSlots: [] } };
  } }, { incrementalOnly: true, beforeRepair: async () => { throw Object.assign(new Error("snapshot failed"), { code: "MATERIAL_REPAIR_BACKUP_FAILED" }); } }),
  (error: unknown) => (error as { code?: string }).code === "MATERIAL_REPAIR_BACKUP_FAILED");
  assert.equal(backupFailureMutations, 0); checks++;

  const repaired = job(); let ready = false; let snapshots = 0; let mutations = 0;
  const runnerCall: Call = async (url, method, body) => {
    assert.ok(!url.endsWith("/publish"));
    if (method !== "GET") { mutations++; assert.equal(snapshots, 1); }
    if ((body as { action?: string } | undefined)?.action === "approve") ready = true;
    return { success: true, data: { approvedAt: ready ? "approved" : null, approval: { canApprove: ready }, imageSlots: [], contentQuality: { signals: [] } } };
  };
  let rechecks = 0;
  await runMaterialJob(repaired, { call: runnerCall, material: id => ({ ...readyMaterial(id), ready, approvedAt: ready ? "approved" : null, blockers: ready ? [] : ["승인 필요"] }),
    save: () => {}, pause: async () => {}, checkCancelled: () => {},
    validateRepair: async id => {
      rechecks++;
      return selectMaterialRepairCandidates(plannedProducts, [], candidateDeps).some(candidate => candidate.productId === id);
    }, backup: () => { snapshots++; return "fixture-snapshot"; } });
  assert.equal(repaired.status, "completed"); assert.equal(repaired.items[0].verificationStatus, "READY"); assert.equal(snapshots, 1); checks += 3;
  assert.equal(rechecks, 2, "planned drafts pass both runner admission and the immediate pre-repair guard"); checks++;
  assert.equal(JSON.stringify(plannedProducts), plannedBefore, "repair validation/approval never clears or rewrites planned dates"); checks++;
  const stale = job(); let staleCalls = 0;
  await runMaterialJob(stale, { call: async () => { staleCalls++; return { success: true }; }, material: readyMaterial,
    save: () => {}, pause: async () => {}, checkCancelled: () => {}, validateRepair: async () => false, backup: () => "unused" });
  assert.equal(staleCalls, 0); assert.equal(stale.items[0].errorCode, "MATERIAL_REPAIR_SELECTION_CHANGED"); checks += 2;
  const snapshotMissing = job(); let snapshotMutations = 0;
  await runMaterialJob(snapshotMissing, { call: async (_url, method) => { if (method !== "GET") snapshotMutations++; return { success: true, data: { approvedAt: null, imageSlots: [] } }; },
    material: id => ({ ...readyMaterial(id), ready: false, blockers: ["승인 필요"] }), save: () => {}, pause: async () => {}, checkCancelled: () => {}, validateRepair: async () => true, backup: () => null });
  assert.equal(snapshotMutations, 0); assert.equal(snapshotMissing.items[0].errorCode, "MATERIAL_REPAIR_BACKUP_FAILED"); checks += 2;
  for (const code of ["LLM_UNAVAILABLE", "CODEX_LOGIN_REQUIRED", "CHATGPT_BROWSER_AUTH_REQUIRED", "ECONNRESET"]) {
    const stopped = job(3); let failures = 0;
    await runMaterialJob(stopped, { call: async (_url, method) => {
      if (method === "GET") return { success: true, data: { approvedAt: null, imageSlots: [] } };
      failures++; throw Object.assign(new Error("fixture shared failure"), { code });
    }, material: id => ({ ...readyMaterial(id), ready: false, blockers: ["준비 필요"] }), save: () => {}, pause: async () => {}, checkCancelled: () => {},
      validateRepair: async () => true, backup: () => "snapshot" });
    assert.equal(failures, 1); assert.ok(stopped.items.slice(1).every(item => item.status === "interrupted")); checks += 2;
  }
  const incomplete = job();
  await runMaterialJob(incomplete, { call: async () => ({ success: true, data: { approvedAt: null, approval: { canApprove: false }, imageSlots: [] } }),
    material: id => ({ ...readyMaterial(id), ready: false, blockers: ["검증 지속 실패"] }), save: () => {}, pause: async () => {}, checkCancelled: () => {},
    validateRepair: async () => true, backup: () => "snapshot" });
  assert.equal(incomplete.status, "failed"); assert.equal(incomplete.items[0].verificationStatus, "BLOCKED"); checks += 2;
  const cancelled = job(2); let cancelledCalls = 0;
  await runMaterialJob(cancelled, { call: async () => { cancelledCalls++; return { success: true }; }, material: readyMaterial,
    save: () => {}, pause: async () => {}, checkCancelled: () => { throw Object.assign(new Error("취소 fixture"), { code: "USER_CANCELLED" }); },
    validateRepair: async () => true, backup: () => "snapshot" });
  assert.equal(cancelledCalls, 0); assert.equal(cancelled.items[1].status, "interrupted"); checks += 2;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "material-repair-draft-"));
  const previousDataRoot = process.env.DESKTOP_USER_DATA;
  try {
    process.env.DESKTOP_USER_DATA = temp;
    const productId = "product_saved_test"; const packageDir = getBrandPostPackageDir(productId);
    fs.mkdirSync(packageDir, { recursive: true });
    const markdownPath = path.join(packageDir, "draft.md"); const manifestPath = path.join(packageDir, "manifest.json");
    fs.writeFileSync(markdownPath, "기존 저장 원고"); fs.writeFileSync(manifestPath, JSON.stringify({ version: "brand-post-package/v1", brandLinkId: productId, markdownPath }));
    assert.equal(hasSavedMaterialDraft(productId), true);
    fs.writeFileSync(markdownPath, "  "); assert.equal(hasSavedMaterialDraft(productId), false);
    fs.unlinkSync(markdownPath); assert.equal(hasSavedMaterialDraft(productId), false);
    fs.writeFileSync(manifestPath, "{"); assert.equal(hasSavedMaterialDraft(productId), false);
    assert.equal(hasSavedMaterialDraft("product_no_package"), false); checks += 5;
  } finally {
    if (previousDataRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = previousDataRoot;
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true });
  }
  assert.ok(mutations > 0);
  console.log(`PASS: ${checks} saved material repair selection/incremental preservation/backup/readiness/uncertainty checks; no accounts, paid generation or publication`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

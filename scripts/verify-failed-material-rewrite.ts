import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMaterialPreparation, type Call } from "./lib/scheduled-draft-workflow";
import { runMaterialJob } from "../src/lib/material-job-runner";
import { selectFailedMaterialCandidates } from "../src/lib/material-failed-candidates";
import { backupMaterialBeforeRewrite } from "../src/lib/material-rewrite-backup";
import { getBrandPostPackageDir } from "../src/lib/brand-post-package";
import type { MaterialJob } from "../src/lib/material-job-store";

const revision = "a".repeat(64);
const material = (id: string) => ({ productId: id, revision, title: id, connectKind: "SHOPPING" as const,
  ready: true, blockers: [] as string[], score: 100, imageCount: 4, createdAt: "", approvedAt: "approved" });
function makeJob(count = 1): MaterialJob {
  return { jobId: crypto.randomUUID(), kind: "rewrite", status: "running", ownerPid: process.pid,
    startedAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
    items: Array.from({ length: count }, (_, index) => ({ productId: `product_${String(index).padStart(4, "0")}`,
      status: "queued", stage: "대기", previousError: "원고 실패", previousErrorCode: "CONTENT_BLOCKED", verificationStatus: "BLOCKED" })) };
}

async function main() {
  let checks = 0;
  const job = makeJob(2); job.status = "failed"; job.items.forEach(item => item.status = "failed");
  const products = job.items.map(item => ({ id: item.productId, productName: item.productId, status: "FAILED", connectKind: "SHOPPING" }));
  const deps = { material: () => ({ ready: false, blockers: ["원고 실패"] }), progress: () => null };
  assert.equal(selectFailedMaterialCandidates(products, [job], deps).length, 2); checks++;
  const newer = makeJob(2); newer.startedAt = "2026-10-08T01:00:00.000Z"; newer.items.forEach(item => item.status = "ready");
  assert.equal(selectFailedMaterialCandidates(products, [job, newer], deps).length, 0, "latest success beats old failure even if current material was edited"); checks++;
  const publication = { ...newer, kind: "publish" as const, items: newer.items.map(item => ({ ...item, status: "failed" as const })) };
  assert.equal(selectFailedMaterialCandidates(products, [job, publication], deps).length, 0, "publication failure does not rewrite a manuscript"); checks++;
  for (const status of ["PUBLISHED", "SCHEDULED", "DRAFTING", "PUBLISHING", "OUTCOME_UNKNOWN"]) {
    assert.equal(selectFailedMaterialCandidates(products.map(product => ({ ...product, status })), [job], deps).length, 0); checks++;
  }
  assert.equal(selectFailedMaterialCandidates(products, [job], { ...deps, material: () => ({ ready: true, blockers: [] }) }).length, 0); checks++;
  const directFailure = { stage: "failed", message: "CODEX 원고 작성 실패", updatedAt: "2026-10-08T02:00:00.000Z" };
  assert.equal(selectFailedMaterialCandidates(products, [], { material: () => null, progress: () => directFailure }).length, 2, "direct failed writing with no draft is recoverable"); checks++;
  assert.equal(selectFailedMaterialCandidates(products, [], { material: () => null, progress: () => null }).length, 0, "unknown raw FAILED status is not enough"); checks++;

  const earlierPublication = { ...job, kind: "publish" as const, startedAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:01:00.000Z",
    items: job.items.map(item => ({ ...item, status: "failed" as const, errorCode: "PUBLISH_FAILED" })) };
  const laterWriteProgress = { ...directFailure, updatedAt: "2026-10-08T01:00:00.000Z" };
  const laterWriteDeps = { material: () => null, progress: () => laterWriteProgress };
  assert.equal(selectFailedMaterialCandidates(products, [earlierPublication], laterWriteDeps).length, 2,
    "a confirmed publication failure followed by a newer direct writing failure is recoverable"); checks++;
  assert.equal(selectFailedMaterialCandidates(products, [earlierPublication], { ...laterWriteDeps,
    progress: () => ({ ...laterWriteProgress, updatedAt: "2026-10-08T00:00:00.000Z" }) }).length, 0,
    "older draft failure cannot supersede a publication failure"); checks++;
  assert.equal(selectFailedMaterialCandidates(products, [earlierPublication], { ...laterWriteDeps, progress: () => null }).length, 0,
    "a publication failure alone never selects a manuscript"); checks++;
  const laterPreparation = { ...job, startedAt: "2026-10-08T00:30:00.000Z", updatedAt: "2026-10-08T01:00:00.000Z" };
  assert.equal(selectFailedMaterialCandidates(products, [earlierPublication, laterPreparation], deps).length, 2,
    "newer failed prepare record also supersedes a definitively failed publication"); checks++;
  for (const uncertain of [
    { status: "outcome_unknown" as const, errorCode: "OUTCOME_UNKNOWN" },
    { status: "publishing" as const, errorCode: "PUBLISH_FAILED" },
    { status: "failed" as const, errorCode: "AGENT_LOST_UNCERTAIN" },
    { status: "failed" as const, errorCode: "PUBLISH_FAILED", causeCode: "AGENT_LOST_UNCERTAIN" },
    { status: "failed" as const, errorCode: undefined },
  ]) {
    const unsafe = { ...earlierPublication, items: earlierPublication.items.map(item => ({ ...item, ...uncertain })) };
    assert.equal(selectFailedMaterialCandidates(products, [unsafe], laterWriteDeps).length, 0,
      "recent direct writing failure never clears publication uncertainty");
    assert.equal(selectFailedMaterialCandidates(products, [unsafe, laterPreparation], { ...deps, progress: () => laterWriteProgress }).length, 0,
      "recent prepare history never hides older unresolved publication uncertainty"); checks += 2;
  }

  for (const mode of ["text", "images", "missing"] as const) {
    const actions: string[] = []; let written = false; let filled = mode !== "images"; let approved = false; let backed = false;
    const data = () => ({ approvedAt: approved ? "approved" : null, approval: { canApprove: approved },
      imageSlots: [{ missing: filled ? 0 : 1, generationMissing: filled ? 0 : 1 }],
      contentQuality: { signals: [{ key: "review-substance", status: mode === "text" && !written ? "fail" : "pass" }] } });
    const call: Call = async (url, method, body) => {
      assert.ok(!url.endsWith("/publish"), "recovery never publishes");
      const action = (body as { action?: string } | undefined)?.action || method;
      actions.push(`${method} ${action}`);
      if (url.endsWith("/draft") && method === "GET" && mode === "missing" && !written) return { success: true, data: null };
      if (url.endsWith("/draft") && method === "POST" && action === "POST") { assert.equal(backed, true); written = true; }
      if (url.endsWith("/images")) filled = true;
      if (action === "approve") approved = true;
      return { success: true, data: data() };
    };
    await runMaterialPreparation(`product_${mode}`, { call, pause: async () => {} }, { rewriteFailed: true, beforeRewrite: async () => { backed = true; } });
    assert.equal(actions.filter(action => action === "POST POST").length, mode === "images" ? 0 : 1);
    assert.equal(actions.includes("POST prepare_context"), mode !== "images");
    assert.equal(approved, true); checks += 3;
  }

  for (const mode of ["after-images", "after-full-rewrite"] as const) {
    let filled = mode === "after-full-rewrite"; let repaired = false; let approved = false;
    let backups = 0; let fullWrites = 0; let patchWrites = 0;
    const data = () => ({ approvedAt: approved ? "approved" : null, approval: { canApprove: approved },
      imageSlots: [{ missing: filled ? 0 : 1, generationMissing: filled ? 0 : 1 }],
      contentQuality: { signals: [{ key: "review-substance", status: filled && !repaired ? "fail" : "pass" }] } });
    const call: Call = async (url, method, body) => {
      const action = (body as { action?: string } | undefined)?.action;
      if (url.endsWith("/images")) filled = true;
      if (url.endsWith("/draft") && method === "POST" && !action) { assert.equal(backups, 1, "full rewrite cannot precede a snapshot"); fullWrites++; }
      if (action === "revise") { assert.equal(backups, 1, "late PATCH revise cannot precede a snapshot"); patchWrites++; repaired = true; }
      if (action === "approve") approved = true;
      assert.ok(!url.endsWith("/publish"));
      return { success: true, data: data() };
    };
    await runMaterialPreparation(`product_${mode}`, { call, pause: async () => {} }, { rewriteFailed: true,
      beforeRewrite: async () => { backups++; assert.equal(backups, 1, "snapshot callback runs once across POST and PATCH"); } });
    assert.equal(backups, 1); assert.equal(patchWrites, 1); assert.equal(fullWrites, mode === "after-full-rewrite" ? 1 : 0);
    assert.equal(approved, true); checks += 4;
  }

  let failedSnapshotTextWrites = 0; let failedSnapshotApprovals = 0; let failedSnapshotImages = false;
  await assert.rejects(runMaterialPreparation("product_backup_failure", { pause: async () => {}, call: async (url, method, body) => {
    const action = (body as { action?: string } | undefined)?.action;
    if (url.endsWith("/images")) failedSnapshotImages = true;
    if (action === "revise" || (url.endsWith("/draft") && method === "POST" && !action)) failedSnapshotTextWrites++;
    if (action === "approve") failedSnapshotApprovals++;
    return { success: true, data: { approvedAt: null, imageSlots: [{ missing: failedSnapshotImages ? 0 : 1, generationMissing: failedSnapshotImages ? 0 : 1 }],
      contentQuality: { signals: [{ key: "review-substance", status: failedSnapshotImages ? "fail" : "pass" }] } } };
  } }, { rewriteFailed: true, beforeRewrite: async () => { throw Object.assign(new Error("백업 저장 실패"), { code: "REWRITE_BACKUP_FAILED" }); } }),
  (error: unknown) => (error as { code?: string }).code === "REWRITE_BACKUP_FAILED");
  assert.equal(failedSnapshotTextWrites, 0); assert.equal(failedSnapshotApprovals, 0); checks += 2;

  const saved: MaterialJob[] = [];
  const readyCall: Call = async (url) => {
    assert.ok(!url.endsWith("/publish"));
    return { success: true, data: { approvedAt: "approved", approval: { canApprove: true }, imageSlots: [], contentQuality: { signals: [] } } };
  };
  const recovered = makeJob(2);
  await runMaterialJob(recovered, { call: async (url, method, body) => {
    if (url.includes("product_0000/")) throw Object.assign(new Error("근거 부족 지속"), { code: "SOURCE_EVIDENCE_REQUIRED" });
    return readyCall(url, method, body);
  }, material, save: current => { saved.push(JSON.parse(JSON.stringify(current))); }, pause: async () => {}, checkCancelled: () => {},
    validateFailed: async () => true, backup: () => null });
  assert.equal(recovered.status, "partial"); assert.equal(recovered.items[0].status, "failed"); assert.equal(recovered.items[1].verificationStatus, "READY"); checks += 3;
  for (const code of ["CHATGPT_BROWSER_AUTH_REQUIRED", "CODEX_LOGIN_REQUIRED", "LLM_UNAVAILABLE", "ECONNRESET"]) {
    let mutations = 0;
    const stopped = makeJob(3);
    await runMaterialJob(stopped, { call: async (_url, method) => {
      if (code === "ECONNRESET" && method === "GET") return { success: true, data: null };
      mutations++; throw Object.assign(new Error("중단 fixture"), { code });
    }, material, save: () => {}, pause: async () => {}, checkCancelled: () => {}, validateFailed: async () => true, backup: () => null });
    assert.equal(mutations, 1, "shared failure/uncertain mutation stops subsequent products");
    assert.ok(stopped.items.slice(1).every(item => item.status === "interrupted")); checks += 2;
  }
  let called = 0;
  const changed = makeJob();
  await runMaterialJob(changed, { call: async () => { called++; return { success: true }; }, material,
    save: () => {}, pause: async () => {}, checkCancelled: () => {}, validateFailed: async () => false, backup: () => null });
  assert.equal(called, 0); assert.equal(changed.items[0].errorCode, "FAILED_MATERIAL_SELECTION_CHANGED"); checks += 2;

  const cancelled = makeJob(2);
  await runMaterialJob(cancelled, { call: readyCall, material, save: () => {}, pause: async () => {},
    checkCancelled: () => { throw Object.assign(new Error("사용자 취소"), { code: "USER_CANCELLED" }); },
    validateFailed: async () => true, backup: () => null });
  assert.equal(cancelled.items[0].errorCode, "USER_CANCELLED"); assert.equal(cancelled.items[1].status, "interrupted"); checks += 2;

  const blocked = makeJob(); let attemptedPublication = false;
  await runMaterialJob(blocked, { call: async (url, _method, body) => {
    if (url.endsWith("/publish")) attemptedPublication = true;
    if ((body as { action?: string } | undefined)?.action === "approve") throw Object.assign(new Error("최종 원고 승인 거절"), { code: "CONTENT_BLOCKED" });
    return { success: true, data: { approvedAt: null, imageSlots: [], contentQuality: { signals: [] } } };
  }, material: id => ({ ...material(id), ready: false, approvedAt: null, blockers: ["최종 승인 거절"] }),
    save: () => {}, pause: async () => {}, checkCancelled: () => {}, validateFailed: async () => true, backup: () => null });
  assert.equal(blocked.status, "failed"); assert.equal(blocked.items[0].verificationStatus, "BLOCKED");
  assert.equal(blocked.items[0].errorCode, "CONTENT_BLOCKED"); assert.equal(attemptedPublication, false); checks += 4;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "material-rewrite-backup-"));
  const before = process.env.DESKTOP_USER_DATA;
  try {
    process.env.DESKTOP_USER_DATA = temp;
    const source = getBrandPostPackageDir("product_backup"); fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "draft.md"), "기존 원고"); fs.writeFileSync(path.join(source, "image.png"), Buffer.from([1, 2, 3]));
    const backed = backupMaterialBeforeRewrite("product_backup", crypto.randomUUID())!;
    fs.writeFileSync(path.join(source, "draft.md"), "새 원고");
    assert.equal(fs.readFileSync(path.join(backed, "draft.md"), "utf8"), "기존 원고");
    assert.deepEqual(fs.readFileSync(path.join(backed, "image.png")), Buffer.from([1, 2, 3])); checks += 2;
  } finally {
    if (before === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = before;
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`PASS: ${checks} failed material selection/rewrite/verification/snapshot checks; no account, generation or publication`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

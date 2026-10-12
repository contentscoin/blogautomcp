import { materialJobErrorMessage, materialJobFailureCodes, readMaterialFailureObservationsForProduct, readMaterialFailureScopeForProduct, type MaterialJob, saveMaterialJob } from "./material-job-store";
import { formatMaterialFailureReference, materialFailurePhase, normalizeMaterialApprovalConflict, normalizeMaterialFailureObservations, type MaterialFailureObservation, type MaterialFailurePhase } from "../../scripts/lib/material-failure-reference";
import { getMaterial } from "./material-library";
import { runMaterialPreparation, runAutomaticDraftWorkflow, localScheduleCall, isUncertainLocalTransportError, isSessionWidePreparationFailureCode, type Call } from "../../scripts/lib/scheduled-draft-workflow";
import { automaticPublishingCancellationCheck } from "./desktop-activity";
import { listFailedMaterialCandidates } from "./material-failed-candidates";
import { backupMaterialBeforeRewrite } from "./material-rewrite-backup";
import { prisma } from "./db";
import { listMaterialRepairCandidates } from "./material-repair-candidates";

async function canStillRewriteProduct(id: string): Promise<boolean> {
  const product = await prisma.brandLink.findUnique({ where: { id }, select: { status: true, postUrl: true, publishedAt: true, scheduledPublishAt: true } });
  if (!product || !["READY", "FAILED"].includes(product.status) || product.postUrl || product.publishedAt || product.scheduledPublishAt) return false;
  const material = getMaterial(id);
  return !material?.ready && material?.imageGeneration?.status !== "running" && material?.imageGeneration?.recoveryState !== "owner-unknown";
}

export async function runMaterialJob(job: MaterialJob, deps: {
  call: Call; material: typeof getMaterial; save: typeof saveMaterialJob; pause: () => Promise<void>; checkCancelled: () => void;
  validateFailed?: (id: string, job: MaterialJob) => Promise<boolean>;
  validateRepair?: (id: string, job: MaterialJob) => Promise<boolean>;
  backup?: (id: string, jobId: string) => string | null;
  failureHistory?: (id: string) => MaterialFailureObservation[];
} = {
  call: localScheduleCall as Call,
  material: getMaterial,
  save: saveMaterialJob,
  pause: () => new Promise<void>(resolve => setTimeout(resolve, 3000)),
  checkCancelled: automaticPublishingCancellationCheck(),
}) {
  let stopped = false;
  let stoppedFailureCodes: { errorCode?: string; causeCode?: string } = {};
  for (const item of job.items) {
    if (stopped) {
      item.status = "interrupted"; item.stage = "앞선 작업 결과 확인 필요";
      Object.assign(item, stoppedFailureCodes);
      deps.save(job); continue;
    }
    let submissionRequested = false;
    let failurePhase: MaterialFailurePhase = "planning";
    let protectedAssetShas: string[] = [];
    let latestSectionIds: string[] = [];
    let previousObservations = normalizeMaterialFailureObservations(item.failureObservations).filter(entry => entry.productId === item.productId);
    let failureReference = "";
    try {
      previousObservations = normalizeMaterialFailureObservations([
        ...(deps.failureHistory || readMaterialFailureObservationsForProduct)(item.productId), ...previousObservations,
      ]).filter(entry => entry.productId === item.productId);
      failureReference = formatMaterialFailureReference(previousObservations, {
        ...readMaterialFailureScopeForProduct(item.productId), productId: item.productId, revision: deps.material(item.productId)?.revision,
      });
    } catch { /* Failure history is diagnostic; it never breaks current work. */ }
    try {
      deps.checkCancelled();
      if (job.kind === "rewrite") {
        const eligible = await (deps.validateFailed || (async (id, currentJob) =>
          (await listFailedMaterialCandidates(currentJob.connectKind, currentJob.jobId)).some(candidate => candidate.productId === id)))(item.productId, job);
        if (!eligible) throw Object.assign(new Error("실행 전에 소재 상태가 변경되어 재작성하지 않았습니다. 최신 실패 목록을 확인하세요."), { code: "FAILED_MATERIAL_SELECTION_CHANGED" });
      }
      if (job.kind === "repair") {
        const eligible = await (deps.validateRepair || (async (id, currentJob) =>
          (await listMaterialRepairCandidates(currentJob.connectKind, currentJob.jobId)).some(candidate => candidate.productId === id)))(item.productId, job);
        if (!eligible) throw Object.assign(new Error("실행 전에 소재 상태가 변경되어 보완하지 않았습니다. 최신 보완 목록을 확인하세요."), { code: "MATERIAL_REPAIR_SELECTION_CHANGED" });
      }
      item.status = job.kind === "publish" ? "publishing" : "preparing";
      deps.save(job);
      const workflow = {
        pause: deps.pause,
        call: async (url: string, method: string, body?: object) => {
          deps.checkCancelled();
          if (method !== "GET" || url.endsWith("/verify")) {
            failurePhase = materialFailurePhase(url, method, (body as { action?: string } | undefined)?.action);
          }
          if (job.kind === "repair" && method === "POST" && url.endsWith("/draft") &&
              (body as { action?: string } | undefined)?.action !== "prepare_context") {
            throw Object.assign(new Error("소재 보완에서는 기존 원고 전체를 다시 작성하지 않습니다."), { code: "MATERIAL_REPAIR_REWRITE_FORBIDDEN" });
          }
          if (job.kind === "publish" && url.endsWith("/publish") && method === "POST") {
            const current = deps.material(item.productId);
            if (!current?.ready) throw Object.assign(new Error("소재가 더 이상 발행 준비 상태가 아닙니다."), { code: "MATERIAL_NOT_READY" });
            if (current.revision !== item.revision) throw Object.assign(new Error("선택 후 소재가 변경되었습니다. 최신 소재를 다시 선택하세요."), { code: "MATERIAL_CHANGED" });
            // A lost response cannot tell us whether the external submission began.
            submissionRequested = true;
          }
          try {
            const result = await deps.call(url, method, body);
            if (url.endsWith("/draft") && result.data) {
              protectedAssetShas = (result.data.imageAssets || []).map(asset => asset.sha256 || "");
              latestSectionIds = (result.data.imageSlots || []).filter(slot => Math.max(slot.missing, slot.generationMissing) > 0)
                .map(slot => slot.sectionId || "");
            }
            return result;
          }
          catch (error) {
            if (job.kind !== "publish" && method !== "GET" && isUncertainLocalTransportError(error)) {
              throw Object.assign(new Error("소재 준비 요청의 응답이 끊겼습니다. 작성이 계속될 수 있으므로 다음 상품 시작을 중지했습니다. 저장된 소재의 진행상태를 확인하세요.", { cause: error }), { code: "PREPARATION_RESULT_UNCERTAIN" });
            }
            throw error;
          }
        },
        onStage: (stage: string) => {
          item.stage = stage;
          const events = job.events ??= [];
          const previous = events[events.length - 1];
          if (previous?.productId !== item.productId || previous.stage !== stage || previous.status !== item.status) {
            events.push({ at: new Date().toISOString(), productId: item.productId, stage, status: item.status });
          }
          deps.save(job);
        },
      };
      if (job.kind !== "publish") {
        await runMaterialPreparation(item.productId, workflow, job.kind === "rewrite" ? {
          failureReference,
          rewriteFailed: true,
          beforeRewrite: async () => {
            deps.checkCancelled();
            // The preceding source refresh updates progress.json, so recheck the
            // current product gates here without requiring that old failure file.
            const eligible = await (deps.validateFailed ? deps.validateFailed(item.productId, job) : canStillRewriteProduct(item.productId));
            if (!eligible) throw Object.assign(new Error("재작성 직전에 소재 상태가 변경되어 기존 원고를 보존했습니다."), { code: "FAILED_MATERIAL_SELECTION_CHANGED" });
            item.backupCreated = Boolean((deps.backup || backupMaterialBeforeRewrite)(item.productId, job.jobId));
            deps.save(job);
          },
        } : job.kind === "repair" ? {
          failureReference,
          incrementalOnly: true,
          beforeRepair: async () => {
            deps.checkCancelled();
            const eligible = await (deps.validateRepair || (async (id, currentJob) =>
              (await listMaterialRepairCandidates(currentJob.connectKind, currentJob.jobId)).some(candidate => candidate.productId === id)))(item.productId, job);
            if (!eligible) throw Object.assign(new Error("변경 직전에 소재 상태가 바뀌어 기존 원고를 보존했습니다."), { code: "MATERIAL_REPAIR_SELECTION_CHANGED" });
            const backup = (deps.backup || backupMaterialBeforeRewrite)(item.productId, job.jobId);
            if (!backup) throw Object.assign(new Error("저장 패키지를 백업하지 못해 소재 보완을 시작하지 않았습니다."), { code: "MATERIAL_REPAIR_BACKUP_FAILED" });
            item.backupCreated = true;
            deps.save(job);
          },
        } : { failureReference });
        const current = deps.material(item.productId);
        if (!current?.ready) throw new Error(current?.blockers.join(" ") || "소재 준비 결과를 확인할 수 없습니다.");
        item.revision = current.revision; item.status = "ready"; item.stage = "소재 준비 완료 · 발행할 항목을 선택하세요";
        if (job.kind === "rewrite" || job.kind === "repair") item.verificationStatus = "READY";
      } else {
        const selected = deps.material(item.productId);
        if (!selected) {
          throw Object.assign(new Error("선택한 소재를 찾을 수 없습니다."), { code: "MATERIAL_NOT_READY" });
        }
        if (selected.revision !== item.revision) {
          throw Object.assign(new Error("선택 후 소재가 변경되었습니다. 최신 소재를 다시 선택하세요."), { code: "MATERIAL_CHANGED" });
        }
        if (!selected.ready) {
          // Selected publication is immutable. Preparation may change text, assets
          // and approval; a publish job must never adopt that new revision silently.
          throw Object.assign(new Error(`선택한 소재는 다시 검토해야 합니다. 소재 준비에서 검사를 완료한 뒤 다시 선택하세요. ${selected.blockers.join(" ")}`), {
            code: "MATERIAL_NOT_READY",
          });
        }
        const result = await runAutomaticDraftWorkflow(item.productId, {
          publishMode: job.publishMode!, scheduledDate: item.scheduledDate, materialRevision: item.revision,
        }, workflow);
        item.result = result; item.status = job.publishMode === "schedule" ? "scheduled" : "published";
        item.stage = job.publishMode === "schedule" ? "예약 등록 완료" : "발행 완료";
      }
    } catch (error) {
      const failureCodes = materialJobFailureCodes(error);
      const code = failureCodes.errorCode;
      const definitiveFailure = ["MATERIAL_NOT_READY", "MATERIAL_CHANGED", "PUBLISH_FAILED", "INVALID_INPUT", "CONTENT_BLOCKED", "DRAFT_REQUIRED"].includes(code || "");
      item.status = submissionRequested && !definitiveFailure ? "outcome_unknown" : "failed";
      if (job.kind === "rewrite" && code === "FAILED_MATERIAL_SELECTION_CHANGED") item.status = "interrupted";
      if (job.kind === "repair" && code === "MATERIAL_REPAIR_SELECTION_CHANGED") item.status = "interrupted";
      item.error = materialJobErrorMessage(error);
      Object.assign(item, failureCodes);
      const approvalConflict = code === "NOT_READY" ? normalizeMaterialApprovalConflict((error as { approvalConflict?: unknown })?.approvalConflict) : undefined;
      if (approvalConflict) item.approvalConflict = approvalConflict; else delete item.approvalConflict;
      const causalCode = failureCodes.causeCode || failureCodes.errorCode;
      if (causalCode === "EDITOR_DISCLOSURE_MISMATCH" || causalCode === "SHOPPING_CARD_INSERT_FAILED") failurePhase = "editor";
      else if (causalCode === "PUBLISH_IMAGE_AUDIT_FAILED") failurePhase = "review";
      let currentRevision: string | undefined;
      let contextSignature: string | undefined;
      try { currentRevision = deps.material(item.productId)?.revision; } catch { /* Keep a scope-less observation; never feed it to a writer. */ }
      try { contextSignature = readMaterialFailureScopeForProduct(item.productId)?.contextSignature; } catch { /* A missing context cannot be inferred. */ }
      const typedSections = (error as { imageAuditFailures?: Array<{ photoDescription?: { sectionId?: string } }> })?.imageAuditFailures
        ?.flatMap(finding => finding.photoDescription?.sectionId ? [finding.photoDescription.sectionId] : []) || [];
      if (job.kind === "rewrite" || job.kind === "repair") {
        try {
          const current = deps.material(item.productId);
          item.verificationStatus = current?.ready ? "READY" : current ? "BLOCKED" : "DRAFT_MISSING";
        } catch { item.verificationStatus = "BLOCKED"; }
      }
      item.stage = item.status === "outcome_unknown" ? "발행 결과 확인 필요 · 자동 재시도 중지" : code === "MATERIAL_NOT_READY" || code === "MATERIAL_CHANGED" ? "소재 준비·검토에서 다시 선택 필요" : "확인 필요";
      if (code === "PREPARATION_RESULT_UNCERTAIN") {
        item.status = "interrupted"; item.stage = "소재 준비 결과 확인 필요 · 다음 상품 중지"; stopped = true;
      }
      if (item.status === "outcome_unknown") stopped = true;
      if (isSessionWidePreparationFailureCode(code)) stopped = true;
      try { deps.checkCancelled(); } catch { stopped = true; }
      if (stopped) stoppedFailureCodes = failureCodes;
      // The request callback updates this phase; TypeScript does not model
      // assignments performed by an awaited callback in its control-flow graph.
      const observedPhase = failurePhase as MaterialFailurePhase;
      item.failureObservations = normalizeMaterialFailureObservations([...previousObservations, {
        version: 1, productId: item.productId, revision: currentRevision, contextSignature, phase: observedPhase, ...failureCodes,
        ...(approvalConflict ? { approvalConflict } : {}),
        sectionIds: typedSections.length ? typedSections : observedPhase === "images" ? latestSectionIds : [],
        protectedAssetShas, attempt: Math.max(0, ...previousObservations.map(entry => entry.attempt)) + 1,
        outcome: item.status === "outcome_unknown" || code === "PREPARATION_RESULT_UNCERTAIN" ? "uncertain" : item.status === "interrupted" ? "interrupted" : "failed",
        at: new Date().toISOString(),
      }]);
    }
    deps.save(job);
    (job.events ??= []).push({ at: new Date().toISOString(), productId: item.productId, stage: item.stage, status: item.status });
  }
  const successes = job.items.filter(item => ["ready", "published", "scheduled"].includes(item.status)).length;
  job.status = successes === job.items.length ? "completed" : successes ? "partial" : "failed";
  job.completedAt = new Date().toISOString();
  deps.save(job);
}

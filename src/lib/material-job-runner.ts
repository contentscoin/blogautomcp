import { materialJobErrorMessage, materialJobFailureCodes, type MaterialJob, saveMaterialJob } from "./material-job-store";
import { getMaterial } from "./material-library";
import { runMaterialPreparation, runAutomaticDraftWorkflow, localScheduleCall, isUncertainLocalTransportError, isSessionWidePreparationFailureCode, type Call } from "../../scripts/lib/scheduled-draft-workflow";
import { automaticPublishingCancellationCheck } from "./desktop-activity";

export async function runMaterialJob(job: MaterialJob, deps = {
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
    try {
      deps.checkCancelled();
      item.status = job.kind === "prepare" ? "preparing" : "publishing";
      deps.save(job);
      const workflow = {
        pause: deps.pause,
        call: async (url: string, method: string, body?: object) => {
          deps.checkCancelled();
          if (job.kind === "publish" && url.endsWith("/publish") && method === "POST") {
            const current = deps.material(item.productId);
            if (!current?.ready) throw Object.assign(new Error("소재가 더 이상 발행 준비 상태가 아닙니다."), { code: "MATERIAL_NOT_READY" });
            if (current.revision !== item.revision) throw Object.assign(new Error("선택 후 소재가 변경되었습니다. 최신 소재를 다시 선택하세요."), { code: "MATERIAL_CHANGED" });
            // A lost response cannot tell us whether the external submission began.
            submissionRequested = true;
          }
          try { return await deps.call(url, method, body); }
          catch (error) {
            if (job.kind === "prepare" && method !== "GET" && isUncertainLocalTransportError(error)) {
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
      if (job.kind === "prepare") {
        await runMaterialPreparation(item.productId, workflow);
        const current = deps.material(item.productId);
        if (!current?.ready) throw new Error(current?.blockers.join(" ") || "소재 준비 결과를 확인할 수 없습니다.");
        item.revision = current.revision; item.status = "ready"; item.stage = "소재 준비 완료 · 발행할 항목을 선택하세요";
      } else {
        const selected = deps.material(item.productId);
        if (!selected) {
          throw Object.assign(new Error("선택한 소재를 찾을 수 없습니다."), { code: "MATERIAL_NOT_READY" });
        }
        if (selected.revision !== item.revision) {
          throw Object.assign(new Error("선택 후 소재가 변경되었습니다. 최신 소재를 다시 선택하세요."), { code: "MATERIAL_CHANGED" });
        }
        if (!selected.ready) {
          item.stage = "발행 전 품질 원인 확인 · 자동 복구";
          deps.save(job);
          await runMaterialPreparation(item.productId, workflow);
          const repaired = deps.material(item.productId);
          if (!repaired?.ready) {
            throw Object.assign(new Error(repaired?.blockers.join(" ") || "발행 전 자동 복구 후에도 소재 검증을 통과하지 못했습니다."), {
              code: "MATERIAL_NOT_READY",
            });
          }
          // The bounded repair transaction intentionally creates a new content
          // revision. Continue only with that exact verified revision.
          item.revision = repaired.revision;
          deps.save(job);
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
      item.error = materialJobErrorMessage(error);
      Object.assign(item, failureCodes);
      item.stage = item.status === "outcome_unknown" ? "발행 결과 확인 필요 · 자동 재시도 중지" : "확인 필요";
      if (code === "PREPARATION_RESULT_UNCERTAIN") {
        item.status = "interrupted"; item.stage = "소재 준비 결과 확인 필요 · 다음 상품 중지"; stopped = true;
      }
      if (item.status === "outcome_unknown") stopped = true;
      if (isSessionWidePreparationFailureCode(code)) stopped = true;
      try { deps.checkCancelled(); } catch { stopped = true; }
      if (stopped) stoppedFailureCodes = failureCodes;
    }
    deps.save(job);
    (job.events ??= []).push({ at: new Date().toISOString(), productId: item.productId, stage: item.stage, status: item.status });
  }
  const successes = job.items.filter(item => ["ready", "published", "scheduled"].includes(item.status)).length;
  job.status = successes === job.items.length ? "completed" : successes ? "partial" : "failed";
  job.completedAt = new Date().toISOString();
  deps.save(job);
}

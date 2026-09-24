import http from "node:http";
import { isRecoverableImageEvidenceFailure, isRecoverableImageEvidenceResult, runRecordedImageRecovery } from "./material-image-recovery";
import { getWritingTimeoutPolicy } from "./writing-timeout-policy";
import type { BrandLinkContentReadiness } from "./brandlink-content-readiness";
import {
  formatQualityConvergenceInstructions,
  planQualityConvergence,
  type QualityConvergencePlan,
} from "./quality-convergence";

export interface Result {
  success: boolean; code?: string; error?: string; errors?: string[]; message?: string;
  recovery?: { changed: boolean }; remainingMissing?: number;
  data?: {
    status?: string; postUrl?: string; scheduledPublishAt?: string; errorMessage?: string;
    published?: boolean; scheduled?: boolean; verificationBasis?: string;
    attemptStage?: string | null;
    approvedAt?: string | null; approval?: { canApprove: boolean };
    imageGeneration?: { status: string; recoveryState?: string };
    imageSlots?: { missing: number; generationMissing: number }[];
    qualityConvergence?: QualityConvergencePlan | null;
    contentQuality?: {
      canPublish?: boolean;
      verdict?: string;
      code?: string;
      reason?: string | null;
      score?: number;
      blockers?: { code: string; tier: string; reason: string }[];
      qualityFailures?: { key: string; status: string; label?: string; notes?: string[] }[];
      signals?: { key: string; status: string; label?: string }[];
      quality?: {
        score: number;
        passScore?: number;
        categories?: { key?: string; status: string; label?: string; notes?: string[] }[];
        sourceEvidence?: { level?: string; sufficient?: boolean };
      };
    };
  } | null;
}
export type Call = (path: string, method: string, body?: object) => Promise<Result>;
export type WorkflowDeps = { call: Call; pause: () => Promise<void>; now?: () => number; timeoutMs?: number; onStage?: (stage: string) => void };
const defaults: WorkflowDeps = { call: localScheduleCall, pause: () => new Promise(resolve => setTimeout(resolve, 3000)) };

const SESSION_WIDE_PREPARATION_FAILURE_CODES = new Set([
  "CHATGPT_BROWSER_AUTH_REQUIRED",
  "CHATGPT_BROWSER_LOGIN_REQUIRED",
  "CHATGPT_BROWSER_UNREACHABLE",
  "CHATGPT_BROWSER_BUSY",
  "CODEX_AUTH_REQUIRED",
  "CODEX_LOGIN_REQUIRED",
  "CODEX_MODEL_INCOMPATIBLE",
  "LLM_UNAVAILABLE",
  "UNAUTHORIZED",
]);

const DEFERRABLE_MANUSCRIPT_FAILURE_CODES = new Set([
  "CONTENT_BLOCKED",
  "QUALITY_REPAIR_EXHAUSTED",
  "QUALITY_REPAIR_REJECTED",
]);

/** Failures tied to the shared login/browser/runtime cannot improve per item. */
export function isSessionWidePreparationFailureCode(code: string | null | undefined): boolean {
  return SESSION_WIDE_PREPARATION_FAILURE_CODES.has(code || "");
}

/**
 * Editorial verdicts about the saved manuscript. Binding reviewed seller
 * originals is free and must not wait for text repair to succeed.
 */
export function isDeferrableManuscriptFailureCode(code: string | null | undefined): boolean {
  return DEFERRABLE_MANUSCRIPT_FAILURE_CODES.has(code || "");
}

export function isUncertainLocalTransportError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return !code || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "REQUEST_TIMEOUT"].includes(code);
}

// Only read requests can be retried. Never replay an uncertain mutation.
export async function localScheduleCall(pathname: string, method: string, body?: object): Promise<Result> {
  const readOnly = method.toUpperCase() === "GET";
  const deadlineMs = readOnly ? 30_000 : pathname.endsWith("/draft") ? getWritingTimeoutPolicy().prepareMs : pathname.endsWith("/images") ? 45 * 60_000 : 25 * 60_000;
  const end = Date.now() + deadlineMs;
  for (let attempt = 0; ; attempt++) {
    try { return await localScheduleCallOnce(pathname, method, body, Math.max(1, end - Date.now())); }
    catch (error) {
      const transient = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes((error as NodeJS.ErrnoException).code || "");
      if (!readOnly || !transient || attempt >= 2 || Date.now() + 250 >= end) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

function localScheduleCallOnce(pathname: string, method: string, body: object | undefined, deadlineMs: number): Promise<Result> {
  return new Promise((resolve, reject) => {
    const origin = `http://127.0.0.1:${Number(process.env.APP_PORT || 43127)}`;
    const request = http.request(new URL(pathname, origin), {
      method, agent: false, headers: { "content-type": "application/json", origin,
        ...(process.env.ADMIN_API_KEY ? { "x-admin-api-key": process.env.ADMIN_API_KEY } : {}) },
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 24 * 1024 * 1024) request.destroy(new Error("소재 응답 크기 제한을 초과했습니다."));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Result;
          if (!result.success || (response.statusCode || 500) >= 400) reject(Object.assign(new Error(result.error || result.errors?.join("\n") || result.message || `작업 실패 (HTTP ${response.statusCode})`), { code: result.code || "HTTP_ERROR", errors: result.errors }));
          else resolve(result);
        } catch (error) { reject(error); }
      });
    });
    const deadline = setTimeout(() => request.destroy(Object.assign(new Error("작업 응답 제한시간을 초과했습니다. 저장된 결과를 확인하세요."), { code: "REQUEST_TIMEOUT" })), deadlineMs);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}

function bounded(deps: WorkflowDeps, fallback: number) {
  const now = deps.now || Date.now;
  const duration = deps.timeoutMs ?? fallback;
  const end = now() + duration;
  const maxPolls = Math.max(1800, Math.ceil(duration / 3000) + 1);
  let polls = 0;
  return () => {
    if (now() >= end || ++polls > maxPolls) throw Object.assign(new Error("작업 확인 제한시간을 초과했습니다. 진행상태를 확인하세요."), { code: "WORKFLOW_TIMEOUT" });
  };
}

const IMAGE_QUALITY_SIGNALS = new Set(["composition-quality", "representative-image", "thumbnail"]);
function isDefinitivePublishImageFailure(error: unknown): boolean {
  const failure = error as { code?: string; errors?: string[] };
  return failure.code === "PUBLISH_IMAGE_AUDIT_FAILED" && Boolean(failure.errors?.length) &&
    failure.errors!.every(reason => /^(?:SEMANTIC_REJECTION|LONG_IMAGE):/u.test(reason));
}

function legacyTextFailures(draft: Result): string[] {
  const quality = draft.data?.contentQuality;
  return [
    ...(quality?.signals || [])
      .filter((signal) => signal.status === "fail" && !IMAGE_QUALITY_SIGNALS.has(signal.key))
      .map((signal) => signal.label || signal.key),
    ...(quality?.quality?.categories || [])
      .filter((category) => category.status === "fail")
      .map((category) => category.label || "원고 구체성"),
    ...(quality?.quality?.passScore !== undefined && quality.quality.score < quality.quality.passScore
      ? ["원고 품질 점수 미달"]
      : []),
  ];
}

function completeFallbackPlan(): QualityConvergencePlan {
  return {
    action: "complete",
    shouldGenerateText: false,
    failureSignature: "legacy:none",
    reason: "원고 품질 실패가 없습니다.",
    targets: [],
  };
}

/** Real API responses carry a full readiness object. Small test/legacy fixtures
 * intentionally carry only signals; keep their deterministic fallback until
 * every installed desktop is on the new response contract. */
function qualityPlanForDraft(
  draft: Result,
  attempt: number,
  previous: BrandLinkContentReadiness | null = null,
): { plan: QualityConvergencePlan; readiness: BrandLinkContentReadiness | null } {
  const value = draft.data?.contentQuality;
  const full = value && typeof value.canPublish === "boolean" && typeof value.score === "number" &&
    Array.isArray(value.blockers) && Array.isArray(value.signals) && Array.isArray(value.qualityFailures) &&
    value.quality && Array.isArray(value.quality.categories)
      ? value as unknown as BrandLinkContentReadiness
      : null;
  if (full) {
    return {
      plan: draft.data?.qualityConvergence || planQualityConvergence({
        current: full,
        previous,
        attempt,
        maximumAttempts: 1,
      }),
      readiness: full,
    };
  }
  const failures = legacyTextFailures(draft);
  if (failures.length > 0) {
    return {
      readiness: null,
      plan: {
        action: attempt >= 1 ? "stop" : "repair-text",
        shouldGenerateText: attempt < 1,
        failureSignature: `legacy:${failures.join("|")}`,
        reason: attempt >= 1 ? "원고 보강 후에도 품질 문제가 남았습니다." : "원고 품질 문제를 자동 보강할 수 있습니다.",
        targets: failures.map((failure, index) => ({
          key: `legacy-${index}`,
          kind: "text" as const,
          instruction: failure,
          evidence: [failure],
        })),
      },
    };
  }
  const compositionFailure = (value?.signals || []).some((signal) => signal.status === "fail" && IMAGE_QUALITY_SIGNALS.has(signal.key)) ||
    Boolean(draft.data?.imageSlots?.some((slot) => Math.max(slot.missing, slot.generationMissing) > 0));
  if (compositionFailure) {
    return {
      readiness: null,
      plan: {
        action: "repair-composition",
        shouldGenerateText: false,
        failureSignature: "legacy:composition",
        reason: "원고는 유지하고 이미지 구성을 보강합니다.",
        targets: [],
      },
    };
  }
  return { plan: completeFallbackPlan(), readiness: null };
}

/** Half or more quality categories failing (or a safety/internal-leak blocker plus a failing category). */
export function isSeverelyFailingDraft(readiness: BrandLinkContentReadiness | null): boolean {
  if (!readiness || readiness.canPublish) return false;
  const categories = readiness.quality?.categories || [];
  const failing = categories.filter((category) => category.status === "fail").length;
  return categories.length > 0 && failing * 2 >= categories.length;
}

// Stage 1. Repairs are bounded and only take place while preparing materials.
export async function runMaterialPreparation(id: string, deps: WorkflowDeps = defaults) {
  const base = `/api/brandlinks/${encodeURIComponent(id)}`;
  const check = bounded(deps, 90 * 60_000);
  deps.onStage?.("저장 소재 확인");
  let draft = await deps.call(`${base}/draft`, "GET");
  const reusedSavedDraft = Boolean(draft.data);
  if (!draft.data) {
    deps.onStage?.("원고·기본 이미지 작성");
    // New and existing materials converge through the same saved-draft repair
    // engine below. Avoid spending a separate hidden repair budget during POST.
    draft = await deps.call(`${base}/draft`, "POST", { autoApprove: false, autoSectionImages: false, autoQualityRepair: false });
  }
  const waitForImagesIdle = async () => {
    while (draft.data?.imageGeneration?.status === "running") {
      if (draft.data.imageGeneration.recoveryState === "owner-unknown") throw Object.assign(new Error("이전 이미지 작업의 실행 여부를 확인할 수 없습니다. 저장 소재의 이미지 탭에서 기존 결과를 확인한 뒤 복구하세요."), { code: "IMAGE_RESUME_REQUIRED" });
      deps.onStage?.("이미지 준비 대기");
      check(); await deps.pause(); draft = await deps.call(`${base}/draft`, "GET");
    }
  };
  // Validate the saved manuscript before spending time on section images.
  // Drafted only means persisted; the convergence plan decides which subsystem
  // owns the next repair and prevents sparse facts from causing hallucinated rewrites.
  let revised = false;
  let sourceRefreshAttempted = false;
  let previousReadiness: BrandLinkContentReadiness | null = null;
  const recheck = async (refreshSource = false, attempt = 0) => {
    check();
    draft = await deps.call(`${base}/draft`, "PATCH", {
      action: "recheck",
      ...(refreshSource ? { refreshSource: true } : {}),
    });
    const decision = qualityPlanForDraft(draft, attempt, previousReadiness);
    previousReadiness = decision.readiness;
    return decision.plan;
  };
  const refreshSource = async () => {
    if (sourceRefreshAttempted) {
      throw Object.assign(new Error("상품 상세 근거를 다시 수집했지만 발행 가능한 고유 근거가 부족합니다."), {
        code: "SOURCE_EVIDENCE_REQUIRED",
      });
    }
    sourceRefreshAttempted = true;
    check();
    deps.onStage?.("상품 상세 근거 다시 수집");
    // The POST writes a server-owned context file. The following PATCH decides
    // whether it is strictly richer before replacing the frozen snapshot.
    await deps.call(`${base}/draft`, "POST", { action: "prepare_context" });
    deps.onStage?.("새 상품 근거 비교·재검사");
    return recheck(true, revised ? 1 : 0);
  };
  const revise = async (plan: QualityConvergencePlan) => {
    if (plan.action !== "repair-text" || !plan.shouldGenerateText) {
      throw Object.assign(new Error(`원고 재작성 대상이 아닙니다: ${plan.reason}`), { code: "CONTENT_BLOCKED" });
    }
    check();
    revised = true;
    deps.onStage?.("근거 기반 원고 자동 보강 (최대 3회 후보 검수)");
    const targets = formatQualityConvergenceInstructions(plan);
    draft = await deps.call(`${base}/draft`, "PATCH", {
      action: "revise",
      qualityConvergence: true,
      instructions: [
        "[자동 품질 수렴 계획]",
        plan.reason,
        targets,
        "저장된 출처 근거만 사용하고 상품명·SEO 키워드·가격·쿠폰만으로 성분·성능·체험을 추정하지 마세요.",
        "이미 통과한 문단 역할과 이미지 의미는 유지하고 실패 항목만 보강하세요.",
      ].filter(Boolean).join("\n"),
    });
  };
  const sourceEvidenceError = (plan: QualityConvergencePlan) => Object.assign(
    new Error(`상품 상세 근거를 다시 수집했지만 원고 품질에 필요한 고유 근거가 부족합니다. ${plan.reason}`),
    { code: "SOURCE_EVIDENCE_REQUIRED" },
  );
  const unresolvedQualityError = (plan: QualityConvergencePlan) => Object.assign(
    new Error(`원고 보강 후에도 품질 문제가 남았습니다. ${plan.reason}`),
    { code: "QUALITY_REPAIR_EXHAUSTED" },
  );
  let latestImageRepair: Pick<Result, "code" | "error" | "errors" | "message"> | null = null;
  const unresolvedCompositionError = (reason: string) => {
    const imageFailureCode = latestImageRepair?.code && !["OK", "IMAGE_REPAIR_COMPLETE"].includes(latestImageRepair.code)
      ? latestImageRepair.code
      : null;
    const message = latestImageRepair?.errors?.join(" ") || latestImageRepair?.error ||
      (imageFailureCode ? latestImageRepair?.message : undefined) || reason;
    return Object.assign(new Error(message), {
      code: imageFailureCode || "COMPOSITION_REPAIR_REQUIRED",
    });
  };

  deps.onStage?.("저장 원고 품질검사");
  await waitForImagesIdle();
  let plan = await recheck();
  // A saved draft from an older run that fails most quality categories converges poorly by
  // section patches. Write it once from scratch with the current writer, then continue as usual.
  if (reusedSavedDraft && isSeverelyFailingDraft(previousReadiness) && !["complete", "refresh-source"].includes(plan.action)) {
    check();
    deps.onStage?.("오래된 원고 품질 미달 · 현재 기준으로 새로 작성");
    draft = await deps.call(`${base}/draft`, "POST", { autoApprove: false, autoSectionImages: false, autoQualityRepair: false });
    await waitForImagesIdle();
    previousReadiness = null;
    plan = await recheck();
  }
  if (plan.action === "refresh-source") {
    plan = await refreshSource();
    if (plan.action === "refresh-source") throw sourceEvidenceError(plan);
  }
  // The manuscript and verified source binding are independently repairable.
  // When text repair cannot close, still place reviewed seller originals so the
  // next run is not identical. Browser generation stays gated behind a passing
  // manuscript so we do not spend ChatGPT sessions on blocked drafts.
  let unresolvedText: Error | null = null;
  try {
    if (plan.action === "repair-text") {
      await revise(plan);
      plan = await recheck(false, 1);
      if (plan.action === "refresh-source") {
        plan = await refreshSource();
        if (plan.action === "refresh-source") throw sourceEvidenceError(plan);
      }
      if (plan.action === "repair-text" || plan.action === "stop") throw unresolvedQualityError(plan);
    } else if (plan.action === "stop") {
      throw Object.assign(new Error(plan.reason), { code: "CONTENT_BLOCKED" });
    }
  } catch (error) {
    if (!isDeferrableManuscriptFailureCode((error as { code?: string }).code)) throw error;
    unresolvedText = error as Error;
  }

  const bindVerifiedSources = async () => {
    deps.onStage?.("검증 원본 이미지 배정");
    await waitForImagesIdle();
    if (!draft.data) throw new Error("준비 중 소재가 사라졌습니다.");
    if (draft.data.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) {
      const bound = await deps.call(`${base}/draft/images`, "POST", { action: "bind_sources" });
      latestImageRepair = bound;
      if (isSessionWidePreparationFailureCode(bound.code)) {
        throw Object.assign(new Error(bound.errors?.join(" ") || bound.message || "이미지 엔진 확인이 필요합니다."), { code: bound.code });
      }
      draft = await deps.call(`${base}/draft`, "GET");
      await waitForImagesIdle();
    }
  };

  const images = async (sourceOnly = false) => {
    deps.onStage?.("이미지 준비");
    await waitForImagesIdle();
    if (!draft.data) throw new Error("준비 중 소재가 사라졌습니다.");
    if (draft.data.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) {
      const attemptImages = async (action: string) => {
        check();
        try {
          latestImageRepair = await deps.call(`${base}/draft/images`, "POST", { action });
        } catch (error) {
          const failure = { code: (error as { code?: string }).code, errors: (error as { errors?: string[] }).errors, error: (error as Error).message };
          if (!isRecoverableImageEvidenceResult(failure)) throw error;
          latestImageRepair = failure;
        }
        if (isSessionWidePreparationFailureCode(latestImageRepair?.code)) {
          throw Object.assign(new Error(latestImageRepair?.error || latestImageRepair?.errors?.join(" ") || "이미지 엔진 확인이 필요합니다."), { code: latestImageRepair?.code });
        }
        if (latestImageRepair?.errors?.length && !isRecoverableImageEvidenceResult(latestImageRepair)) {
          const cause = latestImageRepair.errors.flatMap(message => message.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu) || [])
            .find(code => !isRecoverableImageEvidenceFailure(code));
          throw Object.assign(new Error(latestImageRepair.errors.join("\n")), { code: cause || latestImageRepair.code || "IMAGE_REPAIR_FAILED", errors: latestImageRepair.errors });
        }
        draft = await deps.call(`${base}/draft`, "GET");
        await waitForImagesIdle();
      };
      const missing = () => draft.data?.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0);
      await attemptImages(sourceOnly ? "bind_sources" : "generate_missing");
      if (missing() && isRecoverableImageEvidenceResult(latestImageRepair)) {
        deps.onStage?.("이미지 실패 원인 확인 · 상품 상세 원본 재수집");
        const refreshed = await runRecordedImageRecovery(id, "refresh-source", async () => {
          check();
          await deps.call(`${base}/draft`, "POST", { action: "prepare_context" });
          // Image URLs refresh independently of textual snapshot promotion.
          // Keep the manuscript frozen; the final recheck still verifies it.
          await attemptImages("bind_sources");
          // bind_sources places seller originals only. Only AI-scene slots (generationMissing) that are
          // still empty get one more generation pass; source-evidence gaps never re-trigger generation.
          if (draft.data?.imageSlots?.some(slot => slot.generationMissing > 0)) await attemptImages("generate_missing");
        });
        if (!refreshed.attempted) deps.onStage?.("같은 근거 재수집은 반복하지 않음 · 대체 구성 검토");
        if (missing() && isRecoverableImageEvidenceResult(latestImageRepair)) {
          deps.onStage?.("검증 가능한 문단으로 이미지 배치 재계획");
          await runRecordedImageRecovery(id, "replan-images", () => attemptImages("replan_sources"));
        }
      }
    }
    if (draft.data?.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) {
      throw unresolvedCompositionError("이미지 준비가 미완료입니다. 저장된 소재에서 실패한 이미지만 보충하세요.");
    }
  };

  if (unresolvedText) {
    try {
      await bindVerifiedSources();
    } catch (error) {
      if (isSessionWidePreparationFailureCode((error as { code?: string }).code)) throw error;
      // Keep the manuscript cause as the reported failure; source binding is best-effort.
    }
    throw unresolvedText;
  }

  await images();
  deps.onStage?.("내용·구성 품질검사");
  plan = await recheck(false, revised ? 1 : 0);
  if (plan.action === "refresh-source") {
    plan = await refreshSource();
    if (plan.action === "refresh-source") throw sourceEvidenceError(plan);
  }
  if (plan.action === "repair-text") {
    if (revised) throw unresolvedQualityError(plan);
    await revise(plan);
    plan = await recheck(false, 1);
  }
  if (plan.action === "repair-composition") {
    throw unresolvedCompositionError(plan.reason);
  }
  if (plan.action !== "complete") {
    const error = plan.action === "refresh-source" ? sourceEvidenceError(plan) : unresolvedQualityError(plan);
    throw error;
  }
  // Approval executes the same final pixel audit as publication, even for a
  // previously READY package. Only definitive image findings allow one repair.
  try {
    await deps.call(`${base}/draft`, "PATCH", { action: "approve" });
  } catch (error) {
    if (!isDefinitivePublishImageFailure(error)) throw error;
    deps.onStage?.("최종 이미지 검사 실패 · 해당 원본 자동 교체");
    draft = await deps.call(`${base}/draft`, "GET");
    if (!draft.data?.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) throw error;
    await images(true);
    plan = await recheck(false, revised ? 1 : 0);
    if (plan.action !== "complete") throw unresolvedCompositionError(plan.reason);
    deps.onStage?.("교체 이미지 최종 재검사·승인");
    try {
      await deps.call(`${base}/draft`, "PATCH", { action: "approve" });
    } catch (secondError) {
      if (!isDefinitivePublishImageFailure(secondError)) throw secondError;
      deps.onStage?.("반복 거절 원인 확인 · 검증된 다른 문단으로 배치 변경");
      // A second pixel rejection does not buy another replacement attempt.
      // One source-only structural change may justify a final audit, provided
      // it actually changed coverage and closed every required slot.
      const replanned = await runRecordedImageRecovery(id, "replan-images", () =>
        deps.call(`${base}/draft/images`, "POST", { action: "replan_sources" }));
      if (!replanned.attempted || !replanned.result?.recovery?.changed ||
          replanned.result.remainingMissing !== 0 || replanned.result.errors?.length) throw secondError;
      draft = await deps.call(`${base}/draft`, "GET");
      if (!draft.data || draft.data.imageGeneration?.status === "running" ||
          draft.data.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) throw secondError;
      plan = await recheck(false, revised ? 1 : 0);
      if (plan.action !== "complete") throw unresolvedCompositionError(plan.reason);
      deps.onStage?.("변경된 배치 최종 재검사·승인");
      await deps.call(`${base}/draft`, "PATCH", { action: "approve" });
    }
  }
  // HTTP success only means the handler ran. Verify persisted approval and all
  // gates before reporting a material as complete (also used by MCP callers).
  draft = await deps.call(`${base}/draft`, "GET");
  if (!draft.data?.approvedAt || draft.data.approval?.canApprove === false ||
      draft.data.imageGeneration?.status === "running" ||
      draft.data.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) {
    throw Object.assign(new Error("초안은 저장됐지만 소재 준비·승인이 완료되지 않았습니다. 저장된 품질검사와 이미지 보강 결과를 확인하세요."), { code: "MATERIAL_NOT_READY" });
  }
  deps.onStage?.("소재 준비 완료");
}

// Stage 2. This function MUST NOT create, revise, approve or generate an image.
export async function runAutomaticDraftWorkflow(id: string, publication: { publishMode: "now" | "schedule"; scheduledDate?: string; materialRevision?: string }, deps: WorkflowDeps = defaults) {
  const base = `/api/brandlinks/${encodeURIComponent(id)}`;
  deps.onStage?.("저장된 승인 소재 확인");
  const draft = await deps.call(`${base}/draft`, "GET");
  if (!draft.data?.approvedAt || draft.data.approval?.canApprove === false ||
      draft.data.imageGeneration?.status === "running" ||
      draft.data.imageSlots?.some(slot => Math.max(slot.missing, slot.generationMissing) > 0)) {
    throw Object.assign(new Error("선택한 소재의 준비·승인이 완료되지 않았습니다. 소재 미리작성 단계에서 완료하세요."), { code: "MATERIAL_NOT_READY" });
  }
  deps.onStage?.("선택 소재 발행·결과 확인");
  let submissionError: unknown = null;
  try {
    await deps.call(`${base}/publish`, "POST", publication);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (["MATERIAL_NOT_READY", "MATERIAL_CHANGED", "PUBLISH_FAILED", "INVALID_INPUT", "CONTENT_BLOCKED", "DRAFT_REQUIRED"].includes(code || "")) throw error;
    submissionError = error;
  }
  // The detached publisher owns the runtime deadline. Do not abandon a still
  // live publisher at 25 minutes while its own deadline permits more work.
  const check = bounded(deps, getWritingTimeoutPolicy().agentMs + 60_000);
  for (;;) {
    check();
    const result = await deps.call(base, "GET");
    const expected = publication.publishMode === "schedule" ? "SCHEDULED" : "PUBLISHED";
    if (result.data?.status === expected) {
      const verified = await deps.call(`${base}/verify`, "GET");
      if (publication.publishMode === "schedule" ? verified.data?.scheduled === true : verified.data?.published === true) return verified.data;
      throw Object.assign(new Error("완료 상태는 저장됐지만 실제 발행 결과를 검증하지 못했습니다. 확인 후 처리하세요."), { code: "OUTCOME_UNKNOWN" });
    }
    if (submissionError && result.data?.status !== "PUBLISHING") {
      throw submissionError;
    }
    if (result.data?.status !== "PUBLISHING") {
      const verified = result.data?.status === "FAILED" ? await deps.call(`${base}/verify`, "GET") : null;
      const failedBeforeSubmit = verified?.data?.attemptStage === "FAILED_BEFORE_SUBMIT";
      throw Object.assign(new Error(result.data?.errorMessage || `발행 결과 미확인: ${result.data?.status || "MISSING"}`), { code: failedBeforeSubmit ? "PUBLISH_FAILED" : "OUTCOME_UNKNOWN" });
    }
    await deps.pause();
  }
}
export const runScheduledDraftWorkflow = (id: string, date: string, deps?: WorkflowDeps) => runAutomaticDraftWorkflow(id, { publishMode: "schedule", scheduledDate: date }, deps);

import { prisma } from "./db";
import { getMaterial } from "./material-library";
import { listMaterialJobs, type MaterialJob } from "./material-job-store";
import { readDraftProgress } from "./draft-progress";

export type MaterialConnectKind = "SHOPPING" | "TRAVEL";
export type FailedMaterialProduct = { id: string; productName: string | null; status: string; connectKind: string;
  postUrl?: string | null; publishedAt?: unknown; scheduledPublishAt?: unknown; errorMessage?: string | null };
export type FailedMaterialCandidate = { productId: string; productName: string | null; connectKind: string;
  reason: string; errorCode?: string; causeCode?: string; previousJobId?: string; previousKind?: string;
  verificationStatus: "BLOCKED" | "DRAFT_MISSING"; revision?: string };

const DEFINITIVE_PUBLICATION_FAILURE_CODES = new Set([
  "MATERIAL_NOT_READY", "MATERIAL_CHANGED", "PUBLISH_FAILED", "INVALID_INPUT", "CONTENT_BLOCKED", "DRAFT_REQUIRED",
]);
const jobEvidenceTime = (job: MaterialJob) => Date.parse(job.completedAt || job.updatedAt || job.startedAt);
const uncertainPublicationCode = (code?: string) => Boolean(code && /(?:UNKNOWN|UNCERTAIN)/u.test(code));

export function normalizeMaterialConnectKind(value: unknown): MaterialConnectKind | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  if (normalized !== "SHOPPING" && normalized !== "TRAVEL") throw new Error("소재 종류는 SHOPPING 또는 TRAVEL이어야 합니다.");
  return normalized;
}

/** Pure selector: workflow status alone cannot distinguish failed publication from failed writing. */
export function selectFailedMaterialCandidates(products: FailedMaterialProduct[], jobs: MaterialJob[], deps: {
  material: (id: string) => { ready: boolean; revision?: string; blockers: string[]; imageGeneration?: { status: string; recoveryState?: string } | null } | null;
  progress: (id: string) => { stage: string; message: string; updatedAt: string } | null;
}, connectKind?: MaterialConnectKind): FailedMaterialCandidate[] {
  const latest = new Map<string, { job: MaterialJob; item: MaterialJob["items"][number] }>();
  const latestPublication = new Map<string, { job: MaterialJob; item: MaterialJob["items"][number] }>();
  for (const job of [...jobs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    for (const item of job.items) {
      if (!latest.has(item.productId)) latest.set(item.productId, { job, item });
      if (job.kind === "publish" && !latestPublication.has(item.productId)) latestPublication.set(item.productId, { job, item });
    }
  }
  return products.flatMap(product => {
    if (connectKind && product.connectKind !== connectKind) return [];
    if (!["READY", "FAILED"].includes(product.status) || product.postUrl || product.publishedAt || product.scheduledPublishAt) return [];
    const previous = latest.get(product.id);
    if (previous && ["queued", "preparing", "publishing", "outcome_unknown"].includes(previous.item.status)) return [];
    if (previous && ["PREPARATION_RESULT_UNCERTAIN", "APP_INTERRUPTED", "WORKFLOW_TIMEOUT"].includes(previous.item.errorCode || "")) return [];
    const publication = latestPublication.get(product.id);
    // A subsequent failed writer cannot establish whether an older submission
    // reached Naver. Only a definitively failed publication can be superseded.
    if (publication && (publication.item.status !== "failed" ||
      !DEFINITIVE_PUBLICATION_FAILURE_CODES.has(publication.item.errorCode || "") ||
      uncertainPublicationCode(publication.item.errorCode) || uncertainPublicationCode(publication.item.causeCode))) return [];
    let material: ReturnType<typeof deps.material>;
    try { material = deps.material(product.id); } catch { return []; }
    if (material?.ready || material?.imageGeneration?.status === "running" || material?.imageGeneration?.recoveryState === "owner-unknown") return [];
    const progress = deps.progress(product.id);
    const failedPreparation = previous && ["prepare", "rewrite"].includes(previous.job.kind) && ["failed", "interrupted"].includes(previous.item.status);
    const progressFailed = progress?.stage === "failed" && (!previous || Date.parse(progress.updatedAt) > jobEvidenceTime(previous.job));
    if (!failedPreparation && !progressFailed) return [];
    if (publication) {
      const writingFailureTime = Math.max(failedPreparation ? jobEvidenceTime(previous.job) : -Infinity,
        progressFailed ? Date.parse(progress!.updatedAt) : -Infinity);
      // Missing or invalid timestamps are insufficient evidence to overwrite a
      // manuscript after any publication attempt.
      if (!(writingFailureTime > jobEvidenceTime(publication.job))) return [];
    }
    // A later success record is authoritative even when an unrelated manual edit removed approval.
    if (previous?.item.status === "ready" && !progressFailed) return [];
    return [{ productId: product.id, productName: product.productName, connectKind: product.connectKind,
      reason: failedPreparation ? previous.item.error || material?.blockers.join(" ") || "소재 준비 실패" : progress?.message || product.errorMessage || "원고 작성 실패",
      ...(failedPreparation ? { previousJobId: previous.job.jobId, previousKind: previous.job.kind,
        ...(previous.item.errorCode ? { errorCode: previous.item.errorCode } : {}), ...(previous.item.causeCode ? { causeCode: previous.item.causeCode } : {}) } : {}),
      verificationStatus: material ? "BLOCKED" as const : "DRAFT_MISSING" as const,
      ...(material?.revision ? { revision: material.revision } : {}),
    }];
  });
}

export async function listFailedMaterialCandidates(connectKind?: MaterialConnectKind, excludeJobId?: string): Promise<FailedMaterialCandidate[]> {
  const products = await prisma.brandLink.findMany({ orderBy: { createdAt: "desc" },
    ...(connectKind ? { where: { connectKind } } : {}),
    select: { id: true, productName: true, status: true, connectKind: true, postUrl: true, publishedAt: true, scheduledPublishAt: true, errorMessage: true },
  });
  return selectFailedMaterialCandidates(products, listMaterialJobs().filter(job => job.jobId !== excludeJobId), { material: getMaterial, progress: readDraftProgress }, connectKind);
}

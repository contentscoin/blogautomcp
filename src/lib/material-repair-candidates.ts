import fs from "node:fs";
import { prisma } from "./db";
import { getMaterial } from "./material-library";
import { readBrandPostPackage } from "./brand-post-package";
import { readPublishAttempt } from "./publish-attempt";
import { listMaterialJobs, type MaterialJob } from "./material-job-store";
import type { FailedMaterialProduct, MaterialConnectKind } from "./material-failed-candidates";

export type MaterialRepairCandidate = { productId: string; productName: string | null; connectKind: string;
  reason: string; blockers: string[]; revision: string; verificationStatus: "BLOCKED" };

/** A BLOCKED view is insufficient: the persisted manuscript must be readable. */
export function hasSavedMaterialDraft(productId: string): boolean {
  try {
    const manifest = readBrandPostPackage(productId, { migrate: false });
    if (!manifest || typeof manifest.markdownPath !== "string" || !fs.statSync(manifest.markdownPath).isFile()) return false;
    return fs.readFileSync(manifest.markdownPath, "utf8").trim().length > 0;
  } catch { return false; }
}

const definitivePublicationFailures = new Set(["MATERIAL_NOT_READY", "MATERIAL_CHANGED", "PUBLISH_FAILED", "INVALID_INPUT", "CONTENT_BLOCKED", "DRAFT_REQUIRED"]);
const uncertainFailure = (value?: string) => Boolean(value && /(?:UNKNOWN|UNCERTAIN)/u.test(value));

export function selectMaterialRepairCandidates(products: FailedMaterialProduct[], jobs: MaterialJob[], deps: {
  material: (id: string) => { ready: boolean; revision: string; blockers: string[]; imageGeneration?: { status: string; recoveryState?: string } | null } | null;
  savedDraft: (id: string) => boolean;
  publicationAttempt: (id: string) => { stage: string } | null;
}, connectKind?: MaterialConnectKind): MaterialRepairCandidate[] {
  const latest = new Map<string, { job: MaterialJob; item: MaterialJob["items"][number] }>();
  const publication = new Map<string, MaterialJob["items"][number]>();
  for (const job of [...jobs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    for (const item of job.items) {
      if (!latest.has(item.productId)) latest.set(item.productId, { job, item });
      if (job.kind === "publish" && !publication.has(item.productId)) publication.set(item.productId, item);
    }
  }
  return products.flatMap(product => {
    if (connectKind && product.connectKind !== connectKind) return [];
    if (!["READY", "FAILED"].includes(product.status) || product.postUrl || product.publishedAt || product.scheduledPublishAt) return [];
    const previous = latest.get(product.id);
    if (previous && (["queued", "preparing", "publishing", "outcome_unknown"].includes(previous.item.status) ||
      uncertainFailure(previous.item.errorCode) || uncertainFailure(previous.item.causeCode) ||
      ["APP_INTERRUPTED", "WORKFLOW_TIMEOUT"].includes(previous.item.errorCode || ""))) return [];
    const published = publication.get(product.id);
    if (published && (published.status !== "failed" || !definitivePublicationFailures.has(published.errorCode || "") ||
      uncertainFailure(published.errorCode) || uncertainFailure(published.causeCode))) return [];
    try {
      const attempt = deps.publicationAttempt(product.id);
      if (attempt && attempt.stage !== "FAILED_BEFORE_SUBMIT") return [];
      if (!deps.savedDraft(product.id)) return [];
      const material = deps.material(product.id);
      if (!material || material.ready || !material.blockers.length || !/^[a-f0-9]{64}$/.test(material.revision) ||
        material.imageGeneration?.status === "running" || material.imageGeneration?.recoveryState === "owner-unknown") return [];
      return [{ productId: product.id, productName: product.productName, connectKind: product.connectKind,
        reason: material.blockers.join(" "), blockers: [...material.blockers], revision: material.revision, verificationStatus: "BLOCKED" as const }];
    } catch { return []; }
  });
}

export async function listMaterialRepairCandidates(connectKind?: MaterialConnectKind, excludeJobId?: string): Promise<MaterialRepairCandidate[]> {
  const products = await prisma.brandLink.findMany({ orderBy: { createdAt: "desc" }, ...(connectKind ? { where: { connectKind } } : {}),
    select: { id: true, productName: true, status: true, connectKind: true, postUrl: true, publishedAt: true, scheduledPublishAt: true, errorMessage: true },
  });
  return selectMaterialRepairCandidates(products, listMaterialJobs().filter(job => job.jobId !== excludeJobId),
    { material: getMaterial, savedDraft: hasSavedMaterialDraft, publicationAttempt: readPublishAttempt }, connectKind);
}

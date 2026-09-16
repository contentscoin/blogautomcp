import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./db";
import { requireAdminApiKey } from "./api-auth";
import { requireNoPendingDesktopUpdate } from "./update-guard";
import { beginAutomaticPublishing } from "./desktop-activity";
import { getMaterial, validateMaterialSelection } from "./material-library";
import { acquireMaterialJobLock, listMaterialJobs, materialJobErrorMessage, materialJobFailureCodes, readMaterialJob, saveMaterialJob, type MaterialJob } from "./material-job-store";
import { runMaterialJob } from "./material-job-runner";
import { addDaysToYmd, ymdInTimeZone } from "./bulk-schedule-plan";

type MaterialStatus = "PREPARING" | "BLOCKED" | "READY" | "PUBLISHING" | "SCHEDULED" | "PUBLISHED" | "OUTCOME_UNKNOWN";
type MaterialProduct = { id: string; productName: string | null; status: string; connectKind: string };

/**
 * Product status is a database workflow state. Material status is the
 * authoritative publish-readiness state returned to desktop and MCP callers.
 * In particular, a READY product can still have a BLOCKED/PREPARING material.
 */
function materialStatus(productStatus: string, ready: boolean, imageStatus?: string | null): MaterialStatus {
  if (productStatus === "PUBLISHED") return "PUBLISHED";
  if (productStatus === "SCHEDULED") return "SCHEDULED";
  if (productStatus === "PUBLISHING") return "PUBLISHING";
  if (productStatus === "OUTCOME_UNKNOWN") return "OUTCOME_UNKNOWN";
  if (productStatus === "DRAFTING" || imageStatus === "running") return "PREPARING";
  return ready ? "READY" : "BLOCKED";
}

function readMaterialView(product: MaterialProduct): Record<string, unknown> | null {
  try {
    const saved = getMaterial(product.id);
    if (!saved) return null;
    const statusAllowsPublish = ["READY", "FAILED"].includes(product.status);
    const ready = saved.ready && statusAllowsPublish;
    const status = materialStatus(product.status, ready, saved.imageGeneration?.status);
    return { ...saved, productName: product.productName, status, materialStatus: status, productStatus: product.status,
      ready, blockers: statusAllowsPublish ? saved.blockers : [...saved.blockers, `현재 상태: ${product.status}`] };
  } catch (error) {
    const status = materialStatus(product.status, false);
    return { productId: product.id, productName: product.productName, title: product.productName || "소재 읽기 오류", connectKind: product.connectKind as "SHOPPING" | "TRAVEL",
      status, materialStatus: status, productStatus: product.status, ready: false, blockers: [(error as Error).message], revision: "", createdAt: "", approvedAt: null, score: null, imageCount: 0 };
  }
}

async function materialJobView(job: MaterialJob): Promise<Record<string, unknown>> {
  const productIds = [...new Set(job.items.map(item => item.productId))];
  const products = productIds.length ? await prisma.brandLink.findMany({
    where: { id: { in: productIds } },
    select: { id: true, productName: true, status: true, connectKind: true },
  }) : [];
  const byId = new Map(products.map(product => [product.id, product]));
  const materials = productIds.flatMap(productId => {
    const product = byId.get(productId);
    const material = product ? readMaterialView(product) : null;
    return material ? [material] : [];
  });
  const workflowPending = ["running", "queued"].includes(job.status) || materials.some(material => material.materialStatus === "PREPARING");
  return { ...job, materials, workflowPending };
}

export async function materialsGet(request: NextRequest) {
  const auth = requireAdminApiKey(request); if (auth) return auth;
  try {
    const jobId = request.nextUrl.searchParams.get("jobId");
    if (jobId) {
      const job = readMaterialJob(jobId);
      return NextResponse.json(job ? { success: true, data: await materialJobView(job) } : { success: false, error: "작업을 찾을 수 없습니다." }, { status: job ? 200 : 404 });
    }
    const sourceJobId = request.nextUrl.searchParams.get("sourceJobId");
    if (sourceJobId) {
      const job = listMaterialJobs().find(item => item.sourceJobId === sourceJobId);
      return NextResponse.json(job ? { success: true, data: await materialJobView(job) } : { success: false, error: "요청에 연결된 소재 작업이 없습니다." }, { status: job ? 200 : 404 });
    }
    if (request.nextUrl.searchParams.get("jobsOnly") === "1") return NextResponse.json({ success: true, data: { jobs: listMaterialJobs().slice(0, 50) } });
    const kind = request.nextUrl.searchParams.get("connectKind")?.toUpperCase();
    const products = await prisma.brandLink.findMany({ orderBy: { createdAt: "desc" },
      ...(kind === "SHOPPING" || kind === "TRAVEL" ? { where: { connectKind: kind } } : {}),
      select: { id: true, productName: true, status: true, connectKind: true },
    });
    const materials = products.flatMap(product => {
      const material = readMaterialView(product);
      return material ? [material] : [];
    });
    return NextResponse.json({ success: true, data: { materials, jobs: listMaterialJobs().slice(0, 50) } });
  } catch (error) { return NextResponse.json({ success: false, error: (error as Error).message }, { status: 400 }); }
}

export async function materialsPost(request: NextRequest, kind: "prepare" | "publish", override?: Record<string, unknown>) {
  const auth = requireAdminApiKey(request); if (auth) return auth;
  const update = requireNoPendingDesktopUpdate(); if (update) return update;
  let release: (() => void) | undefined;
  let finish: (() => void) | undefined;
  try {
    const body = override ?? await request.json();
    const items: MaterialJob["items"] = kind === "publish"
      ? validateMaterialSelection(body.materials).map(item => ({ ...item, status: "queued", stage: "선택 소재 확인 대기" }))
      : (() => {
        if (!Array.isArray(body.productIds) || !body.productIds.length || body.productIds.length > 50 ||
          body.productIds.some((id: unknown) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) || new Set(body.productIds).size !== body.productIds.length) {
          throw new Error("소재를 준비할 상품 ID를 중복 없이 1~50개 선택하세요.");
        }
        return body.productIds.map((productId: string) => ({ productId, status: "queued" as const, stage: "소재 준비 대기" }));
      })();
    if (kind === "publish") {
      if (!["now", "schedule"].includes(body.publishMode)) throw new Error("발행 방법을 선택하세요.");
      if (body.publishMode === "schedule") {
        const date = body.scheduledAt ?? body.scheduledDate ?? body.startDate;
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
          throw new Error("예약 시작일은 내일 이후의 유효한 날짜(한국시간)여야 합니다.");
        }
        const interval = body.intervalDays ?? 1;
        if (!Number.isInteger(interval) || interval < 1 || interval > 30) throw new Error("예약 간격은 1~30일이어야 합니다.");
        items.forEach((item, index) => { item.scheduledDate = addDaysToYmd(date, index * interval); });
      }
    }
    const sourceJobId = typeof body.sourceJobId === "string" ? body.sourceJobId.slice(0, 160) : undefined;
    const requestHash = crypto.createHash("sha256").update(JSON.stringify({ kind, items, publishMode: body.publishMode })).digest("hex");
    if (sourceJobId) {
      const existing = listMaterialJobs().find(job => job.sourceJobId === sourceJobId);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error("같은 요청 ID에 다른 소재 선택을 보낼 수 없습니다.");
        return NextResponse.json({ success: true, data: existing });
      }
    }
    if (kind === "publish" && body.publishMode === "schedule" && items[0].scheduledDate! <= ymdInTimeZone(new Date(), "Asia/Seoul")) {
      throw new Error("예약 시작일은 내일 이후여야 합니다 (한국시간).");
    }
    const job: MaterialJob = { jobId: crypto.randomUUID(), kind, status: "running", ownerPid: process.pid, sourceJobId, requestHash, events: [],
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items,
      ...(kind === "publish" ? { publishMode: body.publishMode } : {}) };
    release = acquireMaterialJobLock(job.jobId);
    finish = beginAutomaticPublishing("automatic-post");
    if (await prisma.brandLink.count({ where: { status: { in: ["PUBLISHING", "DRAFTING"] } } })) throw new Error("현재 실행 중인 작업이 있습니다. 완료 후 실행하세요.");
    for (const item of items) {
      const product = await prisma.brandLink.findUnique({ where: { id: item.productId }, select: { status: true } });
      if (!product || !["READY", "FAILED"].includes(product.status)) throw new Error(`선택 상품을 실행할 수 없습니다: ${item.productId} (${product?.status || "없음"})`);
      if (kind === "publish") {
        const material = getMaterial(item.productId);
        if (!material?.ready) throw new Error(`소재 준비를 먼저 완료하세요: ${material?.blockers.join(" ") || item.productId}`);
        if (material.revision !== item.revision) throw new Error("선택 후 소재가 변경되었습니다. 최신 소재를 다시 선택하세요.");
      }
    }
    saveMaterialJob(job);
    const unlock = release; const finishActivity = finish;
    void runMaterialJob(job).catch(error => {
      job.status = "failed"; job.completedAt = new Date().toISOString();
      const failureCodes = materialJobFailureCodes(error);
      for (const item of job.items) if (["queued", "preparing", "publishing"].includes(item.status)) {
        item.status = item.status === "publishing" ? "outcome_unknown" : "interrupted";
        item.error = materialJobErrorMessage(error);
        Object.assign(item, failureCodes);
      }
      saveMaterialJob(job);
    }).finally(() => { finishActivity(); unlock(); });
    release = undefined; finish = undefined;
    return NextResponse.json({ success: true, data: job }, { status: 202 });
  } catch (error) {
    finish?.(); release?.();
    return NextResponse.json({ success: false, code: kind === "publish" ? "MATERIAL_SELECTION_REQUIRED" : "MATERIAL_PREPARATION_FAILED", error: (error as Error).message }, { status: 409 });
  }
}

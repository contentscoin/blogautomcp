import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { beginAutomaticPublishing, automaticPublishingCancellationCheck } from "@/lib/desktop-activity";
import { prisma } from "@/lib/db";
import { runAutomaticDraftWorkflow, localScheduleCall } from "../../../../../../scripts/lib/scheduled-draft-workflow";

type Job = { status: "running" | "completed" | "failed"; stage: string; error?: string; result?: unknown };
const shared = globalThis as typeof globalThis & { automaticPostJobs?: Map<string, Job> };
const jobs = shared.automaticPostJobs ??= new Map<string, Job>();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdminApiKey(request);
  if (auth) return auth;
  const { id } = await params;
  const job = jobs.get(id);
  return NextResponse.json(job ? { success: true, data: job } : {
    success: false, code: "JOB_NOT_FOUND",
    error: "작업 기록이 없습니다. 앱이 재시작되었다면 발행 상태를 확인하세요. 중복 발행 방지를 위해 자동 재시작하지 않습니다.",
  }, { status: job ? 200 : 404 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdminApiKey(request);
  if (auth) return auth;
  const update = requireNoPendingDesktopUpdate();
  if (update) return update;
  const { id } = await params;
  let body: { publishMode?: string; scheduledDate?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 }); }
  if (body.publishMode !== "now" && body.publishMode !== "schedule") {
    return NextResponse.json({ success: false, error: "발행 모드를 지정하세요." }, { status: 400 });
  }
  if (body.publishMode === "schedule" && (!body.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate) ||
      !Number.isFinite(Date.parse(body.scheduledDate)) || new Date(body.scheduledDate).toISOString().slice(0, 10) !== body.scheduledDate)) {
    return NextResponse.json({ success: false, error: "유효한 예약일(YYYY-MM-DD)을 지정하세요." }, { status: 400 });
  }
  const product = await prisma.brandLink.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ success: false, error: "상품이 없습니다." }, { status: 404 });
  if (!["READY", "FAILED"].includes(product.status) || [...jobs.values()].some(job => job.status === "running") ||
      await prisma.brandLink.count({ where: { status: { in: ["PUBLISHING", "DRAFTING"] } } })) {
    return NextResponse.json({ success: false, error: "진행 중이거나 이미 발행된 작업입니다. 현재 작업 완료 후 실행하세요." }, { status: 409 });
  }
  const job: Job = { status: "running", stage: "초안 준비" };
  let finish: () => void;
  try { finish = beginAutomaticPublishing("automatic-post"); }
  catch (error) { return NextResponse.json({ success: false, error: (error as Error).message }, { status: 409 }); }
  jobs.set(id, job);
  const checkCancelled = automaticPublishingCancellationCheck();
  const publication = body.publishMode === "schedule"
    ? { publishMode: "schedule" as const, scheduledDate: body.scheduledDate }
    : { publishMode: "now" as const };
  void runAutomaticDraftWorkflow(id, publication, {
    pause: () => new Promise(resolve => setTimeout(resolve, 3000)),
    call: async (url, method, payload) => {
      checkCancelled();
      if (method !== "GET") job.stage = url.endsWith("/publish") ? "발행 결과 확인" :
        url.endsWith("/images") ? "이미지 보충" : "초안 작성·자동 검수·보강";
      return localScheduleCall(url, method, payload);
    },
  }).then(result => { job.status = "completed"; job.stage = "완료"; job.result = result; })
    .catch((error: Error) => { job.status = "failed"; job.error = error.message; })
    .finally(finish);
  return NextResponse.json({ success: true, data: { ...job, productId: id, publishMode: body.publishMode } }, { status: 202 });
}

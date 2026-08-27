import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { clearRemoteActivation, readRemoteActivation } from "@/lib/remote-activation";

type Job = { id: string; type: string; input: Record<string, unknown> };

function config() {
  const activation = readRemoteActivation();
  return { siteUrl: activation.siteUrl, token: activation.deviceToken };
}

async function localApi(request: NextRequest, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  // 서버가 자기 자신을 호출하는 요청이라 브라우저가 붙여주는 Origin/sec-fetch-site가
  // 없다. ADMIN_API_KEY가 설정되지 않은 데스크톱에서는 requireTrustedLocalMutation이
  // 이 부재를 외부 요청으로 보고 403을 돌려줘 MCP 작업이 전부 실패했다.
  // 같은 오리진에서 시작한 요청임을 정확히 표시한다.
  headers.set("origin", request.nextUrl.origin);
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (adminKey) headers.set("x-admin-api-key", adminKey);
  const response = await fetch(new URL(path, request.nextUrl.origin), { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) throw new Error(typeof payload?.error === "string" ? payload.error : JSON.stringify(payload?.error || `Local API ${response.status}`));
  return payload;
}

async function executeJob(request: NextRequest, job: Job): Promise<unknown> {
  const input = job.input || {};
  const kind = input.connectKind === "travel" ? "TRAVEL" : "SHOPPING";
  if (job.type === "BRANDCONNECT_LIST_PRODUCTS") {
    const status = typeof input.status === "string" ? input.status.toUpperCase() : "ALL";
    const links = await prisma.brandLink.findMany({ where: { connectKind: kind, ...(status !== "ALL" ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    return { connectKind: kind.toLowerCase(), count: links.length, products: links.map((item) => ({ id: item.id, productName: item.productName, storeName: item.storeName, price: item.productPrice, status: item.status, url: item.url, postUrl: item.postUrl })) };
  }
  if (job.type === "BRANDCONNECT_SYNC_PRODUCTS") {
    const count = typeof input.count === "number" && Number.isInteger(input.count)
      ? Math.min(50, Math.max(1, input.count))
      : 10;
    return localApi(request, "/api/brandlinks/bulk-seasonal", {
      method: "POST",
      body: JSON.stringify({ connectKind: kind.toLowerCase(), count }),
    });
  }
  if (job.type === "POST_CREATE_DRAFT") {
    const productId = typeof input.productId === "string" ? input.productId : "";
    if (!productId) throw new Error("productId가 필요합니다.");
    const product = await prisma.brandLink.findUnique({ where: { id: productId }, select: { connectKind: true } });
    if (!product) throw new Error("선택한 상품을 찾을 수 없습니다.");
    if (product.connectKind !== kind) throw new Error("상품의 커넥트 종류가 요청과 일치하지 않습니다.");
    return localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/scrape`, { method: "POST", body: "{}" });
  }
  if (job.type === "POST_PUBLISH" || job.type === "POST_SCHEDULE") {
    const draftId = typeof input.draftId === "string" ? input.draftId : "";
    if (!draftId || input.confirmed !== true) throw new Error("발행 대상과 confirmed=true 확인이 필요합니다.");
    const schedule = job.type === "POST_SCHEDULE";
    const scheduledDate = typeof input.scheduledDate === "string" ? input.scheduledDate : "";
    if (schedule && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw new Error("scheduledDate는 YYYY-MM-DD 형식이어야 합니다.");
    return localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/publish`, { method: "POST", body: JSON.stringify(schedule ? { publishMode: "schedule", scheduledDate } : { publishMode: "now" }) });
  }
  throw new Error(`지원하지 않는 원격 작업입니다: ${job.type}`);
}

async function completeRemoteJob(
  siteUrl: string,
  token: string,
  jobId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${siteUrl}/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `원격 작업 완료 기록 실패 (${response.status})`);
  }
}

export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const remote = config();
  if (!remote.siteUrl || !remote.token) return NextResponse.json({ success: true, data: { configured: false, job: null } });
  if (process.env.DESKTOP_UPDATE_INSTALL_PENDING === '1') {
    return NextResponse.json({ success: true, data: { configured: true, job: null, updatePending: true } });
  }
  const auth = { authorization: `Bearer ${remote.token}`, "content-type": "application/json" };
  const claimResponse = await fetch(`${remote.siteUrl}/api/agent/jobs/claim`, { method: "POST", headers: auth, body: "{}", cache: "no-store" }).catch(() => null);
  if (!claimResponse) return NextResponse.json({ success: false, error: "사이트 작업 채널에 연결할 수 없습니다." }, { status: 502 });
  const claimed = await claimResponse.json().catch(() => null);
  if (!claimResponse.ok) {
    if (claimResponse.status === 401 || claimResponse.status === 403) clearRemoteActivation();
    return NextResponse.json({ success: false, error: claimed?.error?.message || "PC 인증이 폐기되었습니다.", code: claimed?.error?.code }, { status: claimResponse.status });
  }
  const job = claimed?.data as Job | null;
  if (!job) return NextResponse.json({ success: true, data: { configured: true, job: null } });
  try {
    const result = await executeJob(request, job);
    await completeRemoteJob(remote.siteUrl, remote.token, job.id, { status: "SUCCEEDED", result });
    return NextResponse.json({ success: true, data: { configured: true, job: { id: job.id, status: "SUCCEEDED" } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "로컬 작업 실행 실패";
    await completeRemoteJob(remote.siteUrl, remote.token, job.id, { status: "FAILED", errorCode: "LOCAL_AUTOMATION_FAILED", errorMessage: message }).catch(() => undefined);
    return NextResponse.json({ success: false, error: message, data: { job: { id: job.id, status: "FAILED" } } }, { status: 500 });
  }
}

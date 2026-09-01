import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { getCodexLoginJob, readCodexLocalStatus, startCodexLogin } from "@/lib/codex-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getCodexLoginJob(jobId);
    if (!job) return NextResponse.json({ success: false, error: "Codex 로그인 작업을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ success: true, data: { job, codex: readCodexLocalStatus() } });
  }
  return NextResponse.json({ success: true, data: readCodexLocalStatus() });
}
export async function POST(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const status = readCodexLocalStatus();
  if (status.authenticated) {
    return NextResponse.json({ success: true, data: { codex: status, job: null }, message: "Codex가 이미 연결되어 있습니다." });
  }
  try {
    const job = startCodexLogin();
    return NextResponse.json({
      success: true,
      data: { job, codex: status },
      message: "브라우저에서 Codex 로그인을 완료해 주세요.",
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Codex 로그인을 시작하지 못했습니다." }, { status: 500 });
  }
}

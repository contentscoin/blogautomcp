import { NextRequest, NextResponse } from "next/server";
import { materialsPost } from "@/lib/material-api";
import { requireAdminApiKey } from "@/lib/api-auth";
import { listMaterialJobs } from "@/lib/material-job-store";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdminApiKey(request); if (auth) return auth;
  const { id } = await params;
  const job = listMaterialJobs().find(job => job.kind === "publish" && job.items.some(item => item.productId === id));
  return NextResponse.json(job ? { success: true, data: { ...job, stage: job.items.find(item => item.productId === id)?.stage } } : { success: false, error: "발행 작업 기록이 없습니다. 준비된 소재를 선택하세요." }, { status: job ? 200 : 404 });
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdminApiKey(request); if (auth) return auth;
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 }); }
  return materialsPost(request, "publish", { ...body, materials: [{ productId: id, revision: body.materialRevision }] });
}

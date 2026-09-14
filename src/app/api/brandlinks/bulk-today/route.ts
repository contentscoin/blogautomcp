import { NextRequest, NextResponse } from "next/server";
import { materialsGet, materialsPost } from "@/lib/material-api";
export const GET = materialsGet;
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 }); }
  return materialsPost(request, "publish", { ...body, publishMode: "now" });
}

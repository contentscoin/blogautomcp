import { NextRequest, NextResponse } from "next/server";
import {
  adminSessionCookieOptions,
  adminSessionTokenFor,
  configuredAdminApiKey,
  hasValidAdminSessionCookie,
  isCrossSiteBrowserRequest,
  safeCompare,
} from "@/lib/admin-session";
import { isDevelopmentLocalRequest } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** 대시보드가 관리자 키 입력이 필요한지 확인한다. 키 자체는 절대 돌려주지 않는다. */
export async function GET(request: NextRequest) {
  const apiKey = configuredAdminApiKey();
  const required = Boolean(apiKey) && !isDevelopmentLocalRequest(request);
  const authenticated = !required || hasValidAdminSessionCookie(request, apiKey);
  return NextResponse.json({ success: true, data: { required, authenticated } });
}

/** 관리자 키를 검증하고 HttpOnly 세션 쿠키를 발급한다. */
export async function POST(request: NextRequest) {
  const apiKey = configuredAdminApiKey();
  if (!apiKey) {
    return NextResponse.json({ success: true, data: { required: false, authenticated: true } });
  }
  if (isCrossSiteBrowserRequest(request)) {
    return NextResponse.json({ success: false, error: "다른 출처에서 시작한 요청입니다." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const provided = typeof body.key === "string" ? body.key.trim() : "";
  if (!provided || !safeCompare(provided, apiKey)) {
    return NextResponse.json({ success: false, code: "ADMIN_KEY_INVALID", error: "관리자 키가 일치하지 않습니다." }, { status: 401 });
  }
  const response = NextResponse.json({ success: true, data: { required: true, authenticated: true } });
  response.cookies.set({ ...adminSessionCookieOptions(request), value: adminSessionTokenFor(apiKey) });
  return response;
}

/** 세션 쿠키를 지운다. */
export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set({ ...adminSessionCookieOptions(request), value: "", maxAge: 0 });
  return response;
}

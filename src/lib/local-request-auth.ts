import { NextRequest, NextResponse } from "next/server";
import {
  configuredAdminApiKey,
  isAuthenticatedAdminRequest,
  isCrossSiteBrowserRequest,
  isRebindingSafeHost,
  isSameRequestOrigin,
  LOCAL_HOST_REJECTED_MESSAGE,
} from "./admin-session";

/**
 * Remote-agent mutations hold a reusable device credential.
 *
 * With ADMIN_API_KEY configured the caller must prove it is an admin (header key
 * or dashboard session cookie) — origin headers alone are not a credential.
 * Without a key (default local install) only browser-supplied same-origin
 * signals are checked so a foreign web page cannot trigger these mutations,
 * and a Host that is an unlisted DNS name is refused (DNS rebinding).
 */
export function requireTrustedLocalMutation(request: NextRequest): NextResponse | null {
  const configuredKey = configuredAdminApiKey();
  if (configuredKey) {
    if (isAuthenticatedAdminRequest(request, configuredKey)) return null;
    return NextResponse.json(
      { success: false, code: "ADMIN_AUTH_REQUIRED", error: "관리자 인증이 필요합니다. x-admin-api-key 헤더를 붙이거나 대시보드에서 관리자 키를 입력하세요." },
      { status: 401 },
    );
  }

  if (!isRebindingSafeHost(request)) {
    return NextResponse.json({ success: false, code: "LOCAL_REQUEST_REQUIRED", error: LOCAL_HOST_REJECTED_MESSAGE }, { status: 403 });
  }
  if (isCrossSiteBrowserRequest(request)) {
    return NextResponse.json(
      { success: false, error: "로컬 앱에서 시작한 요청만 허용됩니다." },
      { status: 403 },
    );
  }
  if (isSameRequestOrigin(request, request.headers.get("origin"))) return null;
  if (isSameRequestOrigin(request, request.headers.get("referer"))) return null;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return null;

  return NextResponse.json(
    { success: false, error: "로컬 앱에서 시작한 요청만 허용됩니다." },
    { status: 403 },
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { getSiteUrl } from "@/lib/env";
import { apiError, hasValidBrowserOrigin, requestBodyWithinLimit } from "@/lib/http";
import { validateAuthorizationRequest } from "@/lib/oauth-request";

export async function POST(request: NextRequest) {
  if (!hasValidBrowserOrigin(request)) return apiError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  if (!requestBodyWithinLimit(request, 16 * 1024)) return apiError("REQUEST_TOO_LARGE", "요청이 너무 큽니다.", 413);
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("INVALID_OAUTH_REQUEST", "OAuth 요청 형식이 올바르지 않습니다.", 400);
  }
  const raw: Record<string, string> = {};
  for (const key of ["client_id", "redirect_uri", "response_type", "state", "resource", "scope", "code_challenge", "code_challenge_method"]) {
    const value = form.get(key);
    if (typeof value === "string") raw[key] = value;
  }
  const validated = await validateAuthorizationRequest(raw, user.id);
  if ("error" in validated) return apiError("INVALID_OAUTH_REQUEST", validated.error, 400);
  const code = randomToken(32);
  await db.oAuthAuthorizationCode.create({ data: { codeHash: hashToken(code), userId: user.id, clientId: validated.request.clientId, connectionId: validated.connectionId, redirectUri: validated.request.redirectUri, resource: validated.request.resource, scope: validated.request.scope, codeChallenge: validated.request.codeChallenge, expiresAt: new Date(Date.now() + 5 * 60 * 1000) } });
  const target = new URL(validated.request.redirectUri);
  target.searchParams.set("code", code);
  if (validated.request.state) target.searchParams.set("state", validated.request.state);
  target.searchParams.set("iss", getSiteUrl());
  return NextResponse.redirect(target, 303);
}

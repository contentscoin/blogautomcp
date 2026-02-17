import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

function safeCompare(input: string, expected: string): boolean {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

function unauthorized(message: string) {
  return NextResponse.json(
    { success: false, error: message },
    { status: 401 }
  );
}

export function requireAdminApiKey(request: NextRequest): NextResponse | null {
  const configuredKey = process.env.ADMIN_API_KEY?.trim();
  if (!configuredKey) {
    return null;
  }

  // 브라우저 대시보드의 same-origin 요청은 허용
  const origin = request.headers.get("origin");
  if (origin && origin === request.nextUrl.origin) {
    return null;
  }

  const providedKey = request.headers.get("x-admin-api-key")?.trim();
  if (providedKey && safeCompare(providedKey, configuredKey)) {
    return null;
  }

  return unauthorized("관리자 인증이 필요합니다. x-admin-api-key 헤더를 확인하세요.");
}

export function requireCronSecret(request: NextRequest): NextResponse | null {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) {
    return null;
  }

  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  const candidate = headerSecret || bearer;

  if (candidate && safeCompare(candidate, configuredSecret)) {
    return null;
  }

  return unauthorized("크론 인증이 필요합니다. x-cron-secret 또는 Authorization 헤더를 확인하세요.");
}

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const LOCAL_ALIASES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

interface HostParts {
  hostname: string;
  port: string;
}

function parseHostParts(hostHeader: string | null): HostParts | null {
  if (!hostHeader) return null;

  const trimmed = hostHeader.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    const closing = trimmed.lastIndexOf("]");
    const hostname = trimmed.slice(1, closing).toLowerCase();
    const port = trimmed.slice(closing + 1).replace(/^:/, "");
    return { hostname, port };
  }

  const [hostname, port] = trimmed.split(":", 2);
  return {
    hostname: hostname.toLowerCase(),
    port: port || "",
  };
}

function isDevelopmentLocalRequest(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const nextHost = parseHostParts(request.nextUrl.host);
  if (nextHost && LOCAL_ALIASES.has(nextHost.hostname)) {
    return true;
  }

  const headerHost = parseHostParts(request.headers.get("host"));
  if (
    headerHost &&
    isLocalEquivalent(
      headerHost.hostname,
      headerHost.port,
      nextHost?.hostname ?? "",
      nextHost?.port ?? "",
    )
  ) {
    return true;
  }

  const forwardedHost = parseHostParts(request.headers.get("x-forwarded-host"));
  if (
    forwardedHost &&
    isLocalEquivalent(
      forwardedHost.hostname,
      forwardedHost.port,
      nextHost?.hostname ?? "",
      nextHost?.port ?? "",
    )
  ) {
    return true;
  }

  return false;
}

/**
 * 서버가 실제로 응답 중인 호스트(nextUrl.host)만 신뢰해 루프백 여부를 판정한다.
 * 위조 가능한 x-forwarded-host/Host 헤더에 의존하지 않으므로, 패키징된 데스크톱
 * 앱(127.0.0.1 바인딩)은 통과시키되 원격 노출 요청은 통과시키지 않는다.
 */
function isLoopbackRequest(request: NextRequest): boolean {
  const nextHost = parseHostParts(request.nextUrl.host);
  return !!(nextHost && LOCAL_ALIASES.has(nextHost.hostname));
}

function isLocalEquivalent(hostnameA: string, portA: string, hostnameB: string, portB: string): boolean {
  const normalizedA = hostnameA.toLowerCase();
  const normalizedB = hostnameB.toLowerCase();

  if (LOCAL_ALIASES.has(normalizedA) && LOCAL_ALIASES.has(normalizedB)) {
    return true;
  }

  if (normalizedA === normalizedB && (portA === "" || portB === "" || portA === portB)) {
    return true;
  }

  return false;
}

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
  if (isDevelopmentLocalRequest(request)) {
    return null;
  }

  const configuredKey = process.env.ADMIN_API_KEY?.trim();
  if (!configuredKey) {
    // fail-closed: 키 미설정 시 루프백(데스크톱/로컬)만 허용하고 원격 요청은 차단.
    if (isLoopbackRequest(request)) {
      return null;
    }
    return unauthorized(
      "서버에 ADMIN_API_KEY가 설정되지 않아 원격 접근이 차단되었습니다. 환경변수를 설정하세요."
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.origin === request.nextUrl.origin) {
        return null;
      }

      if (
        isLocalEquivalent(
          originUrl.hostname,
          originUrl.port,
          request.nextUrl.hostname,
          request.nextUrl.port,
        )
      ) {
        return null;
      }
    } catch {
      // ignore
    }
  }

  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      const refererUrl = new URL(refererOrigin);
      if (
        refererOrigin === request.nextUrl.origin ||
        isLocalEquivalent(
          refererUrl.hostname,
          refererUrl.port,
          request.nextUrl.hostname,
          request.nextUrl.port,
        )
      ) {
        return null;
      }
    } catch {
      // ignore
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin && (fetchSite === "same-origin" || fetchSite === "same-site")) {
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
    // fail-closed: 운영에서 시크릿 미설정 시 루프백(로컬 수동 트리거)만 허용.
    if (process.env.NODE_ENV !== "production" || isLoopbackRequest(request)) {
      return null;
    }
    return unauthorized(
      "서버에 CRON_SECRET이 설정되지 않아 크론 트리거가 차단되었습니다. 환경변수를 설정하세요."
    );
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

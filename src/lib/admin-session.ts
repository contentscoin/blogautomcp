import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";

/**
 * 대시보드용 관리자 세션.
 *
 * ADMIN_API_KEY 가 설정되면 모든 관리자 API 는 실제 자격 증명을 요구한다.
 * 외부 스크립트는 x-admin-api-key 헤더를 쓰고, 브라우저 대시보드는 키를 한 번 입력해
 * HttpOnly 쿠키(키에서 파생한 HMAC)를 받는다. Origin/Referer 같은 요청 출처 헤더는
 * 누구나 붙일 수 있으므로 인증 근거로 쓰지 않는다.
 */
export const ADMIN_SESSION_COOKIE = "blogautomcp_admin_session";
const SESSION_PURPOSE = "blogautomcp-admin-session/v1";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const LOCAL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

function requestHostUrl(request: NextRequest): URL | null {
  const host = request.headers.get("host")?.trim();
  if (!host) return null;
  try {
    return new URL(`${request.nextUrl.protocol}//${host}`);
  } catch {
    return null;
  }
}

/**
 * Next custom servers can expose a different public host/port from the URL that
 * NextRequest internally constructs. Compare both Next's URL and the actual
 * inbound Host header, while treating loopback aliases as equivalent only on
 * the same protocol and port.
 */
export function isSameRequestOrigin(request: NextRequest, value: string | null): boolean {
  if (!value || value === "null") return false;
  try {
    const supplied = new URL(value);
    const inboundHost = requestHostUrl(request);
    // Host is the public request target seen by the HTTP server. Only fall back
    // to Next's internal URL when the adapter did not preserve that header.
    const candidates = inboundHost ? [inboundHost] : [request.nextUrl];
    return candidates.some((candidate) => {
      if (supplied.origin === candidate.origin) return true;
      return (
        LOCAL_LOOPBACK_HOSTS.has(supplied.hostname.toLowerCase()) &&
        LOCAL_LOOPBACK_HOSTS.has(candidate.hostname.toLowerCase()) &&
        supplied.protocol === candidate.protocol &&
        effectivePort(supplied) === effectivePort(candidate)
      );
    });
  } catch {
    return false;
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1");
}

/** .env 항목은 "이름", "이름:포트", "http://이름:포트" 어느 형태로 적어도 호스트 이름만 비교한다. */
function configuredHostname(entry: string): string {
  const value = entry.trim();
  if (!value) return "";
  try {
    return normalizedHostname(new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ? value : `http://${value}`).hostname);
  } catch {
    return "";
  }
}

export const LOCAL_HOST_REJECTED_MESSAGE =
  "허용되지 않은 주소로 들어온 요청입니다. 앱은 127.0.0.1 또는 localhost 주소로 여세요. " +
  "다른 호스트 이름으로 접속하려면 .env의 LOCAL_ALLOWED_HOSTS에 그 이름을 추가하거나 ADMIN_API_KEY를 설정하세요.";
export const CROSS_SITE_REJECTED_MESSAGE =
  "다른 사이트에서 보낸 브라우저 요청은 허용되지 않습니다. 앱 화면에서 실행하세요. " +
  "외부 도구에서 호출하려면 ADMIN_API_KEY를 설정하고 x-admin-api-key 헤더를 붙이세요.";

/**
 * DNS 리바인딩 방어: 브라우저는 공격자 도메인을 127.0.0.1로 돌려도 Host 헤더에
 * 공격자 도메인 이름을 그대로 싣는다. 그 경우 Origin과 Host가 서로 같아 동일 출처 검사만으로는
 * 막히지 않는다. 리바인딩은 DNS 이름으로만 가능하므로 Host가 IP 주소이거나 localhost이면
 * 통과시키고(같은 PC·같은 공유기의 IP 접속은 그대로 동작), 그 밖의 이름은
 * APP_HOST·LOCAL_ALLOWED_HOSTS에 명시한 것만 받는다. 해석할 수 없는 Host는 거부한다.
 */
export function isRebindingSafeHost(request: NextRequest): boolean {
  const inbound = request.headers.get("host")?.trim() ? requestHostUrl(request) : request.nextUrl;
  if (!inbound) return false;
  const hostname = normalizedHostname(inbound.hostname);
  if (!hostname) return false;
  if (hostname === "localhost" || isIP(hostname) !== 0) return true;
  return [process.env.APP_HOST || "", ...(process.env.LOCAL_ALLOWED_HOSTS || "").split(",")]
    .map(configuredHostname).includes(hostname);
}

export function configuredAdminApiKey(): string {
  return process.env.ADMIN_API_KEY?.trim() || "";
}

export function safeCompare(input: string, expected: string): boolean {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  if (inputBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(inputBuffer, expectedBuffer);
}

/** 키에서 파생한 세션 토큰. 키를 바꾸면 기존 세션은 모두 무효가 된다. */
export function adminSessionTokenFor(apiKey: string): string {
  return createHmac("sha256", apiKey).update(SESSION_PURPOSE).digest("hex");
}

export function hasValidAdminApiKeyHeader(request: NextRequest, apiKey: string): boolean {
  const provided = request.headers.get("x-admin-api-key")?.trim();
  return Boolean(provided && safeCompare(provided, apiKey));
}

export function hasValidAdminSessionCookie(request: NextRequest, apiKey: string): boolean {
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value?.trim();
  return Boolean(cookie && safeCompare(cookie, adminSessionTokenFor(apiKey)));
}

/**
 * 쿠키 기반 세션은 브라우저가 자동으로 붙이므로 CSRF 를 막기 위해 브라우저가 붙이는
 * 출처 헤더가 앱과 다르면 거부한다. (인증이 아니라 쿠키 세션의 보조 검사다.)
 */
export function isCrossSiteBrowserRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && !isSameRequestOrigin(request, origin)) return true;
  return false;
}

/** 헤더 키 또는 (CSRF 검사를 통과한) 세션 쿠키로 관리자임을 증명했는지. */
export function isAuthenticatedAdminRequest(request: NextRequest, apiKey: string): boolean {
  if (hasValidAdminApiKeyHeader(request, apiKey)) return true;
  return hasValidAdminSessionCookie(request, apiKey) && !isCrossSiteBrowserRequest(request);
}

export function adminSessionCookieOptions(request: NextRequest) {
  return {
    name: ADMIN_SESSION_COOKIE,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  };
}

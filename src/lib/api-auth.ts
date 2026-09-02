import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasRemoteActivation } from "./remote-activation";
import { configuredAdminApiKey, isAuthenticatedAdminRequest } from "./admin-session";

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

export function isDevelopmentLocalRequest(request: NextRequest): boolean {
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

function unauthorized(message: string, code = "UNAUTHORIZED") {
  return NextResponse.json(
    { success: false, code, error: message },
    { status: 401 }
  );
}

export const ADMIN_AUTH_REQUIRED_CODE = "ADMIN_AUTH_REQUIRED";

/**
 * 관리자 API 인증.
 *
 * ADMIN_API_KEY 가 설정된 경우 요청은 x-admin-api-key 헤더 또는 대시보드 세션 쿠키
 * (/api/admin-session 에서 키를 입력해 발급)로 관리자임을 증명해야 한다.
 * Origin/Referer/Sec-Fetch-Site 는 요청 출처를 나타낼 뿐 누구나 붙일 수 있으므로
 * 키를 대신하지 못한다. 키가 없으면(기본 로컬 사용) 종전처럼 열려 있다.
 */
export function requireAdminApiKey(request: NextRequest): NextResponse | null {
  const activationError = requireRemoteActivation(request);
  if (activationError) return activationError;

  if (isDevelopmentLocalRequest(request)) {
    return null;
  }

  const configuredKey = configuredAdminApiKey();
  if (!configuredKey) {
    return null;
  }

  if (isAuthenticatedAdminRequest(request, configuredKey)) {
    return null;
  }

  return unauthorized(
    "관리자 인증이 필요합니다. x-admin-api-key 헤더를 붙이거나 대시보드에서 관리자 키를 입력하세요.",
    ADMIN_AUTH_REQUIRED_CODE,
  );
}

export function requireCronSecret(request: NextRequest): NextResponse | null {
  const activationError = requireRemoteActivation(request);
  if (activationError) return activationError;

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

export function requireRemoteActivation(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname === "/api/remote-agent" || request.nextUrl.pathname.startsWith("/api/remote-agent/")) {
    return null;
  }
  if (hasRemoteActivation()) return null;
  return NextResponse.json(
    { success: false, code: "MCP_ACTIVATION_REQUIRED", error: "사이트에서 발급한 MCP 주소로 이 PC를 먼저 연결하세요." },
    { status: 428 },
  );
}

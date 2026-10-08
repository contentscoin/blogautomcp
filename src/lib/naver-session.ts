import fs from "fs";
import { request as playwrightRequest, type APIRequestContext, type BrowserContext } from "playwright";
import { getNaverSessionFile } from "../../scripts/lib/app-paths";
import { readNaverSessionFingerprint, readNaverSessionSnapshot, saveRefreshedNaverSession, type NaverSessionSnapshot } from "../../scripts/lib/naver-session-state";

export { getNaverSessionFile };

export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  expires?: number;
}

interface PlaywrightStorageState {
  cookies?: StoredCookie[];
}

export interface NaverSessionValidation {
  valid: boolean;
  status: "valid" | "auth-required" | "forbidden" | "unknown" | "configuration";
  authRequired: boolean;
  code?: "NAVER_SESSION_EXPIRED" | "NAVER_SESSION_FORBIDDEN" | "NAVER_SESSION_CHECK_FAILED" | "NAVER_SESSION_CONFIGURATION_REQUIRED";
  error?: string;
  warning?: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function isDomainMatch(hostname: string, cookieDomain: string): boolean {
  const normalized = cookieDomain.replace(/^\./, "").toLowerCase();
  const host = hostname.toLowerCase();
  return host === normalized || (cookieDomain.startsWith(".") && host.endsWith(`.${normalized}`));
}

export function readUsableCookies(storageStatePath: string, hostname: string): StoredCookie[] {
  const parsed = JSON.parse(fs.readFileSync(storageStatePath, "utf-8")) as PlaywrightStorageState;
  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  return usableCookiesForHost(cookies, hostname);
}

function usableCookiesForHost(cookies: StoredCookie[], hostname: string): StoredCookie[] {
  const nowSec = Date.now() / 1000;
  return cookies.filter((cookie) => {
    if (!cookie.name || cookie.value === undefined || !cookie.domain) return false;
    if (!isDomainMatch(hostname, cookie.domain)) return false;
    if (cookie.expires === undefined) return true; // Legacy metadata is checked by the request context, never treated as expiry by itself.
    return typeof cookie.expires === "number" && Number.isFinite(cookie.expires) && (cookie.expires === -1 || cookie.expires > nowSec);
  });
}

/**
 * 해당 호스트로 보낼 쿠키 헤더. 호스트를 그대로 받으므로 gw-brandconnect처럼
 * 서브도메인이 다른 API에도 그 호스트 기준으로 정확히 계산된다.
 */
export function buildCookieHeaderForHost(storageStatePath: string, hostname: string): string {
  return readUsableCookies(storageStatePath, hostname)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

export function hasNaverAuthenticationCookies(cookies: StoredCookie[]): boolean {
  return ["NID_AUT", "NID_SES"].every((name) =>
    cookies.some((cookie) => cookie.name === name && typeof cookie.value === "string" && cookie.value.length > 0),
  );
}

/** The same response rules are used by Node fetch and a browser's cookie-aware request context. */
export async function inspectNaverPublishingResponse(response: {
  status: number;
  ok: boolean;
  url: string;
  redirectLocation?: string;
  text(): Promise<string>;
}): Promise<{ validation: NaverSessionValidation; data?: Record<string, unknown> }> {
  let loginRedirect = false;
  try {
    const redirectTarget = response.status >= 300 && response.status < 400 ? response.redirectLocation : undefined;
    const finalUrl = new URL(redirectTarget || response.url, response.url || undefined);
    loginRedirect = finalUrl.hostname === "nid.naver.com" && /^\/nidlogin\.login(?:\/|$)/i.test(finalUrl.pathname);
  } catch { /* Responses without a final URL are classified by their status and body. */ }
  if (response.status === 401 || loginRedirect) return { validation: {
    valid: false, status: "auth-required", authRequired: true,
    code: "NAVER_SESSION_EXPIRED", error: "네이버에서 로그인이 필요하다고 응답했습니다. 네이버 로그인을 다시 확인해 주세요.",
  } };
  if (response.status === 403) return { validation: {
    valid: false, status: "forbidden", authRequired: false,
    code: "NAVER_SESSION_FORBIDDEN", error: "네이버 글쓰기 접근이 거부되었습니다(HTTP 403). 블로그 ID·계정 권한·보안 제한을 확인해 주세요.",
  } };
  if (!response.ok) return { validation: {
    valid: false, status: "unknown", authRequired: false,
    code: "NAVER_SESSION_CHECK_FAILED", error: `네이버 글쓰기 상태를 확인하지 못했습니다(HTTP ${response.status}). 잠시 후 상태 확인을 다시 눌러 주세요.`,
  } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return { validation: {
      valid: false, status: "unknown", authRequired: false,
      code: "NAVER_SESSION_CHECK_FAILED", error: "네이버 상태 확인 응답을 읽을 수 없습니다. 저장된 세션은 유지됩니다. 잠시 후 다시 확인해 주세요.",
    } };
  }
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  return data?.isSuccess === true
    ? { validation: { valid: true, status: "valid", authRequired: false }, data }
    : { validation: {
        valid: false, status: "unknown", authRequired: false,
        code: "NAVER_SESSION_CHECK_FAILED", error: "네이버 블로그 글쓰기 권한을 확인하지 못했습니다. 블로그 ID와 상태 확인 응답을 확인해 주세요.",
      } };
}

export async function verifyNaverPublishingContext(context: Pick<BrowserContext, "request">, blogId: string): Promise<boolean> {
  if (!blogId.trim()) return false;
  try {
    const endpoint = `https://blog.naver.com/PostWriteFormManagerOptions.naver?blogId=${encodeURIComponent(blogId)}`;
    const response = await context.request.get(endpoint, {
      timeout: DEFAULT_TIMEOUT_MS, maxRedirects: 0, failOnStatusCode: false, maxRetries: 0,
      headers: { accept: "application/json, text/plain, */*" },
    });
    return (await inspectNaverPublishingResponse({
      status: response.status(), ok: response.ok(), url: response.url(),
      redirectLocation: response.headers().location, text: () => response.text(),
    })).validation.valid;
  } catch { return false; }
}

export async function validateNaverPublishingSession(
  storageStatePath: string,
  blogId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NaverSessionValidation> {
  return (await fetchNaverPublishingOptions(storageStatePath, blogId, timeoutMs)).validation;
}

export async function fetchNaverPublishingOptions(
  storageStatePath: string,
  blogId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ validation: NaverSessionValidation; data?: Record<string, unknown> }> {
  if (!blogId.trim()) return { validation: {
    valid: false, status: "configuration", authRequired: false,
    code: "NAVER_SESSION_CONFIGURATION_REQUIRED", error: "NAVER_BLOG_ID를 먼저 설정해 주세요.",
  } };

  let snapshot: NaverSessionSnapshot;
  let cookies: StoredCookie[];
  try {
    snapshot = readNaverSessionSnapshot(storageStatePath);
    cookies = usableCookiesForHost(snapshot.state.cookies, "blog.naver.com");
  } catch {
    return { validation: {
      valid: false, status: "unknown", authRequired: false,
      code: "NAVER_SESSION_CHECK_FAILED", error: "저장된 네이버 세션 파일을 읽을 수 없습니다. 파일 상태를 확인해 주세요.",
    } };
  }
  if (!hasNaverAuthenticationCookies(cookies)) {
    return { validation: {
      valid: false, status: "auth-required", authRequired: true,
      code: "NAVER_SESSION_EXPIRED", error: "사용 가능한 네이버 인증 쿠키가 없습니다. 네이버 로그인이 필요합니다.",
    } };
  }

  let api: APIRequestContext | undefined;
  try {
    api = await playwrightRequest.newContext({
      storageState: snapshot.state, timeout: timeoutMs,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const endpoint = `https://blog.naver.com/PostWriteFormManagerOptions.naver?blogId=${encodeURIComponent(blogId)}`;
    const response = await api.get(endpoint, {
      headers: { accept: "application/json, text/plain, */*" },
      timeout: timeoutMs, maxRedirects: 0, failOnStatusCode: false, maxRetries: 0,
    });
    const result = await inspectNaverPublishingResponse({
      status: response.status(), ok: response.ok(), url: response.url(),
      redirectLocation: response.headers().location, text: () => response.text(),
    });
    const { validation } = result;
    if (validation.valid) {
      let saveResult;
      try { saveResult = await saveRefreshedNaverSession(api, snapshot, async () => true, timeoutMs, { preserveOrigins: true }); }
      catch { saveResult = "unavailable"; }
      if (saveResult === "superseded") return { validation: {
        valid: false, status: "unknown", authRequired: false, code: "NAVER_SESSION_CHECK_FAILED",
        error: "확인 중 저장된 네이버 세션이 변경되었습니다. 새 세션의 상태를 다시 확인해 주세요.",
      } };
      if (saveResult === "unavailable" || saveResult === "unverified") validation.warning = "네이버 로그인은 확인됐지만 갱신된 세션을 저장하지 못했습니다. 기존 세션을 유지했습니다. PC 저장소 상태를 확인해 주세요.";
    }
    // Finish asynchronous cleanup before the final synchronous continuity check.
    try { await api.dispose(); } catch { /* Cleanup does not establish authentication. */ }
    api = undefined;
    // A failed capture/save can return before its CAS check. Re-check the file
    // even then, so an old account's proof cannot describe a newer manual login.
    let currentFingerprint: string | null = null;
    try { currentFingerprint = readNaverSessionFingerprint(storageStatePath); } catch { /* Unreadable current state remains unverified. */ }
    if (!currentFingerprint || currentFingerprint !== snapshot.fingerprint) return { validation: {
      valid: false, status: "unknown", authRequired: false, code: "NAVER_SESSION_CHECK_FAILED",
      error: "확인 중 저장된 네이버 세션이 변경되었거나 현재 파일을 읽을 수 없습니다. 새 세션의 상태를 다시 확인해 주세요.",
    } };
    return result;
  } catch (error) {
    const errorName = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    return { validation: {
      valid: false, status: "unknown", authRequired: false, code: "NAVER_SESSION_CHECK_FAILED",
      error: errorName === "AbortError" || errorName === "TimeoutError" ? "네이버 상태 확인 시간이 초과되었습니다. 저장된 세션은 유지됩니다. 잠시 후 다시 확인해 주세요." : "네이버 상태 확인 중 연결 오류가 발생했습니다. 저장된 세션은 유지됩니다. 잠시 후 다시 확인해 주세요.",
    } };
  } finally {
    try { await api?.dispose(); } catch { /* Cleanup must not change the observed authentication result. */ }
  }
}

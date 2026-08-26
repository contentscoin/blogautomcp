import fs from "fs";

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
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function isDomainMatch(hostname: string, cookieDomain: string): boolean {
  const normalized = cookieDomain.replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

export function readUsableCookies(storageStatePath: string, hostname: string): StoredCookie[] {
  const parsed = JSON.parse(fs.readFileSync(storageStatePath, "utf-8")) as PlaywrightStorageState;
  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const nowSec = Date.now() / 1000;

  return cookies.filter((cookie) => {
    if (!cookie.name || cookie.value === undefined || !cookie.domain) return false;
    if (!isDomainMatch(hostname, cookie.domain)) return false;
    return !(typeof cookie.expires === "number" && cookie.expires > 0 && cookie.expires <= nowSec);
  });
}

export async function validateNaverPublishingSession(
  storageStatePath: string,
  blogId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NaverSessionValidation> {
  if (!blogId.trim()) return { valid: false, error: "NAVER_BLOG_ID가 설정되어 있지 않습니다." };

  let cookies: StoredCookie[];
  try {
    cookies = readUsableCookies(storageStatePath, "blog.naver.com");
  } catch {
    return { valid: false, error: "세션 파일을 읽을 수 없습니다." };
  }
  const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  if (!cookieHeader) return { valid: false, error: "유효한 네이버 세션 쿠키가 없습니다." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `https://blog.naver.com/PostWriteFormManagerOptions.naver?blogId=${encodeURIComponent(blogId)}`;
    const response = await fetch(endpoint, {
      headers: {
        cookie: cookieHeader,
        accept: "application/json, text/plain, */*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { valid: false, error: `글쓰기 권한 확인 실패 (HTTP ${response.status})` };

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!contentType.includes("json") || /^\s*</.test(text)) {
      return { valid: false, error: "로그인 세션이 만료되었거나 로그인 화면으로 이동했습니다." };
    }
    const parsed = JSON.parse(text) as { isSuccess?: boolean };
    return parsed.isSuccess
      ? { valid: true }
      : { valid: false, error: "네이버 블로그 글쓰기 권한이 확인되지 않았습니다." };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error && error.name === "AbortError" ? "글쓰기 권한 확인 시간이 초과되었습니다." : "글쓰기 권한 확인에 실패했습니다.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

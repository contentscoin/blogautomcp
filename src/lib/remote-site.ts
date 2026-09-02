/**
 * PC 앱이 페어링을 허용하는 사이트 오리진.
 *
 * 딥링크(blogautomcp://pair?site=…)는 어떤 웹페이지든 만들 수 있으므로, 앱은 site 값을
 * 그대로 믿지 않고 허용 목록과 대조한 뒤에만 그 사이트에 PC 이름·앱 버전을 보낸다.
 * (페어 코드는 사이트가 발급한 것이라 위조된 site 로는 어차피 인증되지 않지만,
 * 알 수 없는 호스트에 페어링 요청을 보내는 것 자체를 막는다.)
 */
export const DEFAULT_REMOTE_SITE_URL = "https://blogautomcp.hiway350051.chatgpt.site";

function configuredAllowlist(): string[] {
  return (process.env.REMOTE_SITE_ALLOWLIST || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeRemoteSiteOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedRemoteSiteOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:") {
    if (origin === DEFAULT_REMOTE_SITE_URL) return true;
    if (host.endsWith(".chatgpt.site")) return true;
  }
  if (configuredAllowlist().includes(origin)) return true;
  // 개발·E2E: 로컬 모의 사이트 허용
  if (process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) return true;
  return false;
}

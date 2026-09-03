import fs from "node:fs";
import draftRuntimePolicy from "../../scripts/lib/draft-runtime-policy.json";
import {
  getChatgptProfileDir,
  getChatgptSessionFile,
} from "../../scripts/lib/app-paths";
import { resolveChatGptBrowserVisibility } from "../../scripts/lib/chatgpt-browser-visibility";
import {
  CHATGPT_BROWSER_AUTH_REQUIRED_CODE,
  CHATGPT_BROWSER_UNREACHABLE_CODE,
} from "../../scripts/lib/chatgpt-browser-errors";

export interface ChatGptBrowserSessionSummary {
  hasSession: boolean;
  isValid: boolean;
  savedAt?: string;
  checkedAt: string;
  mode: "chatgpt-browser";
  error?: string;
}

interface BrowserStorageCookie {
  name?: unknown;
  domain?: unknown;
  expires?: unknown;
}

interface BrowserStorageState {
  cookies?: unknown;
}

export function isChatGptBrowserAutomationEnabled(
  env: object = process.env,
): boolean {
  // Legacy callers may pass saved settings; this capability is no longer optional.
  void env;
  return draftRuntimePolicy.CHATGPT_BROWSER_AUTOMATION_ENABLED === "true";
}

export function buildChatGptBrowserAutomationEnv(
  enabled: boolean,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const value = enabled ? "true" : "false";
  return {
    CHATGPT_BROWSER_AUTOMATION_ENABLED: value,
    BROWSER_GPT_MODE: value,
    ALLOW_CHATGPT_BROWSER_MODE: value,
    CHATGPT_BASE_URL: "https://chatgpt.com/",
    CHATGPT_RUN_ISOLATED_CONTEXT: "false",
    CHATGPT_BROWSER_VISIBILITY: resolveChatGptBrowserVisibility(env),
  };
}

export function isChatGptBrowserAuthenticationError(message: string): boolean {
  const normalized = message.replace(/\s+/gu, " ").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes(CHATGPT_BROWSER_AUTH_REQUIRED_CODE.toLowerCase())) return true;

  return [
    "chatgpt 로그인이 필요",
    "chatgpt 세션이 없습니다",
    "chatgpt 로그인 세션이 만료",
    "세션 쿠키가 없습니다",
    "세션 파일을 읽을 수 없습니다",
    "manual verification required",
    "human-verification",
    "security-check",
    "cloudflare",
    "verify you are human",
    "보안 검증",
    "사람인지 확인",
    "계정을 선택",
    "choose an account",
    "unusual activity",
  ].some((marker) => normalized.includes(marker));
}

/**
 * chatgpt.com 자체에 도달하지 못한 실패. 로그인·보안 확인(AUTH_REQUIRED)과 분리해야
 * 데스크톱이 로그인 창을 여는 대신 네트워크·프록시 안내와 MCP 요청문 경로를 보여준다.
 * `이동 실패` + 타임아웃 조합은 1.3.10 이하 PC 로그와의 호환용이다.
 */
export function isChatGptBrowserUnreachableError(message: string): boolean {
  const normalized = message.replace(/\s+/gu, " ").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes(CHATGPT_BROWSER_UNREACHABLE_CODE.toLowerCase())) return true;
  return normalized.includes("이동 실패") && /timeout|net::err_/u.test(normalized);
}

function getLastModifiedIso(targetPath: string): string | undefined {
  try {
    return fs.statSync(targetPath).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function hasNonEmptyDirectory(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0;
  } catch {
    return false;
  }
}

function isCurrentCookie(cookie: BrowserStorageCookie): boolean {
  const expires = typeof cookie.expires === "number" ? cookie.expires : -1;
  return expires <= 0 || expires * 1000 > Date.now();
}

function isChatGptAuthCookie(cookie: BrowserStorageCookie): boolean {
  const name = typeof cookie.name === "string" ? cookie.name : "";
  const domain = typeof cookie.domain === "string" ? cookie.domain.replace(/^\./u, "") : "";
  if (!/(?:chatgpt\.com|openai\.com)$/iu.test(domain)) return false;
  return /(?:session-token|access-token|auth-token)/iu.test(name) && isCurrentCookie(cookie);
}

export function readChatGptBrowserSessionSummary(): ChatGptBrowserSessionSummary {
  const sessionFile = getChatgptSessionFile();
  const profileDir = getChatgptProfileDir();
  const hasSessionFile = fs.existsSync(sessionFile);
  const hasProfile = hasNonEmptyDirectory(profileDir);
  const base: ChatGptBrowserSessionSummary = {
    hasSession: hasSessionFile || hasProfile,
    isValid: false,
    savedAt: hasSessionFile
      ? getLastModifiedIso(sessionFile)
      : hasProfile
        ? getLastModifiedIso(profileDir)
        : undefined,
    checkedAt: new Date().toISOString(),
    mode: "chatgpt-browser",
  };

  if (!hasSessionFile) {
    return {
      ...base,
      error: "ChatGPT 자동작성 세션이 없습니다. ChatGPT 로그인을 한 번 완료해 주세요.",
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as BrowserStorageState;
    const cookies = Array.isArray(parsed.cookies)
      ? parsed.cookies.filter((cookie): cookie is BrowserStorageCookie => Boolean(cookie) && typeof cookie === "object")
      : [];
    // ChatGPT can keep the authenticated state in the persistent profile
    // without exporting the legacy auth cookie into storageState.
    // The browser UI check remains the definitive validation before a prompt.
    if (!cookies.some(isChatGptAuthCookie) && !hasProfile) {
      return {
        ...base,
        error: "저장된 ChatGPT 로그인 세션이 만료됐거나 인증 쿠키를 확인할 수 없습니다.",
      };
    }
    return {
      ...base,
      isValid: true,
      error: cookies.some(isChatGptAuthCookie)
        ? undefined
        : "저장된 프로필로 로그인 상태를 확인합니다.",
    };
  } catch {
    return {
      ...base,
      error: "저장된 ChatGPT 세션 파일을 읽을 수 없습니다. 재로그인해 주세요.",
    };
  }
}

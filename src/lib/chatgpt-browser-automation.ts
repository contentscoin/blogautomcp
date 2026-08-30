import fs from "node:fs";
import {
  getChatgptProfileDir,
  getChatgptSessionFile,
} from "../../scripts/lib/app-paths";
import { resolveChatGptBrowserVisibility } from "../../scripts/lib/chatgpt-browser-visibility";
import { CHATGPT_BROWSER_AUTH_REQUIRED_CODE } from "../../scripts/lib/chatgpt-browser-errors";

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
  const value = (env as { CHATGPT_BROWSER_AUTOMATION_ENABLED?: string })
    .CHATGPT_BROWSER_AUTOMATION_ENABLED;
  return (value || "true").trim().toLowerCase() === "true";
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
    CHATGPT_USE_CUSTOM_GPTS: "false",
    CHATGPT_DIRECT_ONLY: "true",
    CHATGPT_SKIP_POLISH: "true",
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
    if (!cookies.some(isChatGptAuthCookie)) {
      return {
        ...base,
        error: "저장된 ChatGPT 로그인 세션이 만료됐거나 인증 쿠키를 확인할 수 없습니다.",
      };
    }
    return { ...base, isValid: true, error: undefined };
  } catch {
    return {
      ...base,
      error: "저장된 ChatGPT 세션 파일을 읽을 수 없습니다. 재로그인해 주세요.",
    };
  }
}

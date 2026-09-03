import {
  CHATGPT_BROWSER_UNREACHABLE_CODE,
  CHATGPT_MANUAL_VERIFICATION_MESSAGE,
  CHATGPT_PROTECTION_FRAME_PATTERNS,
  compactPlaywrightError,
} from "./chatgpt-browser-errors";

/**
 * chatgpt.com 이동. 예전에는 `domcontentloaded` 120초를 3번(약 6분) 반복하다 원본 Playwright
 * 타임아웃을 그대로 던졌다. 숨은 창(-32000,-32000)에서는 Cloudflare 확인 화면이 떠도
 * domcontentloaded 가 오지 않아 사용자는 6분을 기다린 뒤 의미 없는 오류만 봤다.
 *
 * 단계: ① domcontentloaded → ② 보안 확인 흔적이 보이면 즉시 인증 필요로 종료
 * ③ commit(문서 시작만 확인, 나머지는 ensureChatGPTReady 가 판단) ④ 창을 화면에 띄우고 마지막 시도.
 */

export interface NavigableFrame {
  url(): string;
  name(): string;
}

export interface NavigablePage {
  goto(url: string, options: { waitUntil: "domcontentloaded" | "commit"; timeout: number }): Promise<unknown>;
  url(): string;
  frames(): NavigableFrame[];
}

export interface ChatGptNavigationOptions {
  label: string;
  /** 1·3단계 domcontentloaded 대기(ms). */
  timeoutMs?: number;
  /** 2단계 commit 대기(ms). */
  commitTimeoutMs?: number;
  /** 숨은 창을 화면으로 옮기는 훅. background 가 아니면 null. */
  reveal?: (() => Promise<void>) | null;
  log?: (message: string) => void;
}

export const CHATGPT_NAVIGATION_DEFAULT_TIMEOUT_MS = 60_000;
export const CHATGPT_NAVIGATION_COMMIT_TIMEOUT_MS = 30_000;

/** URL·프레임만 본다. 페이지가 열리지 않은 상태에서도 안전하게 호출할 수 있다. */
export function detectNavigationChallenge(page: NavigablePage): string | null {
  const evidence = [page.url(), ...page.frames().map((frame) => `${frame.url()} ${frame.name()}`)]
    .join(" ")
    .toLowerCase();
  return CHATGPT_PROTECTION_FRAME_PATTERNS.some((pattern) => evidence.includes(pattern))
    ? CHATGPT_MANUAL_VERIFICATION_MESSAGE
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function navigateToChatGpt(
  page: NavigablePage,
  url: string,
  options: ChatGptNavigationOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : CHATGPT_NAVIGATION_DEFAULT_TIMEOUT_MS;
  const commitTimeoutMs = options.commitTimeoutMs && options.commitTimeoutMs > 0
    ? options.commitTimeoutMs
    : CHATGPT_NAVIGATION_COMMIT_TIMEOUT_MS;
  const log = options.log || (() => undefined);
  const label = options.label;
  let lastError: unknown = null;

  const attempt = async (waitUntil: "domcontentloaded" | "commit", timeout: number, note: string): Promise<boolean> => {
    try {
      await page.goto(url, { waitUntil, timeout });
      return true;
    } catch (error) {
      lastError = error;
      log(`      - ${label} 이동 ${note} 실패: ${errorMessage(error)}`);
      return false;
    }
  };

  if (await attempt("domcontentloaded", timeoutMs, "1차")) return;

  // 보안 확인 화면은 문서 로드를 끝내지 않는다. 여기서 잡아야 사용자가 로그인 창 안내를 받는다.
  const challenge = detectNavigationChallenge(page);
  if (challenge) {
    throw new Error(`${label} 이동 실패: ${challenge} (현재 URL: ${page.url()})`);
  }

  if (await attempt("commit", commitTimeoutMs, "2차(commit)")) return;

  if (options.reveal) {
    log(`      - ${label} 창을 화면에 표시하고 마지막으로 다시 시도합니다.`);
    await options.reveal().catch(() => undefined);
    if (await attempt("domcontentloaded", timeoutMs, "3차(창 표시)")) return;
  }

  throw new Error(
    `${label} 이동 실패: ${CHATGPT_BROWSER_UNREACHABLE_CODE}: chatgpt.com 에 연결하지 못했습니다 ` +
    `(${compactPlaywrightError(errorMessage(lastError))})`,
  );
}

export const CHATGPT_BROWSER_AUTH_REQUIRED_CODE = "CHATGPT_BROWSER_AUTH_REQUIRED";
/** chatgpt.com 자체에 도달하지 못한 경우. 로그인·보안 확인 실패와 구분해 안내를 다르게 준다. */
export const CHATGPT_BROWSER_UNREACHABLE_CODE = "CHATGPT_BROWSER_UNREACHABLE";

/** Cloudflare·캡차 인터스티셜을 URL/프레임만으로 식별하는 패턴(본문 평가 없이도 쓸 수 있다). */
export const CHATGPT_PROTECTION_FRAME_PATTERNS = [
  "cdn-cgi/challenge-platform",
  "challenge",
  "captcha",
  "turnstile",
  "cloudflare",
  "cf-chl",
  "hcaptcha",
  "recaptcha",
];

const PROTECTION_TEXT_PATTERNS = [
  "checking your browser",
  "checking if the site connection is secure",
  "verify you are human",
  "access denied",
  "please stand by",
  "cf-challenge",
  "unusual activity",
  "사람인지 확인",
  "실제 사용자인지 확인",
  "로봇이 아님",
  "브라우저를 확인",
  "접근이 차단되었습니다",
  "비정상적인 활동",
];

export function chatGptAuthenticationRequiredMessage(message: string): string {
  return `${CHATGPT_BROWSER_AUTH_REQUIRED_CODE}: ${message}`;
}

export const CHATGPT_MANUAL_VERIFICATION_MESSAGE = chatGptAuthenticationRequiredMessage(
  "ChatGPT manual verification required. A human-verification or security-check page is visible. Complete it in the browser, then run the job again.",
);

/**
 * Playwright 오류의 call log(`=== logs ===` 이후)를 잘라 한 줄로 만든다.
 * 전체 원문은 이미 prepare.log 에 남고, 사용자에게 보이는 문자열은 짧아야 한다.
 */
export function compactPlaywrightError(message: string): string {
  const [firstLine] = message.split(/\n\s*={3,}/u)[0].split("\n");
  return firstLine.replace(/\s+/gu, " ").trim().slice(0, 240);
}

export function hasChatGptProtectionText(value: string): boolean {
  const normalized = value.replace(/\s+/gu, " ").trim().toLowerCase();
  return PROTECTION_TEXT_PATTERNS.some((pattern) => normalized.includes(pattern));
}

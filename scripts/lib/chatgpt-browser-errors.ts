export const CHATGPT_BROWSER_AUTH_REQUIRED_CODE = "CHATGPT_BROWSER_AUTH_REQUIRED";

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

export function hasChatGptProtectionText(value: string): boolean {
  const normalized = value.replace(/\s+/gu, " ").trim().toLowerCase();
  return PROTECTION_TEXT_PATTERNS.some((pattern) => normalized.includes(pattern));
}

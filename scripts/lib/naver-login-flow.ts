import * as fs from "fs";

export interface LoginCookie {
  name: string;
  value: string;
  domain?: string;
}

export interface LoginContext {
  cookies(urls?: string | string[]): Promise<LoginCookie[]>;
  pages(): unknown[];
  storageState(options: { path: string }): Promise<unknown>;
}

export type NaverLoginWaitResult =
  | { status: "authenticated" }
  | { status: "closed" }
  | { status: "timeout" };

interface WaitForNaverLoginOptions {
  sessionPath: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  settleMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const NAVER_COOKIE_URLS = [
  "https://nid.naver.com",
  "https://www.naver.com",
  "https://blog.naver.com",
];

const REQUIRED_AUTH_COOKIES = ["NID_AUT", "NID_SES"];

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function hasNaverAuthCookies(cookies: LoginCookie[]): boolean {
  const available = new Set(
    cookies
      .filter((cookie) => cookie.value && (!cookie.domain || /(^|\.)naver\.com$/i.test(cookie.domain)))
      .map((cookie) => cookie.name),
  );
  return REQUIRED_AUTH_COOKIES.every((name) => available.has(name));
}

export async function waitForNaverAuthentication(
  context: LoginContext,
  options: WaitForNaverLoginOptions,
): Promise<NaverLoginWaitResult> {
  const timeoutMs = options.timeoutMs ?? 8 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const settleMs = options.settleMs ?? 1_500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (context.pages().length === 0) return { status: "closed" };

    const cookies = await context.cookies(NAVER_COOKIE_URLS);
    if (hasNaverAuthCookies(cookies)) {
      await sleep(settleMs);
      const settledCookies = await context.cookies(NAVER_COOKIE_URLS);
      if (hasNaverAuthCookies(settledCookies)) {
        await context.storageState({ path: options.sessionPath });
        return { status: "authenticated" };
      }
    }

    await sleep(pollIntervalMs);
  }

  return { status: "timeout" };
}

export function replaceSessionFileWithRollback(pendingPath: string, sessionPath: string): void {
  const backupPath = `${sessionPath}.previous`;
  let movedExistingSession = false;

  try {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    if (fs.existsSync(sessionPath)) {
      fs.renameSync(sessionPath, backupPath);
      movedExistingSession = true;
    }
    fs.renameSync(pendingPath, sessionPath);
    if (movedExistingSession && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch (error) {
    if (!fs.existsSync(sessionPath) && movedExistingSession && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, sessionPath);
    }
    throw error;
  }
}

/**
 * ChatGPT 브라우저 로그인 세션 저장 스크립트
 * 사용법: npm run login:chatgpt
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Page, type BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import {
  getChatgptProfileDir,
  getChatgptSessionFile,
  getSessionStorageDir,
} from "./lib/app-paths";
import { acquireChatGptProfileLock } from "./lib/chatgpt-profile-lock";

chromium.use(StealthPlugin());

const STORAGE_PATH = getSessionStorageDir();
const CHATGPT_SESSION_FILE = getChatgptSessionFile();
const CHATGPT_USER_DATA_DIR = process.env.CHATGPT_USER_DATA_DIR || getChatgptProfileDir();
const CHATGPT_BASE_URL = process.env.CHATGPT_BASE_URL || "https://chatgpt.com/";
const CHATGPT_LOGIN_URL = process.env.CHATGPT_LOGIN_URL || CHATGPT_BASE_URL;
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL?.trim() || "chrome";
const FORCE_LOGIN = process.argv.includes("--force-login");
const LOGIN_TIMEOUT_MS = Number(process.env.CHATGPT_LOGIN_TIMEOUT_MS || "600000");
const CHATGPT_LOGIN_MANUAL_CONFIRM =
  (process.env.CHATGPT_LOGIN_MANUAL_CONFIRM || "false").toLowerCase() === "true";
const CHATGPT_LOGIN_USE_PROBE =
  (process.env.CHATGPT_LOGIN_USE_PROBE || "false").toLowerCase() === "true";
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

function resetSavedChatGptLogin(): void {
  const resolvedStorage = `${path.resolve(STORAGE_PATH)}${path.sep}`;
  const resolvedProfile = path.resolve(CHATGPT_USER_DATA_DIR);
  if (!resolvedProfile.startsWith(resolvedStorage) || resolvedProfile === path.resolve(STORAGE_PATH)) {
    throw new Error("ChatGPT 프로필 초기화 경로가 세션 저장소 밖을 가리킵니다.");
  }
  fs.rmSync(CHATGPT_SESSION_FILE, { force: true });
  fs.rmSync(resolvedProfile, { recursive: true, force: true });
}

const CHATGPT_COMPOSER_SELECTORS = [
  "textarea#prompt-textarea",
  'textarea[data-testid="prompt-textarea"]',
  'textarea[placeholder*="Message"]',
  'textarea[placeholder*="메시지"]',
  'div#prompt-textarea[contenteditable="true"]',
  'div[contenteditable="true"][data-testid="composer-input"]',
];

const CHATGPT_SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="보내기"]',
];

const CHATGPT_STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop"]',
  'button[aria-label*="중지"]',
];

async function findVisibleSelector(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return selector;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isChatGPTLoginRequired(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("button", { name: /log in/i }).first(),
    page.getByRole("button", { name: /로그인/i }).first(),
    page.getByRole("link", { name: /log in/i }).first(),
    page.getByRole("link", { name: /로그인/i }).first(),
  ];

  for (const candidate of candidates) {
    const visible = await candidate.isVisible().catch(() => false);
    if (visible) return true;
  }

  if (await hasComposer(page)) return false;
  return false;
}

async function hasComposer(page: Page): Promise<boolean> {
  return (await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS)) !== null;
}

async function waitForManualConfirmation(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question("로그인/보안인증 완료 후 Enter를 눌러주세요: ", () => resolve());
  });

  rl.close();
}

async function readAssistantMessages(page: Page): Promise<string[]> {
  const selectors = [
    '[data-message-author-role="assistant"]',
    'article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]',
    'article[data-testid^="conversation-turn-"] .markdown',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const texts = await locator.allInnerTexts().catch(() => []);
    const normalized = texts
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
}

async function isGenerating(page: Page): Promise<boolean> {
  const selector = await findVisibleSelector(page, CHATGPT_STOP_BUTTON_SELECTORS);
  return selector !== null;
}

async function sendProbePrompt(page: Page): Promise<boolean> {
  const previous = await readAssistantMessages(page);
  const composerSelector = await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS);
  if (!composerSelector) return false;

  const composer = page.locator(composerSelector).first();
  const prompt = "세션 점검입니다. OK 한 단어만 답해주세요.";

  await composer.click();

  if (composerSelector.startsWith("textarea")) {
    await composer.fill(prompt);
  } else {
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type(prompt, { delay: 1 });
  }

  const sendSelector = await findVisibleSelector(page, CHATGPT_SEND_BUTTON_SELECTORS);
  if (sendSelector) {
    await page.locator(sendSelector).first().click();
  } else {
    await composer.press("Enter");
  }

  const start = Date.now();
  while (Date.now() - start < 90_000) {
    if (await isChatGPTLoginRequired(page)) {
      return false;
    }

    const messages = await readAssistantMessages(page);
    if (messages.length > previous.length) {
      const candidate = messages[messages.length - 1];
      if (candidate.length > 0 && !(await isGenerating(page))) {
        return true;
      }
    }

    if (page.isClosed()) return false;
    await sleep(1200);
  }

  return false;
}

async function waitForComposerOrLoginTimeout(page: Page, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      throw new Error("브라우저 창이 닫혔습니다. 로그인 창을 닫지 말고 다시 시도하세요.");
    }

    if (await hasComposer(page)) return;
    if (await isChatGPTLoginRequired(page)) {
      throw new Error("ChatGPT 로그인이 필요합니다. 브라우저에서 로그인 후 다시 시도하세요.");
    }
    await sleep(1000);
  }

  throw new Error("ChatGPT 입력창을 찾지 못했습니다. 로그인 상태를 확인하세요.");
}

async function hasSessionTokenCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies("https://chatgpt.com");
  return cookies.some((cookie) => /(?:session-token|access-token|auth-token)/iu.test(cookie.name));
}

async function verifyBaseChatGPTSession(page: Page): Promise<void> {
  await page.goto(CHATGPT_BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForComposerOrLoginTimeout(page, Math.min(LOGIN_TIMEOUT_MS, 120000));

  const hasToken = await hasSessionTokenCookie(page);
  const composerVisible = await hasComposer(page);
  if (!hasToken && !composerVisible) {
    throw new Error(
      "로그인 세션 쿠키가 확인되지 않습니다. 브라우저에서 재로그인 후 다시 시도하세요."
    );
  }

  if (CHATGPT_LOGIN_USE_PROBE) {
    const verified = await sendProbePrompt(page);
    if (!verified) {
      throw new Error(
        "로그인 후 세션 응답 검증에 실패했습니다. Cloudflare 인증/로그인 상태를 다시 확인하고 재시도하세요."
      );
    }
  }
}

async function revealChatGptLoginWindow(page: Page): Promise<void> {
  await page.bringToFront().catch(() => {});
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  if (!cdp) return;

  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 80, top: 80, width: 1440, height: 960 },
    });
    await page.bringToFront().catch(() => {});
  } catch {
    // Chrome 채널/OS가 창 제어를 지원하지 않아도 headful 로그인은 계속 진행합니다.
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("=".repeat(54));
  console.log("ChatGPT 브라우저 세션 설정");
  console.log("=".repeat(54));
  console.log("");
  console.log("📌 사용 방법:");
  console.log("   1. 브라우저에서 ChatGPT 로그인");
  console.log("   2. 로그인 완료 후 입력창이 보일 때까지 대기");
  console.log("   3. 세션/프로필 저장 후 브라우저가 자동 종료");
  console.log("");

  const profileLock = await acquireChatGptProfileLock({ purpose: "chatgpt-login" });
  let context: BrowserContext | null = null;
  try {
    if (FORCE_LOGIN) resetSavedChatGptLogin();
    if (!fs.existsSync(CHATGPT_USER_DATA_DIR)) {
      fs.mkdirSync(CHATGPT_USER_DATA_DIR, { recursive: true });
    }

    const activeContext = await chromium.launchPersistentContext(CHATGPT_USER_DATA_DIR, {
      channel: BROWSER_CHANNEL,
      headless: false,
      slowMo: 40,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--window-position=80,80",
        "--window-size=1440,960",
        "--start-maximized",
      ],
      viewport: { width: 1440, height: 960 },
      locale: "ko-KR",
    });
    context = activeContext;
    const page = activeContext.pages()[0] ?? (await activeContext.newPage());
    await revealChatGptLoginWindow(page);

    await page.goto(CHATGPT_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await revealChatGptLoginWindow(page);
    console.log("✅ 브라우저가 열렸습니다.");
    console.log("📝 ChatGPT 로그인 완료를 감지하는 중...");

    if (CHATGPT_LOGIN_MANUAL_CONFIRM) {
      console.log("⌛ 수동 확인 모드: 브라우저에서 로그인/보안 인증 후 Enter를 눌러주세요.");
      await waitForManualConfirmation();
    } else {
      const start = Date.now();
      let loggedIn = false;
      let loginSeenRounds = 0;
      let loginReminderShown = false;
      let stableComposerRounds = 0;
      let lastProbeAttemptAt = 0;

      while (Date.now() - start < LOGIN_TIMEOUT_MS) {
        const needLogin = await isChatGPTLoginRequired(page);
        const composerVisible = await hasComposer(page);
        const hasAuthCookie = await hasSessionTokenCookie(page);

        // New ChatGPT sessions may expose the authenticated composer without
        // exporting the legacy auth-token cookie in storageState.
        if (composerVisible && (hasAuthCookie || !needLogin)) {
          stableComposerRounds += 1;
          if (stableComposerRounds >= 3) {
            if (CHATGPT_LOGIN_USE_PROBE) {
              const now = Date.now();
              if (now - lastProbeAttemptAt >= 15_000) {
                lastProbeAttemptAt = now;
                console.log("🔎 세션 유효성 점검 중 (테스트 프롬프트)...");
                const verified = await sendProbePrompt(page);
                if (verified) {
                  loggedIn = true;
                  break;
                }
                console.log("⚠️ 입력창은 보이지만 응답 확인에 실패했습니다. 로그인/인증을 다시 확인해주세요.");
              }
            } else {
              loggedIn = true;
              break;
            }
          }
        } else {
          stableComposerRounds = 0;
        }

        if (needLogin) {
          loginSeenRounds += 1;
        } else {
          loginSeenRounds = 0;
        }

        if (!loginReminderShown && (loginSeenRounds >= 5 || (composerVisible && !hasAuthCookie))) {
          console.log("ℹ️ 로그인 버튼이 표시됩니다. 브라우저에서 로그인 후 잠시 기다려주세요.");
          loginReminderShown = true;
        }

        await sleep(1200);
      }

      if (!loggedIn) {
        throw new Error("로그인 감지 시간이 초과되었습니다. 다시 시도해주세요.");
      }
    }

    console.log("🔎 로그인 세션 응답 검증 중...");
    await verifyBaseChatGPTSession(page);

    await context.storageState({ path: CHATGPT_SESSION_FILE });

    console.log("");
    console.log("✅ ChatGPT 세션이 저장되었습니다!");
    console.log(`   📁 저장 위치: ${CHATGPT_SESSION_FILE}`);
    console.log(`   📁 프로필 위치: ${CHATGPT_USER_DATA_DIR}`);
    console.log("   이후 BROWSER_GPT_MODE=true 에서 이 세션을 사용합니다.");
  } finally {
    try {
      await context?.close().catch(() => {});
    } finally {
      await profileLock.release();
    }
  }
}

main().catch((error: unknown) => {
  console.error("❌ ChatGPT 로그인 설정 실패:", error instanceof Error ? error.message : error);
  process.exit(1);
});

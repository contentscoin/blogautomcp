/**
 * ChatGPT 브라우저 로그인 세션 저장 스크립트
 * 사용법: npm run login:chatgpt
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

chromium.use(StealthPlugin());

const STORAGE_PATH = path.join(process.cwd(), "playwright", "storage");
const CHATGPT_SESSION_FILE = path.join(STORAGE_PATH, "chatgpt-session.json");
const DEFAULT_CHATGPT_DRAFT_GPT_URL =
  "https://chatgpt.com/g/g-69044e83643481918a83e45a0bfec330-jepum-ribyu-jagseong-v11-dapeojuneunnamja";
const DEFAULT_CHATGPT_POLISH_GPT_URL =
  "https://chatgpt.com/g/g-683347512adc8191bd26d40336990cb1-seo-coejeoghwa-jadong-geul-byeonhwan-v5-0-dapeojuneunnamja";
const CHATGPT_LOGIN_URL =
  process.env.CHATGPT_GPT_URL_DRAFT ||
  process.env.CHATGPT_GPT_URL ||
  DEFAULT_CHATGPT_DRAFT_GPT_URL;
const CHATGPT_DRAFT_GPT_URL =
  process.env.CHATGPT_GPT_URL_DRAFT ||
  process.env.CHATGPT_GPT_URL ||
  DEFAULT_CHATGPT_DRAFT_GPT_URL;
const CHATGPT_POLISH_GPT_URL =
  process.env.CHATGPT_GPT_URL_POLISH ||
  process.env.CHATGPT_GPT_URL_DRAFT ||
  process.env.CHATGPT_GPT_URL ||
  DEFAULT_CHATGPT_POLISH_GPT_URL;
const CHATGPT_BASE_URL = process.env.CHATGPT_GPT_URL || "https://chatgpt.com/";
const LOGIN_TIMEOUT_MS = Number(process.env.CHATGPT_LOGIN_TIMEOUT_MS || "600000");
const CHATGPT_LOGIN_MANUAL_CONFIRM =
  (process.env.CHATGPT_LOGIN_MANUAL_CONFIRM || "true").toLowerCase() === "true";
const CHATGPT_VERIFY_CUSTOM_GPTS =
  (process.env.CHATGPT_VERIFY_CUSTOM_GPTS || "true").toLowerCase() === "true";
const CHATGPT_LOGIN_USE_PROBE =
  (process.env.CHATGPT_LOGIN_USE_PROBE || "false").toLowerCase() === "true";
const CHATGPT_USER_DATA_DIR =
  process.env.CHATGPT_USER_DATA_DIR ||
  path.join(STORAGE_PATH, "chatgpt-profile");

if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}
if (!fs.existsSync(CHATGPT_USER_DATA_DIR)) {
  fs.mkdirSync(CHATGPT_USER_DATA_DIR, { recursive: true });
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
  if (await hasComposer(page)) return false;

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

  return false;
}

async function hasComposer(page: Page): Promise<boolean> {
  return (await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS)) !== null;
}

function isCustomGptUrl(url: string): boolean {
  return /https?:\/\/chatgpt\.com\/g\//i.test(url);
}

function isCustomGptPageUrl(url: string): boolean {
  return /https?:\/\/chatgpt\.com\/g\//i.test(url);
}

async function hasInaccessibleGptBanner(page: Page): Promise<boolean> {
  const bannerByText = page
    .getByText(/This GPT is inaccessible or not found|GPT에 접근할 수 없습니다|사용할 수 없습니다/i)
    .first();
  if (await bannerByText.isVisible().catch(() => false)) {
    return true;
  }

  const bodyText = ((await page.textContent("body").catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .toLowerCase();

  return (
    bodyText.includes("this gpt is inaccessible or not found") ||
    bodyText.includes("ensure you're using the right account") ||
    bodyText.includes("gpt에 접근할 수 없습니다")
  );
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
  return cookies.some((cookie) => cookie.name === "__Secure-next-auth.session-token");
}

async function verifyBaseChatGPTSession(page: Page): Promise<void> {
  await page.goto(CHATGPT_BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForComposerOrLoginTimeout(page, Math.min(LOGIN_TIMEOUT_MS, 120000));

  const hasToken = await hasSessionTokenCookie(page);
  if (!hasToken) {
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

async function verifyCustomGptAccess(page: Page, url: string, label: string): Promise<void> {
  if (!isCustomGptUrl(url)) return;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);

  const currentUrl = page.url();
  const inaccessibleBanner = await hasInaccessibleGptBanner(page);

  if (!isCustomGptPageUrl(currentUrl) || inaccessibleBanner) {
    throw new Error(
      `${label} GPT 접근 실패: 현재 로그인 계정에서 이 GPT를 사용할 수 없습니다. ` +
        `요청 URL=${url}, 현재 URL=${currentUrl}. 올바른 계정으로 로그인했는지 확인하세요.`
    );
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

  const context = await chromium.launchPersistentContext(CHATGPT_USER_DATA_DIR, {
    headless: false,
    slowMo: 40,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1440, height: 960 },
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(CHATGPT_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("✅ 브라우저가 열렸습니다.");
    console.log("📝 ChatGPT 로그인 완료를 감지하는 중...");

    if (CHATGPT_LOGIN_MANUAL_CONFIRM) {
      console.log("⌛ 수동 확인 모드: 브라우저에서 로그인/보안 인증 후 Enter를 눌러주세요.");
      await waitForManualConfirmation();
    } else {
      const start = Date.now();
      let loggedIn = false;
      let loginSeenRounds = 0;
      let stableComposerRounds = 0;
      let lastProbeAttemptAt = 0;

      while (Date.now() - start < LOGIN_TIMEOUT_MS) {
        const needLogin = await isChatGPTLoginRequired(page);
        const composerVisible = await hasComposer(page);

        if (composerVisible) {
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

        if (loginSeenRounds >= 5) {
          console.log("ℹ️ 로그인 버튼이 표시됩니다. 브라우저에서 로그인 후 잠시 기다려주세요.");
        }

        await sleep(1200);
      }

      if (!loggedIn) {
        throw new Error("로그인 감지 시간이 초과되었습니다. 다시 시도해주세요.");
      }
    }

    console.log("🔎 로그인 세션 응답 검증 중...");
    await verifyBaseChatGPTSession(page);

    if (CHATGPT_VERIFY_CUSTOM_GPTS) {
      console.log("🔗 Custom GPT 접근 검증 중 (Draft)...");
      await verifyCustomGptAccess(page, CHATGPT_DRAFT_GPT_URL, "Draft");

      if (CHATGPT_POLISH_GPT_URL !== CHATGPT_DRAFT_GPT_URL) {
        console.log("🔗 Custom GPT 접근 검증 중 (Polish)...");
        await verifyCustomGptAccess(page, CHATGPT_POLISH_GPT_URL, "Polish");
      }
    }

    await context.storageState({ path: CHATGPT_SESSION_FILE });

    console.log("");
    console.log("✅ ChatGPT 세션이 저장되었습니다!");
    console.log(`   📁 저장 위치: ${CHATGPT_SESSION_FILE}`);
    console.log(`   📁 프로필 위치: ${CHATGPT_USER_DATA_DIR}`);
    console.log("   이후 BROWSER_GPT_MODE=true 에서 이 세션을 사용합니다.");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("❌ ChatGPT 로그인 설정 실패:", error instanceof Error ? error.message : error);
  process.exit(1);
});

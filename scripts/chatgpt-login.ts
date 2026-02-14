/**
 * ChatGPT 브라우저 로그인 세션 저장 스크립트
 * 사용법: npm run login:chatgpt
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Page } from "playwright";
import type { BrowserContextOptions } from "playwright";
import * as fs from "fs";
import * as path from "path";

chromium.use(StealthPlugin());

const STORAGE_PATH = path.join(process.cwd(), "playwright", "storage");
const CHATGPT_SESSION_FILE = path.join(STORAGE_PATH, "chatgpt-session.json");
const CHATGPT_LOGIN_URL =
  process.env.CHATGPT_GPT_URL_DRAFT ||
  process.env.CHATGPT_GPT_URL ||
  "https://chatgpt.com/";
const LOGIN_TIMEOUT_MS = Number(process.env.CHATGPT_LOGIN_TIMEOUT_MS || "600000");

if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
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

  return false;
}

async function hasComposer(page: Page): Promise<boolean> {
  const selectors = [
    "textarea#prompt-textarea",
    'textarea[data-testid="prompt-textarea"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="메시지"]',
    'div#prompt-textarea[contenteditable="true"]',
    'div[contenteditable="true"][data-testid="composer-input"]',
  ];

  for (const selector of selectors) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function main(): Promise<void> {
  console.log("=".repeat(54));
  console.log("ChatGPT 브라우저 세션 설정");
  console.log("=".repeat(54));
  console.log("");
  console.log("📌 사용 방법:");
  console.log("   1. 브라우저에서 ChatGPT 로그인");
  console.log("   2. 로그인 완료 후 입력창이 보일 때까지 대기");
  console.log("   3. 세션 저장 후 브라우저가 자동 종료");
  console.log("");

  const browser = await chromium.launch({
    headless: false,
    slowMo: 40,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const contextOptions: BrowserContextOptions = {
      viewport: { width: 1440, height: 960 },
      locale: "ko-KR",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    if (fs.existsSync(CHATGPT_SESSION_FILE)) {
      contextOptions.storageState = CHATGPT_SESSION_FILE;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    await page.goto(CHATGPT_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("✅ 브라우저가 열렸습니다.");
    console.log("📝 ChatGPT 로그인 완료를 감지하는 중...");

    const start = Date.now();
    let loggedIn = false;

    while (Date.now() - start < LOGIN_TIMEOUT_MS) {
      const needLogin = await isChatGPTLoginRequired(page);
      const composerVisible = await hasComposer(page);

      if (!needLogin && composerVisible) {
        loggedIn = true;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    if (!loggedIn) {
      throw new Error("로그인 감지 시간이 초과되었습니다. 다시 시도해주세요.");
    }

    await context.storageState({ path: CHATGPT_SESSION_FILE });

    console.log("");
    console.log("✅ ChatGPT 세션이 저장되었습니다!");
    console.log(`   📁 저장 위치: ${CHATGPT_SESSION_FILE}`);
    console.log("   이후 BROWSER_GPT_MODE=true 에서 이 세션을 사용합니다.");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error("❌ ChatGPT 로그인 설정 실패:", error instanceof Error ? error.message : error);
  process.exit(1);
});

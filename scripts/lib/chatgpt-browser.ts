import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { Page, BrowserContextOptions } from "playwright";
import { getChatgptProfileDir, getChatgptSessionFile } from "./app-paths";
import {
  buildChatGptBrowserLaunchPolicy,
  describeChatGptBrowserVisibility,
} from "./chatgpt-browser-visibility";
import {
  CHATGPT_MANUAL_VERIFICATION_MESSAGE,
  CHATGPT_PROTECTION_FRAME_PATTERNS,
  chatGptAuthenticationRequiredMessage,
  hasChatGptProtectionText,
} from "./chatgpt-browser-errors";
import { acquireChatGptProfileLock } from "./chatgpt-profile-lock";
import { imageWaitPolicy, withinImageDeadline, ImagePhaseTimeout } from "./image-timeout-policy";
import { navigateToChatGpt } from "./chatgpt-navigation";

export { navigateToChatGpt };

const CHATGPT_SESSION_FILE = getChatgptSessionFile();
const CHATGPT_USER_DATA_DIR =
  process.env.CHATGPT_USER_DATA_DIR || getChatgptProfileDir();
const CHATGPT_USE_PERSISTENT_CONTEXT =
  (process.env.CHATGPT_USE_PERSISTENT_CONTEXT || process.env.CHATGPT_USE_PERSISTENT_PROFILE || "true").toLowerCase() !==
  "false";
const CHATGPT_READY_TIMEOUT_MS = Number(process.env.CHATGPT_READY_TIMEOUT_MS || 20_000);
const CHATGPT_HEALTHCHECK_USE_PROBE =
  (process.env.CHATGPT_HEALTHCHECK_USE_PROBE || process.env.CHATGPT_LOGIN_USE_PROBE || "false").toLowerCase() ===
  "true";
const CHATGPT_TARGET_RECOVERY_ATTEMPTS = Number(process.env.CHATGPT_TARGET_RECOVERY_ATTEMPTS || 1);
const CHATGPT_BASE_URL = "https://chatgpt.com/";

const CHATGPT_COMPOSER_SELECTORS = [
  "#prompt-textarea",
  'textarea#prompt-textarea',
  'textarea[data-testid="prompt-textarea"]',
  'textarea[placeholder*="Message"]',
  'textarea[placeholder*="메시지"]',
  'div#prompt-textarea[contenteditable="true"]',
  'div[contenteditable="true"][data-testid="composer-input"]',
  'div[contenteditable="true"]',
  "textarea",
];

const CHATGPT_SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="보내기"]',
];

export interface ChatGPTContextHandle {
  context: import("playwright").BrowserContext;
  close: () => Promise<void>;
}

async function findVisibleSelector(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return selector;
  }
  return null;
}

async function hasComposer(page: Page): Promise<boolean> {
  return (await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS)) !== null;
}

async function detectChatGPTManualVerification(page: Page): Promise<string | null> {
  const urlEvidence = page.url().toLowerCase();
  if (CHATGPT_PROTECTION_FRAME_PATTERNS.some((pattern) => urlEvidence.includes(pattern))) {
    return CHATGPT_MANUAL_VERIFICATION_MESSAGE;
  }

  const frameEvidence = page.frames().some((frame) => {
    const evidence = `${frame.url()} ${frame.name()}`.toLowerCase();
    return CHATGPT_PROTECTION_FRAME_PATTERNS.some((pattern) => evidence.includes(pattern));
  });
  if (frameEvidence) {
    return CHATGPT_MANUAL_VERIFICATION_MESSAGE;
  }

  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  if (!(await hasComposer(page)) && hasChatGptProtectionText(bodyText)) {
    return CHATGPT_MANUAL_VERIFICATION_MESSAGE;
  }

  const domEvidence = await page
    .evaluate(() => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const challengeSelectors = [
        'iframe[src*="challenge"]',
        'iframe[src*="captcha"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="cloudflare"]',
        '[id*="challenge"]',
        '[class*="challenge"]',
        '[id*="captcha"]',
        '[class*="captcha"]',
        '[id*="turnstile"]',
        '[class*="turnstile"]',
        "[data-sitekey]",
      ];
      const hasChallengeElement = challengeSelectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some(visible)
      );

      const humanTextPattern =
        /verify|human|robot|captcha|cloudflare|turnstile|\uc0ac\ub78c|\ub85c\ubd07|\ubcf4\uc548|\uc778\uc99d/i;
      const hasHumanCheckbox = Array.from(
        document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
      ).some((element) => {
        if (!visible(element)) return false;
        const nearby =
          element.closest("label, form, section, main, div")?.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          document.body?.innerText ||
          "";
        return humanTextPattern.test(nearby);
      });

      return { hasChallengeElement, hasHumanCheckbox };
    })
    .catch(() => ({ hasChallengeElement: false, hasHumanCheckbox: false }));

  if (domEvidence.hasChallengeElement || domEvidence.hasHumanCheckbox) {
    return CHATGPT_MANUAL_VERIFICATION_MESSAGE;
  }

  return null;
}

async function assertNoChatGPTProtection(page: Page, label = "ChatGPT"): Promise<void> {
  const protectionIssue = await detectChatGPTManualVerification(page);
  if (!protectionIssue) return;

  throw new Error(`${label}: ${protectionIssue} Current URL: ${page.url()}`);
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

async function continueChatGPTAccountPicker(page: Page, label = "ChatGPT"): Promise<boolean> {
  const target = await page
    .evaluate(() => {
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
      const hasAccountPicker =
        /welcome back|choose an account|select an account/i.test(bodyText) ||
        bodyText.includes("\ub2e4\uc2dc \uc624\uc2e0 \uac78 \ud658\uc601\ud569\ub2c8\ub2e4") ||
        bodyText.includes("\uacc4\uc815\uc744 \uc120\ud0dd\ud574 \uacc4\uc18d\ud558\uc138\uc694");

      if (!hasAccountPicker) return null;

      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const elements = Array.from(document.querySelectorAll("button, [role='button'], a, div, span, p"));
      const candidates: Array<{
        x: number;
        y: number;
        left: number;
        width: number;
        text: string;
        area: number;
        top: number;
      }> = [];
      const seen = new Set<string>();

      for (const element of elements) {
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        if (!/@/.test(text) || !visible(element)) continue;

        let clickable = element.closest("button, [role='button'], a");
        if (!clickable) {
          let parent: Element | null = element;
          while (parent && parent !== document.body) {
            const parentText = (parent.textContent || "").replace(/\s+/g, " ").trim();
            const parentRect = parent.getBoundingClientRect();
            if (
              /@/.test(parentText) &&
              visible(parent) &&
              parentRect.width >= 180 &&
              parentRect.height >= 44 &&
              parentRect.width <= 560 &&
              parentRect.height <= 180
            ) {
              clickable = parent;
              break;
            }
            parent = parent.parentElement;
          }
        }
        clickable ||= element;
        if (!visible(clickable)) continue;

        const rect = clickable.getBoundingClientRect();
        const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          left: rect.left,
          width: rect.width,
          text,
          area: rect.width * rect.height,
          top: rect.top,
        });
      }

      candidates.sort((a, b) => a.top - b.top || b.area - a.area);
      return candidates[0] || null;
    })
    .catch(() => null);

  if (!target) return false;

  console.log(`      - [${label}] ChatGPT account picker detected; selecting saved account.`);
  await page.mouse.click(target.left + Math.min(74, target.width * 0.24), target.y).catch(() => {});
  await page.waitForTimeout(700);
  await page.mouse.click(target.x, target.y).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return true;
}

async function hasSessionTokenCookie(page: Page): Promise<boolean> {
  try {
    const cookies = await page.context().cookies("https://chatgpt.com");
    return cookies.some((cookie) => cookie.name.startsWith("__Secure-next-auth.session-token"));
  } catch {
    return false;
  }
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
  while (Date.now() - start < 30_000) {
    await assertNoChatGPTProtection(page, "ChatGPT probe");

    if (await isChatGPTLoginRequired(page)) {
      return false;
    }

    const messages = await readAssistantMessages(page);
    if (messages.length > previous.length) {
      const candidate = messages[messages.length - 1];
      if (candidate.length > 0 && !(await isChatGPTGenerating(page))) {
        return true;
      }
    }

    if (page.isClosed()) return false;
    await page.waitForTimeout(1000);
  }

  return false;
}

export interface ChatGPTReadyOptions {
  timeoutMs?: number;
  requireProbe?: boolean;
  allowRecovery?: boolean;
}

async function ensureChatGPTReady(
  page: Page,
  label: string,
  options: ChatGPTReadyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CHATGPT_READY_TIMEOUT_MS;
  const requireProbe = options.requireProbe ?? CHATGPT_HEALTHCHECK_USE_PROBE;
  const allowRecovery = options.allowRecovery !== false;
  const lastReason = "입력창을 찾지 못했습니다.";

  for (let attempt = 0; attempt <= (allowRecovery ? CHATGPT_TARGET_RECOVERY_ATTEMPTS : 0); attempt += 1) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (page.isClosed()) {
        throw new Error("ChatGPT 창이 닫혔습니다.");
      }

      await assertNoChatGPTProtection(page, label);
      await dismissTemporaryChatOnboarding(page);
      if (await continueChatGPTAccountPicker(page, label)) {
        continue;
      }

      if (await isChatGPTLoginRequired(page)) {
        const hasToken = await hasSessionTokenCookie(page);
        const tokenHint = hasToken ? "세션 쿠키는 있지만 UI가 로그아웃 상태입니다." : "세션 쿠키가 없습니다.";
        throw new Error(
          chatGptAuthenticationRequiredMessage(
            `ChatGPT 로그인이 필요합니다. ${tokenHint} 먼저 'npm run login:chatgpt'로 프로필을 갱신하세요.`,
          ),
        );
      }

      const composerSelector = await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS);
      if (composerSelector) {
        if (requireProbe) {
          const verified = await sendProbePrompt(page);
          if (!verified) {
            throw new Error("ChatGPT 세션 응답 검증에 실패했습니다. 로그인 상태를 다시 확인하세요.");
          }
        }
        return;
      }

      await page.waitForTimeout(1000);
    }

    if (!allowRecovery || attempt >= CHATGPT_TARGET_RECOVERY_ATTEMPTS) {
      break;
    }

    console.log(`⚠️ [${label}] ChatGPT 상태가 불안정하여 복구를 시도합니다. (${attempt + 1}/${CHATGPT_TARGET_RECOVERY_ATTEMPTS})`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await navigateToChatGpt(page, CHATGPT_BASE_URL, {
      label: `${label} 복구`,
      reveal: null,
      log: (message) => console.log(message),
    });
    await page.waitForTimeout(1800);
  }

  throw new Error(`ChatGPT 준비 확인 실패: ${lastReason}`);
}

export async function createChatGPTContext(hasSessionFile: boolean): Promise<ChatGPTContextHandle> {
  const profileLock = await acquireChatGptProfileLock({ purpose: "shared-chatgpt-browser" });
  const launchPolicy = buildChatGptBrowserLaunchPolicy();
  const commonLaunchOptions = {
    channel: process.env.BROWSER_CHANNEL?.trim() || "chrome",
    headless: launchPolicy.headless,
    slowMo: launchPolicy.slowMo,
    args: launchPolicy.args,
  };
  console.log(
    `      - ChatGPT 브라우저 실행 모드: ${describeChatGptBrowserVisibility(launchPolicy.visibility)}`,
  );

  const contextOptions: BrowserContextOptions = {
    viewport: { width: 1440, height: 960 },
    locale: "ko-KR",
  };
  const sessionFileAvailable = hasSessionFile && fs.existsSync(CHATGPT_SESSION_FILE);

  try {
    if (CHATGPT_USE_PERSISTENT_CONTEXT) {
      try {
        const context = await chromium.launchPersistentContext(CHATGPT_USER_DATA_DIR, {
          ...commonLaunchOptions,
          ...contextOptions,
        });

        return {
          context,
          close: async () => {
            try {
              await context.close().catch(() => {});
            } finally {
              await profileLock.release();
            }
          },
        };
      } catch (error) {
        if (!sessionFileAvailable) {
          throw error;
        }
      }
    }

    const browser = await chromium.launch(commonLaunchOptions);
    if (sessionFileAvailable) {
      contextOptions.storageState = CHATGPT_SESSION_FILE;
    }
    const context = await browser.newContext(contextOptions);
    return {
      context,
      close: async () => {
        try {
          if (browser.isConnected()) {
            await browser.close().catch(() => {});
          }
        } finally {
          await profileLock.release();
        }
      },
    };
  } catch (error) {
    await profileLock.release();
    throw error;
  }
}

export async function openChatGPTTarget(page: Page, _url: string, label: string) {
  console.log(`\n🌐 [${label}] 일반 ChatGPT 열기: ${CHATGPT_BASE_URL}`);
  await navigateToChatGpt(page, CHATGPT_BASE_URL, {
    label,
    reveal: null,
    log: (message) => console.log(message),
  });
  await page.waitForTimeout(2000);
  await assertNoChatGPTProtection(page, label);
  await dismissTemporaryChatOnboarding(page);
  await continueChatGPTAccountPicker(page, label);
  await ensureChatGPTReady(page, label);
}

export async function dismissTemporaryChatOnboarding(page: Page) {
  try {
    const gotItButton = page.locator('button:has-text("Got it"), button:has-text("알겠습니다")').first();
    if (await gotItButton.isVisible({ timeout: 1000 })) {
      await gotItButton.click();
      await page.waitForTimeout(500);
    }
    const closeBtn = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 1000 })) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // Ignore
  }
}

export async function startFreshChat(page: Page, _gptUrl: string, label: string = "새 채팅") {
  console.log(`      - [${label}] 같은 창에서 새 채팅 시작...`);
  await dismissTemporaryChatOnboarding(page);

  const newChatSelectors = [
    'button:has-text("새 채팅")',
    'a:has-text("새 채팅")',
    'button:has-text("New chat")',
    'a:has-text("New chat")',
    'button[aria-label*="새 채팅"]',
    'button[aria-label*="New chat"]',
    'a[aria-label*="새 채팅"]',
    'a[aria-label*="New chat"]',
    'a[href="/"]',
  ];

  for (const selector of newChatSelectors) {
    try {
      const target = page.locator(selector).first();
      if (!(await target.isVisible({ timeout: 500 }))) continue;
      await target.click({ timeout: 3000 });
      await page.waitForTimeout(1800);

      await dismissTemporaryChatOnboarding(page);
      await waitForChatGPTComposer(page, 30000);
      return;
    } catch {
      // try next selector
    }
  }

  await openChatGPTTarget(page, CHATGPT_BASE_URL, label);
}

export async function openFreshChatGPTTarget(
  page: Page,
  _gptUrl: string,
  label: string,
  freshChatLabel: string = `${label} 새 채팅`,
) {
  await openChatGPTTarget(page, CHATGPT_BASE_URL, label);
  await startFreshChat(page, CHATGPT_BASE_URL, freshChatLabel);
}

export async function isChatGPTGenerating(page: Page): Promise<boolean> {
  try {
    const stopButtonSelectors = [
        'button[aria-label="Stop generating"]',
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop"]'
    ];
    for (const selector of stopButtonSelectors) {
        const btn = page.locator(selector);
        if (await btn.isVisible({ timeout: 50 })) return true;
    }

    const streamingElement = page.locator(".result-streaming");
    if (await streamingElement.isVisible({ timeout: 50 })) return true;

    return false;
  } catch {
    return false;
  }
}

export async function readAssistantMessages(page: Page): Promise<string[]> {
  try {
    const articles = page.locator('article[data-testid^="conversation-turn-"]');
    const count = await articles.count();
    const messages: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const article = articles.nth(i);
      const fallbackText = await article.innerText().catch(() => "");
      const normalizedFallback = fallbackText.trim();
      if (/^나의 말:/i.test(normalizedFallback) || /^You said:/i.test(normalizedFallback)) {
        continue;
      }

      const isAssistant = await article.locator(".agent-turn").count() > 0 || await article.locator(".markdown").count() > 0;
      if (isAssistant) {
        const markdown = article.locator(".markdown").first();
        if (await markdown.isVisible()) {
          const text = await markdown.innerText();
          if (text.trim()) {
            messages.push(text);
            continue;
          }
        }

        const cleanedFallback = fallbackText
          .replace(/^[\s\S]*?의 말:\s*/, "")
          .replace(/^ChatGPT said:\s*/i, "")
          .trim();
        if (cleanedFallback) {
          messages.push(cleanedFallback);
        }
        continue;
      }

      const cleanedFallback = fallbackText
        .replace(/^[\s\S]*?의 말:\s*/, "")
        .replace(/^ChatGPT said:\s*/i, "")
        .trim();
      if (cleanedFallback) {
        messages.push(cleanedFallback);
      }
    }
    return messages;
  } catch {
    return [];
  }
}

export async function waitForChatGPTComposer(page: Page, timeoutMs: number): Promise<string> {
  const selectors = ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"];
  const perSelectorTimeoutMs = Math.max(1000, Math.floor(timeoutMs / selectors.length));
  await assertNoChatGPTProtection(page);
  for (const selector of selectors) {
    await assertNoChatGPTProtection(page);
    await continueChatGPTAccountPicker(page, "ChatGPT composer");
    try {
      const el = page.locator(selector).first();
      await el.waitFor({ state: "visible", timeout: perSelectorTimeoutMs });
      return selector;
    } catch {
      continue;
    }
  }
  return 'div[contenteditable="true"]';
}

export async function waitForChatGPTSendReady(page: Page, timeoutMs: number) {
  await assertNoChatGPTProtection(page);
  await continueChatGPTAccountPicker(page, "ChatGPT send ready");
  try {
    const sendButton = page.locator('button[data-testid="send-button"]').first();
    await sendButton.waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    // Ignore
  }
  await assertNoChatGPTProtection(page);
  await continueChatGPTAccountPicker(page, "ChatGPT send ready");
}

export async function submitPromptToChatGPT(
  page: Page,
  prompt: string,
  label: string = "ChatGPT",
  beforeSend?: () => void,
  onPhase?: (phase: string) => void | Promise<void>,
): Promise<void> {
  console.log(`      - [${label}] 프롬프트 전송 중...`);
  await assertNoChatGPTProtection(page, label);
  await dismissTemporaryChatOnboarding(page);
  await continueChatGPTAccountPicker(page, label);

  const idleStart = Date.now();
  while (await isChatGPTGenerating(page)) {
    await assertNoChatGPTProtection(page, label);
    await continueChatGPTAccountPicker(page, label);
    if (Date.now() - idleStart > 30000) break;
    await page.waitForTimeout(500);
  }

  await onPhase?.("composer-wait");
  const composerSelector = await waitForChatGPTComposer(page, 30000);
  const composer = page.locator(composerSelector).first();

  await assertNoChatGPTProtection(page, label);
  await composer.click();
  await page.waitForTimeout(300);
  await onPhase?.("input-start");

  if (composerSelector.startsWith("textarea")) {
    await composer.fill(prompt);
  } else {
    // Playwright fill supports contenteditable and emits input events. Preserve
    // line breaks and avoid thousands of per-key browser protocol round trips.
    await composer.fill(prompt);
  }

  await onPhase?.("input-complete");
  await waitForChatGPTSendReady(page, 10000);
  await onPhase?.("send-ready");
  await assertNoChatGPTProtection(page, label);

  // A click timeout can occur after dispatch. Never send Enter as an ambiguous retry.
  const sendBtn = page.locator('button[data-testid="send-button"]').first();
  if (await sendBtn.isVisible()) {
    beforeSend?.();
    await sendBtn.click();
  } else {
    beforeSend?.();
    await composer.press("Enter");
  }

  await page.waitForTimeout(1500);
  await onPhase?.("dispatch-complete");
}

export async function sendPromptToChatGPT(page: Page, prompt: string, label: string = "ChatGPT"): Promise<string> {
  console.log(`      - [${label}] 프롬프트 입력 중...`);
  await assertNoChatGPTProtection(page, label);
  await dismissTemporaryChatOnboarding(page);
  await continueChatGPTAccountPicker(page, label);

  // Wait until idle
  const idleStart = Date.now();
  while (await isChatGPTGenerating(page)) {
    await assertNoChatGPTProtection(page, label);
    await continueChatGPTAccountPicker(page, label);
    if (Date.now() - idleStart > 60000) break;
    await page.waitForTimeout(500);
  }

  const previousMessages = await readAssistantMessages(page);
  const previousCount = previousMessages.length;

  const composerSelector = await waitForChatGPTComposer(page, 30000);
  const composer = page.locator(composerSelector).first();

  await assertNoChatGPTProtection(page, label);
  await composer.click();
  await page.waitForTimeout(500);

  if (composerSelector.startsWith("textarea")) {
    await composer.fill(prompt);
  } else {
    // For contenteditable
    await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('div[contenteditable="true"]');
        if (el) el.innerText = '';
    });
    // chunk large prompts
    const chunks = prompt.match(/.{1,1000}/g) || [prompt];
    for (const chunk of chunks) {
      await page.keyboard.type(chunk, { delay: 2 });
    }
  }

  await page.waitForTimeout(1000);
  await waitForChatGPTSendReady(page, 10000);
  await assertNoChatGPTProtection(page, label);

  // Click send
  try {
    const sendBtn = page.locator('button[data-testid="send-button"]').first();
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
    } else {
      await composer.press("Enter");
    }
  } catch {
    await composer.press("Enter");
  }

  await page.waitForTimeout(3000);
  console.log(`      - [${label}] 생성 대기 중...`);

  // Wait for new message to appear and generation to start/finish
  const startWait = Date.now();
  let generatingSeen = false;
  let lastMessageLength = -1;
  let unchangedCount = 0;

  while (Date.now() - startWait < 300000) { // 5 min max
    await assertNoChatGPTProtection(page, label);

    const generating = await isChatGPTGenerating(page);
    if (generating) generatingSeen = true;

    const msgs = await readAssistantMessages(page);
    const currentMsgCount = msgs.length;
    let currentMsgText = "";
    if (currentMsgCount > previousCount) {
        currentMsgText = msgs[currentMsgCount - 1];
    }

    if (!generating) {
        // It's not generating. Let's check if the message is still growing.
        if (currentMsgCount > previousCount) {
            if (currentMsgText.trim().length === 0) {
                unchangedCount = 0;
                await page.waitForTimeout(1000);
                continue;
            }
            if (currentMsgText.length === lastMessageLength) {
                unchangedCount++;
                // Wait for 10 consecutive checks (approx 10 seconds) with no change
                // to account for "Searching the web" pauses where text doesn't grow.
                if (unchangedCount >= 10) {
                    break;
                }
            } else {
                lastMessageLength = currentMsgText.length;
                unchangedCount = 0;
            }
        } else if (generatingSeen) {
           // We saw it generating but no new message appeared? (weird edge case)
           unchangedCount++;
           if (unchangedCount >= 5) break;
        }
    } else {
        // It is generating, reset the unchanged count
        unchangedCount = 0;
        lastMessageLength = currentMsgText.length;
    }

    await page.waitForTimeout(1000);
  }

  const newMessages = await readAssistantMessages(page);
  const newNonEmpty = newMessages
    .slice(previousCount)
    .map((message) => message.trim())
    .filter(Boolean);
  if (newNonEmpty.length > 0) {
    return newNonEmpty[newNonEmpty.length - 1];
  }

  return newMessages
    .map((message) => message.trim())
    .filter(Boolean)
    .at(-1) || "";
}

// Runs inside page.evaluate: keep this function independent of module closures.
// Positive ownership selectors already used by readAssistantMessages / chatgpt-login.
function collectRenderableChatGPTGeneratedImages(): Array<{ src: string; width: number; height: number }> {
  const attachmentSelector = [
    '[data-testid*="attachment" i]', '[data-testid*="file-preview" i]',
    '[data-testid*="upload-preview" i]', '[class*="attachment" i]', '[class*="file-preview" i]',
  ].join(", ");
  const source = (img: HTMLImageElement) => img.currentSrc || img.src || "";
  const excluded = (img: HTMLImageElement): boolean => {
    const role = img.closest("[data-message-author-role]")?.getAttribute("data-message-author-role");
    if (role && role !== "assistant") return true;
    if (img.closest(attachmentSelector)) return true;
    const label = `${img.alt || ""} ${img.getAttribute("title") || ""} ${img.className || ""}`;
    if (/uploaded|첨부|업로드|avatar|profile[-_ ]?(?:picture|photo)|프로필|아바타/i.test(label)) return true;
    if (/(?:\/|^)avatars?(?:[\/_.-])|profile-/i.test(source(img))) return true;
    const article = img.closest('[data-testid^="conversation-turn-"]');
    return !!article && (
      (!role && !img.closest('.agent-turn')) ||
      !!article.querySelector('[data-message-author-role="user"]') ||
      /^(?:나의 말:|You said:)/i.test((article.textContent || "").trim())
    );
  };
  // Exclude a reference even when the assistant echoes its exact source URL.
  const referenceSources = new Set(Array.from(document.querySelectorAll("img"))
    .filter(excluded).map(source));
  const images = Array.from(document.querySelectorAll<HTMLImageElement>(
    '[data-message-author-role="assistant"] img, [data-testid^="conversation-turn-"] .agent-turn img',
  ));
  const seen = new Set<string>();
  return images.flatMap((img) => {
    const src = source(img);
    if (excluded(img) || referenceSources.has(src) || seen.has(src)) return [];
    if (!/^https?:\/\//i.test(src) && !src.startsWith("data:image/") && !src.startsWith("blob:")) return [];
    const rect = img.getBoundingClientRect();
    const style = window.getComputedStyle(img);
    if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0 ||
        rect.width < 180 || rect.height < 180 || style.visibility === "hidden" ||
        style.display === "none" || style.opacity === "0") return [];
    const width = Math.max(rect.width, img.naturalWidth);
    const height = Math.max(rect.height, img.naturalHeight);
    if (width < 300 || height < 300) return [];
    seen.add(src);
    return [{ src, width, height }];
  }).sort((a, b) => b.width * b.height - a.width * a.height);
}

export async function countRenderableChatGPTImages(page: Page): Promise<number> {
  try {
    return (await page.evaluate(collectRenderableChatGPTGeneratedImages)).length;
  } catch {
    return 0;
  }
}

export function isExplicitImageProviderRefusal(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const denial = /(?:can(?:not|'t|’t)|unable to)\s+(?:help|create|generate|provide)|(?:생성|제작|도와드릴|제공).{0,16}(?:수 없|어렵)|요청.{0,20}(?:거절|거부)/iu.test(normalized);
  const policy = /third.party|similarity|copyright|content policy|safety policy|서드.?파티|유사성|저작권|콘텐츠 정책|안전 정책/iu.test(normalized);
  return denial && policy;
}

export async function waitForChatGPTImageArtifacts(
  page: Page,
  timeoutMs?: number,
  options: { hardTimeoutMs?: number; now?: () => number } = {},
): Promise<number> {
  const policy = imageWaitPolicy(process.env, timeoutMs);
  const now = options.now ?? Date.now;
  const started = now();
  // Explicit legacy timeouts remain hard limits unless the caller opts into extension.
  const hardDeadline = started + (options.hardTimeoutMs ?? (timeoutMs === undefined ? policy.hardMs : policy.baseMs));
  let deadline = Math.min(hardDeadline, started + policy.baseMs);
  let previousImageCount = -1;
  let stableCycles = 0;
  let previousArtifactKey = "";
  let stableArtifactSince = started;

  while (now() < deadline) {
    let observation: { generating: boolean; imageCount: number; artifactKey: string };
    try {
      observation = await withinImageDeadline(async () => {
        await assertNoChatGPTProtection(page, "ChatGPT image wait");
        if (await isChatGPTLoginRequired(page)) {
          throw new Error(chatGptAuthenticationRequiredMessage("ChatGPT 로그인이 필요합니다."));
        }
        const artifacts = await page.evaluate(collectRenderableChatGPTGeneratedImages).catch(() => []);
        const generating = await isChatGPTGenerating(page);
        if (!generating && artifacts.length === 0) {
          const message = (await readAssistantMessages(page)).at(-1) || "";
          if (isExplicitImageProviderRefusal(message)) {
            throw new Error("IMAGE_PROVIDER_REFUSED: 생성 서비스가 요청을 거절했습니다. 사용 가능한 원본이나 허용되는 대체 장면을 선택하세요.");
          }
        }
        return {
          generating, imageCount: artifacts.length,
          artifactKey: artifacts.map(image => `${image.src}|${image.width}|${image.height}`).join("\n"),
        };
      }, Math.max(1, deadline - now()), "image observation");
    } catch (error) {
      if (error instanceof ImagePhaseTimeout) return 0;
      throw error;
    }
    if (now() >= deadline) return 0;
    const { generating, imageCount } = observation;
    // ChatGPT can leave its global stop button visible after an image completes.
    // Accept only loaded, assistant-owned artifacts whose sources and dimensions
    // stay unchanged for 15s. Uploaded references/loading previews remain excluded.
    if (imageCount > 0) {
      if (observation.artifactKey !== previousArtifactKey) {
        previousArtifactKey = observation.artifactKey;
        stableArtifactSince = now();
      } else if (now() - stableArtifactSince >= 15_000) {
        return imageCount;
      }
    } else {
      previousArtifactKey = "";
      stableArtifactSince = now();
    }
    if (generating || imageCount > previousImageCount && imageCount > 0) {
      deadline = Math.min(hardDeadline, Math.max(deadline, now() + policy.progressGraceMs));
    }

    if (!generating && imageCount > 0) {
      if (imageCount === previousImageCount) {
        stableCycles += 1;
      } else {
        previousImageCount = imageCount;
        stableCycles = 1;
      }

      if (now() - started >= 12000 && stableCycles >= 2) {
        return imageCount;
      }
    } else {
      previousImageCount = imageCount;
      stableCycles = 0;
    }

    await page.waitForTimeout(Math.min(3000, Math.max(0, deadline - now())));
  }

  // A timeout is not a successful artifact observation, even if previews were visible.
  return 0;
}



export async function downloadChatGPTImages(page: import('playwright').Page, downloadDir: string): Promise<string[]> {
  try {
    console.log("      - [이미지 다운로드] 페이지 내 생성된 이미지 탐색 중...");
    // The collector already requires loaded, visible images. Retry retrieval at the
    // caller when none are ready instead of delaying every successful download.

    // Failure diagnostics are metadata-only in the worker; screenshots can expose account data.

    const candidates = await page.evaluate(collectRenderableChatGPTGeneratedImages);
    const imagesData = await page.evaluate(async (images) => {
      const results: string[] = [];
      for (const item of images) {
        const src = item.src;
        if (src.startsWith('data:image/')) {
          results.push(src);
          continue;
        }
        if (/^https?:\/\//i.test(src) || src.startsWith('blob:')) {
          try {
            const response = await fetch(src, { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) continue;
            const reader = new FileReader();
            const base64data = await new Promise<string>((resolve, reject) => {
              reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image data"));
              reader.onerror = () => reject(reader.error || new Error("Image read failed"));
              reader.onabort = () => reject(new Error("Image read aborted"));
              reader.readAsDataURL(blob);
            });
            results.push(base64data);
          } catch {
            console.error("Failed to fetch generated image");
          }
        }
      }
      return results;
    }, candidates);

    if (imagesData.length === 0) {
      console.log("      - [이미지 다운로드] 생성된 이미지를 찾을 수 없습니다.");
      return [];
    }

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const savedPaths: string[] = [];
    for (let i = 0; i < imagesData.length; i++) {
      const base64 = imagesData[i].split(',')[1];
      if (base64) {
        const buffer = Buffer.from(base64, 'base64');
        const filepath = path.join(downloadDir, `gpt_image_${Date.now()}_${i}.png`);
        fs.writeFileSync(filepath, buffer);
        savedPaths.push(filepath);
        console.log(`      - [이미지 다운로드] 완료: ${filepath}`);
      }
    }
    return savedPaths;
  } catch {
    console.error("      - [이미지 다운로드] 에러 발생");
    return [];
  }
}

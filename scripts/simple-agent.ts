/**
 * 심플 에이전트 - 단순하게 동작하는 버전
 * 한 단계씩 확인하며 진행
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Page } from "playwright";
import type { BrowserContextOptions } from "playwright";
import { PrismaClient } from "@prisma/client";
import type { IncomingMessage } from "http";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Stealth 플러그인 적용 (봇 감지 우회)
chromium.use(StealthPlugin());

const prisma = new PrismaClient();

// AI Provider 설정 (openai 또는 gemini)
const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();

// Gemini 초기화
const gemini = AI_PROVIDER === "gemini" 
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "")
  : null;

const SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "naver-session.json");
const CHATGPT_SESSION_FILE = path.join(process.cwd(), "playwright", "storage", "chatgpt-session.json");
const TEMP_PATH = path.join(process.cwd(), "temp_images");
const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID || "";
const BROWSER_GPT_MODE = (process.env.BROWSER_GPT_MODE || "false").toLowerCase() === "true";
const CHATGPT_DRAFT_GPT_URL =
  process.env.CHATGPT_GPT_URL_DRAFT ||
  process.env.CHATGPT_GPT_URL ||
  "https://chatgpt.com/";
const CHATGPT_POLISH_GPT_URL =
  process.env.CHATGPT_GPT_URL_POLISH ||
  process.env.CHATGPT_GPT_URL_DRAFT ||
  process.env.CHATGPT_GPT_URL ||
  "https://chatgpt.com/";
const CHATGPT_TIMEOUT_MS = Number(process.env.CHATGPT_TIMEOUT_MS || "180000");
const CHATGPT_HEADLESS = (process.env.CHATGPT_HEADLESS || "false").toLowerCase() === "true";

if (!fs.existsSync(TEMP_PATH)) fs.mkdirSync(TEMP_PATH, { recursive: true });

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isSecurityVerificationPage(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return (
    normalized.includes("security verification") ||
    normalized.includes("please complete the security verification") ||
    normalized.includes("보안 인증") ||
    normalized.includes("실제 사용자인지 확인") ||
    normalized.includes("자동입력 방지")
  );
}

function isInvalidProductName(name: string): boolean {
  const normalized = normalizeText(name).toLowerCase();
  return (
    !normalized ||
    normalized === "naver" ||
    normalized === "네이버" ||
    normalized.includes("네이버 브랜드 커넥트") ||
    normalized.includes("security verification") ||
    normalized.includes("보안 인증")
  );
}

interface OpenCodeJsonEvent {
  type?: string;
  part?: {
    text?: string;
  };
}

const DEFAULT_SECTION_TITLES = [
  "🛒 구매하게 된 계기",
  "📦 택배 도착 & 개봉기",
  "✨ 첫인상 / 디자인",
  "📐 크기 & 스펙 정보",
  "⭐ 주요 기능 ①",
  "⭐ 주요 기능 ②",
  "💡 실제 사용 후기",
  "✅ 장점 정리",
  "⚠️ 아쉬운 점",
  "🎯 이런 분께 추천해요",
];

const DEFAULT_HASHTAGS = [
  "추천",
  "후기",
  "리뷰",
  "비교",
  "순위",
  "가격",
  "장단점",
  "일상",
  "가성비",
  "생활용품",
];

function containsBadImageKeyword(url: string): boolean {
  return /icon|logo|banner|sprite|thumb|thumbnail|coupon|benefit|guide|notice|delivery|event|ads?/i.test(url);
}

function normalizeCandidateImageUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\?type=.*/i, "?type=w860");
}

function isCandidateProductImageUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  if (!url) return false;
  const isImageDomain =
    url.includes("shop-phinf.pstatic.net") ||
    url.includes("shopping-phinf.pstatic.net") ||
    url.includes("phinf.pstatic.net");

  if (!isImageDomain) return false;
  if (containsBadImageKeyword(url)) return false;
  if (url.includes("1x1")) return false;
  return true;
}

function prioritizeImageUrls(urls: string[]): string[] {
  const scored = urls.map((url, index) => {
    const lower = url.toLowerCase();
    let score = 0;

    if (index === 0) score += 800; // og:image를 첫 후보로 넣기 때문에 대표 이미지 우선
    if (/\.(jpe?g)(\?|$)/i.test(lower)) score += 200;
    if (/\.png(\?|$)/i.test(lower)) score -= 120;
    if (containsBadImageKeyword(lower)) score -= 300;
    score += Math.max(0, 80 - index); // 상단 노출 이미지를 우선

    return { url, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((item) => item.url);
}

function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "");
}

function sanitizeTitle(rawTitle: string, fallback: string): string {
  const cleaned = stripEmoji(rawTitle).replace(/\s+/g, " ").trim();
  if (cleaned.length > 0) return cleaned.slice(0, 80);
  return stripEmoji(fallback).replace(/\s+/g, " ").trim().slice(0, 80);
}

function runOpenCode(prompt: string): string {
  const model = process.env.OPENCODE_MODEL || "openai/gpt-5.2-codex";
  const variant = process.env.OPENCODE_VARIANT || "medium";

  const result = spawnSync(
    "opencode",
    [
      "run",
      prompt,
      "--format=json",
      "--model",
      model,
      "--variant",
      variant,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  if (result.error) {
    throw new Error(`opencode 실행 실패: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(`opencode run 실패: ${message || `exit code ${result.status}`}`);
  }

  const textChunks: string[] = [];
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as OpenCodeJsonEvent;
      if (event.type === "text" && typeof event.part?.text === "string") {
        textChunks.push(event.part.text);
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  const output = textChunks.join("\n").trim();
  if (!output) {
    throw new Error("opencode 응답에서 텍스트를 찾지 못했습니다.");
  }

  return output;
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
    const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
    if (isVisible) return selector;
  }
  return null;
}

async function isChatGPTLoginRequired(page: Page): Promise<boolean> {
  const loginButtons = [
    page.getByRole("button", { name: /log in/i }).first(),
    page.getByRole("button", { name: /로그인/i }).first(),
    page.getByRole("link", { name: /log in/i }).first(),
    page.getByRole("link", { name: /로그인/i }).first(),
  ];

  for (const button of loginButtons) {
    const visible = await button.isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function waitForChatGPTComposer(page: Page, timeoutMs: number): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const selector = await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS);
    if (selector) return selector;

    if (await isChatGPTLoginRequired(page)) {
      throw new Error("ChatGPT 로그인이 필요합니다. `npm run login:chatgpt` 실행 후 다시 시도하세요.");
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("ChatGPT 입력창을 찾지 못했습니다. 로그인 상태 또는 페이지 로딩을 확인하세요.");
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
    const cleaned = texts
      .map((text) => normalizeText(text))
      .filter((text) => text.length > 0);

    if (cleaned.length > 0) {
      return cleaned;
    }
  }

  return [];
}

async function isChatGPTGenerating(page: Page): Promise<boolean> {
  for (const selector of CHATGPT_STOP_BUTTON_SELECTORS) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function waitForChatGPTAssistantReply(
  page: Page,
  previousCount: number,
  timeoutMs: number
): Promise<string> {
  const start = Date.now();
  let lastText = "";
  let stableRounds = 0;

  while (Date.now() - start < timeoutMs) {
    const messages = await readAssistantMessages(page);
    if (messages.length > previousCount) {
      const candidate = messages[messages.length - 1];

      if (candidate === lastText) {
        stableRounds += 1;
      } else {
        lastText = candidate;
        stableRounds = 0;
      }

      const generating = await isChatGPTGenerating(page);
      if (!generating && stableRounds >= 1 && candidate.length > 0) {
        return candidate;
      }
    }

    await page.waitForTimeout(1200);
  }

  throw new Error("ChatGPT 응답 대기 시간이 초과되었습니다.");
}

async function sendPromptToChatGPT(page: Page, prompt: string): Promise<string> {
  const previousMessages = await readAssistantMessages(page);
  const composerSelector = await waitForChatGPTComposer(page, CHATGPT_TIMEOUT_MS);
  const composer = page.locator(composerSelector).first();

  await composer.click();

  if (composerSelector.startsWith("textarea")) {
    await composer.fill(prompt);
  } else {
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type(prompt, { delay: 1 });
  }

  const sendButtonSelector = await findVisibleSelector(page, CHATGPT_SEND_BUTTON_SELECTORS);

  if (sendButtonSelector) {
    await page.locator(sendButtonSelector).first().click();
  } else {
    await composer.press("Enter");
  }

  return waitForChatGPTAssistantReply(page, previousMessages.length, CHATGPT_TIMEOUT_MS);
}

async function runChatGPTBrowserTwoPass(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!fs.existsSync(CHATGPT_SESSION_FILE)) {
    throw new Error("ChatGPT 세션 파일이 없습니다. `npm run login:chatgpt` 실행 후 다시 시도하세요.");
  }

  const browser = await chromium.launch({
    headless: CHATGPT_HEADLESS,
    slowMo: CHATGPT_HEADLESS ? 0 : 30,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const contextOptions: BrowserContextOptions = {
      viewport: { width: 1440, height: 960 },
      locale: "ko-KR",
      storageState: CHATGPT_SESSION_FILE,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    await page.goto(CHATGPT_DRAFT_GPT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    if (await isChatGPTLoginRequired(page)) {
      throw new Error("ChatGPT 로그인 세션이 만료되었습니다. `npm run login:chatgpt` 실행 후 다시 시도하세요.");
    }

    const firstPrompt = [
      "아래 지시를 수행하고 최종 결과를 JSON만 출력해.",
      "",
      "[시스템 지시사항]",
      systemPrompt,
      "",
      "[사용자 요청]",
      userPrompt,
      "",
      "반드시 JSON만 반환하고 설명 문장은 쓰지 마.",
    ].join("\n");

    const firstDraft = await sendPromptToChatGPT(page, firstPrompt);

    // 2차 다듬기는 별도 GPT(또는 동일 GPT)로 수행
    if (CHATGPT_POLISH_GPT_URL !== CHATGPT_DRAFT_GPT_URL) {
      await page.goto(CHATGPT_POLISH_GPT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);

      if (await isChatGPTLoginRequired(page)) {
        throw new Error("ChatGPT 로그인 세션이 만료되었습니다. `npm run login:chatgpt` 실행 후 다시 시도하세요.");
      }
    }

    const secondPrompt = [
      "아래 초안을 최종본으로 다듬어.",
      "- 출력은 JSON만",
      "- title에 이모지 절대 금지",
      "- sections는 각 항목이 '이모지 소제목 + 빈 줄 + 본문 4~6문장' 구조를 유지",
      "- 불필요한 설명/마크다운 금지",
      "",
      "[초안]",
      firstDraft,
    ].join("\n");

    const polished = await sendPromptToChatGPT(page, secondPrompt);
    await context.storageState({ path: CHATGPT_SESSION_FILE });
    await context.close();

    return polished;
  } finally {
    if (browser.isConnected()) {
      await browser.close();
    }
  }
}

function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function splitSectionCandidates(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const parts = normalized
    .split(/\n(?=[🛒📦✨📐⭐💡✅⚠️🎯][^\n]*)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts : [normalized];
}

function buildFallbackSection(title: string, product: ProductInfo): string {
  const plainTitle = title.replace(/[🛒📦✨📐⭐💡✅⚠️🎯]/g, "").trim() || "사용 후기";
  const priceText = product.price || "가격 정보";

  return [
    title,
    "",
    `${product.name} 기준으로 ${plainTitle} 포인트를 중심으로 정리해봤어요.`,
    `실제로 확인해보니 핵심 장점이 분명해서 비교가 쉬웠어요.`,
    `${priceText} 기준으로 봤을 때 구성 대비 만족도가 괜찮았어요.`,
    `과장 없이 실사용 관점에서 추천할 수 있는 제품이었어요.`,
    "",
  ].join("\n");
}

function normalizeSectionText(raw: string, fallbackTitle: string, product: ProductInfo): string {
  const normalized = raw.replace(/\r/g, "").trim();

  if (!normalized) {
    return buildFallbackSection(fallbackTitle, product);
  }

  const allLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let title = allLines[0] || fallbackTitle;
  const hasEmojiPrefix = /^[🛒📦✨📐⭐💡✅⚠️🎯]/.test(title);
  if (!hasEmojiPrefix || title.length > 60) {
    title = fallbackTitle;
  }

  let bodyLines = allLines.slice(1);

  if (bodyLines.length === 0) {
    const sentenceParts = normalized
      .replace(title, "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    bodyLines = sentenceParts;
  }

  if (bodyLines.length < 4) {
    const fallback = buildFallbackSection(title, product)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(1);
    bodyLines = [...bodyLines, ...fallback].slice(0, 4);
  }

  if (bodyLines.length > 6) {
    bodyLines = bodyLines.slice(0, 6);
  }

  return `${title}\n\n${bodyLines.join("\n")}\n`;
}

function normalizeSections(rawSections: unknown, targetCount: number, product: ProductInfo): string[] {
  const rawList = Array.isArray(rawSections)
    ? rawSections.filter((item): item is string => typeof item === "string")
    : [];

  const expanded: string[] = [];
  for (const section of rawList) {
    expanded.push(...splitSectionCandidates(section));
  }

  const normalized = expanded.map((section, index) =>
    normalizeSectionText(section, DEFAULT_SECTION_TITLES[index % DEFAULT_SECTION_TITLES.length], product)
  );

  while (normalized.length < targetCount) {
    const index = normalized.length;
    normalized.push(
      buildFallbackSection(DEFAULT_SECTION_TITLES[index % DEFAULT_SECTION_TITLES.length], product)
    );
  }

  return normalized.slice(0, targetCount);
}

function normalizeHashtags(rawHashtags: unknown, product: ProductInfo): string[] {
  const fromModel = Array.isArray(rawHashtags)
    ? rawHashtags.filter((item): item is string => typeof item === "string")
    : [];

  const normalized = fromModel
    .map((tag) => tag.replace(/^#/, "").replace(/\s+/g, "").trim())
    .filter((tag) => tag.length > 0);

  const productSeed = product.name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 4);

  const merged = [...normalized, ...productSeed, ...DEFAULT_HASHTAGS];
  const deduped = Array.from(new Set(merged)).slice(0, 20);
  return deduped;
}

// ============================================
// STEP 1: 상품 페이지에서 상품 정보 + 이미지 추출
// ============================================
interface ProductInfo {
  name: string;
  description: string;
  features: string[];
  price: string;
  originalPrice: string;      // 원가 (할인 전 가격)
  discountRate: string;       // 할인율 (예: "30%")
  couponInfo: string;         // 쿠폰 정보
  deliveryInfo: string;       // 배송 정보 (무료배송 등)
  reviewCount: string;        // 리뷰 수
  rating: string;             // 평점
  imagePaths: string[];
}

async function step1_getProductInfo(page: Page, url: string): Promise<ProductInfo> {
  console.log("\n📦 STEP 1: 상품 정보 수집");
  
  await page.goto(url, { timeout: 30000 });
  await page.waitForTimeout(5000);

  const bodyText = await page.textContent("body");
  if (bodyText && isSecurityVerificationPage(bodyText)) {
    throw new Error("네이버 보안 인증 페이지가 표시되어 상품 정보를 가져올 수 없습니다. 브라우저에서 인증 후 다시 시도하세요.");
  }
  
  // 1. 상품명 추출 (여러 방법 시도)
  let productName = "";
  
  // og:title에서 추출
  const ogTitle = await page.$('meta[property="og:title"]');
  if (ogTitle) {
    const content = await ogTitle.getAttribute('content');
    if (content) productName = content.split(':')[0].split('-')[0].trim();
  }
  
  // 페이지 내 상품명 요소에서 추출 (더 정확)
  const nameSelectors = [
    '._3oDjSvLwEZ',           // 스마트스토어 상품명
    '.product_title',
    'h2._22kNQuEXmb',
    '[class*="product_title"]',
    '[class*="ProductName"]',
  ];
  
  for (const selector of nameSelectors) {
    const el = await page.$(selector);
    if (el) {
      const text = await el.textContent();
      if (text && text.length > 3) {
        productName = text.trim();
        break;
      }
    }
  }
  
  if (!productName) {
    productName = (await page.title()).split(':')[0].split('-')[0].trim();
  }

  if (isInvalidProductName(productName)) {
    throw new Error(`상품명 추출 실패: "${productName || "빈 값"}". 보안 인증 또는 페이지 로딩 문제일 수 있습니다.`);
  }
  console.log(`   📌 상품명: ${productName}`);
  
  // 2. 상품 설명 추출
  let description = "";
  const descSelectors = [
    '._1s2eOHMQjt',           // 스마트스토어 상품 설명
    '.product_detail_description',
    '[class*="description"]',
    'meta[property="og:description"]',
  ];
  
  for (const selector of descSelectors) {
    if (selector.startsWith('meta')) {
      const meta = await page.$(selector);
      if (meta) {
        description = await meta.getAttribute('content') || "";
        break;
      }
    } else {
      const el = await page.$(selector);
      if (el) {
        description = (await el.textContent())?.trim() || "";
        if (description.length > 10) break;
      }
    }
  }
  console.log(`   📝 설명: ${description.substring(0, 50)}...`);
  
  // 3. 상품 특징/키워드 추출
  const features: string[] = [];
  const featureEls = await page.$$('[class*="benefit"], [class*="feature"], [class*="spec"] li');
  for (const el of featureEls.slice(0, 5)) {
    const text = await el.textContent();
    if (text && text.length > 3 && text.length < 50) {
      features.push(text.trim());
    }
  }
  console.log(`   ✨ 특징: ${features.length}개`);
  
  // 4. 가격 추출
  let price = "";
  const priceSelectors = ['._1LY7DqCnwR', '.total_price', '[class*="price"]:not([class*="original"])'];
  for (const selector of priceSelectors) {
    const el = await page.$(selector);
    if (el) {
      price = (await el.textContent())?.trim() || "";
      if (price.includes('원')) break;
    }
  }
  console.log(`   💰 가격: ${price}`);

  // 4-1. 원가 (할인 전 가격) 추출
  let originalPrice = "";
  const originalPriceSelectors = [
    'del', 'strike', 
    '[class*="original"]', '[class*="before"]', 
    '._2DywKu0J_Y',  // 스마트스토어 원가
    '.price_del'
  ];
  for (const selector of originalPriceSelectors) {
    const el = await page.$(selector);
    if (el) {
      const text = (await el.textContent())?.trim() || "";
      if (text.includes('원') || /[\d,]+/.test(text)) {
        originalPrice = text;
        break;
      }
    }
  }
  if (originalPrice) console.log(`   💸 원가: ${originalPrice}`);

  // 4-2. 할인율 추출
  let discountRate = "";
  const discountSelectors = [
    '[class*="discount"]', '[class*="sale"]',
    '._2pgHN-ntx6',  // 스마트스토어 할인율
    '.discount_rate', '[class*="percent"]'
  ];
  for (const selector of discountSelectors) {
    const el = await page.$(selector);
    if (el) {
      const text = (await el.textContent())?.trim() || "";
      if (text.includes('%')) {
        discountRate = text.match(/\d+%/)?.[0] || text;
        break;
      }
    }
  }
  if (discountRate) console.log(`   🔥 할인율: ${discountRate}`);

  // 4-3. 쿠폰/혜택 정보 추출
  let couponInfo = "";
  const couponSelectors = [
    '[class*="coupon"]', '[class*="benefit"]',
    '[class*="naver_point"]', '[class*="npay"]',
    '._1zItxZRrZt',  // 스마트스토어 쿠폰
    '.benefit_info'
  ];
  const couponTexts: string[] = [];
  for (const selector of couponSelectors) {
    const els = await page.$$(selector);
    for (const el of els.slice(0, 3)) {
      const text = (await el.textContent())?.trim() || "";
      if (text && text.length > 2 && text.length < 100 && !couponTexts.includes(text)) {
        couponTexts.push(text);
      }
    }
  }
  couponInfo = couponTexts.join(' / ');
  if (couponInfo) console.log(`   🎁 쿠폰/혜택: ${couponInfo.substring(0, 50)}...`);

  // 4-4. 배송 정보 추출
  let deliveryInfo = "";
  const deliverySelectors = [
    '[class*="delivery"]', '[class*="shipping"]',
    '._2OAJPEG1R8',  // 스마트스토어 배송
    '.delivery_fee_info'
  ];
  for (const selector of deliverySelectors) {
    const el = await page.$(selector);
    if (el) {
      const text = (await el.textContent())?.trim() || "";
      if (text && (text.includes('배송') || text.includes('무료') || text.includes('도착'))) {
        deliveryInfo = text.replace(/\s+/g, ' ').substring(0, 50);
        break;
      }
    }
  }
  if (deliveryInfo) console.log(`   🚚 배송: ${deliveryInfo}`);

  // 4-5. 리뷰 수 & 평점 추출
  let reviewCount = "";
  let rating = "";
  const reviewSelectors = [
    '[class*="review"]', '[class*="rating"]',
    '._2LvUD5PAiM',  // 스마트스토어 리뷰
    '.review_count'
  ];
  for (const selector of reviewSelectors) {
    const el = await page.$(selector);
    if (el) {
      const text = (await el.textContent())?.trim() || "";
      // 리뷰 수 추출 (숫자가 포함된 경우)
      const countMatch = text.match(/[\d,]+(?=\s*개|\s*건)?/);
      if (countMatch && !reviewCount) {
        reviewCount = countMatch[0];
      }
      // 평점 추출 (4.8 같은 형태)
      const ratingMatch = text.match(/\d\.\d/);
      if (ratingMatch && !rating) {
        rating = ratingMatch[0];
      }
    }
  }
  if (reviewCount) console.log(`   ⭐ 리뷰: ${reviewCount}개`);
  if (rating) console.log(`   ⭐ 평점: ${rating}`);
  
  // 5. 상품 이미지 URL 추출
  console.log("   🖼️ 이미지 URL 추출 중...");
  const candidateUrls: string[] = [];

  // 대표 이미지는 og:image를 우선 후보로 사용
  const ogImage = await page.getAttribute('meta[property="og:image"]', "content").catch(() => null);
  if (ogImage && isCandidateProductImageUrl(ogImage)) {
    candidateUrls.push(normalizeCandidateImageUrl(ogImage));
  }

  const images = await page.$$("img");
  for (const img of images) {
    const src = (await img.getAttribute("data-src")) || (await img.getAttribute("src")) || "";
    if (!isCandidateProductImageUrl(src)) continue;
    candidateUrls.push(normalizeCandidateImageUrl(src));
    if (candidateUrls.length >= 40) break;
  }

  const dedupedUrls = Array.from(new Set(candidateUrls));
  const imageUrls = prioritizeImageUrls(dedupedUrls).slice(0, 15);
  console.log(`   🖼️ ${imageUrls.length}개 이미지 발견`);
  
  // 이미지 다운로드 (최대 10개로 확대)
  const downloaded: { path: string; url: string; size: number }[] = [];
  const downloadCount = Math.min(10, imageUrls.length);
  
  for (let i = 0; i < downloadCount; i++) {
    try {
      const imgPath = path.join(TEMP_PATH, `product_${Date.now()}_${i}.jpg`);
      await downloadImage(imageUrls[i], imgPath);
      const stats = fs.statSync(imgPath);

      // 너무 작은 이미지는 대표/본문용으로 부적합해서 제외
      if (stats.size < 20_000) {
        try { fs.unlinkSync(imgPath); } catch {}
        console.log(`   ⚠️ 이미지 제외(너무 작음) ${i + 1}`);
        continue;
      }

      downloaded.push({ path: imgPath, url: imageUrls[i], size: stats.size });
      console.log(`   ✅ 이미지 ${i + 1}/${downloadCount} 다운로드`);
    } catch {
      console.log(`   ⚠️ 다운로드 실패 ${i + 1}`);
    }
  }

  downloaded.sort((a, b) => {
    const aPenalty = containsBadImageKeyword(a.url) ? -150_000 : 0;
    const bPenalty = containsBadImageKeyword(b.url) ? -150_000 : 0;
    const aScore = a.size + aPenalty;
    const bScore = b.size + bPenalty;
    return bScore - aScore;
  });

  const imagePaths = downloaded.map((item) => item.path);
  
  return {
    name: productName,
    description,
    features,
    price,
    originalPrice,
    discountRate,
    couponInfo,
    deliveryInfo,
    reviewCount,
    rating,
    imagePaths,
  };
}

// 이미지 다운로드 함수
async function downloadImage(url: string, filePath: string): Promise<void> {
  const https = await import('https');
  const http = await import('http');
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filePath);
    
    protocol.get(url, (response: IncomingMessage) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, filePath).then(resolve).catch(reject);
          return;
        }
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err: Error) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

// ============================================
// AI 공통 호출 함수 (OpenAI / Gemini)
// ============================================
async function generateWithAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (BROWSER_GPT_MODE) {
    return runChatGPTBrowserTwoPass(systemPrompt, userPrompt);
  }

  if (AI_PROVIDER === "gemini" && gemini) {
    // Gemini 사용
    const model = gemini.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 4000,
      }
    });
    
    // Gemini는 system prompt를 user prompt에 합쳐서 전달
    const combinedPrompt = `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 요청]\n${userPrompt}`;
    const result = await model.generateContent(combinedPrompt);
    return result.response.text();
    
  } else if (AI_PROVIDER === "openai") {
    // OpenAI는 opencode 인증 세션을 통해 호출 (API 키 불필요)
    const combinedPrompt = `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 요청]\n${userPrompt}`;
    return runOpenCode(combinedPrompt);
    
  } else {
    throw new Error("AI Provider가 설정되지 않았습니다. .env 파일을 확인하세요.");
  }
}

// ============================================
// STEP 2: LLM으로 SEO 최적화 글 생성 (긴 버전)
// ============================================
async function step2_generatePost(product: ProductInfo, brandLink: string): Promise<{ title: string; sections: string[]; hashtags: string[] }> {
  console.log("\n📝 STEP 2: SEO 최적화 블로그 글 생성 (확장판)");
  console.log(`   🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);
  if (BROWSER_GPT_MODE) {
    console.log(`   🌐 Browser GPT Mode: ON`);
    console.log(`      - Draft GPT: ${CHATGPT_DRAFT_GPT_URL}`);
    console.log(`      - Polish GPT: ${CHATGPT_POLISH_GPT_URL}`);
  }
  
  const bodySectionCount = Math.max(Math.min(product.imagePaths.length, 10), 8);
  
  // 인트로 변화를 위한 랜덤 요소
  const intros = [
    "요즘 고민하다가 드디어 질렀어요",
    "궁금해서 바로 주문해봤어요", 
    "많이들 추천하셔서 저도 써봤어요",
    "오랫동안 찾던 제품을 드디어 발견했어요",
    "친구 추천으로 구매하게 됐어요"
  ];
  const randomIntro = intros[Math.floor(Math.random() * intros.length)];
  
  const endings = [
    "강력 추천드려요", "만족스러워요", "재구매 의사 있어요",
    "가성비 좋아요", "후회 없는 선택이에요"
  ];
  const randomEnding = endings[Math.floor(Math.random() * endings.length)];

  const systemPrompt = `당신은 인기 네이버 블로거입니다. 
- 친근하고 솔직한 ~요체 사용 (했어요, 같아요, 더라고요, 거든요)
- 상품을 정확히 이해하고 실제 사용한 것처럼 생생하게 작성
- SEO를 위해 상품명, 관련 키워드를 자연스럽게 본문에 포함
- 매번 조금씩 다른 표현 사용 (똑같은 문구 반복 금지)
- 과장 없이 신뢰감 있게 작성`;

  const userPrompt = `다음 상품의 상세 블로그 리뷰를 작성해주세요.

## 상품 정보
- 상품명: ${product.name}
- 설명: ${product.description || '(상품 설명 참고)'}
- 특징: ${product.features.join(', ') || '(상품 특징 참고)'}
- 가격: ${product.price || '(가격 정보 참고)'}
${product.originalPrice ? `- 원가: ${product.originalPrice}` : ''}
${product.discountRate ? `- 할인율: ${product.discountRate} 할인 중!` : ''}
${product.couponInfo ? `- 쿠폰/혜택: ${product.couponInfo}` : ''}
${product.deliveryInfo ? `- 배송: ${product.deliveryInfo}` : ''}
${product.reviewCount ? `- 리뷰: ${product.reviewCount}개` : ''}
${product.rating ? `- 평점: ${product.rating}점` : ''}

## 이번 글의 톤
- 인트로 힌트: "${randomIntro}"
- 마무리 힌트: "${randomEnding}"
- 이 힌트를 참고해서 자연스럽게 변형해서 사용

## 작성 규칙
1. 제목: 상품 카테고리 + 상품명 키워드 포함, 25-35자
   - 제목에는 이모지를 절대 넣지 마세요.
   예: "아기비데 추천 | 해피달링 시그니처 워터탭 솔직 후기"

2. 본문을 정확히 ${bodySectionCount}개 섹션으로 작성 (총 2000자 이상)

3. 각 섹션 구조:
   - 이모지 + 소제목 (한 줄)
   - 빈 줄
   - 본문 4-6문장 (각 문장 끝에 줄바꿈, 각 문장 30-50자)
   - 빈 줄

4. 섹션 구성 (${bodySectionCount}개):
   - 🛒 구매하게 된 계기
   - 📦 택배 도착 & 개봉기
   - ✨ 첫인상 / 디자인
   - 📐 크기 & 스펙 정보
   - ⭐ 주요 기능 ①
   - ⭐ 주요 기능 ② 
   - 💡 실제 사용 후기
   - ✅ 장점 정리
   - ⚠️ 아쉬운 점 (솔직하게)
   - 🎯 이런 분께 추천해요

5. SEO 키워드 삽입:
   - 제목에 메인 키워드
   - 첫 문장에 상품명 포함
   - 본문 중간중간 관련 키워드 자연스럽게 배치

6. 할인/특가 정보 활용 (있는 경우만):
   - 할인율이 있으면 "🔥 지금 XX% 할인 중!", "특가 진행 중" 등 강조
   - 쿠폰 정보가 있으면 "쿠폰까지 챙기면 더 싸게!", "추가 할인 가능" 언급
   - 무료배송이면 "무료배송이라 부담 없어요" 등 언급
   - 리뷰 수가 많으면 "리뷰가 XXXX개나 되더라고요, 믿고 샀어요" 등 신뢰도 강조
   - 평점이 높으면 "평점 X.X점으로 검증된 제품" 등 언급
   - 이런 정보는 구매 유도 섹션이나 마무리 부분에서 자연스럽게 활용

7. 해시태그 20개:
   - 상품명 관련 (3개)
   - 카테고리 관련 (5개)  
   - 검색용 키워드 (7개): 추천, 후기, 리뷰, 비교, 순위, 가격, 장단점
   - 일반 태그 (5개): 일상, 육아템, 생활용품, 가성비 등

## 출력 (JSON만, 줄바꿈은 \\n)
{
  "title": "SEO 최적화 제목",
  "sections": [
    "🛒 소제목\\n\\n문장1.\\n문장2.\\n문장3.\\n문장4.\\n",
    "📦 소제목\\n\\n문장1.\\n문장2.\\n문장3.\\n"
  ],
  "hashtags": ["키워드1", "키워드2", ...]
}`;
  
  const text = await generateWithAI(systemPrompt, userPrompt);
  const json = parseJsonObjectFromText(text);
  
  // 마지막에 필수 문구와 구매링크 추가 (링크 프리뷰가 문장을 끊지 않도록 순서 변경)
  const lastSection = `

이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.

👉 구매링크: ${brandLink}`;
  
  const bodySections = normalizeSections(json.sections, bodySectionCount, product);
  const sections = [...bodySections];
  sections.push(lastSection);
  const hashtags = normalizeHashtags(json.hashtags, product);
  
  const normalizedTitle = sanitizeTitle(
    typeof json.title === "string" ? json.title : product.name,
    product.name
  );

  const totalLength = sections.reduce((sum: number, s: string) => sum + s.length, 0);
  console.log(`   📌 제목: ${normalizedTitle}`);
  console.log(`   📝 섹션: ${sections.length}개, 총 ${totalLength}자`);
  console.log(`   🏷️ 해시태그: ${hashtags.length}개`);
  console.log(`      ${hashtags.slice(0, 8).join(', ')}...`);
  
  return {
    title: normalizedTitle,
    sections: sections,
    hashtags
  };
}

// ============================================
// STEP 3: 블로그 에디터 열기
// ============================================
async function step3_openEditor(page: Page): Promise<void> {
  console.log("\n📄 STEP 3: 블로그 글쓰기 페이지");
  
  await page.goto(`https://blog.naver.com/${NAVER_BLOG_ID}/postwrite`, { timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // 팝업 닫기 (작성 중인 글 있습니다)
  try {
    const cancelBtn = await page.$('.se-popup-button-cancel');
    if (cancelBtn) {
      await cancelBtn.click();
      console.log("   팝업 닫음");
      await page.waitForTimeout(1000);
    }
  } catch {}
  
  console.log("   ✅ 에디터 준비 완료");
}

// ============================================
// STEP 4: 제목 입력
// ============================================
async function step4_inputTitle(page: Page, title: string): Promise<void> {
  console.log("\n✏️ STEP 4: 제목 입력");
  
  // 제목 영역 클릭
  const titleArea = await page.$('.se-documentTitle .se-text-paragraph');
  if (titleArea) {
    await titleArea.click();
    await page.waitForTimeout(300);
  } else {
    // 좌표로 클릭 (제목 위치)
    await page.mouse.click(640, 130);
    await page.waitForTimeout(300);
  }
  
  await page.keyboard.type(title, { delay: 30 });
  console.log(`   ✅ 제목 입력: "${title}"`);
}

// ============================================
// STEP 5: 이미지 1장 업로드 (반복 호출용)
// ============================================
async function uploadOneImage(page: Page, imagePath: string): Promise<boolean> {
  try {
    const imageBtn = await page.$('button[data-name="image"]');
    if (imageBtn) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
        imageBtn.click()
      ]);
      
      if (fileChooser) {
        await fileChooser.setFiles(imagePath);
        await page.waitForTimeout(2500); // 업로드 완료 대기
        return true;
      }
    }
  } catch (e) {
    console.log(`   ⚠️ 업로드 실패: ${e}`);
  }
  return false;
}

// 텍스트 섹션 입력 (줄바꿈 포함)
async function inputTextSection(page: Page, text: string): Promise<void> {
  // \n을 실제 줄바꿈으로 처리
  const lines = text.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.trim() === '') {
      // 빈 줄이면 Enter만
      await page.keyboard.press('Enter');
    } else {
      // 텍스트가 있으면 입력 후 Enter
      await page.keyboard.type(line, { delay: 3 });
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(50);
  }
  
  // 섹션 끝에 여백 추가
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
}

// ============================================
// STEP 5+6: 이미지와 본문 번갈아 입력
// ============================================
async function step5and6_uploadAndWrite(page: Page, imagePaths: string[], sections: string[], hashtags: string[]): Promise<void> {
  console.log("\n📝 STEP 5+6: 이미지 + 본문 번갈아 입력");
  
  // 본문 영역으로 이동
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  
  const mainSections = sections.length > 1 ? sections.slice(0, -1) : sections;
  const tailSection = sections.length > 1 ? sections[sections.length - 1] : "";
  const maxLoop = mainSections.length;
  let uploadedCount = 0;
  
  for (let i = 0; i < maxLoop; i++) {
    // 이미지 업로드 (있으면)
    if (i < imagePaths.length) {
      console.log(`   [${i + 1}] 🖼️ 이미지 업로드...`);
      const success = await uploadOneImage(page, imagePaths[i]);
      if (success) uploadedCount++;
    }
    
    // 텍스트 섹션 입력 (있으면)
    if (i < mainSections.length) {
      console.log(`   [${i + 1}] ✏️ 텍스트 입력 (${mainSections[i].length}자)`);
      await inputTextSection(page, mainSections[i]);
      await page.waitForTimeout(300);
    }
  }

  if (tailSection) {
    console.log(`   [마무리] ✏️ 텍스트 입력 (${tailSection.length}자)`);
    await inputTextSection(page, tailSection);
    await page.waitForTimeout(300);
  }
  
  // 해시태그 (맨 마지막) - 스페이스 제거하여 태그 깨짐 방지
  await page.keyboard.press('Enter');
  const hashtagText = hashtags.map((t: string) => `#${t.replace(/\s+/g, '')}`).join(' ');
  await page.keyboard.type(hashtagText, { delay: 10 });
  
  console.log(`\n   ✅ 총 이미지 ${uploadedCount}개 업로드`);
  console.log(`   ✅ 총 섹션 ${sections.length}개 입력`);
  console.log(`   ✅ 해시태그 ${hashtags.length}개`);
}

// ============================================
// STEP 7: 발행 (도움말 닫기 → 발행 버튼 → 설정 → 최종 발행)
// ============================================
async function step7_publish(page: Page): Promise<boolean> {
  console.log("\n🚀 STEP 7: 발행");
  
  // 1. 도움말/팝업/사이드바 닫기
  console.log("   도움말/팝업 닫기...");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  
  // 닫기 버튼들 클릭 시도
  const closeSelectors = [
    '.help_layer button[class*="close"]',
    '.tooltip button[class*="close"]',
    '.guide_layer button[class*="close"]',
    '[class*="close_btn"]',
    '[class*="closeBtn"]',
    'button[aria-label="닫기"]',
    '.se-help-panel-close-button',
  ];
  
  for (const selector of closeSelectors) {
    const closeBtn = await page.$(selector);
    if (closeBtn) {
      await closeBtn.click().catch(() => {});
      console.log(`   닫기 버튼 클릭: ${selector}`);
      await page.waitForTimeout(300);
    }
  }
  
  // 페이지 상단으로
  await page.evaluate(`window.scrollTo(0, 0)`);
  await page.waitForTimeout(500);
  
  // 2. 첫 번째 발행 버튼 클릭 (상단 헤더)
  console.log("   1차 발행 버튼 클릭...");
  
  // 우측 상단 발행 버튼 (초록색)
  const headerPublishBtn = await page.$('button[class*="publish_btn"], header button[class*="publish"]');
  if (headerPublishBtn) {
    await headerPublishBtn.click({ force: true }).catch(() => {});
    console.log("   ✅ 헤더 발행 버튼 클릭");
  } else {
    // 좌표로 클릭 (우측 상단)
    await page.mouse.click(1210, 22);
    console.log("   ✅ 좌표로 발행 버튼 클릭");
  }
  
  await page.waitForTimeout(2000);
  
  // 3. 발행 설정 화면에서 최종 발행 버튼 클릭
  console.log("   2차 최종 발행 버튼...");
  await page.waitForTimeout(1500);
  
  // 발행 확인 버튼 셀렉터들 (우측 하단 초록색 "발행" 버튼)
  const finalPublishSelectors = [
    'button.confirm_btn__WEaBq',              // 최신 네이버 발행 확인 버튼
    'button[class*="confirm_btn"]',
    'button.btn_publish__FvD4K',
    'button[class*="btn_publish"]',
    '.publish_layer button[class*="confirm"]',
    '.btn_area button:has-text("발행")',
  ];
  
  for (const selector of finalPublishSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn && await btn.isVisible()) {
        console.log(`   ✅ 최종 발행 버튼 발견: ${selector}`);
        await btn.click({ force: true });
        console.log("   🎉 최종 발행 클릭!");
        await page.waitForTimeout(5000);
        return true;
      }
    } catch {}
  }
  
  // 4. "발행" 텍스트가 있는 버튼 찾기
  console.log("   텍스트로 발행 버튼 찾기...");
  const publishButtons = await page.$$('button');
  for (const btn of publishButtons) {
    const text = await btn.textContent();
    if (text && text.includes('발행') && !text.includes('예약')) {
      const isVisible = await btn.isVisible();
      if (isVisible) {
        console.log(`   ✅ "발행" 버튼 발견`);
        await btn.click({ force: true });
        console.log("   🎉 최종 발행 클릭!");
        await page.waitForTimeout(5000);
        return true;
      }
    }
  }
  
  // 5. 좌표로 최종 발행 버튼 클릭 (이미지 참고: 우측 하단 "✓ 발행")
  console.log("   좌표로 최종 발행 버튼 클릭...");
  // 발행 설정 화면 기준 우측 하단 발행 버튼 (약 480, 460 위치)
  await page.mouse.click(480, 455);
  await page.waitForTimeout(2000);
  
  // 한번 더 시도 (조금 다른 위치)
  await page.mouse.click(470, 450);
  await page.waitForTimeout(3000);
  
  return true;
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const linkId = process.argv[2];
  
  if (!linkId) {
    console.error("사용법: npx ts-node scripts/simple-agent.ts <linkId>");
    process.exit(1);
  }
  
  console.log("=".repeat(50));
  console.log("🤖 심플 에이전트 시작");
  console.log("=".repeat(50));
  
  // 세션 확인
  if (!fs.existsSync(SESSION_FILE)) {
    console.error("❌ 네이버 로그인 세션이 없습니다. npm run login 실행하세요.");
    process.exit(1);
  }
  
  // DB에서 링크 조회
  const link = await prisma.brandLink.findUnique({ where: { id: linkId } });
  if (!link) {
    console.error("❌ 링크를 찾을 수 없습니다.");
    process.exit(1);
  }
  
  console.log(`\n📎 URL: ${link.url}`);
  
  // 브라우저 시작 (봇 감지 우회 설정)
  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,  // 더 자연스러운 속도
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
  
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  
  const page = await context.newPage();
  
  // 봇 감지 우회 스크립트 (문자열로 전달)
  await page.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
  `);
  
  try {
    // STEP 1: 상품 정보 + 이미지 수집
    const product = await step1_getProductInfo(page, link.url);
    
    console.log("\n" + "-".repeat(40));
    console.log(`📦 상품: ${product.name}`);
    console.log(`💰 가격: ${product.price}`);
    console.log(`🖼️ 이미지: ${product.imagePaths.length}개`);
    console.log("-".repeat(40));
    
    // STEP 2: SEO 최적화 글 생성
    const post = await step2_generatePost(product, link.url);
    
    // STEP 3: 에디터 열기
    await step3_openEditor(page);
    
    // STEP 4: 제목 입력
    await step4_inputTitle(page, post.title);
    
    // STEP 5+6: 이미지와 본문 번갈아 입력
    await step5and6_uploadAndWrite(page, product.imagePaths, post.sections, post.hashtags);
    
    // STEP 7: 발행
    const published = await step7_publish(page);
    
    // 결과 확인
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    
    if (currentUrl.includes('PostView') || currentUrl.includes('logNo') || published) {
      console.log("\n" + "=".repeat(50));
      console.log("🎉 발행 완료!");
      console.log(`📄 URL: ${currentUrl}`);
      console.log(`📦 상품: ${product.name}`);
      console.log(`🖼️ 이미지: ${product.imagePaths.length}개`);
      console.log(`📝 섹션: ${post.sections.length}개`);
      console.log("=".repeat(50));
      
      await prisma.brandLink.update({
        where: { id: linkId },
        data: {
          status: "PUBLISHED",
          productName: product.name,
          errorMessage: null,
          publishedAt: new Date(),
          postUrl: currentUrl,
        }
      });
    } else {
      console.log("\n⚠️ 발행 결과를 확인하세요. 브라우저에서 수동으로 발행해주세요.");
    }
    
    // 임시 파일 정리
    for (const imgPath of product.imagePaths) {
      try { fs.unlinkSync(imgPath); } catch {}
    }
    
    // 자동 종료 (백그라운드 실행에서도 프로세스가 남지 않도록)
    await browser.close();
    
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error("\n❌ 오류:", message);
    
    await prisma.brandLink.update({
      where: { id: linkId },
      data: { status: "FAILED", errorMessage: message }
    });
  } finally {
    try {
      if (browser.isConnected()) {
        await browser.close();
      }
    } catch {
      // no-op
    }
    await prisma.$disconnect();
  }
}

main();

/**
 * 심플 에이전트 - 단순하게 동작하는 버전
 * 한 단계씩 확인하며 진행
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Page } from "playwright";
import type { Browser } from "playwright";
import type { BrowserContext } from "playwright";
import type { BrowserContextOptions } from "playwright";
import type { Locator } from "playwright";
import type { Response } from "playwright";
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
const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const BROWSER_GPT_MODE = (process.env.BROWSER_GPT_MODE || "false").toLowerCase() === "true";
const DEFAULT_CHATGPT_DRAFT_GPT_URL =
  "https://chatgpt.com/g/g-69044e83643481918a83e45a0bfec330-jepum-ribyu-jagseong-v11-dapeojuneunnamja";
const DEFAULT_CHATGPT_POLISH_GPT_URL =
  "https://chatgpt.com/g/g-683347512adc8191bd26d40336990cb1-seo-coejeoghwa-jadong-geul-byeonhwan-v5-0-dapeojuneunnamja";
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
const CHATGPT_TIMEOUT_MS = Number(process.env.CHATGPT_TIMEOUT_MS || "420000");
const CHATGPT_RESPONSE_IDLE_TIMEOUT_MS = Number(
  process.env.CHATGPT_RESPONSE_IDLE_TIMEOUT_MS || String(Math.max(CHATGPT_TIMEOUT_MS, 300000))
);
const CHATGPT_RESPONSE_MAX_TIMEOUT_MS = Number(
  process.env.CHATGPT_RESPONSE_MAX_TIMEOUT_MS ||
    String(Math.max(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS * 4, 1800000))
);
const CHATGPT_HEADLESS = (process.env.CHATGPT_HEADLESS || "false").toLowerCase() === "true";
const CHATGPT_USE_PERSISTENT_PROFILE =
  (process.env.CHATGPT_USE_PERSISTENT_PROFILE || "true").toLowerCase() === "true";
const CHATGPT_RUN_ISOLATED_CONTEXT =
  (process.env.CHATGPT_RUN_ISOLATED_CONTEXT || "false").toLowerCase() === "true";
const CHATGPT_FALLBACK_TO_BASE =
  (process.env.CHATGPT_FALLBACK_TO_BASE || "false").toLowerCase() === "true";
const CHATGPT_FORCE_NEW_CHAT =
  (process.env.CHATGPT_FORCE_NEW_CHAT || "true").toLowerCase() === "true";
const CHATGPT_USE_TEMPORARY_CHAT =
  (process.env.CHATGPT_USE_TEMPORARY_CHAT || "false").toLowerCase() === "true";
const CHATGPT_GUIDED_MODE =
  (process.env.CHATGPT_GUIDED_MODE || "true").toLowerCase() === "true";
const CHATGPT_GUIDED_MAX_TURNS = Number(process.env.CHATGPT_GUIDED_MAX_TURNS || "6");
const CHATGPT_IMAGE_CONTEXT_MAX = Number(process.env.CHATGPT_IMAGE_CONTEXT_MAX || "4");
const CHATGPT_ATTACH_IMAGES_TO_DRAFT =
  (process.env.CHATGPT_ATTACH_IMAGES_TO_DRAFT || "true").toLowerCase() === "true";
const CHATGPT_ATTACH_IMAGES_TO_POLISH =
  (process.env.CHATGPT_ATTACH_IMAGES_TO_POLISH || "true").toLowerCase() === "true";
const CHATGPT_FORCE_MOBILE_VERSION =
  (process.env.CHATGPT_FORCE_MOBILE_VERSION || "true").toLowerCase() === "true";
const CHATGPT_DEFAULT_SUBTITLE_COUNT = Math.max(
  4,
  Math.min(8, Number(process.env.CHATGPT_DEFAULT_SUBTITLE_COUNT || "5"))
);
const CHATGPT_USER_DATA_DIR =
  process.env.CHATGPT_USER_DATA_DIR ||
  path.join(process.cwd(), "playwright", "storage", "chatgpt-profile");
const DRY_RUN_GENERATE_ONLY =
  (process.env.DRY_RUN_GENERATE_ONLY || "false").toLowerCase() === "true";
const DEBUG_SAVE_GENERATED_POST =
  (process.env.DEBUG_SAVE_GENERATED_POST || "false").toLowerCase() === "true";
const GENERATED_OUTPUT_DIR = path.join(process.cwd(), "logs", "generated");
const THUMBNAIL_AUTOGEN_ENABLED =
  (process.env.THUMBNAIL_AUTOGEN_ENABLED || "true").toLowerCase() === "true";
const THUMBNAIL_SCRIPT_PATH = path.join(process.cwd(), "scripts", "generate-thumbnail.py");
const AGENT_MAX_RUNTIME_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.AGENT_MAX_RUNTIME_MS || "1500000")
);

if (!fs.existsSync(TEMP_PATH)) fs.mkdirSync(TEMP_PATH, { recursive: true });
if (!fs.existsSync(CHATGPT_USER_DATA_DIR)) fs.mkdirSync(CHATGPT_USER_DATA_DIR, { recursive: true });
if (!fs.existsSync(GENERATED_OUTPUT_DIR)) fs.mkdirSync(GENERATED_OUTPUT_DIR, { recursive: true });

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

interface ThumbnailScriptResult {
  ok?: boolean;
  output?: string;
  used_cutout?: boolean;
  cutout_source?: string | null;
  error?: string;
}

interface ThumbnailCopy {
  headline: string;
  subline: string;
}

interface GeneratedPostPreview {
  title: string;
  sections: string[];
  hashtags: string[];
  rawResponse?: string;
}

interface ChatGPTGuidanceContext {
  productName: string;
  description: string;
  features: string[];
  price: string;
  originalPrice: string;
  discountRate: string;
  couponInfo: string;
  deliveryInfo: string;
  reviewCount: string;
  rating: string;
  brandLink: string;
  targetSectionCount: number;
}

const DEFAULT_SECTION_TITLES = [
  "구매하게 된 계기",
  "택배 도착 & 개봉기",
  "첫인상 / 디자인",
  "크기 & 스펙 정보",
  "주요 기능 ①",
  "주요 기능 ②",
  "실제 사용 후기",
  "장점 정리",
  "아쉬운 점",
  "이런 분께 추천해요",
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

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const SECTION_TITLE_MATCHER = /^(?:구매하게 된 계기|택배 도착\s*&\s*개봉기|첫인상\s*\/\s*디자인|크기\s*&\s*스펙 정보|주요 기능\s*[①1]|주요 기능\s*[②2]|실제 사용 후기|장점 정리|아쉬운 점|이런 분께 추천해요)\s*$/i;

function stripSectionPrefix(text: string): string {
  return stripEmoji(text)
    .replace(/^[\s\-*#>]+/, "")
    .replace(/^[\d]+\.\s*/, "")
    .trim();
}

function isSectionTitleLine(text: string): boolean {
  const normalized = stripSectionPrefix(text);
  return SECTION_TITLE_MATCHER.test(normalized);
}

function sanitizeTitle(rawTitle: string, fallback: string): string {
  const cleaned = stripEmoji(rawTitle).replace(/\s+/g, " ").trim();
  if (cleaned.length > 0) return cleaned.slice(0, 80);
  return stripEmoji(fallback).replace(/\s+/g, " ").trim().slice(0, 80);
}

function sanitizeFileNamePart(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized || "thumbnail";
}

type HookTheme = {
  keywords: RegExp[];
  headlines: string[];
  sublines: string[];
};

const THUMBNAIL_HOOK_THEMES: HookTheme[] = [
  {
    keywords: [/청소기|진공|무선 청소|스팀|세척/],
    headlines: ["놓치면 손해 보는 청소 성능 포인트", "바로 알 수 있는 체감 차이 한눈에"],
    sublines: ["클릭 전 2줄로 확인하는 핵심 정리", "지금 결정을 도와주는 체크포인트"],
  },
  {
    keywords: [/면도기|면도|구강|칫솔|치아|청소/],
    headlines: ["실사용 후 바로 알게 된 진짜 차이", "살기 전에 꼭 확인할 결정 포인트"],
    sublines: ["클릭 한 번에 핵심만 보여주는 사용 후기", "비교했을 때 드러나는 숨은 결함까지"],
  },
  {
    keywords: [/가습기|공기|온열|히터|에어프라이|전자|TV|노트북|헤어|드라이/],
    headlines: ["지금 눌러야 아는 필수 사용 포인트", "직접 확인한 바로 그 차이"],
    sublines: ["클릭 전에 꼭 보고 갈아탈지 판단", "가격·기능·편의성 핵심만 빠르게 정리"],
  },
  {
    keywords: [/음식|식품|영양|오메가|단백/],
    headlines: ["구매 전 이거만 알면 실패 없음", "한 번 확인하면 고르는 기준이 보인다"],
    sublines: ["클릭 직전 꼭 체크할 효능/가격 포인트", "실사용 기준으로 바로 판단 가능한 후기"],
  },
  {
    keywords: [/커피|커피머신|에그|에어|전기포트|조리|식기/],
    headlines: ["지금 보지 않으면 놓치는 효율 포인트", "사용감으로 가르는 선택 기준"],
    sublines: ["클릭 후 바로 판단되는 사용성 핵심", "디자인보다 중요한 실제 사용 감각"],
  },
];

const DEFAULT_HOOKS: ThumbnailCopy = {
  headline: "놓치기 전 꼭 눌러야 할 이유",
  subline: "실사용 기준으로 판단하는 핵심 후기 포인트",
};

function normalizeForHook(value: string): string {
  return sanitizeText(value)
    .replace(/\|/g, " ")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHookTheme(text: string): HookTheme {
  const target = normalizeForHook(text).toLowerCase();
  return (
    THUMBNAIL_HOOK_THEMES.find((theme) =>
      theme.keywords.some((keyword) => keyword.test(target))
    ) ?? {
      keywords: [],
      headlines: [DEFAULT_HOOKS.headline],
      sublines: [DEFAULT_HOOKS.subline],
    }
  );
}

function pickBySeed(values: string[], seed: string): string {
  if (values.length === 0) return "";
  const index = Math.abs(seed.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % values.length;
  return values[index];
}

function trimToSafeLength(text: string, maxLength: number): string {
  const normalized = sanitizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function buildThumbnailCopy(postTitle: string, productName: string): ThumbnailCopy {
  const title = normalizeForHook(postTitle);
  const product = normalizeForHook(productName);
  const core = product || title || "후기";
  const theme = extractHookTheme(`${title} ${product}`);

  const seed = `${title}${product}`;
  const headlinePrefix = pickBySeed(theme.headlines, seed);
  const sublineSeed = pickBySeed(theme.sublines, `${seed}sub`);

  const headline = trimToSafeLength(`${headlinePrefix} - ${core}`, 46);
  const subline = trimToSafeLength(sublineSeed, 54);

  return {
    headline,
    subline,
  };
}

function parseThumbnailScriptResult(stdout: string): ThumbnailScriptResult | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line) as ThumbnailScriptResult;
    } catch {
      continue;
    }
  }

  return null;
}

function generateTopTextCutoutThumbnail(
  imagePaths: string[],
  postTitle: string,
  productName: string
): string | null {
  if (!THUMBNAIL_AUTOGEN_ENABLED) return null;
  if (imagePaths.length === 0) return null;

  if (!fs.existsSync(THUMBNAIL_SCRIPT_PATH)) {
    console.log(`   ⚠️ 썸네일 스크립트가 없어 건너뜁니다: ${THUMBNAIL_SCRIPT_PATH}`);
    return null;
  }

  const timestamp = Date.now();
  const outputPath = path.join(
    TEMP_PATH,
    `thumb_${timestamp}_${sanitizeFileNamePart(productName)}.jpg`
  );

  const { headline, subline } = buildThumbnailCopy(postTitle, productName);
  const args = [
    THUMBNAIL_SCRIPT_PATH,
    "--background",
    imagePaths[0],
    "--headline",
    headline,
    "--subline",
    subline,
    "--output",
    outputPath,
  ];

  for (const imagePath of imagePaths.slice(0, 8)) {
    args.push("--image", imagePath);
  }

  const result = spawnSync("python3", args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    console.log(`   ⚠️ 썸네일 생성 실패: ${result.error.message}`);
    return null;
  }

  if (result.status !== 0) {
    const errorMessage = (result.stderr || result.stdout || "").trim();
    console.log(`   ⚠️ 썸네일 생성 실패(code=${result.status}): ${errorMessage}`);
    return null;
  }

  const parsed = parseThumbnailScriptResult(result.stdout);
  if (parsed && parsed.ok === false) {
    console.log(`   ⚠️ 썸네일 생성 실패: ${parsed.error || "알 수 없는 오류"}`);
    return null;
  }

  const resolvedOutputPath = parsed?.output && fs.existsSync(parsed.output) ? parsed.output : outputPath;
  if (!fs.existsSync(resolvedOutputPath)) {
    console.log("   ⚠️ 썸네일 생성 결과 파일을 찾지 못했습니다.");
    return null;
  }

  const usedCutout = parsed?.used_cutout === true;
  if (usedCutout) {
    const cutoutSourceLabel = parsed?.cutout_source ? ` / 소스: ${path.basename(parsed.cutout_source)}` : "";
    console.log(`   🖼️ 대표 썸네일 생성 완료 (텍스트형 + 누끼컷${cutoutSourceLabel})`);
  } else {
    console.log("   🖼️ 대표 썸네일 생성 완료 (텍스트형 / 이미지 삽입 미사용)");
  }

  return resolvedOutputPath;
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

const CHATGPT_PLUS_BUTTON_SELECTORS = [
  '#composer-plus-btn',
  'button[data-testid="composer-plus-btn"]',
  'button[aria-label*="파일 추가"]',
  'button[aria-label*="Attach"]',
];

const CHATGPT_IMAGE_INPUT_SELECTORS = [
  'input#upload-photos[type="file"]',
  'input[type="file"][accept*="image"]',
];

const CHATGPT_AUTHENTICATED_UI_SELECTORS = [
  '[data-testid="profile-button"]',
  '[data-testid="user-menu-button"]',
  'button[aria-label*="User menu"]',
  'button[aria-label*="계정"]',
  'button:has-text("New chat")',
  'button:has-text("새 대화")',
];

const CHATGPT_STARTER_BUTTON_SELECTORS = [
  'button[data-testid*="conversation-starter"]',
  'button:has-text("안녕하세요")',
  'button:has-text("Hello")',
  'button:has-text("시작")',
];

function isCustomGptUrl(url: string): boolean {
  return /https?:\/\/chatgpt\.com\/g\//i.test(url);
}

function isCustomGptPageUrl(url: string): boolean {
  return /https?:\/\/chatgpt\.com\/g\//i.test(url);
}

async function findVisibleSelector(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
    if (isVisible) return selector;
  }
  return null;
}

async function findExistingSelector(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const exists = (await page.locator(selector).count().catch(() => 0)) > 0;
    if (exists) return selector;
  }
  return null;
}

function selectChatGPTImageContextPaths(imagePaths: string[]): string[] {
  const maxCount = Math.max(0, Math.min(CHATGPT_IMAGE_CONTEXT_MAX, 10));
  if (maxCount === 0) return [];

  const validExt = /\.(png|jpe?g|webp|gif)$/i;
  const picked: string[] = [];

  for (const imagePath of imagePaths) {
    if (picked.length >= maxCount) break;
    if (!imagePath || !validExt.test(imagePath)) continue;
    if (!fs.existsSync(imagePath)) continue;
    picked.push(imagePath);
  }

  return Array.from(new Set(picked)).slice(0, maxCount);
}

async function countChatGPTAttachedImages(page: Page): Promise<number> {
  const removeButtons = page.getByLabel(/파일 제거|remove file/i);
  return removeButtons.count().catch(() => 0);
}

async function waitForChatGPTSendReady(page: Page, timeoutMs = 120000): Promise<void> {
  const sendSelector =
    (await findVisibleSelector(page, CHATGPT_SEND_BUTTON_SELECTORS)) ||
    (await findExistingSelector(page, CHATGPT_SEND_BUTTON_SELECTORS));

  if (!sendSelector) return;

  const sendButton = page.locator(sendSelector).first();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const disabled = await sendButton.isDisabled().catch(() => false);
    if (!disabled) return;
    await page.waitForTimeout(300);
  }
}

async function attachImagesToChatGPT(
  page: Page,
  imagePaths: string[],
  label: string
): Promise<number> {
  const selectedPaths = selectChatGPTImageContextPaths(imagePaths);
  if (selectedPaths.length === 0) return 0;

  try {
    await dismissTemporaryChatOnboarding(page);

    const beforeCount = await countChatGPTAttachedImages(page);

    let inputSelector =
      (await findExistingSelector(page, CHATGPT_IMAGE_INPUT_SELECTORS)) ||
      (await findVisibleSelector(page, CHATGPT_IMAGE_INPUT_SELECTORS));

    if (!inputSelector) {
      await clickFirstVisible(page, CHATGPT_PLUS_BUTTON_SELECTORS);
      await page.waitForTimeout(200);
      inputSelector = await findExistingSelector(page, CHATGPT_IMAGE_INPUT_SELECTORS);
    }

    if (!inputSelector) {
      console.log(`      - ${label} 이미지 첨부 입력창을 찾지 못했습니다.`);
      return 0;
    }

    await page.locator(inputSelector).first().setInputFiles(selectedPaths);

    const expectedCount = beforeCount + selectedPaths.length;
    const startedAt = Date.now();

    while (Date.now() - startedAt < 180000) {
      const currentCount = await countChatGPTAttachedImages(page);
      if (currentCount >= expectedCount) break;
      await page.waitForTimeout(300);
    }

    await waitForChatGPTSendReady(page);
    const finalCount = await countChatGPTAttachedImages(page);
    const attached = Math.max(0, finalCount - beforeCount);

    if (attached > 0) {
      console.log(`      - ${label} 이미지 컨텍스트 첨부: ${attached}개`);
    } else {
      console.log(`      - ${label} 이미지 첨부가 확인되지 않았습니다.`);
    }

    return attached;
  } catch (error) {
    console.log(`      - ${label} 이미지 첨부 실패: ${getErrorMessage(error)}`);
    return 0;
  }
}

async function hasChatGPTComposer(page: Page): Promise<boolean> {
  const selector = await findVisibleSelector(page, CHATGPT_COMPOSER_SELECTORS);
  return selector !== null;
}

async function hasAuthenticatedChatGPTUI(page: Page): Promise<boolean> {
  if (await hasChatGPTComposer(page)) {
    return true;
  }

  const selector = await findVisibleSelector(page, CHATGPT_AUTHENTICATED_UI_SELECTORS);
  return selector !== null;
}

async function hasVisibleChatGPTLoginCta(page: Page): Promise<boolean> {
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

function withTemporaryChatParam(url: string): string {
  if (!isCustomGptUrl(url) || !CHATGPT_USE_TEMPORARY_CHAT) return url;

  try {
    const parsed = new URL(url);
    parsed.searchParams.set("temporary-chat", "true");
    return parsed.toString();
  } catch {
    return url;
  }
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

async function startNewChatIfAvailable(page: Page): Promise<void> {
  const candidates = [
    page.getByRole("button", { name: /new chat/i }).first(),
    page.getByRole("button", { name: /새 대화/i }).first(),
    page.locator('[data-testid="new-chat-button"]').first(),
    page.locator('button:has-text("New chat")').first(),
    page.locator('button:has-text("새 대화")').first(),
  ];

  for (const candidate of candidates) {
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    await candidate.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return;
  }
}

async function dismissTemporaryChatOnboarding(page: Page): Promise<void> {
  const modal = page
    .locator('#modal-temporary-chat-onboarding, [data-testid="modal-temporary-chat-onboarding"]')
    .first();

  const visible = await modal.isVisible().catch(() => false);
  if (!visible) return;

  const closeCandidates = [
    modal.getByRole("button", { name: /continue|start|got it|okay|확인|시작|계속|닫기/i }).first(),
    modal.locator('button[aria-label*="Close"]').first(),
    modal.locator('button[aria-label*="닫기"]').first(),
    modal.locator("button").first(),
  ];

  for (const candidate of closeCandidates) {
    const candidateVisible = await candidate.isVisible().catch(() => false);
    if (!candidateVisible) continue;
    await candidate.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
    break;
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
}

function normalizePromptForStepMatch(text: string): string {
  return normalizeText(text).toLowerCase();
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function isDraftStepProductInfoPrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  return (
    (includesAny(normalized, ["1단계", "제품 정보 수집"]) &&
      includesAny(normalized, ["제품명", "구매페이지"])) ||
    (normalized.includes("제품명") && normalized.includes("구매페이지"))
  );
}

function isDraftStepSeoKeywordPrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  return (
    includesAny(normalized, ["2단계", "seo 제목", "seo제목"]) &&
      normalized.includes("키워드")
  ) || (normalized.includes("seo") && normalized.includes("키워드"));
}

function isDraftStepSeoTitleSelectionPrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  const hasTitleKeyword = includesAny(normalized, ["seo 제목", "제목", "타이틀"]);
  const hasSelectionKeyword = includesAny(normalized, [
    "선택",
    "골라",
    "번호",
    "1번",
    "2번",
    "3번",
    "4번",
    "4가지",
  ]);
  return hasTitleKeyword && hasSelectionKeyword;
}

function isDraftStepVersionPrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  return (
    includesAny(normalized, ["3단계", "출력 형식", "어떤 버전"]) ||
    (normalized.includes("pc 버전") && normalized.includes("모바일 버전"))
  );
}

function isDraftStepSubtitleCountPrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  return (
    includesAny(normalized, ["4단계", "소제목 개수"]) ||
    (normalized.includes("소제목") &&
      includesAny(normalized, ["몇 개", "몇개", "개수", "숫자로 입력"]))
  );
}

function isDraftStepContentPrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  return (
    includesAny(normalized, ["5단계", "콘텐츠 구성", "아래 형식으로 입력"]) ||
    includesAny(normalized, ["챕터", "다루고 싶은 내용"])
  );
}

function isDraftStepTonePrompt(text: string): boolean {
  const normalized = normalizePromptForStepMatch(text);
  return (
    includesAny(normalized, ["6단계", "말투 설정", "어떤 말투"]) ||
    includesAny(normalized, [
      "전문가 리뷰 말투",
      "직접 입력",
      "경험 공유 말투",
      "친근한 말투",
      "따뜻하고 친절한 말투",
      "원하시는 번호",
    ])
  );
}

function buildDirectSeoTitle(context: ChatGPTGuidanceContext): string {
  const compactName = stripEmoji(context.productName).replace(/\s+/g, " ").trim();
  const tokens = compactName.split(" ").filter((token) => token.length > 0);
  const productCore = tokens.slice(0, Math.min(4, tokens.length)).join(" ");
  const base = productCore || "제품";
  const candidates = [
    `${base} 실사용 후기와 장단점`,
    `${base} 제품리뷰 실제 사용기`,
    `${base} 솔직 후기와 구매팁`,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length >= 16 && trimmed.length <= 35) {
      return trimmed;
    }
  }

  return `${base} 실사용 후기`.slice(0, 35).trim();
}

function inferCategoryKeyword(productName: string): string {
  const name = normalizePromptForStepMatch(productName);
  if (name.includes("음식물") && name.includes("처리기")) return "음식물처리기";
  if (name.includes("청소기")) return "무선청소기";
  if (name.includes("공기청정")) return "공기청정기";
  if (name.includes("노트북")) return "사무용노트북";
  if (name.includes("에센스")) return "스킨케어";
  if (name.includes("갈치")) return "수산물선물세트";
  return "제품리뷰";
}

function buildSeoKeywordInput(context: ChatGPTGuidanceContext): string {
  const productTokens = context.productName
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 2);

  const featureToken = context.features
    .map((item) =>
      item
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .find((token) => token.length >= 2)
    )
    .find((token): token is string => Boolean(token));

  const keywords = [
    ...productTokens,
    inferCategoryKeyword(context.productName),
    featureToken || "실사용후기",
    "가성비추천",
  ]
    .map((keyword) => keyword.replace(/\s+/g, "").trim())
    .filter((keyword) => keyword.length > 0);

  return Array.from(new Set(keywords)).slice(0, 4).join(", ");
}

function buildDraftChapterTopics(
  context: ChatGPTGuidanceContext,
  sectionCount: number
): string[] {
  const baseTopics = [
    `${context.productName}를 고른 이유와 구매 배경`,
    "개봉 직후 첫인상, 디자인, 크기 체크",
    "핵심 기능 사용 과정과 실제 체감 포인트",
    "일상 사용 기준 장점과 아쉬운 점 정리",
    "추천 대상과 구매 팁, 재구매 의사",
    "가격 대비 만족도와 할인/쿠폰 체감",
    "사용 중 유지관리와 관리 팁",
    "비슷한 제품과 비교했을 때 차이점",
  ];

  return baseTopics.slice(0, Math.max(4, Math.min(8, sectionCount)));
}

function buildDraftContentPayload(
  context: ChatGPTGuidanceContext,
  sectionCount: number
): string {
  const topics = buildDraftChapterTopics(context, sectionCount);

  const topicLines = topics.map((topic, index) => `${index + 1}. ${topic}`).join("\n");

  return [
    "아래 형식대로 입력합니다.",
    "",
    "1️⃣ 이 챕터에서 다루고 싶은 내용",
    topicLines,
    "",
    "2️⃣ 관련 이미지",
    "첨부된 상품 이미지를 참고해주세요.",
    "",
    "[추가 제품 정보]",
    `- 상품명: ${context.productName}`,
    `- 구매페이지: ${context.brandLink}`,
    `- 상품 설명: ${context.description || "(설명 없음)"}`,
    `- 핵심 특징: ${context.features.length > 0 ? context.features.join(", ") : "(특징 없음)"}`,
    `- 가격: ${context.price || "(가격 미확인)"}`,
    `- 원가: ${context.originalPrice || "(원가 미확인)"}`,
    `- 할인율: ${context.discountRate || "(할인율 미확인)"}`,
    `- 쿠폰/혜택: ${context.couponInfo || "(없음)"}`,
    `- 배송: ${context.deliveryInfo || "(정보 없음)"}`,
    `- 리뷰수: ${context.reviewCount || "(미확인)"}`,
    `- 평점: ${context.rating || "(미확인)"}`,
    "",
    `선택된 소제목 개수(${sectionCount}개)와 모바일 버전 규칙을 유지해주세요.`,
  ].join("\n");
}

async function clickGreetingStarterIfVisible(page: Page): Promise<boolean> {
  const roleCandidates = [
    page.getByRole("button", { name: /안녕하세요/i }).first(),
    page.getByRole("button", { name: /hello/i }).first(),
  ];

  for (const candidate of roleCandidates) {
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    await candidate.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    return true;
  }

  for (const selector of CHATGPT_STARTER_BUTTON_SELECTORS) {
    const starter = page.locator(selector).first();
    const visible = await starter.isVisible().catch(() => false);
    if (!visible) continue;
    await starter.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    return true;
  }

  return false;
}

async function detectChatGPTProtectionIssue(page: Page): Promise<string | null> {
  const url = page.url();
  if (url.includes("/cdn-cgi/challenge-platform/")) {
    return "Cloudflare 보안 검증 페이지가 표시되었습니다.";
  }

  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  const normalized = bodyText.replace(/\s+/g, " ").toLowerCase();

  const blockedPatterns = [
    "checking your browser",
    "verify you are human",
    "access denied",
    "please stand by",
    "cf-challenge",
    "unusual activity",
    "보안",
    "인증",
    "차단",
  ];

  if (blockedPatterns.some((pattern) => normalized.includes(pattern))) {
    return "ChatGPT 보안 검증 또는 접근 제한 페이지가 감지되었습니다.";
  }

  return null;
}

async function isChatGPTLoginRequired(page: Page): Promise<boolean> {
  if (await hasAuthenticatedChatGPTUI(page)) {
    return false;
  }

  const currentUrl = page.url();
  if (/\/auth\/login/i.test(currentUrl)) {
    return true;
  }

  return hasVisibleChatGPTLoginCta(page);
}

async function ensureChatGPTReady(page: Page, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let loginSeenRounds = 0;
  const loginRoundsThreshold = 8;

  while (Date.now() - start < timeoutMs) {
    if (await hasAuthenticatedChatGPTUI(page)) {
      return;
    }

    const protectionIssue = await detectChatGPTProtectionIssue(page);
    if (protectionIssue) {
      throw new Error(
        `${protectionIssue} 브라우저에서 인증을 완료한 뒤 다시 시도하세요. (현재 URL: ${page.url()})`
      );
    }

    if (await hasVisibleChatGPTLoginCta(page)) {
      loginSeenRounds += 1;
      if (loginSeenRounds >= loginRoundsThreshold) {
        throw new Error("ChatGPT 로그인 세션이 만료되었습니다. `npm run login:chatgpt` 실행 후 다시 시도하세요.");
      }
    } else {
      loginSeenRounds = 0;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("ChatGPT 페이지 준비 시간이 초과되었습니다. 로그인 상태 또는 GPT URL을 확인하세요.");
}

async function navigateWithRetry(
  page: Page,
  url: string,
  label: string,
  maxAttempts = 3
): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      return;
    } catch (error) {
      lastError = error;
      console.log(
        `      - ${label} 이동 재시도 ${attempt}/${maxAttempts} 실패: ${getErrorMessage(error)}`
      );

      if (attempt < maxAttempts) {
        await page.waitForTimeout(1500 * attempt);
      }
    }
  }

  throw new Error(`${label} 이동 실패: ${getErrorMessage(lastError)}`);
}

async function openChatGPTTarget(page: Page, requestedUrl: string, label: string): Promise<void> {
  const targetUrl = withTemporaryChatParam(requestedUrl);

  await navigateWithRetry(page, targetUrl, `${label} GPT`);
  await ensureChatGPTReady(page, Math.min(CHATGPT_TIMEOUT_MS, 120000));
  await dismissTemporaryChatOnboarding(page);

  if (!isCustomGptUrl(requestedUrl)) {
    console.log(`      - ${label} URL: ${page.url()}`);
    return;
  }

  await page.waitForTimeout(1200);
  let currentUrl = page.url();
  let inaccessible = await hasInaccessibleGptBanner(page);

  if (CHATGPT_FORCE_NEW_CHAT) {
    await startNewChatIfAvailable(page);
    await navigateWithRetry(page, targetUrl, `${label} GPT(새 대화)`);
    await ensureChatGPTReady(page, Math.min(CHATGPT_TIMEOUT_MS, 120000));
    await dismissTemporaryChatOnboarding(page);
    await page.waitForTimeout(1200);
    currentUrl = page.url();
    inaccessible = await hasInaccessibleGptBanner(page);
  }

  if (!isCustomGptPageUrl(currentUrl) || inaccessible) {
    throw new Error(
      `${label} GPT가 활성화되지 않았습니다. 요청 URL=${requestedUrl}, 현재 URL=${currentUrl}. ` +
        "현재 로그인 계정의 GPT 권한/공유 상태를 확인하세요."
    );
  }

  console.log(`      - ${label} GPT 활성 URL: ${currentUrl}`);
}

async function waitForChatGPTComposer(page: Page, timeoutMs: number): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await dismissTemporaryChatOnboarding(page);
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
  previousMessages: string[],
  idleTimeoutMs: number,
  maxTimeoutMs: number,
  label = "ChatGPT"
): Promise<string> {
  const previousCount = previousMessages.length;
  const baselineLastText = previousMessages[previousMessages.length - 1] ?? "";
  const start = Date.now();
  let lastActivityAt = start;
  let lastText = "";
  let lastLength = 0;
  let stableRounds = 0;
  let lastProgressLogAt = start;

  while (Date.now() - start < maxTimeoutMs) {
    if (await isChatGPTLoginRequired(page)) {
      throw new Error("ChatGPT 세션이 중간에 해제되었습니다. `npm run login:chatgpt` 후 다시 시도하세요.");
    }

    const generating = await isChatGPTGenerating(page);
    if (generating) {
      lastActivityAt = Date.now();
    }

    const messages = await readAssistantMessages(page);
    const latestText = messages[messages.length - 1] ?? "";
    const hasAdvancedReply =
      messages.length > previousCount ||
      (messages.length > 0 && latestText.length > 0 && latestText !== baselineLastText);

    if (hasAdvancedReply) {
      const candidate = messages[messages.length - 1];

      if (candidate.length !== lastLength || candidate !== lastText) {
        lastActivityAt = Date.now();
      }

      if (candidate === lastText) {
        stableRounds += 1;
      } else {
        lastText = candidate;
        lastLength = candidate.length;
        stableRounds = 0;
      }

      if (!generating && stableRounds >= 2 && candidate.length > 0) {
        return candidate;
      }
    }

    const idleDuration = Date.now() - lastActivityAt;
    if (!generating && idleDuration > idleTimeoutMs) {
      break;
    }

    if (Date.now() - lastProgressLogAt >= 15_000) {
      console.log(
        `      - ${label} 응답 대기 중... (${Math.round((Date.now() - start) / 1000)}초)`
      );
      lastProgressLogAt = Date.now();
    }

    await page.waitForTimeout(1200);
  }

  throw new Error(
    `${label} 응답 대기 시간이 초과되었습니다. ${Math.round(
      idleTimeoutMs / 1000
    )}초 동안 진행 신호가 없어 중단했습니다.`
  );
}

interface ChatGPTSendPromptOptions {
  idleTimeoutMs?: number;
  maxTimeoutMs?: number;
  sendReadyTimeoutMs?: number;
  label?: string;
}

async function waitForChatGPTGenerationIdle(
  page: Page,
  timeoutMs: number,
  label: string
): Promise<void> {
  const startedAt = Date.now();
  let idleRounds = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const generating = await isChatGPTGenerating(page);
    if (!generating) {
      idleRounds += 1;
      if (idleRounds >= 2) {
        return;
      }
    } else {
      idleRounds = 0;
    }

    await page.waitForTimeout(400);
  }

  throw new Error(`${label} 전송 전 대기 시간 초과(이전 응답 생성 종료 미확인)`);
}

async function waitForPromptSubmission(
  page: Page,
  previousMessages: string[],
  timeoutMs: number
): Promise<"generating" | "new-message" | null> {
  const previousCount = previousMessages.length;
  const baselineLastText = previousMessages[previousMessages.length - 1] ?? "";
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isChatGPTGenerating(page)) {
      return "generating";
    }

    const messages = await readAssistantMessages(page);
    const latestText = messages[messages.length - 1] ?? "";
    const hasAdvancedReply =
      messages.length > previousCount ||
      (messages.length > 0 && latestText.length > 0 && latestText !== baselineLastText);
    if (hasAdvancedReply) {
      return "new-message";
    }

    await page.waitForTimeout(300);
  }

  return null;
}

async function sendPromptToChatGPT(
  page: Page,
  prompt: string,
  options: ChatGPTSendPromptOptions = {}
): Promise<string> {
  const idleTimeoutMs = options.idleTimeoutMs ?? CHATGPT_RESPONSE_IDLE_TIMEOUT_MS;
  const maxTimeoutMs = options.maxTimeoutMs ?? CHATGPT_RESPONSE_MAX_TIMEOUT_MS;
  const sendReadyTimeoutMs = options.sendReadyTimeoutMs ?? 90_000;
  const label = options.label ?? "ChatGPT";

  await dismissTemporaryChatOnboarding(page);
  await waitForChatGPTGenerationIdle(page, 60_000, label);
  
  // 프롬프트 입력 전에 약간 대기 (UI 반응형)
  await page.waitForTimeout(1000);
  
  const previousMessages = await readAssistantMessages(page);
  const composerSelector = await waitForChatGPTComposer(page, CHATGPT_TIMEOUT_MS);
  const composer = page.locator(composerSelector).first();

  await composer.click();
  await page.waitForTimeout(500);

  if (composerSelector.startsWith("textarea")) {
    await composer.fill(prompt);
  } else {
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type(prompt, { delay: 5 }); // delay 증가
  }

  // 입력 완료 후 잠시 대기
  await page.waitForTimeout(1000);

  await waitForChatGPTSendReady(page, sendReadyTimeoutMs);
  
  // 전송 버튼 누르기 전 대기
  await page.waitForTimeout(500);
  
  const sendButtonSelector = await findVisibleSelector(page, CHATGPT_SEND_BUTTON_SELECTORS);

  if (sendButtonSelector) {
    await page.locator(sendButtonSelector).first().click().catch(() => {});
  } else {
    await composer.press("Enter").catch(() => {});
  }

  // 전송 직후 기다림 증가
  await page.waitForTimeout(2000);

  let submission = await waitForPromptSubmission(page, previousMessages, 15_000);
  if (submission) {
    console.log(`      - ${label} 전송 확인(${submission})`);
  }

  if (!submission) {
    const isGenerating = await isChatGPTGenerating(page);
    const messages = await readAssistantMessages(page);
    if (!isGenerating && messages.length <= previousMessages.length) {
      console.log(`      - ${label} 전송 확인 재시도`);
      if (sendButtonSelector) {
        await page.locator(sendButtonSelector).first().click().catch(() => {});
      } else {
        await composer.press("Enter").catch(() => {});
      }
      
      await page.waitForTimeout(2000);
      submission = await waitForPromptSubmission(page, previousMessages, 15_000);
      if (submission) {
        console.log(`      - ${label} 전송 확인(${submission})`);
      }
    }
  }

  if (!submission) {
    throw new Error(`${label} 요청 전송을 확인하지 못했습니다.`);
  }

  return waitForChatGPTAssistantReply(
    page,
    previousMessages,
    idleTimeoutMs,
    maxTimeoutMs,
    label
  );
}

interface ChatGPTContextHandle {
  context: import("playwright").BrowserContext;
  close: () => Promise<void>;
}

async function createChatGPTContext(hasSessionFile: boolean): Promise<ChatGPTContextHandle> {
  const commonLaunchOptions = {
    headless: CHATGPT_HEADLESS,
    slowMo: CHATGPT_HEADLESS ? 0 : 30,
    args: ["--disable-blink-features=AutomationControlled"],
  };

  // 기본은 persistent 프로필을 사용하되, 새 대화를 강제해 컨텍스트 오염을 줄인다.
  // 필요 시 격리 컨텍스트를 켤 수 있고, 세션 파일이 없으면 persistent로 폴백.
  const usePersistentContext =
    CHATGPT_USE_PERSISTENT_PROFILE && (!CHATGPT_RUN_ISOLATED_CONTEXT || !hasSessionFile);

  if (usePersistentContext) {
    const context = await chromium.launchPersistentContext(CHATGPT_USER_DATA_DIR, {
      ...commonLaunchOptions,
      viewport: { width: 1440, height: 960 },
      locale: "ko-KR",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    return {
      context,
      close: async () => {
        await context.close().catch(() => {});
      },
    };
  }

  const browser = await chromium.launch(commonLaunchOptions);
  const contextOptions: BrowserContextOptions = {
    viewport: { width: 1440, height: 960 },
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  if (hasSessionFile) {
    contextOptions.storageState = CHATGPT_SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  return {
    context,
    close: async () => {
      if (browser.isConnected()) {
        await browser.close().catch(() => {});
      }
    },
  };
}

function buildGuidanceSummary(context: ChatGPTGuidanceContext): string {
  const details: string[] = [
    `상품명: ${context.productName}`,
    `설명: ${context.description || "(설명 없음)"}`,
    `특징: ${context.features.length > 0 ? context.features.join(", ") : "(특징 없음)"}`,
    `가격: ${context.price || "(가격 미확인)"}`,
    `원가: ${context.originalPrice || "(원가 미확인)"}`,
    `할인율: ${context.discountRate || "(할인율 미확인)"}`,
    `쿠폰: ${context.couponInfo || "(쿠폰 정보 없음)"}`,
    `배송: ${context.deliveryInfo || "(배송 정보 없음)"}`,
    `리뷰수: ${context.reviewCount || "(리뷰수 미확인)"}`,
    `평점: ${context.rating || "(평점 미확인)"}`,
    `구매링크: ${context.brandLink}`,
    `희망 섹션 수: ${context.targetSectionCount}`,
  ];

  return details.join("\n");
}

function buildClarificationReply(assistantReply: string, context: ChatGPTGuidanceContext): string {
  const lines: string[] = ["가이드에 맞춰 진행할게요. 요청하신 정보를 전달합니다."];
  const text = assistantReply.toLowerCase();
  const safeTitle = sanitizeTitle(`${context.productName} 후기`, context.productName);
  const fallbackKeywords = [
    context.productName,
    ...context.features.slice(0, 3),
    "추천",
    "후기",
    "리뷰",
  ].filter((value) => value && value.trim().length > 0);

  if (/제목|title/.test(text)) {
    lines.push(`- 제목 후보: ${safeTitle}`);
  }
  if (/키워드|해시태그|tag/.test(text)) {
    lines.push(`- 핵심 키워드: ${fallbackKeywords.join(", ")}`);
  }
  if (/톤|말투|문체/.test(text)) {
    lines.push("- 톤/말투: 친근한 ~요체, 실사용 중심, 과장 금지");
  }
  if (/분량|섹션|구성|길이|글자/.test(text)) {
    lines.push(`- 구성: 본문 ${context.targetSectionCount}개 섹션`);
  }
  if (/상품|제품명/.test(text)) {
    lines.push(`- 상품명: ${context.productName}`);
  }
  if (/가격|할인|쿠폰|비용/.test(text)) {
    lines.push(`- 가격: ${context.price || "(가격 미확인)"}`);
    lines.push(`- 원가: ${context.originalPrice || "(원가 미확인)"}`);
    lines.push(`- 할인율: ${context.discountRate || "(할인율 미확인)"}`);
    lines.push(`- 쿠폰: ${context.couponInfo || "(쿠폰 정보 없음)"}`);
  }
  if (/리뷰|평점/.test(text)) {
    lines.push(`- 리뷰수: ${context.reviewCount || "(리뷰수 미확인)"}`);
    lines.push(`- 평점: ${context.rating || "(평점 미확인)"}`);
  }
  if (/링크|url/.test(text)) {
    lines.push(`- 구매 링크: ${context.brandLink}`);
  }

  if (lines.length === 1) {
    lines.push(buildGuidanceSummary(context));
  }

  lines.push("위 정보를 기준으로 가이드에 따라 작성해주세요.");
  lines.push("최종 출력은 JSON(title, sections, hashtags) 형식으로 부탁합니다.");
  return lines.join("\n");
}

async function requestStructuredOutputWithGuidance(
  page: Page,
  initialPrompt: string,
  label: string,
  context: ChatGPTGuidanceContext,
  minSections: number
): Promise<string> {
  let reply = await sendPromptToChatGPT(page, initialPrompt, {
    label: `${label} 최종`,
    idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 240_000),
    maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 720_000),
  });

  for (let turn = 0; turn < CHATGPT_GUIDED_MAX_TURNS; turn += 1) {
    const parsed = parseJsonObjectFromText(reply);
    const sectionCount = getStructuredSectionCount(parsed);

    if (sectionCount >= minSections) {
      return reply;
    }

    const needsClarification = looksLikeClarificationRequest(reply);
    console.log(`      - ${label} GPT 추가 상호작용 ${turn + 1}/${CHATGPT_GUIDED_MAX_TURNS}`);

    const followupPrompt = needsClarification
      ? buildClarificationReply(reply, context)
      : [
          "좋아요. 방금 답변 내용을 유지해서 최종 결과를 JSON으로 정리해주세요.",
          "- 출력: JSON만",
          "- 키: title, sections, hashtags",
          `- sections는 최소 ${context.targetSectionCount}개`,
          "- 코드블록 금지",
        ].join("\n");

    reply = await sendPromptToChatGPT(page, followupPrompt, {
      label: `${label} 보완`,
      idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 180_000),
      maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 420_000),
    });
  }

  throw new Error(
    `${label} GPT가 가이드 상호작용 후에도 구조화된 결과를 반환하지 않았습니다.`
  );
}

function hasStructuredDraftOutput(reply: string, minSections: number): boolean {
  const parsed = parseJsonObjectFromText(reply);
  return getStructuredSectionCount(parsed) >= minSections;
}

interface DraftFlowStep {
  key: string;
  label: string;
  matcher: (text: string) => boolean;
  response: (latestReply: string) => string;
  attachImages?: boolean;
}

async function waitForDraftStepPrompt(
  page: Page,
  currentReply: string,
  step: DraftFlowStep,
  minSections: number
): Promise<string> {
  let reply = currentReply;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (hasStructuredDraftOutput(reply, minSections)) {
      return reply;
    }

    if (step.matcher(reply)) {
      return reply;
    }

    console.log(`      - Draft ${step.label} 질문 대기 ${attempt + 1}/3`);
    reply = await sendPromptToChatGPT(
      page,
      `${step.label} 단계 질문을 이어서 진행해주세요. 질문 확인 후 답변하겠습니다.`,
      {
        label: `Draft ${step.label} 질문`,
        idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 90_000),
        maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 240_000),
      }
    );
  }

  return reply;
}

async function runDraftGptConversation(
  page: Page,
  systemPrompt: string,
  userPrompt: string,
  guidanceContext: ChatGPTGuidanceContext,
  imagePaths: string[],
  minSections: number
): Promise<string> {
  const sectionCount = Math.max(4, Math.min(8, guidanceContext.targetSectionCount));
  const seoKeywordInput = buildSeoKeywordInput(guidanceContext);
  const versionChoice = CHATGPT_FORCE_MOBILE_VERSION ? "2" : "1";
  const toneResponse = "4번 경험 공유 말투로 진행해주세요.";
  const directSeoTitle = buildDirectSeoTitle(guidanceContext);

  const beforeStarterMessages = await readAssistantMessages(page);
  const starterClicked = await clickGreetingStarterIfVisible(page);
  let latestReply = "";

  if (starterClicked) {
    console.log("      - Draft GPT 스타터(안녕하세요) 클릭");
    try {
      latestReply = await waitForChatGPTAssistantReply(
        page,
        beforeStarterMessages,
        Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 45000),
        Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 90000),
        "Draft 스타터"
      );
    } catch (error) {
      console.log(`      - Draft 스타터 응답 대기 생략: ${getErrorMessage(error)}`);
      latestReply = "";
    }
  } else {
    console.log("      - Draft GPT 스타터 버튼 미노출, 일반 대화로 진행");
  }

  const steps: DraftFlowStep[] = [
    {
      key: "product",
      label: "1단계(제품 정보)",
      matcher: isDraftStepProductInfoPrompt,
      response: () =>
        [
          `제품명: ${guidanceContext.productName}`,
          `구매페이지: ${guidanceContext.brandLink}`,
        ].join("\n"),
    },
    {
      key: "keywords",
      label: "2단계(SEO 키워드)",
      matcher: isDraftStepSeoKeywordPrompt,
      response: () => seoKeywordInput,
    },
    {
      key: "title-choice",
      label: "2단계(SEO 제목 선택)",
      matcher: isDraftStepSeoTitleSelectionPrompt,
      response: () =>
        [
          `직접 제목으로 진행할게요: ${directSeoTitle}`,
          "번호 선택 형식이 꼭 필요하면 1번으로 선택해주세요.",
        ].join("\n"),
    },
    {
      key: "version",
      label: "3단계(출력 형식)",
      matcher: isDraftStepVersionPrompt,
      response: () => versionChoice,
    },
    {
      key: "subtitle-count",
      label: "4단계(소제목 개수)",
      matcher: isDraftStepSubtitleCountPrompt,
      response: () => String(sectionCount),
    },
    {
      key: "content",
      label: "5단계(콘텐츠 구성)",
      matcher: isDraftStepContentPrompt,
      response: () =>
        [
          buildDraftContentPayload(guidanceContext, sectionCount),
          "",
          "[작성 요청]",
          userPrompt,
          "",
          "[작성 가이드]",
          systemPrompt,
          "",
          "참고: 첨부 이미지를 반영해서 1차 글을 작성해주세요.",
        ].join("\n"),
      attachImages: true,
    },
    {
      key: "tone",
      label: "6단계(말투 설정)",
      matcher: isDraftStepTonePrompt,
      response: () => toneResponse,
    },
  ];

  for (const step of steps) {
    latestReply = await waitForDraftStepPrompt(page, latestReply, step, minSections);

    if (!step.matcher(latestReply)) {
      console.log(`      - Draft ${step.label} 질문 미확인, 단계 응답을 강행합니다.`);
    }

    if (step.attachImages && CHATGPT_ATTACH_IMAGES_TO_DRAFT) {
      await attachImagesToChatGPT(page, imagePaths, "Draft");
    }

    console.log(`      - Draft ${step.label} 응답 전송`);
    latestReply = await sendPromptToChatGPT(page, step.response(latestReply), {
      label: `Draft ${step.label}`,
      idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 180_000),
      maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 420_000),
    });
  }

  if (hasStructuredDraftOutput(latestReply, minSections)) {
    return latestReply;
  }

  const structuredPrompt = [
    "지금까지 입력한 1~6단계 정보를 기준으로 최종 결과를 정리해주세요.",
    "- 출력은 JSON만",
    "- 키: title, sections, hashtags",
    `- sections는 ${sectionCount}개 구성 유지`,
    "- 모바일 버전 규칙 유지",
    "- 말투는 4번 경험공유형 유지",
    "- sections는 소제목 + 본문 구조 유지",
    "- 제목/소제목에 이모지 금지",
    "- 코드블록 금지",
  ].join("\n");

  if (CHATGPT_GUIDED_MODE) {
    try {
      return await requestStructuredOutputWithGuidance(
        page,
        structuredPrompt,
        "Draft",
        guidanceContext,
        minSections
      );
    } catch (error) {
      console.log(`      - Draft 최종 구조화 실패, 직전 응답으로 진행: ${getErrorMessage(error)}`);
      if (latestReply.trim().length > 0) {
        return latestReply;
      }
      throw error;
    }
  }

  try {
    return await sendPromptToChatGPT(page, structuredPrompt, {
      label: "Draft 최종 구조화",
      idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 240_000),
      maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 720_000),
    });
  } catch (error) {
    console.log(`      - Draft 최종 구조화 실패, 직전 응답으로 진행: ${getErrorMessage(error)}`);
    if (latestReply.trim().length > 0) {
      return latestReply;
    }
    throw error;
  }
}

async function runChatGPTBrowserTwoPass(
  systemPrompt: string,
  userPrompt: string,
  guidanceContext: ChatGPTGuidanceContext,
  imagePaths: string[]
): Promise<string> {
  const hasSessionFile = fs.existsSync(CHATGPT_SESSION_FILE);
  const hasPersistentProfile =
    fs.existsSync(CHATGPT_USER_DATA_DIR) &&
    fs.readdirSync(CHATGPT_USER_DATA_DIR).length > 0;

  if (!hasSessionFile && !hasPersistentProfile) {
    throw new Error(
      "ChatGPT 세션이 없습니다. `npm run login:chatgpt` 실행 후 다시 시도하세요."
    );
  }

  const contextHandle = await createChatGPTContext(hasSessionFile);
  const requiredFinalSections = Math.min(
    8,
    Math.max(4, guidanceContext.targetSectionCount - 1)
  );

  try {
    const context = contextHandle.context;
    const page = await context.newPage();

    await openChatGPTTarget(page, CHATGPT_DRAFT_GPT_URL, "Draft");
    const firstDraft = await runDraftGptConversation(
      page,
      systemPrompt,
      userPrompt,
      guidanceContext,
      imagePaths,
      Math.min(6, Math.max(3, guidanceContext.targetSectionCount - 2))
    );

    // 2차 다듬기는 별도 GPT(또는 동일 GPT)로 수행
    if (CHATGPT_POLISH_GPT_URL !== CHATGPT_DRAFT_GPT_URL) {
      await openChatGPTTarget(page, CHATGPT_POLISH_GPT_URL, "Polish");
    }

    const secondPrompt = [
      "아래 초안을 가이드에 맞춰 최종본으로 다듬어 주세요.",
      "- title에는 이모지 금지",
      "- sections 소제목에는 이모지 금지",
      "- sections는 소제목 + 본문 구조 유지",
      "- 모바일 버전 가독성(짧은 문장, 잦은 줄바꿈) 유지",
      "- 말투는 4번 경험공유형 그대로 유지",
      "- 첨부된 상품 이미지도 참고해 설명을 더 구체화",
      "- JSON(title, sections, hashtags)으로 출력",
      "- 코드블록 금지",
      "",
      "[초안]",
      firstDraft,
      "",
      "[보완 정보]",
      buildGuidanceSummary(guidanceContext),
    ].join("\n");

    if (CHATGPT_ATTACH_IMAGES_TO_POLISH) {
      await attachImagesToChatGPT(page, imagePaths, "Polish");
    }

    let polished = firstDraft;
    try {
      polished = CHATGPT_GUIDED_MODE
        ? await requestStructuredOutputWithGuidance(
            page,
            secondPrompt,
            "Polish",
            guidanceContext,
            requiredFinalSections
          )
        : await sendPromptToChatGPT(page, secondPrompt, {
            label: "Polish 최종",
            idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 240_000),
            maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 720_000),
          });
    } catch (error) {
      console.log(`      - Polish GPT 실패, Draft 결과로 대체 진행: ${getErrorMessage(error)}`);
      polished = firstDraft;
    }
    let polishedParsed = parseJsonObjectFromText(polished);

    if (getStructuredSectionCount(polishedParsed) < requiredFinalSections && CHATGPT_FALLBACK_TO_BASE) {
      await openChatGPTTarget(page, CHATGPT_BASE_URL, "Base");

      const baseFallbackPrompt = [
        "아래 지시사항과 요청으로 블로그 글을 작성해.",
        "- 질문 금지",
        "- JSON만 출력",
        "- 키: title, sections, hashtags",
        "- sections는 최소 8개",
        "",
        "[시스템 지시사항]",
        systemPrompt,
        "",
        "[사용자 요청]",
        userPrompt,
      ].join("\n");

      polished = CHATGPT_GUIDED_MODE
        ? await requestStructuredOutputWithGuidance(
            page,
            baseFallbackPrompt,
            "Base",
            guidanceContext,
            requiredFinalSections
          )
        : await sendPromptToChatGPT(page, baseFallbackPrompt, {
            label: "Base 최종",
            idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 240_000),
            maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 720_000),
          });
      polishedParsed = parseJsonObjectFromText(polished);
    }

    if (getStructuredSectionCount(polishedParsed) < requiredFinalSections) {
      console.log(
        `      - 구조화 섹션 부족(${getStructuredSectionCount(polishedParsed)}/${requiredFinalSections}), 폴백 파싱으로 진행합니다.`
      );
    }
    await context.storageState({ path: CHATGPT_SESSION_FILE });

    return polished;
  } finally {
    await contextHandle.close();
  }
}

function collectBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  const source = text;

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          results.push(source.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }

  return results;
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  const fencedMatches = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedMatches) {
    const content = match[1]?.trim();
    if (content) candidates.push(content);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }

  candidates.push(...collectBalancedJsonObjects(text));
  return candidates;
}

function parseJsonSafely(candidate: string): Record<string, unknown> | null {
  const cleaned = candidate
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // no-op
  }

  return null;
}

function extractMarkdownTitle(text: string): string | null {
  const byLabel = text.match(/(?:^|\n)(?:title|제목)\s*[:：]\s*(.+)/i)?.[1]?.trim();
  if (byLabel) return byLabel;

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.startsWith("{") || line.startsWith("```")) continue;
    if (/^[-*]\s+/.test(line)) continue;
    if (/^#+\s+/.test(line)) continue;
    if (isSectionTitleLine(line)) continue;
    if (line.length <= 120) return line;
  }

  return null;
}

function extractMarkdownSections(text: string): string[] {
  const lines = text
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .map((line) => line.trim());

  const sections: string[] = [];
  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentTitle) return;
    const body = currentBody.filter((line) => line.length > 0);
    if (body.length > 0) {
      sections.push(`${currentTitle}\n\n${body.join("\n")}\n`);
    }
    currentTitle = null;
    currentBody = [];
  };

  for (const rawLine of lines) {
    if (!rawLine) continue;

    const normalizedLine = rawLine.replace(/^[-*]\s*/, "").replace(/^#+\s*/, "").trim();
    if (isSectionTitleLine(normalizedLine)) {
      flush();
      currentTitle = stripSectionPrefix(normalizedLine);
      continue;
    }

    if (currentTitle) {
      const bodyLine = rawLine.replace(/^[-*]\s*/, "").trim();
      if (bodyLine) currentBody.push(bodyLine);
    }
  }

  flush();
  return sections;
}

function extractMarkdownHashtags(text: string): string[] {
  const tags = text.match(/#[\p{L}\p{N}_-]{2,30}/gu) ?? [];
  const normalized = tags.map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 20);
}

function getStructuredSectionCount(parsed: Record<string, unknown>): number {
  if (!Array.isArray(parsed.sections)) return 0;
  return parsed.sections.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .length;
}

function looksLikeClarificationRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;

  const patterns = [
    "입력해주세요",
    "알려주세요",
    "원하시나요",
    "필요해요",
    "제목을 입력",
    "정보를 주세요",
    "먼저",
    "작성해드릴게요",
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const candidates = extractJsonCandidates(text);
  for (const candidate of candidates) {
    const parsed = parseJsonSafely(candidate);
    if (parsed) return parsed;
  }

  const fallbackSections = extractMarkdownSections(text);
  const fallbackHashtags = extractMarkdownHashtags(text);
  const fallbackTitle = extractMarkdownTitle(text);

  const fallback: Record<string, unknown> = {};
  if (fallbackTitle) fallback.title = fallbackTitle;
  if (fallbackSections.length > 0) fallback.sections = fallbackSections;
  if (fallbackHashtags.length > 0) fallback.hashtags = fallbackHashtags;
  return fallback;
}

function splitSectionCandidates(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const parts: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isSectionTitleLine(line) && current.length > 0) {
      parts.push(current.join("\n").trim());
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    parts.push(current.join("\n").trim());
  }

  return parts.length > 0 ? parts : [normalized];
}

function buildFallbackSection(title: string, product: ProductInfo): string {
  const plainTitle = stripSectionPrefix(title) || "사용 후기";
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

  let title = stripSectionPrefix(allLines[0] || fallbackTitle);
  if (!title || title.length > 60) {
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

function saveGeneratedPostPreview(
  linkId: string,
  post: GeneratedPostPreview,
  product: ProductInfo
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${linkId}.json`;
  const filePath = path.join(GENERATED_OUTPUT_DIR, filename);

  const payload = {
    createdAt: new Date().toISOString(),
    linkId,
    aiProvider: AI_PROVIDER,
    browserGptMode: BROWSER_GPT_MODE,
    chatgptDraftUrl: CHATGPT_DRAFT_GPT_URL,
    chatgptPolishUrl: CHATGPT_POLISH_GPT_URL,
    productName: product.name,
    productPrice: product.price,
    title: post.title,
    sectionCount: post.sections.length,
    hashtagCount: post.hashtags.length,
    sections: post.sections,
    hashtags: post.hashtags,
    rawResponse: post.rawResponse ?? "",
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
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
  representativeImagePath: string | null; // 대표 이미지(og:image 우선)
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
  const representativeImageUrl = imageUrls[0] || null;
  
  // 이미지 다운로드 (최대 10개로 확대)
  const downloaded: { path: string; url: string; size: number }[] = [];
  const downloadCount = Math.min(10, imageUrls.length);
  let representativeImagePath: string | null = null;
  let firstValidImagePath: string | null = null;
  
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
      if (!firstValidImagePath) {
        firstValidImagePath = imgPath;
      }
      if (!representativeImagePath && representativeImageUrl && imageUrls[i] === representativeImageUrl) {
        representativeImagePath = imgPath;
      }
      console.log(`   ✅ 이미지 ${i + 1}/${downloadCount} 다운로드`);
    } catch {
      console.log(`   ⚠️ 다운로드 실패 ${i + 1}`);
    }
  }

  if (!representativeImagePath) {
    representativeImagePath = firstValidImagePath;
  }

  downloaded.sort((a, b) => {
    const aPenalty = containsBadImageKeyword(a.url) ? -150_000 : 0;
    const bPenalty = containsBadImageKeyword(b.url) ? -150_000 : 0;
    const aScore = a.size + aPenalty;
    const bScore = b.size + bPenalty;
    return bScore - aScore;
  });

  const sortedPaths = downloaded.map((item) => item.path);
  const imagePaths = Array.from(
    new Set([
      ...(representativeImagePath ? [representativeImagePath] : []),
      ...sortedPaths,
    ])
  );
  
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
    representativeImagePath,
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
async function generateWithAI(
  systemPrompt: string,
  userPrompt: string,
  chatgptContext?: ChatGPTGuidanceContext,
  chatgptImagePaths: string[] = []
): Promise<string> {
  const combinedPrompt = `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 요청]\n${userPrompt}`;

  if (BROWSER_GPT_MODE) {
    if (!chatgptContext) {
      throw new Error("Browser GPT 모드에 필요한 가이드 컨텍스트가 없습니다.");
    }

    try {
      return runChatGPTBrowserTwoPass(systemPrompt, userPrompt, chatgptContext, chatgptImagePaths);
    } catch (error) {
      const reason = getErrorMessage(error);
      console.log(`   ⚠️ Browser GPT 실패: ${reason}`);
      console.log("   ↪️ OpenAI(OpenCode) 폴백으로 계속 진행합니다.");
      return runOpenCode(combinedPrompt);
    }
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
    const result = await model.generateContent(combinedPrompt);
    return result.response.text();
    
  } else if (AI_PROVIDER === "openai") {
    // OpenAI는 opencode 인증 세션을 통해 호출 (API 키 불필요)
    return runOpenCode(combinedPrompt);
    
  } else {
    throw new Error("AI Provider가 설정되지 않았습니다. .env 파일을 확인하세요.");
  }
}

// ============================================
// STEP 2: LLM으로 SEO 최적화 글 생성 (긴 버전)
// ============================================
async function step2_generatePost(product: ProductInfo, brandLink: string): Promise<{ title: string; sections: string[]; hashtags: string[]; rawResponse: string }> {
  console.log("\n📝 STEP 2: SEO 최적화 블로그 글 생성 (확장판)");
  console.log(`   🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);
  if (BROWSER_GPT_MODE) {
    console.log(`   🌐 Browser GPT Mode: ON`);
    console.log(`      - Draft GPT: ${CHATGPT_DRAFT_GPT_URL}`);
    console.log(`      - Polish GPT: ${CHATGPT_POLISH_GPT_URL}`);
  }
  
  const bodySectionCount = BROWSER_GPT_MODE
    ? CHATGPT_DEFAULT_SUBTITLE_COUNT
    : Math.max(Math.min(product.imagePaths.length, 10), 8);
  
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
${BROWSER_GPT_MODE && CHATGPT_FORCE_MOBILE_VERSION ? "- 출력 형식: 모바일 버전 고정" : ""}

## 작성 규칙
1. 제목: 상품 카테고리 + 상품명 키워드 포함, 25-35자
   - 제목에는 이모지를 절대 넣지 마세요.
   예: "아기비데 추천 | 해피달링 시그니처 워터탭 솔직 후기"

2. 본문을 정확히 ${bodySectionCount}개 섹션으로 작성 (총 2000자 이상)

3. 각 섹션 구조:
   - 소제목 (한 줄, 이모지 금지)
   - 빈 줄
   - 본문 4-6문장 (각 문장 끝에 줄바꿈, 각 문장 30-50자)
   - 빈 줄

4. 섹션 구성 (${bodySectionCount}개):
   - 구매하게 된 계기
   - 택배 도착 & 개봉기
   - 첫인상 / 디자인
   - 크기 & 스펙 정보
   - 주요 기능 ①
   - 주요 기능 ②
   - 실제 사용 후기
   - 장점 정리
   - 아쉬운 점 (솔직하게)
   - 이런 분께 추천해요

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
    "소제목\\n\\n문장1.\\n문장2.\\n문장3.\\n문장4.\\n",
    "소제목\\n\\n문장1.\\n문장2.\\n문장3.\\n"
  ],
  "hashtags": ["키워드1", "키워드2", ...]
}`;

  const chatgptContext: ChatGPTGuidanceContext = {
    productName: product.name,
    description: product.description,
    features: product.features,
    price: product.price,
    originalPrice: product.originalPrice,
    discountRate: product.discountRate,
    couponInfo: product.couponInfo,
    deliveryInfo: product.deliveryInfo,
    reviewCount: product.reviewCount,
    rating: product.rating,
    brandLink,
    targetSectionCount: bodySectionCount,
  };

  const text = await generateWithAI(
    systemPrompt,
    userPrompt,
    chatgptContext,
    product.imagePaths
  );
  const json = parseJsonObjectFromText(text);
  const minimumSections = Math.min(8, Math.max(4, bodySectionCount - 1));
  const structuredSectionCount = getStructuredSectionCount(json);
  if (structuredSectionCount < minimumSections) {
    console.log(
      `   ⚠️ 구조화 섹션 부족(${structuredSectionCount}/${minimumSections}), 폴백 섹션으로 보완합니다.`
    );
  }
  
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
    hashtags,
    rawResponse: text,
  };
}

// ============================================
// STEP 3: 블로그 에디터 열기
// ============================================
async function step3_openEditor(
  context: BrowserContext,
  page: Page,
  categoryNo?: string | null
): Promise<Page> {
  console.log("\n📄 STEP 3: 블로그 글쓰기 페이지");

  const postWriteUrl = new URL(`https://blog.naver.com/${NAVER_BLOG_ID}/postwrite`);
  if (categoryNo?.trim()) {
    postWriteUrl.searchParams.set("categoryNo", categoryNo.trim());
    console.log(`   📂 게시판 번호 적용: ${categoryNo.trim()}`);
  } else {
    console.log("   📂 게시판 번호 미지정 (기본 게시판)");
  }

  let targetPage = page;
  if (targetPage.isClosed()) {
    console.log("   ⚠️ 기존 페이지가 닫혀 새 페이지를 다시 엽니다.");
    targetPage = await context.newPage();
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await targetPage.goto(postWriteUrl.toString(), { timeout: 45000, waitUntil: "domcontentloaded" });
      await targetPage.waitForTimeout(4000);
      break;
    } catch (error) {
      const message = getErrorMessage(error);
      const canRetry = /ERR_ABORTED|Target page, context or browser has been closed/i.test(message);
      if (!canRetry || attempt === 1) {
        throw error;
      }
      console.log(`   ⚠️ 에디터 진입 재시도(${attempt + 1}/2): ${message}`);

      if (targetPage.isClosed()) {
        targetPage = await context.newPage();
      }
      await targetPage.waitForTimeout(1500);
    }
  }
  
  // 팝업 닫기 (작성 중인 글 있습니다)
  try {
    const cancelBtn = await targetPage.$('.se-popup-button-cancel');
    if (cancelBtn) {
      await cancelBtn.click();
      console.log("   팝업 닫음");
      await targetPage.waitForTimeout(1000);
    }
  } catch {}
  
  console.log("   ✅ 에디터 준비 완료");
  return targetPage;
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

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    const visible = await target.isVisible().catch(() => false);
    if (!visible) continue;
    await target.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
    return true;
  }

  return false;
}

async function setNaverTextFormat(
  page: Page,
  format: "text" | "sectionTitle"
): Promise<boolean> {
  const openMenu = async () =>
    clickFirstVisible(page, [
      'button[data-name="text-format"]',
      'button:has-text("문단 서식 변경")',
      'button:has-text("본문")',
      'button:has-text("소제목")',
    ]);

  const optionSelectors =
    format === "sectionTitle"
      ? [
          'button[data-name="text-format"][data-value="sectionTitle"]',
          "button.se-toolbar-option-text-format-sectionTitle-button",
          '.se-toolbar-option-text-format button[data-value="sectionTitle"]',
          'button:has-text("소제목")',
        ]
      : [
          'button[data-name="text-format"][data-value="text"]',
          "button.se-toolbar-option-text-format-text-button",
          '.se-toolbar-option-text-format button[data-value="text"]',
          'button:has-text("본문")',
        ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openMenu();
    const picked = await clickFirstVisible(page, optionSelectors);
    if (!picked) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120);
      continue;
    }

    await page.waitForTimeout(160);

    const toolbarLabel = (
      (await page
        .locator('button[data-name="text-format"]')
        .first()
        .innerText()
        .catch(() => "")) || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    if (format === "sectionTitle" && toolbarLabel.includes("소제목")) {
      return true;
    }
    if (format === "text" && toolbarLabel.includes("본문")) {
      return true;
    }
  }

  return false;
}

async function insertNaverHorizontalDivider(page: Page): Promise<boolean> {
  const clicked = await clickFirstVisible(page, [
    'button[data-name="horizontal-line"][data-value="default"]',
    'button[data-name="horizontal-line"]',
    'button[aria-label*="구분선"]',
    'button:has-text("구분선")',
  ]);

  if (!clicked) return false;
  await page.waitForTimeout(180);
  return true;
}

// 텍스트 섹션 입력 (줄바꿈 포함)
async function inputTextSection(
  page: Page,
  text: string,
  options?: { useSectionHeading?: boolean; insertDividerAboveHeading?: boolean }
): Promise<void> {
  const useSectionHeading = options?.useSectionHeading ?? true;
  const insertDividerAboveHeading =
    options?.insertDividerAboveHeading ?? useSectionHeading;
  const lines = text.split("\n");
  const firstTextLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstTextLineIndex < 0) {
    await page.keyboard.press("Enter");
    return;
  }

  const titleLine = lines[firstTextLineIndex].trim();
  const bodyLines = lines.slice(firstTextLineIndex + 1);

  if (useSectionHeading) {
    if (insertDividerAboveHeading) {
      const dividerInserted = await insertNaverHorizontalDivider(page);
      if (!dividerInserted) {
        console.log("   ⚠️ 구분선 삽입 실패, 텍스트 입력은 계속 진행합니다.");
      }
    }

    const headingApplied = await setNaverTextFormat(page, "sectionTitle");
    if (!headingApplied) {
      console.log("   ⚠️ 소제목 스타일 적용 실패, 본문 스타일로 대체");
    }
    await page.keyboard.type(titleLine, { delay: 3 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    await setNaverTextFormat(page, "text");
  } else {
    await setNaverTextFormat(page, "text");
    await page.keyboard.type(titleLine, { delay: 3 });
    await page.keyboard.press("Enter");
  }

  for (const rawLine of bodyLines) {
    const line = rawLine.trim();
    if (!line) {
      await page.keyboard.press("Enter");
    } else {
      await page.keyboard.type(line, { delay: 3 });
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(45);
  }

  // 섹션 구분용 줄바꿈
  await page.keyboard.press("Enter");
}

// ============================================
// STEP 5+6: 이미지와 본문 번갈아 입력
// ============================================
async function step5and6_uploadAndWrite(
  page: Page,
  imagePaths: string[],
  sections: string[],
  hashtags: string[],
  options?: { useSectionHeading?: boolean }
): Promise<void> {
  console.log("\n📝 STEP 5+6: 이미지 + 본문 번갈아 입력");
  const useSectionHeading = options?.useSectionHeading ?? true;
  console.log(`   🧩 소제목 스타일: ${useSectionHeading ? "ON" : "OFF"}`);
  
  // 본문 영역으로 이동
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await setNaverTextFormat(page, "text");
  
  const mainSections = sections.length > 1 ? sections.slice(0, -1) : sections;
  const tailSection = sections.length > 1 ? sections[sections.length - 1] : "";
  // 우선순위 이미지(썸네일, 대표이미지)는 섹션 수가 적어도 최소 2장까지 업로드
  const maxLoop = Math.max(mainSections.length, Math.min(imagePaths.length, 2));
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
      await inputTextSection(page, mainSections[i], { useSectionHeading });
      await page.waitForTimeout(300);
    }
  }

  if (tailSection) {
    console.log(`   [마무리] ✏️ 텍스트 입력 (${tailSection.length}자)`);
    await inputTextSection(page, tailSection, { useSectionHeading: false });
    await page.waitForTimeout(300);
  }
  
  // 해시태그 (맨 마지막) - 스페이스 제거하여 태그 깨짐 방지
  await setNaverTextFormat(page, "text");
  await page.keyboard.press('Enter');
  const hashtagText = hashtags.map((t: string) => `#${t.replace(/\s+/g, '')}`).join(' ');
  await page.keyboard.type(hashtagText, { delay: 10 });
  
  console.log(`\n   ✅ 총 이미지 ${uploadedCount}개 업로드`);
  console.log(`   ✅ 총 섹션 ${sections.length}개 입력`);
  console.log(`   ✅ 해시태그 ${hashtags.length}개`);
}

type PublishMode = "now" | "schedule";

interface PublishExecutionOptions {
  mode: PublishMode;
  scheduledDate?: Date | null;
}

function formatDateYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDatePartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number.parseInt(map.get("year") || "0", 10);
  const month = Number.parseInt(map.get("month") || "0", 10);
  const day = Number.parseInt(map.get("day") || "0", 10);
  const hour = Number.parseInt(map.get("hour") || "0", 10);
  const minute = Number.parseInt(map.get("minute") || "0", 10);

  return { year, month, day, hour, minute };
}

function formatDateYmdInTimeZone(date: Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

function formatDateLog(date: Date): string {
  return `${formatDateYmd(date)} 09:00`;
}

function toScheduleTimeLabel(hour: string, minute: string): string | null {
  const normalizedHour = hour.replace(/[^\d]/g, "");
  const normalizedMinute = minute.replace(/[^\d]/g, "");
  if (!normalizedHour || !normalizedMinute) return null;
  const hh = Number.parseInt(normalizedHour, 10);
  const mm = Number.parseInt(normalizedMinute, 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function toNextDayAtNine(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return next;
}

function createTimestampLabel(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function parseYmdToLocalDate(ymd: string): Date | null {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function normalizeDateCandidate(value: string): string {
  const compact = value.replace(/\s+/g, "");
  const ymd = compact.match(/(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})/);
  if (!ymd) return "";
  const yyyy = ymd[1];
  const mm = ymd[2].padStart(2, "0");
  const dd = ymd[3].padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isScheduleDateMatch(value: string, expectedYmd: string): boolean {
  if (!value) return false;
  const normalized = normalizeDateCandidate(value);
  if (!normalized) return false;
  return normalized === expectedYmd;
}

function isScheduleDateTimeFuture(
  targetYmd: string,
  targetTimeLabel: string,
  timeZone: string
): boolean {
  const timeMatch = targetTimeLabel.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!timeMatch) return false;

  const targetHour = Number.parseInt(timeMatch[1], 10);
  const targetMinute = Number.parseInt(timeMatch[2], 10);
  if (!Number.isFinite(targetHour) || !Number.isFinite(targetMinute)) return false;

  const now = new Date();
  const nowYmd = formatDateYmdInTimeZone(now, timeZone);
  if (targetYmd > nowYmd) return true;
  if (targetYmd < nowYmd) return false;

  const nowParts = getDatePartsInTimeZone(now, timeZone);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const targetMinutes = targetHour * 60 + targetMinute;
  return targetMinutes > nowMinutes;
}

async function getSchedulePanelLocator(page: Page): Promise<Locator> {
  const selectors = [
    'div[class*="layer_content_set_publish" i]',
    'div[class*="layer_publish" i]',
    ".publish_layer",
    '[role="dialog"]',
  ];

  for (const selector of selectors) {
    const panel = page.locator(selector).first();
    const visible = await panel.isVisible().catch(() => false);
    if (visible) return panel;
  }

  return page.locator("body");
}

async function setInputValueWithNativeEvents(input: Locator, value: string): Promise<string> {
  await input.click({ timeout: 1200 }).catch(() => {});
  await input.press("Meta+A").catch(() => {});
  await input.press("Control+A").catch(() => {});
  await input.type(value, { delay: 35 }).catch(() => {});
  await input.press("Enter").catch(() => {});
  await input.dispatchEvent("input").catch(() => {});
  await input.dispatchEvent("change").catch(() => {});
  await input
    .evaluate((element) => {
      const target = element as { blur?: () => void };
      target.blur?.();
    })
    .catch(() => {});
  let current = await input.inputValue().catch(() => "");
  if (current) {
    return current;
  }

  await input.click({ timeout: 1200 }).catch(() => {});
  await input.press("Meta+A").catch(() => {});
  await input.press("Control+A").catch(() => {});
  await input.fill(value, { timeout: 1200 }).catch(() => {});
  await input.dispatchEvent("input").catch(() => {});
  await input.dispatchEvent("change").catch(() => {});
  await input
    .evaluate((element) => {
      const target = element as { blur?: () => void };
      target.blur?.();
    })
    .catch(() => {});

  const byNativeSetter = await input
    .evaluate((element, nextValue) => {
      const target = element as {
        hasAttribute?: (name: string) => boolean;
        removeAttribute?: (name: string) => void;
        value?: string;
        blur?: () => void;
        dispatchEvent?: (event: unknown) => void;
        ownerDocument?: {
          defaultView?: {
            HTMLInputElement?: { prototype?: object };
            Event?: new (type: string, init?: { bubbles?: boolean }) => unknown;
          };
        };
      };

      if (target.hasAttribute?.("readonly")) {
        target.removeAttribute?.("readonly");
      }

      const inputPrototype = target.ownerDocument?.defaultView?.HTMLInputElement?.prototype;
      const descriptor = inputPrototype
        ? Object.getOwnPropertyDescriptor(inputPrototype, "value")
        : undefined;
      const setter = descriptor?.set as ((this: { value?: string }, value: string) => void) | undefined;
      if (setter) {
        setter.call(target, nextValue);
      } else {
        target.value = nextValue;
      }

      const EventCtor = target.ownerDocument?.defaultView?.Event;
      if (EventCtor && target.dispatchEvent) {
        target.dispatchEvent(new EventCtor("input", { bubbles: true }));
        target.dispatchEvent(new EventCtor("change", { bubbles: true }));
      }

      target.blur?.();
      return target.value || "";
    }, value)
    .catch(() => "");

  current = await input.inputValue().catch(() => "");
  return current || byNativeSetter || "";
}

function parseDatepickerYearMonth(titleText: string): { year: number; month: number } | null {
  const normalized = titleText.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
}

function compareYearMonth(
  left: { year: number; month: number },
  right: { year: number; month: number }
): number {
  if (left.year !== right.year) return left.year - right.year;
  return left.month - right.month;
}

async function trySetScheduleDateViaDatepicker(page: Page, scheduledDate: Date): Promise<boolean> {
  const ymd = formatDateYmd(scheduledDate);
  const targetYearMonth = {
    year: scheduledDate.getFullYear(),
    month: scheduledDate.getMonth() + 1,
  };
  const targetDay = String(scheduledDate.getDate());
  const panel = await getSchedulePanelLocator(page);
  const dateInput = panel
    .locator('div[class*="time_setting" i] input.input_date__QmA0s, div[class*="date" i] input.input_date__QmA0s, input.input_date__QmA0s')
    .first();
  if (!(await dateInput.isVisible().catch(() => false))) {
    return false;
  }

  await dateInput.click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(250);
  const datepicker = page.locator(".ui-datepicker:visible").first();
  if (!(await datepicker.isVisible().catch(() => false))) {
    return false;
  }

  console.log("      - 예약 날짜 입력 시도: datepicker");

  let reachedTargetMonth = false;
  for (let step = 0; step < 24; step += 1) {
    const titleText = ((await datepicker.locator(".ui-datepicker-title").first().textContent().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    const currentYearMonth = parseDatepickerYearMonth(titleText);
    if (!currentYearMonth) {
      break;
    }

    const delta = compareYearMonth(currentYearMonth, targetYearMonth);
    if (delta === 0) {
      reachedTargetMonth = true;
      break;
    }

    if (delta > 0) {
      const prevButton = datepicker
        .locator(".ui-datepicker-prev:not(.ui-state-disabled), .ui-datepicker-month-nav.ui-datepicker-prev:not(.ui-state-disabled)")
        .first();
      if (!(await prevButton.isVisible().catch(() => false))) break;
      await prevButton.click({ timeout: 1200 }).catch(() => {});
    } else {
      const nextButton = datepicker
        .locator(".ui-datepicker-next:not(.ui-state-disabled), .ui-datepicker-month-nav.ui-datepicker-next:not(.ui-state-disabled)")
        .first();
      if (!(await nextButton.isVisible().catch(() => false))) break;
      await nextButton.click({ timeout: 1200 }).catch(() => {});
    }
    await page.waitForTimeout(160);
  }

  if (!reachedTargetMonth) {
    return false;
  }

  const dayCandidates = [
    `table td:not(.ui-state-disabled) button.ui-state-default:text-is("${targetDay}")`,
    `table td:not(.ui-state-disabled) a.ui-state-default:text-is("${targetDay}")`,
    `button.ui-state-default:text-is("${targetDay}")`,
    `a.ui-state-default:text-is("${targetDay}")`,
  ];

  for (const selector of dayCandidates) {
    const dayButton = datepicker.locator(selector).first();
    if (!(await dayButton.isVisible().catch(() => false))) continue;
    await dayButton.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(220);
    const applied = await dateInput.inputValue().catch(() => "");
    if (isScheduleDateMatch(applied, ymd)) {
      return true;
    }
  }

  return false;
}

async function trySetScheduleDateInputs(page: Page, scheduledDate: Date): Promise<boolean> {
  const ymd = formatDateYmd(scheduledDate);
  const dotted = ymd.replace(/-/g, ".");
  const [yyyy, mm, dd] = ymd.split("-");
  const dottedSpaced = `${yyyy}. ${mm}. ${dd}`;
  const dottedSpacedNoPad = `${scheduledDate.getFullYear()}. ${scheduledDate.getMonth() + 1}. ${
    scheduledDate.getDate()
  }`;
  const dottedNoPad = `${scheduledDate.getFullYear()}.${scheduledDate.getMonth() + 1}.${scheduledDate.getDate()}`;
  const slash = `${yyyy}/${mm}/${dd}`;
  const panel = await getSchedulePanelLocator(page);
  const candidateValues = [dottedSpaced, dottedSpacedNoPad, dotted, dottedNoPad, ymd, slash];
  const panelInputSelectors = [
    'div[class*="time_setting" i] input.input_date__QmA0s',
    'div[class*="date" i] input.input_date__QmA0s',
    "input.input_date__QmA0s",
    'input[title*="예약"]',
    'input[placeholder*="날짜"]',
    'input[type="date"]',
    'input[class*="date" i]',
  ];
  const fallbackInputSelectors = [
    'div[class*="layer_publish" i] input.input_date__QmA0s',
    'div[class*="layer_content_set_publish" i] input.input_date__QmA0s',
    '.publish_layer input.input_date__QmA0s',
    '[role="dialog"] input.input_date__QmA0s',
    'div[class*="layer_publish" i] input[class*="date" i]',
    'div[class*="layer_content_set_publish" i] input[class*="date" i]',
  ];

  const contexts: Array<{ name: string; root: Pick<Page, "locator"> | Pick<Locator, "locator">; selectors: string[] }> =
    [
      { name: "panel", root: panel, selectors: panelInputSelectors },
      { name: "global", root: page, selectors: fallbackInputSelectors },
    ];

  const datepickerAppliedFirst = await trySetScheduleDateViaDatepicker(page, scheduledDate);
  if (datepickerAppliedFirst) {
    return true;
  }

  for (const { name, root, selectors } of contexts) {
    for (const selector of selectors) {
      const locators = root.locator(selector);
      const count = Math.min(await locators.count().catch(() => 0), 6);
      for (let i = 0; i < count; i += 1) {
        const locator = locators.nth(i);
        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;

        const type = ((await locator.getAttribute("type").catch(() => "")) || "").toLowerCase();
        const values = type === "date" ? [ymd] : candidateValues;
        console.log(`      - 예약 날짜 입력 시도: ${name}:${selector}${count > 1 ? `#${i + 1}` : ""}`);

        for (const value of values) {
          const finalValue = await setInputValueWithNativeEvents(locator, value);
          await page.waitForTimeout(180);
          if (isScheduleDateMatch(finalValue, ymd)) {
            return true;
          }
        }
      }
    }
  }

  const datepickerAppliedLast = await trySetScheduleDateViaDatepicker(page, scheduledDate);
  if (datepickerAppliedLast) {
    return true;
  }

  const year = String(scheduledDate.getFullYear());
  const month = String(scheduledDate.getMonth() + 1);
  const day = String(scheduledDate.getDate());

  const yearSelect = page.locator('select[name*="year" i], select[id*="year" i], select[class*="year" i]').first();
  const monthSelect = page.locator('select[name*="month" i], select[id*="month" i], select[class*="month" i]').first();
  const daySelect = page.locator('select[name*="day" i], select[id*="day" i], select[class*="day" i]').first();

  const hasYearSelect = await yearSelect.isVisible().catch(() => false);
  const hasMonthSelect = await monthSelect.isVisible().catch(() => false);
  const hasDaySelect = await daySelect.isVisible().catch(() => false);

  if (hasYearSelect && hasMonthSelect && hasDaySelect) {
    console.log("      - 예약 날짜 입력 시도: year/month/day select");
    await yearSelect.selectOption([{ value: year }, { label: year }], { timeout: 1200 }).catch(() => {});
    await monthSelect
      .selectOption([{ value: month }, { value: month.padStart(2, "0") }, { label: month }], {
        timeout: 1200,
      })
      .catch(() => {});
    await daySelect
      .selectOption([{ value: day }, { value: day.padStart(2, "0") }, { label: day }], {
        timeout: 1200,
      })
      .catch(() => {});
    await page.waitForTimeout(250);
    const selectedYear = await yearSelect.inputValue().catch(() => "");
    const selectedMonth = await monthSelect.inputValue().catch(() => "");
    const selectedDay = await daySelect.inputValue().catch(() => "");
    const selectedNormalized = normalizeDateCandidate(
      `${selectedYear}-${selectedMonth}-${selectedDay}`
    );
    if (selectedNormalized === ymd) {
      return true;
    }
  }

  return false;
}

async function hasVisibleScheduleDateInput(page: Page): Promise<boolean> {
  const selectors = [
    'div[class*="layer_publish" i] input.input_date__QmA0s',
    'div[class*="layer_content_set_publish" i] input.input_date__QmA0s',
    'div[class*="layer_publish" i] input[class*="date" i]',
    'div[class*="layer_content_set_publish" i] input[class*="date" i]',
    '.publish_layer input[type="date"]',
    '[role="dialog"] input[type="date"]',
    '.publish_layer input[class*="date" i]',
    '[role="dialog"] input[class*="date" i]',
    '.publish_layer input[placeholder*="날짜"]',
    '[role="dialog"] input[placeholder*="날짜"]',
    '.publish_layer input[name*="date" i]',
    '[role="dialog"] input[name*="date" i]',
    'div[class*="layer_publish" i] select',
    'div[class*="layer_content_set_publish" i] select',
    '.publish_layer select',
    '[role="dialog"] select',
  ];

  for (const selector of selectors) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function trySetScheduleDateInputsFallback(page: Page, scheduledDate: Date): Promise<boolean> {
  const ymd = formatDateYmd(scheduledDate);
  const dotted = ymd.replace(/-/g, ".");
  const [yyyy, mm, dd] = ymd.split("-");
  const dottedSpaced = `${yyyy}. ${mm}. ${dd}`;
  const dottedSpacedNoPad = `${scheduledDate.getFullYear()}. ${scheduledDate.getMonth() + 1}. ${
    scheduledDate.getDate()
  }`;
  const dottedNoPad = `${scheduledDate.getFullYear()}.${scheduledDate.getMonth() + 1}.${scheduledDate.getDate()}`;
  const slash = `${yyyy}/${mm}/${dd}`;
  const panel = await getSchedulePanelLocator(page);
  const dialogInputs = panel.locator(
    'div[class*="time_setting" i] input, div[class*="date" i] input, input.input_date__QmA0s, input[type="date"], input[class*="date" i], input[placeholder*="날짜"], input[name*="date" i], input[id*="date" i]'
  );
  const inputCount = Math.min(await dialogInputs.count().catch(() => 0), 30);

  for (let i = 0; i < inputCount; i += 1) {
    const input = dialogInputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) continue;

    const type = ((await input.getAttribute("type").catch(() => "")) || "").toLowerCase();
    if (["hidden", "checkbox", "radio", "time", "file"].includes(type)) continue;
    const className = ((await input.getAttribute("class").catch(() => "")) || "").toLowerCase();
    const placeholder = ((await input.getAttribute("placeholder").catch(() => "")) || "").toLowerCase();
    const name = ((await input.getAttribute("name").catch(() => "")) || "").toLowerCase();
    const id = ((await input.getAttribute("id").catch(() => "")) || "").toLowerCase();
    const dateSignal = `${className} ${placeholder} ${name} ${id}`;
    if (!/date|day|year|month|날짜|예약/.test(dateSignal)) {
      continue;
    }

    const candidateValues =
      type === "date" ? [ymd] : [dottedSpaced, dottedSpacedNoPad, dotted, dottedNoPad, ymd, slash];
    for (const value of candidateValues) {
      const finalValue = await setInputValueWithNativeEvents(input, value);
      await page.waitForTimeout(180);
      if (isScheduleDateMatch(finalValue, ymd)) {
        console.log(`      - 예약 날짜 fallback 입력 성공(input #${i + 1})`);
        return true;
      }
    }
  }

  return false;
}

async function verifyScheduleDateApplied(page: Page, scheduledDate: Date): Promise<boolean> {
  const ymd = formatDateYmd(scheduledDate);
  const panel = await getSchedulePanelLocator(page);
  const inputs = panel.locator('div[class*="time_setting" i] input.input_date__QmA0s, input.input_date__QmA0s, input[type="date"]');
  const count = Math.min(await inputs.count().catch(() => 0), 20);
  let hasVisibleDateInput = false;
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) continue;
    hasVisibleDateInput = true;
    const value = await input.inputValue().catch(() => "");
    if (isScheduleDateMatch(value, ymd)) {
      return true;
    }
  }

  if (hasVisibleDateInput) {
    return false;
  }

  // 일부 UI는 input value가 비어있고 텍스트 노드로만 날짜가 보인다.
  const visibleNodes = panel.locator("*");
  const nodeCount = Math.min(await visibleNodes.count().catch(() => 0), 200);
  for (let i = 0; i < nodeCount; i += 1) {
    const node = visibleNodes.nth(i);
    const visible = await node.isVisible().catch(() => false);
    if (!visible) continue;
    const text = (((await node.textContent().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
    if (isScheduleDateMatch(text, ymd)) {
      return true;
    }
  }
  return false;
}

interface ScheduleSubmissionTracker {
  stop: () => void;
  hasAnyPublishRequest: () => boolean;
  hasScheduleSignal: () => boolean;
  getRecentEvents: () => string[];
}

function createScheduleSubmissionTracker(page: Page, targetYmd: string): ScheduleSubmissionTracker {
  const dotted = targetYmd.replace(/-/g, ".");
  const compact = targetYmd.replace(/-/g, "");
  const recentEvents: string[] = [];
  let hasAnyPublishRequest = false;
  let hasScheduleSignal = false;

  const pushEvent = (entry: string) => {
    recentEvents.push(entry);
    if (recentEvents.length > 20) {
      recentEvents.shift();
    }
  };

  const listener = (response: Response) => {
    try {
      const request = response.request();
      const method = request.method().toUpperCase();
      if (method !== "POST") return;

      const url = response.url();
      const lowerUrl = url.toLowerCase();
      if (!lowerUrl.includes("naver.com")) return;

      const looksLikePublishEndpoint =
        /write|publish|post|reserve|schedule|save|temp|rabbit/i.test(lowerUrl);
      if (!looksLikePublishEndpoint) return;

      hasAnyPublishRequest = true;

      const postData = request.postData() || "";
      const normalizedPostData = postData.replace(/\s+/g, " ").toLowerCase();
      const hasUrlScheduleSignal = /reserve|reservation|schedule/.test(lowerUrl);

      const hasKeywordSignal =
        /reserve|reservation|schedule|publishmode|publish_mode|publishtype|publish_type|pretime|pre_post|prepost|reservedtime|radio_time|예약|발행/.test(
          normalizedPostData
        );
      const hasDateSignal =
        normalizedPostData.includes(targetYmd) ||
        normalizedPostData.includes(dotted) ||
        normalizedPostData.includes(compact);

      if (hasUrlScheduleSignal || hasKeywordSignal || hasDateSignal) {
        hasScheduleSignal = true;
      }

      pushEvent(
        `POST ${response.status()} ${url} keyword=${hasKeywordSignal ? "Y" : "N"} date=${
          hasDateSignal ? "Y" : "N"
        }`
      );
    } catch {
      // no-op
    }
  };

  page.on("response", listener);

  return {
    stop: () => {
      page.off("response", listener);
    },
    hasAnyPublishRequest: () => hasAnyPublishRequest,
    hasScheduleSignal: () => hasScheduleSignal,
    getRecentEvents: () => [...recentEvents],
  };
}

async function verifyScheduleSubmission(
  page: Page,
  scheduledDate: Date,
  tracker?: ScheduleSubmissionTracker
): Promise<void> {
  const targetYmd = formatDateYmd(scheduledDate);
  const startedAt = Date.now();
  let publishedUrlSeenAt: number | null = null;

  while (Date.now() - startedAt < 12000) {
    const hasScheduleSignal = tracker?.hasScheduleSignal() ?? false;
    const url = page.url();
    if (isPublishedUrl(url)) {
      if (hasScheduleSignal) {
        console.log("      - 예약 요청 신호 감지 + PostView 전환: 예약 제출 성공으로 처리");
        return;
      }

      if (publishedUrlSeenAt === null) {
        publishedUrlSeenAt = Date.now();
      } else if (Date.now() - publishedUrlSeenAt >= 2500) {
        const recentEvents = tracker?.getRecentEvents() ?? [];
        if (recentEvents.length > 0) {
          console.log("      - 예약 요청 추적 로그");
          for (const entry of recentEvents.slice(-8)) {
            console.log(`        ${entry}`);
          }
        }
        throw new Error("예약 발행 대신 즉시 발행 URL로 전환되었습니다.");
      }
    } else {
      publishedUrlSeenAt = null;
    }

    const bodyText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, " ");
    const hasReservationCue =
      /예약\s*발행.*(완료|등록|되었습니다|처리)/.test(bodyText) ||
      /발행\s*예약.*(완료|등록|되었습니다|처리)/.test(bodyText) ||
      (bodyText.includes(targetYmd) && /예약.*(완료|등록|되었습니다|처리)/.test(bodyText));
    if (hasReservationCue) {
      return;
    }

    if (hasScheduleSignal) {
      console.log("      - 예약 요청 신호 감지: 완료 처리");
      return;
    }

    await page.waitForTimeout(400);
  }

  await logScheduleDialogSnapshot(page);
  const recentEvents = tracker?.getRecentEvents() ?? [];
  if (recentEvents.length > 0) {
    console.log("      - 예약 요청 추적 로그");
    for (const entry of recentEvents.slice(-8)) {
      console.log(`        ${entry}`);
    }
  }
  await captureStep7Artifacts(page, "verify-submission-failed");
  throw new Error(`예약 발행 완료 문구를 확인하지 못했습니다. (목표일: ${targetYmd})`);
}

async function logScheduleDialogSnapshot(page: Page): Promise<void> {
  try {
    const buttons = page.locator(
      'div[class*="layer_publish" i] button, div[class*="layer_content_set_publish" i] button, [role="dialog"] button, .publish_layer button'
    );
    const inputs = page.locator(
      'div[class*="layer_publish" i] input, div[class*="layer_content_set_publish" i] input, [role="dialog"] input, .publish_layer input'
    );
    const selects = page.locator(
      'div[class*="layer_publish" i] select, div[class*="layer_content_set_publish" i] select, [role="dialog"] select, .publish_layer select'
    );

    const buttonCount = Math.min(await buttons.count().catch(() => 0), 20);
    const inputCount = Math.min(await inputs.count().catch(() => 0), 20);
    const selectCount = Math.min(await selects.count().catch(() => 0), 20);

    console.log("      - 예약 팝업 스냅샷(button)");
    for (let i = 0; i < buttonCount; i += 1) {
      const button = buttons.nth(i);
      const visible = await button.isVisible().catch(() => false);
      if (!visible) continue;
      const text = (((await button.textContent().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
      const cls = (await button.getAttribute("class").catch(() => "")) || "";
      console.log(`        [btn ${i + 1}] text="${text}" class="${cls}"`);
    }

    console.log("      - 예약 팝업 스냅샷(input)");
    for (let i = 0; i < inputCount; i += 1) {
      const input = inputs.nth(i);
      const visible = await input.isVisible().catch(() => false);
      if (!visible) continue;
      const type = (await input.getAttribute("type").catch(() => "")) || "";
      const placeholder = (await input.getAttribute("placeholder").catch(() => "")) || "";
      const name = (await input.getAttribute("name").catch(() => "")) || "";
      const cls = (await input.getAttribute("class").catch(() => "")) || "";
      console.log(
        `        [input ${i + 1}] type="${type}" placeholder="${placeholder}" name="${name}" class="${cls}"`
      );
    }

    console.log(`      - 예약 팝업 스냅샷(select): ${selectCount}개`);
  } catch {
    console.log("      - 예약 팝업 스냅샷 수집 실패");
  }
}

async function captureStep7Artifacts(page: Page, reason: string): Promise<void> {
  try {
    const dirPath = path.join(process.cwd(), "logs", "manual", "step7");
    fs.mkdirSync(dirPath, { recursive: true });
    const stamp = createTimestampLabel();
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]+/g, "-");
    const baseName = `${stamp}-${safeReason}`;
    const screenshotPath = path.join(dirPath, `${baseName}.png`);
    const htmlPath = path.join(dirPath, `${baseName}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => "");
    if (html) {
      fs.writeFileSync(htmlPath, html, "utf8");
    }

    const screenshotRel = path.relative(process.cwd(), screenshotPath);
    const htmlRel = path.relative(process.cwd(), htmlPath);
    console.log(`      - STEP7 아티팩트 저장: ${screenshotRel}`);
    if (fs.existsSync(htmlPath)) {
      console.log(`      - STEP7 아티팩트 저장: ${htmlRel}`);
    }
  } catch {
    console.log("      - STEP7 아티팩트 저장 실패");
  }
}

function resolveScheduleTimeForDate(
  scheduledDate: Date,
  futureBufferMinutes = 120
): { hour: string; minute: string; label: string } {
  const now = new Date();
  const scheduledYmd = formatDateYmd(scheduledDate);
  const nowYmdInTimezone = formatDateYmdInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  const isSameDay = scheduledYmd === nowYmdInTimezone;

  if (!isSameDay) {
    return { hour: "09", minute: "00", label: "09:00" };
  }

  const nowParts = getDatePartsInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  let totalMinutes = nowParts.hour * 60 + nowParts.minute + futureBufferMinutes;
  totalMinutes = Math.ceil(totalMinutes / 10) * 10;
  if (totalMinutes > 23 * 60 + 50) {
    totalMinutes = 23 * 60 + 50;
  }
  const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minute = String(totalMinutes % 60).padStart(2, "0");

  return {
    hour,
    minute,
    label: `${hour}:${minute}`,
  };
}

function isScheduleTimeFutureForDate(scheduledDate: Date, timeLabel: string): boolean {
  const match = timeLabel.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return false;

  const targetHour = Number.parseInt(match[1], 10);
  const targetMinute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(targetHour) || !Number.isFinite(targetMinute)) return false;

  const targetYmd = formatDateYmd(scheduledDate);
  const now = new Date();
  const nowYmd = formatDateYmdInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  if (targetYmd > nowYmd) return true;
  if (targetYmd < nowYmd) return false;

  const nowParts = getDatePartsInTimeZone(now, NAVER_SCHEDULE_TIMEZONE);
  const nowTotal = nowParts.hour * 60 + nowParts.minute;
  const targetTotal = targetHour * 60 + targetMinute;
  return targetTotal > nowTotal;
}

async function trySetScheduleTimeInputs(page: Page, scheduledDate: Date): Promise<string | null> {
  const bufferCandidates = [120, 180, 240];
  for (const bufferMinutes of bufferCandidates) {
    const targetTime = resolveScheduleTimeForDate(scheduledDate, bufferMinutes);

    const timeInput = page.locator('input[type="time"]').first();
    const hasTimeInput = await timeInput.isVisible().catch(() => false);
    if (hasTimeInput) {
      await timeInput.fill(targetTime.label, { timeout: 1200 }).catch(() => {});
      await timeInput.dispatchEvent("input").catch(() => {});
      await timeInput.dispatchEvent("change").catch(() => {});
      await timeInput.evaluate((element) => (element as { blur?: () => void }).blur?.()).catch(() => {});
      await page.waitForTimeout(200);
      const appliedValue = await timeInput.inputValue().catch(() => targetTime.label);
      if (isScheduleTimeFutureForDate(scheduledDate, appliedValue)) {
        return appliedValue;
      }
      continue;
    }

    const hourSelect = page
      .locator('select[name*="hour" i], select[id*="hour" i], select[class*="hour" i]')
      .first();
    const minuteSelect = page
      .locator('select[name*="minute" i], select[id*="minute" i], select[class*="minute" i]')
      .first();
    const hasHour = await hourSelect.isVisible().catch(() => false);
    const hasMinute = await minuteSelect.isVisible().catch(() => false);

    if (hasHour && hasMinute) {
      await hourSelect
        .selectOption(
          [
            { value: targetTime.hour },
            { value: String(Number(targetTime.hour)) },
            { label: targetTime.hour },
            { label: String(Number(targetTime.hour)) },
          ],
          {
            timeout: 1200,
          }
        )
        .catch(() => {});
      await minuteSelect
        .selectOption(
          [
            { value: targetTime.minute },
            { value: String(Number(targetTime.minute)) },
            { label: targetTime.minute },
            { label: String(Number(targetTime.minute)) },
          ],
          {
            timeout: 1200,
          }
        )
        .catch(() => {});
      await page.waitForTimeout(200);
      const appliedHour = await hourSelect.inputValue().catch(() => targetTime.hour);
      const appliedMinute = await minuteSelect.inputValue().catch(() => targetTime.minute);
      const appliedLabel = `${appliedHour.padStart(2, "0")}:${appliedMinute.padStart(2, "0")}`;
      if (isScheduleTimeFutureForDate(scheduledDate, appliedLabel)) {
        return appliedLabel;
      }
      continue;
    }

    return null;
  }

  return null;
}

async function readAppliedScheduleDateYmd(page: Page): Promise<string | null> {
  const panel = await getSchedulePanelLocator(page);
  const dateInputs = panel.locator(
    'div[class*="time_setting" i] input.input_date__QmA0s, div[class*="date" i] input.input_date__QmA0s, input.input_date__QmA0s, input[type="date"]'
  );
  const count = Math.min(await dateInputs.count().catch(() => 0), 20);
  let hasVisibleInput = false;
  for (let i = 0; i < count; i += 1) {
    const input = dateInputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) continue;
    hasVisibleInput = true;
    const value = await input.inputValue().catch(() => "");
    const normalized = normalizeDateCandidate(value);
    if (normalized) return normalized;
  }

  if (hasVisibleInput) {
    return null;
  }

  const globalDateInput = page
    .locator('input.input_date__QmA0s, input[type="date"]')
    .first();
  if (await globalDateInput.isVisible().catch(() => false)) {
    const value = await globalDateInput.inputValue().catch(() => "");
    const normalized = normalizeDateCandidate(value);
    if (normalized) return normalized;
  }
  return null;
}

async function readAppliedScheduleTimeLabel(page: Page): Promise<string | null> {
  const panel = await getSchedulePanelLocator(page);
  const timeInput = panel.locator('input[type="time"]').first();
  if (await timeInput.isVisible().catch(() => false)) {
    const value = await timeInput.inputValue().catch(() => "");
    const match = value.match(/(\d{1,2})[:시](\d{1,2})/);
    if (match) {
      return toScheduleTimeLabel(match[1], match[2]);
    }
  }

  const hourSelect = panel
    .locator('select[class*="hour" i], select[name*="hour" i], select[id*="hour" i]')
    .first();
  const minuteSelect = panel
    .locator('select[class*="minute" i], select[name*="minute" i], select[id*="minute" i]')
    .first();

  const hasHour = await hourSelect.isVisible().catch(() => false);
  const hasMinute = await minuteSelect.isVisible().catch(() => false);
  if (hasHour && hasMinute) {
    const hourValue = await hourSelect.inputValue().catch(() => "");
    const minuteValue = await minuteSelect.inputValue().catch(() => "");
    return toScheduleTimeLabel(hourValue, minuteValue);
  }

  // 일부 UI는 select 드롭다운이 패널 외부 레이어로 렌더링된다.
  const globalHour = page
    .locator('select[class*="hour" i], select[name*="hour" i], select[id*="hour" i]')
    .first();
  const globalMinute = page
    .locator('select[class*="minute" i], select[name*="minute" i], select[id*="minute" i]')
    .first();
  const hasGlobalHour = await globalHour.isVisible().catch(() => false);
  const hasGlobalMinute = await globalMinute.isVisible().catch(() => false);
  if (hasGlobalHour && hasGlobalMinute) {
    const hourValue = await globalHour.inputValue().catch(() => "");
    const minuteValue = await globalMinute.inputValue().catch(() => "");
    return toScheduleTimeLabel(hourValue, minuteValue);
  }

  return null;
}

async function hasPastTimeValidationMessage(page: Page): Promise<boolean> {
  const panel = await getSchedulePanelLocator(page);
  const nodes = panel.locator("*");
  const count = Math.min(await nodes.count().catch(() => 0), 250);
  for (let i = 0; i < count; i += 1) {
    const node = nodes.nth(i);
    const visible = await node.isVisible().catch(() => false);
    if (!visible) continue;
    const text = (((await node.textContent().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
    if (/현재\s*시간\s*이후로\s*설정해주세요/.test(text)) {
      return true;
    }
  }
  return false;
}

async function ensureScheduleReserveRadioSelected(page: Page): Promise<boolean> {
  const panel = await getSchedulePanelLocator(page);
  const reserveRadio = panel
    .locator(
      'input[data-testid="preTimeRadioBtn"], input[name="radio_time"][value="pre"], input#radio_time2'
    )
    .first();
  const nowRadio = panel
    .locator(
      'input[data-testid="nowTimeRadioBtn"], input[name="radio_time"][value="now"], input#radio_time1'
    )
    .first();
  if (!(await reserveRadio.isVisible().catch(() => false))) {
    return false;
  }

  const readState = async (): Promise<{ reserve: boolean; now: boolean }> => {
    const reserve = await reserveRadio
      .evaluate((element) => Boolean((element as { checked?: boolean }).checked))
      .catch(() => false);
    const now = await nowRadio
      .evaluate((element) => Boolean((element as { checked?: boolean }).checked))
      .catch(() => false);
    return { reserve, now };
  };

  const forceByJs = async () => {
    await reserveRadio
      .evaluate((element) => {
        const target = element as {
          checked?: boolean;
          dispatchEvent?: (event: unknown) => void;
          ownerDocument?: {
            defaultView?: {
              Event?: new (type: string, init?: { bubbles?: boolean }) => unknown;
            };
          };
        };
        target.checked = true;
        const EventCtor = target.ownerDocument?.defaultView?.Event;
        if (EventCtor && target.dispatchEvent) {
          target.dispatchEvent(new EventCtor("click", { bubbles: true }));
          target.dispatchEvent(new EventCtor("input", { bubbles: true }));
          target.dispatchEvent(new EventCtor("change", { bubbles: true }));
        }
      })
      .catch(() => {});
    await nowRadio
      .evaluate((element) => {
        const target = element as {
          checked?: boolean;
          dispatchEvent?: (event: unknown) => void;
          ownerDocument?: {
            defaultView?: {
              Event?: new (type: string, init?: { bubbles?: boolean }) => unknown;
            };
          };
        };
        target.checked = false;
        const EventCtor = target.ownerDocument?.defaultView?.Event;
        if (EventCtor && target.dispatchEvent) {
          target.dispatchEvent(new EventCtor("input", { bubbles: true }));
          target.dispatchEvent(new EventCtor("change", { bubbles: true }));
        }
      })
      .catch(() => {});
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reserveRadio.check().catch(async () => {
      await reserveRadio.click().catch(() => {});
    });
    await page.waitForTimeout(120);
    let state = await readState();
    if (state.reserve && !state.now) {
      return true;
    }

    const reserveLabel = panel
      .locator('label[for="radio_time2"], label:has-text("예약"), .radio_label__mB6ia:has-text("예약")')
      .first();
    await reserveLabel.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(120);

    state = await readState();
    if (state.reserve && !state.now) {
      return true;
    }

    await forceByJs();
    await page.waitForTimeout(120);
    state = await readState();
    if (state.reserve && !state.now) {
      return true;
    }
  }

  return false;
}

async function ensureScheduleDateTimeFuture(
  page: Page,
  scheduledDate: Date,
  appliedTimeLabel: string | null
): Promise<{ effectiveDate: Date; appliedTimeLabel: string | null }> {
  const appliedYmd = (await readAppliedScheduleDateYmd(page)) ?? formatDateYmd(scheduledDate);
  const timeLabel = (await readAppliedScheduleTimeLabel(page)) ?? appliedTimeLabel;
  const hasPastValidation = await hasPastTimeValidationMessage(page);
  const nowYmd = formatDateYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
  const effectiveFromApplied = parseYmdToLocalDate(appliedYmd) ?? scheduledDate;

  console.log(
    `      - 예약 시각 검증: date=${appliedYmd} time=${timeLabel ?? "N/A"} now=${nowYmd} validationMessage=${
      hasPastValidation ? "Y" : "N"
    }`
  );

  if (!hasPastValidation && appliedYmd > nowYmd) {
    return { effectiveDate: effectiveFromApplied, appliedTimeLabel: timeLabel };
  }

  if (
    !hasPastValidation &&
    timeLabel &&
    isScheduleDateTimeFuture(appliedYmd, timeLabel, NAVER_SCHEDULE_TIMEZONE)
  ) {
    return { effectiveDate: effectiveFromApplied, appliedTimeLabel: timeLabel };
  }

  const fallbackDate = toNextDayAtNine(scheduledDate);
  console.log(
    `      - 예약 시간이 현재 시각보다 과거로 판정되어 날짜를 ${formatDateYmd(fallbackDate)}로 자동 조정합니다.`
  );

  let dateSet = await trySetScheduleDateInputs(page, fallbackDate);
  if (!dateSet) {
    dateSet = await trySetScheduleDateInputsFallback(page, fallbackDate);
  }
  const dateVerified = dateSet && (await verifyScheduleDateApplied(page, fallbackDate));
  if (!dateVerified) {
    throw new Error("예약 시간을 미래로 맞추기 위한 날짜 자동 조정에 실패했습니다.");
  }

  const fallbackTime = await trySetScheduleTimeInputs(page, fallbackDate);
  const fallbackYmd = (await readAppliedScheduleDateYmd(page)) ?? formatDateYmd(fallbackDate);
  const fallbackTimeLabel = (await readAppliedScheduleTimeLabel(page)) ?? fallbackTime;
  const fallbackNowYmd = formatDateYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
  if (fallbackYmd > fallbackNowYmd) {
    return {
      effectiveDate: parseYmdToLocalDate(fallbackYmd) ?? fallbackDate,
      appliedTimeLabel: fallbackTimeLabel,
    };
  }
  if (!fallbackTimeLabel || !isScheduleDateTimeFuture(fallbackYmd, fallbackTimeLabel, NAVER_SCHEDULE_TIMEZONE)) {
    throw new Error("예약 시간이 현재 시각 이후로 설정되지 않았습니다.");
  }

  return {
    effectiveDate: parseYmdToLocalDate(fallbackYmd) ?? fallbackDate,
    appliedTimeLabel: fallbackTimeLabel,
  };
}

async function configureSchedulePublish(page: Page, scheduledDate: Date): Promise<Date> {
  console.log(`   📅 예약 발행 설정: ${formatDateLog(scheduledDate)}`);

  let scheduleModeSelected = await clickFirstVisible(page, [
    'div[class*="layer_publish" i] label:has-text("예약")',
    'div[class*="layer_content_set_publish" i] label:has-text("예약")',
    'div[class*="layer_publish" i] [role="radio"]:has-text("예약")',
    'div[class*="layer_content_set_publish" i] [role="radio"]:has-text("예약")',
    'div[class*="layer_publish" i] button:has-text("예약")',
    'div[class*="layer_content_set_publish" i] button:has-text("예약")',
    '.publish_layer button:has-text("예약 발행")',
    '[role="dialog"] button:has-text("예약 발행")',
    '[role="tab"]:has-text("예약")',
    '.publish_layer button:has-text("예약")',
    '[role="dialog"] button:has-text("예약")',
    'label:has-text("예약")',
  ]);

  if (!scheduleModeSelected) {
    const reserveRadio = page
      .locator('input[type="radio"][value*="reserve" i], input[type="radio"][id*="reserve" i], input[type="radio"][name*="reserve" i]')
      .first();
    const hasReserveRadio = (await reserveRadio.count().catch(() => 0)) > 0;
    if (hasReserveRadio) {
      await reserveRadio.check().catch(async () => {
        await reserveRadio.click().catch(() => {});
      });
      scheduleModeSelected = true;
    }
  }

  if (!scheduleModeSelected) {
    throw new Error("예약 발행 옵션을 찾지 못했습니다.");
  }

  if (!(await ensureScheduleReserveRadioSelected(page))) {
    throw new Error("예약 발행 라디오 선택을 유지하지 못했습니다.");
  }

  await page.waitForTimeout(600);
  if (!(await hasVisibleScheduleDateInput(page))) {
    await clickFirstVisible(page, [
      'div[class*="layer_publish" i] label:has-text("예약")',
      'div[class*="layer_content_set_publish" i] label:has-text("예약")',
      '[role="dialog"] label:has-text("예약")',
      '.publish_layer label:has-text("예약")',
      '[role="dialog"] [role="radio"]:has-text("예약")',
      '.publish_layer [role="radio"]:has-text("예약")',
      '[role="dialog"] button:has-text("예약일")',
      '.publish_layer button:has-text("예약일")',
      '[role="dialog"] button:has-text("날짜")',
      '.publish_layer button:has-text("날짜")',
    ]);
    await page.waitForTimeout(400);
  }

  let dateVerified = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let dateSet = await trySetScheduleDateInputs(page, scheduledDate);
    if (!dateSet) {
      dateSet = await trySetScheduleDateInputsFallback(page, scheduledDate);
    }
    if (!dateSet) {
      console.log(`      - 예약 날짜 입력 재시도 ${attempt}/3 실패`);
      await page.waitForTimeout(350);
      await clickFirstVisible(page, [
        '[role="dialog"] button:has-text("예약일")',
        '.publish_layer button:has-text("예약일")',
        '[role="dialog"] button:has-text("날짜")',
        '.publish_layer button:has-text("날짜")',
      ]);
      continue;
    }

    console.log("      - 예약 날짜 입력 완료");
    dateVerified = await verifyScheduleDateApplied(page, scheduledDate);
    if (dateVerified) {
      console.log("      - 예약 날짜 검증 완료");
      break;
    }

    console.log(`      - 예약 날짜 재검증 실패 (재시도 ${attempt}/3)`);
    await page.waitForTimeout(350);
  }

  if (!dateVerified) {
    await logScheduleDialogSnapshot(page);
    throw new Error("예약 날짜가 실제로 적용되지 않았습니다. 날짜 선택 UI 확인이 필요합니다.");
  }

  const appliedTime = await trySetScheduleTimeInputs(page, scheduledDate);
  if (appliedTime) {
    console.log(`      - 예약 시간 입력 완료 (${appliedTime})`);
  }

  const ensured = await ensureScheduleDateTimeFuture(page, scheduledDate, appliedTime);
  if (ensured.appliedTimeLabel) {
    console.log(`      - 예약 시간 최종 검증 완료 (${ensured.appliedTimeLabel})`);
  }

  if (!(await ensureScheduleReserveRadioSelected(page))) {
    throw new Error("예약 발행 라디오가 해제되어 제출 조건을 만족하지 못했습니다.");
  }

  // 날짜 입력 이후 ESC를 누르면 예약 레이어 자체가 닫힐 수 있으므로 사용하지 않는다.
  return ensured.effectiveDate;
}

interface LayerNodeRef {
  className?: string | { toString?: () => string };
  getAttribute?: (name: string) => string | null;
  parentElement?: LayerNodeRef | null;
}

async function clickFinalPublishButton(page: Page, mode: PublishMode): Promise<boolean> {
  const finalPublishSelectors = [
    'div[class*="layer_publish" i] button[data-testid="seOnePublishBtn"]',
    'div[class*="layer_content_set_publish" i] button[data-testid="seOnePublishBtn"]',
    'button[data-testid="seOnePublishBtn"]',
    'div[class*="layer_publish" i] button.confirm_btn__WEaBq',
    'div[class*="layer_content_set_publish" i] button.confirm_btn__WEaBq',
    'button.confirm_btn__WEaBq',
    'button[class*="confirm_btn"]',
    'button.btn_publish__FvD4K',
    'button[class*="btn_publish"]',
    'div[class*="layer_publish" i] button:has-text("발행")',
    'div[class*="layer_content_set_publish" i] button:has-text("발행")',
    '.publish_layer button[class*="confirm"]',
    '.btn_area button:has-text("발행")',
    '[role="dialog"] button:has-text("발행")',
  ];

  for (const selector of finalPublishSelectors) {
    const btn = page.locator(selector).first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) continue;

    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }

  const publishButtons = await page.$$('button');
  const rankedCandidates: Array<{
    button: {
      click: (options?: { force?: boolean }) => Promise<void>;
    };
    score: number;
    text: string;
    className: string;
  }> = [];

  for (const btn of publishButtons) {
    const isVisible = await btn.isVisible().catch(() => false);
    if (!isVisible) continue;

    const text = ((await btn.textContent()) || "").trim();
    const className = (await btn.getAttribute("class")) || "";
    const inPublishLayer = await btn
      .evaluate((element) => {
        let node = element as unknown as LayerNodeRef | null;
        while (node) {
          const className =
            typeof node.className === "string"
              ? node.className
              : node.className?.toString?.() || "";
          const role = node.getAttribute?.("role") || "";
          if (
            /layer_publish|layer_content_set_publish|publish_layer/i.test(className) ||
            role.toLowerCase() === "dialog"
          ) {
            return true;
          }
          node = node.parentElement ?? null;
        }
        return false;
      })
      .catch(() => false);

    if (className.includes("publish_btn__")) continue; // 상단 헤더 1차 발행 버튼 제외
    if (!text) continue;

    if (mode === "schedule") {
      if (!inPublishLayer) continue;

      const compactText = text.replace(/\s+/g, "");
      const negativePattern = /(취소|닫기|도움말|가이드|이전|뒤로|임시|저장|목록|관리|내역|설정|건|cancel|close)/i;
      const hardExcludeClass =
        /(reserve_btn__|save_btn__|save_count_btn__|publish_btn__m9KHH|publish_fold_btn__)/i.test(
          className
        );
      if (
        hardExcludeClass ||
        /예약발행\d+건/.test(compactText) ||
        negativePattern.test(compactText) ||
        negativePattern.test(className)
      ) {
        continue;
      }

      const hasReserveText = compactText.includes("예약");
      const hasPublishText =
        compactText.includes("발행") ||
        compactText.includes("등록") ||
        compactText.includes("확인") ||
        compactText.includes("완료");
      const hasStrongSubmitClass = /(confirm_btn|btn_publish|confirm|publish|submit)/i.test(
        className
      );
      const hasWeakScheduleClass = /(reserve|schedule)/i.test(className);

      if (!hasPublishText) continue;
      if (!(hasReserveText || hasStrongSubmitClass)) continue;
      if (hasWeakScheduleClass && !hasStrongSubmitClass && !hasReserveText) continue;

      let score = 0;
      if (compactText.includes("예약발행")) score += 120;
      if (compactText.includes("예약등록")) score += 110;
      if (compactText.includes("예약완료")) score += 90;
      if (compactText.includes("발행")) score += 50;
      if (compactText.includes("등록")) score += 40;
      if (compactText.includes("확인")) score += 30;
      if (hasStrongSubmitClass) score += 45;
      if (/confirm_btn|btn_publish|submit/i.test(className)) score += 35;
      if (hasWeakScheduleClass) score += 10;
      if (inPublishLayer) score += 60;
      if (compactText === "예약" || compactText === "발행") score -= 20;

      rankedCandidates.push({
        button: btn,
        score,
        text,
        className,
      });
      continue;
    } else if (!text.includes("발행") || text.includes("예약")) {
      continue;
    }

    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }

  if (mode === "schedule" && rankedCandidates.length > 0) {
    rankedCandidates.sort((a, b) => b.score - a.score);
    console.log("      - 예약 최종 버튼 후보");
    for (const candidate of rankedCandidates.slice(0, 6)) {
      console.log(
        `        text="${candidate.text}" class="${candidate.className}" score=${candidate.score}`
      );
    }
    const picked = rankedCandidates[0];
    console.log(
      `      - 예약 최종 버튼 선택: text="${picked.text}" class="${picked.className}" score=${picked.score}`
    );
    await picked.button.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }

  return false;
}

// ============================================
// STEP 7: 발행 (도움말 닫기 → 발행 버튼 → 설정 → 최종 발행)
// ============================================
async function step7_publish(
  page: Page,
  options: PublishExecutionOptions = { mode: "now" }
): Promise<boolean> {
  const mode = options.mode ?? "now";
  console.log(`\n🚀 STEP 7: ${mode === "schedule" ? "예약 발행" : "즉시 발행"}`);

  // 1. 도움말/팝업/사이드바 닫기
  console.log("   도움말/팝업 닫기...");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  const closeSelectors = [
    '.help_layer button[class*="close"]',
    '.tooltip button[class*="close"]',
    '.guide_layer button[class*="close"]',
    '[class*="close_btn"]',
    '[class*="closeBtn"]',
    'button[aria-label="닫기"]',
    ".se-help-panel-close-button",
  ];

  for (const selector of closeSelectors) {
    const closeBtn = await page.$(selector);
    if (!closeBtn) continue;
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(500);

  // 2. 상단 헤더 발행 버튼
  console.log("   1차 발행 버튼 클릭...");
  await page.waitForTimeout(1000); // 팝업 닫힌 후 잠깐 대기
  
  const headerPublishBtn = await page.$('button[class*="publish_btn"], header button[class*="publish"]');
  if (headerPublishBtn) {
    await headerPublishBtn.click({ force: true }).catch(() => {});
    console.log("   ✅ 헤더 발행 버튼 클릭");
  } else {
    await page.mouse.click(1210, 22);
    console.log("   ✅ 좌표로 발행 버튼 클릭");
  }

  await page.waitForTimeout(3500); // 패널 애니메이션 대기 시간 증가

  if (mode === "schedule") {
    if (!options.scheduledDate) {
      throw new Error("예약 발행 날짜가 지정되지 않았습니다.");
    }
    try {
      const effectiveScheduleDate = await configureSchedulePublish(page, options.scheduledDate);
      options.scheduledDate = effectiveScheduleDate;
    } catch (error) {
      await captureStep7Artifacts(page, "configure-failed");
      throw error;
    }
  }

  console.log(`   2차 최종 ${mode === "schedule" ? "예약" : ""} 발행 버튼...`);
  await page.waitForTimeout(1200);

  if (mode === "schedule") {
    const reserveSelected = await ensureScheduleReserveRadioSelected(page);
    if (!reserveSelected) {
      await logScheduleDialogSnapshot(page);
      throw new Error("최종 제출 직전 예약 발행 라디오 선택 확인에 실패했습니다.");
    }
    const panel = await getSchedulePanelLocator(page);
    const reserveChecked = await panel
      .locator('input[data-testid="preTimeRadioBtn"], input[name="radio_time"][value="pre"], input#radio_time2')
      .first()
      .evaluate((element) => Boolean((element as { checked?: boolean }).checked))
      .catch(() => false);
    const nowChecked = await panel
      .locator('input[data-testid="nowTimeRadioBtn"], input[name="radio_time"][value="now"], input#radio_time1')
      .first()
      .evaluate((element) => Boolean((element as { checked?: boolean }).checked))
      .catch(() => false);
    console.log(`      - 예약 라디오 상태: reserve=${reserveChecked ? "Y" : "N"} now=${nowChecked ? "Y" : "N"}`);
  }

  const scheduleTracker =
    mode === "schedule" && options.scheduledDate
      ? createScheduleSubmissionTracker(page, formatDateYmd(options.scheduledDate))
      : null;

  try {
    const confirmed = await clickFinalPublishButton(page, mode);
    if (!confirmed) {
      if (mode === "schedule") {
        await logScheduleDialogSnapshot(page);
        await captureStep7Artifacts(page, "final-button-missing");
        throw new Error("예약 최종 발행 버튼을 찾지 못했습니다.");
      }

      console.log("   좌표 기반 최종 버튼 클릭 fallback...");
      await page.mouse.click(480, 455);
      await page.waitForTimeout(1500);
      await page.mouse.click(470, 450);
      await page.waitForTimeout(2000);
      return true;
    }

    console.log(`   🎉 최종 ${mode === "schedule" ? "예약 " : ""}발행 클릭!`);
    if (mode === "schedule" && options.scheduledDate) {
      await verifyScheduleSubmission(page, options.scheduledDate, scheduleTracker ?? undefined);
      console.log("   ✅ 예약 발행 제출 검증 완료");
    }
    await page.waitForTimeout(5000);
    return true;
  } catch (error) {
    if (mode === "schedule") {
      await captureStep7Artifacts(page, "submit-failed");
    }
    throw error;
  } finally {
    scheduleTracker?.stop();
  }
}

function isPublishedUrl(url: string): boolean {
  return url.includes("PostView") || /logNo=\d+/.test(url);
}

async function waitForPublishedUrl(page: Page, timeoutMs: number): Promise<string | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    if (isPublishedUrl(currentUrl)) {
      return currentUrl;
    }

    await page.waitForTimeout(1000);
  }

  return null;
}

interface RuntimePublishOptions {
  mode: PublishMode;
  scheduledDate: Date | null;
  scheduledDateInput: string | null;
  adjustedFromPast: boolean;
}

function parseScheduledDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const [yearText, monthText, dayText] = trimmed.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const date = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function normalizePastScheduledDate(date: Date): { date: Date; adjustedFromPast: boolean } {
  const requestedYmd = formatDateYmd(date);
  const todayYmd = formatDateYmdInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
  if (requestedYmd > todayYmd) {
    return { date, adjustedFromPast: false };
  }

  const nowParts = getDatePartsInTimeZone(new Date(), NAVER_SCHEDULE_TIMEZONE);
  const midnightUtc = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, 0, 0, 0, 0);
  const tomorrowUtc = new Date(midnightUtc + 24 * 60 * 60 * 1000);
  const tomorrow = new Date(
    tomorrowUtc.getUTCFullYear(),
    tomorrowUtc.getUTCMonth(),
    tomorrowUtc.getUTCDate(),
    9,
    0,
    0,
    0
  );
  tomorrow.setHours(9, 0, 0, 0);
  return { date: tomorrow, adjustedFromPast: true };
}

function parseRuntimePublishOptions(argv: string[]): RuntimePublishOptions {
  let mode: PublishMode = "now";
  let scheduledDateInput: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--publish-mode=")) {
      const value = arg.split("=")[1]?.trim().toLowerCase();
      mode = value === "schedule" ? "schedule" : "now";
      continue;
    }

    if (arg.startsWith("--scheduled-date=")) {
      scheduledDateInput = arg.split("=")[1]?.trim() ?? null;
    }
  }

  if (mode === "now") {
    return {
      mode,
      scheduledDate: null,
      scheduledDateInput: null,
      adjustedFromPast: false,
    };
  }

  if (!scheduledDateInput) {
    throw new Error("예약 발행 모드에는 --scheduled-date=YYYY-MM-DD 인자가 필요합니다.");
  }

  const parsed = parseScheduledDateInput(scheduledDateInput);
  if (!parsed) {
    throw new Error("예약 발행 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)");
  }

  const normalized = normalizePastScheduledDate(parsed);

  return {
    mode,
    scheduledDate: normalized.date,
    scheduledDateInput: formatDateYmd(normalized.date),
    adjustedFromPast: normalized.adjustedFromPast,
  };
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const linkId = process.argv[2];
  const runtimePublishOptions = parseRuntimePublishOptions(process.argv.slice(3));
  let currentStage = "초기화";
  const setStage = (stage: string) => {
    currentStage = stage;
    console.log(`\n🔎 현재 단계: ${stage}`);
  };
  let browser: Browser | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  
  if (!linkId) {
    console.error(
      "사용법: npx ts-node scripts/simple-agent.ts <linkId> [--publish-mode=now|schedule] [--scheduled-date=YYYY-MM-DD]"
    );
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
  console.log(`📂 게시판 번호: ${link.categoryNo || "기본"}`);
  console.log(`🧩 소제목 스타일: ${link.useSectionHeading ? "ON" : "OFF"}`);
  console.log(
    `📣 발행 모드: ${
      runtimePublishOptions.mode === "schedule"
        ? `예약 (${runtimePublishOptions.scheduledDateInput})`
        : "즉시"
    }`
  );
  if (runtimePublishOptions.adjustedFromPast && runtimePublishOptions.scheduledDateInput) {
    console.log(
      `   ⚠️ 과거 또는 당일 날짜가 입력되어 예약발행일을 ${runtimePublishOptions.scheduledDateInput}로 자동 조정했습니다.`
    );
  }
  
  try {
    timeoutHandle = setTimeout(() => {
      const timeoutMinutes = Math.round(AGENT_MAX_RUNTIME_MS / 60000);
      const timeoutMessage = `자동화 실행 시간(${timeoutMinutes}분)을 초과했습니다. 단계: ${currentStage}`;
      console.error(`\n❌ 오류: ${timeoutMessage}`);

      void (async () => {
        try {
          await prisma.brandLink.update({
            where: { id: linkId },
            data: { status: "FAILED", errorMessage: timeoutMessage },
          });
        } catch {
          // no-op
        }

        try {
          if (browser?.isConnected()) {
            await browser.close();
          }
        } catch {
          // no-op
        }

        try {
          await prisma.$disconnect();
        } catch {
          // no-op
        }

        process.exit(1);
      })();
    }, AGENT_MAX_RUNTIME_MS);

    setStage("브라우저 시작");
    // 브라우저 시작 (봇 감지 우회 설정)
    browser = await chromium.launch({
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
      timezoneId: NAVER_SCHEDULE_TIMEZONE,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 봇 감지 우회 스크립트 (문자열로 전달)
    await context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    `);
    
    let page = await context.newPage();

    setStage("STEP1 상품 정보/이미지 수집");
    // STEP 1: 상품 정보 + 이미지 수집
    const product = await step1_getProductInfo(page, link.url);
    
    console.log("\n" + "-".repeat(40));
    console.log(`📦 상품: ${product.name}`);
    console.log(`💰 가격: ${product.price}`);
    console.log(`🖼️ 이미지: ${product.imagePaths.length}개`);
    console.log("-".repeat(40));
    
    setStage("STEP2 SEO 글 생성");
    // STEP 2: SEO 최적화 글 생성
    const post = await step2_generatePost(product, link.url);

    setStage("STEP2.5 대표 썸네일 생성");
    const generatedThumbnailPath = generateTopTextCutoutThumbnail(
      product.imagePaths,
      post.title,
      product.name
    );
    product.imagePaths = Array.from(
      new Set([
        ...(generatedThumbnailPath ? [generatedThumbnailPath] : []),
        ...(product.representativeImagePath ? [product.representativeImagePath] : []),
        ...product.imagePaths,
      ])
    );
    if (generatedThumbnailPath) {
      console.log(
        `   ✅ 이미지 우선순위: [썸네일, 대표이미지, 본문이미지...] (${product.imagePaths.length}개)`
      );
    } else {
      console.log(
        `   ✅ 이미지 우선순위: [대표이미지, 본문이미지...] (${product.imagePaths.length}개)`
      );
    }

    let previewPath: string | null = null;
    if (DEBUG_SAVE_GENERATED_POST || DRY_RUN_GENERATE_ONLY) {
      previewPath = saveGeneratedPostPreview(linkId, post, product);
      console.log(`   🧾 생성 결과 저장: ${previewPath}`);
    }

    if (DRY_RUN_GENERATE_ONLY) {
      console.log("\n🧪 DRY RUN 모드로 글 생성까지만 실행하고 종료합니다.");
      await prisma.brandLink.update({
        where: { id: linkId },
        data: {
          status: "READY",
          errorMessage: previewPath
            ? `DRY RUN 완료 (생성 결과: ${previewPath})`
            : "DRY RUN 완료",
        },
      });
      return;
    }
    
    setStage("STEP3 에디터 열기");
    // STEP 3: 에디터 열기
    page = await step3_openEditor(context, page, link.categoryNo);
    
    setStage("STEP4 제목 입력");
    // STEP 4: 제목 입력
    await step4_inputTitle(page, post.title);
    
    setStage("STEP5/6 이미지+본문 입력");
    // STEP 5+6: 이미지와 본문 번갈아 입력
    await step5and6_uploadAndWrite(page, product.imagePaths, post.sections, post.hashtags, {
      useSectionHeading: link.useSectionHeading,
    });
    
    setStage(runtimePublishOptions.mode === "schedule" ? "STEP7 예약 발행" : "STEP7 즉시 발행");
    // STEP 7: 발행
    const publishOptions: PublishExecutionOptions = {
      mode: runtimePublishOptions.mode,
      scheduledDate: runtimePublishOptions.scheduledDate,
    };
    const publishTriggered = await step7_publish(page, publishOptions);
    if (!publishTriggered) {
      throw new Error("발행 버튼을 찾지 못했습니다. 네이버 에디터 UI 변경 여부를 확인하세요.");
    }

    if (runtimePublishOptions.mode === "schedule") {
      setStage("예약 발행 완료 처리");
      const scheduledDate = publishOptions.scheduledDate;
      const scheduledDateInput = scheduledDate ? formatDateYmd(scheduledDate) : runtimePublishOptions.scheduledDateInput;
      if (!scheduledDate || !scheduledDateInput) {
        throw new Error("예약 발행 날짜가 누락되었습니다.");
      }
      const scheduledDateForDb = new Date(`${scheduledDateInput}T00:00:00.000Z`);
      if (Number.isNaN(scheduledDateForDb.getTime())) {
        throw new Error("예약 발행 날짜 저장 형식이 올바르지 않습니다.");
      }

      if (
        runtimePublishOptions.scheduledDateInput &&
        scheduledDateInput !== runtimePublishOptions.scheduledDateInput
      ) {
        console.log(
          `   ⚠️ 예약 시간이 현재 시간보다 과거여서 예약발행일을 ${runtimePublishOptions.scheduledDateInput} → ${scheduledDateInput}로 조정했습니다.`
        );
      }

      console.log("\n" + "=".repeat(50));
      console.log("🗓️ 예약 발행 등록 완료!");
      console.log(`📅 예약발행일: ${scheduledDateInput} 09:00`);
      console.log(`📦 상품: ${product.name}`);
      console.log(`🖼️ 이미지: ${product.imagePaths.length}개`);
      console.log(`📝 섹션: ${post.sections.length}개`);
      console.log("=".repeat(50));

      await prisma.brandLink.update({
        where: { id: linkId },
        data: {
          status: "SCHEDULED",
          productName: product.name,
          errorMessage: null,
          publishedAt: null,
          postUrl: null,
          scheduledPublishAt: scheduledDateForDb,
        },
      });
    } else {
      setStage("즉시 발행 URL 확인");
      const publishedUrl = await waitForPublishedUrl(page, 25000);
      if (!publishedUrl) {
        throw new Error("발행 완료 URL을 확인하지 못했습니다. 수동 확인이 필요합니다.");
      }

      console.log("\n" + "=".repeat(50));
      console.log("🎉 발행 완료!");
      console.log(`📄 URL: ${publishedUrl}`);
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
          postUrl: publishedUrl,
          scheduledPublishAt: null,
        },
      });
    }
    
    // 임시 파일 정리
    for (const imgPath of product.imagePaths) {
      try { fs.unlinkSync(imgPath); } catch {}
    }
    
    // 자동 종료 (백그라운드 실행에서도 프로세스가 남지 않도록)
    await browser.close();
    
  } catch (error: unknown) {
    const message = `[${currentStage}] ${getErrorMessage(error)}`;
    console.error("\n❌ 오류:", message);
    
    await prisma.brandLink.update({
      where: { id: linkId },
      data: { status: "FAILED", errorMessage: message }
    });
  } finally {
    try {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (browser?.isConnected()) {
        await browser.close();
      }
    } catch {
      // no-op
    }
    await prisma.$disconnect();
  }
}

main();

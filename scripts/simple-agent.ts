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
import { PrismaClient } from "../src/generated/prisma";
import type { IncomingMessage } from "http";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import sharp from "sharp";
import {
  buildHumanMobileStyleGuide,
  HUMAN_MOBILE_STYLE_GUIDE,
  HUMAN_REVIEW_SAFETY_RULES,
  MOBILE_BODY_RULES,
  NAVER_SEO_TITLE_RULES,
  stripClickbaitFromTitle,
} from "./lib/blog-writing-style";
import { buildAppUrl, notifyAndLogCompletion } from "./lib/chatbot-notifier";
import {
  isCandidateProductImageUrl,
  isPreferredThumbnailImageUrl,
  isRepresentativeProductImageDimension,
  isRepresentativeTravelImageDimension,
  isReviewImageUrl,
  isSalesPageProductImageUrl,
  isTravelProductImageUrl,
  isUsableBlogProductImageDimension,
  normalizeCandidateImageUrl,
  prioritizeImageCandidates,
  prioritizeImageUrls,
  scoreProductImageCandidate,
  scoreProductImageDimensions,
  type ProductImageCandidate,
} from "./lib/product-image-selection";
import {
  buildProductThumbnailGenerationPrompt,
  generateProductThumbnail,
  buildProductThumbnailCopy,
} from "./lib/product-thumbnail";
import {
  buildLocalTravelPostJson,
  buildTravelEditorialPlan,
  extractTravelProductFacts,
  formatTravelEditorialPlanForPrompt,
  formatTravelFactsForPrompt,
  buildTravelThumbnailCopy,
} from "./lib/travel-content";
import {
  getConnectEditorInsertionMode,
  type EditorConnectKind,
} from "./lib/connect-editor-insertion";
import { generateTravelEditorialSummaryCard } from "./lib/travel-editorial-card";
import { generateThumbnail, isGenerativeThumbnailAvailable } from "./lib/thumbnail-gen";
import {
  reviseAssembledPost,
  runSpecFirstPipeline,
  type AssembledPost,
  type GeneratedDraft as SpecGeneratedDraft,
  type HeaderFormat,
  type ImageCandidateInput,
  type PostCompositionContract,
  type PostSpec,
} from "./lib/post-spec";
import {
  buildOpenCrabSeoBrief,
  formatOpenCrabSeoBriefForPrompt,
  type OpenCrabSeoBrief,
} from "./lib/opencrab-seo-brief";
import {
  getBrandLinkContentReadiness,
  type BrandLinkContentReadiness,
} from "./lib/brandlink-content-readiness";
import {
  buildProductEditorialPlan,
  formatProductEditorialPlanForPrompt,
  type ProductEditorialPlan,
} from "./lib/product-editorial-plan";
import {
  getChatgptSessionFile,
  getNaverSessionFile,
  getSessionStorageDir,
} from "./lib/app-paths";
import {
  parseProductThumbnailSettings,
  productThumbnailSettingKey,
} from "./lib/product-thumbnail-settings";
import { buildHumanizeRewritePrompt, HUMANIZE_RULES, scanAiTells } from "./lib/humanize-korean";
import { createLockedProductThumbnail, createOriginalProductPhotoThumbnail, type ShoppingThumbnailStyle } from "./lib/product-image-lock";

// Stealth 플러그인 적용 (봇 감지 우회)
chromium.use(StealthPlugin());

const prisma = new PrismaClient();

// AI Provider: OpenAI 단일 경로 (Gemini는 제거됨)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_MAX_OUTPUT_TOKENS = parseBoundedInteger(
  process.env.OPENAI_MAX_OUTPUT_TOKENS,
  8192,
  1024,
  32768
);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || "120000");
const AI_PROVIDER = "openai";

const SESSION_FILE = getNaverSessionFile();
const CHATGPT_SESSION_FILE = getChatgptSessionFile();
const TEMP_PATH = path.join(process.cwd(), "temp_images");
const NAVER_BLOG_ID = process.env.NAVER_BLOG_ID || "";
const NAVER_SCHEDULE_TIMEZONE = process.env.NAVER_SCHEDULE_TIMEZONE || "Asia/Seoul";
const NAVER_DEFAULT_SCHEDULE_HOUR = parseBoundedInteger(
  process.env.NAVER_DEFAULT_SCHEDULE_HOUR,
  9,
  0,
  23
);
const NAVER_DEFAULT_SCHEDULE_MINUTE = parseBoundedInteger(
  process.env.NAVER_DEFAULT_SCHEDULE_MINUTE,
  0,
  0,
  59
);
const NAVER_DEFAULT_SCHEDULE_TIME_LABEL = `${String(NAVER_DEFAULT_SCHEDULE_HOUR).padStart(
  2,
  "0"
)}:${String(NAVER_DEFAULT_SCHEDULE_MINUTE).padStart(2, "0")}`;
const NAVER_SCHEDULE_MIN_LEAD_MINUTES = parseBoundedInteger(
  process.env.NAVER_SCHEDULE_MIN_LEAD_MINUTES,
  120,
  0,
  1440
);
const REQUESTED_BROWSER_GPT_MODE = (process.env.BROWSER_GPT_MODE || "false").toLowerCase() === "true";
const ALLOW_CHATGPT_BROWSER_MODE =
  (process.env.ALLOW_CHATGPT_BROWSER_MODE || "false").toLowerCase() === "true";
const BROWSER_GPT_MODE = REQUESTED_BROWSER_GPT_MODE && ALLOW_CHATGPT_BROWSER_MODE;
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
const CHATGPT_USE_CUSTOM_GPTS =
  (process.env.CHATGPT_USE_CUSTOM_GPTS || "false").toLowerCase() === "true";
const CHATGPT_BASE_URL = process.env.CHATGPT_BASE_URL || "https://chatgpt.com/";
const CHATGPT_TIMEOUT_MS = Number(process.env.CHATGPT_TIMEOUT_MS || "420000");
const CHATGPT_RESPONSE_IDLE_TIMEOUT_MS = Number(
  process.env.CHATGPT_RESPONSE_IDLE_TIMEOUT_MS || String(Math.max(CHATGPT_TIMEOUT_MS, 300000))
);
const CHATGPT_RESPONSE_MAX_TIMEOUT_MS = Number(
  process.env.CHATGPT_RESPONSE_MAX_TIMEOUT_MS ||
    String(Math.max(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS * 4, 1800000))
);
const CHATGPT_DRAFT_STEP_IDLE_TIMEOUT_MS = Number(process.env.CHATGPT_DRAFT_STEP_IDLE_TIMEOUT_MS || "90000");
const CHATGPT_DRAFT_STEP_MAX_TIMEOUT_MS = Number(process.env.CHATGPT_DRAFT_STEP_MAX_TIMEOUT_MS || "240000");
const CHATGPT_HEADLESS = (process.env.CHATGPT_HEADLESS || "false").toLowerCase() === "true";
const CHATGPT_USE_PERSISTENT_PROFILE =
  (process.env.CHATGPT_USE_PERSISTENT_PROFILE || "true").toLowerCase() === "true";
const CHATGPT_RUN_ISOLATED_CONTEXT =
  (process.env.CHATGPT_RUN_ISOLATED_CONTEXT || "false").toLowerCase() === "true";
const CHATGPT_FALLBACK_TO_BASE =
  (process.env.CHATGPT_FALLBACK_TO_BASE || "false").toLowerCase() === "true";
const CHATGPT_FORCE_NEW_CHAT =
  (process.env.CHATGPT_FORCE_NEW_CHAT || "true").toLowerCase() === "true";
const CHATGPT_DIRECT_ONLY =
  !CHATGPT_USE_CUSTOM_GPTS ||
  (process.env.CHATGPT_DIRECT_ONLY || "true").toLowerCase() === "true";
const CHATGPT_SKIP_POLISH =
  !CHATGPT_USE_CUSTOM_GPTS ||
  (process.env.CHATGPT_SKIP_POLISH || "true").toLowerCase() === "true";
const CHATGPT_USE_TEMPORARY_CHAT =
  (process.env.CHATGPT_USE_TEMPORARY_CHAT || "false").toLowerCase() === "true";
const CHATGPT_GUIDED_MODE =
  (process.env.CHATGPT_GUIDED_MODE || "true").toLowerCase() === "true";
const CHATGPT_GUIDED_MAX_TURNS = Number(process.env.CHATGPT_GUIDED_MAX_TURNS || "6");
const CHATGPT_IMAGE_CONTEXT_MAX = Number(process.env.CHATGPT_IMAGE_CONTEXT_MAX || "4");
const CHATGPT_IMAGE_ATTACH_TIMEOUT_MS = Number(
  process.env.CHATGPT_IMAGE_ATTACH_TIMEOUT_MS || process.env.CHATGPT_IMAGE_WAIT_MS || "30000"
);
const CHATGPT_ATTACH_IMAGES_TO_DRAFT =
  (process.env.CHATGPT_ATTACH_IMAGES_TO_DRAFT || "true").toLowerCase() === "true";
const CHATGPT_ATTACH_IMAGES_TO_POLISH =
  (process.env.CHATGPT_ATTACH_IMAGES_TO_POLISH || "true").toLowerCase() === "true";
const CHATGPT_FORCE_MOBILE_VERSION =
  (process.env.CHATGPT_FORCE_MOBILE_VERSION || "true").toLowerCase() === "true";
const BLOG_HUMANIZE_MOBILE_STYLE =
  (process.env.BLOG_HUMANIZE_MOBILE_STYLE || "true").toLowerCase() === "true";
const HUMAN_MOBILE_POLISH_ENABLED =
  (process.env.HUMAN_MOBILE_POLISH_ENABLED || "true").toLowerCase() === "true";
// 상위 노출 글 실측 기준 태그 3~5개. 과다 태그는 키워드 남용(스팸) 신호가 된다.
const NAVER_BLOG_HASHTAG_COUNT = Math.min(
  20,
  Math.max(3, Number.parseInt(process.env.NAVER_BLOG_HASHTAG_COUNT || "5", 10) || 5)
);
// AI 티 스캔 점수가 이 값 이상이면 생성문을 한 번 더 자연스럽게 재작성한다.
const BLOG_HUMANIZE_REWRITE_ENABLED =
  (process.env.BLOG_HUMANIZE_REWRITE_ENABLED || "true").toLowerCase() === "true";
const BLOG_HUMANIZE_REWRITE_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.BLOG_HUMANIZE_REWRITE_THRESHOLD || "10", 10) || 10
);
const CHATGPT_DEFAULT_SUBTITLE_COUNT = Math.max(
  4,
  Math.min(8, Number(process.env.CHATGPT_DEFAULT_SUBTITLE_COUNT || "5"))
);
const CHATGPT_USER_DATA_DIR =
  process.env.CHATGPT_USER_DATA_DIR ||
  path.join(getSessionStorageDir(), "chatgpt-profile");

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
const DRY_RUN_GENERATE_ONLY =
  (process.env.DRY_RUN_GENERATE_ONLY || "false").toLowerCase() === "true";
const DEBUG_SAVE_GENERATED_POST =
  (process.env.DEBUG_SAVE_GENERATED_POST || "false").toLowerCase() === "true";
const GENERATED_OUTPUT_DIR = path.join(process.cwd(), "logs", "generated");
const THUMBNAIL_AUTOGEN_ENABLED =
  (process.env.THUMBNAIL_AUTOGEN_ENABLED || "true").toLowerCase() === "true";
const THUMBNAIL_SCRIPT_PATH = path.join(process.cwd(), "scripts", "generate-thumbnail.py");
const PRODUCT_THUMBNAIL_LOCAL_SCRIPT_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_LOCAL_SCRIPT_ENABLED || "true").toLowerCase() !== "false";
const PRODUCT_THUMBNAIL_CHATGPT_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_CHATGPT_ENABLED || "false").toLowerCase() === "true";
const PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE =
  (
    process.env.PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE ||
    process.env.ALLOW_CHATGPT_BROWSER_MODE ||
    "false"
  ).toLowerCase() === "true";
const PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED || "false").toLowerCase() === "true";
const PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED || "true").toLowerCase() !== "false";
const PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH =
  process.env.PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH?.trim() || "";
const PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_REQUEST_DIR =
  process.env.PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_REQUEST_DIR ||
  path.join(process.cwd(), "logs", "codex-imagegen-requests");
const PRODUCT_THUMBNAIL_CHATGPT_BASE_FALLBACK_ENABLED =
  (process.env.PRODUCT_THUMBNAIL_CHATGPT_BASE_FALLBACK_ENABLED || "false").toLowerCase() === "true";
const DEFAULT_CHATGPT_IMAGE_GPT_URL =
  "https://chatgpt.com/g/g-69044d98b1f08191b96ca4293c6c8156-jeongboseong-imiji-saengseong-v11-dapeojuneunnamja";
const PRODUCT_THUMBNAIL_IMAGE_GPT_URL =
  process.env.CHATGPT_GPT_URL_PRODUCT_THUMBNAIL ||
  process.env.CHATGPT_GPT_URL_IMAGE ||
  DEFAULT_CHATGPT_IMAGE_GPT_URL;
const PRODUCT_THUMBNAIL_IMAGE_WAIT_MS = Number(
  process.env.PRODUCT_THUMBNAIL_IMAGE_WAIT_MS || process.env.CHATGPT_IMAGE_WAIT_MS || "60000"
);
const BRANDLINK_CONTENT_READINESS_ENABLED =
  (process.env.BRANDLINK_CONTENT_READINESS_ENABLED || "true").toLowerCase() !== "false";
const BRANDLINK_REQUIRE_REPRESENTATIVE_IMAGE =
  (process.env.BRANDLINK_REQUIRE_REPRESENTATIVE_IMAGE || "true").toLowerCase() !== "false";
const PRODUCT_POST_LOCAL_FALLBACK_ENABLED =
  (process.env.PRODUCT_POST_LOCAL_FALLBACK_ENABLED || "true").toLowerCase() !== "false";
const BLOG_BODY_IMAGE_MAX = parseBoundedInteger(
  process.env.BLOG_BODY_IMAGE_MAX,
  10,
  1,
  12
);
// Spec-first 파이프라인: 이미지 플랜 → 스펙 → 구조화 생성 → 검증/타깃 수리 → 조립.
// false 로 내리면 예전 단발 생성 + 사후 보정 경로로 돌아간다.
const POST_SPEC_PIPELINE_ENABLED =
  (process.env.POST_SPEC_PIPELINE_ENABLED || "true").toLowerCase() !== "false";
// 인용구 섹션 헤더는 에디터 셀렉터 실측 전까지 기본 OFF (소제목으로 강등).
const NAVER_EDITOR_QUOTATION_ENABLED =
  (process.env.NAVER_EDITOR_QUOTATION_ENABLED || "false").toLowerCase() === "true";
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

interface GeneratedPostPreview {
  title: string;
  sections: string[];
  hashtags: string[];
  rawResponse?: string;
  openCrabSeoBrief?: OpenCrabSeoBrief | null;
  productEditorialPlan?: ProductEditorialPlan | null;
  /** Spec-first 파이프라인 산출물 (스펙·검증·에디터 입력 계약·이미지 슬롯) */
  assembled?: AssembledPost | null;
  notes?: string[];
}

interface SpecStep2Input {
  imageCandidates: ImageCandidateInput[];
  tempDir: string;
  memo?: string | null;
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
  openCrabSeoBrief?: OpenCrabSeoBrief | null;
  productEditorialPlan?: ProductEditorialPlan | null;
}

const DEFAULT_SECTION_TITLES = [
  "구매 전 확인 포인트",
  "구성 및 패키지 확인",
  "첫인상 / 디자인",
  "크기 & 스펙 정보",
  "주요 기능 ①",
  "주요 기능 ②",
  "사용 장면별 체크",
  "장점으로 보이는 부분",
  "확인하면 좋을 아쉬운 점",
  "이런 분께 잘 맞아요",
];


function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "");
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const SECTION_TITLE_MATCHER = /^(?:구매하게 된 계기|구매 전 확인 포인트|택배 도착\s*&\s*개봉기|구성 및 패키지 확인|첫인상\s*\/\s*디자인|크기\s*&\s*스펙 정보|주요 기능\s*[①1]|주요 기능\s*[②2]|실제 사용 후기|사용 장면별 체크|장점 정리|장점으로 보이는 부분|아쉬운 점|확인하면 좋을 아쉬운 점|이런 분께 추천해요|이런 분께 잘 맞아요)\s*$/i;

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
  // 낚시성 문구는 네이버가 스팸으로 명시한 항목이라 프롬프트 금지에 더해 여기서도 걸러낸다.
  const cleaned = stripClickbaitFromTitle(stripEmoji(rawTitle).replace(/\s+/g, " ").trim());
  if (cleaned.length > 0) return cleaned.slice(0, 80);
  return stripClickbaitFromTitle(stripEmoji(fallback).replace(/\s+/g, " ").trim()).slice(0, 80);
}

function collapseRepeatedLeadingTitleTokens(title: string): string {
  let tokens = stripEmoji(title).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let changed = true;

  while (changed) {
    changed = false;
    for (let size = Math.min(5, Math.floor(tokens.length / 2)); size >= 1; size -= 1) {
      const first = tokens.slice(0, size).join(" ").toLowerCase();
      const second = tokens.slice(size, size * 2).join(" ").toLowerCase();
      if (first && first === second) {
        tokens = [...tokens.slice(0, size), ...tokens.slice(size * 2)];
        changed = true;
        break;
      }
    }
  }

  return tokens.join(" ");
}

function compactProductNameForTitle(productName: string): string {
  const tokens = stripEmoji(productName)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const compact = tokens.slice(0, Math.min(tokens.length, 7)).join(" ");
  return compact || "상품";
}

function buildLocalProductTitle(
  product: ProductInfo,
  openCrabSeoBrief?: OpenCrabSeoBrief | null
): string {
  const reliableOpenCrabTitle =
    openCrabSeoBrief &&
    openCrabSeoBrief.confidence >= 0.55 &&
    openCrabSeoBrief.matchType !== "category" &&
    openCrabSeoBrief.titleCandidates[0];

  const rawTitle = reliableOpenCrabTitle || `${compactProductNameForTitle(product.name)} 구매 전 체크`;
  return sanitizeTitle(collapseRepeatedLeadingTitleTokens(rawTitle), product.name);
}

type ProductThumbnailSource = "image-api" | "chatgpt" | "codex-imagegen" | "local-script" | "composite" | "saved-studio" | "locked-product";

interface GeneratedProductThumbnail {
  path: string;
  source: ProductThumbnailSource;
}

interface ThumbnailScriptResult {
  ok?: boolean;
  output?: string;
  used_cutout?: boolean;
  cutout_source?: string | null;
  error?: string;
}

function parseThumbnailScriptResult(stdout: string): ThumbnailScriptResult | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line) as ThumbnailScriptResult;
    } catch {
      continue;
    }
  }

  return null;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitThumbnailTextLines(text: string, maxChars: number, maxLines: number): string[] {
  const normalized = sanitizeText(text);
  if (!normalized) return [];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
    } else if (!current && word.length > maxChars) {
      lines.push(word.slice(0, maxChars));
      current = word.slice(maxChars);
    } else {
      current = next;
    }

    while (current.length > maxChars && lines.length < maxLines) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }

    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function renderThumbnailSvgText(
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  extraAttributes = ""
): string {
  return lines
    .map((line, index) => {
      const currentY = y + index * lineHeight;
      return `<text x="${x}" y="${currentY}" ${extraAttributes} font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#ffffff" stroke="#0f172a" stroke-width="3" paint-order="stroke">${escapeSvgText(line)}</text>`;
    })
    .join("\n");
}

function buildCompactThumbnailOverlaySvg(promptInfo: ReturnType<typeof buildProductThumbnailGenerationPrompt>): string {
  // 피드 썸네일은 실제로 200~300px로 축소돼 보인다. 예전 오버레이(제품명 30px,
  // 헤드라인 20px)는 그 크기에서 읽히지 않아, 하단 밴드에 큰 글자로 다시 그린다.
  const productLines = splitThumbnailTextLines(promptInfo.productNameLabel, 14, 2);
  const headlineLines = splitThumbnailTextLines(promptInfo.headline || "구매 전 확인", 8, 1);
  const sublineLines = splitThumbnailTextLines(promptInfo.subline || "장단점 체크", 16, 1);
  const productFontSize = productLines.length >= 2 ? 58 : 66;
  const productLineHeight = productLines.length >= 2 ? 70 : 78;
  const bandHeight = productLines.length >= 2 ? 436 : 366;
  const bandTop = 1080 - bandHeight;
  const headlineY = bandTop + 130;
  const productY = headlineY + 94;
  const sublineY = productY + (productLines.length - 1) * productLineHeight + 76;

  return `
<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bottomBand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0"/>
      <stop offset="26%" stop-color="#0f172a" stop-opacity="0.74"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="0" y="${bandTop}" width="1080" height="${bandHeight}" fill="url(#bottomBand)"/>
  <rect x="48" y="48" width="232" height="72" rx="36" fill="#e11d2e" filter="url(#softShadow)"/>
  <text x="164" y="97" text-anchor="middle" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="38" font-weight="900" fill="#ffffff">구매 체크</text>
  <text x="60" y="${headlineY}" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="92" font-weight="950" fill="#fde047" stroke="#0f172a" stroke-width="5" paint-order="stroke">${escapeSvgText(
    headlineLines[0] || "구매 전 확인"
  )}</text>
  ${renderThumbnailSvgText(productLines, 60, productY, productFontSize, productLineHeight)}
  <text x="60" y="${sublineY}" font-family="Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK KR, Arial, sans-serif" font-size="42" font-weight="800" fill="#e2e8f0">${escapeSvgText(
    sublineLines[0] || "장단점 체크"
  )}</text>
</svg>`;
}

async function generateProductThumbnailWithSharpLocal(
  product: ProductInfo,
  promptInfo: ReturnType<typeof buildProductThumbnailGenerationPrompt>
): Promise<string | null> {
  if (!PRODUCT_THUMBNAIL_LOCAL_SCRIPT_ENABLED) return null;

  const candidatePaths = Array.from(
    new Set(
      [product.representativeImagePath, ...product.imagePaths].filter(
        (imagePath): imagePath is string => typeof imagePath === "string" && fs.existsSync(imagePath)
      )
    )
  );
  const sourcePath = await selectBestLocalThumbnailSourcePath(candidatePaths);
  if (!sourcePath) return null;

  const outputPath = path.join(
    TEMP_PATH,
    `product_thumbnail_local_${Date.now()}_${sanitizeFileNameForPath(promptInfo.productNameLabel)}.jpg`
  );
  const overlaySvg = buildCompactThumbnailOverlaySvg(promptInfo);

  try {
    await sharp(sourcePath)
      .rotate()
      .resize(1080, 1080, {
        fit: "contain",
        background: { r: 248, g: 250, b: 252, alpha: 1 },
      })
      .composite([{ input: Buffer.from(overlaySvg), left: 0, top: 0 }])
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(outputPath);

    console.log(`   🖼️ 로컬 Sharp 대표 썸네일 생성 완료: ${path.basename(outputPath)}`);
    console.log(`   🖼️ 썸네일 원본: ${path.basename(sourcePath)}`);
    console.log(`   📝 썸네일 문구: ${promptInfo.productNameLabel} / ${promptInfo.headline} / ${promptInfo.subline}`);
    return outputPath;
  } catch (error) {
    console.log(`   ⚠️ 로컬 Sharp 썸네일 생성 실패: ${getErrorMessage(error)}`);
    return null;
  }
}

async function selectBestLocalThumbnailSourcePath(imagePaths: string[]): Promise<string | null> {
  const scored = (
    await Promise.all(
      imagePaths.map(async (imagePath, index) => {
        try {
          const metadata = await sharp(imagePath).metadata();
          const width = metadata.width ?? 0;
          const height = metadata.height ?? 0;
          if (width < 360 || height < 360) return null;
          const ratio = width / height;
          const basename = path.basename(imagePath);
          const lowerBasename = basename.toLowerCase();
          const stats = fs.statSync(imagePath);
          let score = 0;
          if (isRepresentativeProductImageDimension(width, height)) score += 320;
          if (isUsableBlogProductImageDimension(width, height)) score += 140;
          if (lowerBasename.includes("_detail_crop_")) score -= 1600;
          if (/^stored_product_/i.test(basename)) score += 90;
          if (/shipping|delivery|review|banner|event|coupon|benefit|notice|guide|detail|desc|option|spec|size/i.test(lowerBasename)) {
            score -= 360;
          }
          score += Math.min(110, stats.size / 1200);
          score += Math.min(180, (width * height) / 5000);
          score += Math.max(0, 30 - index * 3);
          if (ratio < 0.65 || ratio > 1.6) score -= 320;
          return { imagePath, score };
        } catch {
          return null;
        }
      })
    )
  ).filter((item): item is { imagePath: string; score: number } => Boolean(item));

  return scored.sort((a, b) => b.score - a.score)[0]?.imagePath || null;
}

async function isUsableBodyUploadImage(imagePath: string): Promise<boolean> {
  if (!fs.existsSync(imagePath)) return false;

  const basename = path.basename(imagePath).toLowerCase();
  // 세로 상세 이미지에서 잘라낸 _detail_crop_ 파일은 본문 이미지 후보로 허용한다.
  // (이전에는 여기서 무조건 탈락시켜 가장 높은 점수를 받은 이미지가 항상 버려졌다.)
  if (/banner|event|coupon|benefit|delivery|shipping|review|notice|guide/.test(basename)) {
    return false;
  }

  try {
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 500 || height < 500) return false;
    const ratio = width / height;
    if (ratio < 0.72 || ratio > 1.55) return false;
    if (!isUsableBlogProductImageDimension(width, height)) return false;
    return true;
  } catch {
    return false;
  }
}

async function buildBlogUploadImagePaths(input: {
  imagePaths: string[];
  generatedThumbnailPath: string | null;
  representativeImagePath: string | null;
  editorialImagePath?: string | null;
}): Promise<string[]> {
  const output: string[] = [];
  const seen = new Set<string>();
  const addPath = (imagePath: string | null | undefined) => {
    if (!imagePath || !fs.existsSync(imagePath)) return;
    const resolved = path.resolve(imagePath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    output.push(imagePath);
  };

  addPath(input.generatedThumbnailPath);

  const bodyCandidates: string[] = [];
  for (const imagePath of input.imagePaths) {
    if (!imagePath) continue;
    if (
      input.generatedThumbnailPath &&
      path.resolve(imagePath) === path.resolve(input.generatedThumbnailPath)
    ) {
      continue;
    }
    if (!(await isUsableBodyUploadImage(imagePath))) continue;
    const resolved = path.resolve(imagePath);
    if (bodyCandidates.some((candidate) => path.resolve(candidate) === resolved)) continue;
    bodyCandidates.push(imagePath);
  }

  const preferredBody: string[] = [];
  if (input.editorialImagePath && (await isUsableBodyUploadImage(input.editorialImagePath))) {
    preferredBody.push(input.editorialImagePath);
  }
  if (
    input.representativeImagePath &&
    (await isUsableBodyUploadImage(input.representativeImagePath))
  ) {
    preferredBody.push(input.representativeImagePath);
  }
  for (const imagePath of bodyCandidates) {
    if (preferredBody.length >= BLOG_BODY_IMAGE_MAX) break;
    if (preferredBody.some((candidate) => path.resolve(candidate) === path.resolve(imagePath))) {
      continue;
    }
    preferredBody.push(imagePath);
  }

  for (const imagePath of preferredBody.slice(0, BLOG_BODY_IMAGE_MAX)) {
    addPath(imagePath);
  }

  return output;
}

function generateProductThumbnailWithLocalScript(
  product: ProductInfo,
  promptInfo: ReturnType<typeof buildProductThumbnailGenerationPrompt>
): string | null {
  if (!PRODUCT_THUMBNAIL_LOCAL_SCRIPT_ENABLED) return null;
  if (!fs.existsSync(THUMBNAIL_SCRIPT_PATH)) {
    console.log(`   ⚠️ 로컬 썸네일 스크립트가 없어 건너뜁니다: ${THUMBNAIL_SCRIPT_PATH}`);
    return null;
  }

  const imagePaths = Array.from(
    new Set(
      [product.representativeImagePath, ...product.imagePaths].filter(
        (imagePath): imagePath is string => typeof imagePath === "string" && fs.existsSync(imagePath)
      )
    )
  );

  if (imagePaths.length === 0) return null;

  const outputPath = path.join(
    TEMP_PATH,
    `product_thumbnail_local_${Date.now()}_${sanitizeFileNameForPath(promptInfo.productNameLabel)}.jpg`
  );
  const scriptArgs = [
    THUMBNAIL_SCRIPT_PATH,
    "--background",
    imagePaths[0],
    "--headline",
    promptInfo.headline,
    "--subline",
    promptInfo.subline,
    "--output",
    outputPath,
  ];

  for (const imagePath of imagePaths.slice(0, 8)) {
    scriptArgs.push("--image", imagePath);
  }

  const candidates =
    process.platform === "win32"
      ? [
          { command: "python", args: scriptArgs },
          { command: "py", args: ["-3", ...scriptArgs] },
          { command: "python3", args: scriptArgs },
        ]
      : [
          { command: "python3", args: scriptArgs },
          { command: "python", args: scriptArgs },
        ];

  let lastError = "";
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });

    if (result.error) {
      lastError = result.error.message;
      continue;
    }

    if (result.status !== 0) {
      lastError = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
      continue;
    }

    const parsed = parseThumbnailScriptResult(result.stdout);
    if (parsed && parsed.ok === false) {
      lastError = parsed.error || "로컬 썸네일 스크립트 오류";
      continue;
    }

    const resolvedOutputPath = parsed?.output && fs.existsSync(parsed.output) ? parsed.output : outputPath;
    if (!fs.existsSync(resolvedOutputPath)) {
      lastError = "로컬 썸네일 결과 파일을 찾지 못했습니다.";
      continue;
    }

    const cutoutLabel =
      parsed?.used_cutout && parsed.cutout_source ? ` / 소스: ${path.basename(parsed.cutout_source)}` : "";
    console.log(
      `   🖼️ 로컬 대표 썸네일 생성 완료: ${path.basename(resolvedOutputPath)}${cutoutLabel}`
    );
    console.log(`   📝 썸네일 문구: ${promptInfo.headline} / ${promptInfo.subline}`);
    return resolvedOutputPath;
  }

  console.log(`   ⚠️ 로컬 썸네일 생성 실패: ${lastError || "실행 가능한 Python을 찾지 못했습니다."}`);
  return null;
}

async function generateTopTextCutoutThumbnail(
  product: ProductInfo,
  postTitle: string,
  brandLinkId?: string,
  contentKind: "SHOPPING" | "TRAVEL" = "SHOPPING",
): Promise<GeneratedProductThumbnail | null> {
  if (!THUMBNAIL_AUTOGEN_ENABLED) return null;
  const savedSetting = brandLinkId
    ? parseProductThumbnailSettings(
        (await prisma.setting.findUnique({
          where: { key: productThumbnailSettingKey(brandLinkId) },
          select: { value: true },
        }))?.value,
      )
    : null;
  if (savedSetting?.generatedPath && fs.existsSync(savedSetting.generatedPath)) {
    console.log(`   ✅ 저장된 썸네일 폼 결과 사용: ${path.basename(savedSetting.generatedPath)}`);
    return { path: savedSetting.generatedPath, source: "saved-studio" };
  }
  if (!product.representativeImagePath || !fs.existsSync(product.representativeImagePath)) {
    console.log("   ⚠️ 판매페이지 대표 이미지가 없어 썸네일 생성을 건너뜁니다.");
    return null;
  }
  // 1순위: gpt-image 가 문구까지 한 번에 그리고 OpenAI 비전 QC(95점)로 검수한다.
  // 최대 시도 안에 통과하지 못하면 아래 로컬 합성으로 강등한다(오탈자 썸네일 방지).
  if (isGenerativeThumbnailAvailable()) {
    const generativeCopy =
      savedSetting?.copy ??
      (contentKind === "TRAVEL"
        ? buildTravelThumbnailCopy(product.name)
        : buildProductThumbnailCopy(postTitle, product.name, "SHOPPING"));
    const generated = await generateThumbnail({
      kind: contentKind,
      productName: product.name,
      categoryName: inferCategoryKeyword(product.name),
      description: product.description,
      features: product.features,
      price: product.price,
      copy: generativeCopy,
      moodId: savedSetting?.style || undefined,
      referenceImagePath: product.representativeImagePath,
      outputDir: TEMP_PATH,
      onLog: (line) => console.log(`   🎨 ${line}`),
    }).catch((error) => {
      console.log(`   ⚠️ gpt-image 썸네일 생성 오류: ${getErrorMessage(error)}`);
      return null;
    });
    if (generated) {
      console.log(
        `   ✅ gpt-image 썸네일 사용: ${path.basename(generated.path)} (QC ${generated.qc.checked ? `${generated.qc.score}점` : "생략"}, ${generated.attempts}회 시도)`
      );
      return { path: generated.path, source: "image-api" };
    }
    console.log("   ⚠️ gpt-image 썸네일이 QC 를 통과하지 못해 로컬 합성으로 강등합니다.");
  } else {
    console.log("   ℹ️ OPENAI_API_KEY 가 없어 생성형 썸네일을 건너뛰고 로컬 합성을 사용합니다.");
  }

  if (contentKind === "SHOPPING") {
    const suggestedCopy = buildProductThumbnailGenerationPrompt({
      postTitle,
      productName: product.name,
      categoryName: inferCategoryKeyword(product.name),
      description: product.description,
      features: product.features,
      price: product.price,
    });
    try {
      const locked = await createLockedProductThumbnail({
        sourcePath: product.representativeImagePath,
        outputDir: TEMP_PATH,
        productName: savedSetting?.copy.productNameLabel || suggestedCopy.productNameLabel,
        headline: savedSetting?.copy.headline || suggestedCopy.headline,
        subline: savedSetting?.copy.subline || suggestedCopy.subline,
        style: (savedSetting?.style || "shopping-clean") as ShoppingThumbnailStyle,
      });
      console.log(`   🔒 상품 원본 잠금 썸네일: ${path.basename(locked.outputPath)}`);
      console.log(`   🔒 원본 SHA-256: ${locked.lock.sourceSha256}`);
      return { path: locked.outputPath, source: "locked-product" };
    } catch (error) {
      console.log(`   🔒 상품 분리 중단: ${getErrorMessage(error)}`);
      const original = await createOriginalProductPhotoThumbnail({
        sourcePath: product.representativeImagePath,
        outputDir: TEMP_PATH,
        productName: savedSetting?.copy.productNameLabel || suggestedCopy.productNameLabel,
        headline: savedSetting?.copy.headline || suggestedCopy.headline,
        subline: savedSetting?.copy.subline || suggestedCopy.subline,
        style: (savedSetting?.style || "shopping-clean") as ShoppingThumbnailStyle,
      }).catch(() => null);
      if (original) {
        console.log("   ✅ 상품 분리 대신 상세페이지 원본 사진을 변형 없이 카드에 배치합니다.");
        return { path: original.outputPath, source: "locked-product" };
      }
      console.log("   ✅ 생성형 변형 없이 원본 상세페이지 이미지를 그대로 사용합니다.");
      return null;
    }
  }
  if (savedSetting) {
    const regenerated = await generateProductThumbnail({
      imagePaths: [product.representativeImagePath, ...product.imagePaths],
      preferredImagePath: product.representativeImagePath,
      postTitle,
      productName: product.name,
      outputDir: TEMP_PATH,
      copy: savedSetting.copy,
      contentKind,
      enabled: true,
    }).catch(() => null);
    if (regenerated?.outputPath && fs.existsSync(regenerated.outputPath)) {
      console.log(`   ✅ 저장된 썸네일 카피로 재생성: ${path.basename(regenerated.outputPath)}`);
      return { path: regenerated.outputPath, source: "saved-studio" };
    }
  }

  if (contentKind === "TRAVEL") {
    const travelThumbnail = await generateProductThumbnail({
      imagePaths: [product.representativeImagePath, ...product.imagePaths],
      preferredImagePath: product.representativeImagePath,
      postTitle,
      productName: product.name,
      outputDir: TEMP_PATH,
      contentKind: "TRAVEL",
      enabled: true,
    }).catch(() => null);
    if (travelThumbnail?.outputPath && fs.existsSync(travelThumbnail.outputPath)) {
      console.log(`   ✅ 실제 여행사진 + 투명 PNG 장식 합성: ${path.basename(travelThumbnail.outputPath)}`);
      return { path: travelThumbnail.outputPath, source: "local-script" };
    }
  }

  const promptInfo = buildProductThumbnailGenerationPrompt({
    postTitle,
    productName: product.name,
    categoryName: inferCategoryKeyword(product.name),
    description: product.description,
    features: product.features,
    price: product.price,
  });


  const localSharpPath = await generateProductThumbnailWithSharpLocal(product, promptInfo);
  if (localSharpPath) {
    return { path: localSharpPath, source: "local-script" };
  }

  const localScriptPath = generateProductThumbnailWithLocalScript(product, promptInfo);
  if (localScriptPath) {
    return { path: localScriptPath, source: "local-script" };
  }

  if (PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH) {
    const codexImagegenPath = generateProductThumbnailWithCodexImagegenFallback(
      promptInfo.prompt,
      product.representativeImagePath,
      promptInfo.productNameLabel
    );
    if (codexImagegenPath) {
      console.log(`   ✅ Codex imagegen 썸네일 사용: ${path.basename(codexImagegenPath)}`);
      return { path: codexImagegenPath, source: "codex-imagegen" };
    }
  }

  const generatedPath = await generateProductThumbnailWithChatGPT(
    promptInfo.prompt,
    product.representativeImagePath,
    promptInfo.productNameLabel
  );

  if (generatedPath) {
    console.log(
      `   🖼️ MD 기반 생성형 썸네일 완료 (제품명 라벨: ${promptInfo.productNameLabel})`
    );
    console.log(`   🖼️ 제품 레퍼런스: ${path.basename(product.representativeImagePath)}`);
    console.log(`   📝 썸네일 문구: ${promptInfo.headline} / ${promptInfo.subline} / ${promptInfo.cta}`);
    return { path: generatedPath, source: "chatgpt" };
  }

  const codexImagegenPath = generateProductThumbnailWithCodexImagegenFallback(
    promptInfo.prompt,
    product.representativeImagePath,
    promptInfo.productNameLabel
  );
  if (codexImagegenPath) {
    console.log(`   OK Codex imagegen thumbnail selected: ${path.basename(codexImagegenPath)}`);
    return { path: codexImagegenPath, source: "codex-imagegen" };
  }

  if (!PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED) {
    console.log("   ⚠️ 생성형 썸네일 실패. MD 지침상 후합성 fallback은 기본 비활성화되어 건너뜁니다.");
    return null;
  }

  console.log("   ⚠️ 생성형 썸네일 실패. 명시적 fallback 설정에 따라 후합성 썸네일을 생성합니다.");
  const compositePath = await generateCompositeThumbnailFallback(product, postTitle, contentKind);
  return compositePath ? { path: compositePath, source: "composite" } : null;
}

async function generateCompositeThumbnailFallback(
  product: ProductInfo,
  postTitle: string,
  contentKind: "SHOPPING" | "TRAVEL" = "SHOPPING",
): Promise<string | null> {
  if (!product.representativeImagePath || !fs.existsSync(product.representativeImagePath)) return null;
  const thumbnailSourcePaths = Array.from(
    new Set(
      [product.representativeImagePath, ...product.imagePaths].filter(
        (imagePath): imagePath is string => Boolean(imagePath) && fs.existsSync(imagePath)
      )
    )
  );

  try {
    const result = await generateProductThumbnail({
      imagePaths: thumbnailSourcePaths,
      postTitle,
      productName: product.name,
      outputDir: TEMP_PATH,
      contentKind,
      enabled: true,
    });

    if (!result || !fs.existsSync(result.outputPath)) return null;
    console.log(`   🖼️ 후합성 fallback 썸네일: ${path.basename(result.outputPath)}`);
    return result.outputPath;
  } catch (error) {
    console.log(`   ⚠️ 후합성 fallback 실패: ${getErrorMessage(error)}`);
    return null;
  }
}

function generateProductThumbnailWithCodexImagegenFallback(
  prompt: string,
  referenceImagePath: string,
  productNameLabel: string
): string | null {
  if (!PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED) return null;

  if (PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH) {
    const resolved = path.resolve(PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH);
    if (!fs.existsSync(resolved)) {
      console.log(`   Warning: Codex imagegen thumbnail path not found: ${resolved}`);
      return null;
    }

    const ext = path.extname(resolved) || ".png";
    const finalPath = path.join(
      TEMP_PATH,
      `product_thumbnail_codex_imagegen_${Date.now()}_${sanitizeFileNameForPath(productNameLabel)}${ext}`
    );
    fs.copyFileSync(resolved, finalPath);
    return finalPath;
  }

  fs.mkdirSync(PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_REQUEST_DIR, { recursive: true });
  const requestedOutputPath = path.join(
    TEMP_PATH,
    `product_thumbnail_codex_imagegen_${Date.now()}_${sanitizeFileNameForPath(productNameLabel)}.png`
  );
  const requestPath = path.join(
    PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_REQUEST_DIR,
    `product_thumbnail_codex_imagegen_request_${Date.now()}_${sanitizeFileNameForPath(productNameLabel)}.md`
  );

  const requestBody = [
    "# Codex Imagegen Product Thumbnail Request",
    "",
    `Product name: ${productNameLabel}`,
    `Reference image: ${referenceImagePath}`,
    `Desired output path: ${requestedOutputPath}`,
    "",
    "Use Codex built-in imagegen. Use the reference product image as the strict product reference.",
    "After generation, copy the selected image to the desired output path and rerun with:",
    "",
    "```powershell",
    `$env:PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH="${requestedOutputPath}"`,
    "```",
    "",
    "Prompt:",
    "",
    "```text",
    prompt,
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(requestPath, requestBody, "utf8");
  console.log(`   Codex imagegen request saved: ${requestPath}`);
  return null;
}

async function generateProductThumbnailWithChatGPT(
  prompt: string,
  referenceImagePath: string,
  productNameLabel: string
): Promise<string | null> {
  if (!PRODUCT_THUMBNAIL_CHATGPT_ENABLED || !PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE) {
    console.log("   ⚠️ 생성형 썸네일: ChatGPT 이미지 생성이 비활성화되어 있습니다.");
    return null;
  }

  const hasSessionFile = fs.existsSync(CHATGPT_SESSION_FILE);
  const hasPersistentProfile =
    fs.existsSync(CHATGPT_USER_DATA_DIR) &&
    fs.readdirSync(CHATGPT_USER_DATA_DIR).length > 0;

  if (!hasSessionFile && !hasPersistentProfile) {
    console.log("   ⚠️ 생성형 썸네일: ChatGPT 브라우저 자동화는 설치형 앱에서 사용하지 않습니다. OpenAI API 키 기반 생성형 썸네일을 사용하세요.");
    return null;
  }

  let contextHandle: ChatGPTContextHandle | null = null;
  try {
    contextHandle = await createChatGPTContext(hasSessionFile);
    const page = await contextHandle.context.newPage();

    const targetUrls = [PRODUCT_THUMBNAIL_IMAGE_GPT_URL];
    if (
      PRODUCT_THUMBNAIL_CHATGPT_BASE_FALLBACK_ENABLED &&
      isCustomGptUrl(PRODUCT_THUMBNAIL_IMAGE_GPT_URL) &&
      !targetUrls.includes(CHATGPT_BASE_URL)
    ) {
      targetUrls.push(CHATGPT_BASE_URL);
    }

    for (let index = 0; index < targetUrls.length; index += 1) {
      const targetUrl = targetUrls[index];
      const label = index === 0 ? "Product Thumbnail" : "Product Thumbnail Base Fallback";
      const generatedPath = await attemptProductThumbnailChatGPTGeneration(
        page,
        prompt,
        referenceImagePath,
        productNameLabel,
        targetUrl,
        label
      );
      if (generatedPath) return generatedPath;
      if (index < targetUrls.length - 1) {
        console.log("   Warning: Product Thumbnail custom GPT failed; retrying with base ChatGPT.");
      } else if (
        isCustomGptUrl(PRODUCT_THUMBNAIL_IMAGE_GPT_URL) &&
        !PRODUCT_THUMBNAIL_CHATGPT_BASE_FALLBACK_ENABLED
      ) {
        console.log("   Warning: Product Thumbnail base ChatGPT fallback disabled; skipping browser retry.");
      }
    }

    return null;

    await openChatGPTTarget(page, PRODUCT_THUMBNAIL_IMAGE_GPT_URL, "Product Thumbnail");
    await continueChatGPTAccountPicker(page, "Product Thumbnail");
    if (!isCustomGptUrl(PRODUCT_THUMBNAIL_IMAGE_GPT_URL)) {
      await startNewChatIfAvailable(page);
      await ensureChatGPTReady(page, Math.min(CHATGPT_TIMEOUT_MS, 120000));
    }

    await continueChatGPTAccountPicker(page, "Product Thumbnail");
    const attached = await attachImagesToChatGPT(page, [referenceImagePath], "Thumbnail reference");
    if (attached === 0) {
      console.log("   ⚠️ 생성형 썸네일: 제품 레퍼런스 이미지 첨부 실패");
      await saveProductThumbnailDebugScreenshot(page, "attach-failed");
      return null;
    }

    await page.waitForTimeout(3000);
    const beforeSources = await collectRenderableChatGPTImageSources(page);
    console.log(`      - 생성 전 이미지 기준점: ${beforeSources.size}개`);
    await submitProductThumbnailImagePrompt(page, prompt);
    await maybeConfirmProductThumbnailGeneration(page, beforeSources);
    const imageCount = await waitForProductThumbnailImageArtifacts(
      page,
      beforeSources,
      PRODUCT_THUMBNAIL_IMAGE_WAIT_MS
    );

    if (imageCount === 0) {
      const latestAssistantMessage = normalizeText((await readAssistantMessages(page)).at(-1) || "");
      if (latestAssistantMessage) {
        console.log(`   ⚠️ 생성형 썸네일 마지막 응답: ${latestAssistantMessage.slice(0, 240)}`);
      }
      console.log("   ⚠️ 생성형 썸네일: 새 이미지 산출물을 찾지 못했습니다.");
      await saveProductThumbnailDebugScreenshot(page, "no-image-artifact");
      return null;
    }

    const outDir = path.join(TEMP_PATH, `product-thumbnail-${Date.now()}`);
    const downloadedPaths = await downloadProductThumbnailImages(page, outDir, beforeSources);
    const firstImagePath = downloadedPaths.find((value) => value && fs.existsSync(value)) || "";
    if (!firstImagePath) {
      console.log("   ⚠️ 생성형 썸네일: 생성 이미지 다운로드 실패");
      await saveProductThumbnailDebugScreenshot(page, "download-failed");
      return null;
    }

    const finalPath = path.join(
      TEMP_PATH,
      `product_thumbnail_generated_${Date.now()}_${sanitizeFileNameForPath(productNameLabel)}${path.extname(firstImagePath) || ".png"}`
    );
    fs.copyFileSync(firstImagePath, finalPath);
    return finalPath;
  } catch (error) {
    console.log(`   ⚠️ 생성형 썸네일 실패: ${getErrorMessage(error)}`);
    return null;
  } finally {
    if (contextHandle) {
      await contextHandle.close().catch(() => {});
    }
  }
}

async function attemptProductThumbnailChatGPTGeneration(
  page: Page,
  prompt: string,
  referenceImagePath: string,
  productNameLabel: string,
  targetUrl: string,
  label: string
): Promise<string | null> {
  await openChatGPTTarget(page, targetUrl, label);
  await continueChatGPTAccountPicker(page, label);
  if (!isCustomGptUrl(targetUrl)) {
    await startNewChatIfAvailable(page);
    await ensureChatGPTReady(page, Math.min(CHATGPT_TIMEOUT_MS, 120000));
  }

  await continueChatGPTAccountPicker(page, label);
  const attached = await attachImagesToChatGPT(page, [referenceImagePath], `${label} reference`);
  if (attached === 0) {
    console.log(`   Warning: ${label} reference image attach failed.`);
    await saveProductThumbnailDebugScreenshot(page, `${label}-attach-failed`);
    return null;
  }

  await page.waitForTimeout(3000);
  const beforeSources = await collectRenderableChatGPTImageSources(page);
  console.log(`      - ${label} pre-existing image baseline: ${beforeSources.size}`);
  await submitProductThumbnailImagePrompt(page, prompt);
  await maybeConfirmProductThumbnailGeneration(page, beforeSources);
  const imageCount = await waitForProductThumbnailImageArtifacts(
    page,
    beforeSources,
    PRODUCT_THUMBNAIL_IMAGE_WAIT_MS
  );

  if (imageCount === 0) {
    const latestAssistantMessage = normalizeText((await readAssistantMessages(page)).at(-1) || "");
    if (latestAssistantMessage) {
      console.log(`   Warning: ${label} latest response: ${latestAssistantMessage.slice(0, 240)}`);
    }
    console.log(`   Warning: ${label} did not produce a new image artifact.`);
    await saveProductThumbnailDebugScreenshot(page, `${label}-no-image-artifact`);
    return null;
  }

  const outDir = path.join(TEMP_PATH, `product-thumbnail-${Date.now()}`);
  const downloadedPaths = await downloadProductThumbnailImages(page, outDir, beforeSources);
  const firstImagePath = downloadedPaths.find((value) => value && fs.existsSync(value)) || "";
  if (!firstImagePath) {
    console.log(`   Warning: ${label} image download failed.`);
    await saveProductThumbnailDebugScreenshot(page, `${label}-download-failed`);
    return null;
  }

  const finalPath = path.join(
    TEMP_PATH,
    `product_thumbnail_generated_${Date.now()}_${sanitizeFileNameForPath(productNameLabel)}${path.extname(firstImagePath) || ".png"}`
  );
  fs.copyFileSync(firstImagePath, finalPath);
  return finalPath;
}

function sanitizeFileNameForPath(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "thumbnail"
  );
}

async function collectRenderableChatGPTImageSources(page: Page): Promise<Set<string>> {
  const sources = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll("img"))
        .map((img) => {
          const rect = img.getBoundingClientRect();
          const style = window.getComputedStyle(img);
          const src = img.currentSrc || img.src || "";
          return {
            src,
            width: rect.width,
            height: rect.height,
            visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
          };
        })
        .filter(
          (item) =>
            item.src &&
            item.visible &&
            (item.src.startsWith("http") || item.src.startsWith("data:image/")) &&
            item.width >= 180 &&
            item.height >= 180
        )
        .map((item) => item.src)
    )
    .catch(() => [] as string[]);

  return new Set(sources);
}

async function countNewRenderableChatGPTImages(page: Page, beforeSources: Set<string>): Promise<number> {
  const currentSources = await collectRenderableChatGPTImageSources(page);
  return Array.from(currentSources).filter((src) => !beforeSources.has(src)).length;
}

async function saveProductThumbnailDebugScreenshot(page: Page, reason: string): Promise<void> {
  try {
    const logsDir = path.join(process.cwd(), "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const filePath = path.join(
      logsDir,
      `debug_product_thumbnail_${sanitizeFileNameForPath(reason)}_${Date.now()}.png`
    );
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`      - Product Thumbnail debug screenshot: ${filePath}`);
  } catch {
    // Debug capture is best-effort only.
  }
}

function buildChatGPTPromptProbe(prompt: string): string {
  return normalizeText(prompt).replace(/\s+/g, " ").trim().slice(0, 120);
}

async function readChatGPTComposerText(
  page: Page,
  composerSelector: string,
  composerLocator?: Locator
): Promise<string> {
  const composer = composerLocator ?? page.locator(composerSelector).first();
  if (composerSelector.startsWith("textarea")) {
    return composer.inputValue().catch(() => "");
  }

  return composer.evaluate((element) => element.textContent || "").catch(() => "");
}

async function chatGPTComposerContainsPrompt(
  page: Page,
  composerSelector: string,
  prompt: string,
  composerLocator?: Locator
): Promise<boolean> {
  const probe = buildChatGPTPromptProbe(prompt);
  if (!probe) return false;

  const composerText = normalizeText(await readChatGPTComposerText(page, composerSelector, composerLocator))
    .replace(/\s+/g, " ")
    .trim();
  return composerText.includes(probe.slice(0, Math.min(80, probe.length)));
}

async function countChatGPTConversationTurns(page: Page): Promise<number> {
  return page.locator('article[data-testid^="conversation-turn-"]').count().catch(() => 0);
}

async function clickChatGPTSendControl(page: Page, composer: Locator): Promise<void> {
  const sendButtonSelector = await findVisibleSelector(page, CHATGPT_SEND_BUTTON_SELECTORS);
  if (sendButtonSelector) {
    const sendButton = page.locator(sendButtonSelector).first();
    const disabled = await sendButton.isDisabled().catch(() => false);
    if (!disabled) {
      await sendButton.click({ force: true, timeout: 5000 });
      return;
    }
  }

  const clicked = await page
    .evaluate(() => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((button) => {
        if (!visible(button) || button.disabled) return false;
        const evidence = [
          button.getAttribute("aria-label") || "",
          button.getAttribute("data-testid") || "",
          button.textContent || "",
        ]
          .join(" ")
          .toLowerCase();

        return (
          evidence.includes("send") ||
          evidence.includes("submit") ||
          evidence.includes("composer-send") ||
          evidence.includes("\ubcf4\ub0b4\uae30") ||
          evidence.includes("\uc804\uc1a1")
        );
      });

      if (!target) return false;
      target.click();
      return true;
    })
    .catch(() => false);

  if (!clicked) {
    await composer.press("Enter").catch(() => {});
  }
}

async function clickChatGPTRetryIfVisible(page: Page, label = "ChatGPT"): Promise<boolean> {
  const retryButtons = [
    page.getByRole("button", { name: /try again|retry/i }).first(),
    page.getByRole("button", { name: /\ub2e4\uc2dc \uc2dc\ub3c4/i }).first(),
    page.locator('button:has-text("Try again")').first(),
    page.locator('button:has-text("Retry")').first(),
    page.locator('button:has-text("\ub2e4\uc2dc \uc2dc\ub3c4")').first(),
  ];

  for (const button of retryButtons) {
    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;
    console.log(`      - [${label}] ChatGPT retry button detected; clicking.`);
    await button.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return true;
  }

  return false;
}

async function waitForProductThumbnailPromptSubmission(
  page: Page,
  previousMessages: string[],
  composerSelector: string,
  composerLocator: Locator,
  prompt: string,
  previousTurnCount: number,
  timeoutMs: number
): Promise<"generating" | "new-turn" | "composer-cleared" | "new-message" | null> {
  const previousCount = previousMessages.length;
  const baselineLastText = previousMessages[previousMessages.length - 1] ?? "";
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await assertNoChatGPTProtection(page);
    if (await continueChatGPTAccountPicker(page, "Product Thumbnail prompt submission")) {
      continue;
    }

    if (await isChatGPTGenerating(page)) {
      return "generating";
    }

    if ((await countChatGPTConversationTurns(page)) > previousTurnCount) {
      return "new-turn";
    }

    const composerText = (await readChatGPTComposerText(page, composerSelector, composerLocator)).trim();
    if (!composerText) {
      return "composer-cleared";
    }

    const messages = await readAssistantMessages(page);
    const latestText = messages[messages.length - 1] ?? "";
    const hasAdvancedReply =
      messages.length > previousCount ||
      (messages.length > 0 && latestText.length > 0 && latestText !== baselineLastText);
    if (hasAdvancedReply && !(await chatGPTComposerContainsPrompt(page, composerSelector, prompt, composerLocator))) {
      return "new-message";
    }

    await page.waitForTimeout(300);
  }

  return null;
}

async function waitForVisibleChatGPTComposer(
  page: Page,
  timeoutMs: number
): Promise<{ selector: string; locator: Locator }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await assertNoChatGPTProtection(page);
    await dismissTemporaryChatOnboarding(page);
    if (await continueChatGPTAccountPicker(page, "ChatGPT composer")) {
      continue;
    }

    for (const selector of CHATGPT_COMPOSER_SELECTORS) {
      const locators = page.locator(selector);
      const count = Math.min(await locators.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const locator = locators.nth(index);
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          return { selector, locator };
        }
      }
    }

    if (await isChatGPTLoginRequired(page)) {
      throw new Error("ChatGPT login is required. Run npm run login:chatgpt and try again.");
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("ChatGPT composer was not found.");
}

async function submitProductThumbnailImagePrompt(page: Page, prompt: string): Promise<void> {
  const label = "Product Thumbnail 이미지 생성";
  await assertNoChatGPTProtection(page, label);
  await dismissTemporaryChatOnboarding(page);
  await continueChatGPTAccountPicker(page, label);
  await waitForChatGPTGenerationIdle(page, 60_000, label);

  const previousMessages = await readAssistantMessages(page);
  const previousTurnCount = await countChatGPTConversationTurns(page);
  const composerTarget = await waitForVisibleChatGPTComposer(page, CHATGPT_TIMEOUT_MS);
  const composerSelector = composerTarget.selector;
  const composer = composerTarget.locator;

  await closeBlockingChatGPTModals(page);
  await composer.click();
  await page.waitForTimeout(400);
  await pasteChatGPTPrompt(page, composer, composerSelector, prompt);
  if (!(await chatGPTComposerContainsPrompt(page, composerSelector, prompt, composer))) {
    await pasteChatGPTPrompt(page, composer, composerSelector, prompt);
  }
  if (!(await chatGPTComposerContainsPrompt(page, composerSelector, prompt, composer))) {
    await saveProductThumbnailDebugScreenshot(page, "prompt-paste-failed");
    throw new Error("Product Thumbnail prompt paste failed.");
  }
  await page.waitForTimeout(800);
  await waitForChatGPTSendReady(page, 90_000);

  await clickChatGPTSendControl(page, composer);

  await page.waitForTimeout(2000);
  let submitted = await waitForProductThumbnailPromptSubmission(
    page,
    previousMessages,
    composerSelector,
    composer,
    prompt,
    previousTurnCount,
    20_000
  );
  if (!submitted) {
    await clickChatGPTSendControl(page, composer);
    await page.waitForTimeout(2000);
    submitted = await waitForProductThumbnailPromptSubmission(
      page,
      previousMessages,
      composerSelector,
      composer,
      prompt,
      previousTurnCount,
      20_000
    );
  }
  if (!submitted) {
    await saveProductThumbnailDebugScreenshot(page, "prompt-send-failed");
    throw new Error("Product Thumbnail 이미지 생성 요청 전송을 확인하지 못했습니다.");
  }
}

async function maybeConfirmProductThumbnailGeneration(
  page: Page,
  beforeSources: Set<string>
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await countNewRenderableChatGPTImages(page, beforeSources)) > 0) return;

    const latestAssistantMessage = ((await readAssistantMessages(page)).at(-1) || "").replace(/\s+/g, "");
    const pageBodyText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, "");
    const confirmationText = latestAssistantMessage || pageBodyText;

    if (/생성계획|미리보기|진행할까요|생성할까요|시작할까요|원하시면|만들까요/i.test(confirmationText)) {
      await submitProductThumbnailImagePrompt(
        page,
        "네. 첨부한 제품 이미지를 기준으로 ProductThumbnail.md 지침 그대로, 후합성 없이 완성형 썸네일 이미지를 바로 생성해줘."
      );
      return;
    }

    await page.waitForTimeout(1500);
  }
}

async function waitForProductThumbnailImageArtifacts(
  page: Page,
  beforeSources: Set<string>,
  timeoutMs: number
): Promise<number> {
  let waitedMs = 0;
  let previousImageCount = 0;
  let stableCycles = 0;
  let interactionRecoveryAttempts = 0;
  const maxInteractionRecoveryAttempts = 3;

  while (waitedMs < timeoutMs) {
    await assertNoChatGPTProtection(page, "Product Thumbnail 이미지 생성");
    const continuedAccount = await continueChatGPTAccountPicker(page, "Product Thumbnail image wait");
    const retried = await clickChatGPTRetryIfVisible(page, "Product Thumbnail image wait");
    if (continuedAccount || retried) {
      interactionRecoveryAttempts += 1;
      if (interactionRecoveryAttempts > maxInteractionRecoveryAttempts) {
        console.log("      - Product Thumbnail interaction recovery limit reached.");
        break;
      }
      previousImageCount = 0;
      stableCycles = 0;
      await page.waitForTimeout(3000);
      waitedMs += 3000;
      continue;
    }
    const imageCount = await countNewRenderableChatGPTImages(page, beforeSources);
    const generating = await isChatGPTGenerating(page);

    if (!generating && imageCount > 0) {
      if (imageCount === previousImageCount) {
        stableCycles += 1;
      } else {
        previousImageCount = imageCount;
        stableCycles = 1;
      }

      if (waitedMs >= 12000 && stableCycles >= 2) {
        return imageCount;
      }
    } else {
      previousImageCount = imageCount;
      stableCycles = 0;
    }

    if (waitedMs > 0 && waitedMs % 15000 === 0) {
      console.log(`      - 생성형 썸네일 대기 중... (${Math.round(waitedMs / 1000)}초)`);
    }

    await page.waitForTimeout(3000);
    waitedMs += 3000;
  }

  return Math.max(previousImageCount, 0);
}

async function downloadProductThumbnailImages(
  page: Page,
  downloadDir: string,
  beforeSources: Set<string>
): Promise<string[]> {
  const beforeSourceList = Array.from(beforeSources);
  const imagesData = await page
    .evaluate(async (before) => {
      const beforeSet = new Set(before);
      const allImages = Array.from(document.querySelectorAll("img"));
      const candidates = allImages
        .map((img) => {
          const rect = img.getBoundingClientRect();
          const src = img.currentSrc || img.src || "";
          return {
            src,
            width: Math.max(rect.width, img.naturalWidth || 0),
            height: Math.max(rect.height, img.naturalHeight || 0),
            visible: rect.width >= 180 && rect.height >= 180,
          };
        })
        .filter(
          (item) =>
            item.visible &&
            item.src &&
            !beforeSet.has(item.src) &&
            (item.src.startsWith("http") || item.src.startsWith("data:image/")) &&
            item.width >= 300 &&
            item.height >= 300
        )
        .sort((a, b) => b.width * b.height - a.width * a.height);

      const unique = [];
      const seen = new Set();
      for (const item of candidates) {
        if (seen.has(item.src)) continue;
        seen.add(item.src);
        unique.push(item);
      }

      const results = [];
      for (const item of unique) {
        const src = item.src;
        if (src.startsWith("data:image/")) {
          results.push(src);
          continue;
        }
        try {
          const response = await fetch(src);
          const blob = await response.blob();
          const base64data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ""));
            reader.readAsDataURL(blob);
          });
          if (base64data.startsWith("data:image/")) {
            results.push(base64data);
          }
        } catch {
          // Ignore individual download failures inside the browser context.
        }
      }
      return results;
    }, beforeSourceList)
    .catch(() => [] as string[]);

  console.log(`      - 생성 이미지 base64 다운로드 후보: ${imagesData.length}개`);
  fs.mkdirSync(downloadDir, { recursive: true });

  const savedPaths: string[] = [];
  for (let i = 0; i < imagesData.length; i += 1) {
    const [meta, base64] = imagesData[i].split(",");
    if (!base64) continue;
    const ext = /image\/jpe?g/i.test(meta) ? "jpg" : /image\/webp/i.test(meta) ? "webp" : "png";
    const filePath = path.join(downloadDir, `product_thumbnail_${Date.now()}_${i}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    savedPaths.push(filePath);
  }

  if (savedPaths.length > 0) return savedPaths;

  return screenshotProductThumbnailImages(page, downloadDir, beforeSources);
}

async function screenshotProductThumbnailImages(
  page: Page,
  downloadDir: string,
  beforeSources: Set<string>
): Promise<string[]> {
  fs.mkdirSync(downloadDir, { recursive: true });
  const imageLocators = page.locator("img");
  const count = await imageLocators.count().catch(() => 0);
  const candidates: Array<{ index: number; area: number }> = [];

  for (let index = 0; index < count; index += 1) {
    const img = imageLocators.nth(index);
    const info = await img
      .evaluate((element) => {
        const image = element as HTMLImageElement;
        const rect = image.getBoundingClientRect();
        const src = image.currentSrc || image.src || "";
        const style = window.getComputedStyle(image);
        return {
          src,
          width: Math.max(rect.width, image.naturalWidth || 0),
          height: Math.max(rect.height, image.naturalHeight || 0),
          visible:
            rect.width >= 180 &&
            rect.height >= 180 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
        };
      })
      .catch(() => null);

    if (!info?.visible || !info.src || beforeSources.has(info.src)) continue;
    candidates.push({ index, area: info.width * info.height });
  }

  candidates.sort((a, b) => b.area - a.area);
  console.log(`      - 생성 이미지 스크린샷 후보: ${candidates.length}개`);
  const savedPaths: string[] = [];
  for (const candidate of candidates.slice(0, 3)) {
    const img = imageLocators.nth(candidate.index);
    const filePath = path.join(downloadDir, `product_thumbnail_screenshot_${Date.now()}_${candidate.index}.png`);
    try {
      await img.screenshot({ path: filePath });
      if (fs.existsSync(filePath)) {
        savedPaths.push(filePath);
      }
    } catch {
      // Try the next candidate.
    }
  }

  return savedPaths;
}

async function runOpenAiApi(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 비어 있어 OpenAI API로 글을 생성할 수 없습니다.");
  }

  // 출력 토큰 상한을 명시하고, 상한에 걸려 잘린 응답(finish_reason=length)은
  // 조용히 파싱 폴백으로 흘리지 않고 한 번 더 간결하게 재요청한다.
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    try {
      const system =
        attempt === 0
          ? systemPrompt
          : `${systemPrompt}\n\n[출력 길이 주의] 직전 응답이 출력 한도에서 잘렸습니다. 섹션 수와 구조는 유지하되 각 섹션을 더 간결하게 써서 JSON을 반드시 완결하세요.`;
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.75,
          max_completion_tokens: OPENAI_MAX_OUTPUT_TOKENS,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`OpenAI API 호출 실패 (${response.status}): ${detail.slice(0, 400)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string | null;
        }>;
      };
      const choice = payload.choices?.[0];
      const output = choice?.message?.content?.trim();
      if (!output) {
        throw new Error("OpenAI API 응답에서 본문을 찾지 못했습니다.");
      }
      if (choice?.finish_reason === "length") {
        lastError = new Error(
          `OpenAI API 응답이 출력 토큰 상한(${OPENAI_MAX_OUTPUT_TOKENS})에서 잘렸습니다.`
        );
        console.log(`   ⚠️ ${lastError.message}${attempt === 0 ? " 간결하게 재요청합니다." : ""}`);
        continue;
      }

      return output;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("OpenAI API 응답이 잘렸습니다.");
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
  'button[data-testid="composer-send-button"]',
  'button[aria-label*="Send prompt"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="Submit"]',
  'button[aria-label*="\ubcf4\ub0b4\uae30"]',
  'button[aria-label*="\uc804\uc1a1"]',
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

const CHATGPT_MANUAL_VERIFICATION_MESSAGE =
  "ChatGPT manual verification required. A human-verification or security-check page is visible. Complete it in the browser, then run the job again.";

const CHATGPT_PROTECTION_TEXT_PATTERNS = [
  "checking your browser",
  "checking if the site connection is secure",
  "please stand by",
  "verify you are human",
  "needs to review the security of your connection",
  "cf-challenge",
  "cloudflare",
  "turnstile",
  "unusual activity",
  "access denied",
  "\uc0ac\ub78c\uc778\uc9c0 \ud655\uc778",
  "\uc2e4\uc81c \uc0ac\uc6a9\uc790\uc778\uc9c0 \ud655\uc778",
  "\uc0ac\uc6a9\uc790\uac00 \uc0ac\ub78c\uc778\uc9c0 \ud655\uc778",
  "\uc0ac\ub78c\uc784\uc744 \ud655\uc778",
  "\ub85c\ubd07\uc774 \uc544\ub2d8",
  "\ubcf4\uc548 \ud655\uc778",
  "\ubcf4\uc548 \uac80\uc99d",
  "\ube0c\ub77c\uc6b0\uc800\ub97c \ud655\uc778",
  "\uc811\uadfc\uc774 \ucc28\ub2e8",
  "\ube44\uc815\uc0c1\uc801\uc778 \ud65c\ub3d9",
];

const CHATGPT_PROTECTION_FRAME_PATTERNS = [
  "cdn-cgi/challenge-platform",
  "challenge",
  "captcha",
  "turnstile",
  "cloudflare",
  "cf-chl",
  "hcaptcha",
  "recaptcha",
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
  const removeButtonCount = await page.getByLabel(/파일 제거|remove file|remove attachment/i).count().catch(() => 0);
  const previewCount = await page
    .evaluate(() => {
      const selectors = [
        '[data-testid*="attachment" i]',
        '[data-testid*="file-preview" i]',
        '[data-testid*="upload-preview" i]',
        '[class*="attachment" i]',
        '[class*="file-preview" i]',
        'img[src^="blob:"]',
        'img[alt*="uploaded" i]',
        'img[alt*="첨부" i]',
        'img[alt*="업로드" i]',
      ];
      const nodes = new Set<Element>();
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach((node) => nodes.add(node));
        } catch {
          // Ignore selectors unsupported by the current browser.
        }
      }

      return Array.from(nodes).filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width >= 24 &&
          rect.height >= 24 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      }).length;
    })
    .catch(() => 0);

  return Math.max(removeButtonCount, previewCount);
}

async function waitForChatGPTSendReady(page: Page, timeoutMs = 120000): Promise<void> {
  await assertNoChatGPTProtection(page);
  await continueChatGPTAccountPicker(page, "ChatGPT send ready");
  const sendSelector =
    (await findVisibleSelector(page, CHATGPT_SEND_BUTTON_SELECTORS)) ||
    (await findExistingSelector(page, CHATGPT_SEND_BUTTON_SELECTORS));

  if (!sendSelector) return;

  const sendButton = page.locator(sendSelector).first();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await assertNoChatGPTProtection(page);
    await continueChatGPTAccountPicker(page, "ChatGPT send ready");
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
    await continueChatGPTAccountPicker(page, label);

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

    while (Date.now() - startedAt < CHATGPT_IMAGE_ATTACH_TIMEOUT_MS) {
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
      console.log(`      - ${label} 이미지 첨부 확인 UI 미검출, setInputFiles 성공 기준으로 진행합니다.`);
      return selectedPaths.length;
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
  if (/꼬리뼈|치질|자세교정|방석|쿠션|의자/.test(name)) return "자세교정 방석";
  if (/보냉백|쿨러백|아이스박스|소프트쿨러/.test(name)) return "보냉백";
  if (/드라이기|헤어드라이어/.test(name)) return "헤어 드라이기";
  if (/선풍기|서큘레이터/.test(name)) return "선풍기";
  if (/키보드|마우스|트랙패드|이어팟|아이폰|아이패드|맥북/.test(name)) return "디지털 기기";
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
  if (context.openCrabSeoBrief?.recommendedSectionTitles.length) {
    return context.openCrabSeoBrief.recommendedSectionTitles.slice(
      0,
      Math.max(4, Math.min(10, sectionCount))
    );
  }

  const baseTopics = [
    `${context.productName} 구매 전 확인할 기준`,
    "상품 이미지 기준 첫인상, 디자인, 크기 체크",
    "핵심 기능과 사용 장면별 확인 포인트",
    "상세 정보 기준 장점과 아쉬운 점 정리",
    "추천 대상과 구매 전 체크 팁",
    "가격대와 할인/쿠폰 확인 포인트",
    "유지관리와 관리 팁",
    "비슷한 제품과 비교했을 때 차이점",
  ];

  return baseTopics.slice(0, Math.max(4, Math.min(8, sectionCount)));
}

function buildDraftContentPayload(
  context: ChatGPTGuidanceContext,
  sectionCount: number
): string {
  const topics = buildDraftChapterTopics(context, sectionCount);
  const openCrabBriefText = formatOpenCrabSeoBriefForPrompt(context.openCrabSeoBrief ?? null);
  const editorialPlanText = context.productEditorialPlan
    ? formatProductEditorialPlanForPrompt(context.productEditorialPlan)
    : "";

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
    `- 쇼핑커넥트 삽입용 링크(본문 URL 직접 기재 금지): ${context.brandLink}`,
    `- 상품 설명: ${context.description || "(설명 없음)"}`,
    `- 핵심 특징: ${context.features.length > 0 ? context.features.join(", ") : "(특징 없음)"}`,
    `- 가격: ${context.price || "(가격 미확인)"}`,
    `- 원가: ${context.originalPrice || "(원가 미확인)"}`,
    `- 할인율: ${context.discountRate || "(할인율 미확인)"}`,
    `- 쿠폰/혜택: ${context.couponInfo || "(없음)"}`,
    `- 배송: ${context.deliveryInfo || "(정보 없음)"}`,
    `- 리뷰수: ${context.reviewCount || "(미확인)"}`,
    `- 평점: ${context.rating || "(미확인)"}`,
    openCrabBriefText ? "\n[내부 SEO 참고자료]\n" + openCrabBriefText : "",
    editorialPlanText ? "\n" + editorialPlanText : "",
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
  const normalized = bodyText.replace(/\s+/g, " ").toLowerCase();
  if (CHATGPT_PROTECTION_TEXT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
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
  const protectionIssue =
    (await detectChatGPTManualVerification(page)) ??
    (await detectChatGPTProtectionIssue(page));
  if (!protectionIssue) return;

  throw new Error(`${label}: ${protectionIssue} Current URL: ${page.url()}`);
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

    await assertNoChatGPTProtection(page);
    if (await continueChatGPTAccountPicker(page, "ChatGPT ready")) {
      loginSeenRounds = 0;
      continue;
    }

    const protectionIssue = await detectChatGPTManualVerification(page);
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
  await continueChatGPTAccountPicker(page, label);
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
    await assertNoChatGPTProtection(page);
    await dismissTemporaryChatOnboarding(page);
    if (await continueChatGPTAccountPicker(page, "ChatGPT composer")) {
      continue;
    }
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
    await assertNoChatGPTProtection(page, label);
    if (await continueChatGPTAccountPicker(page, label)) {
      continue;
    }

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
    await assertNoChatGPTProtection(page, label);
    if (await continueChatGPTAccountPicker(page, label)) {
      idleRounds = 0;
      continue;
    }

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
    await assertNoChatGPTProtection(page);
    if (await continueChatGPTAccountPicker(page, "ChatGPT prompt submission")) {
      continue;
    }

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

  await assertNoChatGPTProtection(page, label);
  await dismissTemporaryChatOnboarding(page);
  await continueChatGPTAccountPicker(page, label);
  await waitForChatGPTGenerationIdle(page, 60_000, label);
  
  // 프롬프트 입력 전에 약간 대기 (UI 반응형)
  await page.waitForTimeout(1000);
  
  const previousMessages = await readAssistantMessages(page);
  const composerSelector = await waitForChatGPTComposer(page, CHATGPT_TIMEOUT_MS);
  const composer = page.locator(composerSelector).first();

  await assertNoChatGPTProtection(page, label);
  await closeBlockingChatGPTModals(page);
  await composer.click();
  await page.waitForTimeout(500);
  await pasteChatGPTPrompt(page, composer, composerSelector, prompt);

  // 입력 완료 후 잠시 대기
  await page.waitForTimeout(1000);

  await waitForChatGPTSendReady(page, sendReadyTimeoutMs);
  await assertNoChatGPTProtection(page, label);
  
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
    `쇼핑커넥트 삽입용 링크(본문 URL 직접 기재 금지): ${context.brandLink}`,
    `희망 섹션 수: ${context.targetSectionCount}`,
  ];
  const openCrabBriefText = formatOpenCrabSeoBriefForPrompt(context.openCrabSeoBrief ?? null);
  if (openCrabBriefText) {
    details.push("", openCrabBriefText);
  }
  if (context.productEditorialPlan) {
    details.push("", formatProductEditorialPlanForPrompt(context.productEditorialPlan));
  }

  return details.join("\n");
}

function buildDirectBrowserGptPrompt(
  systemPrompt: string,
  userPrompt: string,
  context: ChatGPTGuidanceContext,
  minSections: number
): string {
  const sectionCount = Math.max(minSections, Math.min(8, context.targetSectionCount));

  return [
    "아래 정보를 바탕으로 네이버 블로그 발행용 최종 글을 바로 작성해주세요.",
    "중요: 추가 질문, 확인 질문, 설명 문장 없이 JSON만 출력하세요.",
    "- 출력 키: title, sections, hashtags",
    `- sections는 최소 ${sectionCount}개`,
    "- sections 각 항목은 '소제목\\n\\n본문' 형태",
    "- 제목과 소제목에는 이모지 금지",
    "- 모바일 가독성을 위해 짧은 문장과 자연스러운 줄바꿈 사용",
    "- 과장/허위 체험 표현 금지",
    "- 구매 URL은 sections에 직접 쓰지 말고, 시스템이 쇼핑커넥트 컴포넌트로 별도 삽입합니다.",
    BLOG_HUMANIZE_MOBILE_STYLE ? buildHumanMobileStyleGuide() : "",
    "- 코드블록 금지",
    "",
    "[상품/발행 정보]",
    buildGuidanceSummary(context),
    "",
    "[시스템 지시사항]",
    systemPrompt,
    "",
    "[사용자 요청]",
    userPrompt,
  ].join("\n");
}

async function runDirectChatGPTGeneration(
  page: Page,
  systemPrompt: string,
  userPrompt: string,
  context: ChatGPTGuidanceContext,
  minSections: number,
  label = "Direct"
): Promise<string> {
  const prompt = buildDirectBrowserGptPrompt(systemPrompt, userPrompt, context, minSections);
  let reply = await sendPromptToChatGPT(page, prompt, {
    label: `${label} 최종`,
    idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 180_000),
    maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 420_000),
  });

  if (getStructuredSectionCount(parseJsonObjectFromText(reply)) >= minSections) {
    return reply;
  }

  console.log(`      - ${label} 구조화 섹션 부족, 1회 보완 요청을 진행합니다.`);
  reply = await sendPromptToChatGPT(page, [
    "방금 답변을 유지하되 JSON만 다시 출력해주세요.",
    "- 키: title, sections, hashtags",
    `- sections는 최소 ${minSections}개`,
    "- 코드블록 금지",
  ].join("\n"), {
    label: `${label} 보완`,
    idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, 120_000),
    maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, 300_000),
  });

  return reply;
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
    lines.push("- 톤/말투: 부드러운 ~요체, 모바일 블로그처럼 짧고 자연스럽게");
    lines.push("- AI 티가 나는 반복 표현, 과한 광고 문장, 허위 체험 단정 금지");
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
    lines.push(`- 쇼핑커넥트 삽입용 링크(본문 URL 직접 기재 금지): ${context.brandLink}`);
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
        idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, CHATGPT_DRAFT_STEP_IDLE_TIMEOUT_MS),
        maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, CHATGPT_DRAFT_STEP_MAX_TIMEOUT_MS),
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
  const toneResponse =
    "4번 경험 공유 말투로 진행하되, 휴대폰으로 직접 쓰는 블로그처럼 문장을 짧고 부드럽게 다듬어주세요. AI 티가 나는 반복 표현과 과한 광고 문장은 빼주세요.";
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
          `쇼핑커넥트 삽입용 링크(본문 URL 직접 기재 금지): ${guidanceContext.brandLink}`,
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
      idleTimeoutMs: Math.min(CHATGPT_RESPONSE_IDLE_TIMEOUT_MS, CHATGPT_DRAFT_STEP_IDLE_TIMEOUT_MS),
      maxTimeoutMs: Math.min(CHATGPT_RESPONSE_MAX_TIMEOUT_MS, CHATGPT_DRAFT_STEP_MAX_TIMEOUT_MS),
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
    "- 말투는 부드러운 경험공유형 유지",
    "- 문장은 25-45자 안팎으로 짧게 끊고 1-2문장마다 줄바꿈",
    "- AI가 쓴 글처럼 보이는 표현, 반복 어미, 과장 광고 문장 제거",
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

    const draftMinSections = Math.min(6, Math.max(3, guidanceContext.targetSectionCount - 2));
    let firstDraft: string;

    if (CHATGPT_DIRECT_ONLY) {
      console.log("      - Direct only 모드: 기본 ChatGPT 단일 프롬프트로 생성합니다.");
      await openChatGPTTarget(page, CHATGPT_BASE_URL, "Direct");
      await startNewChatIfAvailable(page);
      await ensureChatGPTReady(page, Math.min(CHATGPT_TIMEOUT_MS, 120000));
      firstDraft = await runDirectChatGPTGeneration(
        page,
        systemPrompt,
        userPrompt,
        guidanceContext,
        draftMinSections,
        "Direct"
      );
    } else {
      try {
      await openChatGPTTarget(page, CHATGPT_DRAFT_GPT_URL, "Draft");
      firstDraft = await runDraftGptConversation(
        page,
        systemPrompt,
        userPrompt,
        guidanceContext,
        imagePaths,
        draftMinSections
      );
      } catch (error) {
        console.log(`      - Draft GPT 다단계 흐름 실패: ${getErrorMessage(error)}`);
        console.log("      - 기본 ChatGPT 단일 프롬프트 폴백을 시도합니다.");
        await openChatGPTTarget(page, CHATGPT_BASE_URL, "Direct fallback");
        await startNewChatIfAvailable(page);
        await ensureChatGPTReady(page, Math.min(CHATGPT_TIMEOUT_MS, 120000));
        firstDraft = await runDirectChatGPTGeneration(
          page,
          systemPrompt,
          userPrompt,
          guidanceContext,
          draftMinSections,
          "Direct fallback"
        );
      }
    }

    if (CHATGPT_SKIP_POLISH) {
      console.log("      - Polish 생략 모드: 초안 결과로 바로 진행합니다.");
      return firstDraft;
    }

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
      "- 말투는 부드러운 경험공유형 그대로 유지",
      "- AI 티가 나는 표현과 과한 광고 문장을 자연스럽게 덜어내기",
      "- 직접 겪었다는 근거 없는 단정 표현은 상황형 표현으로 바꾸기",
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
        "- 휴대폰으로 읽기 좋은 짧은 문장과 자연스러운 줄바꿈 유지",
        "- AI처럼 보이는 표현, 같은 어미 반복, 과장 문장 제거",
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
  const plainTitle = stripSectionPrefix(title) || "구매 전 확인 포인트";
  const priceText = product.price || "가격 정보";

  return [
    title,
    "",
    `${product.name} 기준으로 ${plainTitle}를 먼저 정리해봤어요.`,
    `판매페이지 정보와 상품 이미지를 함께 보면 선택 기준이 더 분명해져요.`,
    `${priceText} 기준으로 옵션과 구성을 같이 비교해보면 좋아요.`,
    `구매 전에는 배송, 쿠폰, 후기 조건까지 한 번 더 확인하는 편이 안전해요.`,
    "",
  ].join("\n");
}

function uniqueLocalProductLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines
    .map((line) => normalizeText(line))
    .filter((line) => {
      if (!line) return false;
      const key = line.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildLocalProductSection(title: string, product: ProductInfo, extraLines: string[] = []): string {
  const categoryKeyword = inferCategoryKeyword(product.name);
  const sectionLines = buildLocalProductLinesForTitle(title, product, categoryKeyword);
  const lines = uniqueLocalProductLines(
    sectionLines.length >= 4 ? sectionLines : [...extraLines, ...sectionLines]
  ).slice(0, 4);
  return `${title}\n\n${lines.join("\n")}\n`;
}

function normalizeSectionTitleKey(title: string): string {
  return stripSectionPrefix(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isPublishableSectionTitle(title: string): boolean {
  const normalized = normalizeText(stripSectionPrefix(title));
  if (!normalized || normalized.length > 45) return false;
  return !/(?:작성\s*(?:규칙|지침|가이드|프로세스)|프롬프트|출력\s*형식|json|브리프|리서치\s*팩|워크플로우|opencrab|오픈크랩|해시태그)/iu.test(
    normalized
  );
}

function buildLocalProductLinesForTitle(
  title: string,
  product: ProductInfo,
  categoryKeyword: string
): string[] {
  const normalized = normalizeSectionTitleKey(title);
  const productNameForMatch = normalizePromptForStepMatch(product.name);
  const isSeatCushion = /꼬리뼈|치질|자세교정|방석|쿠션|의자/.test(productNameForMatch);
  const isCoolerBag = /보냉백|쿨러백|아이스박스|소프트쿨러|캠핑|피크닉/.test(productNameForMatch);
  const isPortableCare = /드라이기|선풍기|휴대|여행|외출|캠핑|피크닉/.test(productNameForMatch);
  const featureText = product.features.slice(0, 2).join(", ");
  const priceText = product.price || "판매가";
  const deliveryText = product.deliveryInfo || "배송 조건";
  const couponText = product.couponInfo || "쿠폰/혜택";
  const reviewText = product.reviewCount || product.rating
    ? [product.reviewCount ? `리뷰 ${product.reviewCount}` : "", product.rating ? `평점 ${product.rating}` : ""]
        .filter(Boolean)
        .join(", ")
    : "";
  const categoryLabel =
    categoryKeyword && categoryKeyword !== "제품리뷰" ? `${categoryKeyword} 제품` : "비슷한 상품";

  if (/사용|장면|활용|공간/.test(normalized)) {
    if (isSeatCushion) {
      return [
        `${product.name}은 오래 앉아 있는 책상, 사무실 의자, 차량 시트처럼 실제 앉는 자리에 맞는지 보는 게 중요해요.`,
        "방석류는 좌판 크기, 두께, 커버 소재, 미끄럼 방지 여부가 체감에 영향을 줄 수 있어요.",
        "의자 위에 올렸을 때 높이가 너무 올라가지는 않는지, 허벅지와 등받이 위치가 어색하지 않은지도 확인해보세요.",
        deliveryText ? `${deliveryText}도 사용하려는 날짜와 맞물려 확인해두면 좋아요.` : "사용하려는 날짜가 정해져 있다면 배송 일정까지 함께 확인해두면 좋아요.",
      ];
    }

    if (isCoolerBag) {
      return [
        `${product.name}은 캠핑, 피크닉, 장보기처럼 어떤 상황에 들고 갈지에 따라 보는 포인트가 달라져요.`,
        "보냉백류는 용량, 손잡이, 어깨끈, 접었을 때 보관 방식이 실제 사용감에 영향을 줘요.",
        "음료나 식재료를 어느 정도 넣을지 미리 정해두면 크기 선택이 쉬워져요.",
        deliveryText ? `${deliveryText}도 사용 예정일과 맞는지 같이 확인해두면 좋아요.` : "야외 일정이 있다면 배송 가능일을 먼저 확인하는 편이 좋아요.",
      ];
    }

    if (!isPortableCare) {
      return [
        `${product.name}은 실제로 놓고 쓸 자리와 사용 빈도를 먼저 정해두면 비교가 쉬워져요.`,
        `${categoryLabel}은 크기, 소재, 관리 방식이 생활 공간과 맞는지 확인하는 게 좋아요.`,
        deliveryText ? `${deliveryText}도 사용하려는 날짜와 맞물려 확인해두면 좋아요.` : "사용 일정이 정해져 있다면 배송 일정까지 함께 확인해두면 좋아요.",
        "제품 사진에서는 실제 배치했을 때의 크기감과 주변 공간을 중심으로 살펴보면 좋아요.",
      ];
    }

    return [
      `${product.name}은 집에서 두고 쓸지, 여행이나 외출 때 챙길지에 따라 보는 포인트가 달라져요.`,
      `${categoryLabel}은 크기와 보관 방식이 생활 동선에 맞는지 먼저 보면 좋아요.`,
      deliveryText ? `${deliveryText}도 사용 예정일과 맞물려 확인해두면 선택이 더 편해요.` : "당장 필요한 제품이라면 배송 일정까지 같이 확인해두는 편이 좋아요.",
      "제품 사진의 사용 장면을 보면 실제로 어느 정도 공간을 차지할지 감이 잡혀요.",
    ];
  }

  if (/구성|패키지|옵션|세트/.test(normalized)) {
    return [
      "옵션마다 구성품이나 색상, 수량이 달라질 수 있어서 구매 전 확인이 필요해요.",
      "대표 이미지와 상세 설명의 구성 안내가 서로 맞는지도 같이 보면 좋아요.",
      couponText ? `${couponText} 조건이 붙어 있다면 같은 옵션도 최종 금액이 달라질 수 있어요.` : "옵션명이 비슷해도 포함 구성은 다를 수 있어서 마지막 화면까지 보는 게 안전해요.",
      `${priceText} 기준으로 구성 차이를 같이 보면 단순 가격 비교보다 판단이 쉬워져요.`,
    ];
  }

  if (/디자인|첫인상|외관|색상/.test(normalized)) {
    return [
      "디자인은 상품 이미지에서 보이는 색상과 형태를 기준으로 차분히 보는 게 좋아요.",
      "책상, 거실, 차량처럼 놓을 공간과 어울리는지도 함께 확인하면 선택이 쉬워져요.",
      `${product.name}은 제품 사진에서 보이는 비율과 마감 느낌을 먼저 살펴보면 좋아요.`,
      "색상은 화면 환경에 따라 조금 달라 보일 수 있으니 옵션명도 같이 확인해두세요.",
    ];
  }

  if (/크기|스펙|무게|사이즈|용량/.test(normalized)) {
    if (isSeatCushion) {
      return [
        "방석은 의자 좌판보다 너무 크거나 작으면 앉았을 때 안정감이 떨어질 수 있어요.",
        "두께가 있는 제품은 착석 높이가 달라질 수 있어서 책상 높이와도 같이 보는 게 좋아요.",
        `${product.name}은 커버 소재와 관리 방식도 실제 사용 만족도에 영향을 줄 수 있어요.`,
        "사무실 의자, 식탁 의자, 차량 시트 중 어디에 둘지 먼저 정하면 사이즈 판단이 쉬워져요.",
      ];
    }

    return [
      "스펙은 숫자만 보기보다 실제 놓을 공간과 사용 장면에 맞춰 보는 게 좋아요.",
      "무게, 길이, 용량처럼 체감에 영향을 주는 항목은 상세페이지에서 다시 확인해두면 좋아요.",
      isPortableCare
        ? `${product.name}을 자주 옮겨 쓸 예정이라면 크기와 무게가 특히 중요해져요.`
        : `${product.name}은 설치하거나 둘 공간의 여유까지 함께 보는 게 좋아요.`,
      "보관 공간이 정해져 있다면 제품 치수와 함께 충전기나 부속품 공간도 같이 생각해보면 좋아요.",
    ];
  }

  if (/기능|성능|효과|바람|냉각|전력/.test(normalized)) {
    return [
      featureText ? `${featureText}처럼 표시된 기능은 필요한 사용 목적과 맞는지 비교해보면 좋아요.` : `${product.name}의 기능 설명은 실제로 자주 쓸 항목부터 확인하는 게 좋아요.`,
      "필요한 기능이 옵션별로 다른지 확인하면 불필요한 선택 실수를 줄일 수 있어요.",
      "성능 표현은 과장 문구보다 작동 방식, 단계 조절, 전원 방식처럼 확인 가능한 항목 위주로 보는 게 안전해요.",
      `${priceText}대에서 기대하는 기능 범위를 정해두면 비슷한 상품과 비교하기 쉬워요.`,
    ];
  }

  if (/장점/.test(normalized) && /아쉬/.test(normalized)) {
    return [
      `${product.name}의 장점은 가격, 구성, 사용 목적이 맞을 때 더 분명하게 보이는 편이에요.`,
      `반대로 ${deliveryText}, 옵션 차이, 구성품 누락 여부는 구매 전에 한 번 더 확인할 부분이에요.`,
      reviewText ? `${reviewText}가 확인된다면 반복해서 언급되는 내용 위주로 참고하면 좋아요.` : "후기 정보는 한두 문장보다 반복되는 의견을 중심으로 보는 편이 좋아요.",
      `${couponText} 조건이 있다면 최종 결제 단계에서 실제 적용 여부를 확인해두세요.`,
    ];
  }

  if (/장점|좋은|강점/.test(normalized)) {
    return [
      `${product.name}은 상품 정보 기준으로 비교 포인트가 비교적 분명한 편이에요.`,
      `${priceText}, 구성, 후기 조건을 같이 보면 장점이 더 잘 보일 수 있어요.`,
      featureText ? `${featureText} 항목이 필요했던 기능과 맞는지도 함께 보면 좋아요.` : "필요한 기능이 뚜렷한 분일수록 장점과 불필요한 기능이 쉽게 구분돼요.",
      "같은 가격대 상품과 비교할 때는 구성과 배송 조건을 같이 놓고 보는 편이 현실적이에요.",
    ];
  }

  if (/아쉬|주의|단점|확인/.test(normalized)) {
    return [
      `구매 전에는 ${deliveryText}, ${couponText}, 옵션 조건처럼 달라질 수 있는 부분을 확인하는 게 좋아요.`,
      "상세 조건은 바뀔 수 있으니 최종 결제 화면에서 한 번 더 보는 편이 안전해요.",
      `${product.name}은 상품명은 같아 보여도 색상이나 구성 옵션이 나뉠 수 있어요.`,
      "가격만 보고 고르기보다 필요한 구성인지, 교환/반품 조건은 어떤지도 함께 보면 좋아요.",
    ];
  }

  if (/추천|맞아|대상|누구/.test(normalized)) {
    if (isSeatCushion) {
      return [
        `오래 앉아 일하거나 좌석 쿠션감을 보완하고 싶은 분이라면 ${product.name}을 후보로 볼 만해요.`,
        "사무실 의자, 공부방 의자, 차량 시트처럼 앉는 시간이 긴 자리에서 쓸 제품을 찾는 분께 잘 맞아요.",
        "다만 체형과 의자 높이에 따라 체감이 달라질 수 있어 사이즈와 두께는 꼭 확인하는 게 좋아요.",
        "커버 세탁이나 관리 방식까지 같이 보면 매일 쓰기 편한지 판단하기 쉬워요.",
      ];
    }

    return [
      `${categoryLabel}을 비교 중인 분이라면 ${product.name}을 후보로 살펴볼 만해요.`,
      "가격, 구성, 후기 기준을 한 번에 정리하고 싶은 분께 참고용으로 보기 좋아요.",
      "사용 일정이 정해져 있는 경우에는 배송 가능일을 먼저 보는 편이 좋아요.",
      "이미 필요한 기능이 정해진 분이라면 옵션 차이만 좁혀서 확인해도 충분해요.",
    ];
  }

  return [
    `${product.name}을 볼 때는 상품명, 옵션, 가격대를 함께 확인하는 게 먼저예요.`,
    "상세페이지에 적힌 정보와 대표 이미지를 같이 보면 제품 성격이 더 잘 보여요.",
    `${priceText} 기준으로 필요한 구성인지 확인하면 비교 기준이 더 분명해져요.`,
    couponText ? `${couponText}까지 반영하면 실제 구매 조건이 달라질 수 있어요.` : "할인이나 배송 조건은 시점에 따라 바뀔 수 있어 마지막에 다시 확인해보세요.",
  ];
}

function buildLocalProductPostJson(
  product: ProductInfo,
  targetSectionCount: number,
  openCrabSeoBrief?: OpenCrabSeoBrief | null
): string {
  const categoryKeyword = inferCategoryKeyword(product.name);
  const categoryLabel =
    categoryKeyword && categoryKeyword !== "제품리뷰" ? `${categoryKeyword} 제품` : "비슷한 상품";
  const title = buildLocalProductTitle(product, openCrabSeoBrief);
  const sectionSeeds = [
    {
      title: "구매 전 확인 포인트",
      lines: [
        `${product.name}을 볼 때는 상품명, 옵션, 가격대를 함께 확인하는 게 먼저예요.`,
        "상세페이지에 적힌 정보와 대표 이미지를 같이 보면 제품 성격이 더 잘 보여요.",
        `${product.price || "판매가"} 기준으로 필요한 구성인지 확인하면 비교 기준이 더 분명해져요.`,
        "배송과 할인 조건은 시점에 따라 달라질 수 있어 마지막 화면에서 다시 보는 편이 좋아요.",
      ],
    },
    {
      title: "구성 및 패키지 확인",
      lines: [
        "구성품은 옵션에 따라 달라질 수 있어서 구매 전 확인이 필요해요.",
        "대표 이미지와 상세 설명의 구성 안내가 서로 맞는지도 보면 좋아요.",
        "옵션명이 비슷해도 포함 수량이나 색상 구성이 다를 수 있어요.",
        `${product.price || "판매가"} 기준으로 구성 차이를 같이 보면 단순 가격 비교보다 판단이 쉬워져요.`,
      ],
    },
    {
      title: "첫인상 / 디자인",
      lines: [
        "디자인은 상품 이미지에서 보이는 색상과 형태를 중심으로 보는 게 안전해요.",
        "사용 공간에 어울리는 크기인지도 함께 확인하면 좋아요.",
        `${product.name}은 제품 사진에서 보이는 비율과 마감 느낌을 먼저 살펴보면 좋아요.`,
        "색상은 화면 환경에 따라 조금 달라 보일 수 있으니 옵션명도 같이 확인해두세요.",
      ],
    },
    {
      title: "크기 & 스펙 정보",
      lines: [
        "스펙은 숫자만 보기보다 실제 놓을 공간과 사용 장면에 맞춰 보는 게 좋아요.",
        "무게, 길이, 용량처럼 체감에 영향을 주는 항목은 다시 확인해두면 좋아요.",
        `${product.name}을 자주 옮겨 쓸 예정이라면 크기와 무게가 특히 중요해져요.`,
        "보관 공간이 정해져 있다면 부속품까지 같이 둘 수 있는지도 생각해보면 좋아요.",
      ],
    },
    {
      title: "주요 기능 ①",
      lines: [
        "주요 기능은 상세페이지에 표시된 설명을 기준으로 정리하는 게 좋아요.",
        "필요한 기능이 옵션별로 다른지 확인하면 선택 실수를 줄일 수 있어요.",
        "성능 표현은 작동 방식, 단계 조절, 전원 방식처럼 확인 가능한 항목 위주로 보는 게 안전해요.",
        `${product.price || "판매가"}대에서 기대하는 기능 범위를 정해두면 비슷한 상품과 비교하기 쉬워요.`,
      ],
    },
    {
      title: "주요 기능 ②",
      lines: [
        "부가 기능은 실제로 자주 쓸 기능인지 따져보는 게 좋아요.",
        "가격 차이가 있다면 꼭 필요한 기능인지 비교해보면 판단이 쉬워져요.",
        "기능이 많아도 자주 쓰는 항목이 아니라면 체감 만족도는 낮을 수 있어요.",
        "옵션별 기능 차이가 있다면 상세 이미지와 옵션명을 같이 맞춰보는 편이 좋아요.",
      ],
    },
    {
      title: "장점으로 보이는 부분",
      lines: [
        `${product.name}은 상품 정보 기준으로 비교 포인트가 비교적 분명한 편이에요.`,
        "가격, 구성, 후기 조건을 같이 보면 장점이 더 잘 보일 수 있어요.",
        "필요한 기능이 뚜렷한 분일수록 장점과 불필요한 기능이 쉽게 구분돼요.",
        "같은 가격대 상품과 비교할 때는 구성과 배송 조건을 같이 놓고 보는 편이 현실적이에요.",
      ],
    },
    {
      title: "확인하면 좋을 아쉬운 점",
      lines: [
        "아쉬운 점은 옵션, 배송, 쿠폰 조건처럼 구매 전에 달라질 수 있는 부분이에요.",
        "상세 조건이 바뀔 수 있으니 최종 화면에서 한 번 더 확인하는 게 좋아요.",
        `${product.name}은 상품명은 같아 보여도 색상이나 구성 옵션이 나뉠 수 있어요.`,
        "가격만 보고 고르기보다 교환/반품 조건도 함께 보면 좋아요.",
      ],
    },
    {
      title: "이런 분께 잘 맞아요",
      lines: [
        `${categoryLabel}을 비교 중인 분이라면 ${product.name}을 후보로 살펴볼 만해요.`,
        "구매 전 기준을 정리하고 싶은 분께 참고용으로 보기 좋아요.",
        "사용 일정이 정해져 있는 경우에는 배송 가능일을 먼저 보는 편이 좋아요.",
        "이미 필요한 기능이 정해진 분이라면 옵션 차이만 좁혀서 확인해도 충분해요.",
      ],
    },
  ];

  const seedByKey = new Map(sectionSeeds.map((seed) => [normalizeSectionTitleKey(seed.title), seed]));
  const selectedSeeds = (openCrabSeoBrief?.recommendedSectionTitles || [])
    .map((sectionTitle) => stripSectionPrefix(sectionTitle))
    .filter(isPublishableSectionTitle)
    .map((sectionTitle) => {
      const existingSeed = seedByKey.get(normalizeSectionTitleKey(sectionTitle));
      return {
        title: sectionTitle,
        lines:
          existingSeed?.lines ||
          buildLocalProductLinesForTitle(sectionTitle, product, categoryKeyword),
      };
    });

  for (const seed of sectionSeeds) {
    if (selectedSeeds.length >= targetSectionCount) break;
    const alreadySelected = selectedSeeds.some(
      (selectedSeed) => normalizeSectionTitleKey(selectedSeed.title) === normalizeSectionTitleKey(seed.title)
    );
    if (!alreadySelected) selectedSeeds.push(seed);
  }

  const safeSelectedSeeds = selectedSeeds.length > 0 ? selectedSeeds : sectionSeeds;
  const sections = safeSelectedSeeds
    .slice(0, Math.max(4, Math.min(safeSelectedSeeds.length, targetSectionCount)))
    .map((seed) => buildLocalProductSection(seed.title, product, seed.lines));
  const hashtags = normalizeHashtags([], product, openCrabSeoBrief);

  return JSON.stringify({
    title,
    sections,
    hashtags,
    openCrabSeoBrief,
  });
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

  let bodyLines = allLines.slice(1).filter((line) => !isInstructionLeakLine(line));

  if (bodyLines.length === 0) {
    const sentenceParts = normalized
      .replace(title, "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .filter((part) => !isInstructionLeakLine(part));
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

function normalizeSections(
  rawSections: unknown,
  targetCount: number,
  product: ProductInfo,
  fallbackTitles: string[] = DEFAULT_SECTION_TITLES
): string[] {
  // 부족한 섹션을 채울 때는 이번 글의 편집 구성표 제목을 쓴다. 예전처럼 쇼핑용
  // 기본 제목을 쓰면 여행 글에 "구성 및 패키지 확인" 같은 제목이 섞여 들어갔다.
  const titles = fallbackTitles.length > 0 ? fallbackTitles : DEFAULT_SECTION_TITLES;
  const rawList = Array.isArray(rawSections)
    ? rawSections.filter((item): item is string => typeof item === "string")
    : [];

  const expanded: string[] = [];
  for (const section of rawList) {
    expanded.push(...splitSectionCandidates(section));
  }

  const normalized = expanded.map((section, index) =>
    normalizeSectionText(section, titles[index % titles.length], product)
  );

  while (normalized.length < targetCount) {
    const index = normalized.length;
    console.log(`   ⚠️ 구조화 섹션 부족: ${index + 1}번째 섹션을 구성표 제목 "${titles[index % titles.length]}"로 보강합니다.`);
    normalized.push(buildFallbackSection(titles[index % titles.length], product));
  }

  return normalized.slice(0, targetCount);
}

function normalizeHashtags(
  rawHashtags: unknown,
  product: ProductInfo,
  openCrabSeoBrief?: OpenCrabSeoBrief | null
): string[] {
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

  const openCrabTags = openCrabSeoBrief?.hashtags || [];
  // "추천/후기/일상" 같은 일반 태그로 개수를 채우지 않는다. 프롬프트가 금지하는
  // 태그를 코드가 넣던 모순을 없애고, 부족하면 부족한 채로 둔다.
  const merged = [...normalized, ...openCrabTags, ...productSeed];
  const deduped = Array.from(new Set(merged)).slice(0, NAVER_BLOG_HASHTAG_COUNT);
  if (deduped.length < 3) {
    console.log(`   ⚠️ 해시태그가 ${deduped.length}개뿐입니다(일반 태그로 채우지 않음).`);
  }
  return deduped;
}

function removeLocalPolishMeta(text: string): string {
  return text
    .replace(/(?:이번|이)\s*글(?:에서는|은|을)?[^.!?\n]*(?:구성|정리|소개|다루|담아)[^.!?\n]*[.!?]?/gi, "")
    .replace(/(?:아래|다음)\s*(?:내용|초안|글)[^.!?\n]*(?:재구성|정리|윤문|배치)[^.!?\n]*[.!?]?/gi, "")
    .replace(/(?:SEO|블로그)\s*(?:최적화|용도)[^.!?\n]*(?:작성|구성|정리)[^.!?\n]*[.!?]?/gi, "")
    .replace(/(?:제가|저도|직접)\s*(?:써|사용해|받아|구매해|비교해)\s*보니/gi, "정보를 기준으로 보면")
    .replace(/(?:제가|저도)\s*여러\s*정보를\s*비교해\s*보니[^.!?\n]*[.!?]?/gi, "여러 정보를 비교해 보면 선택 기준을 세우기 좋겠어요.")
    .replace(/(?:써|사용해|받아|구매해)\s*봤(?:더니|는데|어요|습니다)/gi, "정보를 확인해 보면")
    .replace(/구조화(?:했|하였)습니다\.?/gi, "")
    .replace(/재구성(?:했|하였)습니다\.?/gi, "")
    .replace(/작성(?:했|하였)습니다\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isInstructionLeakLine(line: string): boolean {
  const normalized = normalizeText(stripEmoji(line));
  return /(?:opencrab|오픈크랩|상위\s*(?:노출|리서치)|리서치\s*팩|브리프|워크플로우|프롬프트|출력\s*형식|내부\s*SEO|내부\s*참고|작성\s*(?:규칙|지침))/iu.test(
    normalized
  );
}

function splitMobileSentences(text: string): string[] {
  const normalized = removeLocalPolishMeta(text)
    .replace(/\s*([.!?])\s+/g, "$1\n")
    .replace(/\s*(。|！|？)\s*/g, "$1\n")
    .trim();

  if (!normalized) return [];

  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !isInstructionLeakLine(line));
}

function splitLongMobileLine(line: string): string[] {
  if (line.length <= 58) return [line];

  const chunks = line
    .split(/(?<=[,，])\s+|\s+(?=그리고|그래서|다만|특히|또|가격|구성|제품|사용|배송|리뷰)/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length <= 1) return [line];

  const lines: string[] = [];
  let current = "";
  for (const chunk of chunks) {
    const next = current ? `${current} ${chunk}` : chunk;
    if (next.length > 58 && current) {
      lines.push(current);
      current = chunk;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  return lines;
}

function dedupeAdjacentLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    if (result[result.length - 1] === normalized) continue;
    result.push(normalized);
  }
  return result;
}

function buildMobilePolishLines(text: string): string[] {
  const sentenceLines = splitMobileSentences(text);
  const mobileLines = sentenceLines.flatMap(splitLongMobileLine);
  return dedupeAdjacentLines(mobileLines);
}

function applyHumanMobilePolishToSection(section: string, index: number, product: ProductInfo): string {
  const lines = section
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let title = stripSectionPrefix(lines[0] || DEFAULT_SECTION_TITLES[index % DEFAULT_SECTION_TITLES.length]);
  if (!title || title.length > 60) {
    title = DEFAULT_SECTION_TITLES[index % DEFAULT_SECTION_TITLES.length];
  }

  const sourceBodyLines = lines.slice(1);
  let polishedBodyLines = buildMobilePolishLines(sourceBodyLines.join(" "));

  if (polishedBodyLines.length < 4) {
    const fallbackLines = buildFallbackSection(title, product)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(1);
    polishedBodyLines = dedupeAdjacentLines([...polishedBodyLines, ...fallbackLines]);
  }

  return `${title}\n\n${polishedBodyLines.slice(0, 6).join("\n")}\n`;
}

function applyHumanMobilePolishToDisclosure(section: string): string {
  const polishedLines = buildMobilePolishLines(section).slice(0, 4);
  return `\n${polishedLines.join("\n")}\n`;
}

function saveGeneratedPostPreview(
  linkId: string,
  post: GeneratedPostPreview,
  product: ProductInfo,
  readiness?: BrandLinkContentReadiness | null
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${linkId}.json`;
  const filePath = path.join(GENERATED_OUTPUT_DIR, filename);

  const payload = {
    createdAt: new Date().toISOString(),
    linkId,
    aiProvider: AI_PROVIDER,
    browserGptMode: BROWSER_GPT_MODE,
    chatgptUseCustomGpts: CHATGPT_USE_CUSTOM_GPTS,
    chatgptDirectOnly: CHATGPT_DIRECT_ONLY,
    chatgptBaseUrl: CHATGPT_BASE_URL,
    chatgptDraftUrl: CHATGPT_USE_CUSTOM_GPTS ? CHATGPT_DRAFT_GPT_URL : undefined,
    chatgptPolishUrl: CHATGPT_USE_CUSTOM_GPTS ? CHATGPT_POLISH_GPT_URL : undefined,
    humanMobilePolishEnabled: HUMAN_MOBILE_POLISH_ENABLED,
    productName: product.name,
    productPrice: product.price,
    representativeImagePath: product.representativeImagePath,
    firstImagePath: product.imagePaths[0] || null,
    imagePaths: product.imagePaths,
    title: post.title,
    sectionCount: post.sections.length,
    hashtagCount: post.hashtags.length,
    openCrabSeoBrief: post.openCrabSeoBrief ?? null,
    productEditorialPlan: post.productEditorialPlan ?? null,
    contentReadiness: readiness ?? null,
    postSpec: post.assembled?.spec ?? null,
    specValidation: post.assembled?.validation ?? null,
    composition: post.assembled?.composition ?? null,
    pipelineNotes: post.notes ?? null,
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
  representativeImagePath: string | null; // 썸네일용 판매페이지 대표 이미지
  imagePaths: string[];
  sourceImageUrls: string[];
  finalUrl?: string | null;
  storeName?: string | null;
}

interface StoredBrandLinkSeed {
  url: string;
  finalUrl?: string | null;
  productName?: string | null;
  productPrice?: string | null;
  storeName?: string | null;
  imageUrls?: string | null;
}

function parseStoredBrandLinkImageUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return prioritizeImageUrls(
      Array.from(
        new Set(
          parsed
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => isCandidateProductImageUrl(item))
            .map((item) => normalizeCandidateImageUrl(item))
        )
      )
    );
  } catch {
    return [];
  }
}

async function collectProductImageUrlsFromPage(page: Page): Promise<string[]> {
  const candidates: ProductImageCandidate[] = [];

  const ogImage = await page.getAttribute('meta[property="og:image"]', "content").catch(() => null);
  if (ogImage && isCandidateProductImageUrl(ogImage)) {
    candidates.push({
      url: ogImage,
      source: "og",
      index: 0,
    });
  }

  const domCandidates = await page
    .evaluate(() => {
      const toText = (value: unknown): string =>
        typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
      const urlsFromSrcset = (srcset: string | null): string[] => {
        if (!srcset) return [];
        return srcset
          .split(",")
          .map((part) => part.trim().split(/\s+/)[0])
          .filter(Boolean);
      };

      return Array.from(document.images).flatMap((img, index) => {
        const rect = img.getBoundingClientRect();
        const parent = img.closest(
          '[class*="image" i], [class*="thumb" i], [class*="gallery" i], [class*="viewer" i], [class*="product" i], [class*="detail" i], [class*="review" i]'
        ) as HTMLElement | null;
        const rawUrls = [
          img.currentSrc,
          img.getAttribute("data-src"),
          img.getAttribute("data-original"),
          img.getAttribute("data-lazy-src"),
          img.getAttribute("src"),
          ...urlsFromSrcset(img.getAttribute("srcset")),
        ].filter((url): url is string => Boolean(url));

        return Array.from(new Set(rawUrls)).map((url) => ({
          url,
          index,
          width: Math.max(img.naturalWidth || 0, Math.round(rect.width || 0)),
          height: Math.max(img.naturalHeight || 0, Math.round(rect.height || 0)),
          top: Math.round(rect.top + window.scrollY),
          alt: toText(img.getAttribute("alt")),
          className: toText(img.className),
          parentClassName: toText(parent?.className),
        }));
      });
    })
    .catch(() => [] as ProductImageCandidate[]);

  for (const candidate of domCandidates) {
    if (!isCandidateProductImageUrl(candidate.url)) continue;
    const isGalleryLike =
      isSalesPageProductImageUrl(candidate.url) &&
      !isReviewImageUrl(candidate.url) &&
      /image|thumb|gallery|viewer|product|상품|prd/i.test(
        `${candidate.className || ""} ${candidate.parentClassName || ""} ${candidate.alt || ""}`
      );
    candidates.push({
      ...candidate,
      source: isGalleryLike ? "gallery" : "dom",
    });
  }

  return prioritizeImageCandidates(candidates);
}

function isTallDetailImageDimension(width: number, height: number): boolean {
  if (width < 600 || height < 900) return false;
  const ratio = height / width;
  return ratio >= 1.35 && ratio <= 6.5;
}

async function createDetailImageCrop(
  imagePath: string,
  filePrefix: string,
  index: number,
  width: number,
  height: number
): Promise<{ path: string; width: number; height: number; size: number } | null> {
  if (!isTallDetailImageDimension(width, height)) return null;

  const cropSize = Math.min(width, height);
  const cropTop = Math.min(
    height - cropSize,
    Math.max(0, Math.round((height - cropSize) * 0.56))
  );
  const cropPath = path.join(TEMP_PATH, `${filePrefix}_detail_crop_${Date.now()}_${index}.jpg`);

  try {
    await sharp(imagePath)
      .rotate()
      .extract({ left: 0, top: cropTop, width: cropSize, height: cropSize })
      .resize(1080, 1080, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(cropPath);

    const metadata = await sharp(cropPath).metadata();
    const stats = fs.statSync(cropPath);
    return {
      path: cropPath,
      width: metadata.width ?? 1080,
      height: metadata.height ?? 1080,
      size: stats.size,
    };
  } catch {
    try { fs.unlinkSync(cropPath); } catch {}
    return null;
  }
}

async function materializeProductImages(
  imageUrls: string[],
  filePrefix: string
): Promise<{ representativeImagePath: string | null; imagePaths: string[] }> {
  const prioritizedUrls = prioritizeImageUrls(Array.from(new Set(imageUrls))).slice(0, 15);
  const downloaded: {
    path: string;
    url: string;
    size: number;
    index: number;
    width: number;
    height: number;
    detailCrop?: boolean;
  }[] = [];
  const downloadCount = Math.min(10, prioritizedUrls.length);
  let representativeImagePath: string | null = null;

  for (let i = 0; i < downloadCount; i++) {
    try {
      const imgPath = path.join(TEMP_PATH, `${filePrefix}_${Date.now()}_${i}.jpg`);
      await downloadImage(prioritizedUrls[i], imgPath);
      const stats = fs.statSync(imgPath);

      if (stats.size < 20_000) {
        try { fs.unlinkSync(imgPath); } catch {}
        console.log(`   ⚠️ 이미지 제외(너무 작음) ${i + 1}`);
        continue;
      }

      const metadata = await sharp(imgPath).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (!isUsableBlogProductImageDimension(width, height)) {
        const detailCrop = await createDetailImageCrop(imgPath, filePrefix, i, width, height);
        if (detailCrop) {
          downloaded.push({
            path: detailCrop.path,
            url: prioritizedUrls[i],
            size: detailCrop.size,
            index: i,
            width: detailCrop.width,
            height: detailCrop.height,
            detailCrop: true,
          });
          try { fs.unlinkSync(imgPath); } catch {}
          console.log(`   ✅ 이미지 ${i + 1}/${downloadCount} 상세 크롭 생성`);
          continue;
        }
        try { fs.unlinkSync(imgPath); } catch {}
        console.log(`   ⚠️ 이미지 제외(상세/배너 비율 ${width}x${height}) ${i + 1}`);
        continue;
      }

      downloaded.push({ path: imgPath, url: prioritizedUrls[i], size: stats.size, index: i, width, height });
      if (
        !representativeImagePath &&
        isPreferredThumbnailImageUrl(prioritizedUrls[i]) &&
        (isRepresentativeProductImageDimension(width, height) ||
          (isTravelProductImageUrl(prioritizedUrls[i]) && isRepresentativeTravelImageDimension(width, height)))
      ) {
        representativeImagePath = imgPath;
      }
      console.log(`   ✅ 이미지 ${i + 1}/${downloadCount} 다운로드`);
    } catch {
      console.log(`   ⚠️ 다운로드 실패 ${i + 1}`);
    }
  }

  downloaded.sort((a, b) => {
    const aScore =
      scoreProductImageCandidate({ url: a.url, source: "stored", index: a.index }) +
      Math.min(80, a.size / 40_000) +
      scoreProductImageDimensions(a.width, a.height) +
      (a.detailCrop ? 360 : 0);
    const bScore =
      scoreProductImageCandidate({ url: b.url, source: "stored", index: b.index }) +
      Math.min(80, b.size / 40_000) +
      scoreProductImageDimensions(b.width, b.height) +
      (b.detailCrop ? 360 : 0);
    return bScore - aScore;
  });

  representativeImagePath =
    downloaded.find((item) =>
      isRepresentativeProductImageDimension(item.width, item.height) ||
      (isTravelProductImageUrl(item.url) && isRepresentativeTravelImageDimension(item.width, item.height))
    )?.path ||
    representativeImagePath;

  if (!representativeImagePath) {
    console.log("   ⚠️ 판매페이지 대표 상품 이미지를 확정하지 못해 썸네일용 대표 이미지는 비워둡니다.");
  }

  const sortedPaths = downloaded.map((item) => item.path);
  const imagePaths = Array.from(
    new Set([
      ...(representativeImagePath ? [representativeImagePath] : []),
      ...sortedPaths,
    ])
  );

  return {
    representativeImagePath,
    imagePaths,
  };
}

async function buildProductInfoFromStoredBrandLink(link: StoredBrandLinkSeed): Promise<ProductInfo | null> {
  const name = sanitizeText(link.productName || "");
  const price = sanitizeText(link.productPrice || "");
  const imageUrls = parseStoredBrandLinkImageUrls(link.imageUrls);

  if (!name && imageUrls.length === 0 && !price) {
    return null;
  }

  const materializedImages =
    imageUrls.length > 0
      ? await materializeProductImages(imageUrls, "stored_product")
      : { representativeImagePath: null, imagePaths: [] };

  return {
    name: name || sanitizeText(link.storeName || "") || "상품",
    description: sanitizeText(link.storeName || ""),
    features: [],
    price,
    originalPrice: "",
    discountRate: "",
    couponInfo: "",
    deliveryInfo: "",
    reviewCount: "",
    rating: "",
    representativeImagePath: materializedImages.representativeImagePath,
    imagePaths: materializedImages.imagePaths,
    sourceImageUrls: imageUrls,
    finalUrl: link.finalUrl || link.url,
    storeName: sanitizeText(link.storeName || ""),
  };
}

function mergeProductInfo(base: ProductInfo | null, live: ProductInfo): ProductInfo {
  if (!base) return live;
  const representativeImagePath = live.representativeImagePath || base.representativeImagePath;
  const imagePaths = Array.from(
    new Set([
      ...(representativeImagePath ? [representativeImagePath] : []),
      ...(base.imagePaths || []),
      ...(live.imagePaths || []),
    ])
  );

  return {
    name: live.name || base.name,
    description: live.description || base.description,
    features: live.features.length > 0 ? live.features : base.features,
    price: live.price || base.price,
    originalPrice: live.originalPrice || base.originalPrice,
    discountRate: live.discountRate || base.discountRate,
    couponInfo: live.couponInfo || base.couponInfo,
    deliveryInfo: live.deliveryInfo || base.deliveryInfo,
    reviewCount: live.reviewCount || base.reviewCount,
    rating: live.rating || base.rating,
    representativeImagePath,
    imagePaths,
    sourceImageUrls: Array.from(new Set([...(base.sourceImageUrls || []), ...(live.sourceImageUrls || [])])),
    finalUrl: live.finalUrl || base.finalUrl || null,
    storeName: live.storeName || base.storeName || null,
  };
}

async function step1_getProductInfo(page: Page, url: string): Promise<ProductInfo> {
  console.log("\n📦 STEP 1: 상품 정보 수집");
  
  await page.goto(url, { timeout: 30000 });
  await page.waitForTimeout(5000);
  const finalUrl = page.url();

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

  let storeName = "";
  const ogSiteName = await page.$('meta[property="og:site_name"]');
  if (ogSiteName) {
    const content = await ogSiteName.getAttribute("content");
    if (content) storeName = content.trim();
  }
  if (!storeName) {
    try {
      storeName = new URL(finalUrl).hostname.replace(/^www\./, "");
    } catch {
      storeName = "";
    }
  }
  
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
  const imageUrls = (await collectProductImageUrlsFromPage(page)).slice(0, 15);
  const salesPageImageCount = imageUrls.filter((url) => isSalesPageProductImageUrl(url)).length;
  const reviewImageCount = imageUrls.filter((url) => isReviewImageUrl(url)).length;
  console.log(
    `   🖼️ ${imageUrls.length}개 이미지 발견 (판매페이지 ${salesPageImageCount}개 / 후기 ${reviewImageCount}개)`
  );
  if (imageUrls[0]) {
    console.log(`   🖼️ 대표 이미지 후보: ${imageUrls[0]}`);
    console.log(`   🖼️ 썸네일 원본 적합: ${isPreferredThumbnailImageUrl(imageUrls[0]) ? "예" : "아니오"}`);
  }
  const { representativeImagePath, imagePaths } = await materializeProductImages(imageUrls, "product");
  
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
    sourceImageUrls: imageUrls,
    finalUrl,
    storeName,
  };
}

// 이미지 다운로드 함수
async function downloadImage(url: string, filePath: string): Promise<void> {
  const https = await import('https');
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response: IncomingMessage) => {
      const status = response.statusCode ?? 0;

      // 리다이렉트 처리
      if ((status === 301 || status === 302) && response.headers.location) {
        response.resume();
        downloadImage(response.headers.location, filePath).then(resolve).catch(reject);
        return;
      }

      // 에러 응답: 본문을 파일로 저장하지 않는다.
      // 네이버 상세/리뷰 이미지(checkout.phinf 등)는 ?type= 리사이즈를 지원하지 않아
      // ?type=w860을 붙이면 404가 난다. 이 경우 쿼리를 제거하고 1회 재시도한다.
      if (status >= 400) {
        response.resume();
        if (status === 404 && /\?type=/i.test(url)) {
          downloadImage(url.replace(/\?type=.*/i, ""), filePath).then(resolve).catch(reject);
          return;
        }
        reject(new Error(`HTTP ${status}`));
        return;
      }

      const file = fs.createWriteStream(filePath);
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err: Error) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    }).on('error', (err: Error) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

// ============================================
// AI 공통 호출 함수 (OpenAI)
// ============================================
const HUMANIZE_SECTION_SEPARATOR = "\n\n<<<섹션구분>>>\n\n";

/**
 * AI 티 점수가 높은 본문을 한 번만 재작성한다(휴머나이징 패스).
 * 섹션 수가 어긋나거나 점수가 오히려 나빠지면 원문을 그대로 유지한다(fail-safe).
 */
async function rewriteSectionsForHumanTone(
  sections: string[],
  beforeScore: number
): Promise<string[]> {
  const joined = sections.join(HUMANIZE_SECTION_SEPARATOR);
  const prompt = `${buildHumanizeRewritePrompt(joined)}

[추가 형식 규칙]
- 원문에 있는 "<<<섹션구분>>>" 표시는 섹션 경계이므로 절대 지우거나 옮기지 말고 그대로 유지하세요.
- 표시 개수(${sections.length - 1}개)도 그대로여야 합니다.`;

  let rewritten = "";
  try {
    rewritten = await runOpenAiApi(
      "당신은 한국어 문장을 자연스럽게 다듬는 편집자입니다. 지시받은 형식 규칙을 정확히 지키세요.",
      prompt
    );
  } catch (error) {
    console.log(`   ⚠️ 휴머나이징 재작성 실패, 원문 유지: ${getErrorMessage(error)}`);
    return sections;
  }

  const parts = rewritten
    .split("<<<섹션구분>>>")
    .map((part) => part.replace(/^\s+|\s+$/g, ""))
    .filter(Boolean);
  if (parts.length !== sections.length) {
    console.log(
      `   ⚠️ 재작성 결과 섹션 수 불일치(${parts.length}/${sections.length}), 원문을 유지합니다.`
    );
    return sections;
  }

  const afterScore = scanAiTells(parts.join("\n\n")).score;
  if (afterScore >= beforeScore) {
    console.log(`   ⚠️ 재작성 후 점수 개선 없음(${beforeScore}→${afterScore}), 원문을 유지합니다.`);
    return sections;
  }

  console.log(`   ✅ 휴머나이징 재작성 적용 (AI 티 점수 ${beforeScore}→${afterScore})`);
  return parts;
}

async function generateWithAI(
  systemPrompt: string,
  userPrompt: string,
  chatgptContext?: ChatGPTGuidanceContext,
  chatgptImagePaths: string[] = []
): Promise<string> {

  if (BROWSER_GPT_MODE) {
    if (!chatgptContext) {
      throw new Error("Browser ChatGPT 모드에 필요한 가이드 컨텍스트가 없습니다.");
    }

    try {
      return await runChatGPTBrowserTwoPass(systemPrompt, userPrompt, chatgptContext, chatgptImagePaths);
    } catch (error) {
      const reason = getErrorMessage(error);
      throw new Error(`Browser ChatGPT 실패: ${reason}`);
    }
  }

  return runOpenAiApi(systemPrompt, userPrompt);
}

// ============================================
// STEP 2: LLM으로 SEO 최적화 글 생성 (긴 버전)
// ============================================
async function step2_generatePost(
  product: ProductInfo,
  brandLink: string,
  productId?: string | null,
  connectKind: "SHOPPING" | "TRAVEL" = "SHOPPING",
  specInput?: SpecStep2Input | null
): Promise<GeneratedPostPreview> {
  const isTravel = connectKind === "TRAVEL";
  console.log(`\n📝 STEP 2: SEO 최적화 블로그 글 생성 (확장판${isTravel ? " · 여행" : ""})`);
  console.log(`   🤖 AI Provider: ${AI_PROVIDER.toUpperCase()} (${OPENAI_MODEL})`);
  if (REQUESTED_BROWSER_GPT_MODE && !ALLOW_CHATGPT_BROWSER_MODE) {
    console.log("   🌐 Browser ChatGPT Mode: OFF (ChatGPT/opencode 미사용 설정)");
  }
  if (BROWSER_GPT_MODE) {
    console.log(`   🌐 Browser ChatGPT Mode: ON`);
    if (CHATGPT_USE_CUSTOM_GPTS) {
      console.log(`      - Draft GPT: ${CHATGPT_DRAFT_GPT_URL}`);
      console.log(`      - Polish GPT: ${CHATGPT_POLISH_GPT_URL}`);
    } else {
      console.log(`      - Custom GPTs: OFF`);
      console.log(`      - Direct URL: ${CHATGPT_BASE_URL}`);
    }
  }
  
  const bodySectionCount = BROWSER_GPT_MODE
    ? (isTravel ? Math.max(CHATGPT_DEFAULT_SUBTITLE_COUNT, 10) : CHATGPT_DEFAULT_SUBTITLE_COUNT)
    : isTravel
      ? Math.max(Math.min(product.imagePaths.length + 2, 12), 10)
      : Math.max(Math.min(product.imagePaths.length, 10), 8);
  const openCrabSeoBrief = buildOpenCrabSeoBrief({
    productId,
    productName: product.name,
    storeName: product.storeName,
    description: product.description,
    features: product.features,
    targetSectionCount: bodySectionCount,
  });
  const openCrabPromptBlock = formatOpenCrabSeoBriefForPrompt(openCrabSeoBrief);

  if (POST_SPEC_PIPELINE_ENABLED && !BROWSER_GPT_MODE && specInput) {
    console.log("   🧭 Spec-first: 이미지 플랜 → 스펙 → 구조화 생성 → 검증/타깃 수리 → 조립");
    const result = await runSpecFirstPipeline({
      kind: connectKind,
      productId: productId || null,
      product: {
        name: product.name,
        description: product.description,
        features: product.features,
        price: product.price,
        originalPrice: product.originalPrice,
        discountRate: product.discountRate,
        couponInfo: product.couponInfo,
        deliveryInfo: product.deliveryInfo,
        reviewCount: product.reviewCount,
        rating: product.rating,
        storeName: product.storeName,
      },
      brief: openCrabSeoBrief,
      imageCandidates: specInput.imageCandidates,
      tempDir: specInput.tempDir,
      brandLink,
      memo: specInput.memo,
      options: {
        maxRepairRounds: 2,
        allowLocalFallback: PRODUCT_POST_LOCAL_FALLBACK_ENABLED,
        quotationHeaders: NAVER_EDITOR_QUOTATION_ENABLED,
        requireRepresentativeImage: BRANDLINK_REQUIRE_REPRESENTATIVE_IMAGE,
        thumbnailGenerated: THUMBNAIL_AUTOGEN_ENABLED,
      },
    });
    for (const note of result.notes) console.log(`   · ${note}`);
    console.log(`   📌 제목: ${result.title}`);
    console.log(`   📝 섹션: ${result.sections.length}개 (${result.generationSource}, 호출 ${result.attempts}회)`);
    console.log(`   🖼️ 이미지 플랜: 본문 ${result.spec.imagePlan.resolvedBody}장 / 목표 ${result.spec.imagePlan.targetBody}장`);
    console.log(`   🧪 검증: ${result.validation.summary}`);
    return {
      title: result.title,
      sections: result.sections,
      hashtags: result.hashtags,
      rawResponse: `spec-first:${result.generationSource}`,
      openCrabSeoBrief,
      productEditorialPlan: null,
      assembled: result,
      notes: result.notes,
    };
  }

  const productEditorialPlan = buildProductEditorialPlan({
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
    targetSectionCount: bodySectionCount,
  });
  const productEditorialPromptBlock = formatProductEditorialPlanForPrompt(productEditorialPlan);
  const travelFacts = isTravel
    ? extractTravelProductFacts(product.name, product.description, product.features)
    : null;
  const travelFactsPromptBlock = travelFacts ? formatTravelFactsForPrompt(travelFacts) : "";
  const travelEditorialPlan = isTravel
    ? buildTravelEditorialPlan(product, bodySectionCount)
    : [];
  const travelEditorialPromptBlock = isTravel
    ? formatTravelEditorialPlanForPrompt(travelEditorialPlan)
    : "";
  if (openCrabSeoBrief) {
    console.log(
      `   OpenCrab SEO: ${openCrabSeoBrief.matchType} match, confidence=${openCrabSeoBrief.confidence}, images=${openCrabSeoBrief.mediaTargetImageCount}`
    );
    if (openCrabSeoBrief.matchedProductName) {
      console.log(`      - matched: ${openCrabSeoBrief.matchedProductName}`);
    }
    if (openCrabSeoBrief.sourcePath) {
      console.log(`      - source: ${path.relative(process.cwd(), openCrabSeoBrief.sourcePath)}`);
    }
  } else {
    console.log("   OpenCrab SEO: local brief unavailable or disabled");
  }
  
  // 인트로 변화를 위한 랜덤 요소. 직접 구매/사용을 단정하지 않는 관찰형 힌트만 사용한다.
  const intros = isTravel
    ? [
        "일정과 포함 사항을 기준으로 정리해봤어요",
        "예약 전에 확인할 조건들을 먼저 살펴봤어요",
        "코스 구성을 보면서 동선을 그려봤어요",
        "가격에 뭐가 포함되는지부터 확인해봤어요",
        "여행 시기와 조건을 같이 놓고 봤어요",
      ]
    : [
        "상세 정보를 보면서 구매 전 기준을 정리해봤어요",
        "후기와 스펙을 같이 확인해봤어요",
        "옵션을 고르기 전에 체크할 점이 보였어요",
        "가격과 구성을 기준으로 살펴봤어요",
        "상품 이미지를 보면서 포인트를 정리했어요"
      ];
  const randomIntro = intros[Math.floor(Math.random() * intros.length)];

  const endings = isTravel
    ? [
        "예약 전 일정·포함 조건은 꼭 확인해보세요",
        "출발일 기준으로 가격이 달라질 수 있어요",
        "동행 유형에 맞는 옵션인지 살펴보면 좋아요",
        "취소·변경 규정은 예약 페이지에서 확인하세요",
        "비슷한 코스와 비교해보고 결정해도 늦지 않아요",
      ]
    : [
        "구매 전 비교 기준으로 보기 좋아요", "옵션 확인 후 고르면 좋겠어요",
        "필요한 분께 참고가 될 만해요", "가격과 구성을 함께 보면 좋아요",
        "상세 조건은 한 번 더 확인해보세요"
      ];
  const randomEnding = endings[Math.floor(Math.random() * endings.length)];

  const systemPrompt = `당신은 인기 네이버 블로거입니다.
${BLOG_HUMANIZE_MOBILE_STYLE ? buildHumanMobileStyleGuide() : "- 친근하고 솔직한 ~요체 사용"}
- 상품 정보, 가격, 이미지에서 확인되는 요소를 정확히 이해하고 자연스럽게 작성
- 실제 사용 여부가 제공되지 않은 내용은 단정하지 말고 상황형 표현으로 풀어쓰기
- SEO를 위해 상품명, 관련 키워드를 자연스럽게 본문에 포함
- 매번 조금씩 다른 표현 사용 (똑같은 문구 반복 금지)
- 과장 없이 신뢰감 있게 작성
${NAVER_SEO_TITLE_RULES}
${BLOG_HUMANIZE_MOBILE_STYLE ? `\n${HUMANIZE_RULES}` : ""}
${openCrabPromptBlock ? `\n${openCrabPromptBlock}` : ""}
${travelFactsPromptBlock ? `\n${travelFactsPromptBlock}` : ""}
${travelEditorialPromptBlock ? `\n${travelEditorialPromptBlock}` : ""}`;

  // 여행 상품은 리뷰가 아니라 "예약 전 정보 정리 글"이다. 일정·포함사항·여행지
  // 정보를 제공된 데이터와 널리 알려진 사실 안에서만 쓰도록 별도 계획을 준다.
  const travelSectionPlan = `4. 섹션 구성 (${bodySectionCount}개, 아래 순서를 유지):
${travelEditorialPlan.map((section, index) => `   ${index + 1}) ${section.title}: ${section.purpose}`).join("\n")}

   편집 구도:
   - 첫 화면: 대표 여행사진 다음에 검색 키워드와 여행지의 핵심 분위기를 3~5줄로 제시
   - 초반 30%: 기간·목적지·여행지 배경·전체 코스·출발조건을 먼저 요약
   - 중반: 여행지 정보(대표 장소·교통·날씨·준비물)를 실제 방문 전 검색 가이드처럼 설명
   - 후반: 코스 포인트·이동 강도·식사/숙박·포함/불포함·추가비용·추천 여행자·예약 전 체크
   - 마지막: 경제적 이해관계 고지 다음에 여행커넥트 외부 링크 카드 삽입

   ⚠️ 사실 기반 원칙 (여행):
   - 위 "상품 정보"에 없는 일정·가격·포함사항·호텔 등급을 지어내지 마세요.
   - 방문지 설명은 그 지역에 대해 널리 알려진 사실(대표 명소, 지리, 계절 특성)만 쓰고,
     영업시간·입장료·최신 행사처럼 변동되는 세부 정보는 단정하지 마세요.
   - 실제 다녀온 것처럼 "다녀왔다", "먹어봤다"라고 단정하지 마세요.
   - 동일한 소제목이나 문단을 반복해서 글자 수를 채우지 마세요.`;
  const contentFactsPrompt = isTravel
    ? `- 여행상품명: ${product.name}\n${travelFactsPromptBlock}\n- 표시 가격: ${product.price || "출발일별 확인 필요"}\n- 상세 URL: ${product.finalUrl || brandLink}`
    : `- 상품명: ${product.name}\n- 설명: ${product.description || '(상품 설명 참고)'}\n- 특징: ${product.features.join(', ') || '(상품 특징 참고)'}\n- 가격: ${product.price || '(가격 정보 참고)'}\n${product.originalPrice ? `- 원가: ${product.originalPrice}` : ''}\n${product.discountRate ? `- 할인율: ${product.discountRate}` : ''}\n${product.couponInfo ? `- 쿠폰/혜택: ${product.couponInfo}` : ''}\n${product.deliveryInfo ? `- 배송: ${product.deliveryInfo}` : ''}\n${product.reviewCount ? `- 리뷰: ${product.reviewCount}개` : ''}\n${product.rating ? `- 평점: ${product.rating}점` : ''}`;

  const userPrompt = `다음 ${isTravel ? "여행 상품을 예약 전 검토하는 블로그 글" : "상품의 상세 블로그 리뷰"}를 작성해주세요.

## 상품 정보
${contentFactsPrompt}

## 이번 글의 톤
- 인트로 힌트: "${randomIntro}"
- 마무리 힌트: "${randomEnding}"
- 이 힌트를 참고해서 자연스럽게 변형해서 사용
- 휴대폰으로 블로그 앱에서 쓰는 글처럼 짧고 부드럽게 작성
- 광고 문구보다 실제 구매를 고민하는 사람의 말투로 작성
${BROWSER_GPT_MODE && CHATGPT_FORCE_MOBILE_VERSION ? "- 출력 형식: 모바일 버전 고정" : ""}

## 작성 규칙
1. 제목: ${isTravel ? "핵심 여행지 검색 키워드를 맨 앞에 + 상품명" : "핵심 검색 키워드(상품 카테고리)를 맨 앞에 + 상품명"}, 25-35자
   - 제목에는 이모지를 절대 넣지 마세요.
   - "완벽 가이드", "총정리", "꿀팁" 같은 낚시성 문구 금지 (네이버 스팸 기준).
   예: ${isTravel ? '"제주 서부 코스 | ○○ 패키지 일정과 포함사항"' : '"아기비데 추천 | 해피달링 시그니처 워터탭 솔직 후기"'}

2. 본문을 정확히 ${bodySectionCount}개 섹션으로 작성
   - 여행 글 전체 분량은 공백 제외 2,600~3,500자, 쇼핑 글은 1,300~1,800자.
   - 글자보다 이미지가 본체입니다. 문장은 사진 사이를 잇는 역할로 짧게.

3. 각 섹션 구조:
   - 소제목 (한 줄, 이모지 금지)
   - 빈 줄
   - 본문 3-5문장 (각 문장 끝에 줄바꿈, 각 문장 25-45자)
   - 한 문장에 정보 하나만 담고, 어색하면 더 짧게 나누기
   - 여행 글은 한 섹션 120~220자로 쓰고 정보→여행 장면→독자가 확인할 항목 순서로 쓰기
   - 빈 줄

4. 섹션 구성 (${bodySectionCount}개):
${isTravel
  ? travelSectionPlan
  : `${productEditorialPlan.sections.map((section, index) => `   ${index + 1}) ${section.title}: ${section.purpose}`).join("\n")}

${productEditorialPromptBlock}

   실제 구매/택배 수령/직접 사용 경험이 제공되지 않았으므로
   "주문했다", "받아봤다", "써봤다", "재구매 의사"처럼 체험을 단정하지 마세요.`}

5. SEO 키워드 삽입:
   - 제목에 메인 키워드
   - 첫 문장에 상품명 포함
   - 본문 중간중간 관련 키워드 자연스럽게 배치
   - 같은 키워드를 연속 반복하지 않기

6. ${isTravel ? "여행상품 검토 기준" : "할인/특가 정보 활용 (있는 경우만)"}:
${isTravel ? `   - 상품명이 아니라 일정표에서 확인된 코스만 확정적으로 표현
   - 여행지의 배경과 대표 볼거리, 이동 방법, 계절·복장·준비물, 식사·숙박, 포함/불포함, 추가비용, 여행 강도, 추천 여행자 순서로 분석
   - 여행을 처음 검색하는 독자가 출발 전에 궁금해할 정보(어디에 있는지, 무엇을 보는지, 어떻게 움직이는지, 무엇을 준비하는지)를 본문 앞쪽에 배치
   - 최신 운영시간·입장료·환율·날씨처럼 변동되는 정보는 확인 필요로 표시하고 단정하지 않기
   - 가격은 출발일·인원·객실 조건에 따라 달라질 수 있음을 안내
   - 실제 탑승·숙박·식사 경험이나 현지 후기를 만들어내지 않기
   - 쇼핑 상품의 배송·구성품·스펙·교환/반품 문구를 절대 사용하지 않기`
  : `
   - 할인율이 있으면 담백하게 "현재 할인가 기준으로는 부담이 줄어드는 편이에요"처럼 표현
   - 쿠폰 정보가 있으면 "구매 전 쿠폰 적용 여부도 확인해보면 좋아요" 정도로 언급
   - 무료배송이면 "배송비까지 보면 체감 가격이 달라질 수 있어요"처럼 자연스럽게 언급
   - 리뷰 수/평점은 확인된 경우에만 참고 포인트로 언급
   - 구매 유도보다 가격 판단 기준을 알려주는 방식으로 작성`}

7. 해시태그 ${NAVER_BLOG_HASHTAG_COUNT}개 (상위 노출 글 실측 기준 3~5개):
${isTravel
  ? `   - 여행지·상품명 키워드를 우선하고, 여행 형태(패키지여행/자유여행 등)로 보완
   - 검색 의도가 분명한 태그만. 개수를 채우기 위한 일반 태그는 넣지 마세요`
  : `   - 상품명·카테고리 키워드를 우선하고, 검색 의도가 분명한 태그(추천/후기/비교)로 보완
   - 개수를 채우기 위한 일반 태그(일상 등)는 넣지 마세요`}

8. AI 티가 나는 문장 금지:
${BLOG_HUMANIZE_MOBILE_STYLE ? `${HUMAN_MOBILE_STYLE_GUIDE}\n${MOBILE_BODY_RULES}\n${HUMAN_REVIEW_SAFETY_RULES}` : "   - 반복적인 문장 구조와 과장 표현 금지"}

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
    openCrabSeoBrief,
    productEditorialPlan,
  };

  let text: string;
  try {
    text = await generateWithAI(
      systemPrompt,
      userPrompt,
      chatgptContext,
      product.imagePaths
    );
  } catch (error) {
    if (!PRODUCT_POST_LOCAL_FALLBACK_ENABLED) {
      throw error;
    }
    console.log(`   ⚠️ AI 글 생성 실패, 로컬 상품글 초안으로 대체합니다: ${getErrorMessage(error)}`);
    text = isTravel
      ? buildLocalTravelPostJson(product, bodySectionCount)
      : buildLocalProductPostJson(product, bodySectionCount, openCrabSeoBrief);
  }
  const json = parseJsonObjectFromText(text);
  const minimumSections = Math.min(8, Math.max(4, bodySectionCount - 1));
  const structuredSectionCount = getStructuredSectionCount(json);
  if (structuredSectionCount < minimumSections) {
    console.log(
      `   ⚠️ 구조화 섹션 부족(${structuredSectionCount}/${minimumSections}), 폴백 섹션으로 보완합니다.`
    );
  }
  
  // 마지막에 필수 고지 문구만 추가하고, 링크는 에디터의 커넥트 컴포넌트로 별도 삽입한다.
  const lastSection = isTravel
    ? `

이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.

자세한 일정과 예약 정보는 아래 여행커넥트에서 확인해보세요.`
    : `

이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.

자세한 상품 정보는 아래 쇼핑커넥트에서 확인해보세요.`;

  const planSectionTitles = isTravel
    ? travelEditorialPlan.map((section) => section.title)
    : productEditorialPlan.sections.map((section) => section.title);
  let bodySections = normalizeSections(json.sections, bodySectionCount, product, planSectionTitles);
  if (HUMAN_MOBILE_POLISH_ENABLED) {
    console.log("   🧽 로컬 사람형 모바일 윤문/배치 적용");
    bodySections = bodySections.map((section, index) =>
      applyHumanMobilePolishToSection(section, index, product)
    );
  }

  // AI 티(번역투·상투구·기계적 구조)를 코드로 측정하고, 기준을 넘으면 한 번 재작성한다.
  const aiTellScan = scanAiTells(bodySections.join("\n\n"));
  console.log(`   🧪 AI 티 스캔: ${aiTellScan.summary}`);
  if (
    BLOG_HUMANIZE_REWRITE_ENABLED &&
    !BROWSER_GPT_MODE &&
    aiTellScan.score >= BLOG_HUMANIZE_REWRITE_THRESHOLD
  ) {
    bodySections = await rewriteSectionsForHumanTone(bodySections, aiTellScan.score);
  }

  const sections = [...bodySections];
  sections.push(HUMAN_MOBILE_POLISH_ENABLED ? applyHumanMobilePolishToDisclosure(lastSection) : lastSection);
  const hashtags = normalizeHashtags(json.hashtags, product, openCrabSeoBrief);
  
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
    openCrabSeoBrief,
    productEditorialPlan,
  };
}

// ============================================
// STEP 3: 블로그 에디터 열기
// ============================================
function isExistingPostEditUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const params = parsed.searchParams;
    const haystack = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    return (
      params.has("logNo") ||
      params.has("postId") ||
      params.has("postIdNo") ||
      /postview|modify|update|edit|redirect=update|redirect=modify/i.test(haystack)
    );
  } catch {
    return /postview|logno=|postid=|modify|update|edit|redirect=update|redirect=modify/i.test(rawUrl);
  }
}

function normalizeEditorContentText(value: string): string {
  return value
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderEditorText(value: string): boolean {
  const text = normalizeEditorContentText(value);
  if (!text) return true;
  if (
    /^(제목|제목을 입력.*|본문.*입력.*|내용.*입력.*|여기에.*입력.*|글감과 함께 나의 일상을 기록해보세요!?)$/i.test(
      text
    )
  ) {
    return true;
  }
  // 네이버 회전형 '글감' 본문 플레이스홀더 백업 감지 (예: "...#모두의회고")
  // 실제 발행 본문은 #해시태그로 시작/끝나는 단문 한 줄이 아니므로 안전하다.
  if (/#모두의회고|#오늘일기|#글감/.test(text)) return true;
  return false;
}

async function pasteChatGPTPrompt(page: Page, composer: Locator, composerSelector: string, prompt: string): Promise<void> {
  await composer.click({ force: true }).catch(() => {});
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.waitForTimeout(100);

  if (composerSelector.startsWith("textarea")) {
    await composer.fill(prompt);
    return;
  }

  await composer.evaluate(
    (element, value) => {
      const target = element as HTMLElement;
      target.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.addRange(range);
      }

      document.execCommand("delete");
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", value);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(pasteEvent);

      if (!target.innerText.trim()) {
        document.execCommand("insertText", false, value);
      }

      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    },
    prompt
  );

  await page.waitForTimeout(300);
  const currentText = await readChatGPTComposerText(page, composerSelector, composer);
  const probe = buildChatGPTPromptProbe(prompt);
  const normalizedCurrent = normalizeText(currentText).replace(/\s+/g, " ").trim();
  if (!normalizedCurrent.includes(probe.slice(0, Math.min(80, probe.length)))) {
    await composer.click({ force: true }).catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.keyboard.insertText(prompt);
  }
}

async function closeBlockingChatGPTModals(page: Page): Promise<void> {
  const selectors = [
    'button:has-text("나중에")',
    'button:has-text("건너뛰기")',
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button[aria-label*="Close"]',
    'button[aria-label*="닫기"]',
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let acted = false;
    for (const selector of selectors) {
      const target = page.locator(selector).first();
      if (!(await target.isVisible().catch(() => false))) continue;
      await target.click({ force: true, timeout: 1000 }).catch(() => {});
      acted = true;
      await page.waitForTimeout(300);
      break;
    }
    if (!acted) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      break;
    }
  }
}

async function readFirstMeaningfulEditorText(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locators = page.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = locators.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      // 네이버 에디터의 글감/제목 플레이스홀더(.se-placeholder)는 회전형 문구라
      // 텍스트만 보면 실제 본문과 구분되지 않는다. DOM에서 플레이스홀더 요소를 제거한
      // 순수 입력 텍스트만 읽어 오인 차단을 방지한다.
      const rawText = await locator
        .evaluate((el) => {
          if (el instanceof HTMLElement && el.closest(".se-placeholder, .__se_placeholder")) {
            return "";
          }
          const clone = el.cloneNode(true) as HTMLElement;
          // 플레이스홀더 + 에디터 UI(툴바/버튼/유틸 아이콘) 텍스트는 실제 내용이 아니므로 제거
          clone
            .querySelectorAll(
              ".se-placeholder, .__se_placeholder, button, [role='button'], svg, " +
                "[class*='toolbar'], [class*='util'], [class*='tooltip'], [class*='help'], [class*='-button']"
            )
            .forEach((node) => node.remove());
          return clone.textContent || "";
        })
        .catch(() => "");
      const text = normalizeEditorContentText(rawText);
      if (!isPlaceholderEditorText(text)) {
        return text;
      }
    }
  }
  return null;
}

async function closeEditorPopupsForFreshPost(page: Page): Promise<void> {
  const newPostSelectors = [
    'button:has-text("새 글 쓰기")',
    'button:has-text("새 글")',
    'button:has-text("새로 쓰기")',
    'button:has-text("작성 취소")',
    'button:has-text("취소")',
    'a:has-text("새 글 쓰기")',
    'a:has-text("새 글")',
    'a:has-text("취소")',
    ".se-popup-button-cancel",
  ];
  const closeOnlySelectors = [
    ".se-help-close",
    ".se-popup-close",
    'button[aria-label="닫기"]',
    'button[aria-label*="닫기"]',
    'button:has-text("닫기")',
  ];
  const alertConfirmSelectors = [
    ".se-popup-button-confirm",
    ".se-popup-button-confirm input",
    '[data-group="popupLayer"] button[class*="confirm"]',
    '[data-name*="se-popup-alert"] button[class*="confirm"]',
    '[data-group="popupLayer"] input[value="확인"]',
    'button:has-text("확인")',
    'a:has-text("확인")',
    'input[value="확인"]',
  ];

  const isBlockingPopupVisible = async (): Promise<boolean> =>
    page
      .locator(
        [
          ".se-popup-dim",
          '[data-group="popupLayer"] .se-popup-alert-confirm',
          '[data-name*="se-popup-alert-confirm"]',
          ".blog-se-alert",
        ].join(", ")
      )
      .first()
      .isVisible()
      .catch(() => false);

  const clickPopupButtonByDom = async (preferNewPost: boolean): Promise<boolean> =>
    page
      .evaluate((preferNew) => {
        const isVisible = (element: Element): boolean => {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const getText = (element: Element): string => {
          const input = element as HTMLInputElement;
          return `${element.textContent || ""} ${input.value || ""} ${element.getAttribute("aria-label") || ""} ${
            element.getAttribute("title") || ""
          } ${element.getAttribute("class") || ""}`.replace(/\s+/g, " ").trim();
        };
        const roots = Array.from(
          document.querySelectorAll(
            [
              '[data-group="popupLayer"]',
              '[data-name*="se-popup"]',
              ".se-popup",
              ".blog-se-alert",
            ].join(", ")
          )
        ).filter(isVisible);

        const clickedLabels: string[] = [];
        const preferredPattern = preferNew
          ? /(새\s*글|새로\s*쓰기|작성\s*취소|취소|닫기|cancel|close)/i
          : /(확인|닫기|취소|ok|confirm|close|cancel)/i;
        const fallbackPattern = preferNew
          ? /(확인|ok|confirm)/i
          : /(새\s*글|새로\s*쓰기|작성\s*취소|취소|닫기|cancel|close)/i;

        for (const root of roots) {
          const controls = Array.from(
            root.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')
          ).filter(isVisible);
          const preferred = controls.find((control) => preferredPattern.test(getText(control)));
          const fallback = controls.find((control) => fallbackPattern.test(getText(control)));
          const target = preferred || fallback || controls[0];
          if (!target) continue;

          clickedLabels.push(getText(target).slice(0, 120));
          (target as HTMLElement).click();
          return { clicked: true, labels: clickedLabels };
        }

        return { clicked: false, labels: clickedLabels };
      }, preferNewPost)
      .then((result) => {
        if (result.clicked) {
          console.log(`   🧹 에디터 팝업 DOM 버튼 클릭: ${result.labels[0] || "unknown"}`);
        }
        return result.clicked;
      })
      .catch(() => false);

  const removeBlockingAlertLayers = async (): Promise<boolean> =>
    page
      .evaluate(() => {
        const selectors = [
          ".se-popup-dim",
          '[data-group="popupLayer"] .se-popup-alert-confirm',
          '[data-name*="se-popup-alert-confirm"]',
          ".blog-se-alert",
        ];
        let removed = 0;
        for (const selector of selectors) {
          for (const element of Array.from(document.querySelectorAll(selector))) {
            element.remove();
            removed += 1;
          }
        }
        document.body.style.overflow = "";
        return removed;
      })
      .then((removed) => {
        if (removed > 0) {
          console.log(`   🧹 에디터 alert 레이어 제거: ${removed}개`);
        }
        return removed > 0;
      })
      .catch(() => false);

  const clickFirstVisible = async (selectors: string[]): Promise<boolean> => {
    for (const selector of selectors) {
      const target = page.locator(selector).first();
      if (!(await target.isVisible().catch(() => false))) continue;
      const clicked = await target
        .click({ force: true, timeout: 1200 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) continue;
      await page.waitForTimeout(400);
      if (!(await isBlockingPopupVisible())) {
        return true;
      }
    }

    return false;
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    let acted = false;
    const bodyText = normalizeEditorContentText(await page.locator("body").innerText().catch(() => ""));
    const hasExistingDraftPrompt = /작성\s*중인\s*글|임시\s*저장|임시저장|이전\s*작성/.test(bodyText);
    const hasBlockingEditorPopup = await page
      .locator(
        [
          ".se-popup-dim",
          '[data-group="popupLayer"] .se-popup-alert-confirm',
          '[data-name*="se-popup-alert-confirm"]',
          ".blog-se-alert",
        ].join(", ")
      )
      .first()
      .isVisible()
      .catch(() => false);

    const selectors = hasExistingDraftPrompt
      ? [...newPostSelectors, ...closeOnlySelectors]
      : hasBlockingEditorPopup
        ? [...closeOnlySelectors, ...alertConfirmSelectors]
        : closeOnlySelectors;

    acted = await clickFirstVisible(selectors);
    if (!acted && hasBlockingEditorPopup) {
      acted = await clickPopupButtonByDom(hasExistingDraftPrompt);
      if (acted) {
        await page.waitForTimeout(500);
        acted = !(await isBlockingPopupVisible());
      }
    }
    if (!acted && hasBlockingEditorPopup) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
      acted = !(await isBlockingPopupVisible());
    }
    if (!acted && hasBlockingEditorPopup && !hasExistingDraftPrompt && attempt >= 3) {
      acted = await removeBlockingAlertLayers();
      if (acted) {
        await page.waitForTimeout(300);
        acted = !(await isBlockingPopupVisible());
      }
    }

    if (!acted) break;
  }
}

function isPopupBlockingClickError(error: unknown): boolean {
  return /se-popup|popupLayer|blog-se-alert|intercepts pointer events|Element is not attached to the DOM|Timeout/i.test(
    getErrorMessage(error)
  );
}

async function clickEditorTitleArea(page: Page): Promise<void> {
  const titleArea = page.locator(".se-documentTitle .se-text-paragraph").first();
  if (await titleArea.isVisible().catch(() => false)) {
    await titleArea.click({ timeout: 5000 });
  } else {
    await page.mouse.click(640, 130);
  }
}

async function assertFreshPostEditor(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (isExistingPostEditUrl(currentUrl)) {
    throw new Error(`기존 글 수정 화면으로 감지되어 중단합니다. url=${currentUrl}`);
  }

  await page
    .locator(".se-documentTitle .se-text-paragraph, textarea[placeholder*='제목'], input[placeholder*='제목']")
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});

  const titleText = await readFirstMeaningfulEditorText(page, [
    ".se-documentTitle .se-text-paragraph",
    "textarea[placeholder*='제목']",
    "input[placeholder*='제목']",
  ]);
  const bodyText = await readFirstMeaningfulEditorText(page, [
    ".se-main-container .se-component:not(.se-documentTitle) .se-text-paragraph",
    ".se-component-content .se-text-paragraph",
    ".se-section-text .se-text-paragraph",
  ]);

  if (titleText || bodyText) {
    throw new Error(
      `새 글쓰기 화면이 비어있지 않아 기존 글/임시글 수정 위험으로 중단합니다. title="${(
        titleText ?? ""
      ).slice(0, 60)}" body="${(bodyText ?? "").slice(0, 60)}"`
    );
  }
}

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
      const canRetry = /ERR_ABORTED|Page crashed|Target page, context or browser has been closed/i.test(message);
      if (!canRetry || attempt === 1) {
        throw error;
      }
      console.log(`   ⚠️ 에디터 진입 재시도(${attempt + 1}/2): ${message}`);

      await targetPage.close().catch(() => {});
      targetPage = await context.newPage();
      await targetPage.waitForTimeout(1500);
    }
  }
  
  await closeEditorPopupsForFreshPost(targetPage);
  await assertFreshPostEditor(targetPage);
  
  console.log("   ✅ 에디터 준비 완료");
  return targetPage;
}

// ============================================
// STEP 4: 제목 입력
// ============================================
async function step4_inputTitle(page: Page, title: string): Promise<void> {
  console.log("\n✏️ STEP 4: 제목 입력");

  await closeEditorPopupsForFreshPost(page);
  await page.waitForTimeout(300);
  await assertFreshPostEditor(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // 제목 영역 클릭
      await clickEditorTitleArea(page);
      await page.waitForTimeout(300);
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      await page.waitForTimeout(100);
      break;
    } catch (error) {
      if (!isPopupBlockingClickError(error) || attempt === 2) {
        throw error;
      }

      console.log(`   ⚠️ 제목 입력 전 팝업 감지, 닫고 재시도합니다. (${attempt + 1}/3)`);
      await closeEditorPopupsForFreshPost(page);
      await page.waitForTimeout(500);
      await assertFreshPostEditor(page);
    }
  }
  
  await page.keyboard.type(title, { delay: 30 });
  console.log(`   ✅ 제목 입력: "${title}"`);
}

// ============================================
// STEP 5: 이미지 1장 업로드 (반복 호출용)
// ============================================
async function uploadOneImage(page: Page, imagePath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(imagePath)) {
      console.log(`   ⚠️ 업로드 파일 없음: ${imagePath}`);
      return false;
    }

    const imageSelectors = [
      ".se-image-resource",
      ".se-component-image img",
      ".se-section-image img",
      '[data-module="image"] img',
    ];
    const countImages = async () => {
      let total = 0;
      for (const selector of imageSelectors) {
        total += await page.locator(selector).count().catch(() => 0);
      }
      return total;
    };

    const beforeCount = await countImages();
    const imageBtn = await findFirstVisibleLocator(page, [
      'button[data-name="image"]',
      "button.se-toolbar-button-image",
      'button[aria-label*="사진"]',
      'button[aria-label*="이미지"]',
    ]);
    if (imageBtn) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
        imageBtn.click()
      ]);
      
      if (fileChooser) {
        await fileChooser.setFiles(imagePath);
        const uploadConfirmed = await page
          .waitForFunction(
            ({ selectors, before }) =>
              selectors.some((selector) => document.querySelectorAll(selector).length > before),
            { selectors: imageSelectors, before: beforeCount },
            { timeout: 15000 }
          )
          .then(() => true)
          .catch(() => false);

        if (!uploadConfirmed) {
          await page.waitForTimeout(3000);
          const afterCount = await countImages();
          if (afterCount <= beforeCount) {
            console.log(`   ⚠️ 이미지 업로드 확인 실패: ${path.basename(imagePath)}`);
            return false;
          }
        }

        await page.waitForTimeout(800);
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

interface LocatorRoot {
  locator(selector: string): Locator;
}

async function findFirstVisibleLocator(
  root: LocatorRoot,
  selectors: string[]
): Promise<Locator | null> {
  for (const selector of selectors) {
    const matches = root.locator(selector);
    const count = Math.min(await matches.count().catch(() => 0), 80);
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (visible) return candidate;
    }
  }

  return null;
}

async function clickFirstVisibleLocator(
  root: LocatorRoot,
  selectors: string[],
  timeout = 2000
): Promise<boolean> {
  for (const selector of selectors) {
    const matches = root.locator(selector);
    const count = Math.min(await matches.count().catch(() => 0), 80);
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) continue;

      const enabled = await candidate.isEnabled().catch(() => true);
      if (!enabled) continue;

      try {
        await candidate.click({ timeout });
        await candidate.page().waitForTimeout(160);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

const SHOPPING_CONNECT_TOOL_LABEL = "쇼핑커넥트";
const TRAVEL_CONNECT_TOOL_LABEL = "여행커넥트";

const SHOPPING_CONNECT_TOOL_SELECTORS = [
  'button[data-name="shoppingConnect"]',
  'button[data-name="shopping-connect"]',
  'button[data-name*="shopping" i]',
  'button[aria-label*="쇼핑커넥트"]',
  'button[title*="쇼핑커넥트"]',
  '[role="menuitem"]:has-text("쇼핑커넥트")',
  'button:has-text("쇼핑커넥트")',
  'a:has-text("쇼핑커넥트")',
  'li:has-text("쇼핑커넥트") button',
  'li:has-text("쇼핑커넥트")',
];

// 여행커넥트 전용 메뉴 후보. 쇼핑커넥트는 스마트스토어 상품 전용이므로
// 여행 발행에서는 쇼핑 선택자로 절대 폴백하지 않는다.
const TRAVEL_CONNECT_TOOL_SELECTORS = [
  'button[data-name="travelConnect"]',
  'button[data-name="travel-connect"]',
  'button[data-name*="travel" i]',
  'button[aria-label*="여행커넥트"]',
  'button[title*="여행커넥트"]',
  '[role="menuitem"]:has-text("여행커넥트")',
  'button:has-text("여행커넥트")',
  'a:has-text("여행커넥트")',
  'li:has-text("여행커넥트") button',
  'li:has-text("여행커넥트")',
];

function connectToolLabel(kind: EditorConnectKind): string {
  return kind === "TRAVEL" ? TRAVEL_CONNECT_TOOL_LABEL : SHOPPING_CONNECT_TOOL_LABEL;
}

function connectToolSelectors(kind: EditorConnectKind): string[] {
  return kind === "TRAVEL" ? TRAVEL_CONNECT_TOOL_SELECTORS : SHOPPING_CONNECT_TOOL_SELECTORS;
}

interface PreparedBrandLinkPostOverride {
  post: GeneratedPostPreview;
  heroImagePath: string;
  bodyImagePaths: string[];
  composition?: PostCompositionContract | null;
  spec?: PostSpec | null;
  draft?: SpecGeneratedDraft | null;
}

function writePreparedBrandPostPackage(params: {
  outputDir: string;
  brandLinkId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  post: GeneratedPostPreview;
  imagePaths: string[];
}): string {
  const images = params.imagePaths.filter((imagePath) => fs.existsSync(imagePath));
  if (images.length < 5) {
    throw new Error(`고품질 초안 패키지에는 대표 1장과 본문 4장 이상이 필요합니다. 현재 ${images.length}장`);
  }
  fs.mkdirSync(params.outputDir, { recursive: true });
  const imageDir = path.join(params.outputDir, "images");
  fs.mkdirSync(imageDir, { recursive: true });
  // 수정(revise) 시에는 원본이 패키지 images/ 안에 있을 수 있어, 먼저 전부 읽은 뒤 쓴다.
  const buffers = images.map((sourcePath) => fs.readFileSync(sourcePath));
  const packagedImages = images.map((sourcePath, index) => {
    const extension = path.extname(sourcePath) || ".png";
    const destination = path.join(imageDir, `${String(index + 1).padStart(2, "0")}${extension}`);
    fs.writeFileSync(destination, buffers[index]);
    return {
      path: path.resolve(destination),
      sourcePath: path.resolve(sourcePath),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex"),
      role: index === 0 ? "hero" : "body",
    };
  });
  const markdownPath = path.join(params.outputDir, "post.md");
  const sections = params.post.sections.map((section) => {
    const [heading = "본문", ...body] = section.split(/\r?\n/);
    return `## ${heading.trim() || "본문"}\n\n${body.join("\n").trim()}`;
  });
  const markdown = [`# ${params.post.title}`, "", ...sections, "", params.post.hashtags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" ")].join("\n");
  fs.writeFileSync(markdownPath, markdown, "utf8");
  const manifestPath = path.join(params.outputDir, "manifest.json");
  const assembled = params.post.assembled ?? null;
  // 패키지 안의 복사본 경로로 슬롯/구성 정보를 다시 매핑한다(임시 파일은 이후 사라질 수 있다).
  const packagedBySource = new Map(packagedImages.map((image) => [image.sourcePath, image.path] as const));
  const remap = (imagePath: string) => packagedBySource.get(path.resolve(imagePath)) || imagePath;
  const composition = assembled
    ? {
        ...assembled.composition,
        sections: assembled.composition.sections.map((section) => ({
          ...section,
          imagePaths: section.imagePaths.map(remap).filter((imagePath) => fs.existsSync(imagePath)),
        })),
      }
    : null;
  const spec = assembled
    ? {
        ...assembled.spec,
        imagePlan: {
          ...assembled.spec.imagePlan,
          hero: assembled.spec.imagePlan.hero ? { ...assembled.spec.imagePlan.hero, path: packagedImages[0].path } : null,
          slots: assembled.spec.imagePlan.slots.map((slot) => ({ ...slot, path: remap(slot.path) })),
        },
      }
    : null;
  const base = {
    brandLinkId: params.brandLinkId,
    connectKind: params.connectKind,
    title: params.post.title,
    markdownPath: path.resolve(markdownPath),
    heroImagePath: packagedImages[0].path,
    bodyImagePaths: packagedImages.slice(1).map((image) => image.path),
    imageAssets: packagedImages,
    hashtags: params.post.hashtags,
    imagePolicy: params.connectKind === "SHOPPING" ? "LOCKED_PRODUCT_OR_ORIGINAL" : "TRAVEL_EDITORIAL",
    createdAt: new Date().toISOString(),
    approvedAt: null,
  };
  const manifest = assembled
    ? {
        version: "brand-post-package/v2",
        ...base,
        sections: params.post.sections,
        composition,
        spec,
        draft: assembled.draft,
        readiness: {
          status: assembled.validation.status,
          score: assembled.validation.score,
          summary: assembled.validation.summary,
          signals: assembled.validation.signals,
          repairTargets: assembled.validation.repair.targets,
          generationSource: assembled.generationSource,
          attempts: assembled.attempts,
        },
        pipeline: { version: "post-spec/v1", model: assembled.draft.model, notes: params.post.notes ?? [] },
      }
    : { version: "brand-post-package/v1", ...base };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

/** 실패 메시지를 MCP/UI가 구분할 수 있는 코드로 분류한다. */
function classifyFailureCode(message: string): string {
  if (/세션|로그인/u.test(message)) return "NAVER_SESSION_EXPIRED";
  if (/본문 이미지|이미지 부족|IMAGE_SHORTFALL/u.test(message)) return "IMAGE_SHORTFALL";
  if (/발행 보류|BLOCKED|게이트/u.test(message)) return "CONTENT_BLOCKED";
  if (/OPENAI_API_KEY|OpenAI API/u.test(message)) return "LLM_UNAVAILABLE";
  if (/찾을 수 없|상품 정보를 확보/u.test(message)) return "PRODUCT_NOT_FOUND";
  if (/여행커넥트|계약/u.test(message)) return "TRAVEL_CONTRACT_LOCKED";
  return "LOCAL_AUTOMATION_FAILED";
}

/** 초안 생성 결과를 패키지 디렉터리에 남긴다. 라우트가 로그 대신 이 파일로 원인을 읽는다. */
function writePrepareResult(
  outputDir: string,
  payload: { ok: boolean; code: string; message: string; readiness?: unknown },
): void {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "result.json"),
      JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2),
      "utf8",
    );
  } catch {
    // 결과 파일 기록 실패는 발행 자체를 막지 않는다.
  }
}

function resolvePreparedOverridePath(manifestPath: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("준비된 원고 매니페스트의 파일 경로가 비어 있습니다.");
  }
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(path.dirname(manifestPath), value);
  if (!fs.existsSync(resolved)) {
    throw new Error(`준비된 원고 파일을 찾을 수 없습니다: ${resolved}`);
  }
  return resolved;
}

function loadPreparedBrandLinkPostOverride(): PreparedBrandLinkPostOverride | null {
  const configuredPath = process.env.BRANDLINK_PREPARED_POST_MANIFEST?.trim();
  if (!configuredPath) return null;

  const manifestPath = path.resolve(configuredPath);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`준비된 원고 매니페스트를 찾을 수 없습니다: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    version?: unknown;
    title?: unknown;
    markdownPath?: unknown;
    heroImagePath?: unknown;
    bodyImagePaths?: unknown;
    hashtags?: unknown;
    sections?: unknown;
    composition?: unknown;
    spec?: unknown;
    draft?: unknown;
  };
  const markdownPath = resolvePreparedOverridePath(manifestPath, manifest.markdownPath);
  const heroImagePath = resolvePreparedOverridePath(manifestPath, manifest.heroImagePath);
  const bodyImagePaths = Array.isArray(manifest.bodyImagePaths)
    ? manifest.bodyImagePaths.map((value) => resolvePreparedOverridePath(manifestPath, value))
    : [];
  if (bodyImagePaths.length < 4) {
    throw new Error("준비된 원고에는 본문 이미지가 최소 4장 필요합니다.");
  }

  // v2 패키지는 섹션 문자열과 에디터 입력 계약을 그대로 담고 있어 마크다운을 다시 파싱하지 않는다.
  if (
    manifest.version === "brand-post-package/v2" &&
    Array.isArray(manifest.sections) &&
    manifest.sections.every((value) => typeof value === "string") &&
    typeof manifest.title === "string"
  ) {
    const hashtagsV2 = Array.isArray(manifest.hashtags)
      ? manifest.hashtags
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/^#+/, "").trim())
          .filter(Boolean)
      : [];
    return {
      post: {
        title: manifest.title.trim(),
        sections: manifest.sections as string[],
        hashtags: hashtagsV2,
        rawResponse: `prepared:${manifestPath}`,
      },
      heroImagePath,
      bodyImagePaths,
      composition: (manifest.composition as PostCompositionContract | null) ?? null,
      spec: (manifest.spec as PostSpec | null) ?? null,
      draft: (manifest.draft as SpecGeneratedDraft | null) ?? null,
    };
  }

  const markdown = fs.readFileSync(markdownPath, "utf8");
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  if (!titleMatch?.[1]?.trim()) {
    throw new Error("준비된 원고에서 제목을 찾지 못했습니다.");
  }

  const visibleMarkdown = markdown
    .split(/^##\s+Sources\s*$/m)[0]
    .replace(/<!--[^]*?-->/g, "")
    .trim();
  const withoutTitle = visibleMarkdown.replace(/^#\s+.+\r?\n+/, "");
  const chunks = withoutTitle.split(/^##\s+/m);
  const intro = chunks.shift()?.replace(/!\[[^\]]*\]\([^\)]+\)/g, "").trim() || "";
  const sections = [
    ...(intro ? [`여행 전 확인\n\n${intro}`] : []),
    ...chunks.map((chunk) => {
      const [heading = "", ...bodyLines] = chunk.split(/\r?\n/);
      const body = bodyLines
        .join("\n")
        .replace(/!\[[^\]]*\]\([^\)]+\)/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return [heading.trim(), body].filter(Boolean).join("\n\n");
    }).filter(Boolean),
  ];
  if (sections.length < 5) {
    throw new Error(`준비된 원고의 본문 섹션이 부족합니다: ${sections.length}개`);
  }

  const hashtags = Array.isArray(manifest.hashtags)
    ? manifest.hashtags
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/^#+/, "").trim())
        .filter(Boolean)
    : [];

  return {
    post: {
      title: titleMatch[1].trim(),
      sections,
      hashtags,
      rawResponse: `prepared:${markdownPath}`,
    },
    heroImagePath,
    bodyImagePaths,
  };
}

const EDITOR_INSERT_MENU_SELECTORS = [
  'button[data-name="insert"]',
  'button[data-name="more"]',
  'button[data-name="more-menu"]',
  'button[data-name="plus"]',
  'button[aria-label*="추가"]',
  'button[aria-label*="메뉴"]',
  'button[aria-label*="더보기"]',
  'button[title*="추가"]',
  'button[title*="메뉴"]',
  'button[title*="더보기"]',
  'button:has-text("더보기")',
  'button:has-text("추가")',
];

const MENU_SEARCH_INPUT_SELECTORS = [
  'input[placeholder*="검색"]',
  'input[placeholder*="메뉴"]',
  'input[aria-label*="검색"]',
  '[role="searchbox"]',
  '[role="dialog"] input',
  '[class*="layer" i] input',
  '[class*="menu" i] input',
];

const SHOPPING_CONNECT_PANEL_SELECTORS = [
  '.se-popup-shopping-connect[data-name="se-popup-shopping-connect"]',
  '.se-popup-shopping-connect',
  '[data-name="se-popup-shopping-connect"]',
  'div[class*="popup" i]:has(input.se-popup-search-input)',
  'div[class*="popup" i]:has(.se-shopping-connect-search-area)',
  '[role="dialog"]:has(input.se-popup-search-input)',
  '[role="dialog"]:has-text("쇼핑커넥트")',
  'div[class*="shopping" i]:has-text("쇼핑커넥트")',
  'div[class*="commerce" i]:has-text("쇼핑커넥트")',
  'div[class*="layer" i]:has-text("쇼핑커넥트")',
  'div[class*="popup" i]:has-text("쇼핑커넥트")',
  'div[class*="modal" i]:has-text("쇼핑커넥트")',
  'section:has-text("쇼핑커넥트")',
];

const SHOPPING_CONNECT_SEARCH_INPUT_SELECTORS = [
  '.se-popup-shopping-connect input.se-popup-search-input',
  '[data-name="se-popup-shopping-connect"] input.se-popup-search-input',
  '.se-popup-shopping-connect .se-popup-search input[type="text"]',
  '.se-popup-search input.se-popup-search-input',
  'input.se-popup-search-input',
  'input[placeholder*="쇼핑 커넥트"]',
  'input[aria-label*="쇼핑 커넥트"]',
  'input[placeholder*="쇼핑커넥트"]',
  'input[aria-label*="쇼핑커넥트"]',
  'input[placeholder*="URL" i]',
  'input[aria-label*="URL" i]',
  'textarea[placeholder*="URL" i]',
  'textarea[aria-label*="URL" i]',
  'input[placeholder*="링크"]',
  'input[aria-label*="링크"]',
  'textarea[placeholder*="링크"]',
  'textarea[aria-label*="링크"]',
  'input[placeholder*="주소"]',
  'input[aria-label*="주소"]',
  'input[placeholder*="상품"]',
  'input[aria-label*="상품"]',
  'input[placeholder*="검색"]',
  'input[aria-label*="검색"]',
  'textarea',
  'input[type="url"]',
  'input[type="text"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][data-placeholder*="URL" i]',
  '[contenteditable="true"][data-placeholder*="링크"]',
  '[contenteditable="true"][data-placeholder*="주소"]',
  '[contenteditable="true"][data-placeholder*="검색"]',
];

const SHOPPING_CONNECT_SEARCH_BUTTON_SELECTORS = [
  'button:has-text("검색")',
  'button[aria-label*="검색"]',
  'button[title*="검색"]',
  'button:has-text("확인")',
];

const SHOPPING_CONNECT_RESULT_SELECTORS = [
  '[role="option"]',
  '[class*="result" i] button',
  '[class*="result" i] li',
  '[class*="product" i] button',
  '[class*="product" i] li',
  'li:has-text("naver.me")',
  'li:has-text("상품")',
  'a[href*="naver.me"]',
  'a[href*="shopping.naver.com"]',
];

const SHOPPING_CONNECT_INSERT_BUTTON_SELECTORS = [
  'button:has-text("선택")',
  'button:has-text("추가")',
  'button:has-text("삽입")',
  'button:has-text("적용")',
  'button:has-text("등록")',
  'button:has-text("확인")',
  'button[class*="confirm" i]',
  'button[class*="submit" i]',
];

async function getShoppingConnectPanel(page: Page): Promise<Locator | null> {
  return findFirstVisibleLocator(page, SHOPPING_CONNECT_PANEL_SELECTORS);
}

async function waitForShoppingConnectPanel(page: Page, timeout = 8000): Promise<Locator | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const panel = await getShoppingConnectPanel(page);
    if (panel) return panel;
    await page.waitForTimeout(250);
  }

  return null;
}

async function selectShoppingConnectToolFromMenu(
  page: Page,
  kind: EditorConnectKind = "SHOPPING"
): Promise<boolean> {
  const toolSelectors = connectToolSelectors(kind);
  if (await clickFirstVisibleLocator(page, toolSelectors, 1200)) {
    return (await waitForShoppingConnectPanel(page, 3000)) !== null;
  }

  const searchInput = await findFirstVisibleLocator(page, MENU_SEARCH_INPUT_SELECTORS);
  if (!searchInput) return false;

  const label = connectToolLabel(kind);
  await searchInput.click({ timeout: 1200 }).catch(() => {});
  await searchInput.fill(label, { timeout: 1500 }).catch(async () => {
    await searchInput.press("Control+A").catch(() => {});
    await searchInput.type(label, { delay: 20 }).catch(() => {});
  });
  await page.waitForTimeout(350);

  if (await clickFirstVisibleLocator(page, toolSelectors, 1600)) {
    return (await waitForShoppingConnectPanel(page, 3000)) !== null;
  }

  await searchInput.press("Enter").catch(() => {});
  await page.waitForTimeout(500);
  return (await getShoppingConnectPanel(page)) !== null;
}

async function openShoppingConnectTool(
  page: Page,
  kind: EditorConnectKind = "SHOPPING"
): Promise<boolean> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (await selectShoppingConnectToolFromMenu(page, kind)) {
      return true;
    }

    await clickFirstVisibleLocator(page, EDITOR_INSERT_MENU_SELECTORS, 1200);
    await page.waitForTimeout(350);

    if (await selectShoppingConnectToolFromMenu(page, kind)) {
      return true;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }

  return false;
}

async function countEditorShoppingConnectArtifacts(page: Page, brandLink: string): Promise<number> {
  return page
    .evaluate((targetUrl) => {
      const editor =
        document.querySelector(".se-main-container") ||
        document.querySelector(".se-content") ||
        document.body;
      const selectors = [
        '[class*="shopping" i]',
        '[class*="commerce" i]',
        '[class*="travel" i]',
        '[data-name*="shopping" i]',
        '[data-module*="shopping" i]',
        '[data-name*="travel" i]',
        '[data-module*="travel" i]',
        'a[href*="naver.me"]',
        'a[href*="shopping.naver.com"]',
        'a[href*="brandconnect.naver.com"]',
      ];
      const elements = new Set<Element>();
      for (const selector of selectors) {
        for (const element of Array.from(editor.querySelectorAll(selector))) {
          elements.add(element);
        }
      }

      const html = editor.innerHTML || "";
      if (targetUrl && html.includes(targetUrl)) {
        return elements.size + 1;
      }

      return elements.size;
    }, brandLink)
    .catch(() => 0);
}

async function waitForShoppingConnectInserted(
  page: Page,
  brandLink: string,
  previousArtifactCount: number,
  timeout = 12000
): Promise<boolean> {
  const startedAt = Date.now();
  let panelWasClosed = false;

  while (Date.now() - startedAt < timeout) {
    const artifactCount = await countEditorShoppingConnectArtifacts(page, brandLink);
    if (artifactCount > previousArtifactCount) return true;

    const panel = await getShoppingConnectPanel(page);
    if (!panel) {
      panelWasClosed = true;
    }

    await page.waitForTimeout(400);
  }

  return panelWasClosed;
}

async function confirmShoppingConnectAddition(
  page: Page,
  brandLink: string,
  previousArtifactCount: number,
  timeout = 12000
): Promise<boolean> {
  const startedAt = Date.now();
  let clickedConfirm = false;

  while (Date.now() - startedAt < timeout) {
    const confirmButton = page
      .locator(".se-popup-shopping-connect-add-component-layer button.se-popup-button-confirm")
      .first();

    if (await confirmButton.isVisible().catch(() => false)) {
      clickedConfirm = true;
      console.log("   shopping-connect add confirmation...");
      await confirmButton.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    const remainingTime = Math.max(800, timeout - (Date.now() - startedAt));
    if (await waitForShoppingConnectInserted(page, brandLink, previousArtifactCount, Math.min(remainingTime, 2500))) {
      return true;
    }

    await page.waitForTimeout(clickedConfirm ? 500 : 250);
  }

  return waitForShoppingConnectInserted(page, brandLink, previousArtifactCount, 3000);
}

async function captureShoppingConnectArtifacts(page: Page, reason: string): Promise<void> {
  try {
    const dirPath = path.join(process.cwd(), "logs", "manual", "shopping-connect");
    fs.mkdirSync(dirPath, { recursive: true });
    const baseName = `${createTimestampLabel()}-${reason}`;
    const screenshotPath = path.join(dirPath, `${baseName}.png`);
    const htmlPath = path.join(dirPath, `${baseName}.html`);
    const jsonPath = path.join(dirPath, `${baseName}.json`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const snapshot = await page
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const describe = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
            type: element.getAttribute("type"),
            role: element.getAttribute("role"),
            ariaLabel: element.getAttribute("aria-label"),
            title: element.getAttribute("title"),
            placeholder: element.getAttribute("placeholder"),
            dataName: element.getAttribute("data-name"),
            className:
              typeof (element as HTMLElement).className === "string"
                ? (element as HTMLElement).className
                : "",
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          };
        };

        const interestingSelectors = [
          '[role="dialog"]',
          '[class*="shopping" i]',
          '[class*="commerce" i]',
          '[class*="layer" i]',
          '[class*="popup" i]',
          '[class*="modal" i]',
          "input",
          "textarea",
          '[contenteditable="true"]',
          "button",
          "a",
          '[role="option"]',
          '[role="menuitem"]',
        ];
        const elements = new Set<Element>();
        for (const selector of interestingSelectors) {
          for (const element of Array.from(document.querySelectorAll(selector))) {
            if (visible(element)) elements.add(element);
          }
        }

        return {
          url: location.href,
          bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000),
          elements: Array.from(elements).slice(0, 250).map(describe),
          html: document.documentElement.outerHTML,
        };
      })
      .catch((error) => ({
        url: page.url(),
        bodyText: "",
        elements: [],
        html: "",
        error: getErrorMessage(error),
      }));

    fs.writeFileSync(htmlPath, snapshot.html || "", "utf8");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ ...snapshot, html: undefined }, null, 2),
      "utf8"
    );
    console.log(
      `   쇼핑커넥트 진단 저장: ${path.relative(process.cwd(), screenshotPath)}, ${path.relative(
        process.cwd(),
        jsonPath
      )}`
    );
  } catch {
    console.log("   쇼핑커넥트 진단 저장 실패");
  }
}

function buildShoppingConnectSearchTerms(
  productName: string | null | undefined,
  productFinalUrl: string | null | undefined,
  brandLink: string
): string[] {
  const terms = [
    productName,
    extractSmartStoreProductId(productFinalUrl),
    productFinalUrl,
    brandLink,
  ]
    .map((term) => (term || "").replace(/\s+/g, " ").trim())
    .filter((term): term is string => term.length > 0)
    .map((term) => term.slice(0, 190));

  return Array.from(new Set(terms));
}

async function fillShoppingConnectSearch(page: Page, searchTerm: string): Promise<boolean> {
  const panel = (await waitForShoppingConnectPanel(page, 8000)) ?? page;
  const input =
    (await findFirstVisibleLocator(page, SHOPPING_CONNECT_SEARCH_INPUT_SELECTORS)) ??
    (await findFirstVisibleLocator(panel, SHOPPING_CONNECT_SEARCH_INPUT_SELECTORS));
  if (!input) {
    await captureShoppingConnectArtifacts(page, "input-missing");
    return false;
  }

  console.log(`   쇼핑커넥트 검색어 입력: ${searchTerm.slice(0, 80)}`);
  await input.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  await input.click({ timeout: 1500 }).catch(() => {});
  const isContentEditable = await input
    .evaluate((element) => element.getAttribute("contenteditable") === "true")
    .catch(() => false);
  if (isContentEditable) {
    await input.press("Control+A").catch(() => {});
    await input.press("Meta+A").catch(() => {});
    await input.type(searchTerm, { delay: 10 }).catch(() => {});
    await input.press("Enter").catch(() => {});
    await clickFirstVisibleLocator(panel, SHOPPING_CONNECT_SEARCH_BUTTON_SELECTORS, 1200);
    await page.waitForTimeout(1800);
    return true;
  }

  const filled = await input
    .fill(searchTerm, { timeout: 2000 })
    .then(() => true)
    .catch(async () => {
      await input.press("Control+A").catch(() => {});
      await input.type(searchTerm, { delay: 10 }).catch(() => {});
      return true;
    });
  if (!filled) return false;

  await input.press("Enter").catch(() => {});
  await clickFirstVisibleLocator(panel, SHOPPING_CONNECT_SEARCH_BUTTON_SELECTORS, 1200);
  await page.waitForTimeout(1800);
  return true;
}

async function chooseShoppingConnectResult(
  page: Page,
  brandLink: string,
  productName: string | null | undefined,
  productFinalUrl: string | null | undefined,
  previousArtifactCount: number,
  options: { allowGenericSelection?: boolean } = {}
): Promise<boolean> {
  if (productName?.trim() || productFinalUrl?.trim()) {
    const pickedByName = await clickShoppingConnectItemByProductName(
      page,
      productName,
      productFinalUrl,
      previousArtifactCount,
      brandLink
    );
    if (pickedByName) return true;
  }

  if ((productName?.trim() || productFinalUrl?.trim()) && !options.allowGenericSelection) {
    return false;
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const panel = (await getShoppingConnectPanel(page)) ?? page;

    if (await clickFirstVisibleLocator(panel, SHOPPING_CONNECT_INSERT_BUTTON_SELECTORS, 1200)) {
      if (await confirmShoppingConnectAddition(page, brandLink, previousArtifactCount, 5000)) {
        return true;
      }
    }

    if (await clickFirstVisibleLocator(panel, SHOPPING_CONNECT_RESULT_SELECTORS, 1200)) {
      await page.waitForTimeout(500);
      if (await confirmShoppingConnectAddition(page, brandLink, previousArtifactCount, 5000)) {
        return true;
      }
      const latestPanel = (await getShoppingConnectPanel(page)) ?? page;
      await clickFirstVisibleLocator(latestPanel, SHOPPING_CONNECT_INSERT_BUTTON_SELECTORS, 1200);
      if (await confirmShoppingConnectAddition(page, brandLink, previousArtifactCount, 5000)) {
        return true;
      }
    }

    await page.waitForTimeout(500);
  }

  return waitForShoppingConnectInserted(page, brandLink, previousArtifactCount, 5000);
}

function tokenizeForShoppingConnectMatch(value: string): string[] {
  return Array.from(
    new Set(
      value
        .replace(/[^\p{L}\p{N}.]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2)
    )
  ).slice(0, 12);
}

function extractSmartStoreProductId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\/products\/(\d+)/i);
  return match?.[1] ?? null;
}

async function clickShoppingConnectItemByProductName(
  page: Page,
  productName: string | null | undefined,
  productFinalUrl: string | null | undefined,
  previousArtifactCount: number,
  brandLink: string
): Promise<boolean> {
  const panel = (await getShoppingConnectPanel(page)) ?? page;
  const globalItems = page.locator("li.se-shopping-connect-item");
  const panelItems = panel.locator("li.se-shopping-connect-item");
  const globalCount = await globalItems.count().catch(() => 0);
  const panelCount = await panelItems.count().catch(() => 0);
  const items = globalCount > 0 ? globalItems : panelItems;
  const count = Math.min(globalCount > 0 ? globalCount : panelCount, 80);
  const targetProductId = extractSmartStoreProductId(productFinalUrl);

  if (targetProductId) {
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const href = await item
        .locator("a.se-shopping-connect-search-list-item-link")
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (!href || !href.includes(`/products/${targetProductId}`)) continue;

      const itemName = ((await item.locator(".se-shopping-connect-item-name").first().textContent().catch(() => "")) || "")
        .replace(/\s+/g, " ")
        .trim();
      console.log(
        `   쇼핑커넥트 상품 선택: ${itemName || `상품번호 ${targetProductId}`} (smartstoreProductId=${targetProductId})`
      );

      const addButton = item.locator("button.se-shopping-connect-item-add-button").first();
      if (await addButton.isVisible().catch(() => false)) {
        await addButton.click({ timeout: 2000 }).catch(() => {});
      } else {
        await item.click({ timeout: 2000 }).catch(() => {});
      }

      return confirmShoppingConnectAddition(page, brandLink, previousArtifactCount, 12000);
    }

    const clickedByDom: { clicked: boolean; itemCount: number; text?: string; href?: string } = await page
      .evaluate(
        (smartstoreProductId): { clicked: boolean; itemCount: number; text?: string; href?: string } => {
          const isVisible = (element: Element): boolean => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const itemElements = Array.from(document.querySelectorAll("li.se-shopping-connect-item"));

          for (const itemElement of itemElements) {
            if (!isVisible(itemElement)) continue;

            const linkElement = itemElement.querySelector("a.se-shopping-connect-search-list-item-link");
            const href = linkElement?.getAttribute("href") || "";
            if (!href.includes(`/products/${smartstoreProductId}`)) continue;

            const addButton = itemElement.querySelector("button.se-shopping-connect-item-add-button") as HTMLElement | null;
            const fallbackButton = itemElement.querySelector("button") as HTMLElement | null;
            const clickTarget = addButton || fallbackButton || (itemElement as HTMLElement);
            clickTarget.scrollIntoView({ block: "center", inline: "center" });
            clickTarget.click();

            return {
              clicked: true,
              itemCount: itemElements.length,
              text: (itemElement.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
              href,
            };
          }

          return { clicked: false, itemCount: itemElements.length };
        },
        targetProductId
      )
      .catch(() => ({ clicked: false, itemCount: 0 }));

    if (clickedByDom.clicked) {
      console.log(
        `   shopping-connect product selected by DOM: ${clickedByDom.text || clickedByDom.href || targetProductId}`
      );
      return confirmShoppingConnectAddition(page, brandLink, previousArtifactCount, 12000);
    }

    console.log(`   쇼핑커넥트 상품번호 매칭 실패: smartstoreProductId=${targetProductId}`);
  }

  const tokens = tokenizeForShoppingConnectMatch(productName || "");
  if (tokens.length === 0) return false;

  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const text = ((await item.innerText().catch(() => "")) || "").toLowerCase();
    if (!text) continue;

    let score = 0;
    for (const token of tokens) {
      if (text.includes(token)) score += token.length >= 4 ? 2 : 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const minimumScore = Math.min(4, Math.max(2, Math.ceil(tokens.length / 3)));
  if (bestIndex < 0 || bestScore < minimumScore) {
    console.log(
      `   쇼핑커넥트 상품명 매칭 실패: score=${bestScore}, 기준=${minimumScore}, tokens=${tokens.join(", ")}`
    );
    return false;
  }

  const item = items.nth(bestIndex);
  const itemName = ((await item.locator(".se-shopping-connect-item-name").first().innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .trim();
  console.log(`   쇼핑커넥트 상품 선택: ${itemName || `목록 ${bestIndex + 1}번째`} (score=${bestScore})`);

  const addButton = item.locator("button.se-shopping-connect-item-add-button").first();
  if (await addButton.isVisible().catch(() => false)) {
    await addButton.click({ timeout: 2000 }).catch(() => {});
  } else {
    await item.click({ timeout: 2000 }).catch(() => {});
  }

  return confirmShoppingConnectAddition(page, brandLink, previousArtifactCount, 12000);
}

async function insertShoppingConnectLink(
  page: Page,
  brandLink: string,
  productName?: string | null,
  productFinalUrl?: string | null,
  kind: EditorConnectKind = "SHOPPING"
): Promise<void> {
  const label = connectToolLabel(kind);
  console.log(`   ${label} 링크 삽입...`);
  await setNaverTextFormat(page, "text");
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(250);

  const previousArtifactCount = await countEditorShoppingConnectArtifacts(page, brandLink);

  if (!(await openShoppingConnectTool(page, kind))) {
    throw new Error(`${label} 메뉴를 열지 못했습니다. 에디터에 해당 메뉴가 있는지 확인하세요.`);
  }

  if (productName?.trim() || productFinalUrl?.trim()) {
    const pickedByName = await clickShoppingConnectItemByProductName(
      page,
      productName,
      productFinalUrl,
      previousArtifactCount,
      brandLink
    );
    if (pickedByName) {
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter").catch(() => {});
      console.log("   쇼핑커넥트 링크 삽입 완료");
      return;
    }
  }

  const searchTerms = buildShoppingConnectSearchTerms(productName, productFinalUrl, brandLink);
  let searched = false;

  for (const searchTerm of searchTerms) {
    const searchEntered = await fillShoppingConnectSearch(page, searchTerm);
    if (!searchEntered) {
      console.log("   쇼핑커넥트 검색창 없음, 표시된 상품 목록에서 선택을 시도합니다.");
      break;
    }

    searched = true;
    if (await chooseShoppingConnectResult(page, brandLink, productName, productFinalUrl, previousArtifactCount)) {
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter").catch(() => {});
      console.log("   쇼핑커넥트 링크 삽입 완료");
      return;
    }
  }

  if (!searched && !(productName?.trim() || productFinalUrl?.trim())) {
    if (
      await chooseShoppingConnectResult(page, brandLink, productName, productFinalUrl, previousArtifactCount, {
        allowGenericSelection: true,
      })
    ) {
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter").catch(() => {});
      console.log("   쇼핑커넥트 링크 삽입 완료");
      return;
    }
  }

  await captureShoppingConnectArtifacts(page, "selection-failed");
  if (!(await waitForShoppingConnectInserted(page, brandLink, previousArtifactCount, 1500))) {
    throw new Error("쇼핑커넥트 검색 결과를 선택/삽입하지 못했습니다.");
  }

  await page.waitForTimeout(500);
  await page.keyboard.press("Enter").catch(() => {});
  console.log("   쇼핑커넥트 링크 삽입 완료");
}

const NAVER_EXTERNAL_LINK_ARTIFACT_SELECTORS = [
  ".se-component.se-oglink",
  ".se-oglink",
  '[data-name*="oglink" i]',
  '[data-module*="oglink" i]',
  'a[href*="naver.me"]',
  'a[href*="brandconnect.naver.com"]',
];

async function countEditorExternalLinkArtifacts(page: Page, targetUrl: string): Promise<number> {
  return page
    .evaluate(
      ({ selectors, url }) => {
        const editor =
          document.querySelector(".se-main-container") ||
          document.querySelector(".se-content") ||
          document.body;
        const artifacts = new Set<Element>();

        for (const selector of selectors) {
          for (const element of Array.from(editor.querySelectorAll(selector))) {
            const className =
              typeof (element as HTMLElement).className === "string"
                ? (element as HTMLElement).className
                : "";
            const href = element.getAttribute("href") || "";
            const html = element.outerHTML || "";
            const isLinkComponent = /(?:^|\s)se-(?:component-)?oglink(?:\s|$)/i.test(className);
            const matchesTarget = Boolean(url) && (href.includes(url) || html.includes(url));
            if (isLinkComponent || matchesTarget) artifacts.add(element);
          }
        }

        return artifacts.size;
      },
      { selectors: NAVER_EXTERNAL_LINK_ARTIFACT_SELECTORS, url: targetUrl }
    )
    .catch(() => 0);
}

async function waitForEditorExternalLinkInserted(
  page: Page,
  targetUrl: string,
  previousArtifactCount: number,
  timeout = 15000
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const count = await countEditorExternalLinkArtifacts(page, targetUrl);
    if (count > previousArtifactCount) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function captureTravelLinkArtifacts(page: Page, reason: string): Promise<void> {
  try {
    const dirPath = path.join(process.cwd(), "logs", "manual", "travel-link");
    fs.mkdirSync(dirPath, { recursive: true });
    const baseName = `${createTimestampLabel()}-${reason}`;
    await page.screenshot({ path: path.join(dirPath, `${baseName}.png`), fullPage: true }).catch(() => {});
    const snapshot = await page
      .evaluate(() => ({
        url: location.href,
        bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000),
        html: document.documentElement.outerHTML,
      }))
      .catch(() => ({ url: page.url(), bodyText: "", html: "" }));
    fs.writeFileSync(path.join(dirPath, `${baseName}.html`), snapshot.html, "utf8");
    fs.writeFileSync(
      path.join(dirPath, `${baseName}.json`),
      JSON.stringify({ url: snapshot.url, bodyText: snapshot.bodyText }, null, 2),
      "utf8"
    );
    console.log(`   여행커넥트 링크 진단 저장: logs\\manual\\travel-link\\${baseName}.json`);
  } catch {
    console.log("   여행커넥트 링크 진단 저장 실패");
  }
}

/**
 * 여행커넥트 링크는 네이버 쇼핑커넥트 검색 대상이 아니다. 네이버 블로그가
 * 공식 지원하는 URL 붙여넣기 방식으로 OG 링크 컴포넌트를 생성한다.
 */
async function insertTravelConnectLink(page: Page, travelLink: string): Promise<void> {
  console.log("   여행커넥트 외부 링크 컴포넌트 삽입...");
  await setNaverTextFormat(page, "text");
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(250);

  const previousArtifactCount = await countEditorExternalLinkArtifacts(page, travelLink);
  await page.keyboard.type(travelLink, { delay: 5 });
  await page.keyboard.press("Enter");

  if (!(await waitForEditorExternalLinkInserted(page, travelLink, previousArtifactCount))) {
    await captureTravelLinkArtifacts(page, "external-link-conversion-failed");
    throw new Error(
      "여행커넥트 링크를 네이버 외부 링크 컴포넌트로 변환하지 못했습니다. 쇼핑커넥트 상품 검색은 실행하지 않았습니다."
    );
  }

  await page.waitForTimeout(500);
  await page.keyboard.press("Enter").catch(() => {});
  console.log("   여행커넥트 외부 링크 삽입 완료");
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
/**
 * 인용구 컴포넌트에 섹션 헤더를 넣는다. 셀렉터는 실측 전 추정값이라 기본 OFF 이며,
 * 실패하면 호출자가 소제목 서식으로 되돌린다. 삽입 후 본문 서식으로 반드시 빠져나온다.
 */
async function insertNaverQuotation(page: Page, text: string): Promise<boolean> {
  const clicked = await clickFirstVisible(page, [
    'button[data-name="quotation"][data-value="quotation_underline"]',
    'button[data-name="quotation"]',
    'button[aria-label*="인용구"]',
    'button:has-text("인용구")',
  ]);
  if (!clicked) return false;
  await page.waitForTimeout(200);
  await clickFirstVisible(page, [
    'button[data-value="quotation_underline"]',
    '[data-value^="quotation_"]',
  ]).catch(() => false);
  await page.waitForTimeout(150);
  await page.keyboard.type(text, { delay: 3 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  await setNaverTextFormat(page, "text");
  return true;
}

async function inputTextSection(
  page: Page,
  text: string,
  options?: { useSectionHeading?: boolean; insertDividerAboveHeading?: boolean; headerFormat?: HeaderFormat }
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

    let quotationInserted = false;
    if (options?.headerFormat === "quotation" && NAVER_EDITOR_QUOTATION_ENABLED) {
      quotationInserted = await insertNaverQuotation(page, titleLine);
      if (!quotationInserted) {
        console.log("   ⚠️ 인용구 삽입 실패, 소제목 서식으로 대체");
      }
    }
    if (!quotationInserted) {
      const headingApplied = await setNaverTextFormat(page, "sectionTitle");
      if (!headingApplied) {
        console.log("   ⚠️ 소제목 스타일 적용 실패, 본문 스타일로 대체");
      }
      await page.keyboard.type(titleLine, { delay: 3 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      await setNaverTextFormat(page, "text");
    }
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
  options?: {
    useSectionHeading?: boolean;
    shoppingConnectUrl?: string;
    shoppingConnectProductName?: string | null;
    shoppingConnectProductFinalUrl?: string | null;
    requiredFirstImagePath?: string | null;
    connectKind?: "SHOPPING" | "TRAVEL";
    composition?: PostCompositionContract | null;
  }
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
  // 스펙 파이프라인이 만든 에디터 입력 계약이 있으면 섹션별 슬롯(이미지 0~2장, 헤더 형식)을 그대로 따른다.
  const compositionSections =
    options?.composition && options.composition.sections.length === mainSections.length
      ? options.composition.sections
      : null;
  const imagePathsBySection = new Map<number, string[]>();
  if (compositionSections) {
    const existing = (imagePath: string) => Boolean(imagePath) && fs.existsSync(imagePath);
    compositionSections.forEach((slot) => imagePathsBySection.set(slot.index, slot.imagePaths.filter(existing)));
    // 업로드 목록의 첫 장(hero/썸네일)이 슬롯 어디에도 없으면 본문 맨 앞에 넣는다.
    const heroPath = imagePaths[0];
    const heroPlaced = compositionSections.some((slot) =>
      slot.imagePaths.some((imagePath) => path.resolve(imagePath) === path.resolve(heroPath || "")),
    );
    if (heroPath && !heroPlaced) {
      imagePathsBySection.set(0, [heroPath, ...(imagePathsBySection.get(0) || [])]);
    }
    console.log(
      `   🧩 슬롯 배치: ${compositionSections
        .map((slot) => `${slot.index + 1}:${(imagePathsBySection.get(slot.index) || []).length}장/${slot.headerFormat}`)
        .join(" ")}`
    );
  } else if (options?.connectKind === "TRAVEL" && mainSections.length > 1) {
    const usableImageCount = Math.min(imagePaths.length, mainSections.length);
    for (let imageIndex = 0; imageIndex < usableImageCount; imageIndex += 1) {
      const sectionIndex =
        usableImageCount <= 1
          ? 0
          : Math.round((imageIndex * (mainSections.length - 1)) / (usableImageCount - 1));
      imagePathsBySection.set(sectionIndex, [imagePaths[imageIndex]]);
    }
    console.log(
      `   ✈️ 여행 사진 분산 배치: ${Array.from(imagePathsBySection.keys()).map((index) => index + 1).join(", ")}번 섹션 앞`
    );
  } else {
    imagePaths.forEach((imagePath, index) => imagePathsBySection.set(index, [imagePath]));
  }
  const maxLoop = compositionSections
    ? mainSections.length
    : Math.max(mainSections.length, Math.min(imagePaths.length, 2));
  let uploadedCount = 0;
  
  for (let i = 0; i < maxLoop; i++) {
    // 이미지 업로드 (있으면, 슬롯당 여러 장 가능)
    for (const imagePath of imagePathsBySection.get(i) || []) {
      console.log(`   [${i + 1}] 🖼️ 이미지 업로드...`);
      const success = await uploadOneImage(page, imagePath);
      if (success) {
        uploadedCount++;
      } else if (
        i === 0 &&
        options?.requiredFirstImagePath &&
        path.resolve(imagePath) === path.resolve(options.requiredFirstImagePath)
      ) {
        throw new Error(`썸네일 첫 이미지 업로드 확인 실패: ${path.basename(imagePath)}`);
      }
    }

    // 텍스트 섹션 입력 (있으면)
    if (i < mainSections.length) {
      console.log(`   [${i + 1}] ✏️ 텍스트 입력 (${mainSections[i].length}자)`);
      const slot = compositionSections?.[i];
      await inputTextSection(page, mainSections[i], {
        useSectionHeading: slot ? slot.headerFormat !== "none" && useSectionHeading : useSectionHeading,
        insertDividerAboveHeading: slot ? slot.dividerBefore && useSectionHeading : undefined,
        headerFormat: slot?.headerFormat,
      });
      await page.waitForTimeout(300);
    }
  }

  if (tailSection) {
    console.log(`   [마무리] ✏️ 텍스트 입력 (${tailSection.length}자)`);
    await inputTextSection(page, tailSection, { useSectionHeading: false });
    await page.waitForTimeout(300);
  }

  if (options?.shoppingConnectUrl) {
    const connectKind = options.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
    const insertionMode = getConnectEditorInsertionMode(connectKind);
    if (insertionMode === "EXTERNAL_LINK") {
      await insertTravelConnectLink(page, options.shoppingConnectUrl);
    } else {
      // 쇼핑커넥트는 상품명/상품번호가 정확히 일치한 경우에만 삽입한다.
      await insertShoppingConnectLink(
        page,
        options.shoppingConnectUrl,
        options.shoppingConnectProductName,
        options.shoppingConnectProductFinalUrl,
        "SHOPPING"
      );
    }
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
  scheduledTimeLabel?: string | null;
}

interface AppliedScheduleSettings {
  date: Date;
  timeLabel: string | null;
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

function formatDateLog(date: Date, timeLabel = NAVER_DEFAULT_SCHEDULE_TIME_LABEL): string {
  return `${formatDateYmd(date)} ${timeLabel}`;
}

function getDefaultScheduleTime(): { hour: string; minute: string; label: string } {
  return {
    hour: String(NAVER_DEFAULT_SCHEDULE_HOUR).padStart(2, "0"),
    minute: String(NAVER_DEFAULT_SCHEDULE_MINUTE).padStart(2, "0"),
    label: NAVER_DEFAULT_SCHEDULE_TIME_LABEL,
  };
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

function parseScheduleTimeLabel(timeLabel: string | null | undefined): { hour: number; minute: number } | null {
  if (!timeLabel) return null;
  const match = timeLabel.match(/(\d{1,2})[:시](\d{1,2})/);
  if (!match) return null;
  const normalized = toScheduleTimeLabel(match[1], match[2]);
  if (!normalized) return null;
  const [hourText, minuteText] = normalized.split(":");
  return {
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(minuteText, 10),
  };
}

function toNextDayAtNine(date: Date): Date {
  const next = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    NAVER_DEFAULT_SCHEDULE_HOUR,
    NAVER_DEFAULT_SCHEDULE_MINUTE,
    0,
    0
  );
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
  const parsed = new Date(
    year,
    month - 1,
    day,
    NAVER_DEFAULT_SCHEDULE_HOUR,
    NAVER_DEFAULT_SCHEDULE_MINUTE,
    0,
    0
  );
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function createScheduledPublishDate(ymd: string, timeLabel: string | null | undefined): Date | null {
  const date = parseYmdToLocalDate(ymd);
  if (!date) return null;
  const parsedTime = parseScheduleTimeLabel(timeLabel) ?? {
    hour: NAVER_DEFAULT_SCHEDULE_HOUR,
    minute: NAVER_DEFAULT_SCHEDULE_MINUTE,
  };
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    parsedTime.hour,
    parsedTime.minute,
    0,
    0
  );
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

function isScheduleDateTimeSchedulable(
  targetYmd: string,
  targetTimeLabel: string,
  timeZone: string,
  minLeadMinutes: number
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
  return targetMinutes - nowMinutes >= minLeadMinutes;
}

function nextSchedulableDateAtDefaultTime(): Date {
  const candidate = new Date();
  candidate.setHours(
    NAVER_DEFAULT_SCHEDULE_HOUR,
    NAVER_DEFAULT_SCHEDULE_MINUTE,
    0,
    0
  );

  for (let attempt = 0; attempt < 370; attempt += 1) {
    const ymd = formatDateYmd(candidate);
    if (
      isScheduleDateTimeSchedulable(
        ymd,
        NAVER_DEFAULT_SCHEDULE_TIME_LABEL,
        NAVER_SCHEDULE_TIMEZONE,
        NAVER_SCHEDULE_MIN_LEAD_MINUTES
      )
    ) {
      return candidate;
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  return toNextDayAtNine(new Date());
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

function resolveScheduleTimeForDate(): { hour: string; minute: string; label: string } {
  return getDefaultScheduleTime();
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
  const targetTime = resolveScheduleTimeForDate();

  const timeInput = page.locator('input[type="time"]').first();
  const hasTimeInput = await timeInput.isVisible().catch(() => false);
  if (hasTimeInput) {
    await timeInput.fill(targetTime.label, { timeout: 1200 }).catch(() => {});
    await timeInput.dispatchEvent("input").catch(() => {});
    await timeInput.dispatchEvent("change").catch(() => {});
    await timeInput.evaluate((element) => (element as { blur?: () => void }).blur?.()).catch(() => {});
    await page.waitForTimeout(200);
    const appliedValue = await timeInput.inputValue().catch(() => targetTime.label);
    const appliedTime = parseScheduleTimeLabel(appliedValue);
    const appliedLabel = appliedTime
      ? `${String(appliedTime.hour).padStart(2, "0")}:${String(appliedTime.minute).padStart(2, "0")}`
      : targetTime.label;
    if (isScheduleTimeFutureForDate(scheduledDate, appliedLabel)) {
      return appliedLabel;
    }
    return null;
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
    const appliedLabel = toScheduleTimeLabel(appliedHour, appliedMinute) ?? targetTime.label;
    if (isScheduleTimeFutureForDate(scheduledDate, appliedLabel)) {
      return appliedLabel;
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

async function configureSchedulePublish(page: Page, scheduledDate: Date): Promise<AppliedScheduleSettings> {
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
  return {
    date: ensured.effectiveDate,
    timeLabel: ensured.appliedTimeLabel,
  };
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
      const appliedSchedule = await configureSchedulePublish(page, options.scheduledDate);
      options.scheduledDate = appliedSchedule.date;
      options.scheduledTimeLabel = appliedSchedule.timeLabel;
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

  const date = new Date(
    year,
    month - 1,
    day,
    NAVER_DEFAULT_SCHEDULE_HOUR,
    NAVER_DEFAULT_SCHEDULE_MINUTE,
    0,
    0
  );
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
  if (
    isScheduleDateTimeSchedulable(
      requestedYmd,
      NAVER_DEFAULT_SCHEDULE_TIME_LABEL,
      NAVER_SCHEDULE_TIMEZONE,
      NAVER_SCHEDULE_MIN_LEAD_MINUTES
    )
  ) {
    return { date, adjustedFromPast: false };
  }

  return { date: nextSchedulableDateAtDefaultTime(), adjustedFromPast: true };
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
/**
 * 초안 수정 모드: 저장된 v2 패키지의 스펙/초안에 사용자 지시를 반영해 지정 섹션만 다시 쓴다.
 * 재스크랩·전체 재생성 없이 패키지를 갱신하고 result.json 을 남긴다.
 */
async function runPreparedPostRevision(
  linkId: string,
  connectKind: "SHOPPING" | "TRAVEL",
  brandLink: string,
  requestPath: string,
): Promise<void> {
  const outputDir = process.env.BRANDLINK_PREPARE_OUTPUT_DIR?.trim();
  if (!outputDir) throw new Error("BRANDLINK_PREPARE_OUTPUT_DIR 이 필요합니다.");
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8")) as { instructions?: unknown; sectionIndexes?: unknown };
  const instructions = typeof request.instructions === "string" ? request.instructions.trim() : "";
  if (!instructions) throw new Error("수정 지시가 비어 있습니다.");
  const sectionIndexes = Array.isArray(request.sectionIndexes)
    ? request.sectionIndexes.filter((value): value is number => Number.isInteger(value))
    : [];
  const prepared = loadPreparedBrandLinkPostOverride();
  if (!prepared?.spec || !prepared.draft) {
    throw new Error("이 초안은 스펙 정보가 없어 부분 수정을 지원하지 않습니다. 초안을 다시 생성하세요.");
  }
  console.log(`\n✏️ 초안 수정 모드: ${instructions.slice(0, 80)}${sectionIndexes.length ? ` (섹션 ${sectionIndexes.join(", ")})` : ""}`);
  const result = await reviseAssembledPost({
    spec: prepared.spec,
    draft: prepared.draft,
    instructions,
    sectionIndexes,
    brandLink,
    options: { quotationHeaders: NAVER_EDITOR_QUOTATION_ENABLED },
  });
  for (const note of result.notes) console.log(`   · ${note}`);
  console.log(`   🧪 검증: ${result.validation.summary}`);
  const post: GeneratedPostPreview = {
    title: result.title,
    sections: result.sections,
    hashtags: result.hashtags,
    rawResponse: "spec-first:revise",
    assembled: result,
    notes: result.notes,
  };
  const manifestPath = writePreparedBrandPostPackage({
    outputDir: path.resolve(outputDir),
    brandLinkId: linkId,
    connectKind,
    post,
    imagePaths: [prepared.heroImagePath, ...result.bodyImagePaths],
  });
  writePrepareResult(path.resolve(outputDir), {
    ok: result.validation.canPublish,
    code: result.validation.canPublish ? "OK" : "CONTENT_BLOCKED",
    message: result.validation.summary,
    readiness: { status: result.validation.status, score: result.validation.score, summary: result.validation.summary, repairTargets: result.validation.repair.targets },
  });
  console.log(`   📦 수정된 초안 패키지 저장: ${manifestPath}`);
  await prisma.brandLink.update({ where: { id: linkId }, data: { errorMessage: `초안 수정 완료 (${result.validation.status})` } });
}

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
  
  const reviseRequestPath = process.env.BRANDLINK_REVISE_REQUEST?.trim() || "";

  // 세션 확인 (초안 수정 모드는 네이버 세션이 필요 없다)
  if (!reviseRequestPath && !fs.existsSync(SESSION_FILE)) {
    console.error("❌ 네이버 로그인 세션이 없습니다. npm run login 실행하세요.");
    process.exit(1);
  }
  
  // DB에서 링크 조회
  const link = await prisma.brandLink.findUnique({ where: { id: linkId } });
  if (!link) {
    console.error("❌ 링크를 찾을 수 없습니다.");
    process.exit(1);
  }

  if (reviseRequestPath) {
    await runPreparedPostRevision(linkId, link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING", link.url, reviseRequestPath);
    return;
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
      `   ⚠️ 예약 가능한 ${NAVER_DEFAULT_SCHEDULE_TIME_LABEL} 시각이 지나 예약발행일을 ${runtimePublishOptions.scheduledDateInput}로 자동 조정했습니다.`
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
      channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
      headless: false,
      slowMo: 80,  // 더 자연스러운 속도
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
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
    // STEP 1: DB에 저장된 스크랩 결과를 우선 사용하고, 부족할 때만 보강 스크랩
    let product = await buildProductInfoFromStoredBrandLink({
      url: link.url,
      finalUrl: link.finalUrl,
      productName: link.productName,
      productPrice: link.productPrice,
      storeName: link.storeName,
      imageUrls: link.imageUrls,
    });

    if (product) {
      console.log("\n📦 STEP 1: 저장된 스크랩 결과 재사용");
      console.log(`   📌 상품명: ${product.name}`);
      console.log(`   💰 가격: ${product.price || "(없음)"}`);
      console.log(`   🖼️ 이미지: ${product.imagePaths.length}개`);
    }

    const needsLiveRefresh =
      !product ||
      !sanitizeText(product.name || "") ||
      product.imagePaths.length === 0;

    if (needsLiveRefresh) {
      const sourceUrl = link.finalUrl || link.url;
      if (product) {
        console.log("   ⚠️ 저장된 스크랩 정보가 부족해서 상품 페이지를 다시 확인합니다.");
      }
      const liveProduct = await step1_getProductInfo(page, sourceUrl);
      product = mergeProductInfo(product, liveProduct);
    }

    if (!product) {
      throw new Error("발행에 사용할 상품 정보를 확보하지 못했습니다.");
    }

    await prisma.brandLink.update({
      where: { id: linkId },
      data: {
        productName: product.name || undefined,
        productPrice: product.price || undefined,
        storeName: product.storeName || undefined,
        finalUrl: product.finalUrl || link.finalUrl || undefined,
        imageUrls:
          product.sourceImageUrls.length > 0 ? JSON.stringify(product.sourceImageUrls) : link.imageUrls,
        errorMessage: null,
      },
    });
    
    console.log("\n" + "-".repeat(40));
    console.log(`📦 상품: ${product.name}`);
    console.log(`💰 가격: ${product.price}`);
    console.log(`🖼️ 이미지: ${product.imagePaths.length}개`);
    console.log("-".repeat(40));
    
    const preparedPostOverride = loadPreparedBrandLinkPostOverride();
    const connectKindValue: "SHOPPING" | "TRAVEL" = link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
    // 여행 일정 요약 카드는 글보다 먼저 만들어 이미지 플랜의 입력이 되게 한다.
    const travelEditorialCardPath =
      link.connectKind === "TRAVEL" && !preparedPostOverride
        ? await generateTravelEditorialSummaryCard({
            productName: product.name,
            description: product.description,
            features: product.features,
            price: product.price,
            outputDir: TEMP_PATH,
          }).catch((error) => {
            console.log(`   ⚠️ 여행 일정 요약 카드 생성 실패: ${getErrorMessage(error)}`);
            return null;
          })
        : null;
    if (travelEditorialCardPath) {
      console.log(`   ✅ 여행 일정 요약 카드 생성: ${path.basename(travelEditorialCardPath)}`);
    }
    const specImageCandidates: ImageCandidateInput[] = [
      ...(product.representativeImagePath
        ? [{ path: product.representativeImagePath, kind: "hero" as const, score: 1000 }]
        : []),
      ...(travelEditorialCardPath ? [{ path: travelEditorialCardPath, kind: "card" as const, score: 900 }] : []),
      ...product.imagePaths.map((imagePath, index) => ({
        path: imagePath,
        kind: (path.basename(imagePath).includes("_detail_crop_") ? "crop" : "source") as ImageCandidateInput["kind"],
        score: 500 - index,
      })),
    ];
    setStage(preparedPostOverride ? "STEP2 준비된 원고 불러오기" : "STEP2 SEO 글 생성");
    // 승인된 준비 원고가 있으면 재생성하지 않고 그대로 사용한다.
    const post = preparedPostOverride?.post ?? await step2_generatePost(
      product,
      link.url,
      link.id,
      connectKindValue,
      { imageCandidates: specImageCandidates, tempDir: TEMP_PATH, memo: process.env.BRANDLINK_DRAFT_MEMO?.trim() || null }
    );
    if (preparedPostOverride) {
      console.log(`   ✅ 승인 원고 적용: ${post.title}`);
      console.log(`   ✅ 승인 이미지 적용: ${1 + preparedPostOverride.bodyImagePaths.length}장`);
    }
    const assembled: AssembledPost | null = post.assembled ?? null;

    setStage("STEP2.5 대표 썸네일 생성");
    const generatedThumbnail: GeneratedProductThumbnail | null = preparedPostOverride
      ? { path: preparedPostOverride.heroImagePath, source: "codex-imagegen" }
      : await generateTopTextCutoutThumbnail(
          product,
          post.title,
          link.id,
          link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING",
        );
    const generatedThumbnailPath = generatedThumbnail?.path || null;
    let uploadImagePaths: string[];
    let collectedImagePaths: string[];
    if (assembled) {
      // Spec-first: 슬롯이 확정한 이미지 목록을 그대로 쓴다. 첫 장(hero)만 생성 썸네일로 교체한다.
      const heroPath = generatedThumbnailPath || assembled.heroImagePath;
      collectedImagePaths = [...(heroPath ? [heroPath] : []), ...assembled.bodyImagePaths];
      const seenUpload = new Set<string>();
      uploadImagePaths = collectedImagePaths.filter((imagePath) => {
        if (!imagePath || !fs.existsSync(imagePath)) return false;
        const resolved = path.resolve(imagePath);
        if (seenUpload.has(resolved)) return false;
        seenUpload.add(resolved);
        return true;
      });
    } else {
      collectedImagePaths = Array.from(new Set(preparedPostOverride
        ? [preparedPostOverride.heroImagePath, ...preparedPostOverride.bodyImagePaths]
        : [
            ...(generatedThumbnailPath ? [generatedThumbnailPath] : []),
            ...(travelEditorialCardPath ? [travelEditorialCardPath] : []),
            ...(product.representativeImagePath ? [product.representativeImagePath] : []),
            ...product.imagePaths,
          ]));
      uploadImagePaths = await buildBlogUploadImagePaths({
        imagePaths: collectedImagePaths,
        generatedThumbnailPath,
        representativeImagePath: product.representativeImagePath,
        editorialImagePath: travelEditorialCardPath,
      });
    }
    product.imagePaths = uploadImagePaths;
    if (generatedThumbnailPath) {
      console.log(
        `   ✅ 이미지 우선순위: [썸네일(${generatedThumbnail?.source}), 대표이미지, 본문이미지...] (${product.imagePaths.length}개)`
      );
    } else {
      console.log(
        `   ✅ 이미지 우선순위: [대표이미지, 본문이미지...] (${product.imagePaths.length}개)`
      );
    }
    const skippedUploadImageCount = Math.max(0, collectedImagePaths.length - uploadImagePaths.length);
    if (skippedUploadImageCount > 0) {
      console.log(
        `   🧹 본문 이미지 필터: 상세페이지 조각/설명판 후보 ${skippedUploadImageCount}개 제외, 업로드 ${uploadImagePaths.length}개`
      );
    }

    let contentReadiness: BrandLinkContentReadiness | null = null;
    if (assembled) {
      const validation = assembled.validation;
      console.log(`   🧪 스펙 검증 게이트: ${validation.summary}`);
      for (const signal of validation.signals.filter((item) => item.status !== "pass")) {
        console.log(`      - ${signal.status.toUpperCase()} ${signal.label}${signal.detail ? ` (${signal.detail})` : ""}`);
      }
      if (validation.repair.targets.length > 0) {
        console.log(`      · 남은 수리 대상 ${validation.repair.targets.length}건: ${validation.repair.targets.slice(0, 4).map((item) => `${item.sectionIndex ?? "제목"}:${item.code}`).join(", ")}`);
      }
      if (!validation.canPublish) {
        throw new Error(validation.summary);
      }
    } else if (BRANDLINK_CONTENT_READINESS_ENABLED) {
      contentReadiness = getBrandLinkContentReadiness({
        productName: product.name,
        title: post.title,
        sections: post.sections,
        hashtags: post.hashtags,
        brandLink: link.url,
        hasRepresentativeImage: Boolean(product.representativeImagePath),
        requireRepresentativeImage: BRANDLINK_REQUIRE_REPRESENTATIVE_IMAGE,
        thumbnailGenerated:
          Boolean(generatedThumbnailPath) && generatedThumbnail?.source !== "composite",
      });

      console.log(`   🧪 상품글 발행 게이트: ${contentReadiness.summary}`);
      for (const signal of contentReadiness.signals) {
        const mark =
          signal.status === "pass" ? "PASS" : signal.status === "warn" ? "WARN" : "FAIL";
        console.log(`      - ${mark} ${signal.label}`);
      }

      if (!contentReadiness.canPublish) {
        throw new Error(contentReadiness.reason || contentReadiness.summary);
      }
    }

    let previewPath: string | null = null;
    const prepareOutputDir = process.env.BRANDLINK_PREPARE_OUTPUT_DIR?.trim();
    if (prepareOutputDir) {
      const manifestPath = writePreparedBrandPostPackage({
        outputDir: path.resolve(prepareOutputDir),
        brandLinkId: linkId,
        connectKind: link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING",
        post,
        imagePaths: product.imagePaths,
      });
      console.log(`   📦 승인 대기 초안 패키지 저장: ${manifestPath}`);
      writePrepareResult(path.resolve(prepareOutputDir), {
        ok: true,
        code: "OK",
        message: assembled ? assembled.validation.summary : "초안 생성 완료",
        readiness: assembled
          ? { status: assembled.validation.status, score: assembled.validation.score, summary: assembled.validation.summary, repairTargets: assembled.validation.repair.targets }
          : null,
      });
    }
    if (DEBUG_SAVE_GENERATED_POST || DRY_RUN_GENERATE_ONLY) {
      previewPath = saveGeneratedPostPreview(linkId, post, product, contentReadiness);
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
      shoppingConnectUrl: link.url,
      shoppingConnectProductName: product.name,
      shoppingConnectProductFinalUrl: product.finalUrl || link.finalUrl,
      requiredFirstImagePath: generatedThumbnailPath,
      connectKind: link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING",
      composition: assembled?.composition ?? preparedPostOverride?.composition ?? null,
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
      const scheduledTimeLabel =
        publishOptions.scheduledTimeLabel ??
        toScheduleTimeLabel(
          String(scheduledDate?.getHours() ?? NAVER_DEFAULT_SCHEDULE_HOUR),
          String(scheduledDate?.getMinutes() ?? NAVER_DEFAULT_SCHEDULE_MINUTE)
        ) ??
        NAVER_DEFAULT_SCHEDULE_TIME_LABEL;
      if (!scheduledDate || !scheduledDateInput) {
        throw new Error("예약 발행 날짜가 누락되었습니다.");
      }
      const scheduledDateForDb = createScheduledPublishDate(scheduledDateInput, scheduledTimeLabel);
      if (!scheduledDateForDb || Number.isNaN(scheduledDateForDb.getTime())) {
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
      if (scheduledTimeLabel !== NAVER_DEFAULT_SCHEDULE_TIME_LABEL) {
        console.log(
          `   ⚠️ 예약 시간이 ${NAVER_DEFAULT_SCHEDULE_TIME_LABEL} → ${scheduledTimeLabel}로 적용되었습니다.`
        );
      }

      console.log("\n" + "=".repeat(50));
      console.log("🗓️ 예약 발행 등록 완료!");
      console.log(`📅 예약발행일: ${scheduledDateInput} ${scheduledTimeLabel}`);
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

      if ((process.env.CHATBOT_NOTIFY_SINGLE || "").toLowerCase() === "true") {
        await notifyAndLogCompletion({
          taskType: "brandconnect.publish.schedule",
          title: "예약 발행 등록 완료",
          summary: `${product.name} 예약발행 등록 완료 (${scheduledDateInput} ${scheduledTimeLabel})`,
          successCount: 1,
          failedCount: 0,
          links: [
            {
              label: product.name,
              url: buildAppUrl(`/?brandLinkId=${linkId}`),
              scheduledDate: scheduledDateInput,
              status: "SCHEDULED",
              description: "예약발행 확인",
            },
          ],
          extra: {
            linkId,
            scheduledDate: scheduledDateInput,
            scheduledTime: scheduledTimeLabel,
          },
        });
      }
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

      if ((process.env.CHATBOT_NOTIFY_SINGLE || "").toLowerCase() === "true") {
        await notifyAndLogCompletion({
          taskType: "brandconnect.publish.now",
          title: "바로 발행 완료",
          summary: `${product.name} 발행 완료`,
          successCount: 1,
          failedCount: 0,
          links: [
            {
              label: product.name,
              url: publishedUrl,
              status: "PUBLISHED",
              description: "발행글",
            },
          ],
          extra: {
            linkId,
          },
        });
      }
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
    // 초안 생성/수정 모드라면 원인을 코드와 함께 패키지 디렉터리에 남긴다(라우트·MCP가 읽음).
    const prepareOutputDirOnError = process.env.BRANDLINK_PREPARE_OUTPUT_DIR?.trim();
    if (prepareOutputDirOnError) {
      writePrepareResult(path.resolve(prepareOutputDirOnError), {
        ok: false,
        code: classifyFailureCode(getErrorMessage(error)),
        message,
      });
    }
    // 호출 API가 성공(0)으로 오인해 뒤늦게 "manifest 없음"만 표시하지 않도록
    // 실제 실패를 프로세스 종료 코드로 전달한다.
    process.exitCode = 1;
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

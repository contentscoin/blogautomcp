import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { Browser } from "playwright";
import { requireAdminApiKey } from "@/lib/api-auth";
import { buildCaptureRequiredPayload, getShoppingCategoryIdFromUrl, getSpaceIdFromConnectUrl, parseConnectKind, resolveConnectContract } from "@/lib/brandconnect-kind";

export const runtime = "nodejs";

const DEFAULT_CATEGORY_URL =
  "https://brandconnect.naver.com/916297527319296/affiliate/products/category/10031299";
const BRANDCONNECT_OPTION_CATEGORY_LIMIT = parseBoundedInteger(
  process.env.BRANDCONNECT_OPTION_CATEGORY_LIMIT,
  36,
  1,
  80
);
const BRANDCONNECT_OPTION_PRODUCT_LIMIT = parseBoundedInteger(
  process.env.BRANDCONNECT_OPTION_PRODUCT_LIMIT,
  60,
  20,
  100
);
const BRANDCONNECT_RENDERED_OPTION_TIMEOUT_MS = parseBoundedInteger(
  process.env.BRANDCONNECT_RENDERED_OPTION_TIMEOUT_MS,
  30000,
  5000,
  60000
);
const BRANDCONNECT_RENDERED_PROMOTION_SCAN_ENABLED =
  (process.env.BRANDCONNECT_RENDERED_PROMOTION_SCAN_ENABLED || "true").toLowerCase() !== "false";

interface StoredCookie {
  name?: string;
  value?: string;
  domain?: string;
  expires?: number;
}

interface DisplayCategory {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  productCount: number;
}

interface ProductApiItem {
  productName: string;
  storeName: string;
  badgeTexts: string[];
}

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function resolveStorageStatePath(): string {
  const configured = process.env.NAVER_STORAGE_STATE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }
  const storageDir = process.env.SESSION_STORAGE_DIR?.trim();
  return path.join(storageDir || path.join(process.cwd(), "playwright", "storage"), "naver-session.json");
}

function isDomainMatch(hostname: string, cookieDomain: string): boolean {
  const normalized = cookieDomain.replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function buildCookieHeaderForHost(storageStatePath: string, hostname: string): string {
  const raw = fs.readFileSync(storageStatePath, "utf8");
  const parsed = JSON.parse(raw) as { cookies?: StoredCookie[] };
  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const nowSec = Date.now() / 1000;

  return cookies
    .filter((cookie) => {
      if (!cookie.name || cookie.value === undefined || !cookie.domain) return false;
      if (!isDomainMatch(hostname, cookie.domain)) return false;
      if (typeof cookie.expires === "number" && cookie.expires > 0 && cookie.expires <= nowSec) {
        return false;
      }
      return true;
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function fetchBrandConnectJson(
  url: string,
  spaceId: string,
  cookieHeader: string,
  referer: string
): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: cookieHeader,
      origin: "https://brandconnect.naver.com",
      referer,
      "x-space-id": spaceId,
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function fetchBrandConnectText(
  url: string,
  spaceId: string,
  cookieHeader: string,
  referer: string
): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: cookieHeader,
      referer,
      "x-space-id": spaceId,
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) return null;
  return response.text().catch(() => null);
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

const PROMOTION_TEXT_PATTERN =
  /(오늘출발|무료배송|쿠폰|할인|특가|핫딜|타임딜|이벤트|기획전|프로모션|혜택|베스트|인기|추천|시즌|MD\s*추천|MD추천|적립|도착보장|N배송|단독|한정|사은품|행사|선착순|증정|마감|쇼핑라이브|라이브)/i;
const STRONG_PROMOTION_TEXT_PATTERN =
  /(오늘출발|무료배송|쿠폰|할인|특가|핫딜|타임딜|이벤트|기획전|프로모션|혜택|MD\s*추천|MD추천|적립|도착보장|N배송|단독|한정|사은품|행사|선착순|증정|마감|쇼핑라이브|라이브)/i;

function normalizePromotionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isPromotionLikeText(value: string): boolean {
  const normalized = normalizePromotionText(value);
  if (!normalized || normalized.length > 36) return false;
  if (/https?:|brandconnect|naver\.com|상품명|productName|로그인|회원가입|고객센터/i.test(normalized)) return false;
  if (/^\[[^\]]+\]\s+/.test(normalized) && normalized.length > 18) return false;
  if (
    normalized.length > 18 &&
    /\d+(?:\.\d+)?\s*(?:ml|l|g|kg|cm|mm|개|매|팩|세트|입|봉|병|p|pa|mah|w|원)/i.test(normalized)
  ) {
    return false;
  }
  if (normalized.length > 16 && !STRONG_PROMOTION_TEXT_PATTERN.test(normalized)) return false;
  return PROMOTION_TEXT_PATTERN.test(normalized);
}

function extractPromotionCandidatesFromText(value: string): string[] {
  const normalized = normalizePromotionText(value);
  if (!normalized) return [];

  const direct = isPromotionLikeText(normalized) ? [normalized] : [];
  const pieces = normalized
    .split(/[\n\r\t|·•,>]+/u)
    .map((piece) => normalizePromotionText(piece))
    .filter(Boolean);
  const phraseCandidates =
    normalized.match(/[\p{L}\p{N}%+&/.-]{1,24}(?:\s+[\p{L}\p{N}%+&/.-]{1,24}){0,3}/gu) || [];

  return Array.from(
    new Set(
      [...direct, ...pieces, ...phraseCandidates]
        .map((candidate) => normalizePromotionText(candidate))
        .filter(isPromotionLikeText)
    )
  );
}

function collectBadgeTexts(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectBadgeTexts(entry, depth + 1));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const directKeys = [
      "text",
      "name",
      "label",
      "title",
      "badgeDescription",
      "badgeName",
      "tagName",
      "displayName",
      "typeName",
    ];
    const direct = directKeys.flatMap((key) => collectBadgeTexts(obj[key], depth + 1));
    if (direct.length > 0) return direct;
    return Object.values(obj).flatMap((entry) => collectBadgeTexts(entry, depth + 1));
  }
  return [];
}

function collectPromotionLikeTexts(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    const normalized = normalizePromotionText(value);
    return isPromotionLikeText(normalized) ? [normalized] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPromotionLikeTexts(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      collectPromotionLikeTexts(entry, depth + 1)
    );
  }
  return [];
}

function parseBadgeTexts(obj: Record<string, unknown>): string[] {
  const badgeKeys = [
    "badges",
    "badgeList",
    "badgeTexts",
    "tags",
    "tagList",
    "labels",
    "benefits",
    "benefitList",
    "promotion",
    "promotionList",
    "productBadges",
    "displayBadges",
    "promotionBadges",
    "marketingTags",
    "event",
    "eventList",
    "eventBadges",
    "benefitBadges",
  ];
  return Array.from(
    new Set(
      [
        ...badgeKeys.flatMap((key) => collectBadgeTexts(obj[key])),
        ...badgeKeys.flatMap((key) => collectPromotionLikeTexts(obj[key])),
      ]
        .map((text) => text.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);
}

function collectPromotionTextsFromHtml(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(new Set(extractPromotionCandidatesFromText(text))).slice(0, 80);
}

async function collectPromotionTextsFromRenderedPage(
  categoryUrl: string,
  storageStatePath: string
): Promise<string[]> {
  if (!BRANDCONNECT_RENDERED_PROMOTION_SCAN_ENABLED) return [];

  let browser: Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
      headless: true,
    });
    const context = await browser.newContext({
      storageState: storageStatePath,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(categoryUrl, {
      waitUntil: "domcontentloaded",
      timeout: BRANDCONNECT_RENDERED_OPTION_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const rawTexts = (await page.evaluate(() => {
      const selectors = [
        "button",
        '[role="tab"]',
        '[role="button"]',
        '[class*="Tab"]',
        '[class*="tab"]',
        '[class*="Filter"]',
        '[class*="filter"]',
        '[class*="Badge"]',
        '[class*="badge"]',
        '[class*="Benefit"]',
        '[class*="benefit"]',
        '[class*="Chip"]',
        '[class*="chip"]',
        '[class*="Event"]',
        '[class*="event"]',
        '[class*="Promotion"]',
        '[class*="promotion"]',
      ];
      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const elements = new Set<Element>();
      for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          if (isVisible(element)) elements.add(element);
        }
      }

      return Array.from(elements)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0 && text.length <= 120);
    })) as string[];

    await context.close().catch(() => {});
    return Array.from(
      new Set(rawTexts.flatMap((text: string) => extractPromotionCandidatesFromText(text)))
    ).slice(0, 80);
  } catch (error: unknown) {
    console.warn("BrandConnect rendered promotion scan failed:", getErrorMessage(error));
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}

function parseDisplayCategories(payload: unknown, parentId: string | null, depth: number): DisplayCategory[] {
  const rows = Array.isArray(payload)
    ? payload
    : typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as { categories?: unknown[] }).categories)
      ? (payload as { categories: unknown[] }).categories
      : [];

  const parsed: DisplayCategory[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const obj = row as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : String(parseNumber(obj.id) || "");
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!id || !name) continue;
    parsed.push({ id, name, parentId, depth, productCount: 0 });
  }
  return parsed;
}

function parseProductApiItems(payload: unknown): ProductApiItem[] {
  const rows =
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: unknown[] }).data
      : [];

  const parsed: ProductApiItem[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const obj = row as Record<string, unknown>;
    const productName = typeof obj.productName === "string" ? obj.productName.trim() : "";
    if (!productName) continue;
    parsed.push({
      productName,
      storeName: typeof obj.storeName === "string" ? obj.storeName.trim() : "",
      badgeTexts: parseBadgeTexts(obj),
    });
  }
  return parsed;
}

async function fetchDisplayCategories(
  categoryId: string,
  spaceId: string,
  cookieHeader: string,
  referer: string,
  parentId: string | null,
  depth: number
): Promise<DisplayCategory[]> {
  const url = new URL("https://gw-brandconnect.naver.com/affiliate/query/display-categories");
  url.searchParams.set("displayCategoryId", categoryId);
  const payload = await fetchBrandConnectJson(url.toString(), spaceId, cookieHeader, referer);
  return parseDisplayCategories(payload, parentId, depth);
}

async function fetchBaseDisplayCategories(
  spaceId: string,
  cookieHeader: string,
  referer: string
): Promise<DisplayCategory[]> {
  const payload = await fetchBrandConnectJson(
    "https://gw-brandconnect.naver.com/affiliate/query/base-display-categories",
    spaceId,
    cookieHeader,
    referer
  );
  return parseDisplayCategories(payload, null, 0);
}

async function fetchProductsForDisplayCategory(
  categoryId: string,
  spaceId: string,
  cookieHeader: string,
  referer: string
): Promise<ProductApiItem[]> {
  const url = new URL(
    "https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/search-by-display-category"
  );
  url.searchParams.set("displayCategoryId", categoryId);
  url.searchParams.set("limit", String(BRANDCONNECT_OPTION_PRODUCT_LIMIT));
  const payload = await fetchBrandConnectJson(url.toString(), spaceId, cookieHeader, referer);
  return parseProductApiItems(payload);
}

function addCategory(map: Map<string, DisplayCategory>, category: DisplayCategory): void {
  const existing = map.get(category.id);
  if (!existing) {
    map.set(category.id, category);
    return;
  }
  if (!existing.name && category.name) existing.name = category.name;
  existing.depth = Math.min(existing.depth, category.depth);
  existing.parentId = existing.parentId || category.parentId;
}

function addPromotion(
  map: Map<string, { value: string; label: string; count: number }>,
  value: string
): void {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 40) return;
  const current = map.get(normalized);
  if (current) {
    current.count += 1;
    return;
  }
  map.set(normalized, { value: normalized, label: normalized, count: 1 });
}

export async function GET(request: NextRequest) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) return authError;

    const connectKind = parseConnectKind(request.nextUrl.searchParams.get("connectKind"));
    const contract = resolveConnectContract(connectKind, request.nextUrl.searchParams.get("categoryUrl"));
    if (contract.captureRequired) {
      return NextResponse.json({ success: false, error: buildCaptureRequiredPayload(contract) }, { status: 501 });
    }
    const categoryUrl = contract.configuredUrl || DEFAULT_CATEGORY_URL;
    const spaceId = getSpaceIdFromConnectUrl(categoryUrl);
    const rootCategoryId = getShoppingCategoryIdFromUrl(categoryUrl);
    if (!spaceId || !rootCategoryId) {
      return NextResponse.json(
        { success: false, error: "BrandConnect categoryUrl에서 spaceId/categoryId를 찾지 못했습니다." },
        { status: 400 }
      );
    }

    const storageStatePath = resolveStorageStatePath();
    if (!fs.existsSync(storageStatePath)) {
      return NextResponse.json(
        {
          success: false,
          error: `네이버 로그인 세션 파일이 없습니다: ${storageStatePath}`,
        },
        { status: 400 }
      );
    }

    const cookieHeader = buildCookieHeaderForHost(storageStatePath, "brandconnect.naver.com");
    if (!cookieHeader) {
      return NextResponse.json(
        { success: false, error: "BrandConnect에 사용할 네이버 세션 쿠키가 없습니다." },
        { status: 400 }
      );
    }

    const categoriesById = new Map<string, DisplayCategory>();
    addCategory(categoriesById, {
      id: rootCategoryId,
      name: "현재 카테고리",
      parentId: null,
      depth: 0,
      productCount: 0,
    });

    const [baseCategories, rootChildren] = await Promise.all([
      fetchBaseDisplayCategories(spaceId, cookieHeader, categoryUrl),
      fetchDisplayCategories(rootCategoryId, spaceId, cookieHeader, categoryUrl, rootCategoryId, 1),
    ]);

    for (const category of baseCategories) addCategory(categoriesById, category);
    for (const category of rootChildren) addCategory(categoriesById, category);

    for (const category of baseCategories.slice(0, 12)) {
      if (categoriesById.size >= BRANDCONNECT_OPTION_CATEGORY_LIMIT) break;
      const children = await fetchDisplayCategories(
        category.id,
        spaceId,
        cookieHeader,
        categoryUrl,
        category.id,
        1
      );
      for (const child of children) {
        addCategory(categoriesById, child);
        if (categoriesById.size >= BRANDCONNECT_OPTION_CATEGORY_LIMIT) break;
      }
    }

    const categories = Array.from(categoriesById.values()).slice(0, BRANDCONNECT_OPTION_CATEGORY_LIMIT);
    const promotionMap = new Map<string, { value: string; label: string; count: number }>();
    const categoryPageHtml = await fetchBrandConnectText(
      categoryUrl,
      spaceId,
      cookieHeader,
      categoryUrl
    ).catch(() => null);

    if (categoryPageHtml) {
      for (const promotionText of collectPromotionTextsFromHtml(categoryPageHtml)) {
        addPromotion(promotionMap, promotionText);
      }
    }

    const renderedPromotionTexts = await collectPromotionTextsFromRenderedPage(
      categoryUrl,
      storageStatePath
    );
    for (const promotionText of renderedPromotionTexts) {
      addPromotion(promotionMap, promotionText);
    }

    for (const category of categories) {
      const products = await fetchProductsForDisplayCategory(
        category.id,
        spaceId,
        cookieHeader,
        categoryUrl
      );
      category.productCount = products.length;

      for (const product of products) {
        for (const badge of product.badgeTexts) addPromotion(promotionMap, badge);
      }
    }

    const promotions = Array.from(promotionMap.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"))
      .slice(0, 60);

    return NextResponse.json({
      success: true,
      data: {
        connectKind,
        categoryUrl,
        categories,
        promotions,
      },
    });
  } catch (error: unknown) {
    console.error("BrandConnect selection options load failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

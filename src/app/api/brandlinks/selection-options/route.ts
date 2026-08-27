import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import type { Browser } from "playwright";
import { requireAdminApiKey } from "@/lib/api-auth";
import {
  buildCaptureRequiredPayload,
  getShoppingCategoryIdFromUrl,
  getSpaceIdFromConnectUrl,
  parseConnectKind,
  type ConnectKind,
} from "@/lib/brandconnect-kind";
import { resolveConnectContract } from "@/lib/connect-contract-store";
import { buildCookieHeaderForHost, getNaverSessionFile } from "@/lib/naver-session";
import {
  ConnectContractNotFoundError,
  ConnectSessionExpiredError,
  listTravelItems,
} from "@/lib/travel-connect-adapter";
import type { ConnectItem } from "@/lib/connect-item";

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
  20000,
  5000,
  60000
);
/**
 * 렌더링 기반 프로모션 스캔은 headless Chrome을 띄운다. 브랜드커넥트는 headless에서
 * 첫 응답 전에 멈추는 경우가 있어 요청 전체가 무한정 매달리곤 했다. 기본값은 끔이고,
 * 켜더라도 아래 예산 안에서만 돌린다.
 */
const BRANDCONNECT_RENDERED_PROMOTION_SCAN_ENABLED =
  (process.env.BRANDCONNECT_RENDERED_PROMOTION_SCAN_ENABLED || "false").toLowerCase() === "true";
/** 개별 BrandConnect API 호출 타임아웃. 없으면 소켓이 물릴 때 영원히 기다린다. */
const BRANDCONNECT_REQUEST_TIMEOUT_MS = parseBoundedInteger(
  process.env.BRANDCONNECT_REQUEST_TIMEOUT_MS,
  8000,
  2000,
  30000
);
/** 이 라우트 전체 예산. 초과하면 지금까지 모은 결과를 부분 응답으로 돌려준다. */
const BRANDCONNECT_OPTION_BUDGET_MS = parseBoundedInteger(
  process.env.BRANDCONNECT_OPTION_BUDGET_MS,
  45000,
  10000,
  120000
);
const BRANDCONNECT_REQUEST_CONCURRENCY = parseBoundedInteger(
  process.env.BRANDCONNECT_REQUEST_CONCURRENCY,
  6,
  1,
  12
);

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

interface PromotionOption {
  value: string;
  label: string;
  count: number;
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

/** 남은 예산을 추적한다. 각 단계는 시작 전에 여유가 있는지 확인한다. */
class Deadline {
  private readonly endsAt: number;

  constructor(budgetMs: number) {
    this.endsAt = Date.now() + budgetMs;
  }

  remaining(): number {
    return Math.max(0, this.endsAt - Date.now());
  }

  expired(reserveMs = 0): boolean {
    return this.remaining() <= reserveMs;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

type JsonResult =
  | { ok: true; payload: unknown }
  | { ok: false; status: number | null; unauthorized: boolean };

async function fetchBrandConnectJson(
  url: string,
  spaceId: string,
  cookieHeader: string,
  referer: string,
  timeoutMs: number
): Promise<JsonResult> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: cookieHeader,
      origin: "https://brandconnect.naver.com",
      referer,
      "x-space-id": spaceId,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!response) return { ok: false, status: null, unauthorized: false };
  if (!response.ok) {
    return { ok: false, status: response.status, unauthorized: response.status === 401 || response.status === 403 };
  }

  const payload = await response.json().catch(() => null);
  if (payload === null) return { ok: false, status: response.status, unauthorized: false };
  return { ok: true, payload };
}

async function fetchBrandConnectText(
  url: string,
  spaceId: string,
  cookieHeader: string,
  referer: string,
  timeoutMs: number
): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: cookieHeader,
      referer,
      "x-space-id": spaceId,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
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

const BADGE_KEYS = [
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

function parseBadgeTexts(obj: Record<string, unknown>): string[] {
  return Array.from(
    new Set(
      [
        ...BADGE_KEYS.flatMap((key) => collectBadgeTexts(obj[key])),
        ...BADGE_KEYS.flatMap((key) => collectPromotionLikeTexts(obj[key])),
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
  storageStatePath: string,
  budgetMs: number
): Promise<string[]> {
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
      timeout: Math.min(BRANDCONNECT_RENDERED_OPTION_TIMEOUT_MS, budgetMs),
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

/**
 * headless Chrome이 응답 전에 멈춰도 요청 전체를 붙잡지 못하게, 예산을 넘기면
 * 스캔 결과를 포기하고 진행한다(브라우저는 위 finally에서 정리된다).
 */
async function collectRenderedPromotionsWithinBudget(
  categoryUrl: string,
  storageStatePath: string,
  budgetMs: number
): Promise<string[]> {
  if (!BRANDCONNECT_RENDERED_PROMOTION_SCAN_ENABLED || budgetMs <= 0) return [];
  return Promise.race([
    collectPromotionTextsFromRenderedPage(categoryUrl, storageStatePath, budgetMs),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), budgetMs)),
  ]);
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

function addPromotion(map: Map<string, PromotionOption>, value: string): void {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 40) return;
  const current = map.get(normalized);
  if (current) {
    current.count += 1;
    return;
  }
  map.set(normalized, { value: normalized, label: normalized, count: 1 });
}

function sortPromotions(map: Map<string, PromotionOption>): PromotionOption[] {
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"))
    .slice(0, 60);
}

interface ShoppingOptions {
  categories: DisplayCategory[];
  promotions: PromotionOption[];
  truncated: boolean;
  sessionExpired: boolean;
}

async function loadShoppingOptions(
  categoryUrl: string,
  spaceId: string,
  rootCategoryId: string,
  cookieHeader: string,
  storageStatePath: string,
  deadline: Deadline
): Promise<ShoppingOptions> {
  let sessionExpired = false;
  let truncated = false;

  const requestJson = async (url: string): Promise<unknown | null> => {
    const timeout = Math.min(BRANDCONNECT_REQUEST_TIMEOUT_MS, deadline.remaining());
    if (timeout <= 0) {
      truncated = true;
      return null;
    }
    const result = await fetchBrandConnectJson(url, spaceId, cookieHeader, categoryUrl, timeout);
    if (result.ok) return result.payload;
    if (result.unauthorized) sessionExpired = true;
    return null;
  };

  const fetchDisplayCategories = async (
    categoryId: string,
    parentId: string | null,
    depth: number
  ): Promise<DisplayCategory[]> => {
    const url = new URL("https://gw-brandconnect.naver.com/affiliate/query/display-categories");
    url.searchParams.set("displayCategoryId", categoryId);
    return parseDisplayCategories(await requestJson(url.toString()), parentId, depth);
  };

  const fetchProductsForDisplayCategory = async (categoryId: string): Promise<ProductApiItem[]> => {
    const url = new URL(
      "https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/search-by-display-category"
    );
    url.searchParams.set("displayCategoryId", categoryId);
    url.searchParams.set("limit", String(BRANDCONNECT_OPTION_PRODUCT_LIMIT));
    return parseProductApiItems(await requestJson(url.toString()));
  };

  const categoriesById = new Map<string, DisplayCategory>();
  addCategory(categoriesById, {
    id: rootCategoryId,
    name: "현재 카테고리",
    parentId: null,
    depth: 0,
    productCount: 0,
  });

  // 두 요청을 먼저 띄운 뒤 함께 기다린다. 배열 리터럴 안에서 await 하면
  // 첫 요청이 끝날 때까지 두 번째 요청이 시작조차 하지 않는다.
  const basePromise = requestJson(
    "https://gw-brandconnect.naver.com/affiliate/query/base-display-categories"
  );
  const rootChildrenPromise = fetchDisplayCategories(rootCategoryId, rootCategoryId, 1);
  const [basePayload, rootChildren] = await Promise.all([basePromise, rootChildrenPromise]);
  const baseCategories = parseDisplayCategories(basePayload, null, 0);

  for (const category of baseCategories) addCategory(categoriesById, category);
  for (const category of rootChildren) addCategory(categoriesById, category);

  // 예전에는 하위 카테고리를 12번 순차 호출했다. 병렬로 바꿔 왕복 지연을 없앤다.
  if (!deadline.expired(5000)) {
    const childGroups = await mapWithConcurrency(
      baseCategories.slice(0, 12),
      BRANDCONNECT_REQUEST_CONCURRENCY,
      (category) => fetchDisplayCategories(category.id, category.id, 1)
    );
    for (const children of childGroups) {
      for (const child of children) {
        if (categoriesById.size >= BRANDCONNECT_OPTION_CATEGORY_LIMIT) break;
        addCategory(categoriesById, child);
      }
    }
  } else {
    truncated = true;
  }

  const categories = Array.from(categoriesById.values()).slice(0, BRANDCONNECT_OPTION_CATEGORY_LIMIT);
  const promotionMap = new Map<string, PromotionOption>();

  if (!deadline.expired(5000)) {
    const categoryPageHtml = await fetchBrandConnectText(
      categoryUrl,
      spaceId,
      cookieHeader,
      categoryUrl,
      Math.min(BRANDCONNECT_REQUEST_TIMEOUT_MS, deadline.remaining())
    ).catch(() => null);
    if (categoryPageHtml) {
      for (const promotionText of collectPromotionTextsFromHtml(categoryPageHtml)) {
        addPromotion(promotionMap, promotionText);
      }
    }
  }

  // 카테고리별 상품 조회도 병렬화한다(예전에는 최대 36회 순차 호출).
  if (!deadline.expired(3000)) {
    const productGroups = await mapWithConcurrency(
      categories,
      BRANDCONNECT_REQUEST_CONCURRENCY,
      (category) => fetchProductsForDisplayCategory(category.id)
    );
    for (const [index, products] of productGroups.entries()) {
      categories[index].productCount = products.length;
      for (const product of products) {
        for (const badge of product.badgeTexts) addPromotion(promotionMap, badge);
      }
    }
  } else {
    truncated = true;
  }

  // 남은 예산이 넉넉할 때만 렌더링 스캔을 시도한다(기본은 꺼져 있다).
  const renderedBudget = Math.min(BRANDCONNECT_RENDERED_OPTION_TIMEOUT_MS, deadline.remaining() - 2000);
  for (const promotionText of await collectRenderedPromotionsWithinBudget(
    categoryUrl,
    storageStatePath,
    renderedBudget
  )) {
    addPromotion(promotionMap, promotionText);
  }

  return { categories, promotions: sortPromotions(promotionMap), truncated, sessionExpired };
}

/** 여행 항목 행에서 카테고리처럼 쓸 수 있는 값(테마/지역/도시 등)을 찾는다. */
const TRAVEL_GROUPING_KEY_PATTERN = /(category|theme|region|area|city|country|destination|type|genre)/;

function buildTravelCategories(items: ConnectItem[]): DisplayCategory[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    for (const [key, value] of Object.entries(item.raw)) {
      if (!TRAVEL_GROUPING_KEY_PATTERN.test(key.toLowerCase())) continue;
      const label = typeof value === "string" ? value.trim() : "";
      if (!label || label.length > 40) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return [{ id: "all", name: "전체", parentId: null, depth: 0, productCount: items.length }];
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, BRANDCONNECT_OPTION_CATEGORY_LIMIT)
    .map(([name, productCount]) => ({ id: name, name, parentId: null, depth: 0, productCount }));
}

function buildTravelPromotions(items: ConnectItem[]): PromotionOption[] {
  const promotionMap = new Map<string, PromotionOption>();
  for (const item of items) {
    for (const text of parseBadgeTexts(item.raw)) addPromotion(promotionMap, text);
    for (const text of collectPromotionLikeTexts(item.raw)) addPromotion(promotionMap, text);
  }
  return sortPromotions(promotionMap);
}

export async function GET(request: NextRequest) {
  const deadline = new Deadline(BRANDCONNECT_OPTION_BUDGET_MS);
  let connectKind: ConnectKind = "shopping";

  try {
    const authError = requireAdminApiKey(request);
    if (authError) return authError;

    connectKind = parseConnectKind(request.nextUrl.searchParams.get("connectKind"));
    const contract = resolveConnectContract(connectKind, request.nextUrl.searchParams.get("categoryUrl"));
    if (contract.captureRequired) {
      return NextResponse.json({ success: false, error: buildCaptureRequiredPayload(contract) }, { status: 501 });
    }

    const storageStatePath = getNaverSessionFile();
    if (!fs.existsSync(storageStatePath)) {
      return NextResponse.json(
        { success: false, error: `네이버 로그인 세션 파일이 없습니다: ${storageStatePath}` },
        { status: 400 }
      );
    }

    if (connectKind === "travel") {
      const { items, contract: stored, source } = await listTravelItems({
        categoryUrl: contract.configuredUrl,
        limit: BRANDCONNECT_OPTION_PRODUCT_LIMIT,
        storageStatePath,
        // 목록 조회에서 브라우저를 띄우지 않는다. 계약이 통하지 않으면
        // 사용자가 "자동 캡처"를 다시 눌러 명시적으로 재탐색하게 한다.
        allowDiscovery: false,
      });

      return NextResponse.json({
        success: true,
        data: {
          connectKind,
          categoryUrl: contract.configuredUrl || stored.sourceUrl,
          categories: buildTravelCategories(items),
          promotions: buildTravelPromotions(items),
          itemCount: items.length,
          registrationAvailable: contract.registrationAvailable,
          contractSource: source,
          truncated: false,
        },
      });
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

    let cookieHeader = "";
    try {
      cookieHeader = buildCookieHeaderForHost(storageStatePath, "gw-brandconnect.naver.com");
    } catch (error: unknown) {
      return NextResponse.json(
        { success: false, error: `네이버 세션 파일을 읽지 못했습니다: ${getErrorMessage(error)}` },
        { status: 400 }
      );
    }
    if (!cookieHeader) {
      return NextResponse.json(
        { success: false, error: "BrandConnect에 사용할 네이버 세션 쿠키가 없습니다. 다시 로그인하세요." },
        { status: 400 }
      );
    }

    const { categories, promotions, truncated, sessionExpired } = await loadShoppingOptions(
      categoryUrl,
      spaceId,
      rootCategoryId,
      cookieHeader,
      storageStatePath,
      deadline
    );

    // 예전에는 모든 실패를 삼켜서 "성공했지만 빈 목록"으로 보였다. 인증 실패는
    // 빈 결과가 아니라 오류로 알린다.
    if (sessionExpired && categories.length <= 1) {
      return NextResponse.json(
        { success: false, error: "브랜드커넥트 세션이 만료되었습니다. 네이버 로그인을 다시 진행하세요." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        connectKind,
        categoryUrl,
        categories,
        promotions,
        registrationAvailable: contract.registrationAvailable,
        truncated,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ConnectSessionExpiredError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    if (error instanceof ConnectContractNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CONNECT_CONTRACT_CAPTURE_REQUIRED",
            connectKind,
            captureRequired: true,
            message: error.message,
          },
        },
        { status: 501 }
      );
    }
    console.error("BrandConnect selection options load failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

import "dotenv/config";
import { optionalBlogCategories } from './lib/optional-blog-categories';
import fs from "fs";
import path from "path";
import { chromium } from "playwright-extra";
import type { APIResponse, Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
// 패키징 앱에는 node_modules/.prisma가 포함되지 않는다. 데스크톱 전용으로
// 생성해 함께 배포하는 클라이언트를 사용해야 설치본에서도 실행된다.
import { PrismaClient } from "../src/generated/prisma";
import { buildAppUrl, notifyAndLogCompletion } from "./lib/chatbot-notifier";
import { getNaverSessionFile } from "./lib/app-paths";
import {
  buildCaptureRequiredPayload,
  getSpaceIdFromConnectUrl,
  getConfiguredConnectUrl,
  parseConnectKind,
  toStoredConnectKind,
  type ConnectKind,
} from "../src/lib/brandconnect-kind";
import { resolveConnectContract } from "../src/lib/connect-contract-store";
import { listTravelItems } from "../src/lib/travel-connect-adapter";
import type { ConnectItem } from "../src/lib/connect-item";
import { matchesTravelSelectionFilters } from "../src/lib/travel-selection-options";
import { isLoginRedirect } from "./lib/naver-editor-selectors";
import { assertShoppingAccess, resolveShoppingCategoryUrl } from "../src/lib/shopping-connect-access";

chromium.use(StealthPlugin());

const NAVER_SESSION_EXPIRED_MESSAGE =
  "네이버 로그인 세션이 만료되었습니다. 앱에서 네이버 재로그인(또는 npm run login) 후 다시 시도하세요.";

const DEFAULT_CATEGORY_URL = "";
const DEFAULT_STORAGE_STATE_PATH = getNaverSessionFile();
const KST_TIMEZONE = "Asia/Seoul";
const BRANDCONNECT_MINIMIZE_WINDOW =
  (process.env.BRANDCONNECT_MINIMIZE_WINDOW || "true").toLowerCase() === "true";
const DEFAULT_SELECTION_PROFILE = (
  process.env.BRANDCONNECT_SELECTION_PROFILE || "seasonal-hit-popular"
).toLowerCase();
const BRANDCONNECT_PRODUCT_LIST_LIMIT = parsePositiveIntegerEnv(
  "BRANDCONNECT_PRODUCT_LIST_LIMIT",
  100,
  50,
  100
);
const BRANDCONNECT_CATEGORY_SCAN_LIMIT = parsePositiveIntegerEnv(
  "BRANDCONNECT_CATEGORY_SCAN_LIMIT",
  36,
  1,
  80
);
const DEFAULT_DUPLICATE_WINDOW_DAYS = parsePositiveIntegerEnv(
  "BRANDCONNECT_DUPLICATE_WINDOW_DAYS",
  30,
  0,
  3650
);

const CATEGORY_NAME_FALLBACK: Record<string, string> = {
  "오늘의 오빠": "17",
  "맛집 오빠": "18",
  "전자 오빠": "19",
  "식품 오빠": "31",
  "건강 오빠": "33",
  "여행 오빠": "34",
  "뷰티 오빠": "35",
  "쇼핑 오빠": "36",
};

interface CliOptions {
  connectKind: ConnectKind;
  categoryUrl: string;
  count: number;
  startDate: string | null;
  intervalDays: number;
  dailyQuota: number;
  dryRun: boolean;
  headless: boolean;
  storageStatePath: string;
  selectionProfile: string;
  brandFilter: string[];
  promotionFilter: string[];
  categoryFilter: string[];
  duplicateWindowDays: number;
}

interface ProductApiItem {
  id: number;
  productName: string;
  storeName: string;
  discountedRate: number;
  salePrice: number;
  discountedSalePrice: number;
  salesCount: number;
  orderCount: number;
  purchaseCount: number;
  reviewCount: number;
  popularityScore: number;
  rank: number;
  badgeTexts: string[];
  sourceCategoryIds: string[];
  sourceCategoryNames: string[];
}

interface DisplayCategory {
  id: string;
  name: string;
}

interface CandidateProduct extends ProductApiItem {
  score: number;
  reasons: string[];
}

interface PlannedProduct extends CandidateProduct {
  scheduledDate: string;
  boardName: string;
  categoryNo: string | null;
}

interface RegisterResult {
  action: "created" | "updated" | "skipped" | "duplicate" | "failed";
  productId: number;
  productName: string;
  shortUrl: string | null;
  categoryNo: string | null;
  boardName: string;
  scheduledDate: string;
  reason?: string;
  linkId?: string;
}

interface StoredCookie {
  name?: string;
  value?: string;
  domain?: string;
  expires?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    connectKind: "shopping",
    categoryUrl: DEFAULT_CATEGORY_URL,
    count: 10,
    startDate: null,
    intervalDays: 1,
    dailyQuota: 1,
    dryRun: false,
    headless: false,
    storageStatePath: DEFAULT_STORAGE_STATE_PATH,
    selectionProfile: DEFAULT_SELECTION_PROFILE,
    brandFilter: parseCommaSeparatedList(process.env.BRANDCONNECT_BRAND_FILTER || ""),
    promotionFilter: parseCommaSeparatedList(process.env.BRANDCONNECT_PROMOTION_FILTER || ""),
    categoryFilter: parseCommaSeparatedList(process.env.BRANDCONNECT_CATEGORY_FILTER || ""),
    duplicateWindowDays: DEFAULT_DUPLICATE_WINDOW_DAYS,
  };

  for (const arg of argv) {
    if (arg.startsWith("--connect-kind=")) {
      options.connectKind = parseConnectKind(arg.split("=")[1]);
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--headed") {
      options.headless = false;
      continue;
    }
    if (arg === "--headless") {
      options.headless = true;
      continue;
    }
    if (arg.startsWith("--category-url=")) {
      options.categoryUrl = arg.split("=")[1]?.trim() || options.categoryUrl;
      continue;
    }
    if (arg.startsWith("--count=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value > 0 && value <= 200) {
        options.count = value;
      }
      continue;
    }
    if (arg.startsWith("--start-date=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.startDate = value;
      }
      continue;
    }
    if (arg.startsWith("--interval-days=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value >= 1 && value <= 30) {
        options.intervalDays = value;
      }
      continue;
    }
    if (arg.startsWith("--daily-quota=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value >= 1 && value <= 200) {
        options.dailyQuota = value;
      }
      continue;
    }
    if (arg.startsWith("--storage-state=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.storageStatePath = path.isAbsolute(value)
          ? value
          : path.join(process.cwd(), value);
      }
      continue;
    }
    if (arg.startsWith("--selection-profile=")) {
      const value = arg.split("=")[1]?.trim().toLowerCase() || "";
      if (value) {
        options.selectionProfile = value;
      }
      continue;
    }
    if (arg.startsWith("--promotion-filter=")) {
      options.promotionFilter = parseCommaSeparatedList(arg.split("=")[1] || "");
      continue;
    }
    if (arg.startsWith("--brand-filter=") || arg.startsWith("--brand-keyword=")) {
      options.brandFilter = parseCommaSeparatedList(arg.split("=")[1] || "");
      continue;
    }
    if (arg.startsWith("--category-filter=")) {
      options.categoryFilter = parseCommaSeparatedList(arg.split("=")[1] || "");
      continue;
    }
    if (arg.startsWith("--duplicate-window-days=")) {
      const value = Number.parseInt(arg.split("=")[1] || "", 10);
      if (Number.isFinite(value) && value >= 0 && value <= 3650) {
        options.duplicateWindowDays = value;
      }
    }
  }

  if (
    options.startDate !== null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(options.startDate)
  ) {
    throw new Error("--start-date는 YYYY-MM-DD 형식이어야 합니다.");
  }

  return options;
}

function parseCommaSeparatedList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function formatKstYmd(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = map.get("year") || "0000";
  const month = map.get("month") || "00";
  const day = map.get("day") || "00";
  return `${year}-${month}-${day}`;
}

function addDaysToYmd(ymd: string, offsetDays: number): string {
  const [yearText, monthText, dayText] = ymd.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const utcDate = new Date(Date.UTC(year, month - 1, day + offsetDays, 0, 0, 0, 0));
  const yyyy = String(utcDate.getUTCFullYear());
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parsePositiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseNumberFromKeys(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (key in obj) {
      const value = parseNumber(obj[key]);
      if (value > 0) return value;
    }
  }
  return 0;
}

function normalizeFilterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAnyTerm(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const normalizedHaystack = normalizeFilterText(haystack);
  return terms.some((term) => normalizedHaystack.includes(normalizeFilterText(term)));
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
  if (/https?:|brandconnect|naver\.com|상품명|productName|로그인|회원가입|고객센터/i.test(normalized)) {
    return false;
  }
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

  const texts = [
    ...badgeKeys.flatMap((key) => collectBadgeTexts(obj[key])),
    ...badgeKeys.flatMap((key) => collectPromotionLikeTexts(obj[key])),
  ];
  return Array.from(new Set(texts.map((text) => text.trim()).filter(Boolean))).slice(0, 20);
}

function parseProductApiItems(payload: unknown): ProductApiItem[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray((payload as { data?: unknown[] }).data)
  ) {
    return [];
  }

  const rows = (payload as { data: unknown[] }).data;
  const parsed: ProductApiItem[] = [];

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const obj = row as Record<string, unknown>;
    const id = parseNumber(obj.id);
    const productName = typeof obj.productName === "string" ? obj.productName.trim() : "";

    if (!id || !productName) continue;

    parsed.push({
      id,
      productName,
      storeName: typeof obj.storeName === "string" ? obj.storeName.trim() : "",
      discountedRate: parseNumber(obj.discountedRate),
      salePrice: parseNumber(obj.salePrice),
      discountedSalePrice: parseNumber(obj.discountedSalePrice),
      salesCount: parseNumberFromKeys(obj, [
        "salesCount",
        "saleCount",
        "soldCount",
        "sellCount",
        "totalSalesCount",
        "recentSalesCount",
        "monthlySalesCount",
        "weeklySalesCount",
        "salesVolume",
        "saleVolume",
      ]),
      orderCount: parseNumberFromKeys(obj, [
        "orderCount",
        "ordersCount",
        "totalOrderCount",
        "recentOrderCount",
        "monthlyOrderCount",
        "purchaseOrderCount",
      ]),
      purchaseCount: parseNumberFromKeys(obj, [
        "purchaseCount",
        "buyCount",
        "buyerCount",
        "paymentCount",
        "conversionCount",
      ]),
      reviewCount: parseNumberFromKeys(obj, [
        "reviewCount",
        "reviewsCount",
        "totalReviewCount",
        "reviewCnt",
        "productReviewCount",
      ]),
      popularityScore: parseNumberFromKeys(obj, [
        "popularityScore",
        "popularScore",
        "rankingScore",
        "score",
        "recommendScore",
        "displayScore",
        "hitScore",
      ]),
      rank: parseNumberFromKeys(obj, [
        "rank",
        "ranking",
        "displayRank",
        "popularRank",
        "sortRank",
        "recommendRank",
      ]),
      badgeTexts: parseBadgeTexts(obj),
      sourceCategoryIds: [],
      sourceCategoryNames: [],
    });
  }

  return parsed;
}

function parseDisplayCategories(payload: unknown): DisplayCategory[] {
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
    parsed.push({ id, name });
  }
  return parsed;
}

function getDisplayCategoryIdFromUrl(categoryUrl: string): string | null {
  const match = categoryUrl.match(/\/category\/(\d+)/);
  return match?.[1] ?? null;
}

function appendUniqueProduct(
  map: Map<number, ProductApiItem>,
  products: ProductApiItem[],
  category?: DisplayCategory
): void {
  for (const product of products) {
    const sourceCategoryIds = new Set(product.sourceCategoryIds);
    const sourceCategoryNames = new Set(product.sourceCategoryNames);

    if (category) {
      sourceCategoryIds.add(category.id);
      sourceCategoryNames.add(category.name);
    }

    const existing = map.get(product.id);
    if (!existing) {
      map.set(product.id, {
        ...product,
        sourceCategoryIds: Array.from(sourceCategoryIds),
        sourceCategoryNames: Array.from(sourceCategoryNames),
      });
      continue;
    }

    for (const id of sourceCategoryIds) {
      if (!existing.sourceCategoryIds.includes(id)) existing.sourceCategoryIds.push(id);
    }
    for (const name of sourceCategoryNames) {
      if (!existing.sourceCategoryNames.includes(name)) existing.sourceCategoryNames.push(name);
    }
  }
}

async function fetchBrandConnectJson(
  page: Page,
  url: string,
  spaceId: string,
  requireAccess = false,
): Promise<unknown | null> {
  const fromPage = await page
    .evaluate(
      async ({ requestUrl, sid }: { requestUrl: string; sid: string }) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(requestUrl, {
            credentials: "include",
            headers: {
              accept: "application/json, text/plain, */*",
              "x-space-id": sid,
            },
            signal: controller.signal,
          });
          if (!res.ok) return null;
          return (await res.json()) as unknown;
        } catch {
          return null;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      { requestUrl: url, sid: spaceId }
    )
    .catch(() => null);

  if (fromPage) return fromPage;

  const response = await page.context().request
    .get(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "x-space-id": spaceId,
        referer: page.url(),
        origin: "https://brandconnect.naver.com",
      },
      timeout: 8000,
    })
    .catch(() => null as APIResponse | null);

  if (response?.ok()) {
    return response.json().catch(() => null);
  }
  if (response && requireAccess) assertShoppingAccess(response.status());
  return null;
}

async function fetchProductsForDisplayCategory(
  page: Page,
  categoryId: string,
  spaceId: string,
  requireAccess = false,
): Promise<ProductApiItem[]> {
  const url = new URL(
    "https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/search-by-display-category"
  );
  url.searchParams.set("displayCategoryId", categoryId);
  url.searchParams.set("limit", String(BRANDCONNECT_PRODUCT_LIST_LIMIT));

  const payload = await fetchBrandConnectJson(page, url.toString(), spaceId, requireAccess);
  return parseProductApiItems(payload);
}

async function fetchDisplayCategories(
  page: Page,
  categoryId: string,
  spaceId: string
): Promise<DisplayCategory[]> {
  const url = new URL("https://gw-brandconnect.naver.com/affiliate/query/display-categories");
  url.searchParams.set("displayCategoryId", categoryId);

  const payload = await fetchBrandConnectJson(page, url.toString(), spaceId);
  return parseDisplayCategories(payload);
}

async function fetchBaseDisplayCategories(page: Page, spaceId: string): Promise<DisplayCategory[]> {
  const payload = await fetchBrandConnectJson(
    page,
    "https://gw-brandconnect.naver.com/affiliate/query/base-display-categories",
    spaceId
  );
  return parseDisplayCategories(payload);
}

function assertBrandConnectLoggedIn(page: Page): void {
  if (isLoginRedirect(page.url())) {
    throw new Error(NAVER_SESSION_EXPIRED_MESSAGE);
  }
}

/**
 * Prefer the product API over waiting on fragile CSS class names.
 * Login redirects used to burn 30s on ProductSearchCategory_item before failing.
 */
async function loadInitialCategoryProducts(
  page: Page,
  rootCategoryId: string,
  spaceId: string,
  capturedFromNetwork: () => ProductApiItem[]
): Promise<ProductApiItem[]> {
  assertBrandConnectLoggedIn(page);

  const fromApi = await fetchProductsForDisplayCategory(page, rootCategoryId, spaceId, true);
  if (fromApi.length > 0) return fromApi;

  const fromNetwork = capturedFromNetwork();
  if (fromNetwork.length > 0) return fromNetwork;

  try {
    await Promise.race([
      page.waitForSelector("li.ProductSearchCategory_item__epUPF", { timeout: 15000 }),
      page.waitForURL((url) => isLoginRedirect(url.href), { timeout: 15000 }).then(() => {
        throw new Error(NAVER_SESSION_EXPIRED_MESSAGE);
      }),
    ]);
  } catch (error) {
    assertBrandConnectLoggedIn(page);
    if (error instanceof Error && error.message === NAVER_SESSION_EXPIRED_MESSAGE) {
      throw error;
    }
    throw new Error(
      "브랜드커넥트 상품 목록을 불러오지 못했습니다. 세션·카테고리 URL·권한을 확인하세요."
    );
  }

  assertBrandConnectLoggedIn(page);

  for (let i = 0; i < 20 && capturedFromNetwork().length === 0; i += 1) {
    await page.waitForTimeout(300);
  }

  const retryApi = await fetchProductsForDisplayCategory(page, rootCategoryId, spaceId, true);
  if (retryApi.length > 0) return retryApi;

  const retryNetwork = capturedFromNetwork();
  if (retryNetwork.length > 0) return retryNetwork;

  throw new Error("상품 목록 API 응답을 확보하지 못했습니다.");
}

function categoryPriority(category: DisplayCategory, rootCategoryId: string): number {
  if (category.id === rootCategoryId) return 0;

  const name = category.name;
  if (/계절|가전|디지털|컴퓨터|생활|건강/.test(name)) return 1;
  if (/여행|스포츠|레저|화장품|미용|식품|출산|육아/.test(name)) return 2;
  return 3;
}

function shouldIncludeCategory(category: DisplayCategory, categoryFilter: string[]): boolean {
  if (categoryFilter.length === 0) return true;
  return matchesAnyTerm(`${category.id} ${category.name}`, categoryFilter);
}

function shouldIncludeProductByPromotion(product: ProductApiItem, promotionFilter: string[]): boolean {
  if (promotionFilter.length === 0) return true;
  const haystack = product.badgeTexts.join(" ");
  return matchesAnyTerm(haystack, promotionFilter);
}

function shouldIncludeProductByBrand(product: ProductApiItem, brandFilter: string[]): boolean {
  if (brandFilter.length === 0) return true;
  const haystack = `${product.storeName} ${product.productName} ${product.badgeTexts.join(" ")}`;
  return matchesAnyTerm(haystack, brandFilter);
}

function shouldIncludeProductByCategory(product: ProductApiItem, categoryFilter: string[]): boolean {
  if (categoryFilter.length === 0) return true;
  return matchesAnyTerm(
    `${product.sourceCategoryIds.join(" ")} ${product.sourceCategoryNames.join(" ")}`,
    categoryFilter
  );
}

async function collectProductPool(
  page: Page,
  rootCategoryId: string,
  spaceId: string,
  initialProducts: ProductApiItem[],
  options: Pick<CliOptions, "brandFilter" | "promotionFilter" | "categoryFilter">
): Promise<{ products: ProductApiItem[]; scannedCategoryCount: number }> {
  const productsById = new Map<number, ProductApiItem>();
  const rootCategory: DisplayCategory = { id: rootCategoryId, name: "현재 카테고리" };
  if (shouldIncludeCategory(rootCategory, options.categoryFilter)) {
    appendUniqueProduct(productsById, initialProducts, rootCategory);
  }

  const categoriesById = new Map<string, DisplayCategory>();
  const addCategory = (category: DisplayCategory) => {
    if (!categoriesById.has(category.id)) {
      categoriesById.set(category.id, category);
    }
  };

  addCategory(rootCategory);

  const [baseCategories, rootChildren] = await Promise.all([
    fetchBaseDisplayCategories(page, spaceId),
    fetchDisplayCategories(page, rootCategoryId, spaceId),
  ]);

  for (const category of rootChildren) addCategory(category);
  for (const category of baseCategories) addCategory(category);

  const prioritizedBase = baseCategories
    .filter((category) => category.id !== rootCategoryId)
    .sort((a, b) => categoryPriority(a, rootCategoryId) - categoryPriority(b, rootCategoryId));

  for (const category of prioritizedBase.slice(0, 12)) {
    const children = await fetchDisplayCategories(page, category.id, spaceId);
    for (const child of children) addCategory(child);
    if (categoriesById.size >= BRANDCONNECT_CATEGORY_SCAN_LIMIT) break;
  }

  const categories = Array.from(categoriesById.values())
    .filter((category) => shouldIncludeCategory(category, options.categoryFilter))
    .sort((a, b) => categoryPriority(a, rootCategoryId) - categoryPriority(b, rootCategoryId))
    .slice(0, BRANDCONNECT_CATEGORY_SCAN_LIMIT);

  if (options.categoryFilter.length > 0 && categories.length === 0) {
    console.log(`   category filter matched no categories: ${options.categoryFilter.join(", ")}`);
  }

  let scannedCategoryCount = 0;
  for (const category of categories) {
    const products = await fetchProductsForDisplayCategory(page, category.id, spaceId);
    if (products.length === 0) continue;
    appendUniqueProduct(productsById, products, category);
    scannedCategoryCount += 1;
    console.log(
      `   후보 수집: ${category.name}(${category.id}) ${products.length}개 / 누적 ${productsById.size}개`
    );
  }

  const products = Array.from(productsById.values()).filter(
    (product) =>
      shouldIncludeProductByBrand(product, options.brandFilter) &&
      shouldIncludeProductByPromotion(product, options.promotionFilter) &&
      shouldIncludeProductByCategory(product, options.categoryFilter)
  );

  return {
    products,
    scannedCategoryCount,
  };
}

function addLogScore(
  score: number,
  reasons: string[],
  value: number,
  weight: number,
  label: string
): number {
  if (!Number.isFinite(value) || value <= 0) return score;
  const bonus = Math.min(45, Math.log10(value + 1) * weight);
  if (bonus <= 0) return score;
  reasons.push(`${label} 신호(${Math.round(value).toLocaleString("ko-KR")})`);
  return score + bonus;
}

function getSeasonName(month: number): "spring" | "summer" | "fall" | "winter" {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

function getSeasonalPatterns(month: number): Array<{ pattern: RegExp; score: number; reason: string }> {
  const season = getSeasonName(month);
  const common = [
    { pattern: /선풍기|냉각|쿨링|제습|건조|휴대용|무선|여행|캠핑|텀블러/i, score: 22, reason: "현재 계절/외출 수요" },
    { pattern: /신학기|입학|졸업|선물|집들이|육아|반려|생활용품/i, score: 12, reason: "상시 선물/생활 수요" },
  ];

  const bySeason: Record<ReturnType<typeof getSeasonName>, Array<{ pattern: RegExp; score: number; reason: string }>> = {
    spring: [
      { pattern: /청소|살균|스팀|보풀|먼지|세척|정리|음식물/i, score: 45, reason: "봄맞이 청소/정리 수요" },
      { pattern: /드라이|면도|제모|고데기|미용|뷰티|피부|헤어|구강/i, score: 38, reason: "봄철 개인관리/뷰티 수요" },
      { pattern: /피크닉|나들이|등산|자전거|운동|골프/i, score: 28, reason: "봄 나들이/운동 수요" },
    ],
    summer: [
      { pattern: /선풍기|서큘레이터|냉풍|쿨링|냉각|아이스|제습|쿨매트|양산|썬크림|자외선/i, score: 52, reason: "여름 냉방/쿨링 수요" },
      { pattern: /제모|바디|샤워|탈취|데오|모기|벌레|캠핑|여행|휴대용/i, score: 36, reason: "여름 외출/위생 수요" },
      { pattern: /물놀이|수영|비치|우산|장마|레인/i, score: 30, reason: "장마/휴가 시즌 수요" },
    ],
    fall: [
      { pattern: /가을|캠핑|등산|트레킹|골프|보온|텀블러|자켓|니트/i, score: 40, reason: "가을 야외활동 수요" },
      { pattern: /추석|선물|건강|영양제|홍삼|과일|한우|굴비/i, score: 36, reason: "명절/선물 수요" },
      { pattern: /보습|수분|크림|가습|건조/i, score: 28, reason: "환절기 보습/건조 수요" },
    ],
    winter: [
      { pattern: /온열|전기매트|히터|난방|보온|장갑|목도리|핫팩|가습기/i, score: 52, reason: "겨울 난방/보온 수요" },
      { pattern: /크리스마스|연말|선물|홈파티|트리|조명/i, score: 34, reason: "연말 선물/홈파티 수요" },
      { pattern: /감기|면역|비타민|영양제|건강/i, score: 28, reason: "겨울 건강관리 수요" },
    ],
  };

  return [...bySeason[season], ...common];
}

function rankSeasonalProducts(items: ProductApiItem[], selectionProfile = DEFAULT_SELECTION_PROFILE): CandidateProduct[] {
  const monthInKst = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: KST_TIMEZONE,
      month: "2-digit",
    }).format(new Date())
  );

  return items
    .map((item) => {
      const title = item.productName.toLowerCase();
      const badgeText = item.badgeTexts.join(" ").toLowerCase();
      const haystack = `${title} ${item.storeName.toLowerCase()} ${badgeText}`;
      let score = 0;
      const reasons: string[] = [];

      const seasonalWeight =
        selectionProfile === "popular" || selectionProfile === "hit" ? 0.65 : 1;
      const popularityWeight = selectionProfile === "seasonal" ? 0.75 : 1;

      for (const entry of getSeasonalPatterns(monthInKst)) {
        if (entry.pattern.test(haystack)) {
          score += entry.score * seasonalWeight;
          reasons.push(entry.reason);
        }
      }

      if (/시즌|추천|recommended|recommend|season/i.test(haystack)) {
        score += 34 * seasonalWeight;
        reasons.push("브랜드커넥트 추천/시즌 표시");
      }

      if (/히트|hit|핫딜|hot|베스트|best|랭킹|ranking|인기|popular|md추천|md\s*pick/i.test(haystack)) {
        score += 42 * popularityWeight;
        reasons.push("히트/인기 상품 표시");
      }

      if (/판매|주문|구매|누적|완판|품절임박|재구매|리뷰많/i.test(haystack)) {
        score += 34 * popularityWeight;
        reasons.push("판매/구매 반응 표시");
      }

      if (/드라이|면도|제모|고데기|미용|뷰티|칫솔|구강|피부|헤어/.test(title)) {
        score += 18;
        reasons.push("개인관리/뷰티 지속 수요");
      }

      if (/주방|에어프라이|오븐|찜기|그릴|포트|청소|가전|전자|무선|노트북|이어폰|마이크|tv/.test(title)) {
        score += 16;
        reasons.push("생활가전/디지털 관심도");
      }

      score = addLogScore(score, reasons, item.salesCount, 16 * popularityWeight, "판매량");
      score = addLogScore(score, reasons, item.orderCount, 15 * popularityWeight, "주문수");
      score = addLogScore(score, reasons, item.purchaseCount, 14 * popularityWeight, "구매수");
      score = addLogScore(score, reasons, item.reviewCount, 10 * popularityWeight, "리뷰수");

      if (item.popularityScore > 0) {
        score += Math.min(item.popularityScore, 100) * 0.45 * popularityWeight;
        reasons.push(`인기도 점수(${item.popularityScore})`);
      }

      if (item.rank > 0) {
        score += Math.max(0, 35 - Math.min(item.rank, 100) * 0.35) * popularityWeight;
        reasons.push(`상위 노출 순위(${item.rank})`);
      }

      const discountBonus = Math.min(item.discountedRate, 70) * 0.5;
      if (discountBonus > 0) {
        score += discountBonus;
        reasons.push(`할인율 ${item.discountedRate}%`);
      }

      const effectivePrice = item.discountedSalePrice || item.salePrice;
      if (effectivePrice >= 15000 && effectivePrice <= 250000) {
        score += 8;
        reasons.push("리뷰 전환에 적당한 가격대");
      } else if (effectivePrice > 250000) {
        score += 4;
        reasons.push("고단가 상품");
      }

      return {
        ...item,
        score,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*]|\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRelaxedProductName(name: string): string {
  return normalizeLooseText(name)
    .replace(
      /\b\d+(?:\.\d+)?\s*(?:ml|l|g|kg|cm|mm|m|inch|인치|형|개|매|팩|p)\b/giu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function buildProductIdentityKeys(
  productName: string,
  storeName?: string | null
): { strictKeys: string[]; relaxedKeys: string[] } {
  const normalizedStore = normalizeLooseText(storeName || "");
  const strictName = normalizeLooseText(productName);
  const relaxedName = normalizeRelaxedProductName(productName);

  const strictKeySet = new Set<string>();
  const relaxedKeySet = new Set<string>();

  if (strictName) {
    strictKeySet.add(strictName); // 제품명만 기준
    if (normalizedStore) {
      strictKeySet.add(`${strictName}|${normalizedStore}`); // 제품명+스토어 기준
    }
  }

  if (relaxedName) {
    relaxedKeySet.add(relaxedName); // 단위/옵션 제거 제품명 기준
    if (normalizedStore) {
      relaxedKeySet.add(`${relaxedName}|${normalizedStore}`); // 단위/옵션 제거 + 스토어 기준
    }
  }

  return {
    strictKeys: Array.from(strictKeySet),
    relaxedKeys: Array.from(relaxedKeySet),
  };
}

interface ExistingBrandLinkForDuplicate {
  id: string;
  productName: string | null;
  storeName: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  scheduledPublishAt: Date | null;
}

const DUPLICATE_BLOCKING_STATUSES = new Set([
  "READY",
  "PUBLISHING",
  "SCHEDULED",
  "PUBLISHED",
]);

function getDuplicateReferenceDate(row: ExistingBrandLinkForDuplicate): Date {
  return row.publishedAt || row.scheduledPublishAt || row.updatedAt || row.createdAt;
}

function shouldBlockDuplicateBrandLink(
  row: ExistingBrandLinkForDuplicate,
  now: Date,
  duplicateWindowDays: number
): boolean {
  if (!DUPLICATE_BLOCKING_STATUSES.has(row.status)) return false;
  if (duplicateWindowDays <= 0) return false;

  const cutoffTime = now.getTime() - duplicateWindowDays * 24 * 60 * 60 * 1000;
  return getDuplicateReferenceDate(row).getTime() >= cutoffTime;
}

function selectUniqueCandidates(
  ranked: CandidateProduct[],
  count: number,
  existingStrictKeys: Set<string>,
  existingRelaxedKeys: Set<string>
): CandidateProduct[] {
  const selected: CandidateProduct[] = [];
  const seenIds = new Set<number>();
  const seenStrictKeys = new Set<string>();
  const seenRelaxedKeys = new Set<string>();

  for (const item of ranked) {
    if (selected.length >= count) break;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    const { strictKeys, relaxedKeys } = buildProductIdentityKeys(
      item.productName,
      item.storeName
    );

    if (strictKeys.length === 0 && relaxedKeys.length === 0) continue;

    const existsInDb =
      strictKeys.some((key) => existingStrictKeys.has(key)) ||
      relaxedKeys.some((key) => existingRelaxedKeys.has(key));
    if (existsInDb) continue;

    const existsInSelection =
      strictKeys.some((key) => seenStrictKeys.has(key)) ||
      relaxedKeys.some((key) => seenRelaxedKeys.has(key));
    if (existsInSelection) continue;

    for (const key of strictKeys) {
      seenStrictKeys.add(key);
    }
    for (const key of relaxedKeys) {
      seenRelaxedKeys.add(key);
    }
    selected.push(item);
  }

  return selected;
}

function inferBoardName(productName: string): string {
  const title = productName.toLowerCase();

  if (/여행|캠핑|캐리어|트래블|숙박|비행|항공/.test(title)) return "여행 오빠";
  if (/맛집|식당|먹거리|요리|조리/.test(title)) return "맛집 오빠";
  if (/식품|영양제|오메가|단백질|건강식|간식/.test(title)) return "식품 오빠";
  if (/구강|칫솔|건강|헬스|혈압|체온|눈영양|장건강/.test(title)) return "건강 오빠";
  if (/드라이|면도|제모|고데기|미용|뷰티|피부|헤어/.test(title)) return "뷰티 오빠";
  if (/청소|이어폰|마이크|무선|가전|전자|냉장고|세탁|건조|오븐|에어프라이|찜기/.test(title)) {
    return "전자 오빠";
  }

  return "쇼핑 오빠";
}

function isDomainMatch(hostname: string, cookieDomain: string): boolean {
  const normalized = cookieDomain.replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function buildCookieHeaderForHost(storageStatePath: string, hostname: string): string {
  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`세션 파일이 없습니다: ${storageStatePath}`);
  }

  const raw = fs.readFileSync(storageStatePath, "utf8");
  const parsed = JSON.parse(raw) as { cookies?: StoredCookie[] };
  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const nowSec = Date.now() / 1000;

  const usable = cookies.filter((cookie) => {
    if (!cookie.name || cookie.value === undefined || !cookie.domain) return false;
    if (!isDomainMatch(hostname, cookie.domain)) return false;
    if (
      typeof cookie.expires === "number" &&
      cookie.expires > 0 &&
      cookie.expires <= nowSec
    ) {
      return false;
    }
    return true;
  });

  return usable.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function fetchBlogCategoryMap(
  storageStatePath: string,
  blogId: string
): Promise<Map<string, string>> {
  const header = buildCookieHeaderForHost(storageStatePath, "blog.naver.com");
  if (!header) {
    throw new Error("blog.naver.com 쿠키를 찾지 못했습니다. npm run login 후 재시도하세요.");
  }

  const endpoint = `https://blog.naver.com/PostWriteFormManagerOptions.naver?blogId=${encodeURIComponent(
    blogId
  )}`;

  const res = await fetch(endpoint, {
    headers: {
      cookie: header,
      accept: "application/json, text/plain, */*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`네이버 게시판 조회 실패 (HTTP ${res.status})`);
  }

  const text = await res.text();
  const data = JSON.parse(text) as {
    isSuccess?: boolean;
    result?: {
      formView?: {
        categoryListFormView?: {
          categoryFormViewList?: Array<{
            categoryNo?: number;
            categoryName?: string;
            blockYn?: boolean;
            open?: boolean;
          }>;
        };
      };
    };
  };

  if (!data.isSuccess) {
    throw new Error("네이버 게시판 응답이 비정상입니다.");
  }

  const rawCategories =
    data.result?.formView?.categoryListFormView?.categoryFormViewList ?? [];
  const map = new Map<string, string>();

  for (const category of rawCategories) {
    if (category.blockYn === true || category.open === false) continue;
    const name = typeof category.categoryName === "string" ? category.categoryName.trim() : "";
    const no =
      typeof category.categoryNo === "number" && Number.isFinite(category.categoryNo)
        ? String(category.categoryNo)
        : "";
    if (!name || !no) continue;
    map.set(name, no);
  }

  for (const [name, no] of Object.entries(CATEGORY_NAME_FALLBACK)) {
    if (!map.has(name)) {
      map.set(name, no);
    }
  }

  return map;
}

async function issueAffiliateShortUrl(
  page: Page,
  productId: number,
  issuedUrlsByProductId: Map<number, string>,
  spaceId: string
): Promise<string | null> {
  const apiUrl = `https://gw-brandconnect.naver.com/affiliate/command/affiliate-urls?affiliateProductId=${productId}`;
  const directFromContext = await page.context().request
    .post(apiUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-space-id": spaceId,
        referer: page.url(),
        origin: "https://brandconnect.naver.com",
      },
      data: {},
    })
    .then(async (res: APIResponse) => {
      if (!res.ok()) return null;
      const payload = (await res.json()) as { url?: unknown };
      return typeof payload.url === "string" ? payload.url : null;
    })
    .catch(() => null as string | null);

  if (directFromContext && /^https:\/\/naver\.me\//.test(directFromContext)) {
    return directFromContext;
  }

  const directFromApi = await page
    .evaluate(async ({ id, sid }: { id: number; sid: string }) => {
      try {
        const res = await fetch(
          `https://gw-brandconnect.naver.com/affiliate/command/affiliate-urls?affiliateProductId=${id}`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              accept: "application/json, text/plain, */*",
              "content-type": "application/json",
              "x-space-id": sid,
            },
            body: "{}",
          }
        );
        if (!res.ok) return null;
        const payload = (await res.json()) as { url?: unknown };
        return typeof payload.url === "string" ? payload.url : null;
      } catch {
        return null;
      }
    }, { id: productId, sid: spaceId })
    .catch(() => null as string | null);

  if (directFromApi && /^https:\/\/naver\.me\//.test(directFromApi)) {
    return directFromApi;
  }

  const productRow = page
    .locator(`li.ProductSearchCategory_item__epUPF:has(a[href*="/affiliate/products/${productId}"])`)
    .first();
  const button = productRow.locator("button.ProductItem_btn__6S6T0").first();

  if (!(await button.isVisible().catch(() => false))) {
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel(0, 1200).catch(() => {});
      await page.waitForTimeout(120);
      if (await button.isVisible().catch(() => false)) break;
    }
    if (!(await button.isVisible().catch(() => false))) {
      return null;
    }
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const beforeApiUrl = issuedUrlsByProductId.get(productId) ?? null;
    const beforeCopyCount = await page
      .evaluate(() => {
        const copied = (globalThis as { __bcCopiedLinks?: unknown }).__bcCopiedLinks;
        return Array.isArray(copied) ? copied.length : 0;
      })
      .catch(() => 0);

    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);

    const fromApi = issuedUrlsByProductId.get(productId);
    if (
      fromApi &&
      fromApi !== beforeApiUrl &&
      /^https:\/\/naver\.me\//.test(fromApi)
    ) {
      return fromApi;
    }

    const fromClipboard = await page
      .evaluate((prevCount: number) => {
        const copied = (globalThis as { __bcCopiedLinks?: unknown }).__bcCopiedLinks;
        if (!Array.isArray(copied) || copied.length <= prevCount) return null;
        const last = copied[copied.length - 1];
        return typeof last === "string" ? last : null;
      }, beforeCopyCount)
      .catch(() => null as string | null);

    if (fromClipboard && /^https:\/\/naver\.me\//.test(fromClipboard)) {
      return fromClipboard;
    }
  }

  return null;
}

function formatPrice(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value.toLocaleString("ko-KR")}원`;
}

function buildMemo(item: PlannedProduct): string {
  const reasonText = item.reasons.slice(0, 4).join(", ");
  return [
    `[시즌·히트·인기 자동등록] score=${item.score.toFixed(1)}`,
    `할인율 ${item.discountedRate}%`,
    `근거: ${reasonText || "계절/인기/할인 기반"}`,
  ].join(" | ");
}

/** 캡처된 계약 기반으로 여행 상품 제휴 단축링크 발급을 시도한다. 실패하면 null. */
async function issueTravelAffiliateShortUrl(
  externalItemId: string,
  storageStatePath: string,
  sourceUrl: string
): Promise<string | null> {
  if (!/^\d+$/.test(externalItemId)) return null;
  const spaceId = getSpaceIdFromConnectUrl(sourceUrl);
  if (!spaceId) return null;

  let cookieHeader = "";
  try {
    cookieHeader = buildCookieHeaderForHost(storageStatePath, "gw-brandconnect.naver.com");
  } catch {
    return null;
  }
  if (!cookieHeader) return null;

  const response = await fetch(
    `https://gw-brandconnect.naver.com/affiliate/command/affiliate-urls?affiliateProductId=${externalItemId}`,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        cookie: cookieHeader,
        origin: "https://brandconnect.naver.com",
        referer: sourceUrl,
        "x-space-id": spaceId,
      },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    }
  ).catch(() => null);

  if (!response?.ok) return null;
  const payload = (await response.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof payload?.url === "string" ? payload.url.trim() : "";
  return /^https:\/\/naver\.me\//.test(url) ? url : null;
}

/**
 * 여행커넥트 등록 플로우. 쇼핑 플로우와 달리 화면 스크래핑 없이 캡처된 계약으로
 * 목록을 가져오고, 단축링크 발급이 안 되는 항목은 관측한 상품 URL을 그대로 쓴다.
 */
async function registerTravelItemsFlow(options: CliOptions, prisma: PrismaClient): Promise<void> {
  const startDate = options.startDate ?? addDaysToYmd(formatKstYmd(new Date()), 1);
  // 쇼핑용 기본 카테고리 URL이 그대로 넘어온 경우는 지정 없음으로 본다.
  const travelCategoryUrl =
    options.categoryUrl && options.categoryUrl !== DEFAULT_CATEGORY_URL ? options.categoryUrl : null;

  console.log("=".repeat(70));
  console.log("✈️ 여행커넥트 상품 자동 등록 시작");
  console.log(`- categoryUrl: ${travelCategoryUrl || "(캡처된 계약 기준 자동)"}`);
  console.log(`- count: ${options.count}`);
  console.log(`- startDate: ${startDate}`);
  console.log(`- duplicateWindowDays: ${options.duplicateWindowDays}`);
  console.log(`- dryRun: ${options.dryRun ? "YES" : "NO"}`);
  console.log("=".repeat(70));

  const blogId = process.env.NAVER_BLOG_ID?.trim();
  if (!blogId) throw new Error(".env의 NAVER_BLOG_ID가 필요합니다.");
  const categoryMap = await optionalBlogCategories(() => fetchBlogCategoryMap(options.storageStatePath, blogId));
  console.log(`✅ 게시판 매핑 로드: ${categoryMap.size}개`);

  const { items, contract, source } = await listTravelItems({
    categoryUrl: travelCategoryUrl,
    // 여러 추천 section/tab을 합친 뒤에도 필터·기등록 상품을 건너뛸 후보가
    // 충분해야 한다. 수퍼 퍼블리싱 200개 요청을 100개에서 잘라버리지 않는다.
    limit: Math.min(800, Math.max(options.count * 4, 40)),
    storageStatePath: options.storageStatePath,
    allowDiscovery: true,
  });
  console.log(
    `✅ 여행 상품 수집: ${items.length}개 / 피드 ${contract.feeds?.length || 1}개 ` +
    `(${source === "contract" ? "저장된 계약" : "실시간 재탐색"})`
  );
  const selectedItems = items.filter((item) =>
    matchesAnyTerm(`${item.name} ${item.storeName || ""}`, options.brandFilter) &&
    matchesTravelSelectionFilters(item, options.categoryFilter, options.promotionFilter)
  );
  console.log(
    `✅ 여행 옵션 적용: ${selectedItems.length}개` +
      `${options.brandFilter.length > 0 ? ` / 브랜드 ${options.brandFilter.join(", ")}` : ""}` +
      `${options.categoryFilter.length > 0 ? ` / 조건 ${options.categoryFilter.join(", ")}` : ""}` +
      `${options.promotionFilter.length > 0 ? ` / 혜택 ${options.promotionFilter.join(", ")}` : ""}`
  );

  const existingBrandLinks = await prisma.brandLink.findMany({
    where: { connectKind: toStoredConnectKind("travel") },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      url: true,
      connectKind: true,
      externalItemId: true,
      sourceUrl: true,
      productName: true,
      productPrice: true,
      storeName: true,
      imageUrls: true,
      categoryNo: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      scheduledPublishAt: true,
    },
  });
  const duplicateReferenceNow = new Date();
  const existingByExternalId = new Map<string, (typeof existingBrandLinks)[number]>();
  const existingByStrictKey = new Map<string, (typeof existingBrandLinks)[number]>();
  const existingByRelaxedKey = new Map<string, (typeof existingBrandLinks)[number]>();
  for (const row of existingBrandLinks) {
    if (row.externalItemId) existingByExternalId.set(row.externalItemId, row);
    if (!row.productName) continue;
    if (!shouldBlockDuplicateBrandLink(row, duplicateReferenceNow, options.duplicateWindowDays)) continue;
    const { strictKeys, relaxedKeys } = buildProductIdentityKeys(row.productName, row.storeName);
    for (const key of strictKeys) {
      existingByStrictKey.set(key, row);
    }
    for (const key of relaxedKeys) {
      existingByRelaxedKey.set(key, row);
    }
  }

  const getScheduledDate = (successIndex: number) =>
    addDaysToYmd(startDate, Math.floor(successIndex / options.dailyQuota) * options.intervalDays);

  interface TravelRegisterResult {
    action: "created" | "updated" | "duplicate" | "failed";
    productName: string;
    url: string | null;
    scheduledDate: string;
    reason?: string;
    linkId?: string;
  }

  const results: TravelRegisterResult[] = [];
  const createdUrls = new Set<string>();
  let successCount = 0;

  const findExistingItem = (item: ConnectItem): (typeof existingBrandLinks)[number] | null => {
    if (item.externalItemId) {
      const exact = existingByExternalId.get(item.externalItemId);
      if (exact) return exact;
    }
    const { strictKeys, relaxedKeys } = buildProductIdentityKeys(item.name, item.storeName || null);
    for (const key of strictKeys) {
      const existing = existingByStrictKey.get(key);
      if (existing) return existing;
    }
    for (const key of relaxedKeys) {
      const existing = existingByRelaxedKey.get(key);
      if (existing) return existing;
    }
    return null;
  };

  for (const item of selectedItems) {
    if (successCount >= options.count) break;
    const scheduledDate = getScheduledDate(successCount);
    const boardName = inferBoardName(`여행 ${item.name}`);
    const categoryNo = categoryMap.get(boardName) ?? null;
    const existingItem = findExistingItem(item);

    if (existingItem) {
      if (!options.dryRun) {
        await prisma.brandLink.update({
          where: { id: existingItem.id },
          data: {
            externalItemId: item.externalItemId || existingItem.externalItemId,
            sourceUrl: item.linkUrl || existingItem.sourceUrl || contract.sourceUrl,
            productName: item.name,
            storeName: item.storeName || existingItem.storeName,
            productPrice: item.price > 0 ? formatPrice(item.price) : existingItem.productPrice,
            imageUrls: item.imageUrl ? JSON.stringify([item.imageUrl]) : existingItem.imageUrls,
            categoryNo: existingItem.categoryNo || categoryNo,
            ...(existingItem.status === "FAILED"
              ? { status: "READY", errorMessage: null }
              : {}),
          },
        });
      }
      results.push({
        action: "updated",
        productName: item.name,
        url: existingItem.url,
        scheduledDate,
        reason: options.dryRun
          ? "기존 상품 최신화 대상 (dry-run)"
          : existingItem.status === "FAILED"
            ? "이전 실패 상품을 READY로 복구하고 정보 최신화"
            : "기존 상품 정보 최신화",
        linkId: existingItem.id,
      });
      successCount += 1;
      continue;
    }

    const shortUrl = await issueTravelAffiliateShortUrl(
      item.externalItemId || "",
      options.storageStatePath,
      contract.sourceUrl
    );
    const linkUrl = shortUrl || item.linkUrl;
    if (!linkUrl) {
      results.push({
        action: "failed",
        productName: item.name,
        url: null,
        scheduledDate,
        reason: "제휴 단축링크 발급 실패 + 상품 URL 없음",
      });
      continue;
    }
    console.log(`\n🔗 ${item.name}`);
    console.log(
      `   ${shortUrl ? `✅ 제휴 단축링크 ${shortUrl}` : `↪️ 단축링크 발급 불가 — 상품 URL 사용 (${linkUrl})`}`
    );

    const normalizedUrl = linkUrl.toLowerCase();
    if (createdUrls.has(normalizedUrl)) {
      results.push({ action: "duplicate", productName: item.name, url: linkUrl, scheduledDate, reason: "배치 내 URL 중복" });
      continue;
    }
    const existing = await prisma.brandLink.findFirst({
      where: { url: linkUrl },
      orderBy: { updatedAt: "desc" },
    });
    if (existing?.status === "FAILED") {
      if (!options.dryRun) {
        await prisma.brandLink.update({
          where: { id: existing.id },
          data: {
            connectKind: toStoredConnectKind("travel"),
            externalItemId: item.externalItemId || existing.externalItemId,
            sourceUrl: item.linkUrl || existing.sourceUrl || contract.sourceUrl,
            memo: `[여행커넥트 자동등록] ${item.storeName || ""}`.trim(),
            categoryNo: existing.categoryNo || categoryNo,
            useSectionHeading: true,
            status: "READY",
            errorMessage: null,
            productName: item.name,
            storeName: item.storeName || existing.storeName,
            productPrice: item.price > 0 ? formatPrice(item.price) : existing.productPrice,
            imageUrls: item.imageUrl ? JSON.stringify([item.imageUrl]) : existing.imageUrls,
            scheduledPublishAt: new Date(`${scheduledDate}T00:00:00.000Z`),
          },
        });
      }
      results.push({
        action: "updated",
        productName: item.name,
        url: linkUrl,
        scheduledDate,
        reason: options.dryRun ? "이전 실패 링크 복구 대상 (dry-run)" : "이전 실패 링크를 READY로 복구",
        linkId: existing.id,
      });
      createdUrls.add(normalizedUrl);
      successCount += 1;
      continue;
    }
    if (existing && shouldBlockDuplicateBrandLink(existing, duplicateReferenceNow, options.duplicateWindowDays)) {
      results.push({
        action: "duplicate",
        productName: item.name,
        url: linkUrl,
        scheduledDate,
        reason: `기존 링크 존재 (${existing.status})`,
        linkId: existing.id,
      });
      continue;
    }

    if (options.dryRun) {
      results.push({ action: "created", productName: item.name, url: linkUrl, scheduledDate, reason: "dry-run" });
      successCount += 1;
      continue;
    }

    const created = await prisma.brandLink.create({
      data: {
        url: linkUrl,
        connectKind: toStoredConnectKind("travel"),
        externalItemId: item.externalItemId,
        sourceUrl: item.linkUrl || contract.sourceUrl,
        memo: `[여행커넥트 자동등록] ${item.storeName || ""}`.trim(),
        categoryNo,
        useSectionHeading: true,
        status: "READY",
        productName: item.name,
        storeName: item.storeName || null,
        productPrice: formatPrice(item.price),
        imageUrls: item.imageUrl ? JSON.stringify([item.imageUrl]) : null,
        scheduledPublishAt: new Date(`${scheduledDate}T00:00:00.000Z`),
      },
    });
    results.push({ action: "created", productName: item.name, url: linkUrl, scheduledDate, linkId: created.id });
    createdUrls.add(normalizedUrl);
    successCount += 1;
    console.log(`   ✅ 등록 완료 (${created.id}) → ${scheduledDate} 예약 후보`);
  }

  const createdCount = results.filter((entry) => entry.action === "created").length;
  const updatedCount = results.filter((entry) => entry.action === "updated").length;
  const duplicateCount = results.filter((entry) => entry.action === "duplicate").length;
  const failedCount = results.filter((entry) => entry.action === "failed").length;

  console.log("\n" + "=".repeat(70));
  console.log("✅ 여행커넥트 등록 작업 완료");
  console.log(`- 신규: ${createdCount} / 최신화: ${updatedCount} / 중복: ${duplicateCount} / 실패: ${failedCount}`);
  console.log("=".repeat(70));

  if (!options.dryRun) {
    await notifyAndLogCompletion({
      taskType: "brandconnect.travel.register",
      title: "여행커넥트 상품 등록 완료",
      summary: `신규 ${createdCount}건, 최신화 ${updatedCount}건, 중복 건너뜀 ${duplicateCount}건, 실패 ${failedCount}건`,
      successCount: createdCount + updatedCount,
      failedCount,
      links: results.map((entry) => ({
        label: entry.productName,
        url: entry.url || (entry.linkId ? buildAppUrl(`/?brandLinkId=${entry.linkId}`) : buildAppUrl("/")),
        scheduledDate: entry.scheduledDate,
        status: entry.action.toUpperCase(),
        description: entry.reason || "여행커넥트",
      })),
      extra: { createdCount, updatedCount, duplicateCount, failedCount, collectedItemCount: items.length },
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const explicitUrl = process.argv.slice(2).find((arg) => arg.startsWith('--category-url='))?.slice('--category-url='.length);
  options.categoryUrl = options.connectKind === "shopping"
    ? await resolveShoppingCategoryUrl(explicitUrl, options.storageStatePath)
    : getConfiguredConnectUrl(options.connectKind, explicitUrl) || "";
  const connectContract = resolveConnectContract(options.connectKind, options.categoryUrl);
  if (connectContract.captureRequired) {
    throw new Error(JSON.stringify(buildCaptureRequiredPayload(connectContract)));
  }
  const prisma = new PrismaClient();

  if (options.connectKind === "travel") {
    try {
      await registerTravelItemsFlow(options, prisma);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  const blogId = process.env.NAVER_BLOG_ID?.trim();
  if (!blogId) {
    throw new Error(".env의 NAVER_BLOG_ID가 필요합니다.");
  }
  const spaceId = options.categoryUrl.match(/brandconnect\.naver\.com\/(\d+)\//)?.[1];
  if (!spaceId) {
    throw new Error("category-url에서 spaceId를 추출하지 못했습니다.");
  }
  const rootCategoryId = getDisplayCategoryIdFromUrl(options.categoryUrl);
  if (!rootCategoryId) {
    throw new Error("category-url에서 displayCategoryId를 추출하지 못했습니다.");
  }

  const startDate =
    options.startDate ?? addDaysToYmd(formatKstYmd(new Date()), 1);

  console.log("=".repeat(70));
  console.log("📦 BrandConnect 시즌·히트·인기 상품 자동 등록 시작");
  console.log(`- categoryUrl: ${options.categoryUrl}`);
  console.log(`- count: ${options.count}`);
  console.log(`- startDate: ${startDate}`);
  console.log(`- intervalDays: ${options.intervalDays}`);
  console.log(`- dailyQuota: ${options.dailyQuota}`);
  console.log(`- selectionProfile: ${options.selectionProfile}`);
  console.log(`- brandFilter: ${options.brandFilter.join(", ") || "-"}`);
  console.log(`- promotionFilter: ${options.promotionFilter.join(", ") || "-"}`);
  console.log(`- categoryFilter: ${options.categoryFilter.join(", ") || "-"}`);
  console.log(`- duplicateWindowDays: ${options.duplicateWindowDays}`);
  console.log(`- dryRun: ${options.dryRun ? "YES" : "NO"}`);
  console.log("=".repeat(70));

  const categoryMap = await optionalBlogCategories(() => fetchBlogCategoryMap(options.storageStatePath, blogId));
  console.log(`✅ 게시판 매핑 로드: ${categoryMap.size}개`);

  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
    headless: options.headless,
    args:
      !options.headless && BRANDCONNECT_MINIMIZE_WINDOW
        ? ["--start-minimized", "--window-position=-32000,-32000"]
        : [],
  });
  const context = await browser.newContext({
    storageState: options.storageStatePath,
    viewport: { width: 1600, height: 1100 },
  });

  await context.addInitScript({
    content: `
(() => {
  const key = "__bcCopiedLinks";
  const g = globalThis;
  if (!Array.isArray(g[key])) g[key] = [];
  const push = (value) => {
    if (typeof value === "string" && value.length > 0) {
      g[key].push(value);
    }
  };

  try {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        push(text);
        return original(text);
      };
    }
  } catch (_) {}

  try {
    document.addEventListener(
      "copy",
      () => {
        try {
          const text = (globalThis.getSelection && globalThis.getSelection()?.toString()) || "";
          push(text);
        } catch (_) {}
      },
      true
    );
  } catch (_) {}
})();
`,
  });

  const page = await context.newPage();

  let productsFromApi: ProductApiItem[] = [];
  const issuedUrlsByProductId = new Map<number, string>();

  page.on("response", async (response) => {
    const url = response.url();

    if (url.includes("/affiliate/query/affiliate-products/search-by-display-category")) {
      try {
        const payload = (await response.json()) as unknown;
        const parsed = parseProductApiItems(payload);
        if (parsed.length > productsFromApi.length) {
          productsFromApi = parsed;
        }
      } catch {
        // ignore parse errors
      }
      return;
    }

    if (url.includes("/affiliate/command/affiliate-urls?affiliateProductId=")) {
      const match = url.match(/affiliateProductId=(\d+)/);
      if (!match) return;
      const productId = Number.parseInt(match[1], 10);
      if (!Number.isFinite(productId)) return;

      try {
        const body = (await response.json()) as { url?: unknown };
        if (typeof body.url === "string" && body.url.trim()) {
          issuedUrlsByProductId.set(productId, body.url.trim());
        }
      } catch {
        // ignore parse errors
      }
    }
  });

  console.log("🌐 BrandConnect 카테고리 페이지 접속...");
  await page.goto(options.categoryUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  assertBrandConnectLoggedIn(page);

  const initialProducts = await loadInitialCategoryProducts(
    page,
    rootCategoryId,
    spaceId,
    () => productsFromApi
  );
  if (productsFromApi.length < initialProducts.length) {
    productsFromApi = initialProducts;
  }

  console.log(`✅ 카테고리 첫 상품 수집: ${initialProducts.length}개`);

  const productPool = await collectProductPool(page, rootCategoryId, spaceId, initialProducts, options);
  console.log(
    `✅ 확장 후보 수집: ${productPool.products.length}개 / 스캔 카테고리 ${productPool.scannedCategoryCount}개`
  );

  const existingBrandLinks = await prisma.brandLink.findMany({
    select: {
      id: true,
      productName: true,
      storeName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      scheduledPublishAt: true,
    },
  });
  const duplicateReferenceNow = new Date();
  const existingStrictKeys = new Set<string>();
  const existingRelaxedKeys = new Set<string>();
  for (const row of existingBrandLinks) {
    if (!row.productName) continue;
    if (!shouldBlockDuplicateBrandLink(row, duplicateReferenceNow, options.duplicateWindowDays)) {
      continue;
    }
    const { strictKeys, relaxedKeys } = buildProductIdentityKeys(
      row.productName,
      row.storeName
    );
    for (const key of strictKeys) {
      existingStrictKeys.add(key);
    }
    for (const key of relaxedKeys) {
      existingRelaxedKeys.add(key);
    }
  }
  console.log(
    `✅ 최근 ${options.duplicateWindowDays}일 중복 제외 키: strict=${existingStrictKeys.size}, relaxed=${existingRelaxedKeys.size}`
  );

  const ranked = rankSeasonalProducts(productPool.products, options.selectionProfile);
  const selected = selectUniqueCandidates(
    ranked,
    ranked.length,
    existingStrictKeys,
    existingRelaxedKeys
  );
  if (selected.length < options.count) {
    console.log(
      `⚠️ 중복 제거 후 선별 가능한 상품이 ${selected.length}개입니다. (요청 ${options.count}개)`
    );
  }

  const getScheduledDate = (successIndex: number) =>
    addDaysToYmd(
      startDate,
      Math.floor(successIndex / options.dailyQuota) * options.intervalDays
    );

  console.log("\n📋 선별 결과");
  selected.slice(0, options.count).forEach((item, index) => {
    const boardName = inferBoardName(item.productName);
    const categoryNo = categoryMap.get(boardName) ?? null;
    console.log(
      `${String(index + 1).padStart(2, "0")}. [${boardName}/${categoryNo ?? "-"}] ${getScheduledDate(index)} | score=${item.score.toFixed(1)} | ${item.reasons.slice(0, 2).join(", ") || "계절/인기/할인 기반"} | ${item.productName}`
    );
  });

  const results: RegisterResult[] = [];
  const createdUrls = new Set<string>();
  let successfulRegisterCount = 0;

  for (const item of selected) {
    if (successfulRegisterCount >= options.count) {
      break;
    }

    const boardName = inferBoardName(item.productName);
    const categoryNo = categoryMap.get(boardName) ?? null;
    const scheduledDate = getScheduledDate(successfulRegisterCount);
    const plannedItem: PlannedProduct = {
      ...item,
      boardName,
      categoryNo,
      scheduledDate,
    };

    console.log(`\n🔗 링크 발급 중: ${item.productName}`);
    const shortUrl = await issueAffiliateShortUrl(
      page,
      item.id,
      issuedUrlsByProductId,
      spaceId
    );

    if (!shortUrl) {
      console.log(`   ❌ 링크 발급 실패 (productId=${item.id})`);
      results.push({
        action: "failed",
        productId: item.id,
        productName: item.productName,
        shortUrl: null,
        categoryNo: plannedItem.categoryNo,
        boardName: plannedItem.boardName,
        scheduledDate: plannedItem.scheduledDate,
        reason: "링크 발급 실패",
      });
      continue;
    }

    console.log(`   ✅ ${shortUrl}`);

    const normalizedShortUrl = shortUrl.toLowerCase();
    if (createdUrls.has(normalizedShortUrl)) {
      console.log(`   ↪️ 배치 내에서 중복 단축링크로 건너뜀 (${shortUrl})`);
      results.push({
        action: "duplicate",
        productId: item.id,
        productName: item.productName,
        shortUrl,
        categoryNo: plannedItem.categoryNo,
        boardName: plannedItem.boardName,
        scheduledDate: plannedItem.scheduledDate,
        reason: "이전 항목과 단축URL 중복",
      });
      continue;
    }

    const existing = await prisma.brandLink.findFirst({
      where: { url: shortUrl },
      orderBy: { updatedAt: "desc" },
    });
    if (existing?.status === "FAILED") {
      if (!options.dryRun) {
        await prisma.brandLink.update({
          where: { id: existing.id },
          data: {
            connectKind: toStoredConnectKind(options.connectKind),
            externalItemId: String(item.id),
            sourceUrl: options.categoryUrl,
            memo: buildMemo(plannedItem),
            categoryNo: existing.categoryNo || plannedItem.categoryNo,
            useSectionHeading: true,
            status: "READY",
            errorMessage: null,
            productName: item.productName,
            storeName: item.storeName || existing.storeName,
            productPrice: formatPrice(item.discountedSalePrice || item.salePrice),
            scheduledPublishAt: new Date(`${plannedItem.scheduledDate}T00:00:00.000Z`),
          },
        });
      }
      results.push({
        action: "updated",
        productId: item.id,
        productName: item.productName,
        shortUrl,
        categoryNo: existing.categoryNo || plannedItem.categoryNo,
        boardName: plannedItem.boardName,
        scheduledDate: plannedItem.scheduledDate,
        reason: options.dryRun ? "이전 실패 링크 복구 대상 (dry-run)" : "이전 실패 링크를 READY로 복구",
        linkId: existing.id,
      });
      console.log(`   ♻️ 이전 실패 링크를 READY로 복구 (${existing.id})`);
      createdUrls.add(normalizedShortUrl);
      successfulRegisterCount += 1;
      continue;
    }
    if (
      existing &&
      shouldBlockDuplicateBrandLink(existing, duplicateReferenceNow, options.duplicateWindowDays)
    ) {
      console.log(`   ↪️ 기존 링크 존재로 중복 건너뜀 (${existing.status})`);
      results.push({
        action: "duplicate",
        productId: item.id,
        productName: item.productName,
        shortUrl,
        categoryNo: existing.categoryNo,
        boardName: plannedItem.boardName,
        scheduledDate: plannedItem.scheduledDate,
        reason:
          existing.status === "READY"
            ? "이미 등록된 READY 링크라 새 상품 후보에서 제외"
            : existing.status === "SCHEDULED"
                ? "이미 예약완료 상태라 예약대상에서 제외"
                : existing.status === "PUBLISHED"
                  ? "이미 발행완료 상태라 예약대상에서 제외"
                  : `기존 상태 ${existing.status}`,
        linkId: existing.id,
      });
      continue;
    } else if (existing) {
      console.log(
        `   ↪️ 기존 링크는 ${existing.status}/${getDuplicateReferenceDate(existing).toISOString().slice(0, 10)} 기록이라 중복 판단에서 무시`
      );
    }

    if (options.dryRun) {
      results.push({
        action: "created",
        productId: item.id,
        productName: item.productName,
        shortUrl,
        categoryNo: plannedItem.categoryNo,
        boardName: plannedItem.boardName,
        scheduledDate: plannedItem.scheduledDate,
        reason: "dry-run",
      });
      successfulRegisterCount += 1;
      continue;
    }

    const scheduledPublishAt = new Date(`${plannedItem.scheduledDate}T00:00:00.000Z`);

    const created = await prisma.brandLink.create({
      data: {
        url: shortUrl,
        connectKind: toStoredConnectKind(options.connectKind),
        externalItemId: String(item.id),
        sourceUrl: options.categoryUrl,
        memo: buildMemo(plannedItem),
        categoryNo: plannedItem.categoryNo,
        useSectionHeading: true,
        status: "READY",
        productName: item.productName,
        storeName: item.storeName || null,
        productPrice: formatPrice(item.discountedSalePrice || item.salePrice),
        scheduledPublishAt,
      },
    });

    results.push({
      action: "created",
      productId: item.id,
      productName: item.productName,
      shortUrl,
      categoryNo: created.categoryNo,
      boardName: plannedItem.boardName,
      scheduledDate: plannedItem.scheduledDate,
      linkId: created.id,
    });
    console.log(`   ✅ 링크 등록 완료 (${created.id})`);
    createdUrls.add(normalizedShortUrl);
    successfulRegisterCount += 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(process.cwd(), "logs", "manual", "brandconnect");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `seasonal-register-${stamp}.json`);

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        options,
        startDate,
        selectedCount: selected.length,
        collectedProductCount: productPool.products.length,
        scannedCategoryCount: productPool.scannedCategoryCount,
        rankingPreview: selected.slice(0, options.count).map((item) => ({
          productId: item.id,
          productName: item.productName,
          score: Number(item.score.toFixed(1)),
          reasons: item.reasons,
          salesCount: item.salesCount,
          orderCount: item.orderCount,
          purchaseCount: item.purchaseCount,
          reviewCount: item.reviewCount,
          popularityScore: item.popularityScore,
          rank: item.rank,
          badges: item.badgeTexts,
          sourceCategoryIds: item.sourceCategoryIds,
          sourceCategoryNames: item.sourceCategoryNames,
        })),
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  const createdCount = results.filter((item) => item.action === "created").length;
  const updatedCount = results.filter((item) => item.action === "updated").length;
  const skippedCount = results.filter((item) => item.action === "skipped").length;
  const duplicateCount = results.filter((item) => item.action === "duplicate").length;
  const failedCount = results.filter((item) => item.action === "failed").length;

  console.log("\n" + "=".repeat(70));
  console.log("✅ 시즌·히트·인기 링크 등록 작업 완료");
  console.log(`- 생성: ${createdCount}`);
  console.log(`- 복구·최신화: ${updatedCount}`);
  console.log(`- 스킵: ${skippedCount}`);
  if (duplicateCount > 0) {
    console.log(`- 중복: ${duplicateCount}`);
  }
  console.log(`- 실패: ${failedCount}`);
  console.log(`- 리포트: ${path.relative(process.cwd(), reportPath)}`);
  console.log("=".repeat(70));

  if (!options.dryRun) {
    await notifyAndLogCompletion({
      taskType: "brandconnect.seasonal.register",
      title: "시즌·히트·인기 상품 등록 완료",
      summary: `신규 ${createdCount}건, 복구·최신화 ${updatedCount}건, 중복 건너뜀 ${duplicateCount}건, 실패 ${failedCount}건`,
      successCount: createdCount + updatedCount,
      failedCount,
      links: results.map((item) => ({
        label: item.productName,
        url: item.shortUrl || (item.linkId ? buildAppUrl(`/?brandLinkId=${item.linkId}`) : buildAppUrl("/")),
        scheduledDate: item.scheduledDate,
        status: item.action.toUpperCase(),
        description: item.reason || `${item.boardName}${item.categoryNo ? ` / ${item.categoryNo}` : ""}`,
      })),
      extra: {
        createdCount,
        updatedCount,
        skippedCount,
        duplicateCount,
        failedCount,
        reportPath: path.relative(process.cwd(), reportPath),
        selectionProfile: options.selectionProfile,
        collectedProductCount: productPool.products.length,
        scannedCategoryCount: productPool.scannedCategoryCount,
      },
    });
  }

  await context.close();
  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("❌ 실행 실패:", message);
  await notifyAndLogCompletion({
    taskType: "brandconnect.seasonal.register.fatal-error",
    title: "시즌·히트·인기 상품 등록 오류",
    summary: message,
    successCount: 0,
    failedCount: 1,
    links: [
      {
        label: "대시보드 확인",
        url: buildAppUrl("/"),
        status: "FAILED",
        description: message,
      },
    ],
    extra: {
      fatal: true,
    },
  });
  process.exit(1);
});

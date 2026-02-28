import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium } from "playwright-extra";
import type { APIResponse, Page } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { PrismaClient } from "@prisma/client";

chromium.use(StealthPlugin());

const DEFAULT_CATEGORY_URL =
  "https://brandconnect.naver.com/916297527319296/affiliate/products/category/10031299";
const DEFAULT_STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "playwright",
  "storage",
  "naver-session.json"
);
const KST_TIMEZONE = "Asia/Seoul";
const BRANDCONNECT_MINIMIZE_WINDOW =
  (process.env.BRANDCONNECT_MINIMIZE_WINDOW || "true").toLowerCase() === "true";

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
  categoryUrl: string;
  count: number;
  startDate: string | null;
  intervalDays: number;
  dryRun: boolean;
  headless: boolean;
  storageStatePath: string;
}

interface ProductApiItem {
  id: number;
  productName: string;
  storeName: string;
  commissionRate: number;
  discountedRate: number;
  salePrice: number;
  discountedSalePrice: number;
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
    categoryUrl: DEFAULT_CATEGORY_URL,
    count: 10,
    startDate: null,
    intervalDays: 1,
    dryRun: false,
    headless: false,
    storageStatePath: DEFAULT_STORAGE_STATE_PATH,
  };

  for (const arg of argv) {
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
      if (Number.isFinite(value) && value > 0 && value <= 30) {
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
    if (arg.startsWith("--storage-state=")) {
      const value = arg.split("=")[1]?.trim() || "";
      if (value) {
        options.storageStatePath = path.isAbsolute(value)
          ? value
          : path.join(process.cwd(), value);
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
      commissionRate: parseNumber(obj.commissionRate),
      discountedRate: parseNumber(obj.discountedRate),
      salePrice: parseNumber(obj.salePrice),
      discountedSalePrice: parseNumber(obj.discountedSalePrice),
    });
  }

  return parsed;
}

function rankSeasonalProducts(items: ProductApiItem[]): CandidateProduct[] {
  const monthInKst = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: KST_TIMEZONE,
      month: "2-digit",
    }).format(new Date())
  );

  return items
    .map((item) => {
      const title = item.productName.toLowerCase();
      let score = 0;
      const reasons: string[] = [];

      const isSpring = monthInKst >= 2 && monthInKst <= 4;

      if (/청소|살균|스팀|보풀|먼지|세척|정리|음식물/.test(title)) {
        score += isSpring ? 45 : 30;
        reasons.push("봄맞이 청소/정리 수요");
      }

      if (/드라이|면도|제모|고데기|미용|뷰티|칫솔|구강/.test(title)) {
        score += isSpring ? 38 : 26;
        reasons.push("개인관리/미용 수요");
      }

      if (/가습기|계절가전|온열|매트/.test(title)) {
        score += monthInKst <= 3 ? 16 : 6;
        reasons.push("계절가전 수요");
      }

      if (/주방|에어프라이|오븐|찜기|그릴|포트/.test(title)) {
        score += 18;
        reasons.push("주방 소형가전 지속 수요");
      }

      if (/이어폰|마이크|무선|노트북|tv|전자/.test(title)) {
        score += 14;
        reasons.push("디지털/전자 관심도");
      }

      score += Math.min(item.commissionRate, 30) * 2.1;
      score += Math.min(item.discountedRate, 70) * 0.45;

      const effectivePrice = item.discountedSalePrice || item.salePrice;
      if (effectivePrice >= 100000) {
        score += 4;
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
  const reasonText = item.reasons.slice(0, 2).join(", ");
  return [
    `[시즌선별 자동등록] score=${item.score.toFixed(1)}`,
    `수수료 ${item.commissionRate}%`,
    `할인율 ${item.discountedRate}%`,
    `근거: ${reasonText || "수수료/할인 기반"}`,
  ].join(" | ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  const blogId = process.env.NAVER_BLOG_ID?.trim();
  if (!blogId) {
    throw new Error(".env의 NAVER_BLOG_ID가 필요합니다.");
  }
  const spaceId = options.categoryUrl.match(/brandconnect\.naver\.com\/(\d+)\//)?.[1];
  if (!spaceId) {
    throw new Error("category-url에서 spaceId를 추출하지 못했습니다.");
  }

  const startDate =
    options.startDate ?? addDaysToYmd(formatKstYmd(new Date()), 1);

  console.log("=".repeat(70));
  console.log("📦 BrandConnect 시즌성 상품 자동 등록 시작");
  console.log(`- categoryUrl: ${options.categoryUrl}`);
  console.log(`- count: ${options.count}`);
  console.log(`- startDate: ${startDate}`);
  console.log(`- intervalDays: ${options.intervalDays}`);
  console.log(`- dryRun: ${options.dryRun ? "YES" : "NO"}`);
  console.log("=".repeat(70));

  const categoryMap = await fetchBlogCategoryMap(options.storageStatePath, blogId);
  console.log(`✅ 게시판 매핑 로드: ${categoryMap.size}개`);

  const browser = await chromium.launch({
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

  await page.waitForSelector("li.ProductSearchCategory_item__epUPF", { timeout: 30000 });

  for (let i = 0; i < 20 && productsFromApi.length === 0; i += 1) {
    await page.waitForTimeout(300);
  }

  if (productsFromApi.length === 0) {
    throw new Error("상품 목록 API 응답을 확보하지 못했습니다.");
  }

  console.log(`✅ 카테고리 상품 수집: ${productsFromApi.length}개`);

  const existingActiveLinks = await prisma.brandLink.findMany({
    where: {
      status: {
        in: ["READY", "PUBLISHING", "SCHEDULED", "PUBLISHED"],
      },
    },
    select: {
      productName: true,
      storeName: true,
    },
  });
  const existingStrictKeys = new Set<string>();
  const existingRelaxedKeys = new Set<string>();
  for (const row of existingActiveLinks) {
    if (!row.productName) continue;
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

  const ranked = rankSeasonalProducts(productsFromApi);
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
    addDaysToYmd(startDate, successIndex * options.intervalDays);

  console.log("\n📋 선별 결과");
  selected.slice(0, options.count).forEach((item, index) => {
    const boardName = inferBoardName(item.productName);
    const categoryNo = categoryMap.get(boardName) ?? CATEGORY_NAME_FALLBACK[boardName] ?? null;
    console.log(
      `${String(index + 1).padStart(2, "0")}. [${boardName}/${categoryNo ?? "-"}] ${getScheduledDate(index)} | score=${item.score.toFixed(1)} | 수수료 ${item.commissionRate}% | ${item.productName}`
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
    const categoryNo = categoryMap.get(boardName) ?? CATEGORY_NAME_FALLBACK[boardName] ?? null;
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

    const existing = await prisma.brandLink.findFirst({ where: { url: shortUrl } });
    if (existing) {
      console.log(`   ↪️ 기존 링크 존재로 중복 건너뜀 (${existing.status})`);
      results.push({
        action: "duplicate",
        productId: item.id,
        productName: item.productName,
        shortUrl,
        categoryNo: existing.categoryNo,
        boardName: plannedItem.boardName,
        scheduledDate: plannedItem.scheduledDate,
        reason: `기존 상태 ${existing.status}`,
        linkId: existing.id,
      });
      continue;
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
  console.log("✅ 시즌성 링크 등록 작업 완료");
  console.log(`- 생성: ${createdCount}`);
  console.log(`- 업데이트: ${updatedCount}`);
  console.log(`- 스킵: ${skippedCount}`);
  if (duplicateCount > 0) {
    console.log(`- 중복: ${duplicateCount}`);
  }
  console.log(`- 실패: ${failedCount}`);
  console.log(`- 리포트: ${path.relative(process.cwd(), reportPath)}`);
  console.log("=".repeat(70));

  await context.close();
  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("❌ 실행 실패:", message);
  process.exit(1);
});

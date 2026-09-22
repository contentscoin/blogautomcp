import { getConfiguredConnectUrl, getShoppingCategoryIdFromUrl, getSpaceIdFromConnectUrl } from "./brandconnect-kind";
import { buildCookieHeaderForHost } from "./naver-session";
import type { APIRequestContext, Browser } from "playwright";

const BRANDCONNECT_ORIGIN = "https://brandconnect.naver.com";
const BRANDCONNECT_GATEWAY = "https://gw-brandconnect.naver.com";
const BRANDCONNECT_ACCOUNT_URL = `${BRANDCONNECT_GATEWAY}/brand-connect/query/me`;
const BRANDCONNECT_BASE_CATEGORIES_URL = `${BRANDCONNECT_GATEWAY}/affiliate/query/base-display-categories`;
const BRANDCONNECT_LOGIN_URL = `https://nid.naver.com/nidlogin.login?url=${BRANDCONNECT_ORIGIN}`;
const SHOPPING_DISCOVERY_REQUEST_TIMEOUT_MS = 8_000;

interface ShoppingJsonResult {
  status: number;
  payload: unknown;
}

type ShoppingJsonRequest = (url: string, spaceId?: string) => Promise<ShoppingJsonResult>;
type ShoppingSessionProbe = (storageStatePath: string) => Promise<string | null>;

export class ShoppingConnectAccessError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(`${code}: ${message}`);
    this.name = "ShoppingConnectAccessError";
  }
}

export function assertShoppingAccess(status: number): void {
  if (status === 401) throw new ShoppingConnectAccessError("NAVER_SESSION_EXPIRED", "네이버 로그인 세션을 다시 연결하세요.", 401);
  if (status === 403) throw new ShoppingConnectAccessError("SHOPPING_ACCESS_DENIED", "현재 계정의 쇼핑커넥트 공간 주소와 이용 권한을 확인하세요. 로그인 만료로 단정할 수 없습니다.", 403);
}

/** Accept only observed category URLs; never synthesize an account or category ID. */
export function shoppingCategoryUrls(hrefs: string[], base = "https://brandconnect.naver.com/"): string[] {
  return [...new Set(hrefs.flatMap(href => {
    try {
      const url = new URL(href, base);
      if (url.origin !== "https://brandconnect.naver.com" || url.username || url.password ||
          !/^\/\d+\/affiliate\/products\/category\/\d+\/?$/.test(url.pathname)) return [];
      return [url.origin + url.pathname.replace(/\/$/, "")];
    } catch { return []; }
  }))];
}

export function selectShoppingCategory(hrefs: string[], base?: string): string | null {
  const urls = shoppingCategoryUrls(hrefs, base);
  const spaces = new Set(urls.map(getSpaceIdFromConnectUrl));
  if (spaces.size > 1) throw new ShoppingConnectAccessError("SHOPPING_SPACE_SELECTION_REQUIRED", "여러 쇼핑 공간이 발견되었습니다. 사용할 계정 공간의 상품 카테고리 주소를 지정하세요.");
  return urls[0] || null;
}

function numericId(value: unknown): string | null {
  const candidate = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d+$/.test(candidate) ? candidate : null;
}

function objectId(value: unknown): string | null {
  if (!value || typeof value !== "object") return numericId(value);
  const object = value as Record<string, unknown>;
  return numericId(object.id) || numericId(object.spaceId) || numericId(object.displayCategoryId);
}

function shoppingSpaceId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const account = payload as Record<string, unknown>;
  const current = objectId(account.space);
  if (current) return current;

  const active = Array.isArray(account.activeSpaceIds)
    ? [...new Set(account.activeSpaceIds.map(objectId).filter((id): id is string => Boolean(id)))]
    : [];
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    throw new ShoppingConnectAccessError("SHOPPING_SPACE_SELECTION_REQUIRED", "여러 쇼핑 공간이 발견되었습니다. 사용할 계정 공간의 상품 카테고리 주소를 지정하세요.");
  }

  const spaces = Array.isArray(account.spaces)
    ? [...new Set(account.spaces.map(objectId).filter((id): id is string => Boolean(id)))]
    : [];
  if (spaces.length === 1) return spaces[0];
  if (spaces.length > 1) {
    throw new ShoppingConnectAccessError("SHOPPING_SPACE_SELECTION_REQUIRED", "여러 쇼핑 공간이 발견되었습니다. 사용할 계정 공간의 상품 카테고리 주소를 지정하세요.");
  }
  if (typeof account.loginId === "string" && account.loginId.trim()) {
    throw new ShoppingConnectAccessError("SHOPPING_ACCESS_DENIED", "로그인은 확인했지만 이 계정의 쇼핑커넥트 공간을 찾지 못했습니다. 쇼핑커넥트 가입·이용 권한을 확인하세요.", 403);
  }
  return null;
}

function shoppingCategoryIds(payload: unknown): string[] {
  const object = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(object?.categories)
      ? object.categories
      : Array.isArray(object?.data)
        ? object.data
        : [];
  return [...new Set(rows.map(objectId).filter((id): id is string => Boolean(id)))];
}

function hasProducts(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.length > 0;
  if (!payload || typeof payload !== "object") return false;
  const data = (payload as Record<string, unknown>).data;
  return Array.isArray(data) && data.length > 0;
}

async function discoverShoppingCategoryFromRequest(requestJson: ShoppingJsonRequest): Promise<string | null> {
  const account = await requestJson(BRANDCONNECT_ACCOUNT_URL);
  assertShoppingAccess(account.status);
  if (account.status < 200 || account.status >= 300) return null;
  const spaceId = shoppingSpaceId(account.payload);
  if (!spaceId) return null;

  const categories = await requestJson(BRANDCONNECT_BASE_CATEGORIES_URL, spaceId);
  assertShoppingAccess(categories.status);
  if (categories.status < 200 || categories.status >= 300) return null;
  const categoryIds = shoppingCategoryIds(categories.payload);
  if (!categoryIds.length) return null;

  // Pick an observed category that actually exposes at least one product when
  // possible. This avoids selecting an empty top category on a new account.
  const productChecks = await Promise.all(categoryIds.slice(0, 6).map(async categoryId => {
    const productUrl = new URL(`${BRANDCONNECT_GATEWAY}/affiliate/query/affiliate-products/search-by-display-category`);
    productUrl.searchParams.set("displayCategoryId", categoryId);
    productUrl.searchParams.set("limit", "1");
    const products = await requestJson(productUrl.toString(), spaceId);
    return { categoryId, products };
  }));
  for (const { categoryId, products } of productChecks) {
    assertShoppingAccess(products.status);
    if (products.status >= 200 && products.status < 300 && hasProducts(products.payload)) {
      return `${BRANDCONNECT_ORIGIN}/${spaceId}/affiliate/products/category/${categoryId}`;
    }
  }
  return `${BRANDCONNECT_ORIGIN}/${spaceId}/affiliate/products/category/${categoryIds[0]}`;
}

/** Discover only IDs returned by the signed-in account and category APIs. */
export async function probeShoppingCategoryFromSession(
  storageStatePath: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const cookieHeader = buildCookieHeaderForHost(storageStatePath, "gw-brandconnect.naver.com");
  if (!cookieHeader) {
    throw new ShoppingConnectAccessError("NAVER_SESSION_EXPIRED", "네이버 로그인 세션을 다시 연결하세요.", 401);
  }
  return discoverShoppingCategoryFromRequest(async (url, spaceId) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SHOPPING_DISCOVERY_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/plain, */*",
          cookie: cookieHeader,
          origin: BRANDCONNECT_ORIGIN,
          referer: `${BRANDCONNECT_ORIGIN}/about`,
          ...(spaceId ? { "x-space-id": spaceId } : {}),
        },
      });
      const payload = await response.json().catch(() => null);
      return { status: response.status, payload };
    } catch {
      return { status: 0, payload: null };
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function probeShoppingCategoryFromApiRequest(request: APIRequestContext): Promise<string | null> {
  return discoverShoppingCategoryFromRequest(async (url, spaceId) => {
    const response = await request.get(url, {
      timeout: SHOPPING_DISCOVERY_REQUEST_TIMEOUT_MS,
      headers: {
        accept: "application/json, text/plain, */*",
        origin: BRANDCONNECT_ORIGIN,
        referer: `${BRANDCONNECT_ORIGIN}/about`,
        ...(spaceId ? { "x-space-id": spaceId } : {}),
      },
    }).catch(() => null);
    if (!response) return { status: 0, payload: null };
    return { status: response.status(), payload: await response.json().catch(() => null) };
  });
}

async function launchDiscoveryBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({ channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
    headless: process.env.BRANDCONNECT_CAPTURE_HEADLESS?.trim().toLowerCase() === "true" });
}

export async function discoverShoppingCategory(
  storageStatePath: string,
  launch = launchDiscoveryBrowser,
  probe: ShoppingSessionProbe = probeShoppingCategoryFromSession,
): Promise<string> {
  const directlyObserved = await probe(storageStatePath);
  if (directlyObserved) return directlyObserved;
  // Dedicated read-only context: cleanup must never close a material worker's browser.
  const browser = await launch();
  try {
    const context = await browser.newContext({ storageState: storageStatePath });
    const initialApiCategory = await probeShoppingCategoryFromApiRequest(context.request);
    if (initialApiCategory) return initialApiCategory;

    const loginResponse = await context.request.get(BRANDCONNECT_LOGIN_URL, {
      maxRedirects: 10,
      timeout: 20_000,
    }).catch(() => null);
    if (loginResponse) {
      const finalUrl = new URL(loginResponse.url());
      if (finalUrl.origin === "https://nid.naver.com" && finalUrl.pathname === "/nidlogin.login") {
        assertShoppingAccess(401);
      }
      const authenticatedApiCategory = await probeShoppingCategoryFromApiRequest(context.request);
      if (authenticatedApiCategory) return authenticatedApiCategory;
    }

    const page = await context.newPage();
    await page.goto(`${BRANDCONNECT_ORIGIN}/`, { waitUntil: "commit", timeout: 30_000 });
    const deadline = Date.now() + 30_000;
    const visited = new Set<string>();
    let followedLogin = false;
    while (Date.now() < deadline) {
      if (/nid\.naver\.com|nidlogin|login\.naver/i.test(page.url())) assertShoppingAccess(401);
      const hrefs = await page.locator("a[href]").evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href)).catch(error => {
        // Redirects can replace the execution context between URL and DOM reads.
        if (/Execution context was destroyed/iu.test(String(error))) return [];
        throw error;
      });
      const selected = selectShoppingCategory([page.url(), ...hrefs]);
      if (selected) return selected;
      // The public home redirects to /about even with Naver cookies. Follow its
      // observed SSO entry once; never enter credentials or guess an account URL.
      const loginHref = hrefs.find(href => {
        try { const u = new URL(href); return u.origin === "https://nid.naver.com" && u.pathname === "/nidlogin.login"; }
        catch { return false; }
      });
      if (loginHref && !followedLogin) {
        followedLogin = true;
        await page.goto(loginHref, { waitUntil: "commit", timeout: 15_000 });
        await page.waitForURL(url => url.origin === "https://brandconnect.naver.com", { timeout: 10_000 }).catch(() => {});
        continue;
      }
      const shoppingLinks = hrefs.filter(href => {
        try { const u = new URL(href); return u.origin === "https://brandconnect.naver.com" && /^\/\d+\/affiliate(?:\/|$)/.test(u.pathname); }
        catch { return false; }
      });
      if (new Set(shoppingLinks.map(getSpaceIdFromConnectUrl)).size > 1)
        throw new ShoppingConnectAccessError("SHOPPING_SPACE_SELECTION_REQUIRED", "여러 쇼핑 공간이 발견되었습니다. 상품 카테고리 주소를 지정하세요.");
      const next = shoppingLinks.find(href => !visited.has(href) && href !== page.url());
      if (next && visited.size < 3) {
        visited.add(next);
        await page.goto(next, { waitUntil: "commit", timeout: 15_000 });
      } else await page.waitForTimeout(500);
    }
    throw new ShoppingConnectAccessError("SHOPPING_SETUP_REQUIRED", "로그인된 계정에서 쇼핑 상품 카테고리 주소를 찾지 못했습니다. 쇼핑커넥트 이용 권한과 상품 목록 주소를 확인하세요.");
  } catch (error) {
    if (error instanceof ShoppingConnectAccessError) throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw new ShoppingConnectAccessError("SHOPPING_DISCOVERY_TIMEOUT", "쇼핑 공간 탐색 응답이 지연되었습니다. 네이버 접속 상태를 확인하거나 상품 목록 주소를 지정하세요.", 504);
    throw error;
  } finally { await browser.close().catch(() => {}); }
}

/** Both list and registration use this resolver. No cross-account fallback/cache. */
export async function resolveShoppingCategoryUrl(requestedUrl: string | null | undefined, storageStatePath: string,
  discover = discoverShoppingCategory): Promise<string> {
  const configured = getConfiguredConnectUrl("shopping", requestedUrl);
  const url = configured || await discover(storageStatePath);
  if (!shoppingCategoryUrls([url]).length || !getSpaceIdFromConnectUrl(url) || !getShoppingCategoryIdFromUrl(url))
    throw new ShoppingConnectAccessError("SHOPPING_CATEGORY_URL_REQUIRED", "쇼핑커넥트 상품 카테고리 주소가 필요합니다.");
  return url;
}

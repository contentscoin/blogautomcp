import { getConfiguredConnectUrl, getShoppingCategoryIdFromUrl, getSpaceIdFromConnectUrl } from "./brandconnect-kind";
import type { Browser } from "playwright";

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

async function launchDiscoveryBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({ channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
    headless: process.env.BRANDCONNECT_CAPTURE_HEADLESS?.trim().toLowerCase() === "true" });
}

export async function discoverShoppingCategory(storageStatePath: string, launch = launchDiscoveryBrowser): Promise<string> {
  // Dedicated read-only context: cleanup must never close a material worker's browser.
  const browser = await launch();
  try {
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();
    await page.goto("https://brandconnect.naver.com/", { waitUntil: "commit", timeout: 30_000 });
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

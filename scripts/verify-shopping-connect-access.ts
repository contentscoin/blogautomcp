import assert from "node:assert/strict";
import { assertShoppingAccess, discoverShoppingCategory, resolveShoppingCategoryUrl, selectShoppingCategory, ShoppingConnectAccessError } from "../src/lib/shopping-connect-access";
import type { Browser } from "playwright";

async function main() {
  const prior = process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL;
  delete process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL;
  try {
    const first = "https://brandconnect.naver.com/111/affiliate/products/category/77";
    const second = "https://brandconnect.naver.com/222/affiliate/products/category/88";
    let calls = 0;
    assert.equal(await resolveShoppingCategoryUrl(null, "account-a", async state => { calls++; assert.equal(state, "account-a"); return first; }), first);
    assert.equal(await resolveShoppingCategoryUrl(null, "account-b", async () => { calls++; return second; }), second);
    assert.equal(calls, 2, "new accounts must never reuse another account's fallback");
    assert.equal(await resolveShoppingCategoryUrl(second, "unused", async () => { throw Error("unnecessary discovery"); }), second);
    assert.equal(selectShoppingCategory(["/111/affiliate/products/category/77?tracking=1"]), first);
    assert.equal(selectShoppingCategory(["https://brandconnect.naver.com.evil.test/111/affiliate/products/category/77", "/111/travel-connect/products"]), null);
    assert.throws(() => selectShoppingCategory([first, second]), /SHOPPING_SPACE_SELECTION_REQUIRED/);
    await assert.rejects(resolveShoppingCategoryUrl("https://brandconnect.naver.com/111/travel-connect/products", "unused"), /CONNECT_KIND_URL_MISMATCH/);
    assert.throws(() => assertShoppingAccess(401), (e: unknown) => e instanceof ShoppingConnectAccessError && e.code === "NAVER_SESSION_EXPIRED" && e.status === 401);
    assert.throws(() => assertShoppingAccess(403), (e: unknown) => e instanceof ShoppingConnectAccessError && e.code === "SHOPPING_ACCESS_DENIED" && e.status === 403);
    assert.doesNotThrow(() => assertShoppingAccess(200));
    let closed = 0;
    let currentUrl = "https://brandconnect.naver.com/";
    const visited: string[] = [];
    const page = { goto: async (url: string) => { visited.push(url); currentUrl = url; }, url: () => currentUrl,
      waitForURL: async () => { currentUrl = "https://brandconnect.naver.com/111/affiliate"; },
      locator: () => ({ evaluateAll: async () => currentUrl.endsWith("/111/affiliate") ? [first] : ["https://brandconnect.naver.com/111/affiliate"] }) };
    const browser = { newContext: async (options: { storageState: string }) => { assert.equal(options.storageState, "account-a"); return { newPage: async () => page }; }, close: async () => { closed++; } } as unknown as Browser;
    assert.equal(await discoverShoppingCategory("account-a", async () => browser), first);
    assert.equal(visited.length, 2, "discovery follows only the observed shopping link");
    assert.equal(closed, 1, "owned browser is closed after discovery");
    page.locator = () => ({ evaluateAll: async () => currentUrl.endsWith("/111/affiliate") ? [first] : ["https://nid.naver.com/nidlogin.login?url=observed-sso"] });
    assert.equal(await discoverShoppingCategory("account-a", async () => browser), first, "public landing page follows observed Naver SSO link without credentials");
    assert.equal(closed, 2);
    page.goto = async () => { currentUrl = "https://nid.naver.com/nidlogin.login"; };
    await assert.rejects(discoverShoppingCategory("account-a", async () => browser), /NAVER_SESSION_EXPIRED/);
    assert.equal(closed, 3, "owned browser is closed on auth failure too");
    console.log("PASS: account-isolated shopping discovery, URL safety, explicit config, 401/403 separation");
  } finally {
    if (prior === undefined) delete process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL;
    else process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL = prior;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

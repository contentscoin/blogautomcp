import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertShoppingAccess, discoverShoppingCategory, probeShoppingCategoryFromSession, resolveShoppingCategoryUrl, selectShoppingCategory, ShoppingConnectAccessError } from "../src/lib/shopping-connect-access";
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopping-connect-access-"));
    const sessionPath = path.join(tempDir, "naver-session.json");
    fs.writeFileSync(sessionPath, JSON.stringify({ cookies: [{ name: "NID_SES", value: "fixture", domain: ".naver.com" }] }));
    const apiCalls: string[] = [];
    const apiFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      apiCalls.push(url);
      if (url.endsWith("/brand-connect/query/me")) {
        return new Response(JSON.stringify({ loginId: "fixture", activeSpaceIds: ["333"], spaces: [{ id: 333 }] }), { status: 200 });
      }
      if (url.endsWith("/affiliate/query/base-display-categories")) {
        return new Response(JSON.stringify([{ id: 91, name: "empty" }, { id: "92", name: "usable" }]), { status: 200 });
      }
      const categoryId = new URL(url).searchParams.get("displayCategoryId");
      return new Response(JSON.stringify({ data: categoryId === "92" ? [{ productName: "fixture" }] : [] }), { status: 200 });
    };
    assert.equal(
      await probeShoppingCategoryFromSession(sessionPath, apiFetch as typeof fetch),
      "https://brandconnect.naver.com/333/affiliate/products/category/92",
      "account and category API evidence discovers a usable category without DOM links",
    );
    assert.equal(apiCalls.length, 4, "probe checks account, categories, then bounded product evidence");
    await assert.rejects(
      probeShoppingCategoryFromSession(sessionPath, (async (input: string | URL | Request) => {
        if (String(input).endsWith("/brand-connect/query/me")) {
          return new Response(JSON.stringify({ loginId: "fixture", activeSpaceIds: ["1", "2"] }), { status: 200 });
        }
        throw new Error("unexpected request");
      }) as typeof fetch),
      /SHOPPING_SPACE_SELECTION_REQUIRED/,
    );
    await assert.rejects(
      probeShoppingCategoryFromSession(sessionPath, (async () => new Response("{}", { status: 401 })) as typeof fetch),
      /NAVER_SESSION_EXPIRED/,
    );
    assert.equal(
      await probeShoppingCategoryFromSession(sessionPath, (async () => new Response(JSON.stringify({ loginId: null, spaces: null }), { status: 200 })) as typeof fetch),
      null,
      "an unsigned BrandConnect response falls through to SSO discovery",
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
    let closed = 0;
    let currentUrl = "https://brandconnect.naver.com/";
    const visited: string[] = [];
    const page = { goto: async (url: string) => { visited.push(url); currentUrl = url; }, url: () => currentUrl,
      waitForURL: async () => { currentUrl = "https://brandconnect.naver.com/111/affiliate"; },
      locator: () => ({ evaluateAll: async () => currentUrl.endsWith("/111/affiliate") ? [first] : ["https://brandconnect.naver.com/111/affiliate"] }) };
    const browser = { newContext: async (options: { storageState: string }) => { assert.equal(options.storageState, "account-a"); return { request: { get: async () => null }, newPage: async () => page }; }, close: async () => { closed++; } } as unknown as Browser;
    const noApiCategory = async () => null;
    assert.equal(await discoverShoppingCategory("account-a", async () => browser, noApiCategory), first);
    assert.equal(visited.length, 2, "discovery follows only the observed shopping link");
    assert.equal(closed, 1, "owned browser is closed after discovery");
    page.locator = () => ({ evaluateAll: async () => currentUrl.endsWith("/111/affiliate") ? [first] : ["https://nid.naver.com/nidlogin.login?url=observed-sso"] });
    assert.equal(await discoverShoppingCategory("account-a", async () => browser, noApiCategory), first, "public landing page follows observed Naver SSO link without credentials");
    assert.equal(closed, 2);
    page.goto = async () => { currentUrl = "https://nid.naver.com/nidlogin.login"; };
    await assert.rejects(discoverShoppingCategory("account-a", async () => browser, noApiCategory), /NAVER_SESSION_EXPIRED/);
    assert.equal(closed, 3, "owned browser is closed on auth failure too");
    console.log("PASS: account-isolated shopping discovery, URL safety, explicit config, 401/403 separation");
  } finally {
    if (prior === undefined) delete process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL;
    else process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL = prior;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

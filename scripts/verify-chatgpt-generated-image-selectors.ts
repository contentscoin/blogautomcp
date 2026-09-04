/** Offline HTML fixtures using the declared Playwright dependency and an installed browser. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as imagePolicy from "./lib/image-timeout-policy";
import * as browserErrors from "./lib/chatgpt-browser-errors";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type * as ChatGPTBrowser from "./lib/chatgpt-browser";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-generated-selectors-"));
const quietConsole = { log() {}, error() {} };
const source = fs.readFileSync(path.resolve("scripts/lib/chatgpt-browser.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loadedModule = { exports: {} };
const dependencies: Record<string, unknown> = {
  fs, path,
  playwright: { chromium: { launch() { throw new Error("Browser launch forbidden in offline fixtures"); } } },
  "./app-paths": { getChatgptProfileDir: () => root, getChatgptSessionFile: () => path.join(root, "unused.json") },
  "./chatgpt-browser-visibility": {},
  "./chatgpt-browser-errors": browserErrors,
  "./image-timeout-policy": imagePolicy,
  "./chatgpt-profile-lock": {},
};
vm.runInNewContext(compiled, {
  module: loadedModule, exports: loadedModule.exports, process, Buffer, console: quietConsole,
  require: (name: string) => {
    assert.ok(Object.prototype.hasOwnProperty.call(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  },
});
const api = loadedModule.exports as typeof ChatGPTBrowser;
let checks = 0;
const image = (src: string, attrs = "") => `<img src="${src}" ${attrs}>`;
const assistant = (content: string) => `<article data-testid="conversation-turn-2"><div data-message-author-role="assistant">${content}</div></article>`;
const user = (content: string) => `<article data-testid="conversation-turn-1"><div data-message-author-role="user">${content}</div></article>`;
const dataUrl = `data:image/png;base64,${Buffer.from("generated data image").toString("base64")}`;
let context: BrowserContext;

async function fixture(html: string, onWait?: (document: Document, elapsed: number) => void) {
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  const fetched: string[] = [];
  let elapsed = 0;
  await page.exposeFunction("recordFixtureFetch", (url: string) => { fetched.push(url); });
  await page.evaluate(() => {
    for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
      Object.defineProperties(img, {
        complete: { configurable: true, get: () => img.getAttribute("data-loading") !== "true" },
        naturalWidth: { configurable: true, get: () => Number(img.getAttribute("data-natural-width") || 1024) },
        naturalHeight: { configurable: true, get: () => Number(img.getAttribute("data-natural-height") || 1024) },
        currentSrc: { configurable: true, get: () => img.getAttribute("data-current-src") || img.getAttribute("src") || "" },
      });
      img.getBoundingClientRect = () => ({
        width: Number(img.getAttribute("data-width") || 400), height: Number(img.getAttribute("data-height") || 400),
        top: 0, left: 0, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
      });
    }
    // Native DOM/CSS selectors execute in Chromium; only image I/O and readiness are fixtures.
    Object.defineProperty(window, "fetch", { value: async (url: string) => {
      await (window as typeof window & { recordFixtureFetch: (url: string) => Promise<void> }).recordFixtureFetch(url);
      if (url.includes("network-error")) throw new Error("offline network failure");
      return {
        ok: !url.includes("http-error"),
        blob: async () => ({ type: url.includes("not-image") ? "text/html" : "image/png", url }),
      };
    } });
    Object.defineProperty(window, "FileReader", { value: class {
      result: string | null = null;
      error = new Error("fixture read failed");
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      readAsDataURL(blob: { url: string }) {
        if (blob.url.includes("read-error")) { this.onerror?.(); return; }
        if (blob.url.includes("read-abort")) { this.onabort?.(); return; }
        this.result = `data:image/png;base64,${btoa(blob.url)}`;
        this.onload?.();
      }
    } });
  });
  // Advance the tested polling logic without real 3/5-second sleeps.
  page.waitForTimeout = async (ms: number) => {
    elapsed += ms;
    if (onWait) await page.evaluate(
      ({ callback, elapsed }) => { new Function("document", "elapsed", `(${callback})(document, elapsed)`)(document, elapsed); },
      { callback: onWait.toString(), elapsed },
    );
  };
  page.screenshot = async () => { throw new Error("No screenshot in offline fixture"); };
  return { page, fetched, get elapsed() { return elapsed; },
    wait: (ms: number) => api.waitForChatGPTImageArtifacts(page, ms, { now: () => elapsed }) };
}

async function check(name: string, test: () => Promise<void>) {
  await test();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  let browser: Browser | undefined;
  try {
    // A fresh headless context never connects to the user's active browser/profile.
    const options = { headless: true, args: ["--disable-background-networking", "--disable-component-update"] };
    if (fs.existsSync(chromium.executablePath())) browser = await chromium.launch(options);
    else {
      for (const channel of ["msedge", "chrome"]) {
        try { browser = await chromium.launch({ ...options, channel }); break; } catch { /* Try another installed browser. */ }
      }
    }
    if (!browser) throw new Error("Offline fixtures need installed Playwright Chromium, Edge, or Chrome. No browser was downloaded.");
    context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort());
    await check("attachments, composer previews and avatars never count or download", async () => {
      const f = await fixture(user(image("https://fixture/reference", 'data-width="1200" data-height="1200"')) +
        `<div data-testid="attachment-preview">${image("blob:upload")}</div>` +
        image("https://fixture/avatar.png", 'alt="Avatar"') +
        assistant(image("https://fixture/other-avatar", 'alt="Profile picture"') + image("https://fixture/avatar.png")));
      assert.equal(await api.countRenderableChatGPTImages(f.page), 0);
      assert.equal((await api.downloadChatGPTImages(f.page, path.join(root, "excluded"))).length, 0);
      assert.equal(f.fetched.length, 0);
      assert.equal(await f.wait(15000), 0);
    });

    await check("large user reference cannot outrank genuine assistant output", async () => {
      const f = await fixture(user(image("https://fixture/reference", 'data-natural-width="4000" data-natural-height="4000"')) +
        assistant(image("https://fixture/generated", 'data-natural-width="800" data-natural-height="600"')));
      assert.equal(await api.countRenderableChatGPTImages(f.page), 1);
      const files = await api.downloadChatGPTImages(f.page, path.join(root, "mixed"));
      assert.equal(files.length, 1);
      assert.equal(fs.readFileSync(files[0], "utf8"), "https://fixture/generated");
      assert.deepEqual(f.fetched, ["https://fixture/generated"]);
    });

    await check("observed agent-turn fallback works; ambiguous markdown-only turn fails closed", async () => {
      const f = await fixture(`<article data-testid="conversation-turn-4"><div class="agent-turn">${image(dataUrl)}</div></article>` +
        `<article data-testid="conversation-turn-5"><div class="markdown">${image("https://fixture/ambiguous")}</div></article>`);
      assert.equal(await api.countRenderableChatGPTImages(f.page), 1);
      const files = await api.downloadChatGPTImages(f.page, path.join(root, "agent-turn"));
      assert.equal(fs.readFileSync(files[0], "utf8"), "generated data image");
    });

    await check("observed section turns without role attributes detect generated output and exclude echoed uploads", async () => {
      const f = await fixture(`<section data-testid="conversation-turn-1">${image("https://fixture/uploaded")}</section>` +
        `<section data-testid="conversation-turn-2"><div class="agent-turn">${image("https://fixture/uploaded")}${image(dataUrl)}</div></section>`);
      assert.equal(await api.countRenderableChatGPTImages(f.page), 1);
      const files = await api.downloadChatGPTImages(f.page, path.join(root, "section-turn"));
      assert.equal(files.length, 1);
      assert.equal(fs.readFileSync(files[0], "utf8"), "generated data image");
      assert.equal(await f.wait(24000), 1);
    });

    await check("nested user roles, legacy user turns, upload markers and echoed references excluded", async () => {
      const f = await fixture(user(image("https://fixture/reference")) + assistant(
        image("https://fixture/reference") +
        `<div data-message-author-role="user">${image("https://fixture/nested-reference")}</div>` +
        `<div data-testid="file-preview">${image("https://fixture/file")}</div>` +
        `<div class="attachment">${image("https://fixture/attachment")}</div>` +
        image("https://fixture/upload", 'alt="Uploaded image"') +
        image("https://fixture/ko-upload", 'alt="업로드 이미지"')) +
        `<article data-testid="conversation-turn-3">You said:<div class="agent-turn">${image("https://fixture/legacy-user")}</div></article>`);
      assert.equal(await api.countRenderableChatGPTImages(f.page), 0);
      assert.equal((await api.downloadChatGPTImages(f.page, path.join(root, "nested"))).length, 0);
      assert.equal(f.fetched.length, 0);
    });

    await check("unloaded, broken, hidden and undersized assistant previews do not count", async () => {
      const f = await fixture(assistant(
        image("https://fixture/loading", 'data-loading="true"') +
        image("https://fixture/broken", 'data-natural-width="0"') +
        image("https://fixture/hidden", 'style="visibility:hidden"') +
        image("https://fixture/transparent", 'style="opacity:0"') +
        image("https://fixture/small", 'data-width="32" data-height="32"') +
        image("https://fixture/tiny", 'data-width="180" data-height="180" data-natural-width="250" data-natural-height="250"')));
      assert.equal(await api.countRenderableChatGPTImages(f.page), 0);
      assert.equal((await api.downloadChatGPTImages(f.page, path.join(root, "previews"))).length, 0);
    });

    await check("HTTP, data and assistant blob downloads preserve sorting and deduplication", async () => {
      const f = await fixture(assistant(image("https://fixture/http", 'data-natural-width="1400"') +
        image(dataUrl) + image("blob:generated") + image("https://fixture/http") +
        image("https://fixture/placeholder", 'data-current-src="https://fixture/http"')) + user(image("blob:user-upload")));
      assert.equal(await api.countRenderableChatGPTImages(f.page), 3);
      const files = await api.downloadChatGPTImages(f.page, path.join(root, "formats"));
      assert.equal(files.length, 3);
      assert.deepEqual(Array.from(files, (file) => fs.readFileSync(file, "utf8")), ["https://fixture/http", "generated data image", "blob:generated"]);
      assert.deepEqual(f.fetched, ["https://fixture/http", "blob:generated"]);
    });

    await check("download failures and non-image HTTP responses do not become images", async () => {
      const f = await fixture(assistant(["http-error", "network-error", "not-image", "read-error", "read-abort", "ok"]
        .map((name) => image(`https://fixture/${name}`)).join("")));
      const files = await api.downloadChatGPTImages(f.page, path.join(root, "failures"));
      assert.equal(files.length, 1);
      assert.equal(fs.readFileSync(files[0], "utf8"), "https://fixture/ok");
    });

    await check("wait rejects artifacts before the stability window or after an unstable timeout", async () => {
      const streaming = await fixture(assistant(image(dataUrl)) + '<button data-testid="stop-button">Stop</button>');
      assert.equal(await streaming.wait(15000), 0);
      const unstable = await fixture(assistant(image(dataUrl)));
      assert.equal(await unstable.wait(6000), 0);
    });

    await check("completed assistant image wins over stale global stop button", async () => {
      const f = await fixture(user(image("https://fixture/reference")) +
        assistant(image(dataUrl)) + '<button data-testid="stop-button">Stop</button>');
      assert.equal(await f.wait(24000), 1);
      assert.ok(f.elapsed >= 15000);
      assert.equal((await api.downloadChatGPTImages(f.page, path.join(root, "stale-stop"))).length, 1);
      assert.equal(f.fetched.length, 0, "reference not downloaded");
    });

    await check("wait ignores references, then accepts stable loaded assistant artifacts", async () => {
      const f = await fixture(user(image("https://fixture/reference")) + assistant(image(dataUrl, 'data-loading="true"')),
        (document, elapsed) => { if (elapsed >= 15000) document.querySelector('[data-loading]')?.removeAttribute("data-loading"); });
      assert.equal(await f.wait(24000), 1);
      assert.ok(f.elapsed >= 18000);
    });
    console.log(`Verified ${checks} offline Chromium DOM fixture checks; all external requests blocked, no paid generation.`);
  } finally {
    await browser?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

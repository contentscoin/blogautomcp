import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BLOGAUTOMCP_TEST_BASE_URL || "http://127.0.0.1:3000";
const normalizeNewlines = (value) => value.replace(/\r\n/gu, "\n");
const targetConnectKind = (process.env.BLOGAUTOMCP_TEST_CONNECT_KIND || "").trim().toUpperCase();

async function json(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: "no-store" });
  const payload = await response.json();
  assert.equal(response.ok, true, payload?.error || `${pathname} 요청 실패`);
  assert.equal(payload.success, true, payload?.error || `${pathname} 응답 실패`);
  return payload.data;
}

const settings = await json("/api/settings");
assert.equal(
  settings.desktopDraftProviderConfigured,
  false,
  "이 검증은 별도 AI API 키가 없는 ChatGPT 핸드오프 환경에서 실행해야 합니다.",
);

const links = await json("/api/brandlinks");
let candidate = null;
for (const link of links) {
  if (link.status === "PUBLISHING" || !link.productName) continue;
  if (targetConnectKind && link.connectKind !== targetConnectKind) continue;
  const draft = await json(`/api/brandlinks/${encodeURIComponent(link.id)}/draft`);
  if (!draft) {
    candidate = link;
    break;
  }
}
assert.ok(candidate, "저장된 초안이 없는 검증용 상품을 찾지 못했습니다.");

const browser = await chromium.launch({
  channel: process.env.BLOGAUTOMCP_TEST_BROWSER_CHANNEL || "chrome",
  headless: true,
});
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
  viewport: { width: 1600, height: 980 },
});
const page = await context.newPage();
await page.addInitScript(() => {
  window.__blogAutoOpenedUrl = null;
  window.open = (url) => {
    window.__blogAutoOpenedUrl = String(url || "");
    return null;
  };
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
if (candidate.connectKind === "TRAVEL") {
  await page.getByRole("tab", { name: /여행커넥트/u }).click();
}

const row = page.locator("tr").filter({ hasText: candidate.productName }).first();
await row.getByRole("button", { name: "1. ChatGPT로 글 만들기" }).click();

const dialog = page.getByRole("dialog", { name: "ChatGPT에서 이 상품의 초안을 완성하세요" });
await dialog.waitFor({ state: "visible" });
await dialog.getByText(candidate.productName, { exact: true }).waitFor({ state: "visible" });
const prompt = await dialog.locator("#chatgpt-draft-prompt").inputValue();
assert.match(prompt, /post_create_draft/u);
assert.match(prompt, /post_submit_draft/u);
assert.match(prompt, new RegExp(candidate.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

await dialog.getByRole("button", { name: "요청문만 복사" }).click();
assert.equal(normalizeNewlines(await page.evaluate(() => navigator.clipboard.readText())), normalizeNewlines(prompt));

await dialog.getByRole("button", { name: /복사하고 ChatGPT 열기/u }).click();
assert.equal(await page.evaluate(() => window.__blogAutoOpenedUrl), "https://chatgpt.com/");
assert.equal(normalizeNewlines(await page.evaluate(() => navigator.clipboard.readText())), normalizeNewlines(prompt));

const screenshotPath = path.join(os.tmpdir(), "blogautomcp-chatgpt-draft-handoff.png");
await page.screenshot({ path: screenshotPath, fullPage: false });
await browser.close();

console.log(JSON.stringify({
  ok: true,
  productId: candidate.id,
  connectKind: candidate.connectKind,
  button: "1. ChatGPT로 글 만들기",
  dialog: true,
  clipboard: true,
  chatgptOpen: true,
  screenshotPath,
}));

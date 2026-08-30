import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BLOGAUTOMCP_TEST_BASE_URL || "http://127.0.0.1:3310";
const browser = await chromium.launch({
  channel: process.env.BLOGAUTOMCP_TEST_BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  const settingsResponse = await page.request.get(`${baseUrl}/api/settings`);
  assert.equal(settingsResponse.ok(), true, await settingsResponse.text());
  const settings = await settingsResponse.json();
  assert.equal(settings.data?.draftCreationMode, "browser-chatgpt");
  assert.equal(settings.data?.browserDraftAutomationEnabled, true);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "로컬 프로그램 제어" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /ChatGPT 재로그인/u }).waitFor({ state: "visible" });
  await page.getByRole("switch", { name: /웹 자동작성 켜짐/u }).waitFor({ state: "visible" });
  await page.locator("button").filter({ hasText: "1. ChatGPT 자동작성" }).first().waitFor({ state: "visible" });
  await page.getByText(/자동작성 준비됨|ChatGPT 로그인 필요/u).first().waitFor({ state: "visible" });

  assert.deepEqual(pageErrors, []);
  const screenshotPath = path.join(os.tmpdir(), "blogautomcp-chatgpt-browser-mode.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    mode: settings.data.draftCreationMode,
    loginControl: true,
    automaticDraftButton: true,
    screenshotPath,
  }));
} finally {
  await browser.close();
}

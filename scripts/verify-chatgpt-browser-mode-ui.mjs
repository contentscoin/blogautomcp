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
  assert.ok(["codex", "browser-chatgpt"].includes(settings.data?.draftCreationMode));
  assert.equal(settings.data?.browserDraftAutomationEnabled, true);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "로컬 프로그램 제어" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /GPT (?:연결|연결됨)/u }).first().waitFor({ state: "visible" });
  await page.locator("button").filter({ hasText: /1\. (?:GPT로 글 만들기|웹 GPT 자동작성)/u }).first().waitFor({ state: "visible" });
  await page.getByText(/GPT 계정 연결됨|자동작성 준비됨|웹 GPT 로그인 필요/u).first().waitFor({ state: "visible" });

  if (settings.data.draftCreationMode === "codex") {
    assert.equal(await page.getByRole("button", { name: /웹 GPT 재로그인/u }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "웹 GPT 예비 연결" }).count(), 0);
  } else {
    await page.getByRole("button", { name: /웹 GPT 재로그인/u }).waitFor({ state: "visible" });
    await page.getByRole("switch", { name: /(?:백그라운드|웹) 자동작성 켜짐/u }).waitFor({ state: "visible" });
  }

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

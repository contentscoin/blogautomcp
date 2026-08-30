import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAutomationEnabled,
  readChatGptBrowserSessionSummary,
} from "../src/lib/chatgpt-browser-automation";
import { getChatgptSessionFile } from "./lib/app-paths";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function main(): void {
  assert.equal(isChatGptBrowserAutomationEnabled({}), true);
  assert.equal(
    isChatGptBrowserAutomationEnabled({ CHATGPT_BROWSER_AUTOMATION_ENABLED: "false" }),
    false,
  );

  const enabledEnv = buildChatGptBrowserAutomationEnv(true);
  assert.equal(enabledEnv.BROWSER_GPT_MODE, "true");
  assert.equal(enabledEnv.ALLOW_CHATGPT_BROWSER_MODE, "true");
  assert.equal(enabledEnv.CHATGPT_USE_CUSTOM_GPTS, "false");
  assert.equal(enabledEnv.CHATGPT_RUN_ISOLATED_CONTEXT, "false");

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-chatgpt-session-"));
  const previousSessionDir = process.env.SESSION_STORAGE_DIR;
  process.env.SESSION_STORAGE_DIR = sessionDir;
  try {
    const sessionFile = getChatgptSessionFile();
    fs.writeFileSync(sessionFile, JSON.stringify({
      cookies: [{
        name: "__Secure-authjs.session-token",
        value: "fixture-token",
        domain: ".chatgpt.com",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      }],
      origins: [],
    }), "utf8");
    assert.equal(readChatGptBrowserSessionSummary().isValid, true);

    fs.writeFileSync(sessionFile, JSON.stringify({
      cookies: [{
        name: "__Secure-next-auth.session-token",
        value: "expired-token",
        domain: ".chatgpt.com",
        expires: Math.floor(Date.now() / 1000) - 60,
      }],
      origins: [],
    }), "utf8");
    const expired = readChatGptBrowserSessionSummary();
    assert.equal(expired.isValid, false);
    assert.match(expired.error || "", /만료/u);
  } finally {
    if (previousSessionDir === undefined) delete process.env.SESSION_STORAGE_DIR;
    else process.env.SESSION_STORAGE_DIR = previousSessionDir;
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  const electron = source("scripts/electron/main.cjs");
  assert.match(electron, /CHATGPT_BROWSER_AUTOMATION_ENABLED/u);
  assert.equal(electron.includes('process.env.BROWSER_GPT_MODE = "false"'), false);

  const loginRoute = source("src/app/api/session/login/route.ts");
  assert.match(loginRoute, /provider !== "naver" && provider !== "chatgpt"/u);
  assert.match(loginRoute, /chatgpt-login\.ts/u);

  const draftRoute = source("src/app/api/brandlinks/[id]/draft/route.ts");
  assert.match(draftRoute, /CHATGPT_BROWSER_LOGIN_REQUIRED/u);
  assert.match(draftRoute, /CHATGPT_BROWSER_FALLBACK_REQUIRED/u);
  assert.match(draftRoute, /buildChatGptBrowserAutomationEnv\(useBrowserChatGpt\)/u);

  const dashboard = source("src/app/page.tsx");
  assert.match(dashboard, /1\. ChatGPT 자동작성/u);
  assert.match(dashboard, /provider: "chatgpt", force: false/u);
  assert.match(dashboard, /await requestDraft\(false\)/u);

  const sessionStatus = source("src/components/SessionStatus.tsx");
  assert.match(sessionStatus, /ChatGPT 재로그인/u);
  assert.match(sessionStatus, /CHATGPT_BROWSER_AUTOMATION_ENABLED/u);

  const simpleAgent = source("scripts/simple-agent.ts");
  assert.match(simpleAgent, /하네스 문장을 원고로 복사하는 로컬 폴백은 품질 보호를 위해 차단했습니다/u);
  assert.match(source("scripts/chatgpt-login.ts"), /composerVisible && hasAuthCookie/u);
  assert.equal(simpleAgent.includes("buildLocalProductReviewSections"), false);

  for (const bulkScript of [
    "scripts/bulk-today-publish.ts",
    "scripts/bulk-schedule-publish.ts",
    "scripts/super-publish.ts",
  ]) {
    const bulkSource = source(bulkScript);
    assert.match(bulkSource, /buildChatGptBrowserAutomationEnv\(isChatGptBrowserAutomationEnabled\(\)\)/u);
    assert.equal(bulkSource.includes('BROWSER_GPT_MODE: "false"'), false);
  }

  console.log("✅ ChatGPT 웹 자동작성 복구 계약 검증 완료");
}

main();

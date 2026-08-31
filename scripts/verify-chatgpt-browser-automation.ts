import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAuthenticationError,
  isChatGptBrowserAutomationEnabled,
  readChatGptBrowserSessionSummary,
} from "../src/lib/chatgpt-browser-automation";
import { getChatgptSessionFile } from "./lib/app-paths";
import {
  buildChatGptBrowserLaunchPolicy,
  resolveChatGptBrowserVisibility,
} from "./lib/chatgpt-browser-visibility";
import {
  CHATGPT_BROWSER_AUTH_REQUIRED_CODE,
  hasChatGptProtectionText,
} from "./lib/chatgpt-browser-errors";
import { acquireChatGptProfileLock } from "./lib/chatgpt-profile-lock";
import {
  createChatGptReplyProgress,
  isChatGptReplyTextStalled,
  recordChatGptReplyText,
} from "./lib/chatgpt-reply-progress";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function main(): Promise<void> {
  const started = createChatGptReplyProgress(1_000);
  assert.equal(isChatGptReplyTextStalled(started, 180_999, 180_000), false);
  assert.equal(isChatGptReplyTextStalled(started, 181_000, 180_000), true);
  const unchanged = recordChatGptReplyText(started, "", 50_000);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.progress.lastTextChangedAt, 1_000);
  const advanced = recordChatGptReplyText(started, "{\"title\":", 50_000);
  assert.equal(advanced.changed, true);
  assert.equal(advanced.progress.lastTextChangedAt, 50_000);
  const sameText = recordChatGptReplyText(advanced.progress, "{\"title\":", 90_000);
  assert.equal(sameText.changed, false);
  assert.equal(sameText.progress.lastTextChangedAt, 50_000);

  assert.equal(isChatGptBrowserAutomationEnabled({}), true);
  assert.equal(
    isChatGptBrowserAutomationEnabled({ CHATGPT_BROWSER_AUTOMATION_ENABLED: "false" }),
    false,
  );

  const enabledEnv = buildChatGptBrowserAutomationEnv(true, {});
  assert.equal(enabledEnv.BROWSER_GPT_MODE, "true");
  assert.equal(enabledEnv.ALLOW_CHATGPT_BROWSER_MODE, "true");
  assert.equal(enabledEnv.CHATGPT_USE_CUSTOM_GPTS, "false");
  assert.equal(enabledEnv.CHATGPT_RUN_ISOLATED_CONTEXT, "false");
  assert.equal(enabledEnv.CHATGPT_BROWSER_VISIBILITY, "background");

  assert.equal(resolveChatGptBrowserVisibility({}), "background");
  assert.equal(resolveChatGptBrowserVisibility({ CHATGPT_HEADLESS: "true" }), "headless");
  assert.equal(
    resolveChatGptBrowserVisibility({
      CHATGPT_BROWSER_VISIBILITY: "visible",
      CHATGPT_HEADLESS: "true",
    }),
    "visible",
  );

  const backgroundPolicy = buildChatGptBrowserLaunchPolicy({});
  assert.equal(backgroundPolicy.visibility, "background");
  assert.equal(backgroundPolicy.headless, false);
  assert.equal(backgroundPolicy.slowMo, 0);
  assert.ok(backgroundPolicy.args.includes("--start-minimized"));
  assert.ok(backgroundPolicy.args.includes("--window-position=-32000,-32000"));
  assert.ok(backgroundPolicy.args.includes("--disable-background-timer-throttling"));

  const visiblePolicy = buildChatGptBrowserLaunchPolicy({ CHATGPT_BROWSER_VISIBILITY: "visible" });
  assert.equal(visiblePolicy.headless, false);
  assert.equal(visiblePolicy.slowMo, 30);
  assert.equal(visiblePolicy.args.includes("--start-minimized"), false);

  const headlessPolicy = buildChatGptBrowserLaunchPolicy({ CHATGPT_BROWSER_VISIBILITY: "headless" });
  assert.equal(headlessPolicy.headless, true);
  assert.equal(headlessPolicy.args.includes("--start-minimized"), false);

  assert.equal(isChatGptBrowserAuthenticationError("ChatGPT 로그인이 필요합니다."), true);
  assert.equal(isChatGptBrowserAuthenticationError("ChatGPT 로그인 세션이 만료되었습니다."), true);
  assert.equal(
    isChatGptBrowserAuthenticationError(`${CHATGPT_BROWSER_AUTH_REQUIRED_CODE}: verification`),
    true,
  );
  assert.equal(isChatGptBrowserAuthenticationError("Cloudflare 보안 검증 페이지가 표시되었습니다."), true);
  assert.equal(isChatGptBrowserAuthenticationError("원고 JSON 형식이 올바르지 않습니다."), false);
  assert.equal(
    hasChatGptProtectionText("제품의 보안 기능과 본인 인증, 유해 콘텐츠 차단 기능을 비교합니다."),
    false,
  );
  assert.equal(hasChatGptProtectionText("Verify you are human before continuing"), true);

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

    const firstLock = await acquireChatGptProfileLock({
      purpose: "verification-first",
      timeoutMs: 200,
      pollMs: 20,
    });
    await assert.rejects(
      acquireChatGptProfileLock({
        purpose: "verification-second",
        timeoutMs: 120,
        pollMs: 20,
      }),
      /CHATGPT_BROWSER_BUSY/u,
    );
    await firstLock.release();
    const nextLock = await acquireChatGptProfileLock({
      purpose: "verification-after-release",
      timeoutMs: 200,
      pollMs: 20,
    });
    await nextLock.release();
  } finally {
    if (previousSessionDir === undefined) delete process.env.SESSION_STORAGE_DIR;
    else process.env.SESSION_STORAGE_DIR = previousSessionDir;
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  const electron = source("scripts/electron/main.cjs");
  assert.match(electron, /CHATGPT_BROWSER_AUTOMATION_ENABLED/u);
  assert.match(electron, /CHATGPT_BROWSER_VISIBILITY/u);
  assert.match(electron, /"background"/u);
  assert.equal(electron.includes('process.env.BROWSER_GPT_MODE = "false"'), false);

  const loginRoute = source("src/app/api/session/login/route.ts");
  assert.match(loginRoute, /provider !== "naver" && provider !== "chatgpt"/u);
  assert.match(loginRoute, /chatgpt-login\.ts/u);

  const draftRoute = source("src/app/api/brandlinks/[id]/draft/route.ts");
  assert.match(draftRoute, /CHATGPT_BROWSER_LOGIN_REQUIRED/u);
  assert.match(draftRoute, /CHATGPT_BROWSER_FALLBACK_REQUIRED/u);
  assert.match(draftRoute, /isChatGptBrowserAuthenticationError/u);
  assert.match(draftRoute, /buildChatGptBrowserAutomationEnv\(useBrowserChatGpt\)/u);
  assert.match(draftRoute, /status: "DRAFTING"/u);
  assert.match(draftRoute, /status: "FAILED", errorMessage: message/u);
  assert.match(draftRoute, /updateMany\(\{[\s\S]*?where: \{ id, status: link\.status \}/u);

  const publishRoute = source("src/app/api/brandlinks/[id]/publish/route.ts");
  assert.match(publishRoute, /link\.status === "DRAFTING"/u);
  assert.match(publishRoute, /where: \{ id, status: link\.status \}/u);

  const brandLinkRoute = source("src/app/api/brandlinks/[id]/route.ts");
  assert.match(brandLinkRoute, /existing\.status === "DRAFTING"/u);
  assert.match(brandLinkRoute, /notIn: \["DRAFTING", "PUBLISHING"\]/u);

  const dashboard = source("src/app/page.tsx");
  assert.match(dashboard, /1\. ChatGPT 자동작성/u);
  assert.match(dashboard, /provider: "chatgpt", force: false/u);
  assert.match(dashboard, /await requestDraft\(false\)/u);

  const sessionStatus = source("src/components/SessionStatus.tsx");
  assert.match(sessionStatus, /ChatGPT 재로그인/u);
  assert.match(sessionStatus, /CHATGPT_BROWSER_AUTOMATION_ENABLED/u);

  const simpleAgent = source("scripts/simple-agent.ts");
  assert.match(simpleAgent, /buildChatGptBrowserLaunchPolicy/u);
  assert.match(simpleAgent, /acquireChatGptProfileLock/u);
  assert.match(simpleAgent, /hasChatGptProtectionText/u);
  assert.match(simpleAgent, /하네스 문장을 원고로 복사하는 로컬 폴백은 품질 보호를 위해 차단했습니다/u);
  assert.match(simpleAgent, /CHATGPT_RESPONSE_STALLED/u);
  assert.match(simpleAgent, /텍스트 진행 정지 감지/u);
  assert.match(simpleAgent, /새 대화에서 1회 자동 재시도/u);
  assert.match(simpleAgent, /ensureFreshChatGPTConversation/u);
  assert.match(simpleAgent, /자동 재시도는 이미지 없이 수집된 텍스트 근거로 진행합니다/u);
  assert.match(simpleAgent, /첨부 이미지 처리를 반복하지 말고/u);
  const directGenerationBlock = simpleAgent.match(
    /async function runDirectChatGPTGeneration[\s\S]*?\n\}\n\nfunction buildClarificationReply/u,
  )?.[0] ?? "";
  assert.equal(directGenerationBlock.includes("재시도 상세 근거"), false);
  assert.match(simpleAgent, /if \(!idleConfirmed \|\| await isChatGPTGenerating\(page\)\) return null/u);
  assert.equal(simpleAgent.includes("if (generating) {\n      lastActivityAt = Date.now();"), false);

  const electronMain = source("scripts/electron/main.cjs");
  assert.match(electronMain, /recoverInterruptedDrafts/u);
  assert.match(electronMain, /where: \{ status: "DRAFTING" \}/u);
  const chatGptLogin = source("scripts/chatgpt-login.ts");
  assert.match(chatGptLogin, /composerVisible && \(hasAuthCookie \|\| !needLogin\)/u);
  assert.match(chatGptLogin, /headless: false/u);
  assert.match(chatGptLogin, /revealChatGptLoginWindow/u);
  assert.match(chatGptLogin, /acquireChatGptProfileLock/u);
  assert.equal(simpleAgent.includes("buildLocalProductReviewSections"), false);

  const sharedBrowser = source("scripts/lib/chatgpt-browser.ts");
  assert.match(sharedBrowser, /getChatgptSessionFile/u);
  assert.match(sharedBrowser, /getChatgptProfileDir/u);
  assert.match(sharedBrowser, /buildChatGptBrowserLaunchPolicy/u);
  assert.match(sharedBrowser, /BROWSER_CHANNEL/u);
  assert.match(sharedBrowser, /acquireChatGptProfileLock/u);
  assert.equal(sharedBrowser.includes("Macintosh; Intel Mac OS X"), false);
  assert.equal(
    sharedBrowser.includes('path.join(process.cwd(), "playwright", "storage", "chatgpt-session.json")'),
    false,
  );

  const topicPipeline = source("src/services/topic-task-pipeline.ts");
  assert.match(
    topicPipeline,
    /const handle = await createChatGPTContext\(true\);\s*try \{\s*const page = await handle\.context\.newPage\(\);/u,
  );
  const singleImageGenerator = source("scripts/chatgpt-generate-image.ts");
  assert.match(
    singleImageGenerator,
    /fs\.mkdirSync\(tempDir,[\s\S]*?const handle = await createChatGPTContext\(true\);\s*try \{/u,
  );

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

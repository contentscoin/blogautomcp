import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAuthenticationError,
  isChatGptBrowserAutomationEnabled,
  isChatGptBrowserUnreachableError,
  readChatGptBrowserSessionSummary,
} from "../src/lib/chatgpt-browser-automation";
import { getChatgptSessionFile } from "./lib/app-paths";
import {
  buildChatGptBrowserLaunchPolicy,
  resolveChatGptBrowserVisibility,
} from "./lib/chatgpt-browser-visibility";
import {
  CHATGPT_BROWSER_AUTH_REQUIRED_CODE,
  CHATGPT_BROWSER_UNREACHABLE_CODE,
  compactPlaywrightError,
  hasChatGptProtectionText,
} from "./lib/chatgpt-browser-errors";
import { navigateToChatGpt, type NavigablePage } from "./lib/chatgpt-navigation";
import { acquireChatGptProfileLock } from "./lib/chatgpt-profile-lock";
import {
  createChatGptReplyProgress,
  isChatGptReplyTextStalled,
  recordChatGptReplyText,
} from "./lib/chatgpt-reply-progress";
import {
  CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS,
  CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS,
  compactChatGptEvidence,
  composeBudgetedChatGptPrompt,
} from "./lib/chatgpt-direct-prompt";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function main(): Promise<void> {
  const duplicatedEvidence = Array.from({ length: 200 }, (_, index) =>
    index % 2 === 0 ? "- 같은 문체 규칙" : `- ${index}일차 일정 근거`,
  ).join("\n");
  const compactedEvidence = compactChatGptEvidence(duplicatedEvidence, 700);
  assert.equal(compactedEvidence.match(/같은 문체 규칙/gu)?.length, 1);
  assert.ok(compactedEvidence.length <= 700);
  const budgetedPrompt = composeBudgetedChatGptPrompt({
    prefix: "압축 프롬프트",
    evidence: duplicatedEvidence,
    suffix: '{"title":"제목"}',
    maxChars: CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS,
  });
  assert.ok(budgetedPrompt.length <= CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS);
  assert.match(budgetedPrompt, /\{"title":"제목"\}$/u);

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
    true,
  );

  const enabledEnv = buildChatGptBrowserAutomationEnv(true, {});
  assert.equal(enabledEnv.BROWSER_GPT_MODE, "true");
  assert.equal(enabledEnv.ALLOW_CHATGPT_BROWSER_MODE, "true");
  assert.equal(enabledEnv.CHATGPT_BASE_URL, "https://chatgpt.com/");
  assert.equal(enabledEnv.CHATGPT_RUN_ISOLATED_CONTEXT, "false");
  assert.equal(enabledEnv.CHATGPT_BROWSER_VISIBILITY, "background");
  for (const runtimePath of [
    "scripts/simple-agent.ts",
    "scripts/topic-agent.ts",
    "scripts/chatgpt-login.ts",
    "scripts/lib/chatgpt-browser.ts",
    "src/services/topic-task-pipeline.ts",
    "src/lib/brand-post-image-generation.ts",
  ]) {
    assert.equal(
      /https:\/\/chatgpt\.com\/g\//u.test(source(runtimePath)),
      false,
      `${runtimePath}에 계정 종속 전용 GPT URL이 남아 있으면 안 됩니다.`,
    );
  }

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
  assert.equal(isChatGptBrowserUnreachableError(`Direct ChatGPT 이동 실패: ${CHATGPT_BROWSER_UNREACHABLE_CODE}: chatgpt.com 에 연결하지 못했습니다`), true);
  assert.equal(isChatGptBrowserUnreachableError("Direct ChatGPT 이동 실패: page.goto: Timeout 60000ms exceeded."), true);
  assert.equal(isChatGptBrowserUnreachableError("원고 JSON 형식이 올바르지 않습니다."), false);
  assert.equal(isChatGptBrowserAuthenticationError(`Direct ChatGPT 이동 실패: ${CHATGPT_BROWSER_UNREACHABLE_CODE}: chatgpt.com 에 연결하지 못했습니다`), false);
  assert.equal(
    compactPlaywrightError('page.goto: Timeout 60000ms exceeded.\n=========================== logs ===========================\nnavigating to "https://chatgpt.com/"'),
    "page.goto: Timeout 60000ms exceeded.",
  );

  // 이동 단계: 숨은 창에서 6분을 태우는 대신 60초 → commit → 창 표시 후 마지막 시도로 끝낸다.
  const navigationTimeout = () =>
    Object.assign(new Error('page.goto: Timeout 60000ms exceeded.\n=========================== logs ===========================\nnavigating to "https://chatgpt.com/"'), {
      name: "TimeoutError",
    });
  const fakePage = (settings: {
    failures: number;
    url?: string;
    frameUrl?: string;
    /** 이 시도 횟수를 넘긴 뒤부터 보안 확인 화면이 보이기 시작한다. */
    challengeAfterAttempt?: number;
    error?: () => Error;
  }) => {
    const calls: Array<{ waitUntil: string; timeout: number }> = [];
    let remaining = settings.failures;
    let attempts = 0;
    const page: NavigablePage = {
      async goto(_url, options) {
        attempts += 1;
        calls.push({ waitUntil: options.waitUntil, timeout: options.timeout });
        if (remaining > 0) {
          remaining -= 1;
          throw (settings.error || navigationTimeout)();
        }
        return null;
      },
      url: () =>
        settings.challengeAfterAttempt !== undefined && attempts > settings.challengeAfterAttempt
          ? "https://chatgpt.com/cdn-cgi/challenge-platform/x"
          : settings.url || "about:blank",
      frames: () => [{ url: () => settings.frameUrl || "about:blank", name: () => "" }],
    };
    return { page, calls };
  };

  const firstTry = fakePage({ failures: 0 });
  await navigateToChatGpt(firstTry.page, "https://chatgpt.com/", { label: "Direct ChatGPT", reveal: null });
  assert.equal(firstTry.calls.length, 1);
  assert.equal(firstTry.calls[0].waitUntil, "domcontentloaded");

  const challenged = fakePage({ failures: 3, url: "https://chatgpt.com/cdn-cgi/challenge-platform/x" });
  await assert.rejects(
    navigateToChatGpt(challenged.page, "https://chatgpt.com/", { label: "Direct ChatGPT", reveal: null }),
    (error: Error) => {
      assert.match(error.message, /이동 실패/u);
      assert.equal(isChatGptBrowserAuthenticationError(error.message), true, "보안 확인은 로그인 창 안내로 이어져야 합니다.");
      return true;
    },
  );
  assert.equal(challenged.calls.length, 1, "보안 확인이 보이면 더 기다리지 않습니다.");

  const commitRecovery = fakePage({ failures: 1 });
  await navigateToChatGpt(commitRecovery.page, "https://chatgpt.com/", { label: "Direct ChatGPT", reveal: null });
  assert.deepEqual(commitRecovery.calls.map((call) => call.waitUntil), ["domcontentloaded", "commit"]);

  const unreachable = fakePage({ failures: 3 });
  let revealCalls = 0;
  await assert.rejects(
    navigateToChatGpt(unreachable.page, "https://chatgpt.com/", {
      label: "Direct ChatGPT",
      reveal: async () => { revealCalls += 1; },
    }),
    (error: Error) => {
      assert.match(error.message, /이동 실패/u);
      assert.match(error.message, new RegExp(CHATGPT_BROWSER_UNREACHABLE_CODE, "u"));
      assert.equal(error.message.includes("=== logs"), false, "Playwright call log 는 사용자 메시지에 넣지 않습니다.");
      assert.equal(isChatGptBrowserUnreachableError(error.message), true);
      assert.equal(isChatGptBrowserAuthenticationError(error.message), false);
      return true;
    },
  );
  assert.equal(revealCalls, 1, "마지막 시도 전에 창을 한 번 표시해야 합니다.");
  assert.equal(unreachable.calls.length, 3);
  assert.ok(unreachable.calls.reduce((sum, call) => sum + call.timeout, 0) <= 180_000, "총 이동 예산은 3분 이하여야 합니다.");

  const withoutReveal = fakePage({ failures: 3 });
  await assert.rejects(navigateToChatGpt(withoutReveal.page, "https://chatgpt.com/", { label: "Direct ChatGPT", reveal: null }));
  assert.equal(withoutReveal.calls.length, 2, "표시할 창이 없으면 두 단계로 끝냅니다.");

  // 보안 확인 화면은 commit 단계나 창을 띄운 뒤에야 나타나기도 한다. 그때도 네트워크 오류가 아니라
  // 로그인·보안 확인 안내로 이어져야 한다.
  for (const challengeAfterAttempt of [1, 2]) {
    const lateChallenge = fakePage({ failures: 3, challengeAfterAttempt });
    let lateReveals = 0;
    await assert.rejects(
      navigateToChatGpt(lateChallenge.page, "https://chatgpt.com/", {
        label: "Direct ChatGPT",
        reveal: async () => { lateReveals += 1; },
      }),
      (error: Error) => {
        assert.equal(
          isChatGptBrowserAuthenticationError(error.message),
          true,
          `${challengeAfterAttempt}번째 시도 뒤 나타난 보안 확인도 로그인 안내로 이어져야 합니다.`,
        );
        assert.equal(isChatGptBrowserUnreachableError(error.message), false);
        return true;
      },
    );
    assert.equal(lateChallenge.calls.length, challengeAfterAttempt + 1, "보안 확인을 확인하면 더 시도하지 않습니다.");
    assert.equal(lateReveals, challengeAfterAttempt === 2 ? 1 : 0);
  }

  // 이동·네트워크 오류가 아닌 실패까지 도달 실패로 감싸면 네트워크 확인 안내가 잘못 나간다.
  const crashed = fakePage({
    failures: 3,
    error: () => new Error("Target page, context or browser has been closed"),
  });
  await assert.rejects(
    navigateToChatGpt(crashed.page, "https://chatgpt.com/", { label: "Direct ChatGPT", reveal: null }),
    (error: Error) => {
      assert.match(error.message, /Target page, context or browser has been closed/u);
      assert.equal(isChatGptBrowserUnreachableError(error.message), false);
      assert.equal(isChatGptBrowserAuthenticationError(error.message), false);
      return true;
    },
  );
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
  assert.match(electron, /draft-runtime-policy\.json/u);
  assert.match(electron, /Object\.assign\(process\.env, draftRuntimePolicy\)/u);
  assert.match(electron, /CHATGPT_BROWSER_VISIBILITY/u);
  assert.match(electron, /"background"/u);
  assert.equal(electron.includes('process.env.BROWSER_GPT_MODE = "false"'), true, "라우터가 Codex 우선으로 선택하기 전에 웹 실행을 강제하지 않습니다.");

  const loginRoute = source("src/app/api/session/login/route.ts");
  assert.match(loginRoute, /provider !== "naver" && provider !== "chatgpt"/u);
  assert.match(loginRoute, /chatgpt-login\.ts/u);

  const draftRoute = source("src/app/api/brandlinks/[id]/draft/route.ts");
  assert.match(draftRoute, /CHATGPT_BROWSER_LOGIN_REQUIRED/u);
  assert.match(draftRoute, /CHATGPT_BROWSER_FALLBACK_REQUIRED/u);
  assert.match(draftRoute, /isChatGptBrowserAuthenticationError/u);
  assert.match(draftRoute, /CHATGPT_BROWSER_UNREACHABLE/u);
  assert.match(draftRoute, /isChatGptBrowserUnreachableError/u);
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
  assert.match(dashboard, /1\. 웹 GPT 자동작성/u);
  assert.match(dashboard, /provider: "chatgpt", force: false/u);
  assert.match(dashboard, /await requestDraft\(false\)/u);
  assert.match(dashboard, /"CHATGPT_BROWSER_UNREACHABLE"/u);

  const sessionStatus = source("src/components/SessionStatus.tsx");
  assert.match(sessionStatus, /웹 GPT 재로그인/u);
  assert.match(sessionStatus, /백그라운드 자동작성 기본 적용/u);
  assert.equal(sessionStatus.includes("saveBrowserAutomation"), false, "웹 자동작성 선택 스위치는 없어야 합니다.");

  const simpleAgent = source("scripts/simple-agent.ts");
  assert.match(simpleAgent, /navigateToChatGpt/u);
  assert.equal(simpleAgent.includes("navigateWithRetry"), false, "3×120초 반복 이동은 제거되어야 합니다.");
  assert.match(simpleAgent, /CHATGPT_NAVIGATION_TIMEOUT_MS/u);
  assert.match(simpleAgent, /buildChatGptBrowserLaunchPolicy/u);
  assert.match(simpleAgent, /acquireChatGptProfileLock/u);
  assert.match(simpleAgent, /hasChatGptProtectionText/u);
  assert.match(simpleAgent, /하네스 문장을 원고로 복사하는 로컬 폴백은 품질 보호를 위해 차단했습니다/u);
  assert.match(simpleAgent, /CHATGPT_RESPONSE_STALLED/u);
  assert.match(simpleAgent, /텍스트 진행 정지 감지/u);
  assert.match(simpleAgent, /새 대화에서 1회 자동 재시도/u);
  assert.match(simpleAgent, /ensureFreshChatGPTConversation/u);
  assert.match(simpleAgent, /CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS/u);
  assert.match(simpleAgent, /CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS/u);
  assert.match(simpleAgent, /자동 재시도는 이미지 없이 .*자 압축 근거로 진행합니다/u);
  assert.match(simpleAgent, /mode: "primary" \| "recovery"/u);
  assert.equal(CHATGPT_DIRECT_PRIMARY_PROMPT_MAX_CHARS, 8_500);
  assert.equal(CHATGPT_DIRECT_RECOVERY_PROMPT_MAX_CHARS, 5_500);
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

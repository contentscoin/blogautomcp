/** Actual browser wait implementation with a fake Page/clock. Never launches a browser. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "./lib/image-timeout-policy";
import * as errors from "./lib/chatgpt-browser-errors";
import type * as BrowserApi from "./lib/chatgpt-browser";

const dependencies: Record<string, unknown> = {
  fs, path, playwright: {},
  "./app-paths": { getChatgptProfileDir: () => "unused", getChatgptSessionFile: () => "unused" },
  "./chatgpt-browser-visibility": {}, "./chatgpt-profile-lock": {},
  "./chatgpt-browser-errors": errors, "./image-timeout-policy": policy,
};
const loaded = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve("scripts/lib/chatgpt-browser.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
  module: loaded, exports: loaded.exports, process: { env: {} }, console, Error,
  require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  },
});
const api = loaded.exports as typeof BrowserApi;

function fixture(settings: { readyAt?: number; generating?: boolean; staleStop?: boolean; changingArtifact?: boolean; authAt?: number; securityAt?: number; observationCost?: number } = {}) {
  let elapsed = 0;
  const ready = () => settings.readyAt !== undefined && elapsed >= settings.readyAt;
  const auth = () => settings.authAt !== undefined && elapsed >= settings.authAt;
  const locator = (selector: string) => ({
    first() { return this; },
    isVisible: async () => selector.includes("prompt-textarea") ? !auth()
      : selector === "login" ? auth()
      : /stop-button|Stop|result-streaming/.test(selector) ? !!settings.staleStop || !!settings.generating && !ready() : false,
  });
  const page = {
    url: () => settings.securityAt !== undefined && elapsed >= settings.securityAt ? "https://chatgpt.com/captcha" : "https://chatgpt.com/",
    frames: () => [], textContent: async () => "", locator,
    getByRole: () => locator("login"),
    evaluate: async (fn: { name: string; toString(): string }) => {
      if (fn.toString().includes("hasAccountPicker")) return null;
      if (fn.name === "collectRenderableChatGPTGeneratedImages") {
        elapsed += settings.observationCost ?? 0;
        return ready() ? [{ src: settings.changingArtifact ? `artifact-${elapsed}` : "unused", width: 1024, height: 768 }] : [];
      }
      return { hasChallengeElement: false, hasHumanCheckbox: false };
    },
    waitForTimeout: async (ms: number) => { elapsed += ms; },
  } as unknown as Parameters<typeof api.waitForChatGPTImageArtifacts>[0];
  return { page, now: () => elapsed };
}

async function main() {
  const wait = (f: ReturnType<typeof fixture>, base = 300_000, hard = 600_000) =>
    api.waitForChatGPTImageArtifacts(f.page, base, { hardTimeoutMs: hard, now: f.now });
  const normal = fixture({ readyAt: 90_000, generating: true });
  assert.equal(await wait(normal), 1);
  assert.equal(normal.now(), 93_000, "completes after >60s without consuming whole budget");
  const extended = fixture({ readyAt: 420_000, generating: true });
  assert.equal(await wait(extended), 1);
  assert.equal(extended.now(), 423_000, "active generation extends the original five minutes");
  const stuck = fixture({ generating: true });
  assert.equal(await wait(stuck), 0);
  assert.equal(stuck.now(), 600_000, "permanent progress cannot bypass hard deadline");
  const completedWithStaleStop = fixture({readyAt:90_000,staleStop:true});
  assert.equal(await wait(completedWithStaleStop),1);
  assert.equal(completedWithStaleStop.now(),105_000,"stable loaded artifact wins over stale global stop button");
  const changingPreview = fixture({readyAt:0,staleStop:true,changingArtifact:true});
  assert.equal(await wait(changingPreview,60_000,60_000),0,"changing artifact is not a completed result");
  const transient = fixture({readyAt:0,staleStop:true});
  const originalEvaluate = transient.page.evaluate.bind(transient.page);
  let artifactCalls = 0;
  transient.page.evaluate = (async (fn: { name?: string }, arg?: unknown) => {
    if (fn.name === "collectRenderableChatGPTGeneratedImages" && ++artifactCalls === 3) {
      throw new Error("Execution context was destroyed");
    }
    return originalEvaluate(fn as never, arg as never);
  }) as typeof transient.page.evaluate;
  assert.equal(await wait(transient,60_000,60_000),1,"transient context error recovers");
  assert.equal(transient.now(),24_000,"transient error resets artifact stability");
  const idle = fixture();
  assert.equal(await wait(idle), 0);
  assert.equal(idle.now(), 300_000, "no progress ends at base deadline");
  const costly = fixture({ observationCost: 40_000 });
  assert.equal(await wait(costly, 60_000, 60_000), 0);
  assert.ok(costly.now() < 100_000, "observation time is counted, not just sleeps");
  const legacy = fixture({ generating: true });
  assert.equal(await api.waitForChatGPTImageArtifacts(legacy.page, 90_000, { now: legacy.now }), 0);
  assert.equal(legacy.now(), 90_000, "explicit shared caller timeouts stay hard");
  for (const settings of [{ authAt: 30_000 }, { securityAt: 30_000 }]) {
    const f = fixture(settings);
    await assert.rejects(wait(f), (error: unknown) => policy.isSessionWideImageFailure(error));
    assert.equal(f.now(), 30_000);
  }
  const hung = fixture();
  hung.page.evaluate = () => new Promise(() => {});
  assert.equal(await api.waitForChatGPTImageArtifacts(hung.page, 15), 0, "hung observation bounded by actual timer");

  const ambiguous = fixture();
  let clicks = 0;
  let presses = 0;
  const originalLocator = ambiguous.page.locator.bind(ambiguous.page);
  ambiguous.page.locator = ((selector: string) => ({
    first() { return this; },
    isVisible: async () => selector.includes("send-button") || await originalLocator(selector).isVisible(),
    waitFor: async () => {},
    click: async () => { if (selector.includes("send-button")) { clicks += 1; throw new Error("click dispatched but acknowledgement timed out"); } },
    press: async () => { presses += 1; },
  })) as unknown as typeof ambiguous.page.locator;
  Object.defineProperty(ambiguous.page, "keyboard", { value: { type: async () => {} } });
  await assert.rejects(api.submitPromptToChatGPT(ambiguous.page, "fixture"), /acknowledgement timed out/);
  assert.equal(clicks, 1);
  assert.equal(presses, 0, "ambiguous send click never retries with Enter");

  for (const value of ["", "0", "-1", "NaN", "Infinity"]) {
    assert.equal(policy.imageWaitPolicy({ CHATGPT_IMAGE_WAIT_MS: value }).baseMs, 300_000);
  }
  assert.equal(policy.imageBatchBudgetMs(11, {}), 600_000 + 180_000 + 11 * 1_052_000);
  assert.ok(policy.imageBatchBudgetMs(1, { CHATGPT_PROFILE_LOCK_TIMEOUT_MS: "1200000" }) >= 1_200_000 + 180_000 + 1_052_000);
  assert.ok(policy.imageJobBudgetMs({ BRAND_POST_IMAGE_JOB_TIMEOUT_MS: "60000" }) >= 1_052_000);
  assert.ok(policy.imageJobBudgetMs({ CHATGPT_IMAGE_WAIT_HARD_MS: "1200000" }) >= 1_652_000);
  assert.equal(policy.imageBatchBudgetMs(11, { BRAND_POST_IMAGE_BATCH_TIMEOUT_MS: "25000" }), 25_000);
  assert.equal(policy.imageBatchBudgetMs(Number.MAX_VALUE, {}), policy.IMAGE_TIMER_MAX_MS);
  for (const message of ["60s timeout; check login", "download failed", "text-only response", "security might be required", "CHATGPT_BROWSER_UNREACHABLE: offline"]) {
    assert.equal(policy.isSessionWideImageFailure(message), false);
  }
  assert.equal(policy.isSessionWideImageFailure(new Error("ChatGPT: CHATGPT_BROWSER_AUTH_REQUIRED: verification required")), true);
  console.log("PASS actual wait: >60s completion, bounded progress extension, hard deadline, idle deadline, wall-clock cost, legacy callers, auth/security, hung page");
  console.log("PASS policy: invalid settings, 11-slot parent budget, 600s profile lock, overrides, finite timer, fail-fast classification");
  console.log("PASS actual submit: ambiguous click failure never submits twice");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

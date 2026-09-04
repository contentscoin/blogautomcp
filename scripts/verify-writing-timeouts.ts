import assert from "node:assert/strict";
import fs from "node:fs";
import { getWritingTimeoutPolicy, writingTimeoutMs } from "./lib/writing-timeout-policy";
import { createChatGptReplyProgress, recordChatGptReplyText, isChatGptReplyTextStalled } from "./lib/chatgpt-reply-progress";

const minute = 60_000;
const defaults = getWritingTimeoutPolicy({});
assert.equal(defaults.codexMs, 10 * minute);
assert.equal(defaults.responseMs, 10 * minute);
assert.equal(defaults.idleMs, 5 * minute);
assert.equal(defaults.writingChainMs, 120 * minute);
assert.equal(defaults.agentMs, 150 * minute);
assert.equal(defaults.prepareMs, 155 * minute);
assert.equal(defaults.generateMs, 160 * minute);
for (const bad of [undefined, "", "NaN", "Infinity", "-1", "0"]) {
  assert.equal(writingTimeoutMs(bad, defaults.codexMs), defaults.codexMs);
}
assert.equal(writingTimeoutMs("900000", defaults.codexMs), 15 * minute);
assert.equal(writingTimeoutMs("1e100", defaults.codexMs), 180 * minute);
for (const oldAgent of ["900000", "1200000"]) {
  const policy = getWritingTimeoutPolicy({ AGENT_MAX_RUNTIME_MS: oldAgent, REMOTE_DRAFT_GENERATE_WAIT_MS: "1800000" });
  assert.ok(policy.agentMs >= policy.writingChainMs + 30 * minute);
  assert.ok(policy.generateMs > policy.agentMs);
}
assert.equal(getWritingTimeoutPolicy({ AGENT_MAX_RUNTIME_MS: "10200000" }).agentMs, 170 * minute);
assert.equal(getWritingTimeoutPolicy({ CODEX_BROWSER_FALLBACK_ENABLED: "TRUE" }).writingChainMs, 160 * minute);
const maximum = getWritingTimeoutPolicy({
  CODEX_DRAFT_TIMEOUT_MS: "1e100", CHATGPT_RESPONSE_MAX_TIMEOUT_MS: "1e100",
  AGENT_MAX_RUNTIME_MS: "1e100", REMOTE_DRAFT_PREPARE_WAIT_MS: "1e100",
  REMOTE_DRAFT_GENERATE_WAIT_MS: "1e100", CODEX_BROWSER_FALLBACK_ENABLED: "true",
});
for (const timer of Object.values(maximum)) {
  assert.ok(Number.isFinite(timer) && timer > 0 && timer < 2_147_483_647);
}
assert.ok(maximum.generateMs > maximum.prepareMs && maximum.prepareMs > maximum.agentMs);
const progress = recordChatGptReplyText(createChatGptReplyProgress(0), "실제 본문", 4 * minute).progress;
const unchanged = recordChatGptReplyText(progress, "실제 본문", 8 * minute).progress;
assert.equal(unchanged.lastTextChangedAt, 4 * minute);
assert.equal(isChatGptReplyTextStalled(unchanged, 9 * minute - 1, defaults.idleMs), false);
assert.equal(isChatGptReplyTextStalled(unchanged, 9 * minute, defaults.idleMs), true);
assert.equal(recordChatGptReplyText(unchanged, "", 9 * minute).changed, false);

// Guard the actual callers: importing simple-agent would launch production work.
const agent = fs.readFileSync("scripts/simple-agent.ts", "utf8");
const provider = fs.readFileSync("scripts/lib/codex-draft-provider.ts", "utf8");
const route = fs.readFileSync("src/app/api/remote-agent/poll/route.ts", "utf8");
assert.match(agent, /CODEX_DRAFT_TIMEOUT_MS = writingTimeoutPolicy.codexMs/);
assert.match(agent, /AGENT_MAX_RUNTIME_MS = writingTimeoutPolicy.agentMs/);
assert.match(agent, /timeoutMs: CODEX_DRAFT_TIMEOUT_MS/);
assert.match(provider, /writingTimeoutMs\(options.timeoutMs, getWritingTimeoutPolicy\(\).codexMs\)/);
assert.match(provider, /setTimeout\(\(\) => controller.abort\(\), timeoutMs\)/);
const direct = agent.slice(agent.indexOf("async function runDirectChatGPTGeneration("), agent.indexOf("async function runChatGPTBrowserDirect("));
assert.equal((direct.match(/idleTimeoutMs: CHATGPT_RESPONSE_IDLE_TIMEOUT_MS/g) ?? []).length, 3);
assert.equal((direct.match(/maxTimeoutMs: CHATGPT_RESPONSE_MAX_TIMEOUT_MS/g) ?? []).length, 3);
assert.doesNotMatch(direct, /Math.min\(CHATGPT_RESPONSE/);
assert.match(agent, /recordChatGptReplyText\(replyProgress, candidate, Date.now\(\)\)/);
assert.match(route, /DRAFT_PREPARE_WAIT_MS = getWritingTimeoutPolicy\(\).prepareMs/);
assert.match(route, /DRAFT_GENERATE_WAIT_MS = getWritingTimeoutPolicy\(\).generateMs/);
assert.match(route, /timeoutMs: DRAFT_PREPARE_WAIT_MS/);
assert.match(route, /timeoutMs: DRAFT_GENERATE_WAIT_MS/);
assert.match(route, /JOB_HEARTBEAT_INTERVAL_MS = 30_000/);
const example = fs.readFileSync(".env.example", "utf8");
for (const key of ["CODEX_DRAFT_TIMEOUT_MS", "AGENT_MAX_RUNTIME_MS", "REMOTE_DRAFT_PREPARE_WAIT_MS", "REMOTE_DRAFT_GENERATE_WAIT_MS"]) {
  assert.equal((example.match(new RegExp(`^${key}=`, "gm")) ?? []).length, 1, `${key} must not be shadowed by an old example value`);
}
console.log("writing-timeouts: policy, caller wiring, legacy parent floors and actual-text idle PASS");

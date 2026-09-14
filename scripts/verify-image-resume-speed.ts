/** Offline regression: no browser, account, network, or generation is used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import * as imagePolicy from "./lib/image-timeout-policy";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-resume-speed-"));
const jobsFile = path.join(dir, "jobs.json");
const resultsFile = path.join(dir, "results.jsonl");
const output = path.join(dir, "image.png");
const journalFile = path.join(dir, "image.checkpoint.jsonl");
const job = { id: "0", prompt: "fixture", outStem: path.join(dir, "image") };
let browserCalls = 0;
let stdout = "";
const fakeProcess = { argv: ["node", "worker", "--jobs-file", jobsFile, "--results-file", resultsFile, "--gpt-url", "https://chatgpt.com/"],
  pid: process.pid, kill: process.kill.bind(process),
  env: {}, stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: () => {} }, exitCode: 0 };
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: loaded, exports: loaded.exports, process: fakeProcess, console, Buffer, Error,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    } });
  return loaded.exports as T;
}
const batch = load<typeof import("./chatgpt-generate-image-batch")>("scripts/chatgpt-generate-image-batch.ts", {
  "dotenv/config": {}, fs, path, "node:crypto": crypto,
  "./lib/image-batch-diagnostics": { imageBatchSucceeded: (failure: unknown, results: Array<{ localPath: string | null; error?: string }>) => !failure && results.every(r => r.localPath && !r.error) },
  "./lib/image-timeout-policy": {},
  "./lib/chatgpt-browser": { createChatGPTContext: () => { browserCalls++; throw new Error("Browser forbidden in offline test"); } },
});
async function main() {
  const started = performance.now();
  fs.writeFileSync(jobsFile, JSON.stringify([job]));
  fs.writeFileSync(output, "fixture image bytes");
  const fingerprint = batch.imageJobFingerprint(job);
  const completed = { id: "slot", fingerprint, localPath: output,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex") };
  const write = (value: unknown) => fs.writeFileSync(journalFile, JSON.stringify(value) + "\n");
  write(completed);
  await batch.main();
  assert.equal(JSON.parse(stdout).jobs[0].localPath, output);
  assert.equal(browserCalls, 0, "all-complete resume must not initialize a browser/profile");
  fs.appendFileSync(journalFile, '{"state":');
  stdout = "";
  await batch.main();
  assert.equal(JSON.parse(stdout).jobs[0].localPath, output, "complete image survives a partially written tail");
  assert.equal(browserCalls, 0);
  write({ id: "slot", fingerprint, state: "submitted", recoveryConversationPath: "/c/fixture-conversation" });
  fs.appendFileSync(journalFile, '{"id":');
  assert.equal(batch.readImageBatchResume(journalFile, [{ ...job, id: "slot" }]).get("slot")!.recoveryConversationPath, "/c/fixture-conversation", "known conversation permits retrieval-only recovery");
  let newPrompts = 0;
  const recoveredUrls: string[] = [];
  const page = { goto: async (url: string) => { recoveredUrls.push(url); }, url: () => "https://chatgpt.com/c/fixture-conversation", close: async () => {} };
  const recoveredOutput = path.join(dir, "retrieved.png"); fs.writeFileSync(recoveredOutput, "retrieved fixture");
  const retrieval = load<typeof import("./chatgpt-generate-image-batch")>("scripts/chatgpt-generate-image-batch.ts", {
    "dotenv/config": {}, fs, path, "node:crypto": crypto,
    "./lib/image-batch-diagnostics": { imageBatchSucceeded: () => true, imagePageSignals: async () => ({}), keepFailedDiagnosticOpen: () => false },
    "./lib/image-timeout-policy": imagePolicy,
    "./lib/chatgpt-browser": { createChatGPTContext: async () => ({ context: { newPage: async () => page }, close: async () => {} }),
      isChatGPTGenerating: async () => false, countRenderableChatGPTImages: async () => 1,
      waitForChatGPTImageArtifacts: async () => 1, downloadChatGPTImages: async () => [recoveredOutput],
      submitPromptToChatGPT: async () => { newPrompts++; throw Error("must never submit"); }, openFreshChatGPTTarget: async () => { throw Error("must recover existing conversation"); } },
  });
  stdout = ""; await retrieval.main();
  assert.equal(JSON.parse(stdout).jobs[0].localPath, output);
  assert.deepEqual(recoveredUrls, ["https://chatgpt.com/c/fixture-conversation"]);
  assert.equal(newPrompts, 0);
  assert.ok(fs.readdirSync(dir).some(name => name.startsWith("image.checkpoint.jsonl.partial-")), "partial bytes preserved before appending recovered result");
  write({ id: "slot", fingerprint, error: "IMAGE_PROVIDER_REFUSED: policy" });
  assert.match(batch.readImageBatchResume(journalFile, [{ ...job, id: "slot" }]).get("slot")!.error!, /IMAGE_PROVIDER_REFUSED/);
  fs.writeFileSync(journalFile, '{"broken":\n' + JSON.stringify(completed) + '\n');
  assert.throws(() => batch.readImageBatchResume(journalFile, [{ ...job, id: "slot" }]), /IMAGE_CHECKPOINT_CORRUPT/);
  assert.equal(fs.existsSync(resultsFile + ".lock"), false);
  write({ id: "slot", fingerprint, state: "attempted" });
  stdout = "";
  await batch.main();
  assert.match(JSON.parse(stdout).jobs[0].error, /IMAGE_RESUME_REQUIRED/);
  assert.equal(browserCalls, 0, "ambiguous submission must never be retried");
  write(completed);
  fs.writeFileSync(output, "changed");
  assert.equal(batch.readImageBatchResume(journalFile, [{ ...job, id: "slot" }]).get("slot")!.localPath, null);
  assert.throws(() => batch.readImageBatchResume(journalFile, [{ ...job, id: "slot", prompt: "different" }]), /does not match/);
  fs.writeFileSync(journalFile, '{"id":');
  stdout = "";
  await batch.main();
  assert.match(JSON.parse(stdout).jobs[0].error, /IMAGE_RESUME_REQUIRED/);
  assert.equal(browserCalls, 0, "partial journal never permits a new generation");
  assert.equal(fs.existsSync(resultsFile + ".lock"), false, "invalid checkpoint releases owned lock");
  fs.writeFileSync(resultsFile + ".lock", "other worker");
  await assert.rejects(batch.main(), /EEXIST/);
  assert.equal(fs.readFileSync(resultsFile + ".lock", "utf8"), "other worker");

  const pidLock = path.join(dir, "pid.lock");
  fs.writeFileSync(pidLock, JSON.stringify({ pid: process.pid, token: "alive" }));
  assert.throws(() => batch.acquireImageCheckpointLock(pidLock), /EEXIST/);
  assert.equal(JSON.parse(fs.readFileSync(pidLock, "utf8")).token, "alive");
  const realKill = fakeProcess.kill;
  fakeProcess.kill = (() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); }) as typeof fakeProcess.kill;
  assert.throws(() => batch.acquireImageCheckpointLock(pidLock), /EEXIST/);
  assert.equal(JSON.parse(fs.readFileSync(pidLock, "utf8")).token, "alive", "unknown owner must stay locked");
  fakeProcess.kill = realKill;
  // A local no-op process supplies an actually exited PID; no browser is launched.
  const deadPid = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", () => resolve(child.pid!));
  });
  fs.writeFileSync(pidLock, JSON.stringify({ pid: deadPid, token: "dead" }));
  const release = batch.acquireImageCheckpointLock(pidLock);
  assert.equal(JSON.parse(fs.readFileSync(pidLock, "utf8")).pid, process.pid);
  assert.throws(() => batch.acquireImageCheckpointLock(pidLock), /EEXIST/, "recovered live lock cannot be stolen");
  release();
  assert.equal(fs.existsSync(pidLock), false);

  const browser = load<typeof import("./lib/chatgpt-browser")>("scripts/lib/chatgpt-browser.ts", {
    fs, path, playwright: {}, "./app-paths": { getChatgptProfileDir: () => "unused", getChatgptSessionFile: () => "unused" },
    "./chatgpt-browser-visibility": {}, "./chatgpt-profile-lock": {}, "./chatgpt-browser-errors": {}, "./image-timeout-policy": {},
  });
  let waits = 0;
  const downloadPage = { waitForTimeout: async (ms: number) => { waits += ms; },
    evaluate: async (_fn: unknown, candidates?: unknown) => candidates ? ["data:image/png;base64,aW1hZ2U="] : [{ src: "fixture" }] };
  const paths = await browser.downloadChatGPTImages(downloadPage as unknown as Parameters<typeof browser.downloadChatGPTImages>[0], dir);
  assert.equal(paths.length, 1);
  assert.equal(waits, 0, "loaded artifact download has no unconditional timer");
  assert.equal(fs.readFileSync(paths[0], "utf8"), "image");
  console.log(`PASS offline resume/download regressions (${Math.round(performance.now() - started)}ms measured test runtime; zero browser calls, zero download sleep).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

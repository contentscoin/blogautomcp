/** Offline transport regression checks. No browser or generation provider is loaded. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import ts from "typescript";
import type { generateBrandPostImages as Generate, BrandPostImageGenerationResult } from "../src/lib/brand-post-image-generation";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-image-batch-"));
const rawPath = path.join(root, "raw.png");
const sourcePath = path.join(root, "original.png");
fs.writeFileSync(rawPath, "fake raw image");
fs.writeFileSync(sourcePath, "fake original image");
const prefix = "[chatgpt-image-batch:result] ";
let checks = 0;

function load<T>(file: string, dependencies: Record<string, unknown>, overrides: Record<string, unknown> = {}, expose = ""): T {
  const source = fs.readFileSync(path.resolve(file), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code + expose, {
    module: loadedModule, exports: loadedModule.exports,
    require: (name: string) => {
      assert.ok(Object.prototype.hasOwnProperty.call(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    process, console: { log() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    ...overrides,
  }, { filename: file });
  return loadedModule.exports as T;
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills = 0;
  kill() { this.kills += 1; return true; }
}

type Job = { id: string; outStem: string; prompt: string };
function harness(settings: { timeout?: number; spawnError?: "sync" | "async"; lockFails?: boolean; automation?: boolean } = {}) {
  const child = new FakeChild();
  let jobs: Job[] = [];
  let checkpoint = "";
  let spawns = 0;
  let lockCalls = 0;
  const locked = async () => {
    lockCalls += 1;
    if (settings.lockFails) throw new Error("cutout failed");
    return { outputPath: sourcePath };
  };
  const api = load<{
    generateBrandPostImages: typeof Generate;
    imageBatchTimeoutMs: (n: number) => number;
    runBrowserImageBatch: (
      targets: unknown[], manifest: unknown, productName: string, workDir: string,
      onResult: () => Promise<void>,
    ) => Promise<{ id: string; localPath: string | null; error?: string }[]>;
  }>(
    "src/lib/brand-post-image-generation.ts", {
      "node:fs": fs, "node:path": path,
      "node:child_process": {
        spawn(_command: string, args: string[], options: { windowsHide: boolean; shell: boolean }) {
          spawns += 1;
          assert.equal(options.windowsHide, true);
          assert.equal(options.shell, false);
          if (settings.spawnError === "sync") throw new Error("spawn sync failure");
          jobs = JSON.parse(fs.readFileSync(args[args.indexOf("--jobs-file") + 1], "utf8"));
          checkpoint = args[args.indexOf("--results-file") + 1];
          if (settings.spawnError === "async") setImmediate(() => child.emit("error", new Error("spawn async failure")));
          return child;
        },
      },
      "../../scripts/lib/product-image-lock": {
        createLockedProductEditorialScene: locked,
        createLockedProductThumbnailOnBackground: locked,
        createOriginalProductPhotoThumbnail: async () => ({ outputPath: sourcePath }),
      },
      "../../scripts/lib/product-thumbnail": { buildProductThumbnailCopy: () => ({}) },
      "../../scripts/lib/travel-content": { buildTravelThumbnailCopy: () => ({}) },
      "../../scripts/lib/travel-thumbnail": { createTravelEditorialThumbnail: async () => ({ outputPath: sourcePath }) },
      "./brand-post-package": {
        getBrandPostPackageDir: () => root,
        normalizePackageImageAssets: (manifest: { imageAssets?: unknown[] }) => manifest.imageAssets || [],
        applyGeneratedBrandPostImage: () => { throw new Error("not used by the transport harness"); },
      },
      "./chatgpt-browser-automation": { isChatGptBrowserAutomationEnabled: () => settings.automation ?? true },
      "node:crypto": { createHash: () => { throw new Error("not used by the transport harness"); } },
    },
    { process: { ...process, env: { ...process.env, BRAND_POST_IMAGE_BATCH_TIMEOUT_MS: settings.timeout?.toString() || "", BRAND_POST_IMAGE_JOB_TIMEOUT_MS: "" } } },
    "\nmodule.exports.runBrowserImageBatch = runBrowserImageBatch;",
  );
  const manifest = {
    brandLinkId: "fixture", connectKind: "TRAVEL", title: "Fixture",
    composition: { sections: [{ id: "section", title: "제주", imageIntent: "해변", body: ["문맥"] }] },
    imageAssets: [{ sha256: "hero", role: "hero", path: sourcePath, provenance: "ORIGINAL" }],
  } as unknown as Parameters<typeof Generate>[0]["manifest"];
  const callbacks: BrandPostImageGenerationResult[] = [];
  const requests = (count: number) => Array.from({ length: count }, (_, index) => ({ requestId: `요청-${index}`, sectionId: "section" }));
  const generate = (count: number, extra: Partial<Parameters<typeof Generate>[0]> = {}) => api.generateBrandPostImages({
    manifest, productName: "Fixture", requests: requests(count), onResult: (result) => { callbacks.push(result); }, ...extra,
  });
  const result = (index: number, localPath: string | null = rawPath) => ({ id: jobs[index].id, localPath });
  const progress = (index: number) => {
    const line = Buffer.from(`${prefix}${JSON.stringify(result(index))}\n`, "utf8");
    // Exercise fragmented UTF-8 and record framing.
    for (let offset = 0; offset < line.length; offset += 3) child.stderr.write(line.subarray(offset, offset + 3));
  };
  const close = (code = 0, output?: unknown) => {
    child.emit("exit", code);
    if (output !== undefined) child.stdout.write(JSON.stringify(output));
    child.emit("close", code, null);
  };
  return { ...api, child, manifest, callbacks, generate, result, progress, close,
    get jobs() { return jobs; }, get checkpoint() { return checkpoint; },
    get spawns() { return spawns; }, get lockCalls() { return lockCalls; } };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function verifyGenerator() {
  await check("transport delivery queue resolves even when its consumer rejects", async () => {
    const h = harness();
    const workDir = fs.mkdtempSync(path.join(root, "delivery-"));
    const targets = [0, 1].map((i) => ({
      request: { requestId: String(i) }, sectionId: "section", role: "body",
      sectionTitle: "fixture", imageIntent: "fixture", bodyExcerpt: "fixture",
    }));
    let calls = 0;
    const pending = h.runBrowserImageBatch(targets, h.manifest, "fixture", workDir, async () => {
      calls += 1;
      if (calls === 1) throw new Error("consumer rejected");
    });
    h.progress(0);
    await tick();
    h.close(0, { ok: true, jobs: [h.result(0), h.result(1)] });
    const results = await pending;
    assert.equal(calls, 2);
    assert.equal(results[0].localPath, rawPath);
    assert.match(results[0].error!, /consumer rejected/);
    assert.equal(results[1].error, undefined);
  });

  await check("all 7 requests, early awaited callback, deduplication, stdout drained after exit", async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seen: string[] = [];
    const pending = h.generate(7, { onResult: async (r) => { seen.push(r.requestId); if (seen.length === 1) await gate; } });
    assert.equal(h.jobs.length, 7);
    // Per-job budget (3 min default) plus startup slack, never the old 8 min × jobs.
    assert.equal(h.imageBatchTimeoutMs(7), 7 * 180_000 + 60_000);
    assert.equal(h.imageBatchTimeoutMs(1), 180_000 + 60_000);
    assert.equal(h.imageBatchTimeoutMs(40), 30 * 60_000, "batch budget is capped at 30 minutes");
    h.progress(0);
    await tick();
    assert.equal(seen.length, 1, "first result must arrive before child close");
    h.progress(0);
    h.progress(1);
    await tick();
    assert.equal(seen.length, 1, "persistence callbacks must not overlap");
    h.close(0, { ok: true, jobs: h.jobs.map((_, i) => h.result(i)) });
    let done = false;
    void pending.then(() => { done = true; });
    await tick();
    assert.equal(done, false, "return must await persistence");
    release();
    const results = await pending;
    assert.equal(results.length, 7);
    assert.equal(seen.length, 7);
    results.forEach((r, i) => { assert.equal(r.requestId, `요청-${i}`); assert.equal(r.generatedPath, rawPath); });
  });

  await check("nonzero exit recovers checkpoint and ignores truncated/corrupt records", async () => {
    const h = harness();
    const pending = h.generate(3);
    fs.writeFileSync(h.checkpoint, `${JSON.stringify(h.result(0))}\ninvalid\n${JSON.stringify(h.result(1))}\n{"id":`);
    h.child.stderr.write("browser crashed\n");
    h.close(9, { ok: false, jobs: [] });
    const results = await pending;
    assert.equal(results[0].generatedPath, rawPath);
    assert.equal(results[1].generatedPath, rawPath);
    assert.match(results[2].error!, /browser crashed/);
    assert.equal(h.callbacks.length, 3);
  });

  await check("deadline recovers checkpoint with no output or close event", async () => {
    const h = harness({ timeout: 25 });
    assert.equal(h.imageBatchTimeoutMs(20), 25);
    const pending = h.generate(2);
    fs.writeFileSync(h.checkpoint, `${JSON.stringify(h.result(0))}\n`);
    const results = await pending;
    assert.equal(h.child.kills, 1);
    assert.equal(results[0].generatedPath, rawPath);
    assert.match(results[1].error!, /초과/);
    h.progress(1);
    h.close();
    await tick();
    assert.equal(h.callbacks.length, 2, "late output must not redeliver results");
  });

  await check("checkpoint polling delivers while child is still running", async () => {
    const h = harness();
    let received!: () => void;
    const first = new Promise<void>((resolve) => { received = resolve; });
    const pending = h.generate(2, { onResult: () => received() });
    fs.writeFileSync(h.checkpoint, `${JSON.stringify(h.result(0))}\n`);
    await first;
    h.close(1);
    assert.equal((await pending)[0].generatedPath, rawPath);
  });

  for (const kind of ["sync", "async"] as const) {
    await check(`${kind} spawn failure returns errors for every request`, async () => {
      const h = harness({ spawnError: kind });
      const results = await h.generate(5);
      assert.equal(results.length, 5);
      results.forEach((r) => assert.match(r.error!, /spawn .* failure/));
      assert.equal(h.callbacks.length, 5);
    });
  }

  await check("legacy stdout JSON alone survives nonzero exit and UTF-8 chunking", async () => {
    const h = harness();
    const pending = h.generate(2);
    const bytes = Buffer.from(JSON.stringify({ ok: false, jobs: [h.result(0), { ...h.result(1, null), error: "생성 실패" }] }));
    for (const byte of bytes) h.child.stdout.write(Buffer.from([byte]));
    h.close(1);
    const results = await pending;
    assert.equal(results[0].generatedPath, rawPath);
    assert.equal(results[1].error, "생성 실패");
  });

  await check("malformed progress/stdout, unknown IDs, missing paths, job failures", async () => {
    const h = harness();
    const pending = h.generate(3);
    h.child.stderr.write(`${prefix}{bad}\n${prefix}{"id":"unknown","localPath":"unused"}\n${prefix}{"id":"0","localPath":false}\n`);
    h.child.stderr.write(`${prefix}${JSON.stringify(h.result(0, path.join(root, "missing.png")))}\n`);
    h.child.stderr.write(`${prefix}${JSON.stringify({ ...h.result(1, null), error: "specific job failure" })}\n`);
    h.child.stdout.write("not JSON");
    h.close();
    const results = await pending;
    assert.equal(results.length, 3);
    results.forEach((r) => { assert.equal(r.generatedPath, null); assert.ok(r.error); });
    assert.equal(results[1].error, "specific job failure");
  });

  await check("invalid targets are per-request; duplicate requestIds remain distinct", async () => {
    const h = harness();
    const pending = h.generate(0, { requests: [
      { requestId: "bad", sectionId: "missing" },
      { requestId: "same", sectionId: "section" },
      { requestId: "same", replaceAssetKey: "hero" },
    ] });
    await tick();
    assert.equal(h.jobs.length, 2);
    assert.notEqual(h.jobs[0].id, h.jobs[1].id);
    h.close(0, { ok: true, jobs: [h.result(0), h.result(1)] });
    const results = await pending;
    assert.ok(results[0].error);
    assert.equal(results[1].generatedPath, rawPath);
    assert.equal(results[2].generatedPath, sourcePath);
    assert.equal(results[2].replaceAssetKey, "hero");
  });

  await check("callback failure preserves image and does not prevent later callbacks", async () => {
    const h = harness();
    let calls = 0;
    const pending = h.generate(2, { onResult: async () => { calls += 1; if (calls === 1) throw new Error("storage offline"); } });
    h.close(0, { ok: true, jobs: [h.result(0), h.result(1)] });
    const results = await pending;
    assert.equal(calls, 2);
    assert.equal(results[0].generatedPath, rawPath);
    assert.match(results[0].error!, /storage offline/);
    assert.equal(results[1].error, undefined);
  });

  for (const lockFails of [false, true]) {
    await check(`shopping body and hero retain product locking (fallback=${lockFails})`, async () => {
      const h = harness({ lockFails });
      h.manifest.connectKind = "SHOPPING";
      const pending = h.generate(0, { requests: [
        { requestId: "body", sectionId: "section" }, { requestId: "hero", replaceAssetKey: "hero" },
      ] });
      h.progress(0);
      await tick();
      assert.equal(h.callbacks[0].generatedPath, sourcePath);
      h.close(0, { ok: true, jobs: [h.result(0), h.result(1)] });
      const results = await pending;
      assert.equal(h.lockCalls, 2);
      results.forEach((r) => {
        assert.equal(r.generatedPath, sourcePath);
        assert.equal(r.provenance, lockFails ? "ORIGINAL" : "LOCKED_PRODUCT");
      });
      assert.match(h.jobs[0].prompt, /Generate the environment only/);
    });
  }

  await check("browser automation switched off refuses every request without spawning", async () => {
    const h = harness({ automation: false });
    const results = await h.generate(3);
    assert.equal(h.spawns, 0, "no chatgpt.com process may start while automation is off");
    assert.equal(results.length, 3);
    results.forEach((r) => {
      assert.equal(r.generatedPath, null);
      assert.match(r.error!, /브라우저 자동화가 꺼져 있어/);
      assert.match(r.error!, /post_apply_section_image/);
    });
    assert.equal(h.callbacks.length, 3);
  });

  await check("empty/invalid-only batches never spawn a generator", async () => {
    const h = harness();
    assert.equal((await h.generate(0)).length, 0);
    assert.ok((await h.generate(0, { requests: [{ requestId: "bad", replaceAssetKey: "missing" }] }))[0].error);
    assert.equal(h.spawns, 0);
  });
}

async function verifyProducer(startupFailure = false, failFast = false) {
  process.env.BRAND_POST_IMAGE_BATCH_FAIL_FAST = failFast ? "true" : "false";
  const dir = fs.mkdtempSync(path.join(root, "producer-"));
  const jobsFile = path.join(dir, "jobs.json");
  const checkpoint = `${jobsFile}.results.jsonl`;
  const jobs = Array.from({ length: 3 }, (_, i) => ({ id: `슬롯-${i}`, prompt: "fake", outStem: path.join(dir, `raw-${i}`) }));
  fs.writeFileSync(jobsFile, JSON.stringify(jobs));
  let stdout = "";
  let stderr = "";
  let submitted = 0;
  let closed = false;
  const page = { waitForTimeout: async () => {}, textContent: async () => "" };
  const readRecords = () => fs.readFileSync(checkpoint, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const api = load<{ main: () => Promise<void> }>("scripts/chatgpt-generate-image-batch.ts", {
    "dotenv/config": {}, fs, path,
    "./lib/chatgpt-browser": {
      createChatGPTContext: async () => {
        if (startupFailure) throw new Error("browser startup failed");
        return { context: { newPage: async () => page }, close: async () => {
          // Final stdout must be available even if browser cleanup hangs or fails.
          assert.equal(JSON.parse(stdout).jobs.length, 3);
          closed = true;
        } };
      },
      openFreshChatGPTTarget: async () => {},
      startFreshChat: async () => {
        assert.equal(readRecords().length, submitted, "previous job must be checkpointed before next starts");
        assert.equal(stderr.split(prefix).length - 1, submitted, "previous job must emit progress before next starts");
      },
      submitPromptToChatGPT: async () => { submitted += 1; },
      readAssistantMessages: async () => [], countRenderableChatGPTImages: async () => 1,
      // 0 = timed out without an artifact. The producer must fail the job instead of downloading nothing.
      waitForChatGPTImageArtifacts: async () => (submitted === 2 && failFast ? 0 : undefined),
      downloadChatGPTImages: async () => { if (submitted === 2) throw new Error("one download failed"); return [rawPath]; },
    },
  }, { process: {
    ...process, argv: ["node", "script", "--jobs-file", jobsFile, "--gpt-url", "https://invalid.test"],
    stdout: { write: (chunk: string) => { stdout += chunk; } },
    stderr: { write: (chunk: string) => { stderr += chunk; } },
  } });
  if (startupFailure) await assert.rejects(api.main(), /browser startup failed/);
  else if (failFast) await assert.rejects(api.main(), /첫 실패 후 중단/);
  else await api.main();
  const output = JSON.parse(stdout);
  const records = readRecords();
  assert.equal(output.ok, !startupFailure && !failFast);
  assert.deepEqual(output.jobs, records);
  assert.equal(records.length, 3);
  assert.equal(stderr.split(prefix).length - 1, 3);
  if (startupFailure) records.forEach((r) => assert.match(r.error, /browser startup failed/));
  else if (failFast) {
    assert.equal(closed, true);
    assert.equal(submitted, 2, "fail-fast must not submit the third prompt");
    assert.ok(fs.existsSync(records[0].localPath));
    assert.match(records[1].error, /이미지를 생성하지 않았습니다/);
    assert.match(records[2].error, /^fail-fast: /);
    assert.equal(records[2].localPath, null);
  } else {
    assert.equal(closed, true);
    assert.equal(submitted, 3);
    assert.ok(fs.existsSync(records[0].localPath));
    assert.match(records[1].error, /one download failed/);
    assert.ok(fs.existsSync(records[2].localPath));
  }
  const priorCheckpoint = fs.readFileSync(checkpoint, "utf8");
  await assert.rejects(api.main(), /EEXIST/);
  assert.equal(fs.readFileSync(checkpoint, "utf8"), priorCheckpoint, "rerun must not destroy durable evidence");
}

async function main() {
  try {
    await verifyGenerator();
    await check("producer checkpoints each job, streams stderr, preserves legacy stdout (fail-fast off)", () => verifyProducer());
    await check("producer startup failure checkpoints per-job errors", () => verifyProducer(true));
    await check("producer fail-fast stops after the first failure and records the rest", () => verifyProducer(false, true));
    console.log(`Verified ${checks} offline image-batch checks; no paid generation.`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

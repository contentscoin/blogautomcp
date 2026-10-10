/** Offline regressions for the Codex-login (gpt-image-2) image transport. The Codex SDK is mocked. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  CODEX_IMAGE_MODEL_LABEL,
  buildCodexImageInstruction,
  collectCompletedProductCandidates,
  locateCodexImage,
  readLegacyCodexImageCompletion,
  resolveBrandPostImageEngine,
  runCodexImageBatch,
  type ImageBatchJob,
  type ImageBatchResult,
} from "../src/lib/codex-image-generation";
import { runImageBatch } from "../src/lib/brand-post-image-generation";
import draftRuntimePolicy from "./lib/draft-runtime-policy.json";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);

type Behaviour = "workspace" | "generated" | "nothing" | "auth" | "ambiguous" | "duplicate" | "eof" | "failed" | "timeout" | "late-auth" | "late-model";
function mockCodex(behaviour: (prompt: string, call: number) => Behaviour, codexHome: string) {
  const threads: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  const inputs: unknown[] = [];
  let active = 0;
  let peak = 0;
  return {
    threads, prompts, inputs, peak: () => peak,
    create: async () => ({
      startThread(options: Record<string, unknown>) {
        threads.push(options);
        const call = threads.length;
        return {
          async runStreamed(input: unknown) {
            inputs.push(input);
            const text = typeof input === "string" ? input : (input as Array<{ type: string; text?: string }>).find((part) => part.type === "text")!.text!;
            prompts.push(text);
            const mode = behaviour(text, call);
            const threadId = `thread-${call}`;
            return {
              events: (async function* () {
                active += 1;
                peak = Math.max(peak, active);
                try {
                  if (mode === "auth") { yield { type: "turn.failed", error: { message: "401 Unauthorized: login required" } }; return; }
                  yield { type: "thread.started", thread_id: threadId };
                  await new Promise((resolve) => setTimeout(resolve, 15));
                  if (mode === "workspace") fs.writeFileSync(path.join(String(options.workingDirectory), "out.png"), PNG);
                  if (["generated", "ambiguous", "duplicate", "eof", "failed", "timeout", "late-auth", "late-model"].includes(mode)) {
                    const dir = path.join(codexHome, "generated_images", threadId);
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, "ig_1.png"), PNG);
                    if (mode === "ambiguous" || mode === "duplicate") {
                      const lastOutput = mode === "ambiguous" ? Buffer.concat([PNG, Buffer.from("unrelated second output")]) : PNG;
                      fs.writeFileSync(path.join(dir, "ig_2.png"), lastOutput);
                      fs.writeFileSync(path.join(String(options.workingDirectory), "out.png"), lastOutput);
                    }
                  }
                  yield { type: "item.completed", item: { type: "agent_message", text: "./out.png" } };
                  if (mode === "eof") return;
                  if (mode === "failed") { yield { type: "turn.failed", error: { message: "review transport failure" } }; return; }
                  if (mode === "late-auth" || mode === "late-model") {
                    yield { type: "turn.failed", error: { message: mode === "late-auth" ? "401 Unauthorized: login required" : "The requested model is not supported by this Codex version" } }; return;
                  }
                  yield { type: "turn.completed", usage: {} };
                } finally {
                  active -= 1;
                }
              })(),
            };
          },
        };
      },
    }),
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-codex-image-"));
  const codexHome = path.join(root, "codex-home");
  const job = (id: string, extra: Partial<ImageBatchJob> = {}): ImageBatchJob => ({ id, prompt: `PROMPT-${id}`, outStem: path.join(root, `raw-${id}`), referenceImagePaths: [], ...extra });
  try {
    // Receipt-less pre-v1 requests can retire only with one exact, genuinely completed native thread.
    const legacyFixture = () => {
      const home = fs.mkdtempSync(path.join(root, "legacy-home-"));
      const outStem = path.join(home, `raw-${crypto.randomBytes(32).toString("hex")}`);
      const workspace = `${outStem}.codex-1`, threadId = crypto.randomUUID();
      fs.mkdirSync(workspace);
      fs.writeFileSync(`${outStem}.png`, PNG);
      const out = path.join(workspace, "out.png");
      fs.writeFileSync(out, PNG);
      const createdAtMs = fs.statSync(workspace).birthtimeMs;
      const nativeDirectory = path.join(home, "generated_images", threadId);
      fs.mkdirSync(nativeDirectory, { recursive: true });
      const native = path.join(nativeDirectory, "exec.png");
      fs.writeFileSync(native, PNG);
      const stamp = new Date(createdAtMs).toISOString().slice(0, 19).replace(/:/gu, "-");
      const sessions = path.join(home, "sessions", ...new Date(createdAtMs).toISOString().slice(0, 10).split("-"));
      fs.mkdirSync(sessions, { recursive: true });
      const rollout = path.join(sessions, `rollout-${stamp}-${threadId}.jsonl`);
      const records = [
        { timestamp: new Date(createdAtMs).toISOString(), type: "session_meta", payload: { id: threadId, cwd: workspace, thread_source: "blogautomcp-image" } },
        { timestamp: new Date(createdAtMs).toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "exact-turn" } },
        { timestamp: new Date(Date.now()).toISOString(), type: "event_msg", payload: { type: "task_complete", turn_id: "exact-turn" } },
      ];
      const save = () => fs.writeFileSync(rollout, records.map(record => JSON.stringify(record)).join("\n") + "\n");
      save();
      const probe = () => readLegacyCodexImageCompletion(outStem, { codexHome: home });
      return { home, outStem, workspace, threadId, nativeDirectory, native, out, sessions, rollout, records, save, probe, stamp, createdAtMs };
    };
    {
      const f = legacyFixture(), files = [`${f.outStem}.png`, f.out, f.native, f.rollout];
      const before = files.map(file => fs.readFileSync(file));
      const proof = f.probe();
      assert.equal(proof?.outputSha256, crypto.createHash("sha256").update(PNG).digest("hex"));
      assert.equal(proof?.workspaces.length, 1);
      assert.equal(proof?.workspaces[0].threadId, f.threadId);
      assert.equal(proof?.workspaces[0].completion.source, "rollout");
      assert.deepEqual(files.map(file => fs.readFileSync(file)), before, "completion lookup never changes runtime output/rollout bytes");
      fs.copyFileSync(f.native, path.join(f.nativeDirectory, "duplicate.png"));
      assert.ok(f.probe(), "same-byte native copies remain a single output");
      const unrelated = path.join(f.sessions, `rollout-${f.stamp}-${crypto.randomUUID()}.jsonl`);
      fs.writeFileSync(unrelated, JSON.stringify({ type: "session_meta", payload: { id: "unrelated", cwd: root, thread_source: "desktop" } }) + "\n{unparseable unrelated conversation");
      assert.ok(f.probe(), "nearby unrelated session conversations are not inspected");
    }
    const uncertainLegacy: Array<[string, (f: ReturnType<typeof legacyFixture>) => void]> = [
      ["no actual completion", f => { f.records.pop(); f.save(); }],
      ["failed request", f => { f.records[2].payload.type = "task_failed"; f.save(); }],
      ["turn identity mismatch", f => { f.records[2].payload.turn_id = "other-turn"; f.save(); }],
      ["wrong exact cwd", f => { f.records[0].payload.cwd = root; f.save(); }],
      ["wrong source", f => { f.records[0].payload.thread_source = "desktop"; f.save(); }],
      ["wrong thread id", f => { f.records[0].payload.id = crypto.randomUUID(); f.save(); }],
      ["reused thread unfinished turn", f => { f.records.push({ ...f.records[1], payload: { type: "task_started", turn_id: "reused-turn" } }); f.save(); }],
      ["second same-workspace thread", f => {
        const otherId = crypto.randomUUID(), records = f.records.map(record => ({ ...record, payload: { ...record.payload } }));
        records[0].payload.id = otherId;
        fs.writeFileSync(path.join(f.sessions, `rollout-${f.stamp}-${otherId}.jsonl`), records.map(record => JSON.stringify(record)).join("\n") + "\n");
      }],
      ["filename outside creation scope", f => { fs.renameSync(f.rollout, path.join(f.sessions, `rollout-2000-01-01T00-00-00-${f.threadId}.jsonl`)); }],
      ["metadata outside creation scope", f => { f.records[0].timestamp = new Date(f.createdAtMs + 61_000).toISOString(); f.save(); }],
      ["future completion", f => { f.records[2].timestamp = new Date(Date.now() + 120_000).toISOString(); f.save(); }],
      ["workspace reused after completion", f => { const future = new Date(Date.now() + 120_000); fs.utimesSync(f.workspace, future, future); }],
      ["native modified after completion", f => { const future = new Date(Date.now() + 120_000); fs.utimesSync(f.native, future, future); }],
      ["out modified after completion", f => { const future = new Date(Date.now() + 120_000); fs.utimesSync(f.out, future, future); }],
      ["raw hash differs", f => { fs.appendFileSync(`${f.outStem}.png`, "changed"); }],
      ["workspace hash differs", f => { fs.appendFileSync(f.out, "changed"); }],
      ["native hash differs", f => { fs.appendFileSync(f.native, "changed"); }],
      ["native missing in exact thread", f => { fs.renameSync(f.nativeDirectory, `${f.nativeDirectory}-other-thread`); }],
      ["multiple actual outputs", f => { fs.writeFileSync(path.join(f.nativeDirectory, "second.png"), Buffer.concat([PNG, Buffer.from("second")])); }],
      ["incomplete native copy", f => { fs.writeFileSync(path.join(f.nativeDirectory, "partial.png"), "partial"); }],
      ["raw-only unknown second attempt", f => { fs.mkdirSync(`${f.outStem}.codex-2`); }],
      ...[".codex-submission.json", ".checkpoint.jsonl", ".lock", ".lock.recovery", ".resolution.lock", ".resolution.lock.recovery"].map(extension =>
        [extension, (f: ReturnType<typeof legacyFixture>) => fs.writeFileSync(`${f.outStem}${extension}`, "uncertain")] as [string, (f: ReturnType<typeof legacyFixture>) => void]),
    ];
    for (const [name, mutate] of uncertainLegacy) {
      const f = legacyFixture();
      assert.ok(f.probe(), `${name}: starts from a proven completed fixture`);
      mutate(f);
      assert.equal(f.probe(), null, `${name}: absence/ambiguity remains uncertain and preserves existing requests`);
    }
    // 0. Policy: default engine is Codex, model label is gpt-image-2, env can switch back to browser.
    assert.equal((draftRuntimePolicy as Record<string, string>).BRAND_POST_IMAGE_ENGINE, "codex");
    assert.equal(resolveBrandPostImageEngine({}), "codex");
    assert.equal(resolveBrandPostImageEngine({ BRAND_POST_IMAGE_ENGINE: "browser" }), "browser");
    assert.equal(CODEX_IMAGE_MODEL_LABEL, "gpt-image-2");
    assert.match(buildCodexImageInstruction("P", 0), /이미지 생성 도구\(image_generation\)/u);
    assert.match(buildCodexImageInstruction("P", 2), /첨부한 2장은 장소 분위기 참고용/u);
    assert.match(buildCodexImageInstruction("P", 2, "product"), /실제 참조 이미지로 모두 전달/u);
    assert.doesNotMatch(buildCodexImageInstruction("P", 2, "product"), /글자·로고를 옮기지/u);
    assert.match(buildCodexImageInstruction("P", 1, "product"), /정확히 1회만 호출/u);
    assert.match(buildCodexImageInstruction("P", 1, "product"), /content\[\].*가정하지/u);
    assert.match(buildCodexImageInstruction("P", 1, "product"), /image_url, output_hint/u);
    assert.match(buildCodexImageInstruction("P", 1, "product"), /추가 생성 없이 실패/u);
    assert.match(buildCodexImageInstruction("P", 1, "product"), /기존 생성 결과의 파일 경로 확인과 out.png로의 파일 복사/u);

    // Product references reach the SDK as actual ordered local_image attachments.
    const source = path.join(root, "source.png"), acceptedAnchor = path.join(root, "anchor.png");
    fs.writeFileSync(source, PNG); fs.writeFileSync(acceptedAnchor, Buffer.concat([PNG, Buffer.from("anchor")]));
    const refs = [source, acceptedAnchor];
    const productJob = job("product", { referenceMode: "product", referenceImagePaths: refs,
      requiredReferenceHashes: refs.map(file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")) });
    const productCodex = mockCodex(() => "workspace", codexHome);
    let generatedOnlyQc = 0;
    const productResults = await runCodexImageBatch([productJob], { createCodex: productCodex.create, codexHome,
      runQc: async () => { generatedOnlyQc += 1; return ["text"]; }, onResult: async () => {} });
    assert.ok(productResults[0].localPath);
    assert.deepEqual((productCodex.inputs[0] as Array<{ type: string; path?: string }>).filter(item => item.type === "local_image").map(item => item.path), refs);
    assert.equal(generatedOnlyQc, 0, "a generated-only checklist cannot approve/regenerate reference product scenes");
    fs.writeFileSync(source, Buffer.concat([PNG, Buffer.from("changed")]));
    const changedReference = await runCodexImageBatch([productJob], { createCodex: productCodex.create, codexHome, onResult: async () => {} });
    assert.equal(changedReference[0].localPath, null, "even a cached output cannot hide changed required references");
    assert.match(changedReference[0].error!, /PRODUCT_REFERENCE_CHANGED/);
    assert.equal(productCodex.threads.length, 1, "reference mutation never triggers another generation");
    const offlineReference = await runCodexImageBatch([productJob], { createCodex: async () => { throw new Error("SDK unavailable"); },
      codexHome, onResult: async () => {} });
    assert.match(offlineReference[0].error!, /PRODUCT_REFERENCE_CHANGED/, "SDK setup failure cannot bypass reference integrity on cached outputs");

    // A path-only second generation must not replace the requested product image, even via out.png.
    const strictProductJob = (id: string) => job(id, { referenceMode: "product", referenceImagePaths: [acceptedAnchor],
      requiredReferenceHashes: [crypto.createHash("sha256").update(fs.readFileSync(acceptedAnchor)).digest("hex")] });
    const ambiguousHome = path.join(root, "ambiguous-home"), ambiguousJob = strictProductJob("ambiguous-product");
    const ambiguousCodex = mockCodex(() => "ambiguous", ambiguousHome);
    const [ambiguous] = await runCodexImageBatch([ambiguousJob], { createCodex: ambiguousCodex.create, codexHome: ambiguousHome, onResult: async () => {} });
    assert.equal(ambiguous.localPath, null);
    assert.match(ambiguous.error!, /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.equal(ambiguous.submissionState, "uncertain");
    assert.equal(fs.existsSync(`${ambiguousJob.outStem}.png`), false, "an ambiguous second output is never adopted");
    const observedReceipt = JSON.parse(fs.readFileSync(`${ambiguousJob.outStem}.codex-submission.json`, "utf8"));
    assert.equal(observedReceipt.state, "completed", "the actual completion event persists even when output selection is ambiguous");
    assert.ok(observedReceipt.completedAtMs >= observedReceipt.startedAtMs);
    const observedSet = collectCompletedProductCandidates(ambiguousJob, { codexHome: ambiguousHome });
    assert.equal(observedSet?.candidates.length, 2, "both real outputs remain available for strict coordinator QA");
    const ambiguousOut = path.join(`${ambiguousJob.outStem}.codex-1`, "out.png");
    assert.ok(fs.existsSync(ambiguousOut), "preserve the provider's files for reconciliation");
    const [ambiguousResume] = await runCodexImageBatch([ambiguousJob], { createCodex: ambiguousCodex.create, codexHome: ambiguousHome, onResult: async () => {} });
    assert.match(ambiguousResume.error!, /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.equal(ambiguousResume.submissionState, "uncertain");
    assert.equal(ambiguousCodex.threads.length, 1, "uncertain recovery never invokes generation again");

    // Previously adopted bad raw output is also checked against its original receipt, including offline reuse.
    fs.copyFileSync(ambiguousOut, `${ambiguousJob.outStem}.png`);
    const cachedHash = crypto.createHash("sha256").update(fs.readFileSync(`${ambiguousJob.outStem}.png`)).digest("hex");
    const [cachedAmbiguous] = await runCodexImageBatch([ambiguousJob], { createCodex: ambiguousCodex.create, codexHome: ambiguousHome, onResult: async () => {} });
    assert.equal(cachedAmbiguous.localPath, null);
    assert.match(cachedAmbiguous.error!, /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.equal(cachedAmbiguous.submissionState, "uncertain");
    assert.equal(ambiguousCodex.threads.length, 1);
    const [offlineAmbiguous] = await runCodexImageBatch([ambiguousJob], { createCodex: async () => { throw new Error("SDK unavailable"); },
      codexHome: ambiguousHome, onResult: async () => {} });
    assert.equal(offlineAmbiguous.localPath, null);
    assert.match(offlineAmbiguous.error!, /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.equal(offlineAmbiguous.submissionState, "uncertain");
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(`${ambiguousJob.outStem}.png`)).digest("hex"), cachedHash, "do not discard or overwrite an ambiguous cached raw");

    // An explicit engine switch cannot turn the same ambiguous raw into an accepted browser result.
    const savedImageEngine = process.env.BRAND_POST_IMAGE_ENGINE, savedCodexHome = process.env.CODEX_HOME;
    let explicitBrowserCalls = 0, explicitCodexCalls = 0;
    const explicitBrowserResults: Array<{ localPath: string | null; error?: string }> = [];
    try {
      process.env.BRAND_POST_IMAGE_ENGINE = "browser";
      process.env.CODEX_HOME = ambiguousHome;
      await runImageBatch([ambiguousJob], root, async (result) => { explicitBrowserResults.push(result); }, undefined, {
        browserEnabled: true,
        runBrowser: async () => { explicitBrowserCalls += 1; throw new Error("ambiguous raw must never reach the browser"); },
        runCodex: async () => { explicitCodexCalls += 1; throw new Error("an explicit browser engine must not invoke Codex"); },
      });
    } finally {
      if (savedImageEngine === undefined) delete process.env.BRAND_POST_IMAGE_ENGINE;
      else process.env.BRAND_POST_IMAGE_ENGINE = savedImageEngine;
      if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = savedCodexHome;
    }
    assert.equal(explicitBrowserCalls, 0);
    assert.equal(explicitCodexCalls, 0);
    assert.equal(explicitBrowserResults.length, 1);
    assert.equal(explicitBrowserResults[0].localPath, null);
    assert.match(explicitBrowserResults[0].error!, /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(`${ambiguousJob.outStem}.png`)).digest("hex"), cachedHash);

    // Copies of one generated image are one result; other threads and pre-request outputs are excluded.
    const duplicateHome = path.join(root, "duplicate-home"), duplicateJob = strictProductJob("duplicate-product");
    const otherThread = path.join(duplicateHome, "generated_images", "unrelated-thread");
    fs.mkdirSync(otherThread, { recursive: true });
    fs.writeFileSync(path.join(otherThread, "foreign.png"), Buffer.concat([PNG, Buffer.from("different product")]));
    const duplicateCodex = mockCodex(() => "duplicate", duplicateHome);
    const [deduplicated] = await runCodexImageBatch([duplicateJob], { createCodex: duplicateCodex.create, codexHome: duplicateHome, onResult: async () => {} });
    assert.equal(deduplicated.localPath, `${duplicateJob.outStem}.png`);
    assert.ok(fs.readFileSync(deduplicated.localPath!).equals(PNG));
    const duplicateReceipt = JSON.parse(fs.readFileSync(`${duplicateJob.outStem}.codex-submission.json`, "utf8"));
    const oldFile = path.join(duplicateHome, "generated_images", duplicateReceipt.threadId, "pre-request.png");
    fs.writeFileSync(oldFile, Buffer.concat([PNG, Buffer.from("old image")]));
    fs.utimesSync(oldFile, new Date(duplicateReceipt.startedAtMs - 5000), new Date(duplicateReceipt.startedAtMs - 5000));
    const [deduplicatedResume] = await runCodexImageBatch([duplicateJob], { createCodex: duplicateCodex.create, codexHome: duplicateHome, onResult: async () => {} });
    assert.equal(deduplicatedResume.localPath, deduplicated.localPath);
    assert.equal(duplicateCodex.threads.length, 1, "same-byte copies remain safely reusable");
    const duplicateNative = path.dirname(oldFile);
    fs.copyFileSync(acceptedAnchor, path.join(duplicateNative, "reference-copy.png"));
    const future = path.join(duplicateNative, "after-request.png");
    fs.writeFileSync(future, Buffer.concat([PNG, Buffer.from("future unrelated output")]));
    fs.utimesSync(future, new Date(duplicateReceipt.completedAtMs + 5000), new Date(duplicateReceipt.completedAtMs + 5000));
    fs.writeFileSync(path.join(`${duplicateJob.outStem}.codex-1`, "qc-helper.png"), Buffer.concat([PNG, Buffer.from("workspace helper")]));
    const oneNative = collectCompletedProductCandidates(duplicateJob, { codexHome: duplicateHome });
    assert.equal(oneNative?.candidates.length, 1, "reference copies, workspace helpers, prior/future outputs and unrelated threads are excluded");
    assert.equal(oneNative?.candidates[0].sha256, crypto.createHash("sha256").update(PNG).digest("hex"));
    assert.throws(() => collectCompletedProductCandidates({ ...duplicateJob, requiredReferenceHashes: ["0".repeat(64)] }, { codexHome: duplicateHome }), /PRODUCT_REFERENCE_CHANGED/);

    // A terminal event is evidence; EOF, failure, or timeout after files appear is not.
    for (const mode of ["eof", "failed", "timeout"] as const) {
      const pendingHome = path.join(root, `${mode}-home`), pendingJob = strictProductJob(`${mode}-product`);
      const pendingCodex = mockCodex(() => mode, pendingHome);
      const [first] = await runCodexImageBatch([pendingJob], { createCodex: pendingCodex.create, codexHome: pendingHome,
        ...(mode === "timeout" ? { jobTimeoutMs: 1 } : {}), onResult: async () => {} });
      assert.equal(first.localPath, null); assert.equal(first.submissionState, "uncertain");
      const receipt = JSON.parse(fs.readFileSync(`${pendingJob.outStem}.codex-submission.json`, "utf8"));
      assert.equal(receipt.state, "submitting"); assert.equal(receipt.completedAtMs, undefined);
      assert.throws(() => collectCompletedProductCandidates(pendingJob, { codexHome: pendingHome }), /IMAGE_RESUME_REQUIRED/);
      const [retry] = await runCodexImageBatch([pendingJob], { createCodex: pendingCodex.create, codexHome: pendingHome, onResult: async () => {} });
      assert.equal(retry.localPath, null); assert.match(retry.error!, /IMAGE_RESUME_REQUIRED/);
      assert.equal(pendingCodex.threads.length, 1, `${mode}: no adoption and no extra generation`);
      const native = path.join(pendingHome, "generated_images", receipt.threadId, "ig_1.png");
      fs.copyFileSync(native, `${pendingJob.outStem}.png`);
      const [cached] = await runCodexImageBatch([pendingJob], { createCodex: async () => { throw new Error("SDK offline"); }, codexHome: pendingHome, onResult: async () => {} });
      assert.equal(cached.localPath, null); assert.match(cached.error!, /IMAGE_RESUME_REQUIRED/);
      assert.equal(cached.submissionState, "uncertain");
    }
    for (const mode of ["late-auth", "late-model"] as const) {
      const lateHome = path.join(root, `${mode}-home`), lateJob = strictProductJob(`${mode}-product`);
      const lateCodex = mockCodex(() => mode, lateHome);
      const [first] = await runCodexImageBatch([lateJob], { createCodex: lateCodex.create, codexHome: lateHome, onResult: async () => {} });
      assert.equal(first.localPath, null); assert.equal(first.submissionState, "uncertain");
      assert.equal(JSON.parse(fs.readFileSync(`${lateJob.outStem}.codex-submission.json`, "utf8")).state, "submitting");
      let browserCalls = 0;
      await runImageBatch([lateJob], root, async result => { assert.equal(result.localPath, null); }, undefined, {
        runCodex: (jobs, options) => runCodexImageBatch(jobs, { ...options, createCodex: lateCodex.create, codexHome: lateHome }),
        runBrowser: async () => { browserCalls++; throw new Error("late provider failure cannot authorize new generation"); }, browserEnabled: true,
      });
      assert.equal(browserCalls, 0); assert.equal(lateCodex.threads.length, 1);
    }
    for (const submissionState of [undefined, "uncertain", "not-submitted"] as const) {
      const guardedProduct = strictProductJob(`fallback-${submissionState}`); let browserCalls = 0;
      const outputs: Array<{ localPath: string | null }> = [];
      await runImageBatch([guardedProduct], root, async result => { outputs.push(result); }, undefined, {
        runCodex: async (jobs, options) => {
          const result = { id: jobs[0].id, localPath: null, submissionState, error: "CODEX_AUTH_REQUIRED: login interrupted" };
          await options.onResult(result, 0); return [result];
        },
        runBrowser: async (jobs, _workDir, onResult) => {
          browserCalls++; const result = { id: jobs[0].id, localPath: null, error: "offline fixture browser" };
          await onResult(result, 0); return [result];
        }, browserEnabled: true,
      });
      assert.equal(browserCalls, submissionState === "not-submitted" ? 1 : 0, "product fallback requires explicit pre-admission proof, not an auth error label");
      assert.equal(outputs.length, 1); assert.equal(outputs[0].localPath, null);
    }

    // Review-only recovery belongs to the coordinator, never to this generation transport.
    const reviewOnlyJob: ImageBatchJob = { ...duplicateJob, reviewOnly: {
      outputSha256: crypto.createHash("sha256").update(PNG).digest("hex"), slotId: "section:image:1",
      sourceSnapshotId: "verified-snapshot", referenceHashes: duplicateJob.requiredReferenceHashes!,
    } };
    const guardedCodex = mockCodex(() => "workspace", path.join(root, "review-only-home"));
    let guardedSdkSetups = 0, guardedDeliveries = 0;
    const guardedCreate = async () => { guardedSdkSetups += 1; return guardedCodex.create(); };
    const [reviewOnlyDirect] = await runCodexImageBatch([reviewOnlyJob], { createCodex: guardedCreate,
      onResult: async () => { guardedDeliveries += 1; } });
    assert.equal(reviewOnlyDirect.localPath, null);
    assert.match(reviewOnlyDirect.error!, /IMAGE_RESUME_REQUIRED/);
    assert.equal(reviewOnlyDirect.submissionState, "uncertain");
    assert.equal(guardedSdkSetups, 0, "review-only input must not initialize the generation SDK");
    assert.equal(guardedCodex.threads.length, 0);
    assert.equal(guardedDeliveries, 1);
    const mixedRecovery = await runCodexImageBatch([reviewOnlyJob, job("fresh-beside-review-only")], { createCodex: guardedCreate,
      qc: false, onResult: async () => {} });
    assert.equal(mixedRecovery[0].localPath, null);
    assert.match(mixedRecovery[0].error!, /IMAGE_RESUME_REQUIRED/);
    assert.ok(mixedRecovery[1].localPath);
    assert.equal(guardedSdkSetups, 1);
    assert.equal(guardedCodex.threads.length, 1, "a mixed batch may generate only its fresh job");

    // A restored partial submission with multiple provider images cannot take the last file or start a new thread.
    const partialHome = path.join(root, "partial-home"), partialJob = strictProductJob("partial-product");
    const partialWorkspace = `${partialJob.outStem}.codex-1`, partialThread = "partial-thread", partialStartedAt = Date.now();
    fs.mkdirSync(partialWorkspace, { recursive: true });
    const partialGenerated = path.join(partialHome, "generated_images", partialThread);
    fs.mkdirSync(partialGenerated, { recursive: true });
    fs.writeFileSync(path.join(partialGenerated, "first.png"), PNG);
    fs.writeFileSync(path.join(partialGenerated, "last.png"), Buffer.concat([PNG, Buffer.from("second image")]));
    fs.writeFileSync(`${partialJob.outStem}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: partialWorkspace,
      threadId: partialThread, startedAtMs: partialStartedAt }));
    const partialCodex = mockCodex(() => "workspace", partialHome);
    const [partialResume] = await runCodexImageBatch([partialJob], { createCodex: partialCodex.create, codexHome: partialHome, onResult: async () => {} });
    assert.equal(partialResume.localPath, null);
    assert.match(partialResume.error!, /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.equal(partialResume.submissionState, "uncertain");
    assert.equal(partialCodex.threads.length, 0, "partial ambiguity is resolved only by reading original artifacts");
    assert.equal(fs.existsSync(`${partialJob.outStem}.png`), false);
    assert.throws(() => locateCodexImage(partialWorkspace, partialHome, partialThread, partialStartedAt, { referenceMode: "product" }), /IMAGE_OUTPUT_AMBIGUOUS/);
    assert.ok(locateCodexImage(partialWorkspace, partialHome, partialThread, partialStartedAt), "generic transport retains its existing latest-file fallback");

    // 1. Thread isolation + result collection (workspace out.png, then generated_images/<threadId>).
    const codex = mockCodex((_, call) => (call === 1 ? "workspace" : "generated"), codexHome);
    const delivered: Array<[ImageBatchResult, number]> = [];
    const results = await runCodexImageBatch([job("a"), job("b")], {
      createCodex: codex.create, codexHome, qc: false, concurrency: 1,
      onResult: async (result, index) => { delivered.push([result, index]); },
    });
    assert.deepEqual(results.map((result) => result.localPath), [path.join(root, "raw-a.png"), path.join(root, "raw-b.png")]);
    assert.ok(results.every((result) => fs.readFileSync(result.localPath!).equals(PNG)));
    assert.equal(delivered.length, 2);
    for (const options of codex.threads) {
      assert.equal(options.sandboxMode, "workspace-write");
      assert.equal(options.networkAccessEnabled, false);
      assert.equal(options.approvalPolicy, "never");
      assert.equal(options.webSearchMode, "disabled");
      assert.match(String(options.workingDirectory), /raw-[ab]\.codex-1$/u, "each job writes only inside its own folder");
    }
    assert.match(codex.prompts[0]!, /\[이미지 프롬프트\]\nPROMPT-a/u);

    // 2. Resume: an existing result is reused without opening a thread.
    const resumed = mockCodex(() => "workspace", codexHome);
    const again = await runCodexImageBatch([job("a")], { createCodex: resumed.create, codexHome, qc: false, onResult: async () => {} });
    assert.equal(again[0]!.localPath, path.join(root, "raw-a.png"));
    assert.equal(resumed.threads.length, 0);

    // 3. Concurrency is capped at 3.
    const busy = mockCodex(() => "workspace", codexHome);
    await runCodexImageBatch(["c1", "c2", "c3", "c4", "c5"].map((id) => job(id)), { createCodex: busy.create, codexHome, qc: false, onResult: async () => {} });
    assert.equal(busy.threads.length, 5);
    assert.equal(busy.peak(), 3);

    // 4. Login failure is classified and reported; missing image is a clear error.
    const denied = mockCodex(() => "auth", codexHome);
    const [auth] = await runCodexImageBatch([job("d")], { createCodex: denied.create, codexHome, qc: false, onResult: async () => {} });
    assert.equal(auth!.localPath, null);
    assert.match(auth!.error!, /^CODEX_IMAGE_FAILED\(CODEX_AUTH_REQUIRED\)/u);
    assert.match(auth!.error!, /Codex 로그인을 확인/u);
    const empty = mockCodex(() => "nothing", codexHome);
    const [none] = await runCodexImageBatch([job("e")], { createCodex: empty.create, codexHome, qc: false, onResult: async () => {} });
    assert.match(none!.error!, /생성 이미지를 찾지 못했습니다/u);
    assert.equal(none.submissionState, "uncertain");
    const [uncertainRetry] = await runCodexImageBatch([job("e")], { createCodex: empty.create, codexHome, qc: false, onResult: async () => {} });
    assert.match(uncertainRetry.error!, /IMAGE_RESUME_REQUIRED/);
    assert.equal(empty.threads.length, 1, "missing provider output never silently submits another paid request");

    // 5. QC: a failed checklist item triggers exactly one reinforced regeneration; leftovers become warnings.
    const qcCodex = mockCodex(() => "workspace", codexHome);
    let qcCalls = 0;
    const [checked] = await runCodexImageBatch([job("f")], {
      createCodex: qcCodex.create, codexHome, qc: true,
      runQc: async () => { qcCalls += 1; return ["shadow-direction"]; },
      onResult: async () => {},
    });
    assert.equal(qcCodex.threads.length, 2, "one regeneration only");
    assert.equal(qcCalls, 2);
    assert.match(qcCodex.prompts[1]!, /Reinforce \(previous attempt missed these\): All shadows fall in one direction/u);
    assert.ok(qcCodex.prompts[1]!.includes("PROMPT-f"), "the base prompt is kept, only reinforced");
    assert.deepEqual(checked!.qcWarnings, ["shadow-direction"]);
    assert.ok(checked!.localPath);
    const passing = mockCodex(() => "workspace", codexHome);
    const [clean] = await runCodexImageBatch([job("g")], { createCodex: passing.create, codexHome, qc: true, runQc: async () => [], onResult: async () => {} });
    assert.equal(passing.threads.length, 1);
    assert.equal(clean!.qcWarnings, undefined);
    const broken = mockCodex(() => "workspace", codexHome);
    await runCodexImageBatch([job("h")], { createCodex: broken.create, codexHome, qc: true, runQc: async () => { throw new Error("vision down"); }, onResult: async () => {} });
    assert.equal(broken.threads.length, 1, "a QC outage never triggers regeneration");

    // 6. Dispatcher: Codex first, failed jobs fall back to the browser, browser-submitted jobs resume in the browser.
    const jobs = [job("ok"), job("fail"), job("resume")];
    fs.writeFileSync(`${jobs[2]!.outStem}.checkpoint.jsonl`, "{}\n");
    const codexSeen: string[] = [];
    const browserSeen: string[] = [];
    const final = new Map<number, { localPath: string | null; error?: string }>();
    const fakeCodex: typeof runCodexImageBatch = async (subset, options) => {
      codexSeen.push(...subset.map((item) => item.id));
      const out = subset.map((item) => item.id === "fail"
        ? { id: item.id, localPath: null, error: "CODEX_IMAGE_FAILED(CODEX_AUTH_REQUIRED): login required" }
        : { id: item.id, localPath: `${item.outStem}.png` });
      for (const [index, result] of out.entries()) await options.onResult(result, index);
      return out;
    };
    const fakeBrowser = async (subset: ImageBatchJob[], _workDir: string, onResult: (result: { id: string; localPath: string | null; error?: string }, index: number) => Promise<void>) => {
      browserSeen.push(...subset.map((item) => item.id));
      const out = subset.map((item) => item.id === "fail"
        ? { id: item.id, localPath: null, error: "CHATGPT_BROWSER_AUTH_REQUIRED" }
        : { id: item.id, localPath: `${item.outStem}.webp` });
      for (const [index, result] of out.entries()) await onResult(result, index);
      return out;
    };
    await runImageBatch(jobs, root, async (result, index) => { final.set(index, result); }, undefined,
      { runCodex: fakeCodex, runBrowser: fakeBrowser, browserEnabled: true });
    assert.deepEqual(codexSeen, ["ok", "fail"]);
    assert.deepEqual(browserSeen.sort(), ["fail", "resume"]);
    assert.equal(final.get(0)!.localPath, `${jobs[0]!.outStem}.png`);
    assert.equal(final.get(2)!.localPath, `${jobs[2]!.outStem}.webp`, "results map back to the original slot index");
    assert.match(final.get(1)!.error!, /CODEX_AUTH_REQUIRED.*브라우저 대체: CHATGPT_BROWSER_AUTH_REQUIRED/u);
    browserSeen.length = 0;
    final.clear();
    await runImageBatch([job("fail")], root, async (result, index) => { final.set(index, result); }, undefined,
      { runCodex: fakeCodex, runBrowser: fakeBrowser, browserEnabled: false });
    assert.equal(browserSeen.length, 0, "no browser fallback when browser automation is off");
    assert.match(final.get(0)!.error!, /^CODEX_IMAGE_FAILED/u);
    browserSeen.length = 0;
    final.clear();
    const uncertainCodex: typeof runCodexImageBatch = async (subset, options) => {
      const results: ImageBatchResult[] = subset.map(item => ({ id: item.id, localPath: null, submissionState: "uncertain", error: "Codex response timed out" }));
      for (const [index, result] of results.entries()) await options.onResult(result, index);
      return results;
    };
    await runImageBatch([job("uncertain")], root, async (result, index) => { final.set(index, result); }, undefined,
      { runCodex: uncertainCodex, runBrowser: fakeBrowser, browserEnabled: true });
    assert.equal(browserSeen.length, 0, "ambiguous Codex submission cannot fall back into a duplicate browser request");
    assert.match(final.get(0)!.error!, /IMAGE_RESUME_REQUIRED/);
    const late = path.join(root, "raw-e.codex-1", "out.png");
    fs.writeFileSync(late, PNG);
    const [recovered] = await runCodexImageBatch([job("e")], { createCodex: empty.create, codexHome, qc: false, onResult: async () => {} });
    assert.ok(recovered.localPath, "late output from the original request is recovered without regeneration");
    assert.equal(empty.threads.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("PASS: codex image policy, product output ambiguity/cache/recovery guards, thread isolation, result collection, resume, concurrency 3, auth classification, QC single retry, browser fallback");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

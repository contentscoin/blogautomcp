/** Single-generation execution regressions; no live SDK/network/media generation. Included by test:codex-image. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { checkedExistingJobResult, collectCompletedProductCandidates, locateCodexImage, runCodexImageBatch } from "../src/lib/codex-image-generation";

export async function verifyCodexSingleGeneration(root: string, reference: string): Promise<void> {
  const png = Buffer.concat([fs.readFileSync(reference), Buffer.from("new generated pixels")]);
  type Context = { signal: AbortSignal; workspace: string; threadId: string; nativeDirectory: string; home: string };
  type Scenario = (context: Context) => AsyncGenerator<Record<string, unknown>>;
  const fixture = (name: string, scenario: Scenario) => {
    const home = path.join(root, `single-guard-${name}-home`), outStem = path.join(root, `single-guard-${name}`);
    const job = { id: name, prompt: "one natural product photograph", outStem, referenceMode: "product" as const,
      referenceImagePaths: [reference], requiredReferenceHashes: [crypto.createHash("sha256").update(fs.readFileSync(reference)).digest("hex")] };
    let threads = 0, lastSignal: AbortSignal | undefined;
    const createCodex = async () => ({ startThread(options: Record<string, unknown>) {
      threads++;
      return { async runStreamed(_input: unknown, runOptions?: { signal?: AbortSignal }) {
        const signal = runOptions!.signal!; lastSignal = signal;
        const context = { signal, workspace: String(options.workingDirectory), threadId: `guard-${name}`, home,
          nativeDirectory: path.join(home, "generated_images", `guard-${name}`) };
        return { events: (async function* () {
          yield { type: "thread.started", thread_id: context.threadId };
          yield* scenario(context);
        })() };
      } };
    } });
    const run = (extra: { jobTimeoutMs?: number; signal?: AbortSignal } = {}) => runCodexImageBatch([job], {
      createCodex, codexHome: home, onResult: async () => {}, ...extra,
    }).then(results => results[0]);
    return { home, job, run, threads: () => threads, signal: () => lastSignal,
      receipt: () => JSON.parse(fs.readFileSync(`${outStem}.codex-submission.json`, "utf8")) };
  };
  const writeNative = (context: Context, suffix = "") => {
    fs.mkdirSync(context.nativeDirectory, { recursive: true });
    const file = path.join(context.nativeDirectory, `native${suffix}.png`);
    fs.writeFileSync(file, suffix ? Buffer.concat([png, Buffer.from(suffix)]) : png);
    return file;
  };
  const call = (id: string, type = "item.started", tool = "imagegen", args: unknown = {}) => ({ type,
    item: { id, type: "mcp_tool_call", server: "image_gen", tool, arguments: args, status: type === "item.completed" ? "completed" : "in_progress" } });

  let continuedAfterSecond = false;
  const second = fixture("second", async function* (context) {
    yield call("first"); writeNative(context);
    yield call("first", "item.completed");
    yield call("second");
    continuedAfterSecond = true;
    writeNative(context, "second"); yield { type: "turn.completed" };
  });
  const secondResult = await second.run();
  assert.match(secondResult.error!, /IMAGE_GENERATION_BUDGET_EXCEEDED/);
  assert.equal(second.signal()!.aborted, true);
  assert.equal(continuedAfterSecond, false, "observer stops consuming after the already-observed second dispatch");
  assert.equal(secondResult.localPath, null); assert.equal(secondResult.submissionState, "uncertain");
  assert.equal(secondResult.recoveryState, "uncertain");
  assert.equal(second.receipt().state, "submitting"); assert.equal(second.receipt().generationBudget.observedCalls, 2);
  assert.throws(() => collectCompletedProductCandidates(second.job, { codexHome: second.home }), /IMAGE_RESUME_REQUIRED/);
  const afterStopped = await second.run();
  assert.equal(afterStopped.localPath, null); assert.equal(second.threads(), 1, "budget abort cannot submit another request");

  const duplicate = fixture("duplicate-id", async function* (context) {
    yield call("same"); yield call("same", "item.updated"); yield call("same", "item.completed");
    writeNative(context); yield { type: "turn.completed" };
  });
  assert.ok((await duplicate.run()).localPath, "one id with lifecycle updates is one call");
  assert.equal(duplicate.receipt().generationBudget.observedCalls, 1);
  assert.equal(duplicate.signal()!.aborted, false);

  const nested = fixture("literal-nested", async function* () {
    yield call("nested-exec", "item.started", "exec", { code: "await tools.image_gen__imagegen({prompt:'one'}); await tools.image_gen__imagegen({prompt:'again'});" });
    yield { type: "turn.completed" };
  });
  assert.match((await nested.run()).error!, /IMAGE_GENERATION_BUDGET_EXCEEDED/);
  assert.equal(nested.receipt().generationBudget.observedCalls, 2);

  const mention = fixture("mention", async function* (context) {
    yield call("one-exec", "item.started", "exec", { code: "text('tools.image_gen__imagegen({})'); // tools.image_gen__imagegen({})\nconst r = await tools.image_gen__imagegen({prompt:'only actual call'}); text(r.output_hint);" });
    writeNative(context); yield { type: "turn.completed" };
  });
  assert.ok((await mention.run()).localPath, "quoted tool names and comments are not actual calls");
  assert.equal(mention.receipt().generationBudget.observedCalls, 1);

  // Current SDK has no native-generation item type. An opaque/aliased nested call can escape observation:
  // outputs must still be ambiguous and recoverable only from proven completion, never a false zero-call guarantee.
  const opaque = fixture("opaque", async function* (context) {
    yield call("opaque-exec", "item.started", "exec", { code: "await hiddenGenerationWrapper(args)" });
    writeNative(context); writeNative(context, "second"); yield { type: "turn.completed" };
  });
  const opaqueResult = await opaque.run();
  assert.match(opaqueResult.error!, /IMAGE_OUTPUT_AMBIGUOUS/);
  assert.equal(opaqueResult.recoveryState, "completed-candidates");
  assert.equal(opaque.receipt().generationBudget.observation, "none");
  assert.equal(collectCompletedProductCandidates(opaque.job, { codexHome: opaque.home })!.candidates.length, 2);
  await opaque.run(); assert.equal(opaque.threads(), 1, "completed opaque ambiguity does not regenerate");

  const rollout = fixture("rollout", async function* (context) {
    const day = new Date().toISOString().slice(0, 10).split("-");
    const directory = path.join(context.home, "sessions", ...day); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `rollout-test-${context.threadId}.jsonl`);
    const meta = { type: "session_meta", payload: { id: context.threadId, cwd: context.workspace, thread_source: "blogautomcp-image" } };
    fs.writeFileSync(file, `${JSON.stringify(meta)}\n${JSON.stringify({ type: "response_item", payload: {
      type: "custom_tool_call", name: "exec", call_id: "rollout-one", input: "const r = await tools.image_gen__imagegen({prompt:'one'}); text(r.output_hint);" } })}\n`);
    writeNative(context);
    yield { type: "item.completed", item: { type: "agent_message", id: "message", text: "生成" } };
    fs.appendFileSync(file, `${JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call", name: "exec",
      call_id: "rollout-two", input: "await tools.image_gen__imagegen({prompt:'path lookup'});" } })}\n`);
    await new Promise(resolve => setTimeout(resolve, 350));
    yield { type: "turn.completed" };
  });
  assert.match((await rollout.run()).error!, /IMAGE_GENERATION_BUDGET_EXCEEDED/, "actual rollout exec shape supplements the incomplete SDK event union");
  assert.equal(rollout.receipt().generationBudget.observation, "rollout");

  const foreign = fixture("foreign-rollout", async function* (context) {
    const day = new Date().toISOString().slice(0, 10).split("-");
    const directory = path.join(context.home, "sessions", ...day); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `rollout-test-${context.threadId}.jsonl`), `${JSON.stringify({ type: "session_meta", payload: {
      id: context.threadId, cwd: path.join(context.workspace, "other"), thread_source: "blogautomcp-image" } })}\n${JSON.stringify({ type: "response_item", payload: {
      type: "custom_tool_call", name: "exec", call_id: "foreign", input: "await tools.image_gen__imagegen({}); await tools.image_gen__imagegen({});" } })}\n`);
    writeNative(context); yield { type: "turn.completed" };
  });
  assert.ok((await foreign.run()).localPath, "another workspace rollout cannot spend this request's budget");
  assert.equal(foreign.receipt().generationBudget.observation, "none");

  const shape = fixture("return-shape", async function* (context) {
    writeNative(context);
    fs.writeFileSync(path.join(context.workspace, "reference-copy.png"), fs.readFileSync(reference));
    fs.writeFileSync(path.join(context.workspace, "qc-helper.png"), Buffer.concat([png, Buffer.from("helper")]));
    yield { type: "item.completed", item: { id: "shape", type: "agent_message", text: "Could not read content[]; generated file exists but no out.png was copied." } };
    yield { type: "turn.completed" };
  });
  const shapeResult = await shape.run(); assert.ok(shapeResult.localPath);
  assert.equal(shape.threads(), 1, "host finds the native file without another model turn/path-copy generation");
  assert.deepEqual(fs.readFileSync(shapeResult.localPath!), png);
  assert.ok((await shape.run()).localPath, "new host-collected receipt still ignores helper photos when resuming cached output");
  assert.equal(shape.threads(), 1);
  const legacyReceipt = shape.receipt(); delete legacyReceipt.generationBudget;
  fs.writeFileSync(`${shape.job.outStem}.codex-submission.json`, JSON.stringify(legacyReceipt));
  assert.throws(() => checkedExistingJobResult(shape.job, { codexHome: shape.home, onResult: async () => {} }), /IMAGE_OUTPUT_AMBIGUOUS/,
    "legacy model-copy receipt retains workspace ambiguity; helper provenance cannot be guessed retrospectively");
  const legacyResult = await shape.run();
  assert.equal(legacyResult.localPath, null); assert.equal(shape.threads(), 1);
  legacyReceipt.generationBudget = { limit: 1, observedCalls: "malformed", observation: "none" };
  fs.writeFileSync(`${shape.job.outStem}.codex-submission.json`, JSON.stringify(legacyReceipt));
  assert.throws(() => checkedExistingJobResult(shape.job, { codexHome: shape.home, onResult: async () => {} }), /IMAGE_OUTPUT_AMBIGUOUS/,
    "malformed host-collection marker falls back to strict legacy ambiguity checks");
  const workspaceOnly = path.join(root, "non-output-workspace"); fs.mkdirSync(workspaceOnly);
  fs.writeFileSync(path.join(workspaceOnly, "not-a-generated-result.png"), png);
  assert.equal(locateCodexImage(workspaceOnly, root, null, Date.now(), { referenceMode: "product", includeLegacyWorkspace: false }), null,
    "arbitrary workspace photos are not generated outputs");

  for (const mode of ["timeout", "cancel"] as const) {
    const cancel = new AbortController();
    const interrupted = fixture(mode, async function* (context) {
      writeNative(context);
      if (mode === "cancel") cancel.abort();
      await new Promise(resolve => setTimeout(resolve, 30));
      yield { type: "turn.completed" };
    });
    const result = await interrupted.run({ ...(mode === "timeout" ? { jobTimeoutMs: 5 } : { signal: cancel.signal }) });
    assert.equal(result.localPath, null); assert.equal(result.submissionState, "uncertain");
    assert.equal(interrupted.receipt().state, "submitting");
    assert.throws(() => collectCompletedProductCandidates(interrupted.job, { codexHome: interrupted.home }), /IMAGE_RESUME_REQUIRED/);
    await interrupted.run(); assert.equal(interrupted.threads(), 1, `${mode} cannot become a second generation`);
  }
  const stalled = fixture("stalled-stream", async function* (context) {
    writeNative(context);
    await new Promise<never>(() => {}); // Simulate an SDK/provider stream which ignores AbortSignal.
    yield { type: "turn.completed" };
  });
  const deadlineStarted = Date.now();
  assert.equal((await stalled.run({ jobTimeoutMs: 5 })).localPath, null);
  assert.ok(Date.now() - deadlineStarted < 1000, "local deadline does not wait forever for a non-cooperative SDK stream");
  assert.equal(stalled.receipt().state, "submitting");
  await stalled.run(); assert.equal(stalled.threads(), 1);
  console.log("PASS: single-generation observation budget, duplicate ids, literal/opaque exec, scoped rollout, host output recovery, timeout/cancel and uncertain preservation");
}

/** Offline regressions for the Codex-login (gpt-image-2) image transport. The Codex SDK is mocked. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_IMAGE_MODEL_LABEL,
  buildCodexImageInstruction,
  resolveBrandPostImageEngine,
  runCodexImageBatch,
  type ImageBatchJob,
  type ImageBatchResult,
} from "../src/lib/codex-image-generation";
import { runImageBatch } from "../src/lib/brand-post-image-generation";
import draftRuntimePolicy from "./lib/draft-runtime-policy.json";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);

type Behaviour = "workspace" | "generated" | "nothing" | "auth";
function mockCodex(behaviour: (prompt: string, call: number) => Behaviour, codexHome: string) {
  const threads: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  let active = 0;
  let peak = 0;
  return {
    threads, prompts, peak: () => peak,
    create: async () => ({
      startThread(options: Record<string, unknown>) {
        threads.push(options);
        const call = threads.length;
        return {
          async runStreamed(input: unknown) {
            const text = typeof input === "string" ? input : (input as Array<{ type: string; text?: string }>).find((part) => part.type === "text")!.text!;
            prompts.push(text);
            const mode = behaviour(text, call);
            const threadId = `thread-${call}`;
            return {
              events: (async function* () {
                active += 1;
                peak = Math.max(peak, active);
                try {
                  yield { type: "thread.started", thread_id: threadId };
                  await new Promise((resolve) => setTimeout(resolve, 15));
                  if (mode === "auth") { yield { type: "turn.failed", error: { message: "401 Unauthorized: login required" } }; return; }
                  if (mode === "workspace") fs.writeFileSync(path.join(String(options.workingDirectory), "out.png"), PNG);
                  if (mode === "generated") {
                    const dir = path.join(codexHome, "generated_images", threadId);
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, "ig_1.png"), PNG);
                  }
                  yield { type: "item.completed", item: { type: "agent_message", text: "./out.png" } };
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
    // 0. Policy: default engine is Codex, model label is gpt-image-2, env can switch back to browser.
    assert.equal((draftRuntimePolicy as Record<string, string>).BRAND_POST_IMAGE_ENGINE, "codex");
    assert.equal(resolveBrandPostImageEngine({}), "codex");
    assert.equal(resolveBrandPostImageEngine({ BRAND_POST_IMAGE_ENGINE: "browser" }), "browser");
    assert.equal(CODEX_IMAGE_MODEL_LABEL, "gpt-image-2");
    assert.match(buildCodexImageInstruction("P", 0), /이미지 생성 도구\(image_generation\)/u);
    assert.match(buildCodexImageInstruction("P", 2), /첨부한 2장은 장소 분위기 참고용/u);

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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("PASS: codex image engine policy, thread isolation, result collection, resume, concurrency 3, auth classification, QC single retry, browser fallback");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

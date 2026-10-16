import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runImageBatch } from "../src/lib/brand-post-image-generation";
import type { ImageBatchJob } from "../src/lib/codex-image-generation";
import { SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION } from "./lib/shopping-reference-scene";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "completed-candidate-handoff-"));
  const previousHome = process.env.CODEX_HOME;
  const previousEngine = process.env.BRAND_POST_IMAGE_ENGINE;
  process.env.CODEX_HOME = path.join(root, "codex-home");
  process.env.BRAND_POST_IMAGE_ENGINE = "codex";
  const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  try {
    const ref = path.join(root, "reference.png");
    await sharp(crypto.randomBytes(80 * 80 * 3), { raw: { width: 80, height: 80, channels: 3 } }).png().toFile(ref);
    const job: ImageBatchJob = { id: "completed", prompt: "exact natural photo recipe", outStem: path.join(root, "raw"),
      referenceMode: "product", referenceImagePaths: [ref], requiredReferenceHashes: [sha(ref)] };
    const workspace = `${job.outStem}.codex-123`, thread = "completed-candidate-test";
    const native = path.join(process.env.CODEX_HOME!, "generated_images", thread);
    fs.mkdirSync(workspace); fs.mkdirSync(native, { recursive: true });
    const startedAtMs = Date.now() - 2000;
    for (let i = 0; i < 2; i++) await sharp(crypto.randomBytes(80 * 80 * 3), { raw: { width: 80, height: 80, channels: 3 } }).png().toFile(path.join(native, `candidate-${i}.png`));
    const receipt = { state: "completed", workspace, threadId: thread, startedAtMs, completedAtMs: Date.now() };
    fs.writeFileSync(`${job.outStem}.codex-submission.json`, JSON.stringify(receipt));
    const metadata = { strategyVersion: SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION,
      sceneRecipeSha256: crypto.createHash("sha256").update(job.prompt).digest("hex"),
      slotId: "section-test:image:1", sourceSnapshotId: "a".repeat(64), referenceHashes: job.requiredReferenceHashes };
    fs.writeFileSync(`${job.outStem}.reference-scene.json`, JSON.stringify(metadata));
    let browserCalls = 0, providerCalls = 0;
    const results: Array<{ id: string; localPath: string | null; error?: string; recoveryJob?: ImageBatchJob }> = [];
    const run = async (recoveryState: "completed-candidates" | "uncertain", signal?: AbortSignal) => {
      await runImageBatch([job], root, async result => { results.push(result); }, signal, {
        browserEnabled: true,
        runCodex: async (_jobs, options) => { providerCalls++; await options.onResult({ id: job.id, localPath: null,
          error: "IMAGE_OUTPUT_AMBIGUOUS: retained two outputs", submissionState: "uncertain", recoveryState }, 0); return []; },
        runBrowser: async () => { browserCalls++; return []; },
      });
    };
    await run("completed-candidates");
    assert.equal(results[0].recoveryJob?.reviewOnly?.candidateSet?.candidates.length, 2);
    assert.equal(results[0].localPath, null, "handoff does not select a photo without coordinator review");
    assert.equal(browserCalls, 0); assert.equal(providerCalls, 1);
    assert.equal(sha(path.join(native, "candidate-0.png")), results[0].recoveryJob!.reviewOnly!.candidateSet!.candidates[0].sha256);
    results.length = 0; await run("uncertain");
    assert.equal(results[0].recoveryJob, undefined); assert.match(results[0].error!, /IMAGE_RESUME_REQUIRED/u); assert.equal(browserCalls, 0);
    results.length = 0; fs.writeFileSync(`${job.outStem}.reference-scene.json`, JSON.stringify({ ...metadata, sceneRecipeSha256: "b".repeat(64) }));
    await run("completed-candidates"); assert.equal(results[0].recoveryJob, undefined); assert.match(results[0].error!, /IMAGE_RESUME_REQUIRED/u);
    fs.writeFileSync(`${job.outStem}.reference-scene.json`, JSON.stringify(metadata));
    results.length = 0; fs.writeFileSync(`${job.outStem}.codex-submission.json`, JSON.stringify({ ...receipt, state: "submitting", completedAtMs: undefined }));
    await run("completed-candidates"); assert.equal(results[0].recoveryJob, undefined); assert.match(results[0].error!, /IMAGE_RESUME_REQUIRED/u);
    fs.writeFileSync(`${job.outStem}.codex-submission.json`, JSON.stringify(receipt));
    results.length = 0; const cancelled = new AbortController(); cancelled.abort(); await run("completed-candidates", cancelled.signal);
    assert.equal(results[0].recoveryJob, undefined); assert.equal(browserCalls, 0);
    console.log("PASS completed-candidate handoff: 5 exact-recipe/completion/uncertain/cancel cases; no browser dispatch or implicit photo adoption");
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    if (previousEngine === undefined) delete process.env.BRAND_POST_IMAGE_ENGINE; else process.env.BRAND_POST_IMAGE_ENGINE = previousEngine;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

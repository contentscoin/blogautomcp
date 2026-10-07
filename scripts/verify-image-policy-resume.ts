/** Offline policy migration checks: no provider, browser, publication or database calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { prepareImageBatchJobs, resolveBrandPostImageBatchWorkDir, type ResolvedImageTarget } from "../src/lib/brand-post-image-generation";
import { REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import type { BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "image-policy-resume-"));
const digest = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const manifest = { brandLinkId: "offline-resume-fixture", connectKind: "SHOPPING", title: "바지",
  composition: { sections: [{ id: "scene", title: "코디" }] }, imageAssets: [],
  productUnderstanding: { version: "product-9canvas/v1", concept: {}, subject: {}, policy: {} },
  sourceSnapshot: { snapshotId: "fixture-snapshot" },
} as unknown as BrandPostPackageManifestV2;
let checks = 0;

async function main() {
  const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#8d967f" } }).png({ compressionLevel: 0 }).toBuffer();
  const referencePath = path.join(root, "reference.png");
  fs.writeFileSync(referencePath, image);
  const target = { request: { requestId: "scene", slotId: "scene:image:1", sectionId: "scene" }, sectionId: "scene",
    role: "body", sectionTitle: "코디", imageIntent: "자연스러운 실내 착용 사진", bodyExcerpt: "선택한 바지의 코디 설명",
    referenceContext: { prompt: "Photograph the referenced trousers in a natural room without frames or text.",
      referenceImagePaths: [referencePath], referenceHashes: [digest(image)] },
  } as unknown as ResolvedImageTarget;
  const snapshot = (dir: string) => Object.fromEntries(fs.readdirSync(dir).map(name => [name, digest(fs.readFileSync(path.join(dir, name)))]));

  function fixture(name: string) {
    const workRoot = path.join(root, name);
    const previousDir = path.join(workRoot, "resume-v1");
    fs.mkdirSync(previousDir, { recursive: true });
    const stem = path.join(previousDir, `raw-${"a".repeat(64)}`);
    fs.writeFileSync(`${stem}.reference-scene.json`, JSON.stringify({ strategyVersion: "shopping-reference-scene/v1", slotId: "scene:image:1" }));
    return { workRoot, previousDir, stem };
  }
  const journal = (stem: string, records: object[]) => fs.writeFileSync(`${stem}.checkpoint.jsonl`, records.map(value =>
    JSON.stringify({ id: "slot", fingerprint: "b".repeat(64), ...value })).join("\n") + "\n");
  const completed = (stem: string) => {
    fs.writeFileSync(`${stem}.png`, image);
    journal(stem, [{ state: "attempted" }, { state: "submitted" }, { localPath: `${stem}.png`, sha256: digest(image) }]);
  };
  const codex = (stem: string, state: string) => fs.writeFileSync(`${stem}.codex-submission.json`, JSON.stringify({
    state, workspace: path.dirname(stem), startedAtMs: 100, threadId: "fixture-thread" }));

  for (const [name, setup] of [
    ["browser-completed", completed],
    ["browser-presend-failed", (stem: string) => journal(stem, [{ state: "attempted" }, { localPath: null, retryable: true, error: "CHATGPT_BROWSER_AUTH_REQUIRED: login" }])],
    ["browser-refused", (stem: string) => journal(stem, [{ state: "submitted" }, { localPath: null, retryable: false, error: "IMAGE_PROVIDER_REFUSED: request refused" }])],
    ["codex-completed", (stem: string) => { fs.writeFileSync(`${stem}.png`, image); codex(stem, "completed"); }],
    ["codex-not-submitted", (stem: string) => codex(stem, "not-submitted")],
  ] as const) {
    const f = fixture(name);
    setup(f.stem);
    const before = snapshot(f.previousDir);
    const nextDir = resolveBrandPostImageBatchWorkDir("SHOPPING", f.workRoot);
    assert.equal(nextDir, path.join(f.workRoot, "resume-v2"), name);
    fs.mkdirSync(nextDir, { recursive: true });
    const [job] = prepareImageBatchJobs([target], manifest, "바지", nextDir);
    assert.equal(path.dirname(job.outStem), nextDir);
    assert.deepEqual(snapshot(f.previousDir), before, `${name}: all retired evidence remains byte-for-byte intact`);
    assert.doesNotThrow(() => prepareImageBatchJobs([target], manifest, "바지", f.previousDir), `${name}: mixed legacy directory accepts only settled earlier-policy jobs`);
    checks++;
  }

  for (const [name, setup] of [
    ["browser-attempted", (stem: string) => journal(stem, [{ state: "attempted" }])],
    ["browser-submitted", (stem: string) => journal(stem, [{ state: "submitted" }])],
    ["browser-uncertain-error", (stem: string) => journal(stem, [{ localPath: null, retryable: false, error: "IMAGE_TIMEOUT: unknown outcome" }])],
    ["browser-corrupt-tail", (stem: string) => { completed(stem); fs.appendFileSync(`${stem}.checkpoint.jsonl`, "{partial"); }],
    ["browser-empty-journal", (stem: string) => fs.writeFileSync(`${stem}.checkpoint.jsonl`, "")],
    ["browser-bad-output-hash", (stem: string) => { completed(stem); fs.appendFileSync(`${stem}.png`, "changed"); }],
    ["browser-missing-output", (stem: string) => journal(stem, [{ localPath: `${stem}.png`, sha256: digest(image) }])],
    ["browser-conflicting-fingerprints", (stem: string) => { completed(stem); fs.appendFileSync(`${stem}.checkpoint.jsonl`, JSON.stringify({ id: "slot", fingerprint: "c".repeat(64), localPath: null, retryable: true, error: "failed" })); }],
    ["browser-attempt-after-complete", (stem: string) => { completed(stem); fs.appendFileSync(`${stem}.checkpoint.jsonl`, JSON.stringify({ id: "slot", fingerprint: "b".repeat(64), state: "attempted" })); }],
    ["browser-submitted-then-presend-claim", (stem: string) => journal(stem, [{ state: "submitted" }, { localPath: null, retryable: true, error: "failed" }])],
    ["codex-submitting", (stem: string) => codex(stem, "submitting")],
    ["codex-submitting-with-raw", (stem: string) => { fs.writeFileSync(`${stem}.png`, image); codex(stem, "submitting"); }],
    ["codex-completed-missing-raw", (stem: string) => codex(stem, "completed")],
    ["codex-completed-invalid-raw", (stem: string) => { fs.writeFileSync(`${stem}.png`, Buffer.alloc(2048, "x")); codex(stem, "completed"); }],
    ["codex-incomplete-metadata", (stem: string) => { fs.writeFileSync(`${stem}.png`, image); fs.writeFileSync(`${stem}.codex-submission.json`, '{"state":"completed"}'); }],
    ["browser-complete-codex-uncertain", (stem: string) => { completed(stem); codex(stem, "submitting"); }],
    ["raw-only", (stem: string) => fs.writeFileSync(`${stem}.png`, image)],
    ["complete-but-locked", (stem: string) => { completed(stem); fs.writeFileSync(`${stem}.lock`, JSON.stringify({ pid: process.pid, token: "fixture" })); }],
    ["complete-recovery-lock", (stem: string) => { completed(stem); fs.writeFileSync(`${stem}.lock.recovery`, ""); }],
  ] as const) {
    const f = fixture(name);
    setup(f.stem);
    const before = snapshot(f.previousDir);
    assert.throws(() => resolveBrandPostImageBatchWorkDir("SHOPPING", f.workRoot), /IMAGE_RESUME_REQUIRED/, name);
    assert.throws(() => prepareImageBatchJobs([target], manifest, "바지", f.previousDir), /IMAGE_RESUME_REQUIRED/, name);
    assert.equal(fs.existsSync(path.join(f.workRoot, "resume-v2")), false, `${name}: no new job namespace created`);
    assert.deepEqual(snapshot(f.previousDir), before, `${name}: unresolved evidence is preserved`);
    assert.equal(resolveBrandPostImageBatchWorkDir("TRAVEL", f.workRoot), f.previousDir, "travel namespace remains unchanged");
    checks++;
  }

  const current = fixture("current-policy-existing");
  fs.writeFileSync(`${current.stem}.reference-scene.json`, JSON.stringify({ strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, slotId: "scene:image:1" }));
  journal(current.stem, [{ state: "submitted" }]);
  assert.equal(resolveBrandPostImageBatchWorkDir("SHOPPING", current.workRoot), current.previousDir, "current-policy requests retain their original namespace");
  assert.throws(() => prepareImageBatchJobs([target], manifest, "바지", current.previousDir), /IMAGE_RESUME_REQUIRED/, "same-policy uncertain slot is not bypassed");
  const secondDir = path.join(current.workRoot, "resume-v2");
  fs.mkdirSync(secondDir);
  fs.writeFileSync(path.join(secondDir, `raw-${"c".repeat(64)}.checkpoint.jsonl`), "{}");
  assert.throws(() => resolveBrandPostImageBatchWorkDir("SHOPPING", current.workRoot), /IMAGE_RESUME_REQUIRED/, "ambiguous current-policy namespaces cannot start duplicate requests");
  checks++;
  console.log(`PASS ${checks} policy resume cases: settled v1 evidence preserved, fresh v2 namespace allowed, uncertain submissions fail closed, no provider calls`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("image-policy-resume-")) throw new Error("Unexpected cleanup target");
  fs.rmSync(root, { recursive: true, force: true });
});

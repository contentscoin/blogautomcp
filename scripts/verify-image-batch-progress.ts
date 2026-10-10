/** Offline transport regression checks. No browser or generation provider is loaded. */
import assert from "node:assert/strict";
import { buildSelectedProductImageAuditContext } from "./lib/publish-image-audit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import ts from "typescript";
import * as imagePolicy from "./lib/image-timeout-policy";
import * as photoProvenance from "./lib/product-photo-provenance";
import * as imageEvidence from "../src/lib/brand-post-image-evidence";
import * as atomicTextFile from "../src/lib/atomic-text-file";
import * as photorealBuild from "./lib/photoreal/build";
import * as product9Canvas from "./lib/product-9canvas";
import type { ProductSectionImageReviewOptions } from "./lib/product-photo-review";
import type { generateBrandPostImages as Generate, BrandPostImageGenerationResult } from "../src/lib/brand-post-image-generation";
import { checkedExistingJobResult, collectCompletedProductCandidates, existingJobResult, readLegacyCodexImageCompletion, type ImageBatchJob } from "../src/lib/codex-image-generation";
import { buildSellerOriginalRepairTarget } from "./lib/seller-original-repair-target";

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
    process, Buffer, Error, console: { log() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
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

const referenceSceneModule = load<typeof import("./lib/shopping-reference-scene")>("scripts/lib/shopping-reference-scene.ts", {
  "node:crypto": crypto, "node:fs": fs,
  "./codex-draft-provider": { runCodexDraft: () => { throw new Error("live review is forbidden in this offline harness"); } },
  "./product-photo-review": { selectVerifiedProductPhotos: () => { throw new Error("live review is forbidden in this offline harness"); } },
  "../../src/lib/brand-post-image-evidence": imageEvidence,
});
const hashFile = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
type Job = { id: string; outStem: string; prompt: string; referenceMode?: string; referenceImagePaths?: string[]; requiredReferenceHashes?: string[] };
function harness(settings: { timeout?: number; spawnError?: "sync" | "async"; lockFails?: boolean; automation?: boolean; sourceMissing?: boolean; sourceError?: string;
  engine?: "codex" | "browser"; realCache?: boolean;
  sourcePaths?: string[]; segmentablePaths?: string[]; lockedUsesBackground?: boolean;
  diagnosticReason?: string; diagnosticStatus?: "rejected";
  referenceRejected?: boolean; sceneReviewError?: string;
  sectionMatchedPaths?: string[]; sectionReviewError?: string; reviewClass?: "feature-evidence" | "scene-evidence" | "product-photo"; cardFacts?: string[]; cardMatches?: number;
  worker?: (args: string[], child: FakeChild) => void } = {}) {
  const packageDir = fs.mkdtempSync(path.join(root, "package-"));
  let child = new FakeChild();
  let jobs: Job[] = [];
  let checkpoint = "";
  let spawns = 0;
  let lockCalls = 0;
  let sectionReviewCalls = 0;
  const sectionReviewCandidatePaths: string[][] = [];
  const sectionReviewTargets: unknown[][] = [];
  const collectionRefreshFlags: boolean[] = [];
  const lockedSourcePaths: string[] = [];
  const locked = async (options: { sourcePath?: string; backgroundPath?: string } = {}) => {
    lockCalls += 1;
    if (options.sourcePath) lockedSourcePaths.push(options.sourcePath);
    if (settings.lockFails) throw new Error("cutout failed");
    return { outputPath: settings.lockedUsesBackground && options.backgroundPath ? options.backgroundPath : sourcePath };
  };
  const api = load<{
    generateBrandPostImages: typeof Generate;
    resolveBrandPostImageBatchWorkDir: (connectKind: "SHOPPING" | "TRAVEL", workRoot: string) => string;
    imageBatchTimeoutMs: (n: number) => number;
    prepareImageBatchJobs: (targets: unknown[], manifest: unknown, productName: string, workDir: string) => ImageBatchJob[];
    prepareImageBatchJobsIsolated: (targets: unknown[], manifest: unknown, productName: string, workDir: string) => {
      jobs: ImageBatchJob[]; targetIndexes: number[]; errors: Array<{ targetIndex: number; error: string }> };
    resolveCompletedProductImage: (options: { job: ImageBatchJob; manifest: unknown; target: unknown; productName: string; workDir: string;
      signal?: AbortSignal; reviewReferenceScene?: (options: Record<string, unknown>) => Promise<unknown> }) => Promise<{
        generatedPath: string; referenceScene: { reviewedOutputSha256: string } }>;
    runImageBatch: typeof import("../src/lib/brand-post-image-generation").runImageBatch;
    finishGeneratedImage: (options: { manifest: unknown; productName: string; target: unknown; rawPath: string; workDir: string; index: number;
      reviewReferenceScene?: (options: Record<string, unknown>) => Promise<unknown> }) => Promise<{ generatedPath: string; referenceScene: unknown }>;
    runBrowserImageBatch: (
      jobs: unknown[], workDir: string,
      onResult: () => Promise<void>,
    ) => Promise<{ id: string; localPath: string | null; error?: string }[]>;
  }>(
    "src/lib/brand-post-image-generation.ts", {
      "node:fs": fs, "node:path": path,
      "./atomic-text-file": atomicTextFile,
      "../../scripts/lib/publish-image-rejections": { rejectedPublicationImageHashes: () => [] },
      "../../scripts/lib/publish-image-audit": { buildSelectedProductImageAuditContext },
      "../../scripts/lib/seller-original-repair-target": { buildSellerOriginalRepairTarget },
      "../../scripts/lib/image-timeout-policy": imagePolicy,
      "node:child_process": {
        spawn(_command: string, args: string[], options: { windowsHide: boolean; shell: boolean }) {
          spawns += 1;
          assert.equal(options.windowsHide, true);
          assert.equal(options.shell, false);
          if (settings.spawnError === "sync") throw new Error("spawn sync failure");
          jobs = JSON.parse(fs.readFileSync(args[args.indexOf("--jobs-file") + 1], "utf8"));
          checkpoint = args[args.indexOf("--results-file") + 1];
          if (settings.worker) {
            child = new FakeChild();
            const workerChild = child;
            setImmediate(() => settings.worker!(args, workerChild));
          }
          if (settings.spawnError === "async") setImmediate(() => child.emit("error", new Error("spawn async failure")));
          return child;
        },
      },
      "../../scripts/lib/product-image-lock": {
        createLockedProductEditorialScene: locked,
        createLockedProductThumbnailOnBackground: locked,
        createOriginalProductPhotoThumbnail: async () => ({ outputPath: sourcePath }),
        extractLockedProductPng: async (source: string) => {
          if (settings.lockFails || (settings.segmentablePaths && !settings.segmentablePaths.includes(source))) throw new Error("cutout failed");
          return { lockedPngPath: sourcePath };
        },
      },
      "../../scripts/lib/product-thumbnail": { buildProductThumbnailCopy: () => ({}) },
      "../../scripts/lib/product-9canvas": product9Canvas,
      "../../scripts/lib/shopping-reference-scene": {
        SHOPPING_REFERENCE_SCENE_STRATEGY_VERSION: imageEvidence.REFERENCE_SCENE_STRATEGY_VERSION,
        buildShoppingReferenceScenePrompt: referenceSceneModule.buildShoppingReferenceScenePrompt,
        selectShoppingSceneReference: async (options: { paths: string[] }) => {
          const file = options.paths.find(candidate => fs.existsSync(candidate));
          if (!file || settings.referenceRejected) throw new Error("PRODUCT_REFERENCE_REQUIRED: needs_reference");
          return { path: file, sha256: hashFile(file), subject: "selected product", geometry: "intact front view", labels: "original label hierarchy", reviewedAt: "2026-10-07T00:00:00.000Z" };
        },
        reviewShoppingReferenceScene: async (options: { reference: { path: string; sha256: string }; outputPath: string; anchorSha256?: string }) => {
          if (settings.sceneReviewError) throw new Error(settings.sceneReviewError);
          assert.equal(hashFile(options.reference.path), options.reference.sha256, "review uses the original attached reference bytes");
          assert.notEqual(hashFile(options.outputPath), options.reference.sha256, "a source copy is not a generated scene");
          return { strategyVersion: imageEvidence.REFERENCE_SCENE_STRATEGY_VERSION,
            referenceSha256: options.reference.sha256, referencePath: options.reference.path,
            anchorSha256: options.anchorSha256, reviewStatus: "passed", reviewedOutputSha256: hashFile(options.outputPath),
            reviewedAt: "2026-10-07T00:00:00.000Z", reason: "fixture visual fidelity review",
            checks: Object.fromEntries(imageEvidence.REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])) };
        },
      },
      "../../scripts/lib/shopping-fact-card": {
        SHOPPING_FACT_CARD_LIMIT: 3,
        selectShoppingFactCardFacts: () => settings.cardFacts || [],
        countSectionMatchedFacts: () => settings.cardMatches ?? 0,
        createShoppingFactCard: async () => {
          const outputPath = path.join(packageDir, `shopping-fact-card-${crypto.randomUUID()}.png`);
          fs.writeFileSync(outputPath, crypto.randomUUID());
          return { outputPath, sourceSha256: "fixture" };
        },
      },
      "./brand-post-quality-source": { brandPostQualitySourceFromSnapshot: () => ({ sourceFeatures: settings.cardFacts || [] }) },
      "../../scripts/lib/product-photo-provenance": photoProvenance,
      "../../scripts/lib/product-photo-source": {
        readSavedProductSourceCandidates: () => [],
        collectShoppingProductSourceCandidates: async (options: { localCandidates: string[]; sourceImageUrls?: string[]; forceRefresh?: boolean }) => {
          collectionRefreshFlags.push(options.forceRefresh === true);
          if (settings.sourceError) throw new Error(settings.sourceError);
          const includeRemote = options.sourceImageUrls === undefined || options.sourceImageUrls.length > 0;
          return [...new Set([
            ...options.localCandidates,
            ...(settings.sourceMissing || !includeRemote ? [] : settings.sourcePaths || [sourcePath, rawPath]),
          ])];
        },
        selectShoppingProductSource: async () => {
          if (settings.sourceError) throw new Error(settings.sourceError);
          return settings.sourceMissing ? null : sourcePath;
        },
        selectShoppingProductSources: async () => {
          if (settings.sourceError) throw new Error(settings.sourceError);
          return settings.sourceMissing ? [] : settings.sourcePaths || [sourcePath, rawPath];
        },
      },
      "../../scripts/lib/product-photo-review": {
        selectVerifiedProductSectionImages: async (paths: string[], _productName: string, targets: unknown[], options?: ProductSectionImageReviewOptions) => {
          sectionReviewTargets.push(targets);
          sectionReviewCalls += 1;
          sectionReviewCandidatePaths.push([...paths]);
          options?.onDiagnostics?.({ version: 1, status: settings.sectionReviewError ? "failed" : "complete", cacheHit: false,
            reviewedAt: "2026-09-15T00:00:00.000Z", candidateCount: paths.length, targetCount: targets.length,
            ...(settings.sectionReviewError ? { error: settings.sectionReviewError } : {}),
            entries: paths.flatMap(file => targets.map((_, targetIndex) => ({ targetIndex, path: file,
              sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
              status: settings.sectionReviewError ? "review-failed" as const : settings.diagnosticStatus || "not-proposed" as const,
              reason: settings.diagnosticReason || "fixture diagnostic", reviewedAt: "2026-09-15T00:00:00.000Z" }))),
          });
          if (settings.sectionReviewError) throw new Error(settings.sectionReviewError);
          const matched = paths.filter(candidate => settings.sectionMatchedPaths?.includes(candidate));
          return matched.slice(0, targets.length).map((file, targetIndex) => ({
            targetIndex,
            path: file,
            sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            reviewClass: settings.reviewClass || "feature-evidence",
            reason: "fixture section match",
            reviewedAt: "2026-09-15T00:00:00.000Z",
          }));
        },
        selectVerifiedProductSectionImage: async (paths: string[]) => {
          const file = paths.find(candidate => settings.sectionMatchedPaths?.includes(candidate));
          return file ? {
            path: file,
            sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            reviewClass: settings.reviewClass || "feature-evidence",
            reason: "fixture section match",
            reviewedAt: "2026-09-15T00:00:00.000Z",
          } : null;
        },
      },
      "../../scripts/lib/travel-content": { buildTravelThumbnailCopy: () => ({}) },
      "../../scripts/lib/travel-thumbnail": { createTravelEditorialThumbnail: async () => ({ outputPath: sourcePath }) },
      "./brand-post-package": {
        getBrandPostPackageDir: () => packageDir,
        normalizePackageImageAssets: (manifest: { imageAssets?: unknown[] }) => manifest.imageAssets || [],
        applyGeneratedBrandPostImage: () => { throw new Error("not used by the transport harness"); },
      },
      "./chatgpt-browser-automation": { isChatGptBrowserAutomationEnabled: () => settings.automation ?? true },
      "./brand-post-image-evidence": imageEvidence,
      "../../scripts/lib/photoreal/build": photorealBuild,
      // This harness covers the browser transport; the Codex transport has its own test (verify-codex-image-generation).
      "./codex-image-generation": {
        assertProductImageReferences: (job: Job) => {
          if (job.referenceMode !== "product") return;
          assert.ok(job.referenceImagePaths?.length, "product jobs must attach actual references");
          assert.equal(JSON.stringify(job.requiredReferenceHashes), JSON.stringify(job.referenceImagePaths?.map(hashFile)), "hashes bind the ordered attached reference bytes");
        },
        resolveBrandPostImageEngine: () => settings.engine ?? "browser",
        existingJobResult: settings.realCache ? existingJobResult : () => null,
        checkedExistingJobResult: settings.realCache
          ? (job: ImageBatchJob) => checkedExistingJobResult(job, { codexHome: root, onResult: async () => {} })
          : () => null,
        collectCompletedProductCandidates: settings.realCache
          ? (job: ImageBatchJob) => collectCompletedProductCandidates(job, { codexHome: root }) : () => null,
        readLegacyCodexImageCompletion: settings.realCache
          ? (outStem: string) => readLegacyCodexImageCompletion(outStem, { codexHome: root }) : () => null,
        hasBrowserSubmission: () => false,
        hasUnresolvedCodexSubmission: () => false,
        runCodexImageBatch: async () => { throw new Error("codex transport is not used by this harness"); },
      },
      "node:crypto": crypto,
    },
    { process: { ...process, env: { ...process.env, BRAND_POST_IMAGE_BATCH_TIMEOUT_MS: settings.timeout?.toString() || "", BRAND_POST_IMAGE_JOB_TIMEOUT_MS: "" } } },
    "\nmodule.exports.runBrowserImageBatch = runBrowserImageBatch; module.exports.prepareImageBatchJobs = prepareImageBatchJobs; module.exports.finishGeneratedImage = finishGeneratedImage;",
  );
  const manifest = {
    brandLinkId: "fixture", connectKind: "TRAVEL", title: "Fixture",
    sourceSnapshot: { snapshotId: "fixture-snapshot", product: { name: "Fixture", features: [] } },
    composition: { renderNodes: [], sections: [{ id: "section", title: "제주", imageIntent: "해변", body: ["문맥"] }] },
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
  return { ...api, packageDir, get child() { return child; }, manifest, callbacks, generate, result, progress, close,
    get jobs() { return jobs; }, get checkpoint() { return checkpoint; },
    get spawns() { return spawns; }, get lockCalls() { return lockCalls; }, get lockedSourcePaths() { return lockedSourcePaths; },
    get sectionReviewTargets() { return sectionReviewTargets; }, get sectionReviewCalls() { return sectionReviewCalls; }, get sectionReviewCandidatePaths() { return sectionReviewCandidatePaths; },
    get collectionRefreshFlags() { return collectionRefreshFlags; } };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function verifyReviewOnlyRecovery() {
  const bytes = (marker: number) => {
    const image = Buffer.alloc(2048, marker);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
    return image;
  };
  const tree = (dir: string): Record<string, string> => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).flatMap(entry => {
    const file = path.join(dir, String(entry));
    return fs.statSync(file).isFile() ? [[String(entry), hashFile(file)]] : [];
  }));
  function legacy(workRoot: string, completed = true) {
    const previousDir = path.join(workRoot, "resume-v1");
    fs.mkdirSync(previousDir, { recursive: true });
    const outStem = path.join(previousDir, `raw-${crypto.randomBytes(32).toString("hex")}`);
    const workspace = `${outStem}.codex-1`, threadId = crypto.randomUUID();
    fs.mkdirSync(workspace);
    fs.writeFileSync(`${outStem}.png`, bytes(3));
    fs.writeFileSync(path.join(workspace, "out.png"), bytes(3));
    const birth = fs.statSync(workspace).birthtimeMs, date = new Date(birth);
    const directory = path.join(root, "sessions", ...date.toISOString().slice(0, 10).split("-"));
    fs.mkdirSync(directory, { recursive: true });
    const records = [
      { timestamp: date.toISOString(), type: "session_meta", payload: { id: threadId, cwd: workspace, thread_source: "blogautomcp-image" } },
      { timestamp: date.toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "legacy-turn" } },
    ];
    const native = path.join(root, "generated_images", threadId);
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(native, "exec.png"), bytes(3));
    if (completed) records.push({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "task_complete", turn_id: "legacy-turn" } });
    fs.writeFileSync(path.join(directory, `rollout-${date.toISOString().slice(0, 19).replace(/:/gu, "-")}-${threadId}.jsonl`),
      records.map(record => JSON.stringify(record)).join("\n") + "\n");
    return { outStem, previousDir };
  }
  await check("receipt-less legacy threads proven complete permit policy migration without adopting or changing old outputs", async () => {
    const h = harness({ realCache: true });
    const workRoot = path.join(h.packageDir, "image-generation-work");
    const first = legacy(workRoot), second = legacy(workRoot);
    const before = tree(first.previousDir);
    assert.equal(h.resolveBrandPostImageBatchWorkDir("SHOPPING", workRoot), path.join(workRoot, "resume-v2"));
    assert.deepEqual(tree(first.previousDir), before, "read-only retirement does not create receipts or copy raw output into v2");
    assert.equal(fs.existsSync(path.join(workRoot, "resume-v2")), false);
    assert.equal(h.spawns, 0);
    const target = { request: { requestId: "fixture", slotId: "section:image:1", sectionId: "section" }, sectionId: "section",
      role: "body", imageSource: "staged-ai", sectionTitle: "현재 제목", imageIntent: "자연스러운 새 연출", bodyExcerpt: "현재 본문",
      referenceContext: { prompt: "current recipe", referenceImagePaths: [sourcePath], referenceHashes: [hashFile(sourcePath)],
        reference: { path: sourcePath, sha256: hashFile(sourcePath), subject: "product", geometry: "intact", labels: "original" }, anchorSha256: "" } };
    h.manifest.connectKind = "SHOPPING";
    const [job] = h.prepareImageBatchJobs([target], h.manifest, "상품", path.join(workRoot, "resume-v2"));
    assert.ok(job.outStem.startsWith(path.join(workRoot, "resume-v2")));
    assert.equal(job.reviewOnly, undefined, "old composite outputs are never silently approved under the new strategy");
    assert.notEqual(job.outStem, first.outStem);
    assert.notEqual(job.outStem, second.outStem);
    assert.equal(fs.existsSync(`${job.outStem}.png`), false);
    assert.deepEqual(tree(first.previousDir), before);
    assert.equal(h.spawns, 0);
  });
  await check("one completed legacy slot cannot clear an unfinished or explicitly uncertain sibling request", async () => {
    for (const kind of ["unfinished", "pending-receipt", "corrupt-checkpoint", "active-lock"] as const) {
      const h = harness({ realCache: true }), workRoot = path.join(h.packageDir, "image-generation-work");
      const first = legacy(workRoot), uncertain = legacy(workRoot, kind !== "unfinished");
      if (kind === "pending-receipt") fs.writeFileSync(`${uncertain.outStem}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${uncertain.outStem}.codex-1`, startedAtMs: Date.now(), threadId: null }));
      if (kind === "corrupt-checkpoint") fs.writeFileSync(`${uncertain.outStem}.checkpoint.jsonl`, "{partial");
      if (kind === "active-lock") fs.writeFileSync(`${uncertain.outStem}.lock`, JSON.stringify({ pid: process.pid, token: "existing-owner" }));
      const before = tree(first.previousDir);
      assert.throws(() => h.resolveBrandPostImageBatchWorkDir("SHOPPING", workRoot), /IMAGE_RESUME_REQUIRED/, kind);
      assert.deepEqual(tree(first.previousDir), before, `${kind}: uncertain evidence survives intact`);
      assert.equal(fs.existsSync(path.join(workRoot, "resume-v2")), false);
      assert.equal(h.spawns, 0);
    }
  });
  function fixture(engine: "codex" | "browser", transport: "codex" | "browser" = "codex") {
    const h = harness({ engine, realCache: true });
    h.manifest.connectKind = "SHOPPING";
    const workDir = fs.mkdtempSync(path.join(root, "review-only-"));
    const refs = [1, 2].map(marker => {
      const file = path.join(h.packageDir, `ref-${marker}.png`);
      fs.writeFileSync(file, bytes(marker));
      return file;
    });
    const hashes = refs.map(hashFile);
    const target = { request: { requestId: "fixture", slotId: "section:image:1", sectionId: "section" }, sectionId: "section",
      role: "body", imageSource: "staged-ai", sectionTitle: "이전 본문 제목", imageIntent: "이전 연출 의도", bodyExcerpt: "이전 본문",
      referenceContext: { prompt: "previous generation recipe", referenceImagePaths: refs, referenceHashes: hashes,
        reference: { path: refs[0], sha256: hashes[0], subject: "product", geometry: "intact", labels: "original" }, anchorSha256: hashes[1] } };
    const [original] = h.prepareImageBatchJobs([target], h.manifest, "상품", workDir);
    fs.writeFileSync(`${original.outStem}.png`, bytes(3));
    const workspace = `${original.outStem}.codex-1`;
    if (transport === "codex") {
      fs.mkdirSync(workspace);
      fs.copyFileSync(`${original.outStem}.png`, path.join(workspace, "out.png"));
      fs.writeFileSync(`${original.outStem}.codex-submission.json`, JSON.stringify({ state: "completed", workspace,
        startedAtMs: Date.now() - 100, threadId: `fixture-${crypto.randomUUID()}` }));
    } else fs.writeFileSync(`${original.outStem}.checkpoint.jsonl`, JSON.stringify({ id: "slot", fingerprint: "f".repeat(64),
      localPath: `${original.outStem}.png`, sha256: hashFile(`${original.outStem}.png`) }) + "\n");
    target.sectionTitle = "현재 본문 제목";
    target.imageIntent = "현재 자연스러운 연출 의도";
    target.bodyExcerpt = "현재 본문의 기능 증거 사용 여부까지 다시 확인";
    target.referenceContext.prompt = "current generation recipe";
    const prepare = () => h.prepareImageBatchJobs([target], h.manifest, "상품", workDir);
    return { h, workDir, original, target, prepare, workspace };
  }
  const deliver = async (f: ReturnType<typeof fixture>, jobs: ImageBatchJob[], signal?: AbortSignal) => {
    let transports = 0;
    const results: { localPath: string | null; error?: string }[] = [];
    try {
      await f.h.runImageBatch(jobs, f.workDir, async result => { results.push(result); }, signal, {
        runCodex: async () => { transports++; throw new Error("review-only must never call Codex"); },
        runBrowser: async () => { transports++; throw new Error("review-only must never call browser"); }, browserEnabled: true,
      });
    } finally {
      assert.equal(transports, 0);
      assert.equal(f.h.spawns, 0);
    }
    return results;
  };
  await check("settled same-slot raw is re-reviewed with the current body and no transport in both engines", async () => {
    for (const engine of ["codex", "browser"] as const) for (const transport of ["codex", "browser"] as const) {
      const f = fixture(engine, transport);
      // Identical copies of one artifact are allowed, including another extension.
      fs.copyFileSync(`${f.original.outStem}.png`, `${f.original.outStem}.jpg`);
      if (transport === "codex") {
        const receipt = JSON.parse(fs.readFileSync(`${f.original.outStem}.codex-submission.json`, "utf8"));
        const generatedDir = path.join(root, "generated_images", receipt.threadId);
        fs.mkdirSync(generatedDir, { recursive: true });
        fs.copyFileSync(`${f.original.outStem}.png`, path.join(generatedDir, "original-generated.png"));
      }
      const before = tree(f.workDir);
      const jobs = f.prepare();
      assert.equal(jobs[0].outStem, f.original.outStem);
      assert.equal(jobs[0].reviewOnly?.outputSha256, hashFile(`${f.original.outStem}.png`));
      const [result] = await deliver(f, jobs);
      assert.equal(result.localPath, `${f.original.outStem}.png`);
      const finish = () => f.h.finishGeneratedImage({ manifest: f.h.manifest, productName: "상품", target: f.target,
        rawPath: result.localPath!, workDir: f.workDir, index: 0, reviewReferenceScene: async input => {
          assert.equal(input.sectionTitle, f.target.sectionTitle);
          assert.equal(input.bodyExcerpt, f.target.bodyExcerpt);
          assert.equal(input.imageIntent, f.target.imageIntent);
          return { reviewStatus: "passed", reviewedOutputSha256: hashFile(result.localPath!) };
        } });
      assert.equal((await finish()).generatedPath, result.localPath);
      await assert.rejects(() => f.h.finishGeneratedImage({ manifest: f.h.manifest, productName: "상품", target: f.target,
        rawPath: result.localPath!, workDir: f.workDir, index: 0,
        reviewReferenceScene: async () => { throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: current body is incompatible"); } }), /REFERENCE_SCENE_FIDELITY_FAILED/);
      assert.deepEqual(tree(f.workDir), before, "review-only does not change old metadata, receipts or raw bytes");
      assert.equal(f.prepare()[0].outStem, f.original.outStem, "later attempts safely re-review the same candidate");
    }
  });
  await check("review-only preparation rejects uncertain, mismatched or multiple saved requests", async () => {
    for (const kind of ["snapshot", "refs-order", "raw-only", "not-submitted", "submitting", "missing-thread", "lock",
      "raw-distinct", "workspace-distinct", "thread-distinct", "browser-uncertain", "browser-hash", "other-same-slot", "current-identity-uncertain"] as const) {
      const f = fixture("codex", kind.startsWith("browser") ? "browser" : "codex");
      const sidecar = `${f.original.outStem}.reference-scene.json`;
      const metadata = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      if (kind === "snapshot") metadata.sourceSnapshotId = "other-snapshot";
      if (kind === "refs-order") metadata.referenceHashes.reverse();
      if (["snapshot", "refs-order"].includes(kind)) fs.writeFileSync(sidecar, JSON.stringify(metadata));
      const receiptPath = `${f.original.outStem}.codex-submission.json`;
      if (kind === "raw-only") fs.unlinkSync(receiptPath);
      if (["not-submitted", "submitting", "missing-thread"].includes(kind)) {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
        if (kind === "missing-thread") receipt.threadId = null; else receipt.state = kind;
        fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      }
      if (kind === "lock") fs.writeFileSync(`${f.original.outStem}.lock`, "locked");
      if (kind === "raw-distinct") fs.writeFileSync(`${f.original.outStem}.jpg`, bytes(4));
      if (kind === "workspace-distinct") fs.writeFileSync(path.join(f.workspace, "dog.png"), bytes(4));
      if (kind === "thread-distinct") {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
        const dir = path.join(root, "generated_images", receipt.threadId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "dog.png"), bytes(4));
      }
      if (kind === "browser-uncertain") fs.appendFileSync(`${f.original.outStem}.checkpoint.jsonl`, JSON.stringify({ id: "slot", fingerprint: "f".repeat(64), state: "submitted" }) + "\n");
      if (kind === "browser-hash") fs.appendFileSync(`${f.original.outStem}.png`, "changed");
      if (kind === "other-same-slot") {
        const stem = path.join(f.workDir, `raw-${"d".repeat(64)}`);
        fs.copyFileSync(sidecar, `${stem}.reference-scene.json`);
        fs.writeFileSync(`${stem}.checkpoint.jsonl`, "{}");
      }
      if (kind === "current-identity-uncertain") {
        const freshDir = fs.mkdtempSync(path.join(root, "current-identity-"));
        const [freshJob] = f.h.prepareImageBatchJobs([f.target], f.h.manifest, "상품", freshDir);
        const stem = path.join(f.workDir, path.basename(freshJob.outStem));
        fs.copyFileSync(`${freshJob.outStem}.reference-scene.json`, `${stem}.reference-scene.json`);
        fs.writeFileSync(`${stem}.codex-submission.json`, JSON.stringify({ state: "submitting", workspace: `${stem}.codex-1`,
          startedAtMs: Date.now(), threadId: null }));
      }
      const before = tree(f.workDir);
      assert.throws(f.prepare, /IMAGE_RESUME_REQUIRED|IMAGE_OUTPUT_AMBIGUOUS/, kind);
      assert.deepEqual(tree(f.workDir), before, `${kind}: refusal preserves evidence without a new identity`);
      assert.equal(f.h.spawns, 0);
    }
  });
  await check("settled retired strategy remains a migration and cannot be reused for current-strategy review", async () => {
    const f = fixture("codex");
    const sidecar = `${f.original.outStem}.reference-scene.json`;
    const metadata = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    metadata.strategyVersion = "shopping-reference-scene/v1";
    fs.writeFileSync(sidecar, JSON.stringify(metadata));
    const before = fs.readFileSync(sidecar);
    const [job] = f.prepare();
    assert.equal(job.reviewOnly, undefined);
    assert.notEqual(job.outStem, f.original.outStem);
    assert.deepEqual(fs.readFileSync(sidecar), before);
    assert.equal(f.h.spawns, 0);
  });
  await check("review-only SHA and completion are rechecked at delivery and never fall back on damage or cancellation", async () => {
    for (const engine of ["codex", "browser"] as const) for (const kind of ["deleted", "replaced", "snapshot", "refs-order", "reference-bytes", "receipt", "checkpoint", "ambiguous", "cancelled"] as const) {
      const f = fixture(engine);
      const jobs = f.prepare();
      if (kind === "deleted") fs.unlinkSync(`${f.original.outStem}.png`);
      if (kind === "replaced") fs.writeFileSync(`${f.original.outStem}.png`, bytes(4));
      if (kind === "reference-bytes") fs.appendFileSync(f.target.referenceContext.referenceImagePaths[0], "changed");
      if (kind === "snapshot" || kind === "refs-order") {
        const sidecar = `${f.original.outStem}.reference-scene.json`;
        const metadata = JSON.parse(fs.readFileSync(sidecar, "utf8"));
        if (kind === "snapshot") metadata.sourceSnapshotId = "changed"; else metadata.referenceHashes.reverse();
        fs.writeFileSync(sidecar, JSON.stringify(metadata));
      }
      if (kind === "receipt") fs.unlinkSync(`${f.original.outStem}.codex-submission.json`);
      if (kind === "checkpoint") fs.writeFileSync(`${f.original.outStem}.checkpoint.jsonl`, "{partial");
      if (kind === "ambiguous") fs.writeFileSync(path.join(f.workspace, "second.png"), bytes(4));
      const controller = new AbortController();
      if (kind === "cancelled") controller.abort();
      const before = tree(f.workDir);
      if (kind === "reference-bytes") {
        const [result] = await deliver(f, jobs, controller.signal);
        assert.equal(result.localPath, null);
        assert.match(result.error || "", /ordered attached reference bytes/);
        assert.deepEqual(tree(f.workDir), before);
        continue;
      }
      const [result] = await deliver(f, jobs, controller.signal);
      assert.equal(result.localPath, null, kind);
      assert.match(result.error || "", /IMAGE_RESUME_REQUIRED|IMAGE_OUTPUT_AMBIGUOUS|중지/, kind);
      assert.deepEqual(tree(f.workDir), before, `${kind}: delivery never mutates or regenerates`);
    }
  });

  function multipleFixture(engine: "codex" | "browser" = "codex", completion: "receipt" | "rollout" | "none" = "receipt") {
    const f = fixture(engine);
    const receipt = JSON.parse(fs.readFileSync(`${f.original.outStem}.codex-submission.json`, "utf8"));
    const dir = path.join(root, "generated_images", receipt.threadId);
    fs.mkdirSync(dir, { recursive: true });
    const first = path.join(dir, "a.png"), second = path.join(dir, "b.png");
    fs.writeFileSync(first, bytes(3)); fs.writeFileSync(second, bytes(4));
    fs.copyFileSync(first, path.join(dir, "a-copy.png"));
    fs.copyFileSync(f.target.referenceContext.referenceImagePaths[0], path.join(dir, "reference-copy.png"));
    fs.writeFileSync(path.join(f.workspace, "helper.png"), bytes(99));
    if (completion === "receipt") {
      receipt.completedAtMs = Date.now();
      fs.writeFileSync(`${f.original.outStem}.codex-submission.json`, JSON.stringify(receipt));
    }
    let rollout: string | undefined;
    if (completion === "rollout") {
      const date = new Date(receipt.startedAtMs).toISOString().slice(0, 10).split("-");
      const sessions = path.join(root, "sessions", ...date); fs.mkdirSync(sessions, { recursive: true });
      rollout = path.join(sessions, `rollout-fixture-${receipt.threadId}.jsonl`);
      fs.writeFileSync(rollout, [
        { timestamp: new Date(receipt.startedAtMs + 1).toISOString(), type: "session_meta",
          payload: { id: receipt.threadId, cwd: receipt.workspace, thread_source: "blogautomcp-image" } },
        { timestamp: new Date(receipt.startedAtMs + 2).toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "owned-turn" } },
        { timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "task_complete", turn_id: "owned-turn" } },
      ].map(record => JSON.stringify(record)).join("\n") + "\n");
    }
    const body = "현재 게시물 문맥 ".repeat(250) + "실제 마지막 효능 문장";
    f.h.manifest.composition.renderNodes = [
      { kind: "heading", sectionId: "section", text: "최종 게시 제목" },
      { kind: "paragraph", sectionId: "section", text: body },
    ] as typeof f.h.manifest.composition.renderNodes;
    const [job] = f.prepare();
    assert.equal(job.reviewOnly?.candidateSet?.candidates.length, 2, "only byte-unique native outputs of this completed thread are candidates");
    const proof = (input: Record<string, unknown>) => ({
      strategyVersion: imageEvidence.REFERENCE_SCENE_STRATEGY_VERSION, referenceSha256: f.target.referenceContext.reference.sha256,
      referencePath: f.target.referenceContext.reference.path, anchorSha256: f.target.referenceContext.anchorSha256,
      reviewedOutputSha256: hashFile(String(input.outputPath)), reviewStatus: "passed", reason: "verified current source and final body",
      reviewedAt: new Date().toISOString(), checks: Object.fromEntries(imageEvidence.REFERENCE_SCENE_REVIEW_CHECKS.map(key => [key, true])),
    });
    const resolve = (review: (input: Record<string, unknown>) => Promise<unknown>, signal?: AbortSignal) =>
      f.h.resolveCompletedProductImage({ job, manifest: f.h.manifest, target: f.target, productName: "상품", workDir: f.workDir,
        reviewReferenceScene: review, signal });
    return { ...f, job, first, second, body, proof, resolve, rollout };
  }
  await check("completed native alternatives recover only the unique strict-QA pass without any transport or evidence overwrite", async () => {
    for (const engine of ["codex", "browser"] as const) {
      const f = multipleFixture(engine), before = tree(f.workDir);
      const [delivery] = await deliver(f, [f.job]);
      assert.equal(delivery.localPath, null);
      assert.ok((delivery as { recoveryJob?: ImageBatchJob }).recoveryJob);
      let reviews = 0;
      const review = async (input: Record<string, unknown>) => {
        reviews++;
        assert.equal(input.sectionTitle, "최종 게시 제목"); assert.equal(input.bodyExcerpt, f.body);
        if (String(input.outputPath) === f.second) throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: wrong product geometry");
        return f.proof(input);
      };
      const result = await f.resolve(review);
      assert.equal(result.referenceScene.reviewedOutputSha256, hashFile(f.first));
      assert.equal(hashFile(result.generatedPath), hashFile(f.first));
      assert.ok(result.generatedPath.startsWith(path.join(f.workDir, "resolutions")));
      for (const [file, hash] of Object.entries(before)) assert.equal(hashFile(path.join(f.workDir, file)), hash, "old provider/raw/receipt/metadata are preserved");
      assert.equal(reviews, 2);
      assert.equal((await f.resolve(review)).generatedPath, result.generatedPath);
      assert.equal(reviews, 4, "a cached resolution never substitutes an old verdict for current full QA");
    }
  });
  await check("zero or multiple fidelity passes and provider/invalid verdict failures never adopt a candidate", async () => {
    for (const mode of ["zero", "multiple", "provider-after-pass", "invalid-after-pass"] as const) {
      const f = multipleFixture(); let reviews = 0;
      const before = tree(f.workDir);
      await assert.rejects(() => f.resolve(async input => {
        reviews++;
        if (mode === "zero") throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: failed factual support");
        if (reviews === 2 && mode === "provider-after-pass") throw new Error("CODEX_AUTH_REQUIRED: review provider unavailable");
        const proof = f.proof(input);
        if (reviews === 2 && mode === "invalid-after-pass") return { ...proof, checks: {} };
        return proof;
      }), mode.startsWith("provider") ? /CODEX_AUTH_REQUIRED/ : mode.startsWith("invalid") ? /REFERENCE_SCENE_REVIEW_INVALID/ : /IMAGE_OUTPUT_AMBIGUOUS/);
      assert.equal(reviews, 2);
      assert.deepEqual(tree(f.workDir), before, `${mode}: no new resolution, no evidence modification`);
    }
  });
  await check("candidate, receipt, ordered-reference, live context and cancellation changes during QA stop resolution", async () => {
    for (const kind of ["candidate", "receipt", "reference", "context-replaced", "body", "cancelled"] as const) {
      const f = multipleFixture(), controller = new AbortController(); let reviews = 0;
      await assert.rejects(() => f.resolve(async input => {
        reviews++;
        const proof = f.proof(input);
        if (kind === "candidate") fs.appendFileSync(f.second, "changed");
        if (kind === "receipt") fs.appendFileSync(`${f.original.outStem}.codex-submission.json`, " ");
        if (kind === "reference") fs.appendFileSync(f.target.referenceContext.referenceImagePaths[1], "changed");
        if (kind === "context-replaced") f.target.referenceContext = { ...f.target.referenceContext };
        if (kind === "body") (f.h.manifest.composition.renderNodes.find(node => node.kind === "paragraph") as { text: string }).text += " altered";
        if (kind === "cancelled") controller.abort();
        return proof;
      }, controller.signal), /IMAGE_RESUME_REQUIRED|PRODUCT_REFERENCE_CHANGED/);
      assert.equal(reviews, 1); assert.equal(fs.existsSync(path.join(f.workDir, "resolutions")), false);
      assert.equal(fs.existsSync(`${f.job.outStem}.resolution.lock`), false);
    }
  });
  await check("heading-off rendered body is reviewed verbatim while stale planning text alone cannot authorize recovery", async () => {
    const headedOff = multipleFixture();
    headedOff.h.manifest.composition.renderNodes = headedOff.h.manifest.composition.renderNodes.filter(node => node.kind !== "heading");
    assert.ok((await headedOff.resolve(async input => {
      assert.equal(input.sectionTitle, ""); assert.equal(input.bodyExcerpt, headedOff.body);
      if (String(input.outputPath) === headedOff.second) throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: mismatch"); return headedOff.proof(input);
    })).generatedPath);
    const f = multipleFixture(); let reviews = 0; f.h.manifest.composition.renderNodes = [];
    await assert.rejects(() => f.resolve(async input => { reviews++; return f.proof(input); }), /최종 게시 본문 또는 소제목/);
    assert.equal(reviews, 0); assert.equal(fs.existsSync(path.join(f.workDir, "resolutions")), false);
  });
  await check("legacy multi-output recovery requires one exact-thread/workspace terminal rollout and rechecks its byte binding", async () => {
    assert.throws(() => multipleFixture("codex", "none"), /IMAGE_RESUME_REQUIRED/);
    const f = multipleFixture("codex", "rollout");
    assert.equal(f.job.reviewOnly?.candidateSet?.completion.source, "rollout");
    const before = fs.readFileSync(`${f.job.outStem}.codex-submission.json`);
    assert.ok((await f.resolve(async input => {
      if (String(input.outputPath) === f.second) throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: mismatch"); return f.proof(input);
    })).generatedPath);
    assert.deepEqual(fs.readFileSync(`${f.job.outStem}.codex-submission.json`), before, "legacy receipt is not upgraded or overwritten");
    for (const mutation of ["no-terminal", "workspace", "turn", "hash"] as const) {
      const damaged = multipleFixture("codex", "rollout"); let reviews = 0;
      const records = fs.readFileSync(damaged.rollout!, "utf8").trim().split("\n").map(line => JSON.parse(line));
      if (mutation === "no-terminal") records.pop();
      if (mutation === "workspace") records[0].payload.cwd = `${damaged.workspace}-other`;
      if (mutation === "turn") records[2].payload.turn_id = "other-turn";
      fs.writeFileSync(damaged.rollout!, records.map(record => JSON.stringify(record)).join("\n") + (mutation === "hash" ? "\n\n" : "\n"));
      await assert.rejects(() => damaged.resolve(async input => { reviews++; return damaged.proof(input); }), /IMAGE_RESUME_REQUIRED/);
      assert.equal(reviews, 0); assert.equal(fs.existsSync(path.join(damaged.workDir, "resolutions")), false);
    }
  });
  await check("dead resolution owners can recover while active or malformed owners and corrupted saved resolutions stay blocked", async () => {
    const deadPid = 99_999_999;
    assert.throws(() => process.kill(deadPid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
    for (const owner of ["dead", "active", "malformed"] as const) {
      const f = multipleFixture(); let reviews = 0;
      const lock = `${f.job.outStem}.resolution.lock`;
      fs.writeFileSync(lock, owner === "malformed" ? "invalid" : JSON.stringify({ version: "product-image-resolution-lock/v1",
        ownerPid: owner === "dead" ? deadPid : process.pid, ownerToken: owner }));
      const review = async (input: Record<string, unknown>) => {
        reviews++; if (String(input.outputPath) === f.second) throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: mismatch"); return f.proof(input);
      };
      if (owner === "dead") { assert.ok((await f.resolve(review)).generatedPath); assert.equal(reviews, 2); }
      else { await assert.rejects(() => f.resolve(review), /IMAGE_RESUME_REQUIRED/); assert.equal(reviews, 0); }
    }
    const f = multipleFixture();
    const review = async (input: Record<string, unknown>) => {
      if (String(input.outputPath) === f.second) throw new Error("REFERENCE_SCENE_FIDELITY_FAILED: mismatch"); return f.proof(input);
    };
    const result = await f.resolve(review), record = path.join(path.dirname(result.generatedPath), "resolution.json");
    fs.writeFileSync(record, "corrupted");
    await assert.rejects(() => f.resolve(review), /IMAGE_RESUME_REQUIRED/);
    assert.equal(fs.readFileSync(record, "utf8"), "corrupted");
    fs.unlinkSync(record); fs.writeFileSync(result.generatedPath, bytes(8));
    await assert.rejects(() => f.resolve(review), /IMAGE_RESUME_REQUIRED/);
    assert.equal(hashFile(result.generatedPath), crypto.createHash("sha256").update(bytes(8)).digest("hex"));
  });
  await check("one uncertain preparation and one changed reference cannot starve an unrelated healthy slot", async () => {
    const f = fixture("codex");
    const receipt = JSON.parse(fs.readFileSync(`${f.original.outStem}.codex-submission.json`, "utf8")); receipt.state = "submitting";
    fs.writeFileSync(`${f.original.outStem}.codex-submission.json`, JSON.stringify(receipt));
    const second = { ...f.target, request: { ...f.target.request, requestId: "second", slotId: "section:image:2" } };
    const prepared = f.h.prepareImageBatchJobsIsolated([f.target, second], f.h.manifest, "상품", f.workDir);
    assert.equal(prepared.errors.length, 1); assert.equal(prepared.errors[0].targetIndex, 0);
    assert.deepEqual(Array.from(prepared.targetIndexes), [1]); assert.equal(prepared.jobs[0].id, "1");
    const broken = { ...prepared.jobs[0], id: "bad", requiredReferenceHashes: ["0".repeat(64)] };
    const delivered: Array<{ index: number; error?: string; localPath: string | null }> = [];
    let calls = 0;
    await f.h.runImageBatch([broken, prepared.jobs[0]], f.workDir, async (result, index) => { delivered.push({ ...result, index }); }, undefined, {
      runCodex: async (jobs, options) => { calls++; assert.equal(jobs.length, 1); assert.equal(jobs[0].id, "1");
        const result = { id: "1", localPath: `${f.original.outStem}.png` }; await options.onResult(result, 0); return [result]; },
      runBrowser: async () => { throw new Error("must not switch engine"); },
    });
    assert.equal(calls, 1); assert.equal(delivered.length, 2);
    assert.equal(delivered[0].index, 0); assert.ok(delivered[0].error);
    assert.equal(delivered[1].index, 1); assert.ok(delivered[1].localPath);
  });
}

async function verifyGenerator() {
  await check("section review receives full published render text instead of stale planning context", async () => {
    const h = harness({ sectionMatchedPaths: [sourcePath] });
    h.manifest.connectKind = "SHOPPING";
    const body = "앞부분 ".repeat(150) + "수분 공급 효능을 주장하는 실제 마지막 문장";
    h.manifest.composition.renderNodes = [
      { kind: "heading", sectionId: "section", text: "실제 발행 제목" },
      { kind: "paragraph", sectionId: "section", text: body },
    ] as typeof h.manifest.composition.renderNodes;
    await h.generate(1, { sourceOnly: true });
    const target = h.sectionReviewTargets[0][0] as { sectionTitle: string; sectionBody: string[] };
    assert.equal(target.sectionTitle, "실제 발행 제목");
    assert.deepEqual(target.sectionBody, [body]);
  });
  await check("section review diagnostics persist with target mapping on success and failure", async () => {
    for (const sectionReviewError of [undefined, "review provider failed"]) {
      const h = harness({ sectionReviewError });
      h.manifest.connectKind = "SHOPPING";
      h.manifest.composition.sections[0].title = "45분 사용시간";
      h.manifest.composition.sections[0].imageIntent = "기능 작동 근거";
      await h.generate(1, { sourceOnly: true });
      const report = JSON.parse(fs.readFileSync(path.join(h.packageDir, "image-source-diagnostics.json"), "utf8"));
      assert.equal(report.status, sectionReviewError ? "failed" : "complete");
      assert.equal(report.entries[0].sectionId, "section");
      assert.equal(report.entries[0].imageIntent, "기능 작동 근거");
      assert.match(report.entries[0].sourceSha256, /^[a-f0-9]{64}$/);
      assert.equal(path.isAbsolute(report.entries[0].path), false);
      assert.equal(h.spawns, 0);
    }
  });
  await check("lifestyle slots generate from one verified reference without feature evidence", async () => {
    const h = harness({ sourcePaths: [sourcePath], segmentablePaths: [sourcePath], lockedUsesBackground: true });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].title = "선택 기준";
    h.manifest.composition.sections[0].imageIntent = "AI 연출 이미지: 생활 공간 배치";
    const outputs = [0, 1].map(index => {
      const file = path.join(root, `lifestyle-${index}.png`);
      fs.writeFileSync(file, `different scene ${index}`);
      return file;
    });
    const pending = h.generate(2);
    await tick();
    assert.equal(h.jobs.length, 2);
    h.close(0, { ok: true, jobs: outputs.map((file, index) => h.result(index, file)) });
    const results = await pending;
    assert.ok(results.every(result => result.remoteGenerated && result.creationMethod === "reference-guided-scene" && result.provenance === "GENERATED_SCENE" && !result.error));
    assert.equal(h.lockCalls, 0, "whole-scene edits must not claim pixel-locked compositing");
    assert.ok(h.jobs.every(job => job.referenceMode === "product" && JSON.stringify(job.referenceImagePaths) === JSON.stringify([sourcePath])));
    results.forEach(result => {
      assert.equal(result.referenceScene?.referenceSha256, hashFile(sourcePath));
      assert.equal(result.referenceScene?.sourceSnapshotId, "fixture-snapshot");
      assert.equal(result.referenceScene?.reviewedOutputSha256, hashFile(result.generatedPath!));
      assert.ok(imageEvidence.REFERENCE_SCENE_REVIEW_CHECKS.every(key => result.referenceScene?.checks?.[key] === true));
    });
    assert.notEqual(results[0].generatedPath, results[1].generatedPath);
    assert.ok(h.jobs.every(job => job.prompt.includes("People wearing clothing") && job.prompt.includes("No information cards")));
  });
  await check("source-only lifestyle requests report generation required, not source binding success", async () => {
    const h = harness({ sectionMatchedPaths: [sourcePath] });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageIntent = "AI 연출 이미지: 생활 공간 배치";
    const results = await h.generate(1, { sourceOnly: true });
    assert.equal(h.spawns, 0);
    assert.ok(results[0].error?.includes("IMAGE_GENERATION_REQUIRED"));
    assert.equal(results[0].generatedPath, null);
  });
  await check("verified original scenes bypass impossible cutout without claiming generation", async () => {
    const h = harness({ sectionMatchedPaths: [sourcePath], reviewClass: "scene-evidence", lockFails: true });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageIntent = "원본 사용 장면";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    const results = await h.generate(1, { sourceOnly: true });
    assert.equal(h.spawns, 0);
    assert.equal(h.lockCalls, 0);
    assert.equal(results[0].generatedPath, sourcePath);
    assert.equal(results[0].provenance, "ORIGINAL");
    assert.equal(results[0].remoteGenerated, false);
    assert.equal(results[0].sourceReview?.reviewClass, "scene-evidence");
    h.manifest.imageRequirements = { policy: "generated-required" } as typeof h.manifest.imageRequirements;
    const required = await h.generate(1, { sourceOnly: true });
    assert.equal(required[0].provenance, "ORIGINAL", "the one explicitly planned original is still allowed under mixed source/scene policy");
    h.manifest.composition.sections[0].imageSource = "staged-ai";
    const staged = await h.generate(1, { sourceOnly: true });
    assert.match(staged[0].error || "", /IMAGE_GENERATION_REQUIRED/);
  });
  await check("photo verifier provider failure retains its cause and never starts image generation", async () => {
    const h = harness({ sourceError: "CODEX_MODEL_INCOMPATIBLE: newer CLI required" });
    h.manifest.connectKind = "SHOPPING";
    const results = await h.generate(2);
    assert.ok(results.every(result => result.error === "CODEX_MODEL_INCOMPATIBLE: newer CLI required"));
    assert.equal(h.spawns, 0);
  });
  await check("unassigned seller-original slots retain source failure and never enter scene generation", async () => {
    for (const sourceOnly of [false, true]) {
      for (const settings of [
        { sourceMissing: true },
        { sectionMatchedPaths: [] },
        { sectionMatchedPaths: [sourcePath], reviewClass: "feature-evidence" as const },
        { sourceError: "CODEX_MODEL_INCOMPATIBLE: newer CLI required" },
        { sectionReviewError: "CODEX_TIMEOUT: original review interrupted" },
      ]) {
        const h = harness(settings);
        h.manifest.connectKind = "SHOPPING";
        Object.assign(h.manifest.composition.sections[0], {
          imageSource: "seller-original",
          imageIntent: "판매페이지 원본 상품 사진: 선택한 상품·옵션의 외형 확인",
        });
        const [result] = await h.generate(1, { sourceOnly });
        if ("sourceError" in settings) assert.equal(result.error, settings.sourceError);
        else if ("sectionReviewError" in settings) assert.equal(result.error, settings.sectionReviewError);
        else assert.match(result.error || "", /^IMAGE_SOURCE_BINDING_REQUIRED:/);
        assert.equal(result.generatedPath, null);
        assert.equal(h.spawns, 0, "missing/rejected original never submits a scene request");
        assert.equal(h.jobs.length, 0);
        assert.equal(h.lockCalls, 0, "missing original never enters a framed/composite fallback");
        assert.equal(fs.existsSync(path.join(h.packageDir, "image-generation-work", "scene-reference-context.json")), false,
          "original assignment failure never prepares a scene reference");
      }
    }
  });
  await check("seller-original repair explanation uses eligible diagnostic index and preserves the full rejection reason", async () => {
    const reason = "설명 패널과 프레임 포함 ".repeat(35) + "마지막 상세 거절 사유";
    const h = harness({ diagnosticReason: reason, diagnosticStatus: "rejected" });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections = [
      { ...h.manifest.composition.sections[0], id: "scene", imageSource: "staged-ai" },
      { ...h.manifest.composition.sections[0], id: "original", imageSource: "seller-original" },
    ];
    const results = await h.generate(0, { sourceOnly: true, requests: [
      { requestId: "scene", sectionId: "scene" }, { requestId: "original", sectionId: "original" },
    ] });
    assert.match(results[0].error || "", /IMAGE_GENERATION_REQUIRED/);
    assert.match(results[1].error || "", /원본 사진 슬롯 original/);
    assert.ok(results[1].error?.includes(reason));
    assert.equal(h.sectionReviewTargets[0].length, 1, "diagnostic target 0 is the original, while generation target 0 is the staged scene");
    const saved = JSON.parse(fs.readFileSync(path.join(h.packageDir, "image-source-diagnostics.json"), "utf8"));
    assert.equal(saved.entries[0].reason, reason);
    assert.equal(h.spawns, 0);
  });
  await check("explicit source refresh reaches both independent collection quotas while normal collection keeps reuse", async () => {
    for (const forceSourceRefresh of [false, true]) {
      const h = harness(); h.manifest.connectKind = "SHOPPING";
      h.manifest.composition.sections[0].imageSource = "seller-original";
      await h.generate(1, { sourceOnly: true, forceSourceRefresh });
      assert.deepEqual(h.collectionRefreshFlags.slice(0, 2), [forceSourceRefresh, forceSourceRefresh]);
    }
  });
  await check("shopping missing source rejects before any provider worker starts", async () => {
    const h = harness({ sourceMissing: true });
    h.manifest.connectKind = "SHOPPING";
    const results = await h.generate(2);
    assert.ok(results.every(result => result.error?.includes("PRODUCT_SOURCE_REQUIRED")));
    assert.equal(h.spawns, 0);
  });
  await check("transport delivery queue resolves even when its consumer rejects", async () => {
    const h = harness();
    const workDir = fs.mkdtempSync(path.join(root, "delivery-"));
    const targets = [0, 1].map((i) => ({
      request: { requestId: String(i) }, sectionId: "section", role: "body",
      sectionTitle: "fixture", imageIntent: "fixture", bodyExcerpt: "fixture",
    }));
    let calls = 0;
    const pending = h.runBrowserImageBatch(h.prepareImageBatchJobs(targets, h.manifest, "fixture", workDir), workDir, async () => {
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
    assert.equal(h.imageBatchTimeoutMs(7), imagePolicy.imageBatchBudgetMs(7, {}));
    assert.equal(h.imageBatchTimeoutMs(1), imagePolicy.imageBatchBudgetMs(1, {}));
    assert.equal(h.imageBatchTimeoutMs(40), imagePolicy.imageBatchBudgetMs(40, {}), "every sequential job gets its full budget");
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

  await check("only one reviewed original fills the body; additional slots stay missing", async () => {
    const originals = Array.from({ length: 4 }, (_, index) => {
      const file = path.join(root, `verified-original-${index}.jpg`);
      fs.writeFileSync(file, `distinct verified seller photo ${index}`);
      return file;
    });
    const h = harness({ reviewClass: "product-photo", sourcePaths: originals, sectionMatchedPaths: originals, lockFails: true });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    const results = await h.generate(0, { requests: originals.map((_, index) => ({
      requestId: `source-${index}`,
      sectionId: "section",
    })) });
    assert.equal(h.spawns, 0, "source-first coverage must not launch paid/browser generation");
    assert.equal(h.lockCalls, 0, "an untouched original photo does not require foreground extraction");
    assert.equal(results.filter(result => result.generatedPath).length, 1);
    assert.equal(results.filter(result => result.error?.includes("SHOPPING_ORIGINAL_LIMIT")).length, 3);
    assert.ok(originals.includes(results.find(result => result.generatedPath)!.generatedPath!));
    results.filter(result => result.generatedPath).forEach((result) => {
      assert.equal(result.provenance, "ORIGINAL");
      assert.equal(result.creationMethod, "source");
      assert.equal(result.remoteGenerated, false);
      assert.equal(result.sourceReview?.version, "product-photo-source-review/v1");
      assert.equal(result.sourceReview?.usage, "section-matched-product-evidence");
      assert.equal(result.error, undefined);
    });
  });

  await check("existing and fresh shopping sources share one global semantic review", async () => {
    const existing = path.join(root, "global-existing.jpg");
    const fresh = path.join(root, "global-fresh.jpg");
    fs.writeFileSync(existing, "existing package original");
    fs.writeFileSync(fresh, "fresh recovered seller original");
    const existingHash = crypto.createHash("sha256").update(fs.readFileSync(existing)).digest("hex");
    const h = harness({ reviewClass: "product-photo", sourcePaths: [fresh], sectionMatchedPaths: [existing, fresh] });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    h.manifest.imageAssets = [
      { sha256: "hero", role: "hero", path: sourcePath, provenance: "LOCKED_PRODUCT" },
      { sha256: existingHash, role: "body", path: existing, sourcePath: existing,
        provenance: "ORIGINAL", creationMethod: "source" },
    ] as typeof h.manifest.imageAssets;
    const results = await h.generate(0, { requests: [
      { requestId: "global-existing", sectionId: "section" },
      { requestId: "global-fresh", sectionId: "section" },
    ] });
    assert.equal(h.sectionReviewCalls, 1, "all seller candidates must be compared in one semantic batch");
    assert.equal(h.sectionReviewCandidatePaths.length, 1);
    assert.deepEqual(new Set(h.sectionReviewCandidatePaths[0]), new Set([existing, fresh]));
    assert.equal(new Set(results.map(result => result.generatedPath)).size, 2);
    assert.equal(h.spawns, 0);
  });

  await check("sixteen generic local files cannot starve a later relevant seller URL", async () => {
    const local = Array.from({ length: 16 }, (_, index) => {
      const file = path.join(root, `generic-local-${index}.jpg`);
      fs.writeFileSync(file, `generic local seller photo ${index}`);
      return file;
    });
    const lateRelevant = path.join(root, "late-feature-evidence.jpg");
    fs.writeFileSync(lateRelevant, "late relevant seller feature panel");
    const h = harness({ reviewClass: "product-photo", sourcePaths: [lateRelevant], sectionMatchedPaths: [lateRelevant] });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    h.manifest.imageAssets = [
      { sha256: "hero", role: "hero", path: sourcePath, provenance: "LOCKED_PRODUCT" },
      ...local.map(file => ({
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        role: "body" as const,
        path: file,
        sourcePath: file,
        provenance: "ORIGINAL" as const,
        creationMethod: "source" as const,
      })),
    ] as typeof h.manifest.imageAssets;
    const results = await h.generate(0, {
      sourceImageUrls: ["https://fixture.test/late-feature-evidence.jpg"],
      requests: [{ requestId: "late-feature", sectionId: "section" }],
    });
    assert.equal(h.sectionReviewCalls, 1);
    assert.equal(h.sectionReviewCandidatePaths[0].length, 17,
      "the semantic reviewer receives both the full local quota and later URL evidence");
    assert.ok(h.sectionReviewCandidatePaths[0].includes(lateRelevant));
    assert.equal(results[0].generatedPath, lateRelevant);
    assert.equal(h.spawns, 0);
  });

  await check("generic product photos cannot bypass a failed section-intent review", async () => {
    const originals = [sourcePath, rawPath];
    const h = harness({ sourcePaths: originals, sectionMatchedPaths: [] });
    h.manifest.connectKind = "SHOPPING";
    const results = await h.generate(0, {
      sourceOnly: true,
      requests: originals.map((_, index) => ({ requestId: `semantic-reject-${index}`, sectionId: "section" })),
    });
    assert.equal(h.spawns, 0);
    assert.ok(results.every(result => !result.generatedPath));
    assert.ok(results.every(result => result.error?.includes("IMAGE_SOURCE_BINDING_REQUIRED")));
  });

  await check("feature section without a matching photo stays missing even if matching card facts are available", async () => {
    const run = async (settings: { cardMatches: number; sourceOnly?: boolean }) => {
      const h = harness({ sourcePaths: [sourcePath], sectionMatchedPaths: [], cardFacts: ["흡입력: 18,000Pa", "무게: 1.2kg"], cardMatches: settings.cardMatches });
      h.manifest.connectKind = "SHOPPING";
      h.manifest.imageRequirements = { policy: "verified-source-first" };
      const [result] = await h.generate(0, { sourceOnly: settings.sourceOnly, requests: [{ requestId: "feature", sectionId: "section" }] });
      assert.equal(h.spawns, 0);
      return result;
    };
    const carded = await run({ cardMatches: 1 });
    assert.match(carded.error || "", /IMAGE_SOURCE_BINDING_REQUIRED/u);
    assert.equal(carded.generatedPath, null);
    assert.match((await run({ cardMatches: 0 })).error || "", /IMAGE_SOURCE_BINDING_REQUIRED/u, "unrelated facts never stand in for a feature");
    assert.match((await run({ cardMatches: 1, sourceOnly: true })).error || "", /IMAGE_SOURCE_BINDING_REQUIRED/u, "source-only binding still reports the gap");
  });

  await check("bound originals cannot become fact cards to fill another body slot", async () => {
    const h = harness({ sourceMissing: true, sectionMatchedPaths: [], cardFacts: ["흡입력: 18,000Pa", "무게: 1.2kg"], cardMatches: 1 });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.imageRequirements = { policy: "verified-source-first" };
    h.manifest.imageAssets = [{ sha256: "orig", role: "body", sectionId: "other", path: sourcePath, provenance: "ORIGINAL", creationMethod: "source" }] as never;
    const [result] = await h.generate(0, { requests: [{ requestId: "feature", sectionId: "section" }] });
    assert.match(result.error || "", /SHOPPING_ORIGINAL_LIMIT/u);
    assert.equal(result.generatedPath, null);
  });

  await check("one reviewed feature source is never reused as generic evidence for another feature", async () => {
    const h = harness({ reviewClass: "product-photo",
      sourcePaths: [sourcePath],
      sectionMatchedPaths: [sourcePath],
      segmentablePaths: [sourcePath],
    });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    const results = await h.generate(0, { requests: [
      { requestId: "feature-one", sectionId: "section" },
      { requestId: "feature-two", sectionId: "section" },
    ] });
    assert.equal(h.spawns, 0);
    assert.equal(results.filter(result => result.generatedPath === sourcePath).length, 1);
    assert.equal(results.filter(result => result.error?.includes("SHOPPING_ORIGINAL_LIMIT")).length, 1);
  });

  await check("reviewed package originals bind only one body original slot", async () => {
    const existing = [sourcePath, rawPath];
    const h = harness({ reviewClass: "product-photo", sectionMatchedPaths: existing, sourceMissing: true });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    h.manifest.imageAssets = [
      { sha256: "hero", role: "hero", path: sourcePath, provenance: "LOCKED_PRODUCT" },
      ...existing.map(file => ({
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        role: "body" as const,
        path: file,
        sourcePath: file,
        provenance: "ORIGINAL" as const,
        creationMethod: "source" as const,
      })),
    ] as typeof h.manifest.imageAssets;
    const results = await h.generate(0, { requests: existing.map((_, index) => ({
      requestId: `bind-${index}`,
      sectionId: "section",
    })) });
    assert.equal(h.spawns, 0);
    assert.equal(results.filter(result => result.bindExistingAssetKey).length, 1);
    assert.equal(results.filter(result => result.error?.includes("SHOPPING_ORIGINAL_LIMIT")).length, 1);
    results.filter(result => result.generatedPath).forEach(result => {
      assert.equal(result.sourceReview?.usage, "section-matched-product-evidence");
      assert.equal(result.sourceReview?.reviewClass, "product-photo");
    });
  });

  await check("downloaded copies of bound originals and hero cannot re-enter source assignment", async () => {
    const heroCopy = path.join(root, "downloaded-existing-hero.jpg");
    const bodyCopy = path.join(root, "downloaded-existing-body.jpg");
    const fresh = path.join(root, "new-unique-evidence.jpg");
    fs.copyFileSync(rawPath, heroCopy); fs.copyFileSync(sourcePath, bodyCopy);
    fs.writeFileSync(fresh, "unique evidence not used by any package image");
    const bodyHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    const h = harness({ reviewClass: "product-photo", sourcePaths: [heroCopy, bodyCopy, fresh], sectionMatchedPaths: [heroCopy, bodyCopy, sourcePath, fresh] });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    h.manifest.imageAssets = [
      { path: rawPath, sourcePath: rawPath, role: "hero", sha256: crypto.createHash("sha256").update(fs.readFileSync(rawPath)).digest("hex"), provenance: "ORIGINAL", creationMethod: "source" },
      { path: sourcePath, sourcePath, role: "body", sectionId: "already-bound", sha256: bodyHash, provenance: "ORIGINAL", creationMethod: "source" },
    ];
    const results = await h.generate(1, { sourceOnly: true });
    assert.deepEqual(h.sectionReviewCandidatePaths[0], [fresh]);
    assert.equal(results[0].generatedPath, null);
    assert.match(results[0].error || "", /SHOPPING_ORIGINAL_LIMIT/);
    assert.equal(h.spawns, 0);
    // An explicit replacement may still inspect its own source; other slots
    // and the hero remain reserved. This preserves legitimate repair behavior.
    h.manifest.composition.sections.push({ ...h.manifest.composition.sections[0], id: "already-bound" });
    await h.generate(0, { sourceOnly: true, requests: [{ requestId: "replace-own", sectionId: "already-bound", replaceAssetKey: bodyHash }] });
    assert(h.sectionReviewCandidatePaths[1].includes(sourcePath));
    assert(!h.sectionReviewCandidatePaths[1].includes(heroCopy));
  });

  await check("source-only shopping repair preserves partial originals and never starts generation", async () => {
    const h = harness({ reviewClass: "product-photo", sourcePaths: [sourcePath], sectionMatchedPaths: [sourcePath], lockFails: false });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    const results = await h.generate(0, {
      sourceOnly: true,
      requests: Array.from({ length: 3 }, (_, index) => ({ requestId: `source-only-${index}`, sectionId: "section" })),
    });
    assert.equal(h.spawns, 0);
    assert.equal(h.lockCalls, 0);
    assert.equal(results.filter(result => result.provenance === "ORIGINAL" && result.generatedPath).length, 1);
    assert.equal(results.filter(result => result.error?.includes("SHOPPING_ORIGINAL_LIMIT")).length, 2);
  });

  await check("source-only overview slots reject unreviewed originals when section review is unavailable", async () => {
    const overviewA = path.join(root, "overview-a.jpg");
    const overviewB = path.join(root, "overview-b.jpg");
    fs.writeFileSync(overviewA, "overview-source-a");
    fs.writeFileSync(overviewB, "overview-source-b");
    const h = harness({
      sourcePaths: [overviewA, overviewB],
      sectionReviewError: "You've hit your usage limit",
    });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections = [
      { id: "hook", title: "샤워 뒤 물기 말리는 시간이 번거롭다면", imageIntent: "제품이 한눈에 보이는 대표 사진", body: ["소개"] },
      { id: "summary", title: "어떤 제품인지부터 보면", imageIntent: "전체 구성 또는 패키지 사진", body: ["요약"] },
      { id: "feature", title: "냉온풍이 만드는 차이", imageIntent: "해당 핵심 기능·작동 방식·조작부를 직접 보여주거나 공식 설명하는 판매페이지 근거 이미지", body: ["기능"] },
    ] as typeof h.manifest.composition.sections;
    const results = await h.generate(0, {
      sourceOnly: true,
      requests: [
        { requestId: "hook", sectionId: "hook" },
        { requestId: "summary", sectionId: "summary" },
        { requestId: "feature", sectionId: "feature" },
      ],
    });
    assert.equal(h.spawns, 0);
    assert.equal(h.sectionReviewCalls, 1);
    assert.equal(results.filter(result => result.provenance === "ORIGINAL" && result.generatedPath).length, 0);
    assert.ok(results.find(result => result.sectionId === "hook")?.error?.includes("usage limit"));
    assert.ok(results.find(result => result.sectionId === "summary")?.error?.includes("usage limit"));
    assert.ok(results.find(result => result.sectionId === "feature")?.error?.includes("IMAGE_SOURCE_BINDING_REQUIRED") ||
      results.find(result => result.sectionId === "feature")?.error?.includes("usage limit"));
  });

  await check("source-only replaces the one original slot and refuses original fillers for three AI slots", async () => {
    const stale = Array.from({ length: 4 }, (_, index) => {
      const file = path.join(root, `stale-feature-${index}.png`);
      fs.writeFileSync(file, `stale-feature-${index}`);
      return file;
    });
    const sources = Array.from({ length: 4 }, (_, index) => {
      const file = path.join(root, `fresh-feature-${index}.jpg`);
      fs.writeFileSync(file, `fresh-feature-source-${index}`);
      return file;
    });
    const h = harness({ reviewClass: "product-photo", sourcePaths: sources, sectionMatchedPaths: sources });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].imageSource = "seller-original";
    h.manifest.composition.sections = stale.map((_, index) => ({
      id: `feature-${index}`,
      title: `기능 ${index + 1}`,
      imageIntent: `기능 ${index + 1} 작동 장면`,
      body: ["기능 근거"],
      imagePaths: [stale[index]],
      imageSource: index === 0 ? "seller-original" : "staged-ai",
    })) as typeof h.manifest.composition.sections;
    h.manifest.imageAssets = [
      { sha256: "hero", role: "hero", path: sourcePath, provenance: "LOCKED_PRODUCT" },
      ...stale.map((file, index) => ({
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        role: "body" as const,
        sectionId: `legacy-${index}`,
        slotId: `legacy-${index}:image:1`,
        imageIntent: "구형 목적",
        path: file,
        sourcePath: file,
        provenance: "ORIGINAL" as const,
        creationMethod: "source" as const,
      })),
    ] as typeof h.manifest.imageAssets;
    const requests = stale.map((file, index) => ({
      requestId: `replace-feature-${index}`,
      sectionId: `feature-${index}`,
      slotId: `feature-${index}:image:1`,
      replaceAssetKey: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    }));
    const results = await h.generate(0, { sourceOnly: true, requests });
    assert.equal(h.spawns, 0);
    assert.equal(results.filter(result => result.generatedPath).length, 1);
    assert.equal(results.filter(result => result.error?.includes("IMAGE_GENERATION_REQUIRED")).length, 3);
    results.forEach((result, index) => {
      assert.equal(result.sectionId, `feature-${index}`);
      assert.equal(result.slotId, `feature-${index}:image:1`);
      assert.equal(result.imageIntent, `기능 ${index + 1} 작동 장면`);
      assert.equal(result.replaceAssetKey, requests[index].replaceAssetKey);
      if (index === 0) assert.equal(result.sourceReview?.reviewClass, "product-photo");
    });
  });

  await check("source-only travel repair never starts browser generation", async () => {
    const h = harness();
    const results = await h.generate(2, { sourceOnly: true });
    assert.equal(h.spawns, 0);
    assert.ok(results.every(result => !result.generatedPath));
    assert.ok(results.every(result => result.error?.includes("TRAVEL_SOURCE_ONLY_UNAVAILABLE")));
  });

  await check("a reviewed overview original remains the actual reference across distinct scene jobs", async () => {
    const outputs = Array.from({ length: 3 }, (_, index) => {
      const file = path.join(root, `mixed-output-${index}.png`);
      fs.writeFileSync(file, `mixed reference scene ${index}`);
      return file;
    });
    const h = harness({
      sourcePaths: [sourcePath],
      sectionMatchedPaths: [sourcePath],
      segmentablePaths: [sourcePath],
      lockedUsesBackground: true,
    });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.composition.sections[0].title = "어떤 제품인지부터 보면";
    h.manifest.composition.sections[0].imageIntent = "제품 전체 모습과 구성을 한눈에 보여주는 이미지";
    const pending = h.generate(0, { requests: Array.from({ length: 3 }, (_, index) => ({
      requestId: `mixed-${index}`,
      sectionId: "section",
    })) });
    await tick();
    assert.equal(h.jobs.length, 3, "scene generation keeps each requested slot as a distinct generation job");
    h.close(0, { ok: true, jobs: outputs.map((file, index) => h.result(index, file)) });
    const results = await pending;
    assert.equal(results.filter(result => result.provenance === "GENERATED_SCENE" && !result.error).length, 3);
    assert.ok(h.jobs.every(job => JSON.stringify(job.referenceImagePaths) === JSON.stringify([sourcePath])));
    assert.equal(h.lockCalls, 0);
  });

  await check("one overview product source completes three generated overview slots with distinct outputs", async () => {
    const outputs = Array.from({ length: 3 }, (_, index) => {
      const file = path.join(root, `scarce-output-${index}.png`);
      fs.writeFileSync(file, `distinct reference scene ${index}`);
      return file;
    });
    const h = harness({
      sourcePaths: [sourcePath],
      sectionMatchedPaths: [sourcePath],
      segmentablePaths: [sourcePath],
      lockedUsesBackground: true,
    });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.imageRequirements = { policy: "generated-required" };
    h.manifest.composition.sections[0].title = "어떤 제품인지부터 보면";
    h.manifest.composition.sections[0].imageIntent = "제품 전체 모습과 구성을 한눈에 보여주는 이미지";
    const pending = h.generate(0, { requests: Array.from({ length: 3 }, (_, index) => ({
      requestId: `scarce-${index}`,
      sectionId: "section",
    })) });
    await tick();
    assert.equal(h.jobs.length, 3);
    h.close(0, { ok: true, jobs: outputs.map((file, index) => h.result(index, file)) });
    const results = await pending;
    assert.equal(JSON.stringify(results.map(result => result.generatedPath)), JSON.stringify(outputs));
    assert.ok(results.every(result => result.provenance === "GENERATED_SCENE" && !result.error));
    assert.equal(h.lockCalls, 0);
    assert.ok(h.jobs.every(job => JSON.stringify(job.requiredReferenceHashes) === JSON.stringify([hashFile(sourcePath)])), "each distinct scene job binds the same verified original");
    assert.equal(new Set(h.jobs.map(job => job.outStem)).size, 3, "slot identity keeps reused-source outputs distinct");
  });

  await check("missing intact front reference blocks scenes without falling back to fact cards", async () => {
    const h = harness({ referenceRejected: true, cardFacts: ["용량: 4.5L", "가열식 살균 방식"] });
    h.manifest.connectKind = "SHOPPING";
    h.manifest.imageRequirements = { policy: "verified-source-first" };
    h.manifest.composition.sections[0].title = "어떤 제품인지부터 보면";
    h.manifest.composition.sections[0].imageIntent = "제품 전체 모습과 구성을 한눈에 보여주는 이미지";
    const results = await h.generate(0, { requests: [
      { requestId: "body", sectionId: "section" }, { requestId: "hero", replaceAssetKey: "hero" },
    ] });
    assert.equal(h.spawns, 0, "no generation is started without an intact reference");
    assert.ok(results.every(result => result.error?.includes("PRODUCT_REFERENCE_REQUIRED") && !result.generatedPath && result.provenance !== "EDITORIAL_CARD"), JSON.stringify(results));
    const noFacts = harness({ referenceRejected: true });
    noFacts.manifest.connectKind = "SHOPPING";
    noFacts.manifest.imageRequirements = { policy: "verified-source-first" };
    noFacts.manifest.composition.sections[0].title = "어떤 제품인지부터 보면";
    noFacts.manifest.composition.sections[0].imageIntent = "제품 전체 모습과 구성을 한눈에 보여주는 이미지";
    const [body] = await noFacts.generate(0, { requests: [{ requestId: "body", sectionId: "section" }] });
    assert.match(body.error || "", /PRODUCT_REFERENCE_REQUIRED/u, "the same reference gate applies without facts");
  });

  for (const sceneReviewError of [undefined, "REFERENCE_SCENE_REVIEW_FAILED: distorted geometry"]) {
    await check(`shopping scene review fails closed without cutout or card fallback (reviewFails=${Boolean(sceneReviewError)})`, async () => {
      const h = harness({ lockFails: true, sceneReviewError, sectionMatchedPaths: [sourcePath], cardFacts: ["용량: 4.5L", "가열식 살균 방식"] });
      h.manifest.connectKind = "SHOPPING";
      h.manifest.imageRequirements = { policy: "generated-required" };
      h.manifest.composition.sections[0].title = "어떤 제품인지부터 보면";
      h.manifest.composition.sections[0].imageIntent = "제품 전체 모습과 구성을 한눈에 보여주는 이미지";
      const outputs = Array.from({ length: 2 }, (_, index) => {
        const file = path.join(root, `scene-review-${Boolean(sceneReviewError)}-${index}.png`);
        fs.writeFileSync(file, `scene review output ${Boolean(sceneReviewError)} ${index}`);
        return file;
      });
      const pending = h.generate(0, { requests: [
        { requestId: "body", sectionId: "section" }, { requestId: "hero", replaceAssetKey: "hero" },
      ] });
      await tick(); // Shopping source preflight finishes before the worker is spawned.
      assert.equal(h.jobs.length, 1, "thumbnail uses original source locally, only body is generated");
      h.child.stderr.write(`${prefix}${JSON.stringify(h.result(0, outputs[0]))}\n`);
      await tick();
      assert.equal(h.callbacks.find(result => result.requestId === "body")!.generatedPath, sceneReviewError ? null : outputs[0]);
      h.close(0, { ok: true, jobs: [h.result(0, outputs[0])] });
      const results = await pending;
      assert.equal(h.lockCalls, 0, "no source cutout/composition participates in reference-guided scenes");
      assert.equal(results[1].provenance, "PHOTO_TEXT_THUMBNAIL");
      assert.equal(results[1].remoteGenerated, false);
      results.slice(0, 1).forEach((r, index) => {
        assert.equal(r.generatedPath, sceneReviewError ? null : outputs[index]);
        assert.equal(r.error, sceneReviewError);
        assert.equal(r.provenance, "GENERATED_SCENE");
        assert.equal(r.referenceScene?.reviewStatus, sceneReviewError ? undefined : "passed", "failed review must not retain approval evidence");
      });
      assert.match(h.jobs[0].prompt, /lifestyle photograph using the attached seller reference/);
      assert.doesNotMatch(h.jobs[0].prompt, /Generate the environment only/);
      assert.ok(h.jobs.every(job => JSON.stringify(job.referenceImagePaths) === JSON.stringify([sourcePath])));
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

async function verifyProducer(
  startupFailure = false,
  failFast = false,
  sessionFailure = false,
  downloadRetry = false,
  count = 3,
  downloadTimeout = false,
  networkFailure = false,
  preflightFailure = false,
) {
  process.env.BRAND_POST_IMAGE_BATCH_FAIL_FAST = failFast ? "true" : "false";
  const dir = fs.mkdtempSync(path.join(root, "producer-"));
  const jobsFile = path.join(dir, "jobs.json");
  const checkpoint = `${jobsFile}.results.jsonl`;
  const jobs = Array.from({ length: count }, (_, i) => ({ id: `슬롯-${i}`, prompt: "fake", outStem: path.join(dir, `raw-${i}`) }));
  fs.writeFileSync(jobsFile, JSON.stringify(jobs));
  let stdout = "";
  let stderr = "";
  let submitted = 0;
  let downloads = 0;
  let closed = false;
  let pagesOpened = 0;
  let preflightFailed = false;
  const page = { waitForTimeout: async () => {}, textContent: async () => "", close: async () => {},
    locator: () => ({ count: async () => 0 }) };
  const readRecords = () => fs.readFileSync(checkpoint, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const producerPolicy = downloadTimeout ? load<typeof imagePolicy>("scripts/lib/image-timeout-policy.ts", {}, {
    // Execute the real deadline helper with accelerated download timers, never leave
    // a 60-second sleep in the offline regression suite.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms === 60_000 ? 5 : ms),
  }) : imagePolicy;
  const api = load<{ main: () => Promise<void> }>("scripts/chatgpt-generate-image-batch.ts", {
    "dotenv/config": {}, fs, path, "node:crypto": crypto,
    "./lib/image-timeout-policy": producerPolicy,
    "./lib/image-batch-diagnostics": load("scripts/lib/image-batch-diagnostics.ts", {}),
    "./lib/chatgpt-browser": {
      createChatGPTContext: async () => {
        if (startupFailure) throw new Error("browser startup failed");
        return { context: { newPage: async () => { pagesOpened++; return page; } }, close: async () => {
          // Final stdout must be available even if browser cleanup hangs or fails.
          assert.equal(JSON.parse(stdout).jobs.length, count);
          closed = true;
        } };
      },
      openFreshChatGPTTarget: async () => {
        if (preflightFailure && !preflightFailed) { preflightFailed = true; throw new Error("Timeout preparing page"); }
        if (networkFailure && submitted === 0) {
          throw new Error("Image navigation failed: CHATGPT_BROWSER_UNREACHABLE: net::ERR_CERT_COMMON_NAME_INVALID");
        }
        if (!submitted) return;
        assert.equal(readRecords().length, submitted, "previous job must be checkpointed before next starts");
        assert.equal(stderr.split(prefix).length - 1, submitted, "previous job must emit progress before next starts");
      },
      submitPromptToChatGPT: async (_page: unknown, _prompt: string, _label: string, beforeSend?: () => void) => { beforeSend?.(); submitted += 1; },
      isChatGPTGenerating: async () => false,
      readAssistantMessages: async () => [], countRenderableChatGPTImages: async () => 1,
      // 0 = timed out without an artifact. The producer must fail the job instead of downloading nothing.
      waitForChatGPTImageReceipt: async () => {},
      countChatGPTPromptReceipts: async () => 0,
      waitForChatGPTImageArtifacts: async () => {
        if (submitted === 2 && sessionFailure) throw new Error("CHATGPT_BROWSER_AUTH_REQUIRED: secret-token@example.test");
        return submitted === 2 && failFast ? 0 : 1;
      },
      downloadChatGPTImages: async () => {
        downloads += 1;
        if (downloadTimeout && submitted === 2) return new Promise(() => {});
        if (downloadRetry && downloads === 1) return [];
        if (submitted === 2) throw new Error("one download failed secret-token@example.test");
        return [rawPath];
      },
    },
  }, { process: {
    ...process, argv: ["node", "script", "--jobs-file", jobsFile, "--gpt-url", "https://invalid.test"],
    stdout: { write: (chunk: string) => { stdout += chunk; } },
    stderr: { write: (chunk: string) => { stderr += chunk; } },
  } });
  if (startupFailure) await assert.rejects(api.main(), /browser startup failed/);
  else if (sessionFailure && failFast) await assert.rejects(api.main(), /세션 인증\/보안 오류/);
  else if (networkFailure) await assert.rejects(api.main(), /ChatGPT 연결 오류/);
  else await api.main();
  const output = JSON.parse(stdout);
  const records = readRecords();
  if (preflightFailure) assert.equal(pagesOpened, count + 1, "only pre-dispatch transient failure retries on a fresh page");
  assert.equal(output.ok, false, "any failed slot must make the batch unsuccessful");
  assert.ok(!stdout.includes("secret-token"));
  assert.ok(!stderr.includes("secret-token"));
  assert.deepEqual(output.jobs, records);
  assert.equal(records.length, count);
  assert.equal(stderr.split(prefix).length - 1, count);
  if (startupFailure) records.forEach((r) => assert.match(r.error, /browser startup failed/));
  else if (sessionFailure && failFast) {
    assert.equal(closed, true);
    assert.equal(submitted, 2, "fail-fast must not submit the third prompt");
    assert.ok(fs.existsSync(records[0].localPath));
    assert.match(records[1].error, /CHATGPT_BROWSER_AUTH_REQUIRED/);
    assert.match(records[2].error, /^fail-fast: /);
    assert.equal(records[2].localPath, null);
  } else if (networkFailure) {
    assert.equal(closed, true);
    assert.equal(submitted, 0, "certificate failure must not submit the first or remaining prompts");
    assert.match(records[0].error, /^CHATGPT_BROWSER_UNREACHABLE:/u);
    records.slice(1).forEach((record) => {
      assert.match(record.error, /^fail-fast: CHATGPT_BROWSER_UNREACHABLE:/u);
      assert.equal(record.localPath, null);
    });
  } else {
    assert.equal(closed, true);
    assert.equal(submitted, count);
    assert.ok(fs.existsSync(records[0].localPath));
    assert.match(records[1].error, failFast || downloadTimeout ? /IMAGE_TIMEOUT/ : /IMAGE_SLOT_FAILED/);
    records.slice(2).forEach((record) => assert.ok(fs.existsSync(record.localPath)));
  }
  if (!startupFailure) {
    const diagnosticDirs = fs.readdirSync(dir).filter((entry) => entry.startsWith("_chatgpt_"));
    const diagnostics = diagnosticDirs.flatMap((entry) => {
      const file = path.join(dir, entry, "failure.json");
      return fs.existsSync(file) ? [fs.readFileSync(file, "utf8")] : [];
    });
    assert.equal(diagnostics.length, preflightFailure ? 2 : 1);
    assert.ok(!diagnostics[0].includes("secret-token"));
    const diagnostic = JSON.parse(diagnostics[0]);
    assert.equal(diagnostic.category, sessionFailure
      ? "session-auth-security"
      : networkFailure
        ? "session-network"
        : "individual");
    assert.equal(diagnostic.hardMs, 600_000);
    if (downloadTimeout) {
      assert.equal(diagnostic.phase, "download");
      assert.equal(diagnostic.timedOut, true);
      assert.match(records[1].error, /이미지 다운로드 시간 초과/);
      assert.match(records[1].error, /최대 60초/);
      assert.equal(downloads, count, "pending download is not retried; later slots continue");
    }
  }
  if (downloadRetry) assert.equal(downloads, 4, "empty retrieval retries once without another submission");
  const priorCheckpoint = fs.readFileSync(checkpoint, "utf8");
  fs.writeFileSync(`${checkpoint}.lock`, JSON.stringify({ pid: process.pid, token: "live-test-owner" }));
  await assert.rejects(api.main(), /EEXIST/);
  assert.equal(fs.readFileSync(checkpoint, "utf8"), priorCheckpoint, "live owner must not lose durable evidence");
}

async function verifyIntegratedResume() {
  let submits = 0;
  let opens = 0;
  let loginFailure = false;
  let uncertain = false;
  const page = { waitForTimeout: async () => {}, textContent: async () => "", close: async () => {},
    locator: () => ({ first() { return this; }, count: async () => 1, setInputFiles: async () => {} }) };
  const h = harness({ worker: (args, child) => {
    const worker = load<{ main: () => Promise<void> }>("scripts/chatgpt-generate-image-batch.ts", {
      "dotenv/config": {}, fs, path, "node:crypto": crypto,
      "./lib/image-timeout-policy": imagePolicy,
      "./lib/image-batch-diagnostics": load("scripts/lib/image-batch-diagnostics.ts", {}),
      "./lib/chatgpt-browser": {
        createChatGPTContext: async () => { opens++; return { context: { newPage: async () => page }, close: async () => {} }; },
        openFreshChatGPTTarget: async () => {},
        navigateToChatGpt: async () => {},
        // Exercise login failure inside submit's pre-dispatch checks, not only navigation.
        submitPromptToChatGPT: async (_page: unknown, _prompt: string, _label: string, beforeSend: () => void) => {
          if (loginFailure) throw new Error("CHATGPT_BROWSER_AUTH_REQUIRED: login");
          beforeSend(); submits++;
          if (uncertain) throw new Error("click dispatched but acknowledgement lost");
        },
        isChatGPTGenerating: async () => false, readAssistantMessages: async () => [],
        waitForChatGPTImageReceipt: async () => {},
        countChatGPTPromptReceipts: async () => 0,
        countRenderableChatGPTImages: async () => 1, waitForChatGPTImageArtifacts: async () => 1,
        downloadChatGPTImages: async () => [rawPath],
      },
    }, { process: { ...process, argv: ["node", "worker", ...args.slice(args.indexOf("--jobs-file"))],
      env: { ...process.env, BRAND_POST_IMAGE_BATCH_FAIL_FAST: "true" },
      stdout: { write: (value: string) => child.stdout.write(value) },
      stderr: { write: (value: string) => child.stderr.write(value) },
    } });
    void worker.main().then(() => child.emit("close", 0, null), () => child.emit("close", 1, null));
  } });
  h.manifest.createdAt = "2026-09-05T01:00:00Z";
  const second = { ...h.manifest.composition.sections[0], id: "second", title: "두 번째" };
  h.manifest.composition.sections.push(second);
  const requests = [{ requestId: "a", sectionId: "section" }, { requestId: "b", sectionId: "second" }];
  assert.ok((await h.generate(0, { requests })).every(result => result.generatedPath));
  const originalStems = h.jobs.map(job => job.outStem);
  const originalCheckpoint = h.checkpoint;
  const originalJobsFile = originalCheckpoint.replace(/\.results\.jsonl$/, "");
  const originalJobs = fs.readFileSync(originalJobsFile, "utf8");
  assert.equal(submits, 2);
  assert.ok((await h.generate(0, { requests: requests.map(r => ({ ...r, requestId: "new-" + r.requestId })) })).every(r => r.generatedPath));
  assert.equal(h.checkpoint, originalCheckpoint, "request IDs do not change stable jobs/results paths");
  assert.equal(fs.readFileSync(originalJobsFile, "utf8"), originalJobs, "resume preserves the jobs document");
  assert.equal(submits, 2);
  assert.equal(opens, 1, "complete batch resume does not open a profile");
  assert.ok((await h.generate(0, { requests: [requests[1]] }))[0].generatedPath);
  assert.equal(h.jobs[0].outStem, originalStems[1], "subset and transport ID changes preserve slot identity");
  assert.equal(submits, 2);
  second.imageIntent = "새로운 프롬프트";
  assert.ok((await h.generate(0, { requests: [requests[1]] }))[0].generatedPath);
  assert.notEqual(h.jobs[0].outStem, originalStems[1]);
  assert.equal(submits, 3, "changed prompt gets a new identity");
  h.manifest.createdAt = "2026-09-05T02:00:00Z";
  assert.ok((await h.generate(0, { requests: [requests[0]] }))[0].generatedPath);
  assert.equal(h.jobs[0].outStem, originalStems[0]);
  assert.equal(submits, 3, "timestamp-only draft changes reuse the completed visual-intent checkpoint");
  loginFailure = true;
  second.imageIntent = "로그인 복구";
  assert.match((await h.generate(0, { requests: [requests[1]] }))[0].error!, /AUTH_REQUIRED/);
  const loginCheckpoint = h.checkpoint;
  assert.equal(submits, 3, "login failure does not send");
  loginFailure = false;
  assert.ok((await h.generate(0, { requests: [requests[1]] }))[0].generatedPath, "old checkpoint failure must not mask successful retry");
  assert.equal(h.checkpoint, loginCheckpoint);
  assert.equal(submits, 4, "definitive pre-send login failure can be retried");
  uncertain = true;
  second.imageIntent = "불확실한 전송";
  assert.ok((await h.generate(0, { requests: [requests[1]] }))[0].error);
  assert.equal(submits, 5);
  uncertain = false;
  assert.match((await h.generate(0, { requests: [requests[1]] }))[0].error!, /IMAGE_RESUME_REQUIRED/);
  assert.equal(submits, 5, "uncertain transmitted request is never regenerated");
  const savedReference = fs.readFileSync(sourcePath);
  try {
    fs.writeFileSync(sourcePath, "changed reference bytes");
    assert.ok((await h.generate(0, { requests: [requests[0]] }))[0].generatedPath);
    assert.equal(submits, 6, "changed reference content cannot reuse an older result");
    const referenceStem = h.jobs[0].outStem;
    // Different batches still contend on the same slot lock.
    const slotLock = `${referenceStem}.lock`;
    fs.writeFileSync(slotLock, JSON.stringify({ pid: process.pid, token: "other-live-batch" }));
    const blocked = await h.generate(0, { requests: [requests[0], requests[1]] });
    assert.ok(blocked.every(result => result.error));
    assert.equal(submits, 6);
    assert.equal(JSON.parse(fs.readFileSync(slotLock, "utf8")).token, "other-live-batch");
    fs.unlinkSync(slotLock);
  } finally { fs.writeFileSync(sourcePath, savedReference); }
}

async function main() {
  try {
    await verifyReviewOnlyRecovery();
    await verifyGenerator();
    await check("caller and actual worker: stable draft/section/prompt identity, subset resume, login retry, uncertain-send protection", verifyIntegratedResume);
    await check("producer checkpoints each job, streams stderr, preserves legacy stdout (fail-fast off)", () => verifyProducer());
    await check("producer startup failure checkpoints per-job errors", () => verifyProducer(true));
    await check("individual timeout continues remaining slots even with fail-fast enabled", () => verifyProducer(false, true));
    await check("a timeout does not skip the ten remaining slots", () => verifyProducer(false, true, false, false, 12));
    await check("explicit session auth failure stops and records remaining slots", () => verifyProducer(false, true, true));
    await check("certificate failure preserves unreachable and stops all prompts", () => verifyProducer(false, false, false, false, 10, false, true));
    await check("empty artifact retrieval retries safely without regenerating", () => verifyProducer(false, false, false, true));
    await check("pre-dispatch transient failure retries once on a new page", () => verifyProducer(false, false, false, false, 3, false, false, true));
    await check("timed-out retrieval is never retried concurrently; category and later slots survive", () => verifyProducer(false, false, false, false, 3, true));
    console.log(`Verified ${checks} offline image-batch checks; no paid generation.`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

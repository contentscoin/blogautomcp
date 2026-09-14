/**
 * Offline reproducer for same-section image identity collisions.
 * Run from any directory:
 *   node docs/qa/2026-09-07-image-audit-repro.cjs
 *
 * Loads the existing VM transport harness and CURRENT production functions.
 * Browser, worker spawn, image finishing and package access are harness mocks.
 * No network, browser, image generation, or production-file mutation occurs.
 * Updated after remediation: PASS proves distinct slots have distinct identities.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

const repo = path.resolve(__dirname, "../..");
process.chdir(repo);
const ts = require(path.join(repo, "node_modules/typescript"));
require(path.join(repo, "node_modules/ts-node")).register({
  project: path.join(repo, "tsconfig.scripts.json"),
});

// Only allow recursive cleanup of fixture roots actually created by this run.
const ownedRoots = new Set();
const originalMkdtemp = fs.mkdtempSync;
const originalRm = fs.rmSync;
fs.mkdtempSync = function (prefix, options) {
  const created = originalMkdtemp.call(fs, prefix, options);
  const resolved = path.resolve(String(created));
  if (
    path.dirname(resolved) === path.resolve(os.tmpdir()) &&
    path.basename(resolved).startsWith("verify-image-batch-")
  ) ownedRoots.add(resolved);
  return created;
};
fs.rmSync = function (target, options) {
  const resolved = path.resolve(String(target));
  if (options?.recursive) {
    assert.ok(ownedRoots.has(resolved), "Refusing cleanup outside this run's verified fixture roots");
  }
  return originalRm.call(fs, resolved, options);
};

const filename = path.join(repo, "scripts/verify-image-batch-progress.ts");
let source = fs.readFileSync(filename, "utf8");
const autorun = "main().catch((error) => { console.error(error); process.exitCode = 1; });";
assert.equal(source.split(autorun).length, 2, "Harness entrypoint changed; review before running");
source = source.replace(autorun, "");
source += `
(async () => {
  const h = harness();
  const pending = h.generate(2);
  await tick();
  try {
    assert.equal(h.jobs.length, 2);
    assert.notEqual(h.jobs[0].id, h.jobs[1].id);
    assert.notEqual(h.jobs[0].outStem, h.jobs[1].outStem,
      "Different slots must have distinct raw identities");
    assert.notEqual(h.jobs[0].prompt, h.jobs[1].prompt);
  } finally {
    h.close(0, { ok: true, jobs: [h.result(0), h.result(1)] });
    await pending;
  }
  const slots = h.resolveBrandPostImageSlots(h.manifest, [{ requestId: "one", sectionId: "section" }, { requestId: "two", sectionId: "section" }]);
  assert.notEqual(slots[0].slotId, slots[1].slotId);
  h.manifest.composition.sections[0].imagePaths = [rawPath];
  h.manifest.imageAssets.push({ path: rawPath, sha256: "second-image", role: "body", sectionId: "section", slotId: slots[1].slotId });
  const retry = h.resolveBrandPostImageSlots(h.manifest, [{ requestId: "changed-transport-id", sectionId: "section" }]);
  assert.equal(retry[0].slotId, slots[0].slotId, "subset retry fills the failed first slot even after slot two completed");
  assert.throws(() => h.resolveBrandPostImageSlots(h.manifest, [slots[0], slots[0]]), /IMAGE_SLOT_DUPLICATE/);
  const old = harness();
  const first = old.generate(1); await tick();
  const job = old.jobs[0];
  old.close(0, { ok: true, jobs: [old.result(0)] }); await first;
  const oldIdentity = crypto.createHash("sha256").update(JSON.stringify({
    version: 1, brandLinkId: old.manifest.brandLinkId, draftCreatedAt: old.manifest.createdAt,
    title: old.manifest.title, sectionId: "section", role: "body",
    prompt: job.prompt.slice(0, job.prompt.lastIndexOf("\\nImage slot: ")),
    references: job.referenceImagePaths.map(file => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") })),
  })).digest("hex");
  fs.writeFileSync(path.join(path.dirname(job.outStem), "raw-" + oldIdentity + ".checkpoint.jsonl"), "legacy ambiguous record");
  const blocked = await old.generate(1);
  assert.match(blocked[0].error, /IMAGE_RESUME_REQUIRED/);
  assert.equal(old.spawns, 1, "v1 pending journal never creates a fresh v2 generation");
  console.log("PASS regression: distinct requests in one section have distinct raw output identity/checkpoint.");
  console.log("Evidence: request count=2, transport IDs distinct, prompt distinct, outStem distinct.");
  console.log("Offline only: zero browser/network/provider calls; production sources unchanged.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(root, { recursive: true, force: true }));
`;

const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(code, filename);

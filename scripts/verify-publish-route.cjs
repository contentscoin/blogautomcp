// Offline route integration: all filesystem, process and database mutations mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
let status = 'READY', manifest, previous, receipt, ready = true, spawns = 0, spawnOptions;
let handlers = {};
const updates = [];
const mocks = {
  'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
  '@/lib/db': { prisma: { brandLink: {
    findUnique: async () => ({ id: 'fixture-product', status, connectKind: 'SHOPPING' }),
    updateMany: async data => { updates.push(data); return { count: 1 }; },
  } } },
  child_process: { spawn: (_binary, _args, options) => { spawns++; spawnOptions = options; handlers = {}; return { pid: 100, on: (event, callback) => { handlers[event] = callback; }, unref() {} }; } },
  path,
  fs: { mkdirSync() {}, openSync: () => 10, writeSync() {}, closeSync() {} },
  '@/lib/api-auth': { requireAdminApiKey: () => null },
  '@/lib/update-guard': { requireNoPendingDesktopUpdate: () => null },
  '@/lib/brandconnect-kind': {},
  '@/lib/connect-contract-store': {},
  '@/lib/material-library': { materialRevision: () => 'current-revision' },
  '@/lib/brand-post-package': {
    readBrandPostPackage: (_id, options) => { assert.equal(options.migrate, false); return manifest; },
    getBrandPostPackageManifestPath: () => 'fixture-manifest.json',
    evaluateBrandPostPackageReadiness: () => ({ canApprove: ready, blockers: ready ? [] : [{ reason: 'missing image' }] }),
  },
  '@/lib/publish-attempt': {
    recordPublisherPid: (_product, _id, pid) => assert.equal(pid, 100),
    readPublishAttempt: () => receipt || previous,
    createPublishAttempt: () => receipt = { id: 'attempt-fixture', stage: 'PREPARING', mode: 'now', snapshotManifestPath: 'frozen-manifest.json' },
    updatePublishAttempt: (_product, _id, stage) => { receipt.stage = stage; return receipt; },
    interruptedPublishStatus: attempt => attempt?.stage === 'PREPARING' ? 'FAILED' : 'OUTCOME_UNKNOWN',
  },
};
const moduleInstance = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/brandlinks/[id]/publish/route.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, {
  module: moduleInstance, exports: moduleInstance.exports, console, Date, Map, Intl,
  process: { cwd: () => process.cwd(), execPath: process.execPath, env: { DRY_RUN_GENERATE_ONLY: 'true', BRANDLINK_REVISE_REQUEST: 'stale-request' } },
  require: name => { if (!(name in mocks)) throw Error(`Unexpected dependency ${name}`); return mocks[name]; },
});
const call = body => moduleInstance.exports.POST({ json: async () => body }, { params: Promise.resolve({ id: 'fixture-product' }) });
const request = { publishMode: 'now', materialRevision: 'current-revision' };
async function main() {
  assert.equal((await call(request)).status, 409);
  manifest = { approvedAt: null, generationSource: 'AI' };
  assert.equal((await call(request)).status, 409);
  manifest.approvedAt = 'fixture';
  for (const value of ['OUTCOME_UNKNOWN', 'PUBLISHED', 'SCHEDULED', 'DRAFTING']) {
    status = value; assert.equal((await call(request)).status, 409);
  }
  status = 'READY';
  assert.equal((await call({ ...request, materialRevision: 'stale' })).body.code, 'MATERIAL_CHANGED');
  ready = false; assert.equal((await call(request)).body.code, 'MATERIAL_NOT_READY'); ready = true;
  previous = { stage: 'SUBMITTING' }; assert.equal((await call(request)).body.code, 'OUTCOME_UNKNOWN'); previous = null;
  assert.equal(spawns, 0);
  assert.equal((await call(request)).status, 200);
  assert.equal(spawns, 1);
  assert.equal(spawnOptions.env.BRANDLINK_PUBLISH_ONLY, 'true');
  assert.equal(spawnOptions.env.DRY_RUN_GENERATE_ONLY, 'false');
  assert.equal(spawnOptions.env.BRANDLINK_REVISE_REQUEST, '');
  assert.equal(spawnOptions.env.BRANDLINK_PUBLISH_ATTEMPT_ID, 'attempt-fixture');
  assert.equal(spawnOptions.env.BRANDLINK_PREPARED_POST_MANIFEST, 'frozen-manifest.json');
  receipt = { id: 'attempt-fixture', mode: 'now', stage: 'CONFIRMED', updatedAt: '2026-09-08T00:00:00Z', evidence: { postUrl: 'https://blog.naver.com/account/123' } };
  handlers.exit(1, null);
  assert.equal(updates.at(-1).data.status, 'PUBLISHED', 'confirmed submission survives cleanup/nonzero child exit');
  receipt = { id: 'attempt-fixture', mode: 'now', stage: 'SUBMITTING' };
  handlers.exit(1, null);
  assert.equal(updates.at(-1).data.status, 'OUTCOME_UNKNOWN');
  // Execute only the actual PATCH declaration with injected collaborators.
  const draftSource = ts.createSourceFile('draft.ts', fs.readFileSync('src/app/api/brandlinks/[id]/draft/route.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const patch = draftSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PATCH');
  const patchModule = { exports: {} };
  let approvals = 0, revalidations = 0, claimCount = 1, approvalThrows = false;
  const approveUpdates = [];
  class SavedTextRevalidationError extends Error {
    constructor(message, code = 'QC_SOURCE_REQUIRED') { super(message); this.code = code; }
  }
  vm.runInNewContext(ts.transpileModule(patch.getText(draftSource), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    module: patchModule, exports: patchModule.exports,
    requireAdminApiKey: () => null, isBrandPostImageRepairActive: () => false,
    NextResponse: mocks['next/server'].NextResponse, classifyLocalFailure: () => 'FAILED',
    prisma: { brandLink: { findUnique: async () => ({ status }), updateMany: async value => { approveUpdates.push(value); return { count: claimCount }; } } },
    SavedTextRevalidationError,
    revalidatePackageForApproval: () => { revalidations++; assert.equal(approveUpdates.at(-1).data.status, 'DRAFTING'); },
    approveBrandPostPackage: () => { approvals++; assert.equal(approveUpdates.at(-1).data.status, 'DRAFTING'); if (approvalThrows) throw Error('fixture'); return { approvedAt: 'fixture' }; },
    packagePreview: value => value,
  });
  const approve = () => patchModule.exports.PATCH({ json: async () => ({ action: 'approve' }) }, { params: Promise.resolve({ id: 'fixture-product' }) });
  for (const value of ['PUBLISHING', 'OUTCOME_UNKNOWN', 'SCHEDULED', 'DRAFTING']) { status = value; assert.equal((await approve()).status, 409); }
  status = 'READY'; claimCount = 0; assert.equal((await approve()).status, 409); assert.equal(approvals, 0);
  assert.equal(revalidations, 0);
  claimCount = 1; assert.equal((await approve()).status, 200); assert.equal(approveUpdates.at(-1).data.status, 'READY');
  assert.equal(revalidations, 1, 'current evaluator runs before approval');
  assert.equal(approvals, 1);
  status = 'FAILED'; approvalThrows = true; assert.equal((await approve()).status, 400); assert.equal(approveUpdates.at(-1).data.status, 'FAILED');
  console.log('Publish route: saved approval/revision/readiness, unknown replay protection, no generation flags, receipt recovery passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

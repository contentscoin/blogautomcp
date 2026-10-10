/** Offline regression fixture: actual material API/library/date code, mocked boundaries.
 * Run: node --test scripts/verify-material-api.cjs
 * No production database, filesystem writes, network, generation or publication.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(relative, dependencies, globals = {}) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, Buffer, Date, Intl,
    process: { pid: 12345 }, ...globals,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  new vm.Script(source, { filename }).runInContext(context);
  return module.exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const json = (body, options = {}) => ({ status: options.status || 200, body: clone(body) });

function harness() {
  const state = { now: '2026-09-07T03:00:00.000Z', authorized: true, updateBlocked: false,
    products: new Map(), manifests: new Map(), jobs: new Map(), runs: [], saves: 0,
    locks: 0, activities: 0, productReads: 0, countReads: 0, runnerError: null, progress: new Map(), publicationAttempts: new Map(), missingDraftFiles: new Set() };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return Date.parse(state.now); }
  }
  const library = load('src/lib/material-library.ts', {
    'node:crypto': crypto,
    'node:fs': { readFileSync: file => Buffer.from(`fixture bytes: ${file}`) },
    './brand-post-package': {
      readBrandPostPackage: id => state.manifests.get(id) || null,
      evaluateBrandPostPackageReadiness: manifest => ({
        contentScore: 100, composition: null,
        // The real shared evaluator owns generation liveness (tested in the
        // image integrity suite); API must consume its blockers, not raw flags.
        blockers: [...(manifest.fixtureBlockers || []), ...(manifest.imageGeneration?.status === 'running' ? [{ code: 'images-running', reason: 'Image worker is running' }] : [])],
        imageGeneration: manifest.imageGeneration || null,
      }),
    },
  });
  const dates = load('src/lib/bulk-schedule-plan.ts', {}, { Date: FakeDate });
  const failures = load('src/lib/material-failed-candidates.ts', {
    './db': { prisma: { brandLink: { findMany: async ({ where }) => [...state.products.values()].filter(p => !where || p.connectKind === where.connectKind) } } },
    './material-library': library,
    './material-job-store': { listMaterialJobs: () => [...state.jobs.values()].map(clone) },
    './draft-progress': { readDraftProgress: id => state.progress.get(id) || null },
  });
  const repairs = load('src/lib/material-repair-candidates.ts', {
    'node:fs': {
      statSync: filename => { if (state.missingDraftFiles.has(filename)) throw new Error('missing manuscript'); return { isFile: () => true }; },
      readFileSync: () => 'saved manuscript',
    },
    './db': { prisma: { brandLink: { findMany: async ({ where }) => [...state.products.values()].filter(p => !where || p.connectKind === where.connectKind) } } },
    './material-library': library,
    './brand-post-package': { readBrandPostPackage: id => state.manifests.get(id) || null },
    './publish-attempt': { readPublishAttempt: id => state.publicationAttempts.get(id) || null },
    './material-job-store': { listMaterialJobs: () => [...state.jobs.values()].map(clone) },
  });
  const api = load('src/lib/material-api.ts', {
    'node:crypto': crypto,
    'next/server': { NextResponse: { json } },
    './db': { prisma: { brandLink: {
      count: async () => { state.countReads++; return [...state.products.values()].filter(p => ['PUBLISHING', 'DRAFTING'].includes(p.status)).length; },
      findUnique: async ({ where }) => { state.productReads++; return state.products.get(where.id) || null; },
      findMany: async ({ where }) => [...state.products.values()].filter(p => !where ||
        (where.id?.in ? where.id.in.includes(p.id) : p.connectKind === where.connectKind)),
    } } },
    './api-auth': { requireAdminApiKey: () => state.authorized ? null : json({ success: false }, { status: 401 }) },
    './update-guard': { requireNoPendingDesktopUpdate: () => state.updateBlocked ? json({ success: false }, { status: 423 }) : null },
    './desktop-activity': { beginAutomaticPublishing: () => { state.activities++; return () => { state.activities--; }; } },
    './material-library': library,
    './material-job-store': {
      acquireMaterialJobLock: () => {
        if (state.locks) throw new Error('Existing material job');
        state.locks++;
        return () => { state.locks--; };
      },
      listMaterialJobs: () => [...state.jobs.values()].map(clone),
      readMaterialJob: id => state.jobs.has(id) ? clone(state.jobs.get(id)) : null,
      saveMaterialJob: job => { state.saves++; state.jobs.set(job.jobId, clone(job)); },
      materialJobFailureCodes: error => {
        const errorCode = typeof error?.code === 'string' ? error.code : undefined;
        const causeCode = typeof error?.cause?.code === 'string' ? error.cause.code : undefined;
        return { ...(errorCode ? { errorCode } : {}), ...(causeCode ? { causeCode } : {}) };
      },
      materialJobErrorMessage: error => typeof error?.message === 'string' ? error.message : String(error),
    },
    './material-job-runner': { runMaterialJob: async job => { state.runs.push(clone(job)); if (state.runnerError) throw state.runnerError; } },
    './bulk-schedule-plan': dates,
    './material-failed-candidates': failures,
    './material-repair-candidates': repairs,
  }, { Date: FakeDate });
  function product(index = 0, status = 'READY') {
    const id = `product_${String(index).padStart(4, '0')}`;
    state.products.set(id, { id, status, productName: `Product ${index}`, connectKind: index % 2 ? 'TRAVEL' : 'SHOPPING', scheduledPublishAt: null });
    state.manifests.set(id, { version: 'brand-post-package/v1', productId: id, title: `Title ${index}`,
      connectKind: index % 2 ? 'TRAVEL' : 'SHOPPING', createdAt: state.now, approvedAt: state.now,
      markdownPath: `${id}.md`, heroImagePath: `${id}.png`, bodyImagePaths: [], contentQuality: { score: 100 } });
    return { productId: id, revision: library.getMaterial(id).revision };
  }
  function request(body, query = '') { return { nextUrl: new URL(`http://fixture.invalid/api/materials${query}`), json: async () => body }; }
  return { state, api, product, request, library, failures, repairs,
    post: (body, kind = 'publish') => api.materialsPost(request(body), kind),
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
  };
}

function assertNoDispatch(h) {
  assert.equal(h.state.runs.length, 0, 'no runner dispatch / no publication');
  assert.equal(h.state.saves, 0, 'invalid request must not persist executable job');
  assert.equal(h.state.locks, 0, 'lock released');
  assert.equal(h.state.activities, 0, 'activity released');
}

test('missing, empty, duplicate and malformed selections cannot dispatch', async () => {
  for (const make of [() => undefined, () => [], item => [item, item],
    item => [{ ...item, revision: 'bad' }], item => [{ ...item, productId: '../unsafe' }], () => [null]]) {
    const h = harness(); const item = h.product();
    const response = await h.post({ materials: make(item), publishMode: 'now' });
    assert.equal(response.status, 409); assertNoDispatch(h);
  }
});

test('stale revision and unapproved or incomplete package cannot dispatch', async () => {
  for (const change of [manifest => { manifest.title = 'Changed after selection'; },
    manifest => { manifest.approvedAt = null; },
    manifest => { manifest.imageGeneration = { status: 'running' }; },
    manifest => { manifest.fixtureBlockers = [{ reason: 'Quality check failed' }]; }]) {
    const h = harness(); const item = h.product(); change(h.state.manifests.get(item.productId));
    const response = await h.post({ materials: [item], publishMode: 'now' });
    assert.equal(response.status, 409); assertNoDispatch(h);
  }
});

test('explicit startDate creates ten schedule targets from READY products with no stored date', async () => {
  const h = harness(); const materials = Array.from({ length: 10 }, (_, i) => h.product(i));
  const response = await h.post({ materials, publishMode: 'schedule', startDate: '2026-09-08', intervalDays: 1, sourceJobId: 'mcp-ten' });
  assert.equal(response.status, 202); assert.equal(h.state.runs.length, 1);
  assert.equal(response.body.data.items.length, 10);
  assert.deepEqual(response.body.data.items.map(item => item.scheduledDate),
    Array.from({ length: 10 }, (_, i) => `2026-09-${String(8 + i).padStart(2, '0')}`));
  assert.deepEqual(response.body.data.items.map(({ productId, revision }) => ({ productId, revision })), materials);
  assert.ok([...h.state.products.values()].every(product => product.scheduledPublishAt === null));
  await h.settle(); assert.equal(h.state.locks, 0); assert.equal(h.state.activities, 0);
});

test('same sourceJobId replays completed job next day before date/product checks', async () => {
  const h = harness(); const item = h.product();
  const body = { materials: [item], publishMode: 'schedule', scheduledAt: '2026-09-08', sourceJobId: 'lost-response-job' };
  const original = await h.post(body); await h.settle();
  const saved = h.state.jobs.get(original.body.data.jobId); saved.status = 'completed'; saved.items[0].status = 'scheduled';
  h.state.products.get(item.productId).status = 'SCHEDULED';
  h.state.now = '2026-09-08T03:00:00.000Z';
  const reads = h.state.productReads;
  const replay = await h.post(body);
  assert.equal(replay.status, 200); assert.equal(replay.body.data.jobId, original.body.data.jobId);
  assert.equal(replay.body.data.status, 'completed'); assert.equal(h.state.runs.length, 1);
  assert.equal(h.state.productReads, reads, 'replay precedes current product validation');
  assert.equal(h.state.saves, 1);
  const lookup = await h.api.materialsGet(h.request(null, '?sourceJobId=lost-response-job'));
  assert.equal(lookup.status, 200); assert.equal(lookup.body.data.jobId, original.body.data.jobId);
});

test('same identity with changed revision, dates, mode or kind returns 409 without rerun', async () => {
  const h = harness(); const item = h.product();
  const body = { materials: [item], publishMode: 'schedule', scheduledAt: '2026-09-08', sourceJobId: 'identity-1' };
  await h.post(body); await h.settle();
  for (const changed of [{ ...body, materials: [{ ...item, revision: 'b'.repeat(64) }] },
    { ...body, scheduledAt: '2026-09-09' }, { ...body, publishMode: 'now' }]) {
    const response = await h.post(changed);
    assert.equal(response.status, 409); assert.match(response.body.error, /같은 요청 ID/);
  }
  assert.equal((await h.post({ productIds: [item.productId], sourceJobId: body.sourceJobId }, 'prepare')).status, 409);
  assert.equal(h.state.runs.length, 1); assert.equal(h.state.saves, 1);
});

test('malformed JSON and unauthenticated requests cannot dispatch or expose jobs', async () => {
  const h = harness();
  const malformed = { json: async () => JSON.parse('{') };
  assert.equal((await h.api.materialsPost(malformed, 'publish')).status, 409); assertNoDispatch(h);
  h.state.authorized = false;
  assert.equal((await h.api.materialsPost(malformed, 'publish')).status, 401);
  assert.equal((await h.api.materialsGet(h.request(null, '?sourceJobId=private'))).status, 401);
  assert.equal(h.state.countReads, 0); assertNoDispatch(h);
});

test('OUTCOME_UNKNOWN and already published products reject both preparation and publication', async () => {
  for (const status of ['OUTCOME_UNKNOWN', 'PUBLISHED', 'SCHEDULED', 'PUBLISHING', 'DRAFTING']) {
    for (const kind of ['prepare', 'publish']) {
      const h = harness(); const item = h.product(0, status);
      const response = await h.post(kind === 'prepare' ? { productIds: [item.productId] } : { materials: [item], publishMode: 'now' }, kind);
      assert.equal(response.status, 409, `${status}/${kind}`); assertNoDispatch(h);
    }
  }
});

test('fresh invalid dates and intervals reject without dispatch', async () => {
  for (const options of [{ scheduledAt: '2026-09-07' }, { scheduledAt: '2026-02-30' },
    {}, { scheduledAt: '2026-09-08', intervalDays: 0 }, { scheduledAt: '2026-09-08', intervalDays: 1.5 }]) {
    const h = harness(); const item = h.product();
    assert.equal((await h.post({ materials: [item], publishMode: 'schedule', ...options })).status, 409);
    assertNoDispatch(h);
  }
});

test('prepare dispatch is a separate job and contains no publication selection or mode', async () => {
  const h = harness(); const item = h.product(); h.state.manifests.clear();
  const response = await h.post({ productIds: [item.productId], sourceJobId: 'prepare-1' }, 'prepare');
  assert.equal(response.status, 202); assert.equal(h.state.runs[0].kind, 'prepare');
  assert.equal(h.state.runs[0].publishMode, undefined); assert.equal(h.state.runs[0].items[0].revision, undefined);
  await h.settle();
});

function failed(h, index = 0, options = {}) {
  const item = h.product(index, options.productStatus || 'FAILED');
  if (options.missing) h.state.manifests.delete(item.productId);
  else h.state.manifests.get(item.productId).approvedAt = null;
  const id = `failure-${index}`;
  h.state.jobs.set(id, { jobId: id, kind: options.kind || 'prepare', status: 'failed', ownerPid: 1,
    startedAt: '2026-09-06T03:00:00.000Z', updatedAt: '2026-09-06T03:10:00.000Z',
    items: [{ productId: item.productId, status: options.itemStatus || 'failed', stage: '확인 필요', error: '원고 품질 실패', errorCode: options.code || 'CONTENT_BLOCKED' }] });
  return item;
}

test('failed candidates include failed writing/missing drafts and exclude ready, published and publish failures', async () => {
  const h = harness(); const recover = failed(h, 0); const missing = failed(h, 2, { missing: true });
  h.product(4); failed(h, 6, { kind: 'publish', missing: true });
  failed(h, 8, { productStatus: 'OUTCOME_UNKNOWN' }); failed(h, 10, { productStatus: 'SCHEDULED' });
  failed(h, 12, { itemStatus: 'ready' }); failed(h, 14, { code: 'PREPARATION_RESULT_UNCERTAIN' });
  const response = await h.api.materialsGet(h.request(null));
  assert.equal(response.body.data.failedCandidateCount, 2);
  assert.deepEqual(response.body.data.failedCandidates.map(item => item.productId), [recover.productId, missing.productId]);
  assert.equal(response.body.data.failedCandidates[1].verificationStatus, 'DRAFT_MISSING');
});

test('entire failed rewrite includes more than fifty targets without truncation and cannot publish', async () => {
  const h = harness(); for (let i = 0; i < 60; i++) failed(h, i);
  const response = await h.api.materialsRewriteFailedPost(h.request({ sourceJobId: 'rewrite-all' }));
  assert.equal(response.status, 202); assert.equal(response.body.data.items.length, 60);
  assert.equal(response.body.data.acceptedCount, 60); assert.equal(h.state.runs[0].kind, 'rewrite');
  assert.equal(response.body.data.publishMode, undefined);
  assert.ok(response.body.data.items.every(item => item.previousErrorCode === 'CONTENT_BLOCKED'));
  await h.settle(); assert.equal(h.state.locks, 0);
});

test('rewrite source identity hashes original intent and replays after old targets recover and new failures appear', async () => {
  const h = harness(); const old = failed(h);
  const body = { connectKind: 'shopping', sourceJobId: 'recover-once' };
  const response = await h.api.materialsRewriteFailedPost(h.request(body)); await h.settle();
  h.state.manifests.get(old.productId).approvedAt = h.state.now;
  const stored = h.state.jobs.get(response.body.data.jobId); stored.status = 'completed'; stored.items[0].status = 'ready';
  failed(h, 2);
  const replay = await h.api.materialsRewriteFailedPost(h.request({ ...body, connectKind: 'SHOPPING' }));
  assert.equal(replay.status, 200); assert.equal(replay.body.data.jobId, response.body.data.jobId);
  assert.deepEqual(replay.body.data.items.map(item => item.productId), [old.productId]);
  assert.equal(h.state.runs.length, 1);
  const changed = await h.api.materialsRewriteFailedPost(h.request({ ...body, productIds: ['product_0002'] }));
  assert.equal(changed.status, 409); assert.equal(changed.body.code, 'REQUEST_ID_CONFLICT');
});

test('rewrite double click cannot start two local jobs', async () => {
  const h = harness(); failed(h);
  const requests = await Promise.all([0, 1].map(() => h.api.materialsRewriteFailedPost(h.request({ sourceJobId: 'double-click' }))));
  assert.ok(requests.some(response => response.status === 202));
  assert.equal(h.state.runs.length, 1); assert.equal(h.state.saves, 1); await h.settle();
});

test('rewrite explicitly selected restored/nonfailed products reject before a runner starts', async () => {
  const h = harness(); const healthy = h.product();
  const response = await h.api.materialsRewriteFailedPost(h.request({ productIds: [healthy.productId] }));
  assert.equal(response.status, 409); assert.equal(response.body.code, 'FAILED_MATERIAL_SELECTION_CHANGED'); assertNoDispatch(h);
});

test('rewrite no-target identity persists a completed empty result rather than selecting later failures on replay', async () => {
  const h = harness();
  const initial = await h.api.materialsRewriteFailedPost(h.request({ sourceJobId: 'no-failures' }));
  assert.equal(initial.status, 200); assert.equal(initial.body.data.acceptedCount, 0);
  failed(h);
  const replay = await h.api.materialsRewriteFailedPost(h.request({ sourceJobId: 'no-failures' }));
  assert.equal(replay.body.data.jobId, initial.body.data.jobId); assert.equal(replay.body.data.items.length, 0);
  assert.equal(h.state.runs.length, 0); assert.equal(h.state.locks, 0);
});

test('rewrite authentication, update, malformed ids and busy product gates block mutations', async () => {
  for (const body of [[], 'unsafe-default-all', { publishMode: 'now' }, { connectKind: 'unknown' }, { productIds: [] }, { productIds: ['../unsafe'] }, { sourceJobId: '' }]) {
    const h = harness(); assert.equal((await h.api.materialsRewriteFailedPost(h.request(body))).status, 409); assertNoDispatch(h);
  }
  const h = harness(); failed(h); h.product(2, 'DRAFTING');
  assert.equal((await h.api.materialsRewriteFailedPost(h.request({}))).status, 409); assertNoDispatch(h);
  h.state.authorized = false; assert.equal((await h.api.materialsRewriteFailedPost(h.request({}))).status, 401);
  h.state.authorized = true; h.state.updateBlocked = true; assert.equal((await h.api.materialsRewriteFailedPost(h.request({}))).status, 423);
});

test('unexpected runner failure stores only legacy text and safe structured codes', async () => {
  const h = harness(); const item = h.product();
  const cause = Object.assign(new Error('DO_NOT_STORE_CAUSE_MESSAGE'), {
    code: 'CODEX_MODEL_INCOMPATIBLE', stack: 'DO_NOT_STORE_CAUSE_STACK',
  });
  h.state.runnerError = Object.assign(new Error('shared writer unavailable', { cause }), {
    code: 'LLM_UNAVAILABLE', stack: 'DO_NOT_STORE_OUTER_STACK',
  });
  const response = await h.post({ productIds: [item.productId] }, 'prepare');
  assert.equal(response.status, 202);
  await h.settle();
  const stored = h.state.jobs.get(response.body.data.jobId);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.items[0].error, 'shared writer unavailable');
  assert.equal(stored.items[0].errorCode, 'LLM_UNAVAILABLE');
  assert.equal(stored.items[0].causeCode, 'CODEX_MODEL_INCOMPATIBLE');
  assert.doesNotMatch(JSON.stringify(stored), /DO_NOT_STORE_(?:CAUSE_MESSAGE|CAUSE_STACK|OUTER_STACK)/);
});

test('material status never presents a blocked READY product as publish-ready', async () => {
  const h = harness();
  const ready = h.product(0, 'READY');
  const blocked = h.product(1, 'READY');
  h.state.manifests.get(blocked.productId).approvedAt = null;
  const preparing = h.product(2, 'READY');
  h.state.manifests.get(preparing.productId).imageGeneration = {
    status: 'running', requested: 10, applied: 8, remaining: 2,
    errors: ['private diagnostic'], ownerPid: 4321, ownerToken: 'must-not-leak',
    updatedAt: '2026-09-07T03:01:00.000Z', heartbeatAt: '2026-09-07T03:01:01.000Z',
  };
  const response = await h.api.materialsGet(h.request(null));
  const byId = new Map(response.body.data.materials.map(item => [item.productId, item]));
  assert.equal(byId.get(ready.productId).status, 'READY');
  assert.equal(byId.get(ready.productId).materialStatus, 'READY');
  assert.equal(byId.get(ready.productId).productStatus, 'READY');
  assert.equal(byId.get(ready.productId).ready, true);
  assert.equal(byId.get(blocked.productId).status, 'BLOCKED');
  assert.equal(byId.get(blocked.productId).materialStatus, 'BLOCKED');
  assert.equal(byId.get(blocked.productId).productStatus, 'READY');
  assert.equal(byId.get(blocked.productId).ready, false);
  assert.equal(byId.get(preparing.productId).status, 'PREPARING');
  assert.equal(byId.get(preparing.productId).ready, false);
  assert.deepEqual(byId.get(preparing.productId).imageGeneration, {
    status: 'running', requested: 10, applied: 8, remaining: 2,
    updatedAt: '2026-09-07T03:01:00.000Z', heartbeatAt: '2026-09-07T03:01:01.000Z',
  });
  assert.ok(!JSON.stringify(response.body).includes('must-not-leak'));
  assert.ok(!JSON.stringify(response.body).includes('private diagnostic'));
});

test('terminal material job remains workflow-pending while detached image work is running', async () => {
  const h = harness();
  const item = h.product(0, 'READY');
  const manifest = h.state.manifests.get(item.productId);
  manifest.imageGeneration = {
    status: 'running', requested: 10, applied: 8, remaining: 2, errors: [],
    updatedAt: '2026-09-07T03:01:00.000Z', ownerPid: 4321,
  };
  h.state.jobs.set('terminal-job', {
    jobId: 'terminal-job', kind: 'prepare', status: 'failed', startedAt: h.state.now,
    updatedAt: h.state.now, events: [], items: [{
      productId: item.productId, status: 'interrupted', stage: '확인 필요',
      error: 'shared writer unavailable', errorCode: 'LLM_UNAVAILABLE', causeCode: 'CODEX_MODEL_INCOMPATIBLE',
    }],
  });
  const pending = await h.api.materialsGet(h.request(null, '?jobId=terminal-job'));
  assert.equal(pending.body.data.status, 'failed', 'the durable job result is preserved');
  assert.equal(pending.body.data.workflowPending, true, 'detached work remains visible after terminal job status');
  assert.equal(pending.body.data.materials[0].status, 'PREPARING');
  assert.equal(pending.body.data.items[0].error, 'shared writer unavailable', 'legacy error text remains in the API');
  assert.equal(pending.body.data.items[0].errorCode, 'LLM_UNAVAILABLE');
  assert.equal(pending.body.data.items[0].causeCode, 'CODEX_MODEL_INCOMPATIBLE');
  delete manifest.imageGeneration;
  const settled = await h.api.materialsGet(h.request(null, '?jobId=terminal-job'));
  assert.equal(settled.body.data.workflowPending, false);
  assert.equal(settled.body.data.materials[0].status, 'READY');
});

function blocked(h, index = 0) {
  const item = h.product(index);
  h.state.manifests.get(item.productId).approvedAt = null;
  return item;
}

test('repair listing selects saved unready manuscripts, including approval-only items, without requiring previous failures', async () => {
  const h = harness(); const needs = blocked(h, 0); h.product(2); h.product(4, 'PUBLISHED');
  const missing = blocked(h, 6); h.state.manifests.delete(missing.productId);
  const absentFile = blocked(h, 8); h.state.missingDraftFiles.add(h.state.manifests.get(absentFile.productId).markdownPath);
  const running = blocked(h, 10); h.state.manifests.get(running.productId).imageGeneration = { status: 'running' };
  const response = await h.api.materialsGet(h.request(null));
  assert.equal(response.body.data.repairCandidateCount, 1);
  assert.deepEqual(response.body.data.repairCandidates.map(item => item.productId), [needs.productId]);
  assert.equal(response.body.data.failedCandidateCount, 0, 'repair and failed-writing selection serve different requirements');
});

test('entire repair handles sixty saved blocked items and dispatches no publication/full-rewrite mode', async () => {
  const h = harness(); for (let i = 0; i < 60; i++) blocked(h, i);
  const result = await h.api.materialsRepairBlockedPost(h.request({ sourceJobId: 'repair-all' }));
  assert.equal(result.status, 202); assert.equal(result.body.data.acceptedCount, 60);
  assert.equal(h.state.runs[0].kind, 'repair'); assert.equal(h.state.runs[0].publishMode, undefined);
  assert.ok(result.body.data.items.every(item => item.verificationStatus === 'BLOCKED'));
  await h.settle(); assert.equal(h.state.locks, 0); assert.equal(h.state.activities, 0);
});

test('repair intent identity replays original targets after completion rather than selecting later blocked drafts', async () => {
  const h = harness(); const item = blocked(h, 0);
  const input = { connectKind: 'shopping', sourceJobId: 'repair-identity' };
  const first = await h.api.materialsRepairBlockedPost(h.request(input)); await h.settle();
  h.state.manifests.get(item.productId).approvedAt = h.state.now;
  const saved = h.state.jobs.get(first.body.data.jobId); saved.status = 'completed'; saved.items[0].status = 'ready';
  blocked(h, 2);
  const replay = await h.api.materialsRepairBlockedPost(h.request({ ...input, connectKind: 'SHOPPING' }));
  assert.equal(replay.status, 200); assert.equal(replay.body.data.jobId, first.body.data.jobId);
  assert.deepEqual(replay.body.data.items.map(item => item.productId), [item.productId]); assert.equal(h.state.runs.length, 1);
  const conflict = await h.api.materialsRewriteFailedPost(h.request(input));
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'REQUEST_ID_CONFLICT');
});

test('double repair clicks are serialized through the same exclusive material lock', async () => {
  const h = harness(); blocked(h);
  const results = await Promise.all([0, 1].map(() => h.api.materialsRepairBlockedPost(h.request({ sourceJobId: 'repair-double' }))));
  assert.ok(results.some(result => result.status === 202)); assert.equal(h.state.runs.length, 1); assert.equal(h.state.saves, 1);
  await h.settle();
});

test('explicit repair rejects restored, missing and uncertain items before saving a job', async () => {
  for (const change of [h => { h.state.manifests.get('product_0000').approvedAt = h.state.now; },
    h => { h.state.manifests.delete('product_0000'); },
    h => { h.state.publicationAttempts.set('product_0000', { stage: 'OUTCOME_UNKNOWN' }); }]) {
    const h = harness(); const item = blocked(h); change(h);
    const response = await h.api.materialsRepairBlockedPost(h.request({ productIds: [item.productId] }));
    assert.equal(response.status, 409); assert.equal(response.body.code, 'MATERIAL_REPAIR_SELECTION_CHANGED'); assertNoDispatch(h);
  }
});

test('repair empty identity stays empty on replay even when new blocked manuscripts appear', async () => {
  const h = harness(); const input = { sourceJobId: 'repair-empty' };
  const first = await h.api.materialsRepairBlockedPost(h.request(input)); blocked(h);
  const replay = await h.api.materialsRepairBlockedPost(h.request(input));
  assert.equal(replay.body.data.jobId, first.body.data.jobId); assert.equal(replay.body.data.items.length, 0); assert.equal(h.state.runs.length, 0);
});

test('repair malformed/auth/update/busy requests cannot mutate', async () => {
  for (const input of [[], 'unsafe', null, { connectKind: 'wrong' }, { productIds: [] }, { productIds: ['../unsafe'] }, { sourceJobId: '' }, { publishMode: 'now' }]) {
    const h = harness(); const response = await h.api.materialsRepairBlockedPost(h.request(input));
    assert.equal(response.status, 409); assertNoDispatch(h);
  }
  const h = harness(); blocked(h); h.product(2, 'DRAFTING');
  assert.equal((await h.api.materialsRepairBlockedPost(h.request({}))).status, 409); assertNoDispatch(h);
  h.state.authorized = false; assert.equal((await h.api.materialsRepairBlockedPost(h.request({}))).status, 401);
  h.state.authorized = true; h.state.updateBlocked = true; assert.equal((await h.api.materialsRepairBlockedPost(h.request({}))).status, 423);
});


test('job views distinguish restored current materials from immutable failed execution history', async () => {
  const h = harness(); const selected = h.product(0);
  const oldJob = { jobId: 'old-failure', kind: 'prepare', status: 'failed', startedAt: h.state.now,
    items: [{ productId: selected.productId, status: 'failed', stage: '확인 필요', error: 'old ambiguity', errorCode: 'IMAGE_OUTPUT_AMBIGUOUS' }] };
  h.state.jobs.set(oldJob.jobId, oldJob);
  const result = await h.api.materialsGet(h.request(undefined, '?jobId=old-failure'));
  assert.equal(result.body.data.currentReadyCount, 1);
  assert.equal(result.body.data.readyCount, 0);
  assert.equal(result.body.data.items[0].error, 'old ambiguity');
  assert.equal(result.body.data.status, 'failed');
  const history = await h.api.materialsGet(h.request(undefined, '?jobsOnly=1'));
  assert.equal(history.body.data.materials[0].ready, true);
  assert.equal(history.body.data.materials[0].status, 'READY');
  assert.deepEqual(history.body.data.jobs[0], oldJob);
  assert.equal(h.state.saves, 0); assert.equal(h.state.runs.length, 0);
});

test('old ready execution cannot certify a currently blocked or uncertain material', async () => {
  const h = harness(); const selected = h.product(0);
  h.state.manifests.get(selected.productId).fixtureBlockers = [{ reason: 'source mismatch' }];
  h.state.jobs.set('past-ready', { jobId: 'past-ready', kind: 'repair', status: 'completed', startedAt: h.state.now,
    items: [{ productId: selected.productId, status: 'ready', stage: '준비완료' }] });
  const result = await h.api.materialsGet(h.request(undefined, '?jobId=past-ready'));
  assert.equal(result.body.data.readyCount, 1); assert.equal(result.body.data.currentReadyCount, 0);
  assert.equal(result.body.data.currentBlockedCount, 1);
  h.state.products.get(selected.productId).status = 'OUTCOME_UNKNOWN';
  const history = await h.api.materialsGet(h.request(undefined, '?jobsOnly=1'));
  assert.equal(history.body.data.materials[0].ready, false);
  assert.equal(history.body.data.materials[0].status, 'OUTCOME_UNKNOWN');
  assert.equal(h.state.saves, 0);
});

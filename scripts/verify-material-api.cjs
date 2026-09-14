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
    locks: 0, activities: 0, productReads: 0, countReads: 0 };
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
    },
    './material-job-runner': { runMaterialJob: async job => { state.runs.push(clone(job)); } },
    './bulk-schedule-plan': dates,
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
  return { state, api, product, request, library,
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
    updatedAt: h.state.now, events: [], items: [{ productId: item.productId, status: 'interrupted', stage: '확인 필요' }],
  });
  const pending = await h.api.materialsGet(h.request(null, '?jobId=terminal-job'));
  assert.equal(pending.body.data.status, 'failed', 'the durable job result is preserved');
  assert.equal(pending.body.data.workflowPending, true, 'detached work remains visible after terminal job status');
  assert.equal(pending.body.data.materials[0].status, 'PREPARING');
  delete manifest.imageGeneration;
  const settled = await h.api.materialsGet(h.request(null, '?jobId=terminal-job'));
  assert.equal(settled.body.data.workflowPending, false);
  assert.equal(settled.body.data.materials[0].status, 'READY');
});

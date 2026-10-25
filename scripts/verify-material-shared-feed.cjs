/* eslint-disable @typescript-eslint/no-require-imports -- Offline client lifecycle and selection fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadClientDisplay } = require('./lib/client-display-fixture.cjs');
const settle = async () => { for (let index = 0; index < 35; index++) await Promise.resolve(); };
const response = data => ({ ok: true, json: async () => ({ success: true, data }) });
const snapshot = (overrides = {}) => ({ materials: [], jobs: [], failedCandidates: [], repairCandidates: [], ...overrides });
function environment() {
  let now = 0, serial = 0;
  const timers = new Map(), listeners = new Set(), desktopListeners = new Set(), requests = [];
  const visibility = { hidden: false, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const desktop = { __brandconnectMaterialUiVisible: true, addEventListener: (_name, fn) => desktopListeners.add(fn), removeEventListener: (_name, fn) => desktopListeners.delete(fn) };
  const globals = { AbortController, setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const options = { visibility, desktopVisibility: desktop, requireDesktopVisibility: true,
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) };
  return { options, globals, requests, timers, listeners, desktopListeners,
    hidden(value) { desktop.__brandconnectMaterialUiVisible = !value; for (const callback of desktopListeners) callback(); },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await settle(); },
  };
}

test('three consumers share one metadata GET, unchanged observations do not rerender, and idle cadence is 60 seconds', async () => {
  const f = environment();
  const { createMaterialSummaryStore } = loadClientDisplay('src/lib/material-summary-store.ts', () => {}, f.globals);
  const store = createMaterialSummaryStore(f.options), delivered = [0, 0, 0];
  const cleanups = delivered.map((_value, index) => store.subscribe({ onData: () => delivered[index]++ }));
  await settle(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/api/materials?summary=1');
  f.requests[0].resolve(response(snapshot({ readinessObservedAt: 'first' }))); await settle();
  assert.deepEqual(delivered, [1, 1, 1]);
  await f.advance(59999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(response(snapshot({ readinessObservedAt: 'second' }))); await settle();
  assert.deepEqual(delivered, [1, 1, 1], 'clock-only responses retain stable UI rows');
  cleanups.forEach(cleanup => cleanup()); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('shared refreshes coalesce behind the old GET and hidden/unmounted consumers cannot start photo or metadata reads', async () => {
  const f = environment();
  const { createMaterialSummaryStore } = loadClientDisplay('src/lib/material-summary-store.ts', () => {}, f.globals);
  const store = createMaterialSummaryStore(f.options);
  const stopA = store.subscribe({ onData() {} }), stopB = store.subscribe({ onData() {} });
  await settle(); const a = store.refresh(), b = store.refresh();
  f.requests[0].resolve(response(snapshot())); await settle();
  assert.equal(f.requests.length, 2, 'one fresh snapshot, not one per consumer');
  f.requests[1].resolve(response(snapshot({ jobs: [{ status: 'running' }] }))); await Promise.all([a, b]);
  await f.advance(5000); assert.equal(f.requests.length, 3);
  f.hidden(true); assert.equal(f.requests[2].init.signal.aborted, true); await settle();
  await f.advance(120000); assert.equal(f.requests.length, 3);
  f.hidden(false); await settle(); assert.equal(f.requests.length, 4);
  stopA(); assert.equal(f.requests[3].init.signal.aborted, false, 'remaining consumer owns the shared request');
  stopB(); assert.equal(f.requests[3].init.signal.aborted, true);
  assert(!f.requests.some(request => request.url.includes('/images') || request.url.includes('jobsOnly')));
});

test('selection obtains a current strict revision for only selected products and rejects stale summaries or failed checks', async () => {
  const { verifyMaterialSelection, materialSelectionMatches } = loadClientDisplay('src/lib/material-selection.ts', () => {});
  const products = [{ productId: 'product-one', revision: 'summary-one', ready: true }];
  const requests = [];
  const request = async url => { requests.push(url); return response({ materials: [{ productId: 'product-one', revision: 'a'.repeat(64), summaryRevision: 'summary-one', ready: true, status: 'READY' }] }); };
  const selected = await verifyMaterialSelection(products, request);
  assert.equal(requests.length, 1); assert.equal(requests[0], '/api/materials?productIds=product-one');
  assert.equal(selected['product-one'].revision, 'a'.repeat(64));
  assert.notEqual(selected['product-one'].revision, products[0].revision);
  assert.equal(materialSelectionMatches(selected, products[0]), true);
  assert.equal(materialSelectionMatches(selected, { ...products[0], revision: 'changed' }), false);
  for (const fresh of [{ ready: false, status: 'BLOCKED' }, { ready: true, status: 'READY', summaryRevision: 'changed' }, { ready: true, status: 'READY', revision: 'summary-one' }]) {
    await assert.rejects(verifyMaterialSelection(products, async () => response({ materials: [{ productId: 'product-one', revision: 'a'.repeat(64), summaryRevision: 'summary-one', ...fresh }] })), /변경됐거나/);
  }
  await assert.rejects(verifyMaterialSelection(products, async () => response({ materials: [] })), /변경됐거나/);
});

test('running preview reads metadata only, reads the full preview once after completion, and never repeats photo payloads', async () => {
  const f = environment(), previews = [];
  const { startDraftImageProgressPolling } = loadClientDisplay('src/lib/draft-image-progress-polling.ts', () => {}, f.globals);
  const polling = startDraftImageProgressPolling({ ...f.options, productId: 'product-one', wasRunning: true, onPreview: preview => previews.push(preview) });
  await settle(); assert.match(f.requests[0].url, /progressOnly=1$/);
  f.requests[0].resolve(response({ progressOnly: true, imageGeneration: { status: 'running', remaining: 2 } })); await settle();
  await f.advance(3000); assert.match(f.requests[1].url, /progressOnly=1$/);
  f.requests[1].resolve(response({ progressOnly: true, imageGeneration: { status: 'complete' } })); await settle();
  assert.equal(f.requests.length, 3); assert.equal(f.requests[2].url, '/api/brandlinks/product-one/draft');
  f.requests[2].resolve(response({ imageGeneration: { status: 'complete' }, heroPreviewDataUrl: 'one final preview' })); await settle();
  await f.advance(120000); assert.equal(f.requests.length, 3); assert.equal(previews.length, 1);
  polling.stop();
});

test('hidden preview starts no GET, aborts existing work and ignores late full-preview results after cleanup', async () => {
  const f = environment(); f.hidden(true);
  const { startDraftImageProgressPolling } = loadClientDisplay('src/lib/draft-image-progress-polling.ts', () => {}, f.globals);
  const previews = [], polling = startDraftImageProgressPolling({ ...f.options, productId: 'product-one', wasRunning: true, onPreview: preview => previews.push(preview) });
  await settle(); await f.advance(120000); assert.equal(f.requests.length, 0);
  f.hidden(false); await settle(); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(response({ progressOnly: true, imageGeneration: { status: 'complete' } })); await settle();
  assert.equal(f.requests.length, 2); polling.stop();
  assert.equal(f.requests[1].init.signal.aborted, true);
  f.requests[1].resolve(response({ imageGeneration: { status: 'complete' } })); await settle();
  assert.equal(previews.length, 0); await f.advance(120000); assert.equal(f.requests.length, 2);
});

test('a new image action which has not started on the server does not fetch a full old preview', async () => {
  const f = environment();
  const { startDraftImageProgressPolling } = loadClientDisplay('src/lib/draft-image-progress-polling.ts', () => {}, f.globals);
  const polling = startDraftImageProgressPolling({ ...f.options, productId: 'product-one', wasRunning: false, onPreview() { assert.fail('no completed result yet'); } });
  await settle(); f.requests[0].resolve(response({ progressOnly: true, imageGeneration: null })); await settle();
  assert.equal(f.requests.length, 1); polling.stop();
});

test('a hidden in-flight metadata response cannot trigger a full preview or photo read', async () => {
  const f = environment();
  const { startDraftImageProgressPolling } = loadClientDisplay('src/lib/draft-image-progress-polling.ts', () => {}, f.globals);
  const polling = startDraftImageProgressPolling({ ...f.options, productId: 'product-one', wasRunning: true, onPreview() { assert.fail('hidden result'); } });
  await settle(); f.hidden(true); await settle();
  assert.equal(f.requests[0].init.signal.aborted, true);
  f.requests[0].resolve(response({ progressOnly: true, imageGeneration: { status: 'complete' } })); await settle();
  await f.advance(120000); assert.equal(f.requests.length, 1); polling.stop();
});

test('the image action owns its final preview; its polling feed does not download a duplicate final payload', async () => {
  const f = environment();
  const { startDraftImageProgressPolling } = loadClientDisplay('src/lib/draft-image-progress-polling.ts', () => {}, f.globals);
  const polling = startDraftImageProgressPolling({ ...f.options, productId: 'product-one', wasRunning: true,
    waitForOwningRequest: true, onPreview() { assert.fail('the action returns its final preview'); } });
  await settle(); f.requests[0].resolve(response({ progressOnly: true, imageGeneration: { status: 'complete' } })); await settle();
  await f.advance(120000); assert.equal(f.requests.length, 1); polling.stop();
});

test('an uncertain owner is retained in the final preview rather than shown as completed', async () => {
  const f = environment(), previews = [];
  const { startDraftImageProgressPolling } = loadClientDisplay('src/lib/draft-image-progress-polling.ts', () => {}, f.globals);
  const polling = startDraftImageProgressPolling({ ...f.options, productId: 'product-one', wasRunning: true, onPreview: preview => previews.push(preview) });
  await settle();
  const uncertain = { status: 'incomplete', recoveryState: 'owner-unknown', remaining: 2, errors: ['IMAGE_RESUME_REQUIRED'] };
  f.requests[0].resolve(response({ progressOnly: true, imageGeneration: uncertain })); await settle();
  f.requests[1].resolve(response({ imageGeneration: uncertain, approvedAt: null })); await settle();
  assert.equal(previews.length, 1); assert.equal(previews[0].imageGeneration.recoveryState, 'owner-unknown');
  assert.equal(previews[0].imageGeneration.status, 'incomplete'); assert.equal(previews[0].approvedAt, null);
  polling.stop();
});

test('actual consumers use the shared summary feed and page progress uses the metadata lifecycle', () => {
  for (const name of ['MaterialLibrary', 'MaterialJobProgress']) {
    const source = fs.readFileSync(`src/components/${name}.tsx`, 'utf8');
    assert.match(source, /getMaterialSummaryStore\(\)/);
    assert.doesNotMatch(source, /fetch\("\/api\/materials\?jobsOnly=1"/);
  }
  const page = fs.readFileSync('src/app/page.tsx', 'utf8');
  const effect = page.split('if (!previewId || (!draftImageActionKey && !draftImagesRunning)) return;')[1].split('const [draftCreationMode')[0];
  assert.match(effect, /startDraftImageProgressPolling/); assert.doesNotMatch(effect, /setInterval|fetch\(/);
  assert.match(fs.readFileSync('src/components/MaterialLibrary.tsx', 'utf8'), /verifyMaterialSelection\(products, fetch, controller.signal\)/);
});

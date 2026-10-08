const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const localRequire = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(`${name.slice(2)}.ts`, mocks) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}
const { saveRewrite } = load('lib/material-rewrite-request.ts');
const { saveRepair } = load('lib/material-repair-request.ts');
const guard = load('lib/material-recovery-guard.ts');
function storageFixture() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
const base = { version: 1, connectKind: 'shopping', idempotencyKey: 'shared-pending-request' };

test('an unknown request in either panel blocks both new recovery actions after reload', () => {
  for (const operation of ['rewrite', 'repair']) {
    const storage = storageFixture();
    (operation === 'rewrite' ? saveRewrite : saveRepair)(storage, 'owner', base);
    for (const action of ['rewrite', 'repair']) assert.equal(guard.canStartNewRecovery(storage, 'owner', action), false);
    const reloaded = load('lib/material-recovery-guard.ts');
    assert.equal(reloaded.canStartNewRecovery(storage, 'owner', operation === 'rewrite' ? 'repair' : 'rewrite'), false);
    assert.equal(guard.canStartNewRecovery(storage, 'another-account', 'repair'), true);
  }
});

test('PC workflow completion is required before the other panel can start', () => {
  const storage = storageFixture();
  for (const recoveryState of [undefined, 'pending', 'workflowPending']) {
    saveRepair(storage, 'owner', { ...base, repairJobId: 'job_repair', recoveryState });
    assert.equal(guard.canStartNewRecovery(storage, 'owner', 'rewrite'), false);
  }
  saveRepair(storage, 'owner', { ...base, repairJobId: 'job_repair', recoveryState: 'complete' });
  assert.equal(guard.canStartNewRecovery(storage, 'owner', 'rewrite'), true);
  assert.equal(guard.observedRecoveryState('SUCCEEDED', true), 'workflowPending');
  assert.equal(guard.observedRecoveryState('SUCCEEDED', undefined), 'workflowPending');
  assert.equal(guard.observedRecoveryState('RUNNING', false), 'pending');
  assert.equal(guard.observedRecoveryState('SUCCEEDED', false), 'complete');
});

test('an unconfirmed final-result request retains the shared lock even after a terminal observation', () => {
  const storage = storageFixture();
  saveRewrite(storage, 'owner', { ...base, rewriteJobId: 'job_rewrite', queryJobId: 'job_previous_read', recoveryState: 'complete', readRequestUnconfirmed: true, readIdempotencyKey: 'lost-read-response-key' });
  assert.equal(guard.canStartNewRecovery(storage, 'owner', 'repair'), false);
});

test('unreadable recovery storage never becomes permission for a new action', () => {
  const storage = storageFixture();
  storage.setItem('blogautomcp:failed-material-rewrite:owner', '{bad');
  assert.equal(guard.canStartNewRecovery(storage, 'owner', 'repair'), false);
  assert.equal(guard.canStartNewRecovery({ getItem() { throw Error('storage blocked'); } }, 'owner', 'repair'), false);
});

function findPrimary(element) {
  if (!element || typeof element !== 'object') return null;
  if (element.type === 'button' && element.props?.className?.includes('button-primary')) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = findPrimary(child);
    if (found) return found;
  }
  return null;
}

function findWorkflowRead(element) {
  if (!element || typeof element !== 'object') return null;
  if (element.type === 'button' && element.props?.children === '최종 소재 결과 조회') return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = findWorkflowRead(child);
    if (found) return found;
  }
  return null;
}

test('failed or cancelled final-result reads remain recoverable through the original accepted repair', async () => {
  const descriptors = Object.fromEntries(['window', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    for (const status of ['FAILED', 'CANCELLED']) {
      const storage = storageFixture();
      saveRepair(storage, 'owner', { ...base, repairJobId: 'job_original_repair', queryJobId: 'job_failed_read', recoveryState: 'workflowPending' });
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
      let sent;
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, init) => {
        sent = { url, method: init.method, body: JSON.parse(init.body) };
        return Response.json({ success: true, data: { jobId: 'job_retry_read', status: 'QUEUED' } });
      } });
      const states = [null, false, '', { jobId: 'job_failed_read', status, workflowPending: true }];
      let stateIndex = 0;
      const mocks = { react: { useState: () => [states[stateIndex++], () => {}], useEffect: () => {}, useSyncExternalStore: (...args) => args[1]() } };
      const { BlockedMaterialActions } = load('app/dashboard/blocked-material-actions.tsx', mocks);
      const panel = BlockedMaterialActions({ accountId: 'owner', online: true, appVersion: '1.3.99', hasConnection: true, activeWork: false });
      assert.equal(findPrimary(panel).props.disabled, true, 'a fresh repair stays locked');
      const read = findWorkflowRead(panel);
      assert.ok(read, `${status} lookup must retain the result recovery button`);
      assert.equal(read.props.disabled, false);
      await read.props.onClick();
      assert.equal(sent.url, '/api/materials/repair-blocked');
      assert.equal(sent.method, 'PATCH');
      assert.equal(sent.body.repairJobId, 'job_original_repair');
      const saved = load('lib/material-repair-request.ts').readSavedRepair(storage, 'owner');
      assert.equal(saved.repairJobId, 'job_original_repair');
      assert.equal(saved.queryJobId, 'job_retry_read');
      assert.equal(saved.recoveryState, 'pending');
    }
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('both actual panel click handlers recheck the other stored intent before creating a new key or POST', async () => {
  const descriptors = Object.fromEntries(['window', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let requests = 0;
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { requests++; throw Error('must not POST'); } });
  const mocks = { react: { useState: initial => [initial, () => {}], useEffect: () => {}, useSyncExternalStore: (...args) => args[1]() } };
  try {
    for (const action of ['rewrite', 'repair']) {
      const storage = storageFixture();
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
      const filename = action === 'rewrite' ? 'failed-material-actions' : 'blocked-material-actions';
      const name = action === 'rewrite' ? 'FailedMaterialActions' : 'BlockedMaterialActions';
      const component = load(`app/dashboard/${filename}.tsx`, mocks)[name];
      // Render enabled, then lose the other action's response before clicking this stale render.
      const button = findPrimary(component({ accountId: 'owner', online: true, appVersion: '1.3.99', hasConnection: true, activeWork: false }));
      assert.equal(button.props.disabled, false);
      (action === 'rewrite' ? saveRepair : saveRewrite)(storage, 'owner', base);
      await button.props.onClick();
      assert.equal(requests, 0);
      assert.equal(storage.values.size, 1, 'the competing action never creates a fresh request key');
      const blockedButton = findPrimary(component({ accountId: 'owner', online: true, appVersion: '1.3.99', hasConnection: true, activeWork: false }));
      assert.equal(blockedButton.props.disabled, true);
    }
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('shared browser notifications update both panels and remove subscriptions on unmount', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    let a = 0, b = 0;
    const unsubscribeA = guard.subscribeMaterialRecovery(() => a++);
    const unsubscribeB = guard.subscribeMaterialRecovery(() => b++);
    guard.notifyMaterialRecovery();
    assert.deepEqual([a, b], [1, 1]);
    unsubscribeA(); unsubscribeB();
    guard.notifyMaterialRecovery();
    assert.deepEqual([a, b], [1, 1]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  }
});

test('a competing unknown request still permits confirmation of the same saved intent', async () => {
  const descriptors = Object.fromEntries(['window', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = storageFixture();
  const repairRequest = { ...base, productIds: ['product_001'], idempotencyKey: 'original-repair-key' };
  saveRepair(storage, 'owner', repairRequest);
  saveRewrite(storage, 'owner', { ...base, idempotencyKey: 'original-rewrite-key' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  let sent;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ success: true, data: { jobId: 'job_original_repair', status: 'QUEUED', reused: true } });
  } });
  try {
    const mocks = { react: { useState: initial => [initial, () => {}], useEffect: () => {}, useSyncExternalStore: (...args) => args[1]() } };
    const { BlockedMaterialActions } = load('app/dashboard/blocked-material-actions.tsx', mocks);
    const button = findPrimary(BlockedMaterialActions({ accountId: 'owner', online: false, appVersion: '1.3.98', hasConnection: false, activeWork: true }));
    assert.equal(button.props.disabled, false, 'same-intent recovery can replay before current PC gates');
    await button.props.onClick();
    assert.deepEqual(sent, { connectKind: 'shopping', productIds: ['product_001'], idempotencyKey: 'original-repair-key' });
    assert.equal(load('lib/material-repair-request.ts').readSavedRepair(storage, 'owner').repairJobId, 'job_original_repair');
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

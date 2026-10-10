const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}, tail = '') {
  const filename = path.join(root, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8') + tail, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const localRequire = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(`${name.slice(2)}.ts`, mocks) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT,role TEXT);
    CREATE TABLE mcp_connections(id TEXT PRIMARY KEY,user_id TEXT,generation INTEGER,status TEXT);
    CREATE TABLE devices(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,platform TEXT,app_version TEXT,last_seen_at INTEGER,status_json TEXT,status TEXT,paired_at INTEGER);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,connect_kind TEXT,input_json TEXT,result_json TEXT,status TEXT,progress INTEGER,idempotency_key TEXT,created_at INTEGER,updated_at INTEGER,finished_at INTEGER,lease_until INTEGER,claimed_by_device_id TEXT,claimed_at INTEGER,stage TEXT,stage_message TEXT,heartbeat_at INTEGER,cancel_requested INTEGER,error_code TEXT,error_message TEXT,UNIQUE(user_id,idempotency_key));
    CREATE TABLE audit_events(id TEXT,actor_user_id TEXT,target_user_id TEXT,action TEXT,metadata_json TEXT,created_at INTEGER);
    INSERT INTO users VALUES('owner','APPROVED','USER'); INSERT INTO mcp_connections VALUES('connection1','owner',1,'ACTIVE');`);
  db.prepare(`INSERT INTO devices VALUES('device1','owner','PC','win32','1.3.98',?,'{"backgroundWork":{"busy":false}}','ACTIVE',?)`).run(Date.now(), Date.now());
  let beforeInsert = null;
  const d1 = { prepare(sql) { return { bind(...args) { return {
    async run() { if (beforeInsert && sql.includes('INSERT OR IGNORE INTO agent_jobs')) { const hook = beforeInsert; beforeInsert = null; hook(); } return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  }; } }; } };
  let identity = { userId: 'owner', email: 'owner@example.test', displayName: 'Owner' };
  let account = { id: 'owner', role: 'USER', status: 'APPROVED' };
  let sequence = 0;
  const mocks = {
    'cloudflare:workers': { env: {} },
    'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
    '@/db/init': { ensureDatabase: async () => {} }, '@/db': { getD1: () => d1 },
    '@/lib/crypto': { newId: prefix => `${prefix}_fixture_${++sequence}` },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => identity },
    '@/lib/account': { ensureAccount: async () => account, canUseMcp: value => value.status === 'APPROVED' && ['USER', 'ADMIN'].includes(value.role) },
    '@/lib/mcp': { splitMcpCredential: () => null },
    '@/lib/oauth': { hasOAuthScope: (scope, required) => scope.split(' ').includes(required) },
    '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
  };
  const route = load('app/api/materials/rewrite-failed/route.ts', mocks);
  const mcp = load('app/api/mcp/[credential]/route.ts', mocks);
  const send = (body, method = 'POST', origin = 'https://site.test') => route[method](new Request('https://site.test/api/materials/rewrite-failed', { method, headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }));
  const read = id => route.GET(new Request(`https://site.test/api/materials/rewrite-failed?jobId=${encodeURIComponent(id)}`));
  const call = async (name, args, scope = 'mcp:read mcp:write') => (await (await mcp.handleMcpRequest(new Request('https://site.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), 'owner', scope)).json()).result.structuredContent;
  return { db, send, read, call, mcp, setIdentity(value) { identity = value; }, setAccount(value) { account = value; }, race(callback) { beforeInsert = callback; } };
}
const request = { connectKind: 'shopping', idempotencyKey: 'rewrite-fixture-1' };

test('browser rewrite requires same origin, ChatGPT identity and approved account', async () => {
  const f = fixture();
  try {
    assert.equal((await f.send(request, 'POST', 'https://attacker.test')).status, 403);
    f.setIdentity(null); assert.equal((await f.send(request)).status, 401);
    f.setIdentity({ userId: 'owner', email: 'owner@example.test' });
    for (const status of ['PENDING_APPROVAL', 'SUSPENDED', 'REJECTED']) {
      f.setAccount({ id: 'owner', role: 'USER', status }); assert.equal((await f.send(request)).status, 403);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 0);
  } finally { f.db.close(); }
});

test('browser and MCP share one idempotent preparation queue, with changed scope rejected', async () => {
  const f = fixture();
  try {
    const first = (await (await f.send(request)).json()).data;
    assert.equal(first.status, 'QUEUED');
    assert.equal((await f.call('materials_rewrite_failed', request)).jobId, first.jobId);
    assert.equal((await f.call('materials_rewrite_failed', request)).reused, true);
    assert.equal((await f.call('materials_rewrite_failed', { ...request, connectKind: 'travel' })).code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 1);
    const row = f.db.prepare('SELECT * FROM agent_jobs').get();
    assert.equal(row.type, 'MATERIALS_REWRITE_FAILED');
    assert.equal(JSON.parse(row.input_json).connectKind, 'shopping');
    assert.ok(!JSON.parse(row.input_json).confirmed);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 1);
  } finally { f.db.close(); }
});

test('rewrite schema permits all failed candidates, rejects duplicate ids and publication options', async () => {
  const f = fixture();
  try {
    for (const args of [{}, { ...request, confirmed: true }, { ...request, productIds: [] }, { ...request, productIds: ['product_001', 'product_001'] }, { ...request, productIds: Array.from({ length: 51 }, (_, i) => `product_${i.toString().padStart(3, '0')}`) }, { ...request, publishMode: 'now' }]) {
      assert.equal((await f.call('materials_rewrite_failed', args)).code, 'INVALID_ARGUMENT');
    }
    assert.equal((await f.call('materials_rewrite_failed', request, 'mcp:read')).code, 'INSUFFICIENT_SCOPE');
    const accepted = await f.call('materials_rewrite_failed', { idempotencyKey: 'all-failed-fixture' });
    assert.equal(accepted.status, 'QUEUED');
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT input_json FROM agent_jobs').get().input_json), { idempotencyKey: 'all-failed-fixture' });
  } finally { f.db.close(); }
});

test('old app, offline PC, missing connection and busy work never receive rewrite jobs', async () => {
  const f = fixture();
  try {
    for (const version of ['1.3.97', '1.3.96', null]) {
      f.db.prepare('UPDATE devices SET app_version=?').run(version);
      assert.equal((await f.call('materials_rewrite_failed', request)).code, 'APP_UPDATE_REQUIRED');
    }
    f.db.prepare("UPDATE devices SET app_version='1.3.98',last_seen_at=1").run();
    assert.equal((await f.call('materials_rewrite_failed', request)).code, 'AGENT_OFFLINE');
    f.db.prepare('UPDATE devices SET last_seen_at=?').run(Date.now());
    f.db.prepare("UPDATE mcp_connections SET status='REVOKED'").run();
    assert.equal((await f.call('materials_rewrite_failed', request)).code, 'MCP_NOT_ISSUED');
    f.db.prepare("UPDATE mcp_connections SET status='ACTIVE'").run();
    for (const status of [{ busy: true }, { drafting: 1 }, { imageGeneration: 1 }, { publishing: 1 }, { busy: null, error: 'BACKGROUND_STATUS_UNAVAILABLE' }]) {
      f.db.prepare('UPDATE devices SET status_json=?').run(JSON.stringify({ backgroundWork: status }));
      assert.equal((await f.call('materials_rewrite_failed', request)).code, status.error || 'AGENT_BUSY');
    }
    f.db.prepare('UPDATE devices SET status_json=NULL').run();
    assert.equal((await f.call('materials_rewrite_failed', request)).code, 'BACKGROUND_STATUS_UNAVAILABLE');
    f.db.prepare('UPDATE devices SET status_json=?').run('{"backgroundWork":{"busy":false}}');
    f.db.prepare("INSERT INTO agent_jobs(id,user_id,type,status) VALUES('other-active','owner','MATERIALS_PREPARE','RUNNING')").run();
    assert.equal((await f.call('materials_rewrite_failed', request)).code, 'AGENT_BUSY');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE type='MATERIALS_REWRITE_FAILED'").get().n, 0);
  } finally { f.db.close(); }
});

test('atomic insert blocks connection rotation, PC replacement and competing requests after preflight', async () => {
  for (const change of [f => f.db.prepare('UPDATE mcp_connections SET generation=generation+1').run(), f => f.db.prepare("UPDATE devices SET status='REPLACED'").run(), f => f.db.prepare("UPDATE users SET status='SUSPENDED'").run(), f => f.db.prepare("UPDATE devices SET app_version='1.3.97'").run(), f => f.db.prepare("UPDATE devices SET last_seen_at=1").run(), f => f.db.prepare('UPDATE devices SET status_json=?').run('{"backgroundWork":{"busy":true}}')]) {
    const f = fixture();
    try {
      f.race(() => change(f));
      assert.equal((await f.call('materials_rewrite_failed', request)).code, 'AGENT_STATE_CHANGED');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 0);
    } finally { f.db.close(); }
  }
  const f = fixture();
  try {
    const outcomes = await Promise.all([f.call('materials_rewrite_failed', request), f.call('materials_rewrite_failed', { ...request, idempotencyKey: 'competing-request-2' })]);
    assert.equal(outcomes.filter(value => value.ok).length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 1);
  } finally { f.db.close(); }
});

test('status separates transport completion from workflow readiness and never exposes manuscripts', async () => {
  const f = fixture();
  try {
    const accepted = (await (await f.send(request)).json()).data;
    f.db.prepare("UPDATE agent_jobs SET status='SUCCEEDED',result_json=? WHERE id=?").run(JSON.stringify({ kind: 'rewrite', summary: '접수됨', data: { workflowPending: true, workflowJobId: 'material_local_1', materials: [{ markdown: 'private-manuscript'.repeat(10000) }] } }), accepted.jobId);
    const pending = await (await f.read(accepted.jobId)).json();
    assert.equal(pending.data.status, 'SUCCEEDED');
    assert.equal(pending.data.workflowPending, true);
    assert.equal(pending.data.workflowJobId, 'material_local_1');
    assert.ok(!JSON.stringify(pending).includes('private-manuscript'));
    const before = f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n;
    await f.read(accepted.jobId); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, before, 'GET never queues anything');
    f.setIdentity({ userId: 'other', email: 'other@example.test' }); f.setAccount({ id: 'other', role: 'USER', status: 'APPROVED' });
    assert.equal((await f.read(accepted.jobId)).status, 404);
    assert.equal((await f.send({ rewriteJobId: accepted.jobId, idempotencyKey: 'foreign-read-key' }, 'PATCH')).status, 404);
  } finally { f.db.close(); }
});

test('explicit workflow refresh is an owned, idempotent read and retains final verified counts', async () => {
  const f = fixture();
  try {
    const accepted = (await (await f.send(request)).json()).data;
    assert.equal((await f.send({ rewriteJobId: accepted.jobId, idempotencyKey: 'workflow-refresh-key' }, 'PATCH')).status, 409);
    f.db.prepare("UPDATE agent_jobs SET status='SUCCEEDED',result_json=? WHERE id=?").run(JSON.stringify({ data: { workflowPending: true, workflowJobId: 'material_local_1' } }), accepted.jobId);
    const readRequest = { rewriteJobId: accepted.jobId, idempotencyKey: 'workflow-refresh-key' };
    const queued = (await (await f.send(readRequest, 'PATCH')).json()).data;
    assert.equal((await (await f.send(readRequest, 'PATCH')).json()).data.jobId, queued.jobId);
    const row = f.db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(queued.jobId);
    assert.equal(row.type, 'MATERIALS_LIST');
    assert.equal(JSON.parse(row.input_json).jobId, 'material_local_1');
    f.db.prepare("UPDATE agent_jobs SET status='SUCCEEDED',result_json=? WHERE id=?").run(JSON.stringify({ data: { workflowPending: false, workflowJobId: 'material_local_1', job: { kind: 'rewrite', status: 'completed', items: [{ status: 'ready' }, { status: 'failed' }, { status: 'interrupted' }] } } }), queued.jobId);
    const final = (await (await f.read(queued.jobId)).json()).data;
    assert.equal(final.workflowPending, false); assert.equal(final.readyCount, 1); assert.equal(final.failedCount, 1); assert.equal(final.interruptedCount, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE type='MATERIALS_REWRITE_FAILED'").get().n, 1);
  } finally { f.db.close(); }
});

test('capability announces 1.3.98 minimum and current MCP discovery version', async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE devices SET app_version='1.3.97'").run();
    assert.equal((await f.call('agent_get_status', {})).capabilities.materialsRewriteFailed.supported, false);
    f.db.prepare("UPDATE devices SET app_version='1.3.98'").run();
    assert.deepEqual((await f.call('agent_get_status', {})).capabilities.materialsRewriteFailed, { minimumAppVersion: '1.3.98', supported: true });
    const init = await f.mcp.handleMcpRequest(new Request('https://site.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }) }), 'owner', 'mcp:read mcp:write');
    assert.equal((await init.json()).result.serverInfo.version, '1.3.16');
  } finally { f.db.close(); }
});

test('lost browser response survives reload without changing request scope or idempotency', async () => {
  const f = fixture();
  const { readSavedRewrite, saveRewrite } = load('lib/material-rewrite-request.ts');
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const original = { version: 1, connectKind: 'shopping', idempotencyKey: 'lost-response-request' };
  saveRewrite(storage, 'owner', original);
  assert.deepEqual(readSavedRewrite(storage, 'owner'), original);
  assert.equal(readSavedRewrite(storage, 'other'), null, 'another account cannot inherit the pending target');
  const accepted = { ...original, rewriteJobId: 'job_received', queryJobId: 'job_read', readIdempotencyKey: 'lost-read-response' };
  saveRewrite(storage, 'owner', accepted);
  assert.deepEqual(readSavedRewrite(storage, 'owner'), accepted);
  assert.ok(!JSON.stringify([...values.values()]).includes('markdown'));
  try {
    saveRewrite(storage, 'owner', original);
    // The server accepts the POST but the browser never receives its response.
    await f.send({ connectKind: original.connectKind, idempotencyKey: original.idempotencyKey });
    const reloaded = readSavedRewrite(storage, 'owner');
    const recovered = (await (await f.send({ connectKind: reloaded.connectKind, idempotencyKey: reloaded.idempotencyKey })).json()).data;
    assert.equal(recovered.reused, true);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 1);
    saveRewrite(storage, 'owner', { ...reloaded, rewriteJobId: recovered.jobId, queryJobId: recovered.jobId });
    const restored = readSavedRewrite(storage, 'owner');
    assert.equal((await (await f.read(restored.queryJobId)).json()).data.jobId, recovered.jobId);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 1);
  } finally { f.db.close(); }
});

test('React external-store recovery keeps stable snapshots, notifies writes and restores a lost request', () => {
  const descriptors = Object.fromEntries(['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    const { recoveryTest } = load('app/dashboard/failed-material-actions.tsx', {}, '\nexport const recoveryTest = { subscribeRecovery, browserRecoverySnapshot, persistRecovery };');
    assert.equal(recoveryTest.browserRecoverySnapshot('owner'), 'null');
    let notifications = 0;
    const unsubscribe = recoveryTest.subscribeRecovery(() => { notifications++; });
    const request = { version: 1, connectKind: 'travel', idempotencyKey: 'external-store-lost-request' };
    recoveryTest.persistRecovery('owner', request);
    assert.equal(notifications, 1);
    const snapshot = recoveryTest.browserRecoverySnapshot('owner');
    assert.equal(recoveryTest.browserRecoverySnapshot('owner'), snapshot, 'getSnapshot returns the identical primitive without allocating a new store snapshot');
    assert.deepEqual(JSON.parse(snapshot), request);
    assert.equal(recoveryTest.browserRecoverySnapshot('other'), 'null');
    const reloaded = load('app/dashboard/failed-material-actions.tsx', {}, '\nexport const recoveryTest = { browserRecoverySnapshot };').recoveryTest;
    assert.equal(reloaded.browserRecoverySnapshot('owner'), snapshot);
    unsubscribe();
    recoveryTest.persistRecovery('owner', { ...request, rewriteJobId: 'job_saved' });
    assert.equal(notifications, 1, 'unmount removes the actual browser event subscription');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
    assert.equal(recoveryTest.browserRecoverySnapshot('owner'), 'unavailable');
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

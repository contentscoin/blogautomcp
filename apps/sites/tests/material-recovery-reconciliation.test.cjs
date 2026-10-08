const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  const localRequire = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(`${name.slice(2)}.ts`, mocks) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}

function fixture(operation) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT,role TEXT);
    CREATE TABLE mcp_connections(id TEXT PRIMARY KEY,user_id TEXT,generation INTEGER,status TEXT);
    CREATE TABLE devices(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,platform TEXT,app_version TEXT,last_seen_at INTEGER,status_json TEXT,status TEXT,paired_at INTEGER);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,connect_kind TEXT,input_json TEXT,result_json TEXT,status TEXT,progress INTEGER,idempotency_key TEXT,created_at INTEGER,updated_at INTEGER,finished_at INTEGER,lease_until INTEGER,claimed_by_device_id TEXT,claimed_at INTEGER,stage TEXT,stage_message TEXT,heartbeat_at INTEGER,cancel_requested INTEGER,error_code TEXT,error_message TEXT,UNIQUE(user_id,idempotency_key));
    CREATE TABLE audit_events(id TEXT,actor_user_id TEXT,target_user_id TEXT,action TEXT,metadata_json TEXT,created_at INTEGER);
    INSERT INTO users VALUES('owner','APPROVED','USER');
    INSERT INTO mcp_connections VALUES('connection1','owner',1,'ACTIVE');`);
  db.prepare(`INSERT INTO devices VALUES('device1','owner','PC','win32','1.3.99',?,'{"backgroundWork":{"busy":false}}','ACTIVE',?)`).run(Date.now(), Date.now());
  const d1 = { prepare(sql) { return { bind(...args) { return {
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  }; } }; } };
  let identity = { userId: 'owner' }, account = { id: 'owner', status: 'APPROVED', role: 'USER' }, sequence = 0;
  const route = load(`app/api/materials/${operation === 'rewrite' ? 'rewrite-failed' : 'repair-blocked'}/route.ts`, {
    'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
    '@/db/init': { ensureDatabase: async () => {} }, '@/db': { getD1: () => d1 },
    '@/lib/crypto': { newId: prefix => `${prefix}_read_${++sequence}` },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => identity },
    '@/lib/account': { ensureAccount: async () => account, canUseMcp: value => value.status === 'APPROVED' },
    '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
  });
  const type = operation === 'rewrite' ? 'MATERIALS_REWRITE_FAILED' : 'MATERIALS_REPAIR_BLOCKED';
  const field = `${operation}JobId`;
  db.prepare(`INSERT INTO agent_jobs(id,user_id,type,status,progress,idempotency_key,claimed_at,claimed_by_device_id,error_code) VALUES('job_original','owner',?,'FAILED',100,'root-request-retained',1,'device1','AGENT_LOST')`).run(type);
  const patch = (idempotencyKey, originalId = 'job_original') => route.PATCH(new Request('https://site.test/api/materials', {
    method: 'PATCH', headers: { origin: 'https://site.test', 'content-type': 'application/json' },
    body: JSON.stringify({ [field]: originalId, idempotencyKey }),
  }));
  const read = async (id = 'job_original') => (await route.GET(new Request(`https://site.test/api/materials?jobId=${id}`))).json();
  return { db, route, type, patch, read, switchOwner() { identity = { userId: 'other' }; account = { id: 'other', status: 'APPROVED', role: 'USER' }; } };
}

for (const operation of ['rewrite', 'repair']) {
  test(`${operation}: FAILED/CANCELLED/lost successful replies remain uncertain and reconcile only by the owned source`, async () => {
    for (const status of ['FAILED', 'CANCELLED', 'SUCCEEDED']) {
      const f = fixture(operation);
      try {
        f.db.prepare('UPDATE agent_jobs SET status=?').run(status);
        const initial = (await f.read()).data;
        assert.equal(initial.workflowPending, true);
        assert.equal(initial.workflowUncertain, true);
        assert.equal(initial.executionNotAdmitted, false);
        const accepted = (await (await f.patch('same-lookup-key')).json()).data;
        assert.equal(accepted.status, 'QUEUED');
        assert.equal((await (await f.patch('same-lookup-key')).json()).data.jobId, accepted.jobId);
        const readJob = f.db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(accepted.jobId);
        assert.equal(readJob.type, 'MATERIALS_LIST');
        assert.deepEqual(JSON.parse(readJob.input_json), { sourceJobId: 'job_original', idempotencyKey: 'same-lookup-key' });
        assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs WHERE type=?').get(f.type).n, 1);
        assert.equal(f.db.prepare('SELECT idempotency_key FROM agent_jobs WHERE id=?').get('job_original').idempotency_key, 'root-request-retained');
      } finally { f.db.close(); }
    }
  });

  test(`${operation}: a failed source lookup including PC 404 is never evidence to restart; later proven completion resolves it`, async () => {
    const f = fixture(operation);
    try {
      const accepted = (await (await f.patch('missing-source-read')).json()).data;
      f.db.prepare("UPDATE agent_jobs SET status='FAILED',error_code='LOCAL_AUTOMATION_FAILED',error_message='요청에 연결된 소재 작업이 없습니다.' WHERE id=?").run(accepted.jobId);
      const missing = (await f.read(accepted.jobId)).data;
      assert.equal(missing.workflowPending, true); assert.equal(missing.workflowUncertain, true);
      const next = (await (await f.patch('later-proof-read')).json()).data;
      f.db.prepare("UPDATE agent_jobs SET status='SUCCEEDED',result_json=? WHERE id=?").run(JSON.stringify({ data: {
        workflowPending: true, workflowJobId: 'local_workflow', status: 'running', jobId: 'local_workflow', sourceJobId: 'job_original', items: [],
      } }), next.jobId);
      assert.equal((await f.read(next.jobId)).data.workflowPending, true);
      f.db.prepare("UPDATE agent_jobs SET result_json=? WHERE id=?").run(JSON.stringify({ data: {
        workflowPending: false, workflowJobId: 'local_workflow', status: 'partial', jobId: 'local_workflow', sourceJobId: 'job_original',
        items: [{ status: 'ready' }, { status: 'failed' }, { status: 'interrupted' }],
      } }), next.jobId);
      const final = (await f.read(next.jobId)).data;
      assert.equal(final.workflowPending, false); assert.equal(final.workflowUncertain, false);
      assert.equal(final.readyCount, 1); assert.equal(final.failedCount, 1); assert.equal(final.interruptedCount, 1);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs WHERE type=?').get(f.type).n, 1);
    } finally { f.db.close(); }
  });

  test(`${operation}: only a queued cancellation with concrete missing claim receipts proves nonexecution`, async () => {
    const f = fixture(operation);
    try {
      f.db.prepare("UPDATE agent_jobs SET status='CANCELLED',error_code='USER_CANCELLED',claimed_at=NULL,claimed_by_device_id=NULL").run();
      const cancelled = (await f.read()).data;
      assert.equal(cancelled.workflowPending, false); assert.equal(cancelled.executionNotAdmitted, true);
      const resolved = (await (await f.patch('cancel-read-confirm')).json()).data;
      assert.equal(resolved.jobId, 'job_original'); assert.equal(resolved.workflowPending, false);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 1, 'no PC query or mutation is necessary');
      f.db.prepare('UPDATE agent_jobs SET result_json=?').run(JSON.stringify({ data: { workflowJobId: 'contradictory_workflow', status: 'running' } }));
      assert.equal((await f.read()).data.workflowPending, true, 'a contradictory PC result defeats nonadmission proof');
      f.db.prepare('UPDATE agent_jobs SET result_json=NULL').run();
      f.db.prepare("UPDATE agent_jobs SET claimed_at=1,claimed_by_device_id='device1'").run();
      assert.equal((await f.read()).data.workflowPending, true, 'a dispatched cancellation stays uncertain');
      assert.equal((await (await f.patch('dispatched-cancel-read')).json()).data.status, 'QUEUED');
    } finally { f.db.close(); }
  });

  test(`${operation}: owned-source lookup requires the compatible PC, validates key/scope and never accepts foreign anchors`, async () => {
    const f = fixture(operation);
    try {
      f.db.prepare("UPDATE devices SET app_version='1.3.97'").run();
      const oldApp = await (await f.patch('old-pc-lookup-key')).json();
      assert.equal(oldApp.error.code, 'APP_UPDATE_REQUIRED'); assert.equal(oldApp.requestAccepted, false);
      f.db.prepare("UPDATE devices SET app_version='1.3.98'").run();
      assert.equal((await f.patch('source-pc-lookup-key')).status, 200);
      assert.equal((await f.patch('bad')).status, 422);
      f.switchOwner();
      assert.equal((await f.patch('foreign-read-key')).status, 404);
      assert.equal((await f.read()).success, false);
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE type='MATERIALS_LIST'").get().n, 1);
    } finally { f.db.close(); }
  });
}

test('a boolean alone or contradictory local running state cannot unlock recovery', () => {
  const { materialRecoveryStatus } = load('lib/material-recovery-status.ts');
  const base = { type: 'MATERIALS_LIST', status: 'SUCCEEDED', errorCode: null, claimedAt: 1, claimedDeviceId: 'device1' };
  for (const data of [
    { workflowPending: false },
    { workflowPending: false, workflowJobId: 'local_workflow' },
    { workflowPending: false, workflowJobId: 'local_workflow', status: 'running' },
    { workflowPending: false, job: { status: 'completed' } },
    { workflowPending: false, workflowJobId: 'local_workflow', status: 'running', job: { status: 'completed' } },
    { workflowPending: false, workflowJobId: 'local_workflow', status: 'QUEUED', job: { status: 'completed' } },
    { workflowPending: false, workflowJobId: 'local_workflow', status: 'completed', job: { status: 'running' } },
  ]) assert.equal(materialRecoveryStatus({ ...base, result: { data } }).workflowPending, true);
  for (const status of ['completed', 'partial', 'failed', 'interrupted', 'cancelled']) {
    assert.equal(materialRecoveryStatus({ ...base, result: { data: { workflowPending: false, workflowJobId: 'local_workflow', status } } }).workflowPending, false);
  }
});

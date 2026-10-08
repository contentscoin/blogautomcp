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
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const localRequire = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(`${name.slice(2)}.ts`, mocks) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}

const key = '550e8400-e29b-41d4-a716-446655440000';
const job1 = 'job_1234567890123456', job2 = 'job_2234567890123456';
function transaction(db, statements, failAfter = -1) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const results = statements.map((statement, index) => {
      const prepared = db.prepare(statement.sql), args = statement.args || [];
      const rows = prepared.columns().length ? prepared.all(...args) : [];
      const changes = prepared.columns().length ? 0 : Number(prepared.run(...args).changes);
      if (index === failAfter) throw Error('Injected transaction failure');
      return { results: rows, meta: { changes } };
    });
    db.exec('COMMIT');
    return results;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function migrationD1(db) {
  const statement = (sql, args = []) => ({ sql, args,
    bind: (...values) => statement(sql, values),
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return { prepare: sql => statement(sql), async batch(statements) { return transaction(db, statements); } };
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT,last_seen_at INTEGER,app_version TEXT,status_json TEXT);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,claimed_by_device_id TEXT,claim_request_id TEXT,type TEXT,input_json TEXT,status TEXT,progress INTEGER,result_json TEXT,error_code TEXT,error_message TEXT,created_at INTEGER,updated_at INTEGER,claimed_at INTEGER,finished_at INTEGER,lease_until INTEGER,stage TEXT,stage_message TEXT,heartbeat_at INTEGER,cancel_requested INTEGER);
    CREATE TABLE agent_claim_intents(user_id TEXT,device_id TEXT,request_id TEXT,job_id TEXT,created_at INTEGER,PRIMARY KEY(user_id,device_id,request_id));
    CREATE UNIQUE INDEX idx_agent_jobs_device_claim ON agent_jobs(user_id,claimed_by_device_id,claim_request_id) WHERE claim_request_id IS NOT NULL;
    INSERT INTO devices(id,status) VALUES('device1','ACTIVE'),('device2','ACTIVE');`);
  let device = { id: 'device1', userId: 'owner' };
  let beforeFirst = null;
  let afterFirst = null;
  let beforeBatch = null;
  let afterBatch = null;
  let failBatchAfter = -1;
  const d1 = { prepare(sql) { return { bind(...args) { return { sql, args,
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { if (beforeFirst) await beforeFirst(sql); const row = db.prepare(sql).get(...args) ?? null; if (afterFirst) await afterFirst(sql); return row; },
  }; } }; }, async batch(statements) {
    if (beforeBatch) await beforeBatch();
    const results = transaction(db, statements, failBatchAfter);
    if (afterBatch) await afterBatch();
    return results;
  } };
  const route = load('app/api/agent/jobs/claim/route.ts', {
    'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
    '@/lib/device': { authenticateDevice: async () => device },
    '@/db/init': { ensureDatabase: async () => {} },
    '@/db': { getD1: () => d1 },
  });
  const send = async body => {
    const response = await route.POST(new Request('https://example.test/api/agent/jobs/claim', { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, ...(await response.json()) };
  };
  const enqueue = (id, userId = 'owner', type = 'MATERIALS_LIST') => db.prepare('INSERT INTO agent_jobs(id,user_id,type,input_json,status,progress,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, userId, type, JSON.stringify({ connectKind: 'shopping', sample: id }), 'QUEUED', 0, id === job1 ? 1 : 2, 1);
  return { db, route, send, enqueue, setDevice: value => { device = value; }, beforeFirst: callback => { beforeFirst = callback; }, afterFirst: callback => { afterFirst = callback; }, beforeBatch: callback => { beforeBatch = callback; }, afterBatch: callback => { afterBatch = callback; }, failBatch: index => { failBatchAfter = index; } };
}

test('claim capability detection authenticates and leaves the queue untouched', async () => {
  const f = fixture();
  try {
    f.enqueue(job1);
    const request = new Request('https://example.test/api/agent/jobs/claim');
    assert.deepEqual(await (await f.route.GET(request)).json(), { success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
    assert.equal(f.db.prepare('SELECT status FROM agent_jobs').get().status, 'QUEUED');
    assert.equal(f.db.prepare('SELECT last_seen_at FROM devices WHERE id=?').get('device1').last_seen_at, null);
    f.setDevice(null);
    assert.equal((await f.route.GET(request)).status, 401);
  } finally { f.db.close(); }
});

test('a lost claim response retries the exact assignment without claiming the next queued job', async () => {
  const f = fixture();
  try {
    f.enqueue(job1); f.enqueue(job2);
    // The first response is deliberately discarded after the actual SQL commit.
    await f.send({ claimRequestId: key });
    const original = f.db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(job1);
    f.db.prepare('UPDATE agent_jobs SET lease_until=?, heartbeat_at=? WHERE id=?').run(Date.now() + 1000, 1, job1);
    const recovered = await f.send({ claimRequestId: key.toUpperCase() });
    assert.equal(recovered.claimReused, true);
    assert.equal(recovered.claimRequestId, key);
    assert.equal(recovered.data.id, job1);
    assert.deepEqual(recovered.data.input, JSON.parse(original.input_json));
    assert.equal(f.db.prepare('SELECT claimed_at FROM agent_jobs WHERE id=?').get(job1).claimed_at, original.claimed_at);
    assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
    assert.ok(f.db.prepare('SELECT heartbeat_at FROM agent_jobs WHERE id=?').get(job1).heartbeat_at > 1);
  } finally { f.db.close(); }
});

test('simultaneous retries of one claim intent have one immutable assignment', async () => {
  const f = fixture();
  try {
    f.enqueue(job1); f.enqueue(job2);
    const replies = await Promise.all([f.send({ claimRequestId: key }), f.send({ claimRequestId: key })]);
    assert.equal(replies[0].data.id, job1);
    assert.equal(replies[1].data.id, job1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM agent_jobs WHERE status='RUNNING'").get().count, 1);
    assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
  } finally { f.db.close(); }
});

test('a delayed claim retry cannot shorten a lease or regress a newer heartbeat', async () => {
  const f = fixture();
  try {
    f.enqueue(job1);
    await f.send({ claimRequestId: key });
    const newer = { updated_at: Date.now() + 20000, heartbeat_at: Date.now() + 20000, lease_until: Date.now() + 140000 };
    f.db.prepare('UPDATE agent_jobs SET updated_at=?,heartbeat_at=?,lease_until=? WHERE id=?').run(newer.updated_at, newer.heartbeat_at, newer.lease_until, job1);
    assert.equal((await f.send({ claimRequestId: key })).data.id, job1);
    assert.deepEqual({ ...f.db.prepare('SELECT updated_at,heartbeat_at,lease_until FROM agent_jobs WHERE id=?').get(job1) }, newer);
  } finally { f.db.close(); }
});

test('delayed original after a retry commits empty cannot claim a newly queued job', async () => {
  const f = fixture();
  try {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    let entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    f.beforeBatch(async () => {
      f.beforeBatch(null);
      entered();
      await delayed;
    });
    const original = f.send({ claimRequestId: key });
    await waiting;
    const retry = await f.send({ claimRequestId: key });
    assert.equal(retry.data, null);
    assert.equal(retry.claimResolved, true);
    assert.equal(retry.claimOutcome, 'empty');
    f.enqueue(job1);
    release();
    const late = await original;
    assert.equal(late.data, null);
    assert.equal(late.claimOutcome, 'empty');
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await f.send({ claimRequestId: key })).claimOutcome, 'empty');
    assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job1).status, 'QUEUED');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM agent_claim_intents').get().count, 1);
  } finally { f.db.close(); }
});

test('transaction failure rolls back assignment and intent without acknowledging empty', async () => {
  for (const index of [0, 1]) {
    const f = fixture();
    try {
      f.enqueue(job1);
      f.failBatch(index);
      await assert.rejects(f.send({ claimRequestId: key }), /transaction failure/);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM agent_claim_intents').get().count, 0);
      assert.equal(f.db.prepare('SELECT status,claim_request_id FROM agent_jobs WHERE id=?').get(job1).status, 'QUEUED');
      assert.equal(f.db.prepare('SELECT claim_request_id FROM agent_jobs WHERE id=?').get(job1).claim_request_id, null);
    } finally { f.db.close(); }
  }
});

test('missing or contested immutable assignment is unresolved and never acknowledged empty', async () => {
  for (const mutation of [`DELETE FROM agent_jobs WHERE id='${job1}'`, `UPDATE agent_jobs SET claimed_by_device_id='device2' WHERE id='${job1}'`, `UPDATE agent_jobs SET claimed_by_device_id='device2',status='QUEUED' WHERE id='${job1}'`]) {
    const f = fixture();
    try {
      f.enqueue(job1); f.enqueue(job2);
      await f.send({ claimRequestId: key });
      f.db.exec(mutation);
      const reply = await f.send({ claimRequestId: key });
      assert.equal(reply.status, 409);
      assert.equal(reply.error.code, 'CLAIM_ASSIGNMENT_UNRESOLVED');
      assert.equal(reply.claimOutcome, undefined);
      assert.equal(f.db.prepare('SELECT job_id FROM agent_claim_intents').get().job_id, job1);
      assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
    } finally { f.db.close(); }
  }
});

test('expired or terminal matching claims resolve without returning executable work or touching another job', async () => {
  for (const type of ['MATERIALS_LIST', 'POST_PUBLISH']) {
    const f = fixture();
    try {
      f.enqueue(job1, 'owner', type); f.enqueue(job2);
      await f.send({ claimRequestId: key });
      f.db.prepare('UPDATE agent_jobs SET lease_until=1 WHERE id=?').run(job1);
      const expired = await f.send({ claimRequestId: key });
      assert.equal(expired.data, null);
      assert.equal(expired.claimResolved, true);
      assert.equal(expired.claimedJob.id, job1);
      assert.equal(expired.claimedJob.status, 'FAILED');
      assert.equal(expired.claimedJob.errorCode, type === 'POST_PUBLISH' ? 'AGENT_LOST_UNCERTAIN' : 'AGENT_LOST');
      assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
      for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
        f.db.prepare('UPDATE agent_jobs SET status=? WHERE id=?').run(status, job1);
        const terminal = await f.send({ claimRequestId: key });
        assert.equal(terminal.data, null);
        assert.equal(terminal.claimedJob.status, status);
        assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
      }
    } finally { f.db.close(); }
  }
});

test('claim identities are scoped to authenticated owner and device; invalid keys do not claim', async () => {
  const f = fixture();
  try {
    f.enqueue(job1); f.enqueue(job2, 'other');
    for (const invalid of ['', 'not-a-uuid', 1, null]) {
      assert.equal((await f.send({ claimRequestId: invalid })).status, 422);
      assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job1).status, 'QUEUED');
    }
    assert.equal((await f.send({ claimRequestId: key })).data.id, job1);
    f.setDevice({ id: 'device2', userId: 'other' });
    assert.equal((await f.send({ claimRequestId: key })).data.id, job2);
    assert.equal(f.db.prepare('SELECT claimed_by_device_id FROM agent_jobs WHERE id=?').get(job1).claimed_by_device_id, 'device1');
    f.setDevice(null);
    assert.equal((await f.send({ claimRequestId: key })).status, 401);
  } finally { f.db.close(); }
});

test('malformed, truncated, array, null and oversized JSON cannot fall back to an unkeyed claim', async () => {
  const f = fixture();
  try {
    f.enqueue(job1);
    for (const body of ['not-json', '{"claimRequestId":', '[]', 'null', JSON.stringify({ status: 'x'.repeat(33000) })]) {
      const rejected = await f.route.POST(new Request('https://example.test/api/agent/jobs/claim', { method: 'POST', body }));
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error.code, 'INVALID_REQUEST');
      assert.equal(f.db.prepare('SELECT status FROM agent_jobs').get().status, 'QUEUED');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM agent_claim_intents').get().count, 0);
      assert.equal(f.db.prepare('SELECT last_seen_at FROM devices WHERE id=?').get('device1').last_seen_at, null);
    }
  } finally { f.db.close(); }
});

test('cancel requested after a lost claim reply is never returned as executable or renewed', async () => {
  const f = fixture();
  try {
    f.enqueue(job1); f.enqueue(job2);
    await f.send({ claimRequestId: key });
    f.db.prepare('UPDATE agent_jobs SET cancel_requested=1, heartbeat_at=1 WHERE id=?').run(job1);
    const before = f.db.prepare('SELECT lease_until FROM agent_jobs WHERE id=?').get(job1).lease_until;
    const reply = await f.send({ claimRequestId: key });
    assert.equal(reply.data, null);
    assert.equal(reply.claimResolved, true);
    assert.equal(reply.claimedJob.status, 'RUNNING');
    assert.equal(reply.claimedJob.cancelRequested, true);
    assert.equal(f.db.prepare('SELECT heartbeat_at,lease_until FROM agent_jobs WHERE id=?').get(job1).heartbeat_at, 1);
    assert.equal(f.db.prepare('SELECT lease_until FROM agent_jobs WHERE id=?').get(job1).lease_until, before);
    assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
  } finally { f.db.close(); }
});

test('revocation or cancellation during same-intent resolution cannot return a stale executable assignment', async () => {
  for (const mutation of ["UPDATE devices SET status='REVOKED' WHERE id='device1'", `UPDATE agent_jobs SET cancel_requested=1 WHERE id='${job1}'`]) {
    const f = fixture();
    try {
      f.enqueue(job1); f.enqueue(job2);
      await f.send({ claimRequestId: key });
      f.afterBatch(() => {
        f.afterBatch(null);
        f.db.exec(mutation);
      });
      const conflicted = await f.send({ claimRequestId: key });
      assert.equal(conflicted.status, 409);
      assert.equal(conflicted.error.code, 'CLAIM_STATE_CHANGED');
      assert.equal(conflicted.data, undefined);
      assert.equal(f.db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
    } finally { f.db.close(); }
  }
});

test('device revoked before the atomic batch cannot commit or acknowledge an empty or assigned intent', async () => {
  const f = fixture();
  try {
    f.enqueue(job1);
    f.beforeBatch(() => {
      f.beforeBatch(null);
      f.db.exec("UPDATE devices SET status='REVOKED' WHERE id='device1'");
    });
    const rejected = await f.send({ claimRequestId: key });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.claimOutcome, undefined);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM agent_claim_intents').get().count, 0);
    assert.equal(f.db.prepare('SELECT status FROM agent_jobs').get().status, 'QUEUED');
  } finally { f.db.close(); }
});

test('legacy callers retain the old claim format and keyed empty claims are acknowledged', async () => {
  const f = fixture();
  try {
    assert.equal((await f.send({ claimRequestId: key })).claimRequestId, key);
    f.enqueue(job1);
    const legacy = await f.send({ appVersion: '1.3.99' });
    assert.equal(legacy.data.id, job1);
    assert.equal(legacy.claimRequestId, undefined);
    assert.equal(f.db.prepare('SELECT claim_request_id FROM agent_jobs WHERE id=?').get(job1).claim_request_id, null);
  } finally { f.db.close(); }
});

test('claim migration upgrades an existing job table before creating the unique index', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,connect_kind TEXT,input_json TEXT,result_json TEXT,status TEXT,progress INTEGER,idempotency_key TEXT,claimed_by_device_id TEXT,error_code TEXT,error_message TEXT,created_at INTEGER,updated_at INTEGER,claimed_at INTEGER,finished_at INTEGER);
    INSERT INTO agent_jobs(id,user_id,type,input_json,status,created_at) VALUES('legacy','owner','MATERIALS_LIST','{}','QUEUED',1);`);
  const d1 = migrationD1(db);
  const init = load('db/init.ts', { './index': { getD1: () => d1 } });
  try {
    await Promise.all([init.ensureDatabase(), init.ensureDatabase()]);
    assert.ok(db.prepare('PRAGMA table_info(agent_jobs)').all().some(row => row.name === 'claim_request_id'));
    assert.ok(db.prepare('PRAGMA index_list(agent_jobs)').all().some(row => row.name === 'idx_agent_jobs_device_claim' && row.unique === 1));
    assert.equal(db.prepare('SELECT status,claim_request_id FROM agent_jobs WHERE id=?').get('legacy').status, 'QUEUED');
    assert.equal(db.prepare('SELECT claim_request_id FROM agent_jobs WHERE id=?').get('legacy').claim_request_id, null);
  } finally { db.close(); }
});

test('v1 assigned claim migrates to an owned immutable v2 ledger without assigning another job', async () => {
  const db = new DatabaseSync(':memory:');
  const d1 = migrationD1(db);
  const databaseMock = { './index': { getD1: () => d1 } };
  try {
    await load('db/init.ts', databaseMock).ensureDatabase();
    db.prepare("INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES('owner','fixture@example.test','USER','APPROVED',1,1)").run();
    db.prepare("INSERT INTO devices(id,user_id,token_hash,name,status,paired_at) VALUES('device1','owner','fixture-token','fixture','ACTIVE',1)").run();
    db.prepare("INSERT INTO agent_jobs(id,user_id,type,input_json,status,created_at,updated_at,claimed_at,claimed_by_device_id,claim_request_id,lease_until) VALUES(?,?,'MATERIALS_LIST','{}','RUNNING',1,1,1,?,?,?)")
      .run(job1, 'owner', 'device1', key, Date.now() + 120000);
    db.prepare("INSERT INTO agent_jobs(id,user_id,type,input_json,status,created_at,updated_at) VALUES(?,?,'MATERIALS_LIST','{}','QUEUED',2,2)").run(job2, 'owner');
    const upgrade = load('db/init.ts', databaseMock);
    await Promise.all([upgrade.ensureDatabase(), upgrade.ensureDatabase()]);
    const saved = db.prepare('SELECT user_id,device_id,request_id,job_id FROM agent_claim_intents').get();
    assert.deepEqual({ ...saved }, { user_id: 'owner', device_id: 'device1', request_id: key, job_id: job1 });
    const route = load('app/api/agent/jobs/claim/route.ts', {
      'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
      '@/lib/device': { authenticateDevice: async () => ({ id: 'device1', userId: 'owner' }) },
      '@/db/init': { ensureDatabase: async () => {} }, '@/db': { getD1: () => d1 },
    });
    const reply = await (await route.POST(new Request('https://example.test/api/agent/jobs/claim', { method: 'POST', body: JSON.stringify({ claimRequestId: key }) }))).json();
    assert.equal(reply.data.id, job1);
    assert.equal(reply.claimReused, true);
    assert.equal(reply.claimOutcome, 'job');
    assert.equal(db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(job2).status, 'QUEUED');
  } finally { db.close(); }
});

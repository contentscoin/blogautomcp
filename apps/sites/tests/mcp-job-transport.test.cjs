const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, mocks);
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}

const { resultPage, jobGuidance, waitForJob } = load('lib/mcp-job-status.ts');
test('bounded waiting preserves pending jobs across repeated requests', async () => {
  let polls = 0, elapsed = 0;
  const read = async () => ({ status: ++polls > 12 ? 'SUCCEEDED' : 'RUNNING' });
  const sleep = async (ms) => { elapsed += ms; };
  assert.equal((await waitForJob(read, 20000, sleep)).status, 'RUNNING');
  assert.equal(elapsed, 20000);
  assert.equal((await waitForJob(read, 20000, sleep)).status, 'SUCCEEDED');
  assert.equal(jobGuidance('RUNNING', null).mustContinue, true);
  assert.equal(jobGuidance('QUEUED', null).taskOutcome, 'pending');
  assert.equal(jobGuidance('FAILED', 'AUTH_REQUIRED').mustContinue, false);
  assert.equal(await waitForJob(async () => null, 20000, () => { throw Error('must not wait'); }), null);
  assert.equal((await waitForJob(async () => ({ status: 'CANCELLED' }), 20000, () => { throw Error('must not wait'); })).status, 'CANCELLED');
});
test('large multilingual JSON round trips across split surrogate pairs', () => {
  const original = { prompt: '한글😀\\"\n'.repeat(20000) };
  const serialized = JSON.stringify(original);
  let offset = 0;
  let joined = '';
  do {
    const page = resultPage(serialized, offset, 7);
    joined += JSON.parse(JSON.stringify(page)).text;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(joined), original);
});
test('uncertain publication never advises replay; terminal jobs stop polling', () => {
  assert.equal(jobGuidance('FAILED', 'AGENT_LOST_UNCERTAIN').nextAction, 'verify_published');
  assert.equal(jobGuidance('FAILED', 'AGENT_LOST').pollAfterMs, null);
  assert.equal(jobGuidance('RUNNING', null, true).terminal, false);
  assert.equal(resultPage(null, 0, 10).text, 'null');
});

let reads = 0;
let storedResult = '{"hello":"world"}';
const mocks = {
  'cloudflare:workers': { env: {} },
  'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
  '@/db/init': { ensureDatabase: async () => {} },
  '@/db': { getD1: () => ({ prepare(sql) { return { bind(id, userId) { return { async first() {
    reads++;
    assert.match(sql, /WHERE id=\? AND user_id=\?/);
    return userId === 'owner' && id === 'job_owned' ? { id, status: 'SUCCEEDED', resultJson: storedResult, createdAt: 1, finishedAt: 2 } : null;
  } }; } }; } }) },
  '@/lib/crypto': {},
  '@/lib/jobs': { sweepExpiredLeases: async () => {} },
  '@/lib/mcp': { splitMcpCredential: () => null },
  '@/lib/oauth': { hasOAuthScope: (scope, required) => scope.split(' ').includes(required) },
  '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
};
const route = load('app/api/mcp/[credential]/route.ts', mocks);
test('expired context returns owned recovery target and auditable rejection without manuscript logging', async () => {
  const audits = [];
  const recoveryRoute = load('app/api/mcp/[credential]/route.ts', {
    ...mocks,
    '@/lib/crypto': { newId: () => 'draft_rejection_test' },
    '@/db': { getD1: () => ({ prepare(sql) { return { bind(...values) { return {
      async first() { assert.equal(values[1], 'owner'); return { type: 'POST_PREPARE_DRAFT', status: 'SUCCEEDED', finishedAt: Date.now() - 3 * 3600000, inputJson: JSON.stringify({ productId: 'original-product', connectKind: 'shopping' }) }; },
      async run() { audits.push({ sql, values }); return { success: true }; },
    }; } }; } }) },
  });
  const draft = { title: '상품 판단을 위한 제목', sections: Array(5).fill('제품 고유 근거 설명입니다. '.repeat(10)), hashtags: ['제품정보', '선택기준', '사용방법'] };
  const request = new Request('https://example.com/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post_submit_draft', arguments: { contextJobId: 'job_old_context', productId: 'wrong-current-product', draft, idempotencyKey: 'submit-recovery-test' } } }) });
  const result = (await (await recoveryRoute.handleMcpRequest(request, 'owner', 'mcp:write')).json()).result.structuredContent;
  assert.equal(result.code, 'DRAFT_CONTEXT_EXPIRED');
  assert.equal(result.traceId, 'draft_rejection_test');
  assert.equal(result.recovery.nextCall.arguments.productId, 'original-product');
  assert.equal(result.recovery.requiresRevalidation, true);
  assert.equal(audits.length, 1);
  assert.ok(!JSON.stringify(audits).includes(draft.title));
});
async function call(userId, scope, name, args) {
  const request = new Request('https://example.com/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return (await route.handleMcpRequest(request, userId, scope)).json();
}

test('bug report tool requires write scope and explicit consent; lookup requires read scope', async () => {
  const args = { summary: '동기화 오류', idempotencyKey: 'report-test', confirmed: true };
  assert.equal((await call('owner', 'mcp:read', 'bug_report_create', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  assert.equal((await call('owner', 'mcp:write', 'bug_report_create', { ...args, confirmed: false })).result.structuredContent.code, 'INVALID_ARGUMENT');
  assert.equal((await call('owner', 'mcp:write', 'bug_report_get', { reportId: 'bug_test' })).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
});
test('result pages require read scope and cannot read another user job', async () => {
  reads = 0;
  const denied = await call('owner', 'mcp:write', 'job_result_read', { jobId: 'job_owned' });
  assert.equal(denied.result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  assert.equal(reads, 0);
  assert.equal((await call('other', 'mcp:read', 'job_result_read', { jobId: 'job_owned' })).result.structuredContent.code, 'JOB_NOT_FOUND');
  const page = (await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned', limit: 5 })).result.structuredContent;
  assert.equal(page.text, '{"hel');
  assert.equal(page.nextOffset, 5);
});
test('status-only is opt-in; malformed arguments and page limits rejected', async () => {
  const status = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned', includeResult: false })).result.structuredContent;
  assert.equal(status.job.result, null);
  assert.equal(status.job.terminal, true);
  assert.deepEqual((await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' })).result.structuredContent.job.result, { hello: 'world' });
  assert.equal((await call('owner', 'mcp:read', 'job_get', [])).error.code, -32602);
  assert.equal((await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned', limit: 16001 })).result.structuredContent.code, 'INVALID_ARGUMENT');
});
test('publication still requires write scope and explicit confirmation', async () => {
  const args = { connectKind: 'shopping', draftId: 'draft_1', confirmed: true, idempotencyKey: 'test-publish-1' };
  assert.equal((await call('owner', 'mcp:read', 'post_publish', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  assert.equal((await call('owner', 'mcp:write', 'post_publish', { ...args, confirmed: false })).result.structuredContent.code, 'INVALID_ARGUMENT');
});

test('automatic bulk publish requires explicit mode, count and confirmation', async () => {
  const args = { connectKind: 'travel', publishMode: 'now', limit: 10, confirmed: true, idempotencyKey: 'bulk-10-fixture' };
  assert.equal((await call('owner', 'mcp:read', 'post_bulk_publish', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  for (const change of [{ publishMode: 'invalid' }, { limit: 0 }, { limit: 51 }, { confirmed: false }]) {
    assert.equal((await call('owner', 'mcp:write', 'post_bulk_publish', { ...args, ...change })).result.structuredContent.code, 'INVALID_ARGUMENT');
  }
  const { publishMode, ...missingMode } = args;
  assert.equal((await call('owner', 'mcp:write', 'post_bulk_publish', missingMode)).result.structuredContent.code, 'INVALID_ARGUMENT');
});
test('large job_get is bounded and advertised pages reconstruct stored draft', async () => {
  const previous = storedResult;
  storedResult = JSON.stringify({ markdown: '한글😀'.repeat(25000), markdownTruncated: false });
  try {
    const response = await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' });
    assert.ok(JSON.stringify(response).length < 3000);
    assert.equal(response.result.structuredContent.job.resultPaged, true);
    let args = response.result.structuredContent.job.resultRead.arguments;
    let joined = '';
    while (true) {
      const page = (await call('owner', 'mcp:read', 'job_result_read', args)).result.structuredContent;
      joined += page.text;
      if (page.nextOffset === null) break;
      args = { ...args, offset: page.nextOffset };
    }
    assert.equal(joined, storedResult);
  } finally { storedResult = previous; }
});

test('completion retry accepts only identical result from authenticated owner device', async () => {
  let device = { id: 'device1', userId: 'owner' };
  let stored = null;
  const complete = load('app/api/agent/jobs/[id]/complete/route.ts', {
    ...mocks,
    '@/lib/device': { authenticateDevice: async () => device },
    '@/lib/crypto': { newId: () => 'audit1' },
    '@/db': { getD1: () => ({
      batch: async () => [],
      prepare(sql) { return { bind(...args) { return {
        async run() {
          if (stored) return { meta: { changes: 0 } };
          stored = { status: args[0], resultJson: args[1], errorCode: args[2], errorMessage: args[3] };
          return { meta: { changes: 1 } };
        },
        async first() {
          assert.match(sql, /user_id=\? AND claimed_by_device_id=\?/);
          assert.match(sql, /status='ACTIVE'/);
          return args[1] === 'owner' && args[2] === 'device1' ? stored : null;
        },
      }; } }; },
    }) },
  });
  const send = (body) => complete.POST(new Request('https://site/api/agent/jobs/job_1234567890123456/complete', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'job_1234567890123456' }) });
  const body = { status: 'SUCCEEDED', result: { markdown: '보존한 원문' } };
  assert.equal((await send(body)).status, 200);
  assert.equal((await (await send(body)).json()).data.reused, true);
  assert.equal((await send({ status: 'FAILED', errorCode: 'NETWORK_ERROR' })).status, 409);
  device = { id: 'device2', userId: 'owner' };
  assert.equal((await send(body)).status, 409);
  device = null;
  assert.equal((await send(body)).status, 401);
});

test('SQLite route integration: duplicate completion, late heartbeat and expired publication remain terminal', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT,last_seen_at INTEGER,app_version TEXT,status_json TEXT);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,claimed_by_device_id TEXT,type TEXT,status TEXT,progress INTEGER,result_json TEXT,error_code TEXT,error_message TEXT,updated_at INTEGER,finished_at INTEGER,lease_until INTEGER,stage TEXT,stage_message TEXT,heartbeat_at INTEGER,cancel_requested INTEGER);
    CREATE TABLE audit_events(id TEXT,actor_user_id TEXT,target_user_id TEXT,action TEXT,metadata_json TEXT,created_at INTEGER);
    INSERT INTO devices(id,status) VALUES('device1','ACTIVE');`);
  const d1 = {
    prepare(sql) { return { bind(...args) { return {
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
    }; } }; },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const jobs = load('lib/jobs.ts');
  const shared = { ...mocks, '@/lib/jobs': jobs, '@/lib/device': { authenticateDevice: async () => ({ id: 'device1', userId: 'owner' }) }, '@/lib/crypto': { newId: () => 'audit1' }, '@/db': { getD1: () => d1 } };
  const complete = load('app/api/agent/jobs/[id]/complete/route.ts', shared);
  const heartbeat = load('app/api/agent/jobs/[id]/heartbeat/route.ts', shared);
  const id = 'job_1234567890123456';
  const context = { params: Promise.resolve({ id }) };
  const send = (route, body) => route.POST(new Request('https://site/api/agent/jobs', { method: 'POST', body: JSON.stringify(body) }), context);
  const body = { status: 'SUCCEEDED', result: { postUrl: 'https://example.test/published' } };
  try {
    db.prepare(`INSERT INTO agent_jobs(id,user_id,claimed_by_device_id,type,status,progress,lease_until) VALUES(?,?,?,?,?,?,?)`).run(id, 'owner', 'device1', 'POST_PUBLISH', 'RUNNING', 99, Date.now() + 120000);
    assert.equal((await send(complete, body)).status, 200);
    const before = JSON.stringify(db.prepare('SELECT * FROM agent_jobs').get());
    assert.equal((await (await send(complete, body)).json()).data.reused, true);
    assert.equal((await (await send(heartbeat, { progress: 20, stage: 'publishing' })).json()).data.active, false);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_jobs').get()), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 1);
    // A swept lease is an uncertainty state, never permission to publish again.
    db.prepare("UPDATE agent_jobs SET status='RUNNING',lease_until=1,result_json=NULL").run();
    await jobs.sweepExpiredLeases(d1, 'owner');
    assert.equal(db.prepare('SELECT error_code FROM agent_jobs').get().error_code, 'AGENT_LOST_UNCERTAIN');
    assert.equal((await send(complete, body)).status, 409);
    assert.equal((await (await send(heartbeat, {})).json()).data.active, false);
    assert.equal(db.prepare('SELECT status FROM agent_jobs').get().status, 'FAILED');
  } finally { db.close(); }
});

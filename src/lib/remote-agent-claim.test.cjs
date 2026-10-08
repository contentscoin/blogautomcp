const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : name.startsWith('.') ?
    load(path.resolve(path.dirname(filename), `${name}.ts`), mocks, globals) : require(name),
    process, console, Buffer, Request, Response, Headers, URL, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, ...globals }, { filename });
  return module.exports;
}
const claims = load('src/lib/remote-agent-claim.ts');
const completion = load('src/lib/remote-agent-completion.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const directory = options.directory || fs.mkdtempSync(path.join(os.tmpdir(), 'remote-claim-'));
  const file = 'src/app/api/remote-agent/poll/route.ts';
  const mocks = {};
  for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  const calls = [], ticks = [], localCalls = [];
  let executions = 0, countQueries = 0, revocations = 0, activated = true;
  Object.assign(mocks, {
    'next/server': { NextResponse: Response },
    '@/lib/remote-agent-claim': options.claimHelper || claims,
    '@/lib/remote-agent-completion': { ...completion, deliverCompletion: send => completion.deliverCompletion(send, async () => {}) },
    '@/lib/desktop-activity': { beginDesktopActivity: () => () => {}, getDesktopActivitySnapshot: () => ({ count: 1, activities: [] }) },
    '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
    '@/lib/remote-activation': { readRemoteActivation: () => activated ? { siteUrl: 'https://site', deviceToken: 'fixture-private-token' } : {},
      clearRemoteActivation: () => { revocations++; activated = false; } },
    '@/lib/db': { prisma: { brandLink: {
      count: async () => { countQueries++; return options.blockStatus ? new Promise(() => {}) : 0; },
      findMany: async () => { executions++; if (options.executeGate) await options.executeGate.promise; return Array.from({ length: 29 }, (_, i) => ({ id: `product-${i}`, status: 'READY' })); },
    } } },
    '@/lib/brandlink-product-list': { collapseBrandLinkProducts: rows => rows, matchesWritingStatusFilter: () => true },
    '@/lib/brand-post-package': { readBrandPostPackage: () => null },
    '@/lib/local-automation-error': load('src/lib/local-automation-error.ts'),
    '@/lib/local-json-fetch': { localJsonFetch: async (url, init) => { localCalls.push({ url: String(url), method: init.method || 'GET' });
      return Response.json({ success: true, data: { jobId: 'fixture-local-workflow', status: 'running' } }); } },
    '@/lib/naver-session': { getNaverSessionFile: () => path.join(directory, 'absent') },
    '@/lib/connect-contract-store': { hasStoredConnectContract: () => false },
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
    '../../../../../scripts/lib/app-paths': { getUserDataRoot: () => directory },
    '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
  });
  const route = load(file, mocks, {
    setInterval: fn => { ticks.push(fn); return { unref() {} }; }, clearInterval() {},
    fetch: async (url, init) => {
      const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
      calls.push(call);
      if (options.fetch) return options.fetch(call, calls);
      if (call.method === 'GET') return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
      if (url.endsWith('/claim')) return Response.json({ success: true, claimOutcome: 'job', claimRequestId: call.body.claimRequestId, data: job });
      if (url.endsWith('/heartbeat')) return Response.json({ success: true, data: { id: job.id, active: true } });
      if (url.endsWith('/complete')) return Response.json({ success: true, data: { id: job.id, status: call.body.status } });
      throw Error('Unexpected network call');
    },
  });
  const request = () => { const value = new Request('http://localhost/api/remote-agent/poll', { method: 'POST' }); value.nextUrl = new URL(value.url); return value; };
  return { directory, route, calls, ticks, localCalls, poll: async () => (await route.POST(request())).json(),
    executes: () => executions, counts: () => countQueries, revoked: () => revocations, store: claims.remoteClaimStore(directory, 'https://site', 'fixture-private-token'),
    clean: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const job = { id: 'job_1234567890abcdef', type: 'BRANDCONNECT_LIST_PRODUCTS', input: { connectKind: 'shopping' } };

test('claim receipt survives restart and isolates activation without persisting tokens or job inputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-store-'));
  try {
    const store = claims.remoteClaimStore(directory, 'https://site', 'fixture-private-token');
    const intent = store.begin('keyed');
    const fresh = load('src/lib/remote-agent-claim.ts').remoteClaimStore(directory, 'https://site', 'fixture-private-token');
    assert.equal(fresh.read().requestId, intent.requestId);
    fresh.started(intent, job);
    assert.equal(store.read().state, 'started');
    assert.equal(store.read().job.id, job.id);
    const serialized = fs.readFileSync(path.join(directory, 'remote-agent-claims', fs.readdirSync(path.join(directory, 'remote-agent-claims'))[0]), 'utf8');
    assert.equal(serialized.includes('fixture-private-token'), false);
    assert.equal(serialized.includes('connectKind'), false);
    assert.equal(claims.remoteClaimStore(directory, 'https://site', 'other-token').read(), null);
    assert.throws(() => store.clear('different-request'));
    store.clear(intent.requestId);
    assert.equal(store.read(), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('actual poll: blocked status diagnostics cannot starve claim, heartbeat or completion renewal', async () => {
  const gate = deferred();
  const f = fixture({ blockStatus: true, executeGate: gate });
  try {
    const running = f.poll();
    await turn();
    assert.equal(f.executes(), 1);
    assert.equal(f.calls.filter(c => c.url.endsWith('/heartbeat')).length, 1);
    f.ticks[0](); await turn();
    assert.equal(f.calls.filter(c => c.url.endsWith('/heartbeat')).length, 2);
    assert.equal(f.counts(), 2, 'one optional status refresh; repeated ticks never queue blocked DB snapshots');
    gate.resolve();
    const result = await running;
    assert.equal(result.success, true);
    assert.equal(f.store.read(), null);
    assert.equal(f.calls.find(c => c.url.endsWith('/complete')).body.result.data.count, 29);
  } finally { f.clean(); }
});

test('actual poll: response loss reuses durable claim key after process reload and executes once', async () => {
  let firstKey, remoteExecutions = 0;
  const fetch = async call => {
    if (call.method === 'GET') return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
    if (call.url.endsWith('/claim')) {
      if (!firstKey) { firstKey = call.body.claimRequestId; remoteExecutions++; throw Error('response lost after CAS'); }
      assert.equal(call.body.claimRequestId, firstKey);
      return Response.json({ success: true, claimOutcome: 'job', claimRequestId: firstKey, claimReused: true, data: job });
    }
    if (call.url.endsWith('/heartbeat')) return Response.json({ success: true, data: { id: job.id, active: true } });
    return Response.json({ success: true, data: { id: job.id, status: call.body.status } });
  };
  const f = fixture({ fetch });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_DELIVERY_UNCERTAIN');
    assert.equal(f.executes(), 0);
    const restarted = fixture({ directory: f.directory, fetch });
    assert.equal((await restarted.poll()).success, true);
    assert.equal(restarted.executes(), 1);
    assert.equal(remoteExecutions, 1);
    assert.equal(restarted.store.read(), null);
  } finally { f.clean(); }
});

test('actual poll: started receipt after restart never reclaims or executes an uncertain operation', async () => {
  const f = fixture();
  try {
    const intent = f.store.begin('keyed'); f.store.started(intent, job);
    const restarted = fixture({ directory: f.directory });
    assert.equal((await restarted.poll()).code, 'REMOTE_EXECUTION_UNCERTAIN');
    assert.equal(restarted.calls.length, 0);
    assert.equal(restarted.executes(), 0);
    assert.equal(restarted.store.read().job.id, job.id);
  } finally { f.clean(); }
});

test('actual poll: unpersistable pending receipt prevents even the remote claim', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.directory, 'remote-agent-claims'), 'not-directory');
    assert.equal((await f.poll()).code, 'CLAIM_RECEIPT_UNWRITABLE');
    assert.equal(f.calls.every(call => call.method === 'GET'), true);
    assert.equal(f.executes(), 0);
  } finally { f.clean(); }
});

test('actual poll: failed execution-start receipt prevents the local operation', async () => {
  const f = fixture({ claimHelper: { remoteClaimStore: (...args) => {
    const real = claims.remoteClaimStore(...args); return { ...real, started: () => { throw Error('disk write failed'); } };
  } } });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_RECEIPT_UNWRITABLE');
    assert.equal(f.executes(), 0);
    assert.equal(f.store.read().state, 'pending');
  } finally { f.clean(); }
});

test('actual poll: mismatched keyed acknowledgement cannot execute and preserves original key', async () => {
  const f = fixture({ fetch: async call => call.method === 'GET' ? Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }) :
    Response.json({ success: true, claimOutcome: 'job', data: job, claimRequestId: 'wrong-key' }) });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_ACKNOWLEDGEMENT_UNCERTAIN');
    assert.equal(f.executes(), 0);
    assert.equal(f.store.read().requestId, f.calls[1].body.claimRequestId);
  } finally { f.clean(); }
});

test('actual poll: nonterminal cancellation receipt never executes, clears or claims new work', async () => {
  const f = fixture({ fetch: async call => call.method === 'GET' ? Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }) :
    Response.json({ success: true, claimOutcome: 'job', data: null, claimRequestId: call.body.claimRequestId, claimResolved: true,
      claimedJob: { id: job.id, type: job.type, status: 'RUNNING', cancelRequested: true } }) });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_RECONCILIATION_REQUIRED');
    const requestId = f.store.read().requestId;
    assert.equal((await f.poll()).code, 'CLAIM_RECONCILIATION_REQUIRED');
    assert.equal(f.store.read().requestId, requestId);
    assert.equal(f.calls.filter(call => call.method === 'POST').every(call => call.body.claimRequestId === requestId), true);
    assert.equal(f.executes(), 0);
  } finally { f.clean(); }
});

test('actual poll: corrupted receipt remains preserved and blocks every network mutation', async () => {
  const f = fixture();
  try {
    f.store.begin('keyed');
    const receipt = path.join(f.directory, 'remote-agent-claims', fs.readdirSync(path.join(f.directory, 'remote-agent-claims'))[0]);
    fs.writeFileSync(receipt, '{invalid');
    assert.equal((await f.poll()).code, 'CLAIM_RECEIPT_UNREADABLE');
    assert.equal(f.calls.length, 0);
    assert.equal(fs.readFileSync(receipt, 'utf8'), '{invalid');
  } finally { f.clean(); }
});

test('actual poll: empty queue and terminal receipt close only their identity, without execution', async () => {
  let firstKey, round = 0;
  const f = fixture({ fetch: async call => {
    if (call.method === 'GET') return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
    assert.ok(call.url.endsWith('/claim'));
    if (!round++) firstKey = call.body.claimRequestId;
    else assert.notEqual(call.body.claimRequestId, firstKey);
    return Response.json({ success: true, claimRequestId: call.body.claimRequestId, data: null, claimResolved: true,
      ...(round === 2 ? { claimOutcome: 'job', claimedJob: { id: job.id, type: job.type, status: 'FAILED', errorCode: 'AGENT_LOST' } } : { claimOutcome: 'empty' }) });
  } });
  try {
    assert.equal((await f.poll()).data.job, null);
    assert.equal(f.store.read(), null);
    assert.equal((await f.poll()).data.claimResolved, true);
    assert.equal(f.store.read(), null);
    assert.equal(f.executes(), 0);
  } finally { f.clean(); }
});

test('actual poll: concurrent poll during capability lookup cannot claim another job', async () => {
  const gate = deferred();
  const f = fixture({ fetch: async call => {
    if (call.method === 'GET') { await gate.promise; return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }); }
    return Response.json({ success: true, data: null, claimRequestId: call.body.claimRequestId, claimResolved: true, claimOutcome: 'empty' });
  } });
  try {
    const first = f.poll(); await turn();
    assert.equal((await f.poll()).data.busy, null);
    gate.resolve(); await first;
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  } finally { f.clean(); }
});

test('actual poll: unknown handshake remains read only and creates no receipt', async () => {
  const f = fixture({ fetch: async () => { throw Error('network down'); } });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_PROTOCOL_UNAVAILABLE');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'GET');
    assert.equal(f.store.read(), null);
    assert.equal(f.revoked(), 0);
  } finally { f.clean(); }
});

for (const status of [401, 403]) {
  test(`actual poll: initial capability GET ${status} revokes activation and requests reconnection without a mutation`, async () => {
    const f = fixture({ fetch: async () => Response.json({ success: false, error: { code: 'DEVICE_REVOKED' } }, { status }) });
    try {
      const result = await f.poll();
      assert.equal(result.code, 'DEVICE_REVOKED');
      assert.equal(result.data.reconnectRequired, true);
      assert.equal(f.revoked(), 1);
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].method, 'GET');
      assert.equal(f.executes(), 0);
      assert.equal(f.localCalls.length, 0);
      assert.equal(f.store.read(), null);
      assert.equal((await f.poll()).data.configured, false);
      assert.equal(f.calls.length, 1);
    } finally { f.clean(); }
  });
}

test('actual poll: v1 capability is insufficient and cannot trigger a claim mutation', async () => {
  const f = fixture({ fetch: async () => Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v1' } }) });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_PROTOCOL_UNAVAILABLE');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'GET');
    assert.equal(f.store.read(), null);
    assert.equal(f.executes(), 0);
  } finally { f.clean(); }
});

for (const proof of [{}, { claimResolved: true }, { claimOutcome: 'empty' }, { claimResolved: true, claimOutcome: 'empty', claimedJob: { id: job.id } }]) {
  test(`actual poll: keyed empty response without immutable proof ${JSON.stringify(proof)} retains the same intent`, async () => {
    const f = fixture({ fetch: async call => call.method === 'GET' ? Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }) :
      Response.json({ success: true, data: null, claimRequestId: call.body.claimRequestId, ...proof }) });
    try {
      assert.equal((await f.poll()).code, 'CLAIM_ACKNOWLEDGEMENT_UNCERTAIN');
      const requestId = f.store.read().requestId;
      assert.equal((await f.poll()).code, 'CLAIM_ACKNOWLEDGEMENT_UNCERTAIN');
      assert.equal(f.store.read().requestId, requestId);
      assert.equal(f.calls.filter(call => call.method === 'POST').every(call => call.body.claimRequestId === requestId), true);
      assert.equal(f.executes(), 0);
      assert.equal(f.localCalls.length, 0);
    } finally { f.clean(); }
  });
}

test('actual poll: lost committed empty ACK survives reload and cannot consume later queued work under the old intent', async () => {
  let emptyRequest, lost = false, laterQueued = false;
  const fetch = async call => {
    if (call.method === 'GET') return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
    assert.ok(call.url.endsWith('/claim'));
    if (!emptyRequest) emptyRequest = call.body.claimRequestId;
    assert.equal(call.body.claimRequestId, emptyRequest, 'recover the original committed empty intent');
    if (!lost) { lost = true; throw Error('empty ACK lost after ledger commit'); }
    assert.equal(laterQueued, true);
    return Response.json({ success: true, data: null, claimRequestId: emptyRequest, claimResolved: true, claimOutcome: 'empty' });
  };
  const f = fixture({ fetch });
  try {
    assert.equal((await f.poll()).code, 'CLAIM_DELIVERY_UNCERTAIN');
    laterQueued = true;
    const restarted = fixture({ directory: f.directory, fetch });
    const result = await restarted.poll();
    assert.equal(result.data.job, null);
    assert.equal(result.data.claimResolved, true);
    assert.equal(restarted.store.read(), null);
    assert.equal(restarted.executes(), 0);
    assert.equal(restarted.localCalls.length, 0);
  } finally { f.clean(); }
});

for (const claimedJob of [{ status: 'FAILED' }, { id: 'invalid', type: job.type, status: 'FAILED' }, { id: job.id, status: 'FAILED' }]) {
  test(`actual poll: terminal acknowledgement lacks job identity ${JSON.stringify(claimedJob)} and cannot clear its receipt`, async () => {
    const f = fixture({ fetch: async call => call.method === 'GET' ? Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }) :
      Response.json({ success: true, data: null, claimRequestId: call.body.claimRequestId, claimResolved: true, claimOutcome: 'job', claimedJob }) });
    try {
      assert.equal((await f.poll()).code, 'CLAIM_RECONCILIATION_REQUIRED');
      const requestId = f.store.read().requestId;
      assert.equal((await f.poll()).code, 'CLAIM_RECONCILIATION_REQUIRED');
      assert.equal(f.store.read().requestId, requestId);
      assert.equal(f.executes(), 0);
    } finally { f.clean(); }
  });
}

for (const contradiction of [{ claimOutcome: 'empty' }, { claimOutcome: 'job', claimResolved: true }, { claimOutcome: 'job', claimedJob: { id: job.id, type: job.type, status: 'SUCCEEDED' } }]) {
  test(`actual poll: executable response with contradictory outcome ${JSON.stringify(contradiction)} cannot dispatch`, async () => {
    const f = fixture({ fetch: async call => call.method === 'GET' ? Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }) :
      Response.json({ success: true, data: job, claimRequestId: call.body.claimRequestId, ...contradiction }) });
    try {
      assert.equal((await f.poll()).code, 'CLAIM_ACKNOWLEDGEMENT_UNCERTAIN');
      assert.equal(f.store.read().state, 'pending');
      assert.equal(f.executes(), 0);
      assert.equal(f.calls.some(call => call.url.endsWith('/heartbeat')), false);
    } finally { f.clean(); }
  });
}

test('actual poll: legacy 405 executes a received job once with existing completion transport', async () => {
  const f = fixture({ fetch: async call => {
    if (call.method === 'GET') return new Response(null, { status: 405 });
    if (call.url.endsWith('/claim')) { assert.equal(call.body.claimRequestId, undefined); return Response.json({ success: true, data: job }); }
    if (call.url.endsWith('/heartbeat')) return Response.json({ success: true, data: { id: job.id, active: true } });
    return Response.json({ success: true, data: { id: job.id, status: call.body.status } });
  } });
  try { assert.equal((await f.poll()).success, true); assert.equal(f.executes(), 1); assert.equal(f.store.read(), null); }
  finally { f.clean(); }
});

test('actual poll: legacy lost response is retained and never replaced by a fresh claim', async () => {
  const f = fixture({ fetch: async call => {
    if (call.method === 'GET') return new Response(null, { status: 405 });
    throw Error('legacy claim response lost');
  } });
  try {
    const first = await f.poll(); assert.equal(first.code, 'CLAIM_DELIVERY_UNCERTAIN'); assert.equal(first.data.claimRecoverySupported, false);
    assert.equal((await f.poll()).code, 'CLAIM_DELIVERY_UNCERTAIN');
    const restarted = fixture({ directory: f.directory });
    assert.equal((await restarted.poll()).code, 'CLAIM_DELIVERY_UNCERTAIN');
    assert.equal(restarted.calls.length, 0);
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
    assert.equal(f.executes(), 0);
  } finally { f.clean(); }
});

for (const malformed of [null, { success: true }, { data: null }, { success: true, data: { id: job.id } }]) {
  test(`actual poll: malformed legacy 200 ${JSON.stringify(malformed)} preserves receipt and never sends a second claim`, async () => {
    const f = fixture({ fetch: async call => call.method === 'GET' ? new Response(null, { status: 405 }) :
      malformed === null ? new Response('{truncated', { status: 200, headers: { 'content-type': 'application/json' } }) : Response.json(malformed) });
    try {
      assert.equal((await f.poll()).code, 'CLAIM_DELIVERY_UNCERTAIN');
      const requestId = f.store.read().requestId;
      assert.equal((await f.poll()).code, 'CLAIM_DELIVERY_UNCERTAIN');
      assert.equal(f.store.read().requestId, requestId);
      assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
      assert.equal(f.executes(), 0);
      assert.equal(f.localCalls.length, 0);
    } finally { f.clean(); }
  });
}

for (const ack of ['network-loss', 'cancelled', 'lease-lost', 'wrong-job', 'malformed']) {
  test(`actual poll: initial heartbeat ${ack} prevents material mutation and execution-start marker`, async () => {
    const materialJob = { ...job, type: 'MATERIALS_PREPARE', input: { productIds: ['product-1234'] } };
    const f = fixture({ fetch: async call => {
      if (call.method === 'GET') return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
      if (call.url.endsWith('/claim')) return Response.json({ success: true, claimOutcome: 'job', claimRequestId: call.body.claimRequestId, data: materialJob });
      assert.ok(call.url.endsWith('/heartbeat'), 'failed first lease check cannot complete an unexecuted operation');
      if (ack === 'network-loss') throw Error('heartbeat response lost');
      if (ack === 'malformed') return Response.json({ success: true });
      return Response.json({ success: true, data: { id: ack === 'wrong-job' ? 'job_other' : job.id,
        active: ack !== 'lease-lost', cancelRequested: ack === 'cancelled' } });
    } });
    try {
      assert.equal((await f.poll()).code, 'JOB_LEASE_UNCONFIRMED');
      assert.equal(f.store.read().state, 'pending');
      assert.equal(f.localCalls.length, 0);
      assert.equal(f.executes(), 0);
    } finally { f.clean(); }
  });
}

test('actual poll: delayed first lease ACK precedes durable execution-start and local dispatch', async () => {
  const gate = deferred();
  const f = fixture({ fetch: async call => {
    if (call.method === 'GET') return Response.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } });
    if (call.url.endsWith('/claim')) return Response.json({ success: true, claimOutcome: 'job', data: job, claimRequestId: call.body.claimRequestId });
    if (call.url.endsWith('/heartbeat')) { await gate.promise; return Response.json({ success: true, data: { id: job.id, active: true } }); }
    return Response.json({ success: true, data: { id: job.id, status: call.body.status } });
  } });
  try {
    const running = f.poll(); await turn();
    assert.equal(f.store.read().state, 'pending');
    assert.equal(f.executes(), 0);
    gate.resolve();
    assert.equal((await running).success, true);
    assert.equal(f.executes(), 1);
    assert.equal(f.store.read(), null);
  } finally { f.clean(); }
});

test('actual poll: claim cleanup fault after completion ACK preserves outbox and recovers without execution replay', async () => {
  let failClear = true;
  const f = fixture({ claimHelper: { remoteClaimStore: (...args) => {
    const real = claims.remoteClaimStore(...args); return { ...real, clear: requestId => {
      if (failClear) throw Error('claim unlink failed after acknowledgement');
      real.clear(requestId);
    } };
  } } });
  try {
    assert.equal((await f.poll()).code, 'COMPLETION_DELIVERY_UNCERTAIN');
    assert.equal(f.executes(), 1);
    assert.equal(f.store.read().state, 'started');
    const outbox = completion.completionOutbox(f.directory, 'https://site', 'fixture-private-token');
    assert.equal(outbox.read().body.status, 'SUCCEEDED');
    failClear = false;
    assert.equal((await f.poll()).data.completionRecovered, true);
    assert.equal(f.executes(), 1);
    assert.equal(f.calls.filter(call => call.url.endsWith('/claim')).length, 2, 'one capability GET and one claim POST');
    assert.equal(outbox.read(), null);
    assert.equal(f.store.read(), null);
  } finally { f.clean(); }
});

test('actual poll: outbox delivery recovers started receipt without replaying execution', async () => {
  const f = fixture({ blockStatus: true });
  try {
    const intent = f.store.begin('keyed'); f.store.started(intent, job);
    completion.completionOutbox(f.directory, 'https://site', 'fixture-private-token').save({ job, body: { status: 'SUCCEEDED', result: { count: 29 } } });
    const result = await f.poll();
    assert.equal(result.data.completionRecovered, true);
    assert.equal(f.store.read(), null);
    assert.equal(f.executes(), 0);
    assert.equal(f.calls.some(c => c.url.endsWith('/heartbeat')), true);
    assert.equal(f.calls.some(c => c.url.endsWith('/claim')), false);
  } finally { f.clean(); }
});

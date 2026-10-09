const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const origin = 'https://blogautomcp.hiway350051.chatgpt.site';
const proofA = 'A'.repeat(43), proofB = 'B'.repeat(43);

function loader(mocks) {
  const cache = new Map();
  return function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.join(root, file);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    const localRequire = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : name.startsWith('.') ?
      (path.resolve(path.dirname(filename), `${name}.ts`) === path.join(root, 'db/index.ts') ? mocks['@/db'] : load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)))) : require(name);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  };
}

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  let identity = { userId: 'user-a' }, beforeBatch = null, failAfter = -1;
  const statement = (sql, args = []) => ({ sql, args, bind: (...values) => statement(sql, values),
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  const d1 = { prepare: sql => statement(sql), async batch(statements) {
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; await callback(); }
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((item, index) => {
        const prepared = db.prepare(item.sql);
        const result = prepared.columns().length ? { results: prepared.all(...item.args), meta: { changes: 0 } } : { meta: { changes: Number(prepared.run(...item.args).changes) } };
        if (index === failAfter) throw Error('Injected batch interruption');
        return result;
      });
      db.exec('COMMIT'); return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  const mocks = {
    'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
    '@/db': { getD1: () => d1 },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => identity },
    '@/lib/account': { ensureAccount: async () => db.prepare('SELECT id,role,status FROM users WHERE id=?').get(identity.userId), canUseMcp: a => a?.status === 'APPROVED' && ['USER', 'ADMIN'].includes(a.role) },
    '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed: true }), clientIp: () => 'fixture-ip' },
    '@/db/schema': {}, 'drizzle-orm': {},
  };
  const load = loader(mocks), init = load('db/init.ts'); mocks['@/db/init'] = init;
  await init.ensureDatabase();
  for (const id of ['user-a', 'user-b']) db.prepare('INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, `${id}@example.test`, 'USER', 'APPROVED', 1, 1);
  const codeRoute = load('app/api/device/pair-code/route.ts'), pairRoute = load('app/api/device/pair/route.ts');
  const send = async (route, body, url) => { const response = await route.POST(new Request(`${origin}${url}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { status: response.status, ...(await response.json()) }; };
  const code = () => send(codeRoute, {}, '/api/device/pair-code');
  const pair = (value, proof = proofA) => send(pairRoute, { pairCode: value, deviceName: 'Fixture PC', ...(proof === null ? {} : { deviceToken: proof }) }, '/api/device/pair');
  const seedActive = async () => {
    const crypto = load('lib/crypto.ts');
    db.prepare('INSERT INTO devices(id,user_id,token_hash,name,status,paired_at) VALUES(?,?,?,?,?,?)').run('old-device', 'user-a', await crypto.hashToken('old-token'), 'Old PC', 'ACTIVE', 1);
    for (const status of ['QUEUED', 'RUNNING']) db.prepare('INSERT INTO agent_jobs(id,user_id,type,input_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(`job-${status}`, 'user-a', 'MATERIALS_LIST', '{}', status, 1, 1);
  };
  const snapshot = () => ({ devices: db.prepare('SELECT * FROM devices ORDER BY id').all(), jobs: db.prepare('SELECT * FROM agent_jobs ORDER BY id').all(), codes: db.prepare('SELECT * FROM pair_codes ORDER BY id').all() });
  return { db, load, d1, code, pair, send, seedActive, snapshot, identity: value => { identity = value; }, beforeBatch: callback => { beforeBatch = callback; }, failAfter: value => { failAfter = value; } };
}

test('first PC code prepares one channel; concurrent tabs retain both codes and existing generation', async () => {
  const f = await fixture();
  try {
    const replies = await Promise.all([f.code(), f.code()]);
    assert.ok(replies.every(r => r.status === 200 && r.success && r.data.generation === 1));
    assert.notEqual(replies[0].data.code, replies[1].data.code);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mcp_connections').get().n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pair_codes WHERE used_at IS NULL').get().n, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM devices').get().n, 0);
    const rows = JSON.stringify(f.db.prepare('SELECT * FROM pair_codes').all());
    for (const r of replies) assert.equal(rows.includes(r.data.code), false);
    f.db.prepare('UPDATE mcp_connections SET generation=7').run();
    const channel = f.db.prepare('SELECT * FROM mcp_connections').get();
    await f.seedActive(); const before = f.snapshot();
    assert.equal((await f.code()).data.generation, 7);
    assert.deepEqual(f.db.prepare('SELECT * FROM mcp_connections').get(), channel);
    assert.deepEqual(f.snapshot().devices, before.devices);
    assert.deepEqual(f.snapshot().jobs, before.jobs);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pair_codes WHERE used_at IS NULL').get().n, 3);
  } finally { f.db.close(); }
});

test('revoked and suspended channels cannot be recreated or issue PC codes', async t => {
  for (const status of ['REVOKED', 'SUSPENDED']) await t.test(status, async () => {
    const f = await fixture();
    try { await f.code(); f.db.prepare('UPDATE mcp_connections SET status=?').run(status); const channel = f.db.prepare('SELECT * FROM mcp_connections').get();
      const r = await f.code(); assert.equal(r.status, 403); assert.equal(r.error.code, 'PC_CHANNEL_UNAVAILABLE');
      assert.deepEqual(f.db.prepare('SELECT * FROM mcp_connections').get(), channel);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pair_codes').get().n, 1);
    } finally { f.db.close(); }
  });
});

test('code issuance rechecks account approval inside the transaction', async () => {
  const f = await fixture();
  try { f.beforeBatch(() => f.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id='user-a'").run());
    assert.equal((await f.code()).status, 403);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mcp_connections').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pair_codes').get().n, 0);
    f.identity(null); assert.equal((await f.code()).status, 401);
  } finally { f.db.close(); }
});

test('code consumption, device replacement and running-job cancellation commit together', async () => {
  const f = await fixture();
  try { const c = (await f.code()).data.code; await f.seedActive();
    const r = await f.pair(c); assert.equal(r.status, 201); assert.equal(r.data.deviceToken, proofA);
    const receipt = f.db.prepare('SELECT * FROM pair_codes').get();
    assert.ok(receipt.used_at); assert.equal(receipt.paired_device_id, r.data.deviceId);
    assert.equal(receipt.pairing_token_hash, await f.load('lib/crypto.ts').hashToken(proofA));
    assert.equal(f.db.prepare("SELECT status FROM devices WHERE id='old-device'").get().status, 'REPLACED');
    assert.equal(f.db.prepare("SELECT status FROM agent_jobs WHERE id='job-RUNNING'").get().status, 'CANCELLED');
    assert.equal(f.db.prepare("SELECT status FROM agent_jobs WHERE id='job-QUEUED'").get().status, 'QUEUED');
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all()).includes(proofA), false);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM devices').all()).includes(proofA), false);
  } finally { f.db.close(); }
});

test('injected failures after consume and replacement roll back the entire device transaction', async t => {
  for (const cut of [0, 1, 2, 3]) await t.test(`statement ${cut}`, async () => {
    const f = await fixture();
    try { const c = (await f.code()).data.code; await f.seedActive(); const before = f.snapshot(); f.failAfter(cut);
      assert.equal((await f.pair(c)).status, 503); assert.deepEqual(f.snapshot(), before);
    } finally { f.db.close(); }
  });
});

test('approval revocation, channel revocation and expiry do not consume a code or replace a device', async t => {
  for (const [name, change] of [
    ['account', db => db.prepare("UPDATE users SET status='SUSPENDED' WHERE id='user-a'").run()],
    ['channel', db => db.prepare("UPDATE mcp_connections SET status='REVOKED'").run()],
    ['expiry', db => db.prepare('UPDATE pair_codes SET expires_at=1').run()],
  ]) await t.test(name, async () => {
    const f = await fixture();
    try { const c = (await f.code()).data.code; await f.seedActive(); const before = f.snapshot(); f.beforeBatch(() => change(f.db));
      assert.equal((await f.pair(c)).status, 401);
      assert.deepEqual(f.snapshot().devices, before.devices); assert.deepEqual(f.snapshot().jobs, before.jobs);
      assert.equal(f.db.prepare('SELECT used_at FROM pair_codes').get().used_at, null);
    } finally { f.db.close(); }
  });
});

test('lost successful reply can recover after expiry with the same proof without replacing twice', async () => {
  const f = await fixture();
  try { const c = (await f.code()).data.code; await f.seedActive(); const original = await f.pair(c); // discard this reply in the client
    const before = f.snapshot(); f.db.prepare('UPDATE pair_codes SET expires_at=1').run();
    const recovered = await f.pair(c);
    assert.equal(recovered.data.deviceId, original.data.deviceId); assert.equal(recovered.data.deviceToken, proofA); assert.equal(recovered.data.recovered, true);
    assert.deepEqual(f.snapshot().devices, before.devices); assert.deepEqual(f.snapshot().jobs, before.jobs);
    for (const proof of [proofB, null]) { const rejected = await f.pair(c, proof); assert.equal(rejected.status, 401); assert.equal(rejected.data, undefined); }
  } finally { f.db.close(); }
});

test('concurrent short-code calls select one device; same proof receives the same receipt', async t => {
  for (const same of [true, false]) await t.test(same ? 'same proof' : 'different proof', async () => {
    const f = await fixture();
    try { const c = (await f.code()).data.code;
      const replies = await Promise.all([f.pair(c), f.pair(c, same ? proofA : proofB)]);
      assert.equal(f.db.prepare("SELECT COUNT(*) n FROM devices WHERE status='ACTIVE'").get().n, 1);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM devices').get().n, 1);
      if (same) { assert.ok(replies.every(r => r.status === 201)); assert.equal(replies[0].data.deviceId, replies[1].data.deviceId); }
      else { assert.deepEqual(replies.map(r => r.status).sort(), [201, 401]); assert.equal(replies.find(r => r.status === 401).data, undefined); }
    } finally { f.db.close(); }
  });
});

test('legacy code clients work once, but a code alone never retrieves the permanent token', async () => {
  const f = await fixture();
  try { const c = (await f.code()).data.code; const original = await f.pair(c, null);
    assert.equal(original.status, 201); assert.match(original.data.deviceToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await f.pair(c, null)).status, 401); assert.equal((await f.pair(c)).status, 401);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM devices').get().n, 1);
  } finally { f.db.close(); }
});

test('another account cannot recover a receipt and a superseded proof never rotates back', async () => {
  const f = await fixture();
  try { const a = (await f.code()).data.code; const first = await f.pair(a);
    f.identity({ userId: 'user-b' }); const b = (await f.code()).data.code;
    // Reusing account A's proof for B violates token uniqueness; the whole batch rolls back.
    assert.equal((await f.pair(b)).status, 503);
    assert.equal(f.db.prepare("SELECT used_at FROM pair_codes WHERE user_id='user-b'").get().used_at, null);
    const second = await f.pair(b, proofB); assert.equal(second.status, 201);
    assert.notEqual(first.data.deviceId, second.data.deviceId);
    assert.equal(f.db.prepare("SELECT status FROM devices WHERE id=?").get(first.data.deviceId).status, 'ACTIVE');
    f.identity({ userId: 'user-a' }); const next = (await f.code()).data.code;
    assert.equal((await f.pair(next, 'C'.repeat(43))).status, 201);
    assert.equal((await f.pair(a)).status, 401);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM devices WHERE user_id='user-a' AND status='ACTIVE'").get().n, 1);
  } finally { f.db.close(); }
});

test('explicit MCP rotation invalidates outstanding short codes, including a pair transaction race', async () => {
  const f = await fixture();
  try { const c = (await f.code()).data.code; const rotate = f.load('app/api/mcp-connections/route.ts');
    f.beforeBatch(async () => { const r = await f.send(rotate, { action: 'rotate' }, '/api/mcp-connections'); assert.equal(r.status, 200); });
    assert.equal((await f.pair(c)).status, 401);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM devices').get().n, 0);
  } finally { f.db.close(); }
});

test('MCP URL clients share transaction approval checks and recover concurrent identical proofs', async () => {
  const f = await fixture();
  try { const rotate = f.load('app/api/mcp-connections/route.ts'); const url = (await f.send(rotate, { action: 'issue' }, '/api/mcp-connections')).data.mcpUrl;
    const request = proof => f.send(f.load('app/api/device/pair/route.ts'), { mcpUrl: url, deviceName: 'PC', deviceToken: proof }, '/api/device/pair');
    const replies = await Promise.all([request(proofA), request(proofA)]);
    assert.ok(replies.every(r => r.status === 201)); assert.equal(replies[0].data.deviceId, replies[1].data.deviceId);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM devices').get().n, 1);
    const before = f.snapshot(); f.beforeBatch(() => f.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id='user-a'").run());
    assert.equal((await request(proofB)).status, 403); assert.deepEqual(f.snapshot().devices, before.devices);
  } finally { f.db.close(); }
});

test('first-time MCP issue cannot rotate an existing channel, and simultaneous issuance has one winner', async t => {
  await t.test('existing channel and work preserved', async () => {
    const f = await fixture();
    try { await f.code(); await f.seedActive(); const channel = f.db.prepare('SELECT * FROM mcp_connections').get(), before = f.snapshot();
      const r = await f.send(f.load('app/api/mcp-connections/route.ts'), { action: 'issue' }, '/api/mcp-connections');
      assert.equal(r.status, 409); assert.equal(r.error.code, 'PC_CHANNEL_EXISTS'); assert.equal(r.data, undefined);
      assert.deepEqual(f.db.prepare('SELECT * FROM mcp_connections').get(), channel); assert.deepEqual(f.snapshot(), before);
    } finally { f.db.close(); }
  });
  await t.test('concurrent empty channel', async () => {
    const f = await fixture();
    try { const issue = () => f.send(f.load('app/api/mcp-connections/route.ts'), { action: 'issue' }, '/api/mcp-connections');
      const replies = await Promise.all([issue(), issue()]); assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mcp_connections').get().n, 1);
      assert.equal(f.db.prepare('SELECT generation FROM mcp_connections').get().generation, 1);
      assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='MCP_ISSUED'").get().n, 1);
    } finally { f.db.close(); }
  });
});

test('MCP rotation rechecks approval atomically and preserves codes, devices and jobs after revocation', async () => {
  const f = await fixture();
  try { await f.code(); await f.seedActive(); const channel = f.db.prepare('SELECT * FROM mcp_connections').get(), before = f.snapshot();
    f.beforeBatch(() => f.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id='user-a'").run());
    const r = await f.send(f.load('app/api/mcp-connections/route.ts'), { action: 'rotate' }, '/api/mcp-connections');
    assert.equal(r.status, 403); assert.equal(r.data, undefined);
    assert.deepEqual(f.db.prepare('SELECT * FROM mcp_connections').get(), channel); assert.deepEqual(f.snapshot(), before);
  } finally { f.db.close(); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const siteUrl = 'https://blogautomcp.hiway350051.chatgpt.site';
const deviceId = 'device_1234567890abcdef';
const pairCode = 'ABCDEFGH';

function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name),
    process, console, Buffer, Request, Response, URL, AbortController, setTimeout, clearTimeout, ...globals }, { filename });
  return module.exports;
}
const helper = load('src/lib/remote-device-pairing.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const directory = options.directory || fs.mkdtempSync(path.join(os.tmpdir(), 'device-pair-'));
  const calls = [], activations = [];
  let activation = options.activation || { siteUrl: '', deviceId: '', deviceToken: '' }, revocations = 0;
  class NextResponse extends Response { static json(body, init) { return new NextResponse(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json' } }); } }
  const route = load('src/app/api/remote-agent/route.ts', {
    'next/server': { NextResponse }, '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
    '@/lib/remote-activation': { readRemoteActivation: () => activation, clearRemoteActivation() { revocations++; activation = { siteUrl: '', deviceId: '', deviceToken: '' }; }, saveRemoteActivation: value => { if (options.saveFailure) throw Error('injected activation failure'); activations.push(value); activation = value; } },
    '@/lib/remote-site': { DEFAULT_REMOTE_SITE_URL: siteUrl, isAllowedRemoteSiteOrigin: value => value === siteUrl, normalizeRemoteSiteOrigin: value => { try { return new URL(value).origin; } catch { return null; } } },
    '@/lib/remote-device-pairing': options.helper || helper,
    '../../../../scripts/lib/app-paths': { getUserDataRoot: () => directory },
  }, { fetch: async (url, init) => {
    const call = { url, method: init.method, wire: init.body, body: JSON.parse(init.body), signal: init.signal }; calls.push(call);
    if (options.fetch) return options.fetch(call, calls);
    return Response.json({ success: true, data: { deviceId, deviceToken: call.body.deviceToken } }, { status: 201 });
  } });
  const send = async (body = { pairCode, siteUrl }) => { const request = new Request('http://localhost/api/remote-agent', { method: 'POST', body: JSON.stringify(body) }); const response = await route.POST(request); return { status: response.status, ...(await response.json()) }; };
  const disconnect = async () => { const response = await route.DELETE(new Request('http://localhost/api/remote-agent', { method: 'DELETE' })); return { status: response.status, ...(await response.json()) }; };
  return { directory, route, calls, activations, send, disconnect, revocations: () => revocations, activation: () => activation, proof: intent => helper.devicePairingProof(directory, siteUrl, intent || pairCode), clean: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('pair proof survives a process reload, isolates exact intent and does not store short codes in filenames', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-proof-'));
  try {
    const store = helper.devicePairingProof(directory, siteUrl, pairCode), token = store.get();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(load('src/lib/remote-device-pairing.ts').devicePairingProof(directory, siteUrl, pairCode).get(), token);
    const files = fs.readdirSync(path.join(directory, 'remote-device-pairing'));
    assert.equal(files.length, 1); assert.equal(files[0].includes(pairCode), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'remote-device-pairing', files[0]), 'utf8')), { token });
    assert.notEqual(helper.devicePairingProof(directory, siteUrl, 'BCDEFGHJ').get(), token);
    assert.notEqual(helper.devicePairingProof(directory, 'https://other-site', pairCode).get(), token);
    store.clear(); assert.notEqual(store.get(), token);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('exclusive proof creation keeps a competing process winner instead of overwriting it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-proof-race-'));
  const winner = 'W'.repeat(43);
  try {
    const racingFs = { ...fs, linkSync: (_temp, file) => { fs.writeFileSync(file, JSON.stringify({ token: winner }), { flag: 'wx' }); const error = Error('another process already committed its proof'); error.code = 'EEXIST'; throw error; } };
    const raced = load('src/lib/remote-device-pairing.ts', { 'node:fs': racingFs }).devicePairingProof(directory, siteUrl, pairCode);
    assert.equal(raced.get(), winner); assert.equal(helper.devicePairingProof(directory, siteUrl, pairCode).get(), winner);
    assert.equal(fs.readdirSync(path.join(directory, 'remote-device-pairing')).length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('actual desktop pair: a reply lost after commit retries the identical proof and activates once', async () => {
  let committedProof;
  const f = fixture({ fetch: async (call, calls) => {
    if (calls.length === 1) { committedProof = call.body.deviceToken; throw Error('lost reply after server commit'); }
    assert.equal(call.body.deviceToken, committedProof); assert.equal(call.wire, calls[0].wire);
    return Response.json({ success: true, data: { deviceId, deviceToken: committedProof, recovered: true } }, { status: 201 });
  } });
  try {
    const result = await f.send(); assert.equal(result.success, true); assert.equal(f.calls.length, 2);
    assert.equal(f.activations.length, 1); assert.equal(f.activations[0].deviceToken, committedProof);
    assert.equal(JSON.stringify(result).includes(committedProof), false);
    assert.equal(f.proof().get(), committedProof);
    assert.ok(f.proof().completed(f.activations[0]));
  } finally { f.clean(); }
});

test('actual desktop pair: uncertain replies retain proof for a later process to recover the same device', async () => {
  const f = fixture({ fetch: async () => { throw Error('lost response'); } });
  try {
    const result = await f.send(); assert.equal(result.status, 502); assert.equal(result.code, 'PAIRING_RESPONSE_UNCERTAIN');
    assert.equal(f.calls.length, 3); assert.equal(f.activations.length, 0);
    assert.ok(f.calls.every(call => call.wire === f.calls[0].wire));
    const retained = f.proof().get(); assert.equal(retained, f.calls[0].body.deviceToken);
    const restarted = fixture({ directory: f.directory });
    assert.equal((await restarted.send()).success, true);
    assert.equal(restarted.calls[0].body.deviceToken, retained); assert.equal(restarted.activations.length, 1);
  } finally { f.clean(); }
});

test('actual desktop pair: malformed 200 acknowledgements cannot save an activation', async t => {
  for (const payload of [
    { success: false, data: { deviceId, deviceToken: 'A'.repeat(43) } },
    { success: true, data: { deviceId: 'bad-device', deviceToken: 'A'.repeat(43) } },
    { success: true, data: { deviceId, deviceToken: 'short' } },
    { success: true },
  ]) await t.test(JSON.stringify(payload), async () => {
    const f = fixture({ fetch: async () => Response.json(payload) });
    try { assert.equal((await f.send()).code, 'PAIRING_RESPONSE_UNCERTAIN'); assert.equal(f.activations.length, 0);
      assert.equal(fs.readdirSync(path.join(f.directory, 'remote-device-pairing')).length, 1);
    } finally { f.clean(); }
  });
});

test('actual desktop pair: invalid or unwritable proof storage prevents any request', async t => {
  await t.test('physical invalid parent', async () => {
    const f = fixture();
    try { const invalid = path.join(f.directory, 'remote-device-pairing'); fs.writeFileSync(invalid, 'not-directory');
      const result = await f.send(); assert.equal(result.status, 503); assert.equal(result.code, 'PAIRING_PROOF_UNWRITABLE');
      assert.equal(f.calls.length, 0); assert.equal(f.activations.length, 0); assert.equal(fs.readFileSync(invalid, 'utf8'), 'not-directory');
    } finally { f.clean(); }
  });
  await t.test('corrupt proof', async () => {
    const f = fixture();
    try { f.proof().get(); const dir = path.join(f.directory, 'remote-device-pairing'); const file = path.join(dir, fs.readdirSync(dir)[0]); fs.writeFileSync(file, '{bad');
      assert.equal((await f.send()).code, 'PAIRING_PROOF_UNWRITABLE'); assert.equal(f.calls.length, 0); assert.equal(f.activations.length, 0);
      assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
    } finally { f.clean(); }
  });
});

test('actual desktop pair: concurrent clicks do not issue another pairing mutation', async () => {
  const gate = deferred();
  const f = fixture({ fetch: async call => { await gate.promise; return Response.json({ success: true, data: { deviceId, deviceToken: call.body.deviceToken } }); } });
  try { const first = f.send(); await turn(); const second = await f.send();
    assert.equal(second.status, 409); assert.equal(second.code, 'PAIRING_BUSY'); assert.equal(f.calls.length, 1);
    gate.resolve(); assert.equal((await first).success, true); assert.equal(f.activations.length, 1);
  } finally { gate.resolve(); f.clean(); }
});

test('actual desktop pair: disconnect cannot acknowledge removal during an in-flight pairing response', async () => {
  const gate = deferred();
  const f = fixture({ fetch: async call => { await gate.promise; return Response.json({ success: true, data: { deviceId, deviceToken: call.body.deviceToken } }); } });
  try { const first = f.send(); await turn();
    const blocked = await f.disconnect(); assert.equal(blocked.status, 409); assert.equal(blocked.code, 'PAIRING_BUSY'); assert.equal(blocked.success, false);
    assert.equal(blocked.data, undefined); assert.equal(f.revocations(), 0); assert.equal(f.activations.length, 0);
    gate.resolve(); assert.equal((await first).success, true); assert.equal(f.activations.length, 1);
    const disconnected = await f.disconnect(); assert.equal(disconnected.status, 200); assert.equal(disconnected.data.configured, false);
    assert.equal(f.revocations(), 1); assert.equal(f.activation().deviceToken, '');
    await turn(); assert.equal(f.activations.length, 1); assert.equal(f.activation().deviceToken, '');
  } finally { gate.resolve(); f.clean(); }
});

test('actual desktop pair: old servers may return their own token; only the received token is stored', async () => {
  const serverToken = 'Z'.repeat(43);
  const f = fixture({ fetch: async () => Response.json({ success: true, data: { deviceId, deviceToken: serverToken } }, { status: 201 }) });
  try { assert.equal((await f.send()).success, true); assert.equal(f.calls.length, 1);
    assert.notEqual(f.calls[0].body.deviceToken, serverToken); assert.equal(f.activations[0].deviceToken, serverToken);
  } finally { f.clean(); }
});

test('actual desktop pair: old-server consumed code errors stop retries without a new proof or activation', async () => {
  const f = fixture({ fetch: async (_call, calls) => { if (calls.length === 1) throw Error('old server committed but reply lost');
    return Response.json({ success: false, error: { code: 'INVALID_PAIR_CODE', message: 'used code' } }, { status: 401 }); } });
  try { assert.equal((await f.send()).code, 'INVALID_PAIR_CODE'); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].wire, f.calls[1].wire); assert.equal(f.activations.length, 0);
    assert.equal(f.proof().get(), f.calls[0].body.deviceToken);
  } finally { f.clean(); }
});

test('actual desktop pair: a legacy MCP URL mutation is sent once on response loss', async () => {
  const mcpUrl = `${siteUrl}/api/mcp/${'E'.repeat(20)}.${'S'.repeat(43)}`;
  const f = fixture({ fetch: async () => { throw Error('lost MCP URL response'); } });
  try { const result = await f.send({ mcpUrl }); assert.equal(result.code, 'PAIRING_RESPONSE_UNCERTAIN');
    assert.equal(f.calls.length, 1); assert.equal(f.activations.length, 0);
    assert.equal(f.proof(mcpUrl).get(), f.calls[0].body.deviceToken);
  } finally { f.clean(); }
});

test('actual desktop pair: activation-save failure preserves proof; receipt-update failure does not undo a saved activation', async t => {
  await t.test('save failure', async () => {
    const f = fixture({ saveFailure: true });
    try { assert.equal((await f.send()).code, 'PAIRING_RESPONSE_UNCERTAIN'); assert.equal(f.activations.length, 0); assert.equal(f.proof().get(), f.calls[0].body.deviceToken); }
    finally { f.clean(); }
  });
  await t.test('receipt-update failure after save', async () => {
    const f = fixture({ helper: { devicePairingProof: (...args) => ({ ...helper.devicePairingProof(...args), complete: () => { throw Error('injected receipt update failure'); } }) } });
    try { assert.equal((await f.send()).success, true); assert.equal(f.activations.length, 1); assert.equal(f.proof().get(), f.calls[0].body.deviceToken); }
    finally { f.clean(); }
  });
});

test('actual desktop pair: a lost local reply or repeated deep link retains the same modern proof', async () => {
  const f = fixture();
  try { await f.send(); // Discard the local HTTP acknowledgement.
    const original = f.activations[0], restarted = fixture({ directory: f.directory, activation: original });
    assert.equal((await restarted.send()).success, true);
    assert.equal(restarted.calls.length, 1); assert.equal(restarted.calls[0].body.deviceToken, original.deviceToken);
    assert.equal(restarted.activations[0].deviceId, original.deviceId);
    assert.equal(f.proof().get(), original.deviceToken);
  } finally { f.clean(); }
});

test('actual desktop pair: repeated legacy acknowledgement uses only its exact saved activation', async () => {
  const serverToken = 'Z'.repeat(43);
  const f = fixture({ fetch: async () => Response.json({ success: true, data: { deviceId, deviceToken: serverToken } }) });
  try { await f.send(); const restarted = fixture({ directory: f.directory, activation: f.activations[0], fetch: async () => { throw Error('must not replace legacy device'); } });
    assert.equal((await restarted.send()).success, true); assert.equal(restarted.calls.length, 0);
    const other = fixture({ directory: f.directory, activation: { siteUrl, deviceId: 'device_2234567890abcdef', deviceToken: 'X'.repeat(43) } });
    assert.equal((await other.send()).success, true); assert.equal(other.calls.length, 1);
    assert.notEqual(other.calls[0].body.deviceToken, serverToken);
  } finally { f.clean(); }
});

test('completed pairing receipts expire with bounded cleanup, while pending uncertain proofs remain', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-expiry-'));
  try { const completed = helper.devicePairingProof(directory, siteUrl, pairCode), token = completed.get(); completed.complete(deviceId, token);
    const dir = path.join(directory, 'remote-device-pairing'), completedFile = path.join(dir, fs.readdirSync(dir)[0]);
    const value = JSON.parse(fs.readFileSync(completedFile, 'utf8')); value.completed.at = Date.now() - helper.COMPLETED_PAIR_PROOF_TTL_MS - 1; fs.writeFileSync(completedFile, JSON.stringify(value));
    const pending = helper.devicePairingProof(directory, siteUrl, 'BCDEFGHJ'), pendingToken = pending.get();
    assert.equal(fs.existsSync(completedFile), false); assert.equal(pending.get(), pendingToken);
    assert.notEqual(completed.get(), token); assert.equal(pending.get(), pendingToken);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('actual desktop pair: null, array and primitive JSON are rejected before proof or networking', async t => {
  for (const body of [null, [], 'text', 1]) await t.test(JSON.stringify(body), async () => {
    const f = fixture(); try { assert.equal((await f.send(body)).status, 400); assert.equal(f.calls.length, 0); assert.equal(f.activations.length, 0); assert.equal(fs.existsSync(path.join(f.directory, 'remote-device-pairing')), false); } finally { f.clean(); }
  });
});

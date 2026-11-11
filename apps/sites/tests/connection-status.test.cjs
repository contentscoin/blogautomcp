const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,display_name TEXT,status TEXT,role TEXT);
    CREATE TABLE mcp_connections(id TEXT,user_id TEXT,generation INTEGER,status TEXT);
    CREATE TABLE devices(id TEXT,user_id TEXT,name TEXT,last_seen_at INTEGER,status_json TEXT,status TEXT,paired_at INTEGER);
    CREATE TABLE oauth_tokens(id TEXT,user_id TEXT,status TEXT,access_expires_at INTEGER,refresh_expires_at INTEGER);
    CREATE TABLE mcp_connection_checks(user_id TEXT PRIMARY KEY,last_read_at INTEGER,read_tool TEXT,channel_id TEXT,read_job_id TEXT);
    CREATE TABLE agent_jobs(id TEXT,user_id TEXT,claimed_by_device_id TEXT,status TEXT,error_code TEXT,type TEXT,finished_at INTEGER);
    INSERT INTO users VALUES('user-a','a@example.test','A','APPROVED','USER'),('user-b','b@example.test','B','APPROVED','USER');`);
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
  });
  const d1 = { prepare: sql => statement(sql) };
  let identity = { userId: 'user-a' };
  const mocks = {
    'cloudflare:workers': { env: {} },
    'next/server': { NextResponse: class extends Response { static json(value, init) { return Response.json(value, init); } } },
    '@/db': { getD1: () => d1 },
    '@/db/init': { ensureDatabase: async () => {} },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => identity },
    '@/lib/account': { ensureAccount: async value => db.prepare('SELECT * FROM users WHERE id=?').get(value.userId), canUseMcp: a => a?.status === 'APPROVED' },
    '@/lib/oauth': { hasOAuthScope: (scope, required) => scope.split(' ').includes(required) },
    '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
    '@/lib/agent-job-queue': { enqueueAgentJob: async () => ({ ok: true, jobId: 'read-job', status: 'QUEUED' }) },
  };
  const cache = new Map();
  function load(file) {
    const filename = path.join(root, file);
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    const localRequire = name => name in mocks ? mocks[name] : name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : require(name);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  }
  const status = load('lib/connection-status.ts');
  const mcp = load('app/api/mcp/[credential]/route.ts');
  const call = async (name, args = {}, userId = 'user-a', scope = 'mcp:read', callback = true) => {
    const request = new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await (await mcp.handleMcpRequest(request, userId, scope, undefined, callback ? (tool, jobId) => status.recordMcpRead(userId, tool, jobId) : undefined)).json()).result;
  };
  function connect(userId = 'user-a') {
    db.prepare("INSERT INTO mcp_connections VALUES(?,?,3,'ACTIVE')").run(`channel-${userId}`, userId);
    db.prepare("INSERT INTO devices VALUES(?,?,?,?,'{\"naverSessionPresent\":true}','ACTIVE',?)").run(`pc-${userId}`, userId, `PC ${userId}`, Date.now(), Date.now());
    db.prepare("INSERT INTO oauth_tokens VALUES(?,?,'ACTIVE',?,?)").run(`token-${userId}`, userId, Date.now() + 60_000, Date.now() + 120_000);
  }
  return { db, load, call, connect, ...status, setIdentity: value => { identity = value; } };
}

test('a channel, PC heartbeat and OAuth consent never claim a verified connection', async () => {
  const f = fixture();
  try {
    f.connect();
    const status = await f.readConnectionStatus('user-a');
    assert.equal(status.channel.exists, true);
    assert.equal(status.mcp.authorized, true);
    assert.equal(status.pc.online, true);
    assert.equal(status.naver.sessionSaved, true);
    assert.equal(status.mcp.readVerified, false);
    assert.equal(status.pc.roundTripVerified, false);
    assert.equal(status.ready, false);
  } finally { f.db.close(); }
});

test('ready requires an OAuth read and a successful response from this account current PC', async () => {
  const f = fixture();
  try {
    f.connect(); f.connect('user-b');
    await f.recordMcpRead('user-a', 'materials_list', 'read-job');
    f.db.prepare("INSERT INTO agent_jobs VALUES('read-job','user-a','pc-user-a','RUNNING',NULL,'MATERIALS_LIST',NULL)").run();
    assert.equal((await f.readConnectionStatus('user-a')).ready, false);
    f.db.prepare("UPDATE agent_jobs SET status='SUCCEEDED',finished_at=?").run(Date.now());
    assert.equal((await f.readConnectionStatus('user-a')).ready, true);
    assert.equal((await f.readConnectionStatus('user-b')).ready, false);
    await f.recordMcpRead('user-a', 'account_get_profile', null);
    assert.equal((await f.readConnectionStatus('user-a')).ready, true, 'profile refresh preserves current-channel receipt');
    for (const status of ['FAILED', 'CANCELLED']) {
      f.db.prepare('UPDATE agent_jobs SET status=?').run(status);
      assert.equal((await f.readConnectionStatus('user-a')).ready, false);
    }
    f.db.prepare("UPDATE agent_jobs SET status='SUCCEEDED',claimed_by_device_id='other-pc'").run();
    assert.equal((await f.readConnectionStatus('user-a')).ready, false);
    f.db.prepare("UPDATE agent_jobs SET claimed_by_device_id='pc-user-a',user_id='user-b'").run();
    assert.equal((await f.readConnectionStatus('user-a')).ready, false);
  } finally { f.db.close(); }
});

test('rotation, revocation, suspension, expiry and stale heartbeats invalidate readiness', async () => {
  const f = fixture();
  try {
    f.connect();
    await f.recordMcpRead('user-a', 'materials_list', 'read-job');
    f.db.prepare("INSERT INTO agent_jobs VALUES('read-job','user-a','pc-user-a','SUCCEEDED',NULL,'MATERIALS_LIST',?)").run(Date.now());
    assert.equal((await f.readConnectionStatus('user-a')).ready, true);
    f.db.prepare("UPDATE mcp_connections SET id='rotated'").run();
    assert.equal((await f.readConnectionStatus('user-a')).ready, false);
    await f.recordMcpRead('user-a', 'account_get_profile', null);
    assert.equal(f.db.prepare('SELECT read_job_id FROM mcp_connection_checks').get().read_job_id, null);
    f.db.prepare("UPDATE oauth_tokens SET status='REVOKED'").run();
    assert.equal((await f.readConnectionStatus('user-a')).mcp.readVerified, false);
    f.db.prepare("UPDATE oauth_tokens SET status='ACTIVE'").run();
    f.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id='user-a'").run();
    assert.equal((await f.readConnectionStatus('user-a')).pc.online, false);
    f.db.prepare("UPDATE users SET status='APPROVED' WHERE id='user-a'").run();
    f.db.prepare('UPDATE devices SET last_seen_at=?').run(Date.now() - 120_000);
    assert.equal((await f.readConnectionStatus('user-a')).pc.online, false);
    assert.equal((await f.readConnectionStatus('user-a', Date.now() + f.CONNECTION_CHECK_TTL_MS + 1)).mcp.readVerified, false);
  } finally { f.db.close(); }
});

test('profile schema identifies the authenticated account across display changes without accepting a selector', async () => {
  const f = fixture();
  try {
    f.connect();
    const listingRoute = f.load('app/api/mcp/[credential]/route.ts');
    const listing = await listingRoute.handleMcpRequest(new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), 'user-a', 'mcp:read');
    const profileTool = (await listing.json()).result.tools.find(tool => tool.name === 'account_get_profile');
    assert.equal(profileTool._meta['openai/profile'], true);
    assert.equal(profileTool.outputSchema.additionalProperties, false);
    const a = await f.call('account_get_profile');
    assert.deepEqual(a.structuredContent, { id: 'user-a', name: 'A', email: 'a@example.test' });
    f.db.prepare("UPDATE users SET email='changed@example.test',display_name='Changed' WHERE id='user-a'").run();
    assert.equal((await f.call('account_get_profile')).structuredContent.id, 'user-a');
    assert.equal((await f.call('account_get_profile', {}, 'user-b')).structuredContent.id, 'user-b');
    assert.equal((await f.call('account_get_profile', { userId: 'user-b' })).isError, true);
    f.db.prepare("UPDATE users SET status='SUSPENDED' WHERE id='user-a'").run();
    assert.equal((await f.call('account_get_profile')).isError, true);
  } finally { f.db.close(); }
});

test('domain verification publishes only the exact configured challenge and keeps OAuth metadata intact', async () => {
  const f = fixture();
  try {
    // Discovery needs the actual pure origin helpers, while MCP tests mock auth.
    const filename = path.join(root, 'app/[...wellKnown]/route.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const env = {};
    const module = { exports: {} };
    const mocks = {
      'cloudflare:workers': { env },
      'next/server': { NextResponse: class extends Response { static json(value, init) { return Response.json(value, init); } } },
      '@/lib/oauth': { DEFAULT_OAUTH_SCOPE: 'mcp:read mcp:write offline_access', mcpResource: origin => `${origin}/api/mcp`, oauthIssuer: origin => origin, trustedSiteOrigin: request => new URL(request.url).origin === 'https://example.test' ? 'https://example.test' : null },
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(name => mocks[name], module, module.exports);
    const send = (route, origin = 'https://example.test') => module.exports.GET(new Request(`${origin}/${route.join('/')}`), { params: Promise.resolve({ wellKnown: route }) });
    assert.equal((await send(['.well-known', 'openai-apps-challenge'])).status, 404);
    env.OPENAI_APPS_DOMAIN_CHALLENGE = 'public-domain-challenge-fixture';
    const response = await send(['.well-known', 'openai-apps-challenge']);
    assert.equal(await response.text(), env.OPENAI_APPS_DOMAIN_CHALLENGE);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await send(['.well-known', 'openai-apps-challenge'], 'https://evil.test')).status, 400);
    const auth = await (await send(['.well-known', 'oauth-authorization-server'])).json();
    assert.equal(auth.issuer, 'https://example.test');
    assert.equal(auth.authorization_response_iss_parameter_supported, true);
    assert.equal((await send(['.well-known', 'unknown'])).status, 404);
  } finally { f.db.close(); }
});

test('legacy calls, wrong scopes, invalid arguments and failed tools cannot record OAuth proof', async () => {
  const f = fixture();
  try {
    f.connect();
    await f.call('account_get_profile', {}, 'user-a', 'mcp:read', false);
    await f.call('account_get_profile', {}, 'user-a', 'mcp:write');
    await f.call('account_get_profile', { userId: 'user-b' });
    await f.call('missing_tool');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mcp_connection_checks').get().n, 0);
    await f.call('account_get_profile');
    assert.equal((await f.readConnectionStatus('user-a')).mcp.readVerified, true);
    assert.equal((await f.readConnectionStatus('user-a')).ready, false);
  } finally { f.db.close(); }
});

test('status GET reads only the signed-in account, requires approval, and does not enqueue work', async () => {
  const f = fixture();
  try {
    f.connect();
    const route = f.load('app/api/connection-status/route.ts');
    const response = await route.GET(new Request('https://example.test/api/connection-status?userId=user-b'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    assert.equal(payload.accountId, 'user-a');
    assert.equal(payload.data.pc.name, 'PC user-a');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 0);
    f.setIdentity(null);
    assert.equal((await route.GET(new Request('https://example.test/api/connection-status'))).status, 401);
    f.setIdentity({ userId: 'user-b' });
    f.db.prepare("UPDATE users SET status='PENDING_APPROVAL' WHERE id='user-b'").run();
    assert.equal((await route.GET(new Request('https://example.test/api/connection-status'))).status, 403);
  } finally { f.db.close(); }
});

test('a stale tab cannot read a different signed-in account using the account affinity header', async () => {
  const f = fixture();
  try {
    f.connect();
    const route = f.load('app/api/connection-status/route.ts');
    const request = expected => new Request('https://example.test/api/connection-status', { headers: { 'x-blogauto-account-id': expected } });
    assert.equal((await route.GET(request('user-a'))).status, 200);
    f.setIdentity({ userId: 'user-b' });
    const denied = await route.GET(request('user-a'));
    assert.equal(denied.status, 409);
    const payload = await denied.json();
    assert.equal(payload.error.code, 'ACCOUNT_CHANGED');
    assert.equal(payload.data, undefined);
    assert.equal(payload.accountId, undefined);
    assert.equal((await route.GET(request('user-b'))).status, 200);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_jobs').get().n, 0);
  } finally { f.db.close(); }
});

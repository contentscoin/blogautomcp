const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const origin = 'https://blogautomcp.hiway350051.chatgpt.site';
const clientId = 'https://chatgpt.com/oauth/client.json';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'valid-test-verifier-'.repeat(4);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const metadata = { client_id: clientId, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] };

function loader(mocks, fetcher) {
  const cache = new Map();
  return function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.join(root, file);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    const localRequire = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name.startsWith('.')) {
        const relative = path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)).replace(/\\/g, '/');
        return relative === 'db/index.ts' ? mocks['@/db'] : load(relative);
      }
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports,fetch){${code}\n})`, { filename })(localRequire, module, module.exports, fetcher);
    cache.set(file, module.exports);
    return module.exports;
  };
}

function authorization(scope = 'mcp:read offline_access') {
  return new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: `${origin}/api/mcp`, scope, state: 'preserved-state' });
}

async function fixture(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  let failInsert = false;
  let beforeBatch = null;
  let identity = { userId: 'user-a', email: 'a@example.test', displayName: 'A' };
  let fetchCalls = 0;
  const statement = (sql, args = []) => ({ sql, args,
    bind: (...values) => statement(sql, values),
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  const d1 = { prepare: sql => statement(sql), async batch(statements) {
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; await callback(); }
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const item of statements) {
        if (failInsert && /INSERT INTO oauth_tokens/.test(item.sql)) throw Error('Injected token insert failure');
        results.push({ meta: { changes: Number(db.prepare(item.sql).run(...item.args).changes) } });
      }
      db.exec('COMMIT');
      return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  class NextResponse extends Response {
    static json(body, init) { return Response.json(body, init); }
    static redirect(url, init) { return new NextResponse(null, { ...(typeof init === 'number' ? { status: init } : init), headers: { ...(typeof init === 'object' ? init.headers : {}), location: String(url) } }); }
  }
  const mocks = {
    'cloudflare:workers': { env: {} },
    'next/server': { NextResponse },
    'next/link': { default: 'a', __esModule: true },
    '@/db': { getD1: () => d1 },
    '@/app/chatgpt-auth': { getChatGPTUser: async () => identity, requireChatGPTUser: async () => identity },
    '@/lib/account': { ensureAccount: async () => { if (options.accountError) throw Error('private account failure'); return db.prepare('SELECT id,email,status,role FROM users WHERE id=?').get(identity.userId); }, canUseMcp: account => account?.status === 'APPROVED' && ['USER', 'ADMIN'].includes(account.role) },
  };
  const load = loader(mocks, async (url, init) => {
    fetchCalls++;
    assert.equal(String(url), clientId);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.accept, 'application/json');
    if (options.fetchError) throw Error('injected metadata network failure');
    return options.response ? options.response() : Response.json(options.metadata ?? metadata);
  });
  const init = load('db/init.ts');
  mocks['@/db/init'] = init;
  await init.ensureDatabase();
  db.prepare('INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('user-a', 'a@example.test', 'USER', 'APPROVED', 1, 1);
  db.prepare('INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('user-b', 'b@example.test', 'USER', 'APPROVED', 1, 1);
  const oauth = load('lib/oauth.ts');
  const authorize = load('app/api/oauth/authorize/route.ts');
  const token = load('app/oauth/token/route.ts');
  const code = async (userId = 'user-a', scope) => { const parsed = oauth.parseAuthorizationRequest(authorization(scope), origin); assert.equal(parsed.ok, true); return oauth.issueAuthorizationCode(userId, parsed.value); };
  const exchange = (value, overrides = {}) => oauth.exchangeAuthorizationCode(new URLSearchParams({ code: value, client_id: clientId, redirect_uri: redirectUri, resource: `${origin}/api/mcp`, code_verifier: verifier, ...overrides }), origin);
  const refresh = (value, overrides = {}) => oauth.exchangeRefreshToken(new URLSearchParams({ refresh_token: value, client_id: clientId, resource: `${origin}/api/mcp`, ...overrides }), origin);
  return { db, oauth, authorize, token, load, code, exchange, refresh, fetchCalls: () => fetchCalls, setIdentity: value => { identity = value; }, failInsert: value => { failInsert = value; }, beforeBatch: callback => { beforeBatch = callback; } };
}

function formRequest(form, url = `${origin}/api/oauth/authorize`, headers = {}) {
  return new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form.toString() });
}

test('CIMD accepts the live plural none/private_key_jwt contract and shares the bounded cache', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await Promise.all([f.oauth.validateChatGPTClientMetadata(), f.oauth.validateChatGPTClientMetadata()]), [true, true]);
    assert.equal(await f.oauth.validateChatGPTClientMetadata(), true);
    assert.equal(f.fetchCalls(), 1);
  } finally { f.db.close(); }
});

test('CIMD fails closed on changed identity, redirect, methods, missing fields and network failure', async t => {
  for (const [name, options] of [
    ['wrong identity', { metadata: { ...metadata, client_id: 'https://attacker.test/client.json' } }],
    ['wrong redirect', { metadata: { ...metadata, redirect_uris: ['https://attacker.test/callback'] } }],
    ['no public method', { metadata: { ...metadata, token_endpoint_auth_methods_supported: ['private_key_jwt'] } }],
    ['missing code flow', { metadata: { ...metadata, response_types: ['token'] } }],
    ['network error', { fetchError: true }],
    ['redirect response', { response: () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }) }],
    ['oversized document', { response: () => Response.json({ ...metadata, padding: 'x'.repeat(33000) }) }],
  ]) await t.test(name, async () => { const f = await fixture(options); try { assert.equal(await f.oauth.validateChatGPTClientMetadata(), false); assert.equal(await f.oauth.validateChatGPTClientMetadata(), false); assert.equal(f.fetchCalls(), 2); } finally { f.db.close(); } });
});

test('authorization success preserves issuer/state and does not regenerate account identity', async () => {
  const f = await fixture();
  try {
    const response = await f.authorize.POST(formRequest(authorization()));
    assert.equal(response.status, 303);
    const callback = new URL(response.headers.get('location'));
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get('iss'), origin);
    assert.equal(callback.searchParams.get('state'), 'preserved-state');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const tokens = await f.exchange(callback.searchParams.get('code'));
    assert.equal((await f.oauth.authenticateMcpOAuth(new Request(`${origin}/api/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }))).userId, 'user-a');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
  } finally { f.db.close(); }
});

test('discovery issuer/resource/PKCE/CIMD declarations match the implemented callback', async () => {
  const f = await fixture();
  try {
    const discovery = f.load('app/[...wellKnown]/route.ts');
    const request = suffix => new Request(origin + suffix);
    const context = wellKnown => ({ params: Promise.resolve({ wellKnown }) });
    const authorization = await (await discovery.GET(request('/.well-known/oauth-authorization-server'), context(['.well-known', 'oauth-authorization-server']))).json();
    const protectedResource = await (await discovery.GET(request('/.well-known/oauth-protected-resource/api/mcp'), context(['.well-known', 'oauth-protected-resource', 'api', 'mcp']))).json();
    assert.equal(authorization.issuer, origin);
    assert.equal(authorization.authorization_response_iss_parameter_supported, true);
    assert.equal(authorization.client_id_metadata_document_supported, true);
    assert.deepEqual(authorization.token_endpoint_auth_methods_supported, ['none']);
    assert.deepEqual(authorization.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(protectedResource.authorization_servers, [authorization.issuer]);
    assert.equal(protectedResource.resource, `${origin}/api/mcp`);
    assert.equal(new URL(f.oauth.authorizationErrorCallback(new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri }), origin, 'access_denied')).searchParams.get('iss'), authorization.issuer);
  } finally { f.db.close(); }
});

test('safe authorization errors echo issuer and state without redirecting an untrusted client', async t => {
  for (const [name, mutate, expected] of [
    ['bad PKCE', form => form.set('code_challenge_method', 'plain'), 'invalid_request'],
    ['unsupported response', form => form.set('response_type', 'token'), 'unsupported_response_type'],
    ['unsupported scope', form => form.set('scope', 'admin'), 'invalid_scope'],
    ['duplicate scope', form => form.append('scope', 'mcp:write'), 'invalid_request'],
  ]) await t.test(name, async () => { const f = await fixture(); try { const form = authorization(); mutate(form); const response = await f.authorize.POST(formRequest(form)); const callback = new URL(response.headers.get('location')); assert.equal(response.status, 303); assert.equal(callback.searchParams.get('error'), expected); assert.equal(callback.searchParams.get('iss'), origin); assert.equal(callback.searchParams.get('state'), 'preserved-state'); assert.equal(f.fetchCalls(), 0); } finally { f.db.close(); } });
  const f = await fixture();
  try {
    const form = authorization(); form.set('redirect_uri', 'https://attacker.test/callback');
    const response = await f.authorize.POST(formRequest(form));
    assert.equal(response.status, 400); assert.equal(response.headers.has('location'), false); assert.equal((await response.json()).iss, origin);
    assert.equal((await f.authorize.POST(formRequest(authorization(), undefined, { origin: 'https://attacker.test' }))).status, 403);
  } finally { f.db.close(); }
});

test('denied accounts, metadata outages and server failures return safe issuer-bearing errors', async t => {
  for (const [name, options, setup, expected] of [
    ['unapproved account', {}, f => f.db.prepare('UPDATE users SET status=? WHERE id=?').run('PENDING_APPROVAL', 'user-a'), 'access_denied'],
    ['no session', {}, f => f.setIdentity(null), 'access_denied'],
    ['metadata outage', { fetchError: true }, () => {}, 'temporarily_unavailable'],
    ['account failure', { accountError: true }, () => {}, 'server_error'],
  ]) await t.test(name, async () => { const f = await fixture(options); try { setup(f); const response = await f.authorize.POST(formRequest(authorization())); const callback = new URL(response.headers.get('location')); assert.equal(callback.searchParams.get('error'), expected); assert.equal(callback.searchParams.get('iss'), origin); assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM oauth_authorization_codes').get().count, 0); } finally { f.db.close(); } });
});

test('OAuth bodies are bounded without Content-Length and malformed client authentication is rejected', async () => {
  const f = await fixture();
  try {
    const form = authorization(); form.set('padding', 'x'.repeat(33000));
    assert.equal((await f.authorize.POST(formRequest(form))).status, 400);
    for (const [values, expected, headers] of [
      [{ grant_type: 'client_credentials', client_id: clientId }, 'unsupported_grant_type'],
      [{ grant_type: 'authorization_code', client_id: 'wrong-client' }, 'invalid_client'],
      [{ grant_type: 'authorization_code', client_id: clientId, client_assertion: 'unsigned' }, 'invalid_client'],
      [{ grant_type: 'authorization_code', client_id: clientId }, 'invalid_client', { authorization: 'Basic ignored' }],
    ]) { const response = await f.token.POST(formRequest(new URLSearchParams(values), `${origin}/oauth/token`, headers)); assert.equal(response.status, 400); assert.equal((await response.json()).error, expected); }
    assert.equal(await f.oauth.readOAuthForm(formRequest(authorization(), undefined, { 'content-length': '-1' })), null);
    assert.equal(await f.oauth.readOAuthForm(formRequest(authorization(), undefined, { 'content-type': 'text/plain; application/x-www-form-urlencoded' })), null);
    const code = await f.code(); f.failInsert(true);
    const failingForm = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: `${origin}/api/mcp` });
    const failed = await f.token.POST(formRequest(failingForm, `${origin}/oauth/token`));
    assert.equal(failed.status, 500); assert.equal((await failed.json()).error, 'server_error');
    assert.equal(failed.headers.get('cache-control'), 'no-store');
  } finally { f.db.close(); }
});

test('PKCE, resource binding, replay and parallel exchange are enforced by SQLite', async () => {
  const f = await fixture();
  try {
    const code = await f.code();
    assert.equal(await f.exchange(code, { code_verifier: 'wrong-verifier-'.repeat(5) }), null);
    assert.equal(await f.exchange(code, { resource: 'https://attacker.test/api/mcp' }), null);
    const results = await Promise.all([f.exchange(code), f.exchange(code)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await f.exchange(code), null);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM oauth_tokens').get().count, 1);
  } finally { f.db.close(); }
});

test('token insert failures roll back code consumption and refresh rotation', async () => {
  const f = await fixture();
  try {
    const code = await f.code(); f.failInsert(true);
    await assert.rejects(f.exchange(code), /Injected/);
    assert.equal(f.db.prepare('SELECT consumed_at FROM oauth_authorization_codes').get().consumed_at, null);
    f.failInsert(false); const tokens = await f.exchange(code); f.failInsert(true);
    await assert.rejects(f.refresh(tokens.refresh_token), /Injected/);
    assert.equal(f.db.prepare('SELECT status FROM oauth_tokens').get().status, 'ACTIVE');
    f.failInsert(false); assert.ok(await f.refresh(tokens.refresh_token));
  } finally { f.db.close(); }
});

test('refresh does not fetch CIMD; scopes cannot escalate and old tokens become unusable', async () => {
  const f = await fixture({ fetchError: true });
  try {
    const tokens = await f.exchange(await f.code());
    assert.equal(await f.refresh(tokens.refresh_token, { scope: 'mcp:read mcp:write offline_access' }), null);
    assert.equal(await f.refresh(tokens.refresh_token, { scope: '' }), null);
    const renewed = await f.refresh(tokens.refresh_token);
    assert.ok(renewed.refresh_token); assert.equal(renewed.scope, tokens.scope);
    assert.equal(f.fetchCalls(), 0);
    assert.equal(await f.refresh(tokens.refresh_token), null);
    assert.equal(await f.oauth.authenticateMcpOAuth(new Request(`${origin}/api/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } })), null);
    const readOnly = await f.refresh(renewed.refresh_token, { scope: 'mcp:read' });
    assert.equal(readOnly.refresh_token, undefined); assert.equal(readOnly.scope, 'mcp:read');
  } finally { f.db.close(); }
});

test('expiry, revoked accounts and revocation block tokens while account identity stays stable', async () => {
  const f = await fixture();
  try {
    const a = await f.exchange(await f.code('user-a', 'mcp:read'));
    const b = await f.exchange(await f.code('user-b', 'mcp:read'));
    const identify = token => f.oauth.authenticateMcpOAuth(new Request(`${origin}/api/mcp`, { headers: { authorization: `Bearer ${token}` } }));
    assert.equal((await identify(a.access_token)).userId, 'user-a'); assert.equal((await identify(b.access_token)).userId, 'user-b');
    assert.equal(a.refresh_token, undefined);
    f.db.prepare('UPDATE users SET email=? WHERE id=?').run('renamed@example.test', 'user-a');
    assert.equal((await identify(a.access_token)).userId, 'user-a');
    f.db.prepare('UPDATE users SET status=? WHERE id=?').run('REJECTED', 'user-b');
    assert.equal(await identify(b.access_token), null);
    await f.oauth.revokeOAuthToken(a.access_token, clientId); assert.equal(await identify(a.access_token), null);
    const expiredCode = await f.code(); f.db.prepare('UPDATE oauth_authorization_codes SET expires_at=0 WHERE consumed_at IS NULL').run(); assert.equal(await f.exchange(expiredCode), null);
  } finally { f.db.close(); }
});

test('account eligibility and expiration are rechecked inside the consuming transaction', async () => {
  const f = await fixture();
  try {
    const code = await f.code();
    f.beforeBatch(() => f.db.prepare('UPDATE users SET status=? WHERE id=?').run('REJECTED', 'user-a'));
    assert.equal(await f.exchange(code), null);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM oauth_tokens').get().count, 0);
    f.db.prepare('UPDATE users SET status=? WHERE id=?').run('APPROVED', 'user-a');
    const tokens = await f.exchange(code);
    f.beforeBatch(() => f.db.prepare('UPDATE oauth_tokens SET refresh_expires_at=0').run());
    assert.equal(await f.refresh(tokens.refresh_token), null);
    assert.equal(f.db.prepare('SELECT status FROM oauth_tokens').get().status, 'ACTIVE');
  } finally { f.db.close(); }
});

test('consent reflects read/write/offline scopes and keeps duplicate query values invalid', async () => {
  const f = await fixture();
  try {
    const page = f.load('app/oauth/authorize/page.tsx').default;
    const read = renderToStaticMarkup(await page({ searchParams: Promise.resolve(Object.fromEntries(authorization('mcp:read'))) }));
    assert.match(read, /상품 및 작업 상태 조회/u); assert.doesNotMatch(read, /초안 생성과 예약 작업 요청|발행 요청|토큰 자동 갱신/u);
    const write = renderToStaticMarkup(await page({ searchParams: Promise.resolve(Object.fromEntries(authorization('mcp:write offline_access'))) }));
    assert.match(write, /초안 생성과 예약 작업 요청/u); assert.match(write, /토큰 자동 갱신/u); assert.doesNotMatch(write, /상품 및 작업 상태 조회/u);
    const invalid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ ...Object.fromEntries(authorization()), scope: ['mcp:read', 'mcp:write'] }) }));
    assert.match(invalid, /중복된 OAuth 매개변수/u); assert.doesNotMatch(invalid, /이 계정으로 연결/u);
  } finally { f.db.close(); }
});

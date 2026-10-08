const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const fixtureCookies = [
  { name: 'NID_AUT', value: 'fixture-aut', domain: '.naver.com', expires: -1 },
  { name: 'NID_SES', value: 'fixture-ses', domain: '.naver.com', expires: -1 },
];
const quietConsole = { ...console, error() {} };
const next = { NextResponse: { json: (data, init) => Response.json(data, init) } };
function load(file, mocks = {}, globals = {}, tail = '') {
  const filename = path.resolve(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8') + tail, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, require: name => name in mocks ? mocks[name] : require(name),
    process: { env: { NAVER_BLOG_ID: 'fixtureblog' }, cwd: () => root }, console: quietConsole,
    URL, Request, Response, Headers, AbortController, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, Buffer,
    ...globals,
  }, { filename });
  return mod.exports;
}
function fixtureFs(cookies = fixtureCookies) {
  let writes = 0;
  return {
    readFileSync: () => JSON.stringify({ cookies }),
    existsSync: () => true, statSync: () => ({ mtime: new Date('2026-10-01T00:00:00Z') }),
    writeFileSync: () => { writes++; throw Error('status must not replace sessions'); },
    unlinkSync: () => { writes++; throw Error('status must not remove sessions'); },
    writes: () => writes,
  };
}
function validator(fetcher, cookies = fixtureCookies) {
  const fakeFs = fixtureFs(cookies);
  const snapshots = [];
  let apiGets = 0, disposals = 0, saves = 0;
  const apiContext = {
    get: async (url, options) => {
      apiGets++;
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.maxRedirects, 0);
      const result = await fetcher(url, options);
      return {
        status: () => result.status, ok: () => result.ok, url: () => result.url || 'https://blog.naver.com/PostWriteFormManagerOptions.naver',
        headers: () => ({ location: result.headers?.get?.('location') }), text: () => result.text(),
      };
    },
    storageState: async () => ({ cookies, origins: [] }), dispose: async () => { disposals++; },
  };
  const api = load('src/lib/naver-session.ts', {
    fs: fakeFs, '../../scripts/lib/app-paths': { getNaverSessionFile: () => '/configured/naver-state.json' },
    playwright: { request: { newContext: async options => {
      if (options.storageState.cookies.some(cookie => cookie.expires === undefined)) throw new Error('fixture legacy storage metadata is rejected by the request context');
      snapshots.push(options.storageState); return apiContext;
    } } },
    '../../scripts/lib/naver-session-state': {
      readNaverSessionSnapshot: sessionPath => ({ sessionPath, fingerprint: 'fixture', state: { cookies, origins: [] } }),
      readNaverSessionFingerprint: () => 'fixture',
      saveRefreshedNaverSession: async (context, snapshot, proof, _timeout, options) => { saves++; assert.equal(context, apiContext); assert.equal(options.preserveOrigins, true); assert.equal(await proof(), true); return 'unchanged'; },
    },
  });
  return { api, fakeFs, stats: () => ({ apiGets, disposals, saves, snapshots }) };
}
const successfulJson = () => new Response(JSON.stringify({ isSuccess: true }), { headers: { 'content-type': 'application/json' } });
const failureCases = [
  ['HTTP 403', async () => new Response('', { status: 403 }), 'forbidden'],
  ['HTTP 500', async () => new Response('', { status: 500 }), 'unknown'],
  ['HTTP 429', async () => new Response('', { status: 429 }), 'unknown'],
  ['network error', async () => { throw new TypeError('fixture network unavailable'); }, 'unknown'],
  ['arbitrary HTML', async () => new Response('<html>Service temporarily unavailable</html>', { headers: { 'content-type': 'text/html' } }), 'unknown'],
  ['malformed JSON', async () => new Response('{'), 'unknown'],
  ['negative API result', async () => new Response(JSON.stringify({ isSuccess: false })), 'unknown'],
  ['untrusted JSON success string', async () => new Response(JSON.stringify({ isSuccess: 'true' })), 'unknown'],
];
for (const [label, fetcher, status] of failureCases) test(`publishing probe ${label} blocks publishing without declaring login expired`, async () => {
  const { api, fakeFs, stats } = validator(fetcher);
  const result = await api.validateNaverPublishingSession('/fixture', 'fixtureblog');
  assert.equal(result.valid, false);
  assert.equal(result.status, status);
  assert.equal(result.authRequired, false);
  assert.equal(/만료|로그인.*다시|npm run login/u.test(result.error), false);
  assert.equal(fakeFs.writes(), 0);
  assert.equal(stats().saves, 0);
  assert.equal(stats().disposals, 1);
});
test('probe timeout remains unknown and preserves saved session', async () => {
  const { api, fakeFs } = validator(async (_url, options) => { assert.equal(options.timeout, 5); throw Object.assign(new Error('fixture timeout'), { name: 'TimeoutError' }); });
  const result = await api.validateNaverPublishingSession('/fixture', 'fixtureblog', 5);
  assert.equal(result.status, 'unknown');
  assert.equal(result.authRequired, false);
  assert.equal(result.valid, false);
  assert.match(result.error, /초과/);
  assert.equal(fakeFs.writes(), 0);
});
test('plain text content type containing a successful JSON response is accepted', async () => {
  const { api, stats } = validator(async () => new Response(JSON.stringify({ isSuccess: true }), { headers: { 'content-type': 'text/plain' } }));
  assert.equal((await api.validateNaverPublishingSession('/fixture', 'fixtureblog')).valid, true);
  assert.equal(stats().apiGets, 1);
  assert.equal(stats().saves, 1);
  assert.equal(stats().disposals, 1);
});
test('successful API-only probe saves rotated auth cookies after proof and preserves bound browser origins', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naver-probe-rotation-'));
  const sessionPath = path.join(directory, 'state.json');
  const cookies = fixtureCookies.map(cookie => ({ ...cookie, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }));
  const initial = { cookies, origins: [{ origin: 'https://blog.naver.com', localStorage: [{ name: 'fixture-preference', value: 'fixture-only' }] }] };
  fs.writeFileSync(sessionPath, JSON.stringify(initial));
  const helper = load('scripts/lib/naver-session-state.ts', {}, { process: { env: {}, pid: process.pid, kill: process.kill } });
  const events = [];
  let jar = initial;
  const context = {
    get: async (_url, options) => {
      assert.equal(options.headers.cookie, undefined);
      events.push('proof');
      jar = { cookies: cookies.map(cookie => cookie.name === 'NID_SES' ? { ...cookie, value: 'fixture-rotated-ses' } : cookie), origins: [] };
      return { status: () => 200, ok: () => true, url: () => 'https://blog.naver.com/PostWriteFormManagerOptions.naver', headers: () => ({}), text: async () => JSON.stringify({ isSuccess: true }) };
    },
    storageState: async () => { events.push('capture'); return JSON.parse(JSON.stringify(jar)); },
    dispose: async () => events.push('dispose'),
  };
  const api = load('src/lib/naver-session.ts', {
    '../../scripts/lib/app-paths': {}, '../../scripts/lib/naver-session-state': helper,
    playwright: { request: { newContext: async options => { events.push('api-context'); assert.equal(options.storageState.cookies[1].value, 'fixture-ses'); return context; } }, chromium: { launch() { throw Error('must not launch a browser'); } } },
  });
  try {
    const result = await api.validateNaverPublishingSession(sessionPath, 'fixtureblog');
    assert.equal(result.valid, true);
    assert.deepEqual(events, ['api-context', 'proof', 'capture', 'dispose']);
    const saved = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.equal(saved.cookies.find(cookie => cookie.name === 'NID_SES').value, 'fixture-rotated-ses');
    assert.deepEqual(saved.origins, initial.origins);
    assert.equal(fs.readdirSync(directory).length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
for (const saveResult of ['unavailable', 'unverified', 'throws', 'superseded']) test(`save ${saveResult} after positive proof preserves state and reports accurate current validity`, async () => {
  let disposals = 0;
  const context = {
    get: async () => ({ status: () => 200, ok: () => true, url: () => 'https://blog.naver.com/PostWriteFormManagerOptions.naver', headers: () => ({}), text: async () => JSON.stringify({ isSuccess: true }) }),
    dispose: async () => { disposals++; },
  };
  const api = load('src/lib/naver-session.ts', {
    '../../scripts/lib/app-paths': {},
    '../../scripts/lib/naver-session-state': { readNaverSessionSnapshot: sessionPath => ({ sessionPath, fingerprint: 'fixture', state: { cookies: fixtureCookies, origins: [] } }), readNaverSessionFingerprint: () => 'fixture', saveRefreshedNaverSession: async () => { if (saveResult === 'throws') throw Error('fixture storage failure'); return saveResult; } },
    playwright: { request: { newContext: async () => context } },
  });
  const result = await api.validateNaverPublishingSession('/fixture', 'fixtureblog');
  assert.equal(result.valid, saveResult !== 'superseded');
  assert.equal(result.authRequired, false);
  if (saveResult === 'superseded') { assert.equal(result.status, 'unknown'); assert.match(result.error, /변경/); }
  else assert.match(result.warning, /저장하지 못/);
  assert.equal(disposals, 1);
});
for (const mode of ['capture-error', 'unverified-capture', 'late-cleanup-change', 'missing-current-file', 'unreadable-fingerprint']) test(`old positive proof ${mode} cannot validate changed or unreadable current session`, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naver-proof-continuity-'));
  const sessionPath = path.join(directory, 'state.json');
  const cookies = fixtureCookies.map(cookie => ({ ...cookie, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }));
  const initial = JSON.stringify({ cookies, origins: [] });
  const newManual = JSON.stringify({ cookies: cookies.map(cookie => ({ ...cookie, value: `${cookie.value}-new-manual` })), origins: [] });
  fs.writeFileSync(sessionPath, initial);
  const actualHelper = load('scripts/lib/naver-session-state.ts', {}, { process: { env: {}, pid: process.pid, kill: process.kill } });
  const helper = mode === 'unreadable-fingerprint' ? { ...actualHelper, readNaverSessionFingerprint: () => { throw Error('fixture read failure'); } } : actualHelper;
  let disposals = 0;
  const context = {
    get: async () => {
      if (mode === 'capture-error' || mode === 'unverified-capture') fs.writeFileSync(sessionPath, newManual);
      if (mode === 'missing-current-file') fs.unlinkSync(sessionPath);
      return { status: () => 200, ok: () => true, url: () => 'https://blog.naver.com/PostWriteFormManagerOptions.naver', headers: () => ({}), text: async () => JSON.stringify({ isSuccess: true }) };
    },
    storageState: async () => {
      if (mode === 'unverified-capture') return { cookies: cookies.slice(0, 1), origins: [] };
      if (mode !== 'late-cleanup-change') throw Error('fixture capture failure');
      return { cookies, origins: [] };
    },
    dispose: async () => { disposals++; if (mode === 'late-cleanup-change') fs.writeFileSync(sessionPath, newManual); },
  };
  const api = load('src/lib/naver-session.ts', {
    '../../scripts/lib/app-paths': {}, '../../scripts/lib/naver-session-state': helper,
    playwright: { request: { newContext: async () => context } },
  });
  try {
    const result = await api.validateNaverPublishingSession(sessionPath, 'fixtureblog');
    assert.equal(result.valid, false);
    assert.equal(result.status, 'unknown');
    assert.equal(result.authRequired, false);
    assert.equal(result.code, 'NAVER_SESSION_CHECK_FAILED');
    assert.equal(disposals, 1);
    if (['capture-error', 'unverified-capture', 'late-cleanup-change'].includes(mode)) assert.equal(fs.readFileSync(sessionPath, 'utf8'), newManual);
    else if (mode === 'unreadable-fingerprint') assert.equal(fs.readFileSync(sessionPath, 'utf8'), initial);
    else assert.equal(fs.existsSync(sessionPath), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('browser proof uses its existing cookie jar and does not create or launch a new browser', async () => {
  let gets = 0;
  const { api, stats } = validator(async () => { throw Error('must not use standalone API probe'); });
  assert.equal(await api.verifyNaverPublishingContext({ request: { get: async (_url, options) => {
    gets++;
    assert.equal(options.headers.cookie, undefined);
    return { status: () => 200, ok: () => true, url: () => 'https://blog.naver.com/PostWriteFormManagerOptions.naver', headers: () => ({}), text: async () => JSON.stringify({ isSuccess: true }) };
  } } }, 'fixtureblog'), true);
  assert.equal(gets, 1);
  assert.equal(stats().snapshots.length, 0);
});
for (const [label, fetcher] of [
  ['401', async () => new Response('', { status: 401 })],
  ['Naver login redirect', async () => ({ status: 200, ok: true, url: 'https://nid.naver.com/nidlogin.login?url=https://blog.naver.com', text: async () => '<html>login</html>' })],
  ['Naver login Location without following redirect', async () => new Response('', { status: 302, headers: { location: 'https://nid.naver.com/nidlogin.login?url=https://blog.naver.com' } })],
]) test(`confirmed ${label} requires authentication`, async () => {
  const { api, fakeFs } = validator(fetcher);
  const result = await api.validateNaverPublishingSession('/fixture', 'fixtureblog');
  assert.equal(result.valid, false);
  assert.equal(result.status, 'auth-required');
  assert.equal(result.authRequired, true);
  assert.equal(result.code, 'NAVER_SESSION_EXPIRED');
  assert.equal(fakeFs.writes(), 0);
});
for (const [label, cookies] of [
  ['analytics only', [{ name: 'NNB', value: 'fixture', domain: '.naver.com', expires: -1 }]],
  ['missing NID_SES', fixtureCookies.slice(0, 1)],
  ['expired NID_SES', fixtureCookies.map(cookie => cookie.name === 'NID_SES' ? { ...cookie, expires: 1 } : cookie)],
  ['epoch-zero NID_SES', fixtureCookies.map(cookie => cookie.name === 'NID_SES' ? { ...cookie, expires: 0 } : cookie)],
  ['non-finite NID_SES expiry', fixtureCookies.map(cookie => cookie.name === 'NID_SES' ? { ...cookie, expires: NaN } : cookie)],
  ['wrong-domain auth cookies', fixtureCookies.map(cookie => ({ ...cookie, domain: '.example.test' }))],
  ['host-only parent auth cookies', fixtureCookies.map(cookie => ({ ...cookie, domain: 'naver.com' }))],
]) test(`${label} cannot prove Naver authentication or call the account endpoint`, async () => {
  let calls = 0;
  const { api } = validator(async () => { calls++; return successfulJson(); }, cookies);
  const result = await api.validateNaverPublishingSession('/fixture', 'fixtureblog');
  assert.equal(result.authRequired, true);
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
});
test('configuration and unreadable session are not authentication expiration', async () => {
  const { api } = validator(async () => successfulJson());
  assert.equal((await api.validateNaverPublishingSession('/fixture', '')).status, 'configuration');
  const broken = load('src/lib/naver-session.ts', {
    fs: { readFileSync() { throw Error('fixture IO error'); } }, '../../scripts/lib/app-paths': {}, playwright: {},
    '../../scripts/lib/naver-session-state': { readNaverSessionSnapshot() { throw Error('fixture IO error'); } },
  });
  assert.equal((await broken.validateNaverPublishingSession('/fixture', 'fixtureblog')).status, 'unknown');
});
test('legacy missing expiry metadata remains unknown rather than deleting or expiring saved authentication', async () => {
  const cookies = fixtureCookies.map(({ expires: _expires, ...cookie }) => cookie);
  const { api, fakeFs, stats } = validator(async () => successfulJson(), cookies);
  const result = await api.validateNaverPublishingSession('/fixture', 'fixtureblog');
  assert.equal(result.valid, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.authRequired, false);
  assert.equal(stats().apiGets, 0);
  assert.equal(fakeFs.writes(), 0);
});
for (const [label, fetcher, status] of failureCases) test(`session API reports ${label} neutrally`, async () => {
  const { api, fakeFs } = validator(fetcher);
  const route = load('src/app/api/session/route.ts', {
    'next/server': next, fs: fakeFs, '@/lib/naver-session': api,
    '@/lib/api-auth': { requireRemoteActivation: () => null },
    '@/lib/chatgpt-browser-automation': { readChatGptBrowserSessionSummary: () => ({ hasSession: false, isValid: false }), isChatGptBrowserAutomationEnabled: () => true },
    '../../../../scripts/lib/app-paths': { getNaverSessionFile: () => '/configured/naver-state.json' },
  });
  const body = await (await route.GET(new Request('http://localhost/api/session'))).json();
  assert.equal(body.success, true);
  assert.equal(body.data.naver.hasSession, true);
  assert.equal(body.data.naver.isValid, false);
  assert.equal(body.data.naver.status, status);
  assert.equal(body.data.naver.authRequired, false);
  assert.equal(/만료|npm run login/u.test(body.data.naver.error), false);
  assert.equal(fakeFs.writes(), 0);
});
for (const [label, fetcher, status] of failureCases) test(`categories API ${label} never requests relogin`, async () => {
  const { api, fakeFs } = validator(fetcher);
  const route = load('src/app/api/blog/categories/route.ts', {
    'next/server': next, fs: fakeFs, '@/lib/naver-session': api,
    '@/lib/api-auth': { requireRemoteActivation: () => null },
  }, { fetch: fetcher });
  const response = await route.GET(new Request('http://localhost/api/blog/categories'));
  const body = await response.json();
  assert.equal(response.status, status === 'forbidden' ? 403 : 503);
  assert.equal(body.success, false);
  assert.equal(body.authRequired, false);
  assert.equal(body.sessionStatus, status);
  assert.equal(fakeFs.writes(), 0);
});
for (const [status, code] of [['unknown', 'NAVER_SESSION_CHECK_FAILED'], ['forbidden', 'NAVER_SESSION_FORBIDDEN'], ['auth-required', 'NAVER_SESSION_EXPIRED'], ['configuration', 'NAVER_SESSION_CONFIGURATION_REQUIRED']]) {
  test(`bulk route ${status} stops before spawning any work and uses accurate failure code`, async () => {
    let spawns = 0, checkedPath;
    const route = load('src/app/api/brandlinks/bulk-seasonal/route.ts', {
      'next/server': next, fs: { existsSync: () => true }, child_process: { spawn: () => { spawns++; throw Error('should never execute'); } },
      '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/update-guard': { requireNoPendingDesktopUpdate: () => null },
      '@/lib/db': { prisma: { brandLink: { count: async () => 0 } } }, '@/lib/publication-recovery': { recoverExitedPublications: async () => {} },
      '@/lib/brandconnect-kind': { parseConnectKind: () => 'shopping' }, '@/lib/connect-contract-store': { resolveConnectContract: () => ({ configuredUrl: 'https://example.test/fixture', captureRequired: false }) },
      '../../../../../scripts/lib/app-paths': {}, '@/lib/naver-session': {
        getNaverSessionFile: () => '/configured/naver-state.json',
        validateNaverPublishingSession: async target => { checkedPath = target; return { valid: false, status, code, authRequired: status === 'auth-required', error: 'Fixture verification result' }; },
      },
    });
    const response = await route.POST(new Request('http://localhost/api/brandlinks/bulk-seasonal', { method: 'POST', body: '{}' }));
    const body = await response.json();
    assert.equal(response.status, status === 'auth-required' ? 401 : status === 'forbidden' ? 403 : status === 'configuration' ? 400 : 503);
    assert.equal(body.code, code);
    assert.equal(body.authRequired, status === 'auth-required');
    assert.equal(checkedPath, '/configured/naver-state.json');
    assert.equal(spawns, 0);
  });
}
test('MCP error classification preserves explicit Naver uncertainty and permission codes', () => {
  const { classifyLocalFailure } = load('src/lib/local-automation-error.ts');
  for (const code of ['NAVER_SESSION_CHECK_FAILED', 'NAVER_SESSION_FORBIDDEN', 'NAVER_SESSION_CONFIGURATION_REQUIRED']) {
    assert.equal(classifyLocalFailure({ status: 503, code, message: '네이버 로그인 세션 상태 확인 실패' }), code);
    assert.equal(classifyLocalFailure({ status: 500, message: `${code}: 상태 확인 실패` }), code);
  }
  assert.equal(classifyLocalFailure({ status: 503, message: '네이버 로그인 세션 상태 확인 시간이 초과되었습니다.' }), 'LOCAL_AUTOMATION_FAILED');
  assert.equal(classifyLocalFailure({ status: 500, message: '네이버 로그인 세션 상태 확인 시간이 초과되었습니다.' }), 'LOCAL_AUTOMATION_FAILED');
  assert.equal(classifyLocalFailure({ status: 401 }), 'LOCAL_AUTOMATION_FAILED');
  assert.equal(classifyLocalFailure({ status: 401, code: 'ADMIN_AUTH_REQUIRED', message: '관리자 인증이 필요합니다.', path: '/api/blog/categories' }), 'LOCAL_AUTOMATION_FAILED');
  assert.equal(classifyLocalFailure({ status: 401, code: 'UNAUTHORIZED', message: '크론 인증이 필요합니다.', path: '/api/cron' }), 'LOCAL_AUTOMATION_FAILED');
  assert.equal(classifyLocalFailure({ status: 401, code: 'NAVER_SESSION_EXPIRED', message: '네이버에서 로그인이 필요하다고 응답했습니다.' }), 'NAVER_SESSION_EXPIRED');
});
test('main Naver login reuses saved cookies while account change explicitly resets; ChatGPT behavior is retained', async () => {
  const calls = [];
  const react = { useState: value => [value, () => {}], useCallback: fn => fn, useEffect() {} };
  const component = load('src/components/SessionStatus.tsx', { react }, {
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ success: true, data: {} }); },
  });
  const tree = component.default();
  function buttons(node, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(child => buttons(child, result)); return result; }
    if (node.type === 'button') result.push(node);
    buttons(node.props?.children, result);
    return result;
  }
  function text(node) {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : '';
  }
  const controls = buttons(tree);
  await controls.find(button => text(button).includes('전용 창에서 기존 로그인을 이어 확인')).props.onClick();
  await controls.find(button => text(button) === '다른 네이버 계정으로 로그인').props.onClick();
  await controls.find(button => text(button).includes('웹 GPT 재로그인')).props.onClick();
  await Promise.resolve();
  assert.equal(calls[0].body.provider, 'naver');
  assert.equal(calls[0].body.force, false);
  assert.equal(calls[1].body.force, true);
  assert.equal(calls[2].body.provider, 'chatgpt');
  assert.equal(calls[2].body.force, true);
});
for (const prior of [null, { hasSession: true, isValid: true, naver: { hasSession: true, isValid: true, status: 'valid' }, chatgpt: { hasSession: true, isValid: true, marker: 'retain-chatgpt' } }]) {
  for (const failure of ['network', 'non-ok', 'malformed-json']) test(`main UI ${failure} ${prior ? 'after success' : 'initially'} becomes neutral unknown and can be checked again`, async () => {
    const states = [], callbacks = [];
    const react = {
      useState: initial => { const index = states.length; states.push(index === 0 ? prior : initial); return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update; }]; },
      useCallback: callback => { callbacks.push(callback); return callback; }, useEffect() {},
    };
    let failing = true;
    const component = load('src/components/SessionStatus.tsx', { react }, { fetch: async () => {
      if (!failing) return Response.json({ success: true, data: { hasSession: true, isValid: true, naver: { hasSession: true, isValid: true, status: 'valid' }, chatgpt: { hasSession: true, isValid: true } } });
      if (failure === 'network') throw new TypeError('fixture connection failure');
      return failure === 'non-ok' ? Response.json({ success: false }, { status: 503 }) : new Response('{');
    } });
    component.default();
    await callbacks[0]();
    assert.equal(states[0].naver.isValid, false);
    assert.equal(states[0].naver.status, 'unknown');
    assert.equal(states[0].naver.authRequired, false);
    assert.equal(states[0].naver.hasSession, prior?.naver.hasSession || false);
    assert.equal(/만료|로그인.*필요/u.test(states[0].naver.error), false);
    if (prior) assert.equal(states[0].chatgpt, prior.chatgpt);
    failing = false;
    await callbacks[0]();
    assert.equal(states[0].naver.isValid, true);
    assert.equal(states[0].naver.status, 'valid');
  });
}
for (const proofMode of ['verified', 'public-html-only', 'wrong-space', 'superseded']) test(`shopping options ${proofMode} preserves session unless the existing account and space prove authentication`, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naver-options-'));
  const sessionPath = path.join(directory, 'state.json');
  const cookies = fixtureCookies.map(cookie => ({ ...cookie, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }));
  const initial = JSON.stringify({ cookies, origins: [] });
  fs.writeFileSync(sessionPath, initial);
  const helper = load('scripts/lib/naver-session-state.ts', {}, { process: { env: {}, pid: process.pid, kill: process.kill } });
  const kind = load('src/lib/brandconnect-kind.ts');
  const events = [];
  let captures = 0, disposed = 0, jar = { cookies, origins: [] };
  const apiContext = {
    get: async (url, options) => {
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.maxRedirects, 0);
      const pathname = new URL(url).pathname;
      events.push(pathname);
      let status = 200, payload = [];
      if (pathname === '/brand-connect/query/me') {
        if (proofMode === 'public-html-only') status = 500;
        payload = { loginId: 'fixture-account', space: { id: proofMode === 'wrong-space' ? 9 : 7 } };
        jar = { cookies: cookies.map(cookie => cookie.name === 'NID_SES' ? { ...cookie, value: 'fixture-options-rotated' } : cookie), origins: [] };
        if (proofMode === 'superseded') fs.writeFileSync(sessionPath, initial.replace('fixture-ses', 'fixture-new-manual-login'));
      } else if (pathname.endsWith('/base-display-categories')) payload = [{ id: 8, name: 'fixture-category' }];
      else if (pathname.endsWith('/search-by-display-category')) payload = { data: [{ productName: 'fixture-product', storeName: 'fixture-store' }] };
      return { status: () => status, ok: () => status === 200, url: () => url, headers: () => ({}), json: async () => payload, text: async () => '<html>public promotional page</html>' };
    },
    storageState: async () => { captures++; events.push('capture'); return JSON.parse(JSON.stringify(jar)); },
    dispose: async () => { disposed++; },
  };
  const access = load('src/lib/shopping-connect-access.ts', { './brandconnect-kind': kind, './naver-session': {}, '../../scripts/lib/naver-session-state': helper });
  const route = load('src/app/api/brandlinks/selection-options/route.ts', {
    'next/server': next, playwright: { request: { newContext: async () => apiContext } },
    '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/brandconnect-kind': kind,
    '@/lib/connect-contract-store': { resolveConnectContract: () => ({ configuredUrl: 'https://brandconnect.naver.com/7/affiliate/products/category/8', captureRequired: false, registrationAvailable: true }) },
    '@/lib/naver-session': { getNaverSessionFile: () => sessionPath }, '../../../../../scripts/lib/naver-session-state': helper,
    '@/lib/shopping-connect-access': { ...access, resolveShoppingCategoryUrl: async value => value },
    '@/lib/travel-connect-adapter': { ConnectSessionExpiredError: class extends Error {}, ConnectAccessDeniedError: class extends Error {}, ConnectContractNotFoundError: class extends Error {} },
    '@/lib/travel-selection-options': {},
  });
  try {
    const request = new Request('http://localhost/api/brandlinks/selection-options'); request.nextUrl = new URL(request.url);
    const response = await route.GET(request);
    const body = await response.json();
    assert.equal(response.status, proofMode === 'superseded' ? 503 : 200);
    assert.equal(body.success, proofMode !== 'superseded');
    assert.equal(disposed, 1);
    if (proofMode === 'verified') {
      assert.equal(captures, 1);
      assert.ok(events.indexOf('capture') > events.indexOf('/brand-connect/query/me'));
      assert.equal(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).cookies[1].value, 'fixture-options-rotated');
    } else if (proofMode === 'superseded') {
      assert.equal(body.code, 'NAVER_SESSION_CHECK_FAILED');
      assert.equal(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).cookies[1].value, 'fixture-new-manual-login');
    } else { assert.equal(captures, 0); assert.equal(fs.readFileSync(sessionPath, 'utf8'), initial); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('travel options permission denial is HTTP 403 rather than expired authentication', async () => {
  class Denied extends Error { constructor() { super('fixture permission denied'); this.code = 'NAVER_SESSION_FORBIDDEN'; } }
  const route = load('src/app/api/brandlinks/selection-options/route.ts', {
    'next/server': next, fs: { existsSync: () => true }, playwright: {},
    '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/brandconnect-kind': { parseConnectKind: () => 'travel' },
    '@/lib/connect-contract-store': { resolveConnectContract: () => ({ configuredUrl: 'https://example.test/fixture', captureRequired: false }) },
    '@/lib/naver-session': { getNaverSessionFile: () => '/fixture' }, '../../../../../scripts/lib/naver-session-state': {},
    '@/lib/shopping-connect-access': { ShoppingConnectAccessError: class extends Error {} },
    '@/lib/travel-connect-adapter': { ConnectSessionExpiredError: class extends Error {}, ConnectAccessDeniedError: Denied, ConnectContractNotFoundError: class extends Error {}, listTravelItems: async () => { throw new Denied(); } },
    '@/lib/travel-selection-options': {},
  });
  const request = new Request('http://localhost/api/brandlinks/selection-options?connectKind=travel'); request.nextUrl = new URL(request.url);
  const response = await route.GET(request), body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, 'NAVER_SESSION_FORBIDDEN');
  assert.equal(body.authRequired, false);
});
for (const [file, method] of [['src/app/api/brandlinks/available/route.ts', 'GET'], ['src/app/api/brandlinks/travel-contract/route.ts', 'POST']]) {
  test(`${file} preserves permission denial with no browser or database mutation`, async () => {
    let writes = 0;
    class Denied extends Error { constructor() { super('fixture permission denied'); this.code = 'NAVER_SESSION_FORBIDDEN'; } }
    const rejectPermission = async () => { throw new Denied(); };
    const route = load(file, {
      'next/server': next, 'node:fs': { existsSync: () => true, mkdirSync: () => { writes++; }, writeFileSync: () => { writes++; } },
      '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
      '@/lib/naver-session': { getNaverSessionFile: () => '/fixture' }, '../../../../../scripts/lib/app-paths': { getNaverSessionFile: () => '/fixture', getLogsDir: () => '/fixture-logs' },
      '@/lib/db': { prisma: { brandLink: { findMany: () => { throw Error('must stop before DB access'); } } } },
      '@/lib/brand-post-package': {}, '@/lib/brandlink-product-list': {},
      '@/lib/travel-connect-adapter': { ConnectSessionExpiredError: class extends Error {}, ConnectAccessDeniedError: Denied, ConnectContractNotFoundError: class extends Error {}, listTravelItems: rejectPermission, discoverConnectContract: rejectPermission, isValidConnectUrl: () => true },
    });
    const request = new Request('http://localhost/api/fixture', method === 'POST' ? { method: 'POST', body: '{}' } : undefined); request.nextUrl = new URL(request.url);
    const response = await route[method](request), body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.code, 'NAVER_SESSION_FORBIDDEN');
    assert.equal(body.authRequired, false);
    assert.equal(writes, 0);
  });
}

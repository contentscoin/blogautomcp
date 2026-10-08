/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner loads the TypeScript helper through ts-node. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ project: path.resolve(__dirname, '../../tsconfig.scripts.json'), transpileOnly: true });
const {
  readNaverSessionSnapshot, readNaverSessionFingerprint, readNaverManualSessionBaseline, saveRefreshedNaverSession,
  maintainNaverSession, commitNaverLoginSession,
} = require('./naver-session-state.ts');

function state(value = 'fixture-old', expires = Date.now() / 1000 + 3600) {
  return { cookies: [
    { name: 'NID_AUT', value: `auth-${value}`, domain: '.naver.com', path: '/', expires, httpOnly: true, secure: true, sameSite: 'None' },
    { name: 'NID_SES', value, domain: '.naver.com', path: '/', expires, httpOnly: true, secure: true, sameSite: 'None' },
  ], origins: [] };
}
function fixture(t, initial = state()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'naver-session-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionPath = path.join(root, 'session.json');
  if (initial) fs.writeFileSync(sessionPath, JSON.stringify(initial));
  return { root, sessionPath, snapshot: initial ? readNaverSessionSnapshot(sessionPath) : null };
}
const cookieValue = snapshot => snapshot.state.cookies.find(cookie => cookie.name === 'NID_SES').value;
const context = jar => ({ async storageState(options) { assert.equal(options.indexedDB, true); return structuredClone(jar); } });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('proof Set-Cookie rotation is captured after success and survives a restart', async t => {
  const f = fixture(t);
  const jar = state();
  const renewedExpiry = jar.cookies[0].expires + 7200;
  const result = await saveRefreshedNaverSession(context(jar), f.snapshot, async () => {
    jar.cookies = state('fixture-rotated', renewedExpiry).cookies;
    return true;
  });
  assert.equal(result, 'saved');
  const restarted = readNaverSessionSnapshot(f.sessionPath);
  assert.equal(cookieValue(restarted), 'fixture-rotated');
  assert.equal(restarted.state.cookies[0].expires, renewedExpiry, 'server expiry is preserved without artificial extension');
});

test('old worker cannot overwrite a newer manual authentication', async t => {
  const f = fixture(t);
  const pendingPath = path.join(f.root, 'manual.json');
  fs.writeFileSync(pendingPath, JSON.stringify(state('fixture-manual')));
  commitNaverLoginSession(pendingPath, f.sessionPath, readNaverManualSessionBaseline(f.sessionPath), true);
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-worker')), f.snapshot, async () => true), 'superseded');
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-manual');
});

test('completion order cannot let an older manual login overwrite a newer one', t => {
  const f = fixture(t);
  const oldBaseline = readNaverManualSessionBaseline(f.sessionPath);
  const newer = path.join(f.root, 'newer.json');
  const older = path.join(f.root, 'older.json');
  fs.writeFileSync(newer, JSON.stringify(state('fixture-newer')));
  fs.writeFileSync(older, JSON.stringify(state('fixture-older')));
  commitNaverLoginSession(newer, f.sessionPath, oldBaseline, true);
  assert.throws(() => commitNaverLoginSession(older, f.sessionPath, oldBaseline, true));
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-newer');
});

test('uncertain manual proof preserves an existing session; initial candidate remains possible', t => {
  const f = fixture(t);
  const pending = path.join(f.root, 'candidate.json');
  fs.writeFileSync(pending, JSON.stringify(state('fixture-candidate')));
  assert.throws(() => commitNaverLoginSession(pending, f.sessionPath, readNaverManualSessionBaseline(f.sessionPath), false));
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
  const initial = path.join(f.root, 'initial.json');
  assert.equal(readNaverSessionFingerprint(initial), null);
  const initialBaseline = readNaverManualSessionBaseline(initial);
  commitNaverLoginSession(pending, initial, initialBaseline, false);
  assert.equal(cookieValue(readNaverSessionSnapshot(initial)), 'fixture-candidate');
  assert.throws(() => commitNaverLoginSession(pending, initial, initialBaseline, false), 'initial existence race is fenced');
});

for (const migrated of [false, true]) test(`background cookie renewal permits manual account change (${migrated ? 'revision stored' : 'legacy without metadata'})`, async t => {
  const f = fixture(t);
  const pending = path.join(f.root, 'manual.json');
  if (migrated) {
    fs.writeFileSync(pending, JSON.stringify(state('fixture-original-account')));
    commitNaverLoginSession(pending, f.sessionPath, readNaverManualSessionBaseline(f.sessionPath), true);
  }
  const loginBaseline = readNaverManualSessionBaseline(f.sessionPath);
  const worker = readNaverSessionSnapshot(f.sessionPath);
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-background-renewal')), worker, async () => true), 'saved');
  assert.deepEqual(readNaverManualSessionBaseline(f.sessionPath), loginBaseline, 'renewal must preserve the manual account generation');
  const newAccount = state('fixture-new-account');
  newAccount.origins = [{ origin: 'https://blog.naver.com', localStorage: [{ name: 'fixture-account', value: 'new' }] }];
  fs.writeFileSync(pending, JSON.stringify(newAccount));
  commitNaverLoginSession(pending, f.sessionPath, loginBaseline, true);
  const saved = readNaverSessionSnapshot(f.sessionPath);
  assert.equal(cookieValue(saved), 'fixture-new-account');
  assert.notEqual(saved.manualRevision, loginBaseline.manualRevision);
  assert.deepEqual(saved.state.origins, newAccount.origins, 'manual account change must not blend old account state');
  assert.deepEqual(Object.keys(saved.state).sort(), ['cookies', 'origins'], 'internal revision is never supplied to Playwright');
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-old-worker')), worker, async () => true), 'superseded');
});

test('first manual save migrates a legacy session and excludes internal revision from browser state', t => {
  const f = fixture(t);
  assert.deepEqual(readNaverManualSessionBaseline(f.sessionPath), { existed: true, manualRevision: null });
  const pending = path.join(f.root, 'manual.json');
  fs.writeFileSync(pending, JSON.stringify(state('fixture-migrated')));
  commitNaverLoginSession(pending, f.sessionPath, readNaverManualSessionBaseline(f.sessionPath), true);
  const raw = JSON.parse(fs.readFileSync(f.sessionPath, 'utf8'));
  assert.equal(raw.__blogautoNaverSession.version, 1);
  assert.match(raw.__blogautoNaverSession.manualRevision, /^[a-f0-9-]{36}$/);
  assert.equal(Object.hasOwn(readNaverSessionSnapshot(f.sessionPath).state, '__blogautoNaverSession'), false);
});

test('concurrent workers accept only the winner bound to the original file', async t => {
  const f = fixture(t);
  const second = readNaverSessionSnapshot(f.sessionPath);
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-one')), f.snapshot, async () => true), 'saved');
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-two')), second, async () => true), 'superseded');
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-one');
});

for (const [name, candidate] of [
  ['missing auth pair', { cookies: [], origins: [] }],
  ['expired auth pair', state('fixture-expired', 1)],
  ['epoch-zero auth pair', state('fixture-zero', 0)],
  ['invalid auth expiry', state('fixture-invalid', Number.NaN)],
  ['missing auth expiry', { ...state(), cookies: state().cookies.map(cookie => ({ ...cookie, expires: undefined })) }],
  ['wrong-domain auth names', { ...state(), cookies: state().cookies.map(cookie => ({ ...cookie, domain: '.example.com' })) }],
]) test(`${name} never overwrites healthy authentication`, async t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.sessionPath, 'utf8');
  assert.equal(await saveRefreshedNaverSession(context(candidate), f.snapshot, async () => true), 'unverified');
  assert.equal(fs.readFileSync(f.sessionPath, 'utf8'), before);
});

for (const label of ['login redirect', 'captcha', 'server uncertainty']) test(`${label} false proof prevents even capturing replacement state`, async t => {
  const f = fixture(t);
  let captures = 0;
  assert.equal(await saveRefreshedNaverSession({ async storageState() { captures++; return state('fixture-bad'); } }, f.snapshot, async () => false), 'unverified');
  assert.equal(captures, 0);
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
});

test('proof rejection is isolated from caller result', async t => {
  const f = fixture(t);
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-new')), f.snapshot, async () => { throw new Error('fixture network failure'); }), 'unavailable');
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
});

test('a timed-out proof cannot save after it eventually completes', async t => {
  const f = fixture(t);
  const proof = defer();
  const result = await saveRefreshedNaverSession(context(state('fixture-late')), f.snapshot, () => proof.promise, 5);
  assert.equal(result, 'unavailable');
  proof.resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
});

test('a timed-out state capture cannot commit after close deadline', async t => {
  const f = fixture(t);
  const capture = defer();
  assert.equal(await saveRefreshedNaverSession({ storageState: () => capture.promise }, f.snapshot, async () => true, 5), 'unavailable');
  capture.resolve(state('fixture-late'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
});

test('rename failure preserves exact original bytes and releases writer lock', async t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.sessionPath, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === f.sessionPath) throw Object.assign(new Error('fixture rename'), { code: 'EPERM' }); return rename(from, to); };
  try { assert.equal(await saveRefreshedNaverSession(context(state('fixture-new')), f.snapshot, async () => true), 'unavailable'); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(f.sessionPath, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.root), ['session.json']);
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-retry')), f.snapshot, async () => true), 'saved');
});

test('fsync failure never replaces the prior session', async t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.sessionPath, 'utf8');
  const sync = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error('fixture fsync'); };
  try { assert.equal(await saveRefreshedNaverSession(context(state('fixture-new')), f.snapshot, async () => true), 'unavailable'); }
  finally { fs.fsyncSync = sync; }
  assert.equal(fs.readFileSync(f.sessionPath, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.root), ['session.json']);
});

test('an existing live writer lock is preserved and prevents a competing commit', async t => {
  const f = fixture(t);
  const lock = `${f.sessionPath}.write-lock`;
  const owner = JSON.stringify({ pid: process.pid });
  fs.writeFileSync(lock, owner);
  const before = fs.readFileSync(f.sessionPath, 'utf8');
  assert.equal(await saveRefreshedNaverSession(context(state('fixture-competing')), f.snapshot, async () => true), 'unavailable');
  assert.equal(fs.readFileSync(lock, 'utf8'), owner);
  assert.equal(fs.readFileSync(f.sessionPath, 'utf8'), before);
});

test('two crash-lock recoverers never unlink a replacement live lock or commit stale state', async t => {
  const f = fixture(t);
  const lock = `${f.sessionPath}.write-lock`;
  const deadOwner = JSON.stringify({ pid: 2147483647 });
  fs.writeFileSync(lock, deadOwner);
  const before = fs.readFileSync(f.sessionPath, 'utf8');
  const unlink = fs.unlinkSync;
  const kill = process.kill;
  let unlinkCalls = 0;
  let pidProbes = 0;
  fs.unlinkSync = target => {
    if (target === lock) {
      unlinkCalls++;
      // Models another recovery process installing its live lock during the
      // stale-PID check/unlink gap that existed in the previous implementation.
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    }
    return unlink(target);
  };
  process.kill = () => { pidProbes++; throw Object.assign(new Error('fixture dead owner'), { code: 'ESRCH' }); };
  try {
    const results = await Promise.all([
      saveRefreshedNaverSession(context(state('fixture-one')), readNaverSessionSnapshot(f.sessionPath), async () => true),
      saveRefreshedNaverSession(context(state('fixture-two')), readNaverSessionSnapshot(f.sessionPath), async () => true),
    ]);
    assert.deepEqual(results, ['unavailable', 'unavailable']);
  } finally { fs.unlinkSync = unlink; process.kill = kill; }
  assert.equal(unlinkCalls, 0, 'no existing lock can be removed by a competing writer');
  assert.equal(pidProbes, 0, 'automatic PID-based recovery must remain disabled');
  assert.equal(fs.readFileSync(lock, 'utf8'), deadOwner);
  assert.equal(fs.readFileSync(f.sessionPath, 'utf8'), before);
});

test('API mode preserves bound localStorage and IndexedDB; foreign worker cookies are not imported', async t => {
  const initial = state();
  initial.cookies.push({ ...initial.cookies[0], name: 'foreign', domain: '.example.com', value: 'fixture-baseline' });
  initial.origins = [{ origin: 'https://blog.naver.com', localStorage: [{ name: 'fixture', value: 'stored' }], indexedDB: [{ name: 'fixture-db', version: 1, stores: [] }] }];
  const f = fixture(t, initial);
  const renewed = state('fixture-renewed');
  renewed.cookies.push({ ...renewed.cookies[0], name: 'foreign', domain: '.example.com', value: 'fixture-worker-change' });
  await saveRefreshedNaverSession(context(renewed), f.snapshot, async () => true, 1000, { preserveOrigins: true });
  const saved = readNaverSessionSnapshot(f.sessionPath).state;
  assert.deepEqual(saved.origins, initial.origins);
  assert.equal(saved.cookies.find(cookie => cookie.name === 'foreign').value, 'fixture-baseline');
});

test('periodic save and final stop are single-flight; one diagnostic cannot change publication result', async t => {
  const f = fixture(t);
  const proof = defer();
  let proofCalls = 0;
  const keeper = maintainNaverSession(context(state('fixture-final')), f.snapshot, () => { proofCalls++; return proof.promise; }, { intervalMs: 60_000 });
  const first = keeper.refresh();
  const second = keeper.stop();
  assert.equal(first, second);
  proof.resolve(true);
  assert.equal(await second, 'saved');
  assert.equal(await keeper.stop(), 'saved');
  assert.equal(proofCalls, 1);
  let warnings = 0;
  const failed = maintainNaverSession(context(state()), readNaverSessionSnapshot(f.sessionPath), async () => { throw new Error('fixture-failure'); },
    { intervalMs: 60_000, onUnavailable() { warnings++; throw new Error('fixture-warning'); } });
  assert.equal(await failed.refresh(), 'unavailable');
  assert.equal(await failed.stop(), 'unavailable');
  assert.equal(warnings, 1);
});

test('shopping account API uses a cookie jar and persists response rotation without launching a browser', async t => {
  const f = fixture(t);
  const playwright = require('playwright');
  const { probeShoppingCategoryFromSession } = require('../../src/lib/shopping-connect-access.ts');
  const original = playwright.request.newContext;
  const jar = state();
  let disposed = 0;
  playwright.request.newContext = async options => {
    assert.equal(options.storageState.cookies[1].value, 'fixture-old');
    return {
      async get(url, options) {
        assert.equal(options.headers.cookie, undefined, 'fresh cookie jar must choose request cookies');
        assert.equal(options.maxRedirects, 0);
        jar.cookies = state('fixture-shopping-rotation').cookies;
        const payload = url.endsWith('/brand-connect/query/me') ? { loginId: 'fixture-user', space: { id: 333 } }
          : url.endsWith('/base-display-categories') ? [{ id: 77 }]
          : { data: [{ productName: 'fixture' }] };
        return { status: () => 200, json: async () => payload };
      },
      ...context(jar),
      async dispose() { disposed++; },
    };
  };
  try {
    assert.equal(await probeShoppingCategoryFromSession(f.sessionPath), 'https://brandconnect.naver.com/333/affiliate/products/category/77');
  } finally { playwright.request.newContext = original; }
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-shopping-rotation');
  assert.equal(disposed, 1);
});

test('an account response without signed-in account proof preserves shopping session', async t => {
  const f = fixture(t);
  const playwright = require('playwright');
  const { probeShoppingCategoryFromSession } = require('../../src/lib/shopping-connect-access.ts');
  const original = playwright.request.newContext;
  let captured = 0;
  playwright.request.newContext = async () => ({
    get: async () => ({ status: () => 200, json: async () => ({ loginId: null, space: null }) }),
    async storageState() { captured++; return state('fixture-untrusted'); }, async dispose() {},
  });
  try { assert.equal(await probeShoppingCategoryFromSession(f.sessionPath), null); }
  finally { playwright.request.newContext = original; }
  assert.equal(captured, 0);
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
});

const travelContract = {
  kind: 'travel', capturedAt: '2026-01-01T00:00:00.000Z', sourceUrl: 'https://brandconnect.naver.com/333/travel',
  listEndpoint: 'https://gw-brandconnect.naver.com/travel/query/products', listQuery: { limit: '20' },
  itemsPath: '$.data', fieldMap: { id: 'id', name: 'name', price: null, storeName: null, imageUrl: null, linkUrl: null }, sampleCount: 1,
};

test('travel known GET uses one API jar; positive blog proof captures final rotation', async t => {
  const f = fixture(t);
  const playwright = require('playwright');
  const { listItemsViaContract } = require('../../src/lib/travel-connect-adapter.ts');
  const original = playwright.request.newContext;
  const priorBlog = process.env.NAVER_BLOG_ID;
  process.env.NAVER_BLOG_ID = 'fixture-blog';
  const jar = state();
  let requests = 0;
  let disposed = 0;
  playwright.request.newContext = async () => ({
    async get(url, options) {
      requests++;
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.maxRedirects, 0);
      const proof = url.includes('PostWriteFormManagerOptions');
      jar.cookies = state(proof ? 'fixture-travel-proof' : 'fixture-travel-list').cookies;
      return { status: () => 200, ok: () => true, url: () => url, headers: () => ({}),
        text: async () => JSON.stringify({ isSuccess: true }), json: async () => ({ data: [{ id: 'fixture', name: 'fixture-product' }] }) };
    }, ...context(jar), async dispose() { disposed++; },
  });
  try { assert.equal((await listItemsViaContract(travelContract, { storageStatePath: f.sessionPath })).length, 1); }
  finally {
    playwright.request.newContext = original;
    if (priorBlog === undefined) delete process.env.NAVER_BLOG_ID; else process.env.NAVER_BLOG_ID = priorBlog;
  }
  assert.equal(requests, 2, 'one list GET and one read-only proof; no login, POST, or retry');
  assert.equal(disposed, 1);
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-travel-proof');
});

for (const status of [401, 403]) test(`travel HTTP ${status} preserves saved authentication and distinct cause`, async t => {
  const f = fixture(t);
  const playwright = require('playwright');
  const { listItemsViaContract, ConnectSessionExpiredError, ConnectAccessDeniedError } = require('../../src/lib/travel-connect-adapter.ts');
  const original = playwright.request.newContext;
  let disposed = 0;
  let captures = 0;
  playwright.request.newContext = async () => ({ get: async () => ({ status: () => status, ok: () => false }),
    async storageState() { captures++; return state('fixture-wrong'); }, async dispose() { disposed++; } });
  try { await assert.rejects(listItemsViaContract(travelContract, { storageStatePath: f.sessionPath }),
    error => status === 401 ? error instanceof ConnectSessionExpiredError : error instanceof ConnectAccessDeniedError && error.code === 'NAVER_SESSION_FORBIDDEN'); }
  finally { playwright.request.newContext = original; }
  assert.equal(captures, 0);
  assert.equal(disposed, 1);
  assert.equal(cookieValue(readNaverSessionSnapshot(f.sessionPath)), 'fixture-old');
});

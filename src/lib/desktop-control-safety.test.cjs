// Isolated Node tests execute actual desktop/route sources with mocked OS boundaries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const next = { NextResponse: { json: (data, init) => Response.json(data, init) } };
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(root, file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => name in mocks ? mocks[name] : require(name),
    process: { env: {}, pid: process.pid }, console, Buffer, URL, Request, Response, Headers, AbortSignal,
    setTimeout, clearTimeout, setInterval, clearInterval, ...globals }, { filename });
  return module.exports;
}
const turn = () => new Promise(resolve => setImmediate(resolve));

function desktopFixture(options = {}) {
  const source = fs.readFileSync(path.join(root, 'scripts/electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const names = ['ensureTray', 'getRelaunchArgs', 'restartLocalServer', 'installDesktopControlBridge', 'getUpdateReadiness'];
  const functions = names.map(name => {
    const found = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(found, `Missing actual desktop function ${name}`);
    return found[0];
  }).join('\n');
  const calls = [];
  const env = { ADMIN_API_KEY: 'fixture-only-key' };
  const context = {
    isQuitting: false, serverRestartPromise: null, tray: null,
    __desktopActivityState: { active: new Map() },
    process: { env, argv: ['fixture', '--hidden', '--user-data-dir=fixture-user-data'] },
    APP_BASE_URL: 'http://127.0.0.1:43127', AbortController, setTimeout, clearTimeout, console,
    fs: { existsSync: () => true }, resolvePackagedResource: () => 'fixture-icon',
    showMainWindow: () => calls.push({ kind: 'show' }),
    Tray: class { setToolTip() {} setContextMenu(menu) { context.menu = menu; } on() {} },
    Menu: { buildFromTemplate: items => items },
    dialog: { showErrorBox: (title, message) => calls.push({ kind: 'error', title, message }) },
    desktopUpdater: { stop: () => calls.push({ kind: 'updater-stop' }), getState: () => ({ status: 'current' }) },
    app: {
      commandLine: { hasSwitch: () => false, getSwitchValue: () => 'fixture-user-data' },
      relaunch: args => { if (options.relaunchError) throw Error('fixture relaunch failed'); calls.push({ kind: 'relaunch', args }); },
      exit: code => calls.push({ kind: 'exit', code }),
    },
    fetch: async (url, init) => {
      calls.push({ kind: 'readiness', url, header: init.headers['x-admin-api-key'] });
      if (options.fetch) return options.fetch(context);
      return Response.json({ success: true, data: options.readiness || { ready: true, activeCount: 0 } });
    },
  };
  vm.runInNewContext(`${functions}\ninstallDesktopControlBridge(); ensureTray('fixture-root');`, context);
  return { context, env, calls, restart: () => context.__brandconnectDesktopControl.restartServer(),
    trayRestart: () => context.menu.find(item => item.label === '로컬 서버 재시작').click() };
}

test('tray and bridge restart both preserve busy work and show the tray error', async () => {
  for (const entry of ['tray', 'bridge']) {
    const f = desktopFixture({ readiness: { ready: false, activeCount: 2 } });
    if (entry === 'tray') { f.trayRestart(); await turn(); }
    else await assert.rejects(f.restart(), /2개의 자동화 작업/);
    assert.equal(f.calls.some(call => call.kind === 'relaunch' || call.kind === 'exit' || call.kind === 'updater-stop'), false);
    assert.equal(f.calls[0].header, 'fixture-only-key', 'actual local readiness GET uses the current admin key');
    if (entry === 'tray') assert.match(f.calls.find(call => call.kind === 'error').message, /2개의 자동화 작업/);
    assert.equal(f.env.DESKTOP_RESTART_PENDING, undefined);
    assert.equal(f.context.__brandconnectDesktopControl.getState().restarting, false);
  }
});

for (const [label, fetcher] of [
  ['network failure', async () => { throw Error('fixture disconnected'); }],
  ['auth denial', async () => Response.json({ success: false }, { status: 401 })],
  ['server error', async () => Response.json({ success: false }, { status: 503 })],
  ['invalid JSON', async () => new Response('<html>fixture</html>')],
  ...[{}, { ready: 'true', activeCount: 0 }, { ready: true, activeCount: 1 }, { ready: false, activeCount: 0 },
    { ready: true, activeCount: -1 }].map(data => [`invalid readiness ${JSON.stringify(data)}`, async () => Response.json({ success: true, data })]),
]) test(`restart fails closed on ${label} and clears its admission fence`, async () => {
  const f = desktopFixture({ fetch: fetcher });
  await assert.rejects(f.restart());
  assert.equal(f.calls.some(call => call.kind === 'exit' || call.kind === 'relaunch'), false);
  assert.equal(f.env.DESKTOP_RESTART_PENDING, undefined);
  assert.equal(f.context.isQuitting, false);
});

test('concurrent restart requests share one probe and preserve relaunch arguments', async () => {
  let release;
  const f = desktopFixture({ fetch: () => new Promise(resolve => { release = resolve; }) });
  const one = f.restart();
  const two = f.restart();
  assert.equal(f.env.DESKTOP_RESTART_PENDING, '1');
  assert.equal(f.context.__brandconnectDesktopControl.getState().restarting, true);
  await turn();
  assert.equal(f.calls.filter(call => call.kind === 'readiness').length, 1);
  release(Response.json({ success: true, data: { ready: true, activeCount: 0 } }));
  await Promise.all([one, two]);
  assert.equal(f.calls.filter(call => call.kind === 'relaunch').length, 1);
  assert.equal(f.calls.filter(call => call.kind === 'exit').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(call => call.kind === 'relaunch').args)), {
    args: ['--hidden', '--user-data-dir=fixture-user-data'],
  });
});

test('late activity after the readiness response prevents relaunch', async () => {
  const f = desktopFixture({ fetch: context => {
    context.__desktopActivityState.active.set(1, { label: 'remote-agent-poll' });
    return Response.json({ success: true, data: { ready: true, activeCount: 0 } });
  } });
  await assert.rejects(f.restart(), /새로 시작/);
  assert.equal(f.calls.some(call => call.kind === 'exit'), false);
  assert.equal(f.env.DESKTOP_RESTART_PENDING, undefined);
});

test('relaunch failure keeps the running app and updater usable for a retry', async () => {
  const f = desktopFixture({ relaunchError: true });
  await assert.rejects(f.restart(), /fixture relaunch failed/);
  assert.equal(f.env.DESKTOP_RESTART_PENDING, undefined);
  assert.equal(f.context.isQuitting, false);
  assert.equal(f.calls.some(call => call.kind === 'updater-stop' || call.kind === 'exit'), false);
  f.context.app.relaunch = () => f.calls.push({ kind: 'relaunch' });
  await f.restart();
  assert.equal(f.calls.filter(call => call.kind === 'exit').length, 1);
});

test('restart admission blocks late new work and preserves existing nested work and result polls', () => {
  const processFixture = { env: {} };
  const activity = load('src/lib/desktop-activity.ts', {}, { process: processFixture });
  const finish = activity.beginDesktopActivity('existing-publish');
  processFixture.env.DESKTOP_RESTART_PENDING = '1';
  const nestedFinish = activity.beginDesktopActivity('script:existing-publish');
  nestedFinish(); finish();
  assert.throws(() => activity.beginDesktopActivity('late-new-publish'), error => error.code === 'DESKTOP_RESTART_PENDING');
  assert.equal(activity.getDesktopActivitySnapshot().count, 0);
  const pollFinish = activity.beginDesktopActivity('remote-agent-poll');
  assert.equal(activity.getDesktopActivitySnapshot().count, 1);
  pollFinish();
  const guard = load('src/lib/update-guard.ts', { 'next/server': next }, { process: processFixture });
  assert.equal(guard.requireNoPendingDesktopUpdate().status, 503);
  delete processFixture.env.DESKTOP_RESTART_PENDING;
  assert.equal(guard.requireNoPendingDesktopUpdate(), null);
});

test('the replacement desktop clears an inherited restart fence and can register new work', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const bootstrap = source.match(/function configureRuntimePaths\(projectRoot\) \{[\s\S]*?\n\}/);
  assert.ok(bootstrap);
  const env = { DESKTOP_RESTART_PENDING: '1', DATABASE_URL: 'file:fixture-existing.db', NAVER_BLOG_ID: 'fixture-existing-blog' };
  const fakeProcess = { env, cwd: () => 'fixture-project' };
  vm.runInNewContext(`${bootstrap[0]}\nconfigureRuntimePaths('fixture-project');`, {
    process: fakeProcess, path, APP_BASE_URL: 'http://127.0.0.1:43127', draftRuntimePolicy: {},
    app: { getPath: () => 'fixture-user-data', getVersion: () => 'fixture' },
    require: name => { assert.equal(name, 'dotenv'); return { config() {} }; },
  });
  assert.equal(env.DESKTOP_RESTART_PENDING, undefined);
  assert.equal(env.NAVER_BLOG_ID, 'fixture-existing-blog');
  assert.equal(env.DATABASE_URL, 'file:fixture-existing.db');
  const activity = load('src/lib/desktop-activity.ts', {}, { process: fakeProcess });
  const finish = activity.beginDesktopActivity('new-work-after-restart');
  assert.equal(activity.getDesktopActivitySnapshot().count, 1);
  finish();
});

for (const hasCompletion of [false, true]) test(`restart fence blocks new claims while preserving ${hasCompletion ? 'persisted completion and heartbeat' : 'empty result polling'}`, async () => {
  const routeFile = 'src/app/api/remote-agent/poll/route.ts';
  const mocks = {};
  for (const match of fs.readFileSync(path.join(root, routeFile), 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  }
  const fakeProcess = { env: { DESKTOP_RESTART_PENDING: '1' }, pid: process.pid };
  const activity = load('src/lib/desktop-activity.ts', {}, { process: fakeProcess });
  const calls = [];
  const job = { id: 'job_fixture', type: 'SETTINGS_GET' };
  const completed = { job, body: { status: 'SUCCEEDED', result: { fixture: 'preserved' } } };
  let cleared = false;
  Object.assign(mocks, {
    'next/server': { NextResponse: Response },
    '@/lib/desktop-activity': activity,
    '@/lib/api-auth': { requireAdminApiKey: () => null },
    '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
    '@/lib/remote-activation': { readRemoteActivation: () => ({ siteUrl: 'https://fixture.invalid', deviceToken: 'fixture-only-token' }) },
    '@/lib/remote-agent-completion': {
      completionOutbox: () => ({ read: () => hasCompletion ? completed : null, save() {}, clear: () => { cleared = true; } }),
      completionWireBody: async body => body, deliverCompletion: send => send(), isPermanentCompletionError: () => false,
    },
    '@/lib/remote-agent-claim': { remoteClaimStore: () => ({ read: () => hasCompletion ? { state: 'started', requestId: 'fixture', job } : null, clear() {} }) },
    '@/lib/db': { prisma: { brandLink: { count: async () => 0 } } },
    '@/lib/connect-contract-store': { hasStoredConnectContract: () => false },
    '@/lib/naver-session': { getNaverSessionFile: () => path.join(root, 'fixture-no-session') },
    '../../../../../scripts/lib/app-paths': { getUserDataRoot: () => 'fixture-no-live-user-data' },
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
    '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
  });
  const route = load(routeFile, mocks, {
    process: fakeProcess, setInterval: () => ({ unref() {} }), clearInterval() {},
    fetch: async (url, init) => {
      calls.push(url);
      assert.equal(activity.getDesktopActivitySnapshot().count, 1, 'delivery still participates in readiness');
      const body = JSON.parse(init.body);
      if (url.endsWith('/heartbeat')) return Response.json({ success: true, data: { id: job.id, active: true } });
      assert.ok(url.endsWith('/complete'), 'no claim or execution is allowed');
      assert.deepEqual(body.result, completed.body.result);
      return Response.json({ success: true, data: { id: job.id, status: 'SUCCEEDED' } });
    },
  });
  const request = new Request('http://localhost/api/remote-agent/poll', { method: 'POST' });
  request.nextUrl = new URL(request.url);
  const result = await (await route.POST(request)).json();
  assert.equal(result.success, true);
  assert.equal(calls.some(url => url.endsWith('/claim')), false);
  if (hasCompletion) {
    assert.equal(result.data.completionRecovered, true);
    assert.ok(calls.some(url => url.endsWith('/heartbeat')));
    assert.equal(cleared, true);
  } else {
    assert.equal(result.data.restartPending, true);
    assert.equal(result.data.updatePending, false);
    assert.equal(calls.length, 0);
  }
  assert.equal(activity.getDesktopActivitySnapshot().count, 0);
});

test('scheduler does not claim or mutate a saved post while restart admission is closed', async () => {
  const scheduler = load('src/services/scheduler.ts', {
    '@/lib/db': { prisma: new Proxy({}, { get() { throw Error('saved posts must not be touched'); } }) },
    '@/lib/desktop-activity': { beginDesktopActivity() { throw Error('must not start work'); } },
    '@/lib/run-script': { runTsNodeScript() { throw Error('must not launch'); } },
    '../../scripts/lib/logger': { createTaskLogger: () => ({}) },
  }, { process: { env: { DESKTOP_RESTART_PENDING: '1' } } });
  assert.equal(await scheduler.executeScheduledPost('fixture-post'), false);
});

function settingsFixture(t, fault) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-commit-'));
  t.after(() => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  const target = path.join(directory, '.env');
  const original = 'NAVER_BLOG_ID="fixture-old"\nUNSPLASH_ACCESS_KEY="fixture-stock-key"\nUNRELATED="keep"\n';
  fs.writeFileSync(target, original, { mode: 0o600 });
  const env = { NAVER_BLOG_ID: 'fixture-old', UNSPLASH_ACCESS_KEY: 'fixture-stock-key', BROWSER_GPT_MODE: 'legacy' };
  const modes = [];
  const fakeFs = { ...fs, openSync(file, flags, mode) { modes.push(mode); return fs.openSync(file, flags, mode); } };
  if (fault) fakeFs[fault] = () => { throw Error(`fixture ${fault} failed`); };
  const globals = { process: { env, pid: process.pid } };
  const atomic = load('src/lib/atomic-text-file.ts', { 'node:fs': fakeFs }, globals);
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/lib/draft-runtime-policy.json'), 'utf8'));
  const route = load('src/app/api/settings/route.ts', {
    'next/server': next, fs: fakeFs, '@/lib/atomic-text-file': atomic,
    '@/lib/api-auth': { requireAdminApiKey: () => null },
    '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
    '@/lib/chatgpt-browser-automation': { isChatGptBrowserAutomationEnabled: () => true },
    '@/lib/codex-local': { readCodexLocalStatus: () => ({ authenticated: true }) },
    '../../../../scripts/lib/app-paths': { getEnvFilePath: () => target },
    '../../../../scripts/lib/draft-runtime-policy.json': policy,
  }, globals);
  return { directory, target, original, env, policy, modes, route,
    save: values => route.POST({ json: async () => ({ values }) }) };
}

test('a later invalid setting cannot partially change earlier runtime values or the file', async t => {
  const f = settingsFixture(t);
  const before = { ...f.env };
  for (const bad of ['fixture\ninjection', 42]) {
    assert.equal((await f.save({ NAVER_BLOG_ID: 'fixture-new', UNSPLASH_ACCESS_KEY: bad })).status, 400);
    assert.deepEqual(f.env, before);
    assert.equal(fs.readFileSync(f.target, 'utf8'), f.original);
    assert.equal(f.modes.length, 0, 'all inputs are validated before creating a replacement');
  }
});

for (const fault of ['writeFileSync', 'fsyncSync', 'renameSync']) test(`settings ${fault} failure preserves prior file, runtime and unrelated secrets`, async t => {
  const f = settingsFixture(t, fault);
  const before = { ...f.env };
  assert.equal((await f.save({ NAVER_BLOG_ID: 'fixture-new', UNSPLASH_ACCESS_KEY: '' })).status, 500);
  assert.deepEqual(f.env, before);
  assert.equal(fs.readFileSync(f.target, 'utf8'), f.original);
  assert.deepEqual(fs.readdirSync(f.directory), ['.env'], 'failed unpublished replacement is cleaned up');
  assert.equal((await (await f.route.GET({})).json()).data.values.NAVER_BLOG_ID, 'fixture-old');
});

test('successful settings commit applies runtime changes afterward, preserving masks, private mode and fixed policy', async t => {
  const f = settingsFixture(t);
  assert.equal((await f.save({ NAVER_BLOG_ID: ' fixture-new ', UNSPLASH_ACCESS_KEY: '********', UNAUTHORIZED_KEY: 'discard' })).status, 200);
  assert.equal(f.env.NAVER_BLOG_ID, 'fixture-new');
  assert.equal(f.env.UNSPLASH_ACCESS_KEY, 'fixture-stock-key');
  assert.equal(f.env.UNAUTHORIZED_KEY, undefined);
  assert.deepEqual(f.modes, [0o600]);
  let content = fs.readFileSync(f.target, 'utf8');
  assert.ok(content.includes('UNRELATED="keep"'));
  assert.ok(content.includes('UNSPLASH_ACCESS_KEY="fixture-stock-key"'));
  assert.equal(content.includes('UNAUTHORIZED_KEY'), false);
  for (const [key, value] of Object.entries(f.policy)) assert.equal(f.env[key], value);
  assert.equal(f.env.BROWSER_GPT_MODE, 'false');
  assert.equal((await f.save({ UNSPLASH_ACCESS_KEY: '' })).status, 200);
  content = fs.readFileSync(f.target, 'utf8');
  assert.equal(f.env.UNSPLASH_ACCESS_KEY, undefined);
  assert.equal(content.includes('UNSPLASH_ACCESS_KEY'), false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, mocks = {}, globals = {}, tail = '') {
  const filename = path.resolve(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8') + tail, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts'), mocks) : require(name), process, console, Buffer, Request, Response, Headers, URL, TextEncoder, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, ...globals }, { filename });
  return module.exports;
}
const activity = load('src/lib/desktop-activity.ts');
const completion = load('src/lib/remote-agent-completion.ts');

test('readiness covers remote activity, persisted/memory outbox and corrupted queue across activation changes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'operational-ready-'));
  const zero = { count: async () => 0 };
  const readiness = load('src/lib/desktop-readiness.ts', {
    '@/lib/db': { prisma: { post: zero, brandLink: zero, topicPostTask: zero } },
    '@/lib/desktop-activity': activity, '@/lib/remote-agent-completion': completion,
    '../../scripts/lib/app-paths': { getUserDataRoot: () => directory },
  });
  try {
    assert.equal((await readiness.getDesktopReadiness()).ready, true);
    const finish = activity.beginDesktopActivity('remote-agent-poll');
    assert.equal((await readiness.getDesktopReadiness()).ready, false);
    finish();
    const box = completion.completionOutbox(directory, 'https://old-activation', 'old-token');
    box.save({ job: { id: 'job_1', type: 'SETTINGS_GET' }, body: { status: 'SUCCEEDED' } });
    assert.equal((await readiness.getDesktopReadiness()).active.pendingRemoteCompletions, true);
    assert.equal(load('src/lib/remote-agent-completion.ts').hasPendingRemoteCompletions(directory), true);
    box.quarantine('JOB_NOT_ACTIVE');
    assert.equal((await readiness.getDesktopReadiness()).ready, true);
    assert.throws(() => box.save({ job: { id: 'job_1', type: 'TEST' }, body: { status: 'SUCCEEDED', result: 'old-token' } }));
    assert.equal((await readiness.getDesktopReadiness()).ready, false);
    box.clear();
    // A failed disk write still leaves the exact completion protected in memory.
    const blockedRoot = path.join(directory, 'not-directory');
    fs.mkdirSync(blockedRoot);
    fs.writeFileSync(path.join(blockedRoot, 'remote-agent-completions'), 'fixture');
    const memoryBox = completion.completionOutbox(blockedRoot, 'https://site', 'token');
    assert.throws(() => memoryBox.save({ job: { id: 'job_memory', type: 'TEST' }, body: { status: 'SUCCEEDED' } }));
    assert.equal(completion.hasPendingRemoteCompletions(blockedRoot), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

for (const response of [
  { status: 200, data: { active: false } }, { status: 200, data: { cancelRequested: true } },
  { status: 401 }, { status: 403 },
]) test(`heartbeat ${JSON.stringify(response)} stops execution and blocks follow-up local actions`, async () => {
  const file = 'src/app/api/remote-agent/poll/route.ts';
  const mocks = {};
  for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  let stops = 0, revoked = 0, tick;
  Object.assign(mocks, {
    '@/lib/local-automation-error': load('src/lib/local-automation-error.ts'),
    '@/lib/remote-activation': { clearRemoteActivation: () => revoked++ },
    '@/lib/local-json-fetch': { localJsonFetch: async url => { assert.equal(new URL(url).pathname, '/api/posting/stop'); stops++; return Response.json({ success: true }); } },
    '@/lib/connect-contract-store': { hasStoredConnectContract: () => false },
    '@/lib/naver-session': { getNaverSessionFile: () => '' },
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
    '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
  });
  const route = load(file, mocks, { fetch: async () => Response.json({ data: response.data }, { status: response.status }), setInterval: fn => { tick = fn; return { unref() {} }; }, clearInterval() {} }, '\nexport const inspect = { startJobHeartbeat, localApi, jobContexts };');
  const request = new Request('http://localhost/api/remote-agent/poll'); request.nextUrl = new URL(request.url);
  const ctx = { job: { id: 'job_1' }, cancelled: false, setStage() {} };
  route.inspect.jobContexts.set(request, ctx);
  const stop = route.inspect.startJobHeartbeat(request, 'https://site', 'token', ctx, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.cancelled, true);
  assert.equal(stops, 1);
  assert.equal(revoked > 0, response.status >= 400);
  await assert.rejects(route.inspect.localApi(request, '/api/brandlinks/a/publish', { method: 'POST' }));
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
  stop();
});

function schedulerFixture(run, claimThrows = false) {
  let row = { id: 'post1', status: 'PENDING', scheduledAt: new Date(0), topicSeed: JSON.stringify({ topic: 'fixture' }), contentHtml: '{}' };
  let launches = 0;
  const post = {
    findUnique: async () => ({ ...row }),
    updateMany: async ({ where, data }) => {
      if (claimThrows && where.status === 'PENDING') throw Error('db unavailable');
      if (row.status !== where.status) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    },
  };
  const scheduler = load('src/services/scheduler.ts', {
    '@/lib/desktop-activity': activity,
    '@/lib/db': { prisma: { post } }, '../../scripts/lib/logger': { createTaskLogger: () => ({ info() {}, error() {} }) },
    '@/lib/run-script': { runTsNodeScript: async () => { launches++; await run(row); return { stdout: '', stderr: '' }; } },
  });
  return { scheduler, row, launches: () => launches };
}
test('cron duplicate claims launch only once and preserve confirmed success', async () => {
  const fixture = schedulerFixture(async row => { await Promise.resolve(); row.status = 'SUCCESS'; });
  const results = await Promise.all([fixture.scheduler.executeScheduledPost('post1'), fixture.scheduler.executeScheduledPost('post1')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(fixture.launches(), 1);
});
for (const failure of ['timeout', 'unconfirmed-exit', 'cancelled', 'success-then-timeout']) test(`cron ${failure} never requeues uncertain publication`, async () => {
  const fixture = schedulerFixture(async row => {
    if (failure === 'cancelled') row.status = 'CANCELLED';
    if (failure === 'success-then-timeout') row.status = 'SUCCESS';
    if (failure.includes('timeout')) throw Error('timeout');
  });
  assert.equal(await fixture.scheduler.executeScheduledPost('post1'), false);
  assert.equal(fixture.row.status, failure === 'cancelled' ? 'CANCELLED' : failure === 'success-then-timeout' ? 'SUCCESS' : 'FAIL');
  await fixture.scheduler.executeScheduledPost('post1');
  assert.equal(fixture.launches(), 1);
});
test('failed cron claim cannot fail another owner', async () => {
  const fixture = schedulerFixture(async () => {}, true);
  fixture.row.status = 'RUNNING';
  assert.equal(await fixture.scheduler.executeScheduledPost('post1'), false);
  assert.equal(fixture.row.status, 'RUNNING');
  assert.equal(fixture.launches(), 0);
});

test('update publish commits one pointer; failed next publish leaves public GET and HEAD on old release', async () => {
  const release = load('apps/sites/lib/update-release.ts');
  const objects = new Map(); let failWrite = false; let puts = 0;
  const bucket = {
    head: async key => key.endsWith('.blockmap') ? { size: 20 } : { size: 100, customMetadata: { sha512: 'A'.repeat(86) + '==' } },
    get: async key => objects.has(key) ? { size: Buffer.byteLength(objects.get(key)), text: async () => objects.get(key) } : null,
    put: async (key, value) => { puts++; if (failWrite) throw Error('storage unavailable'); objects.set(key, value); },
  };
  const mocks = {
    'cloudflare:workers': { env: { INSTALLERS: bucket, INSTALLER_UPLOAD_KEY: 'fixture' } },
    'next/server': { NextResponse: Response }, '@/app/chatgpt-auth': { getChatGPTUser: async () => null }, '@/lib/account': {},
    '@/lib/http': { readObject: request => request.json(), apiError: (code, message, status) => Response.json({ code, message }, { status }) },
    '@/lib/installer': { safeSecretEqual: (a, b) => a === b }, '@/lib/update-release': release,
    '@/lib/device': { authenticateDevice: async () => ({ id: 'device' }) },
  };
  const admin = load('apps/sites/app/api/admin/updates/windows/route.ts', mocks);
  const publicRoute = load('apps/sites/app/api/updates/windows/[artifact]/route.ts', mocks);
  const manifest = version => `version: ${version}\nfiles:\n  - url: BrandConnect-Automation-Setup-${version}.exe\n    sha512: ${'A'.repeat(86)}==\n    size: 100\npath: BrandConnect-Automation-Setup-${version}.exe\nreleaseDate: '2026-09-20T00:00:00Z'\n`;
  const publish = version => admin.POST(new Request('https://site/admin', { method: 'POST', headers: { 'x-installer-upload-key': 'fixture', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', manifest: manifest(version) }) }));
  assert.equal((await publish('1.0.1')).status, 200);
  assert.equal(puts, 1);
  failWrite = true;
  await assert.rejects(publish('1.0.2'));
  const context = { params: Promise.resolve({ artifact: 'latest.yml' }) };
  const response = await publicRoute.GET(new Request('https://site/latest.yml'), context);
  assert.equal(await response.text(), manifest('1.0.1'));
  const head = await publicRoute.HEAD(new Request('https://site/latest.yml'), context);
  assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(manifest('1.0.1')));
  assert.equal((await release.readWindowsRelease(bucket)).version, '1.0.1');
  const legacy = JSON.parse(objects.get(release.WINDOWS_RELEASE_POINTER_KEY)); delete legacy.manifest;
  objects.set(release.WINDOWS_RELEASE_POINTER_KEY, JSON.stringify(legacy));
  assert.equal(release.parseUpdateManifest(await (await publicRoute.GET(new Request('https://site/latest.yml'), context)).text()).version, '1.0.1');
});

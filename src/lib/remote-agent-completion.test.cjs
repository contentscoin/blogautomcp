const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}, tail = '') {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8') + tail, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name in mocks ? mocks[name] : require(name), process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, Request, Response, Headers, URL, AbortSignal, ...globals }, { filename: file });
  return module.exports;
}
const helperPath = path.join(__dirname, 'remote-agent-completion.ts');
const helper = load(helperPath);
test('outbox survives reload, isolates activation and retains exact large result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-completion-'));
  try {
    const value = { job: { id: 'job_1', type: 'TEST' }, body: { status: 'SUCCEEDED', result: '한글😀'.repeat(30000) } };
    helper.completionOutbox(root, 'https://site', 'secret').save(value);
    const reloaded = load(helperPath).completionOutbox(root, 'https://site', 'secret');
    assert.equal(JSON.stringify(reloaded.read()), JSON.stringify(value));
    assert.equal(helper.completionOutbox(root, 'https://site', 'other-secret').read(), null);
    reloaded.clear();
    assert.equal(reloaded.read(), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('delivery retries network errors only, permanent failure stops immediately', async () => {
  let calls = 0;
  await helper.deliverCompletion(async () => { if (++calls < 3) throw new Error('connection lost'); }, async () => {});
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(helper.deliverCompletion(async () => { calls++; throw new helper.CompletionDeliveryError(409, 'JOB_NOT_ACTIVE', 'conflict'); }, async () => {}));
  assert.equal(calls, 1);
});
for (const jobType of ['SETTINGS_GET', 'POST_PUBLISH']) test(`${jobType}: actual poll timeout and late heartbeat never replay execution`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-poll-'));
  let executes = 0, claims = 0, heartbeats = 0, stopped = false, tick;
  let recover = false;
  const bodies = [];
  const routePath = path.join(__dirname, '../app/api/remote-agent/poll/route.ts');
  const source = fs.readFileSync(routePath, 'utf8');
  const mocks = {};
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  Object.assign(mocks, {
    'next/server': { NextResponse: Response },
    '@/lib/remote-agent-completion': { ...helper, deliverCompletion: (send) => helper.deliverCompletion(send, async () => {}) },
    '@/lib/api-auth': { requireAdminApiKey: () => null },
    '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
    '@/lib/remote-activation': { readRemoteActivation: () => ({ siteUrl: 'https://site', deviceToken: 'token' }) },
    '@/lib/connect-contract-store': { hasStoredConnectContract: () => false },
    '@/lib/db': { prisma: { brandLink: { findUnique: async () => ({ connectKind: 'SHOPPING', status: 'PUBLISHED', productName: 'fixture', postUrl: 'https://example.test/post' }) } } },
    '@/lib/brand-post-package': { readBrandPostPackage: () => ({ approvedAt: '2026-09-05', contentQuality: { canPublish: true } }) },
    '@/lib/naver-session': { getNaverSessionFile: () => path.join(root, 'absent') },
    '@/lib/local-json-fetch': { localJsonFetch: async (url, init) => {
      if (String(url).endsWith('/auto-publish') && init.method !== 'POST') return Response.json({
        success: true, data: { status: 'completed', result: { status: 'PUBLISHED', postUrl: 'https://example.test/post' } },
      });
      executes++;
      return Response.json({ success: true, data: {} });
    } },
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
    '../../../../../scripts/lib/app-paths': { getUserDataRoot: () => root },
    '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
  });
  const route = load(routePath, mocks, {
    setInterval: (fn) => { tick = fn; return { unref() {} }; },
    clearInterval: () => { stopped = true; },
    fetch: async (url, init) => {
      assert.ok(init.signal, 'site calls must have a finite deadline');
      if (url.endsWith('/claim')) { claims++; return Response.json({ data: { id: 'job_1', type: jobType, input: { draftId: 'draft1', confirmed: true } } }); }
      if (url.endsWith('/heartbeat')) { heartbeats++; return Response.json({ data: { active: bodies.length === 0, cancelRequested: bodies.length > 0 } }); }
      assert.ok(url.endsWith('/complete'));
      bodies.push(init.body);
      if (!recover) {
        assert.equal(stopped, false);
        tick();
        if (bodies.length === 1) return Response.json({ success: true }); // Missing job acknowledgement is not success.
        const error = new Error('completion timeout after commit'); error.name = 'TimeoutError'; throw error;
      }
      const body = JSON.parse(init.body);
      return Response.json({ success: true, data: { id: 'job_1', status: body.status } });
    },
  }, '\nexport const testDraftView = draftView;');
  try {
    const request = new Request('http://localhost/api/remote-agent/poll', { method: 'POST' });
    request.nextUrl = new URL(request.url);
    const first = await (await route.POST(request)).json();
    assert.equal(first.code, 'COMPLETION_DELIVERY_UNCERTAIN');
    assert.equal(first.data.executionStatus, 'SUCCEEDED');
    assert.ok(heartbeats > 1);
    assert.equal(stopped, true);
    recover = true;
    const second = await (await route.POST(request)).json();
    assert.equal(second.data.completionRecovered, true);
    assert.equal(claims, 1);
    assert.equal(executes, 1);
    assert.equal(new Set(bodies).size, 1);
    assert.equal(JSON.parse(bodies[0]).status, 'SUCCEEDED');
    const markdown = '한글😀'.repeat(20000);
    const view = route.testDraftView('draft', { markdown }, true);
    assert.equal(view.markdown, markdown);
    assert.equal(view.markdownTruncated, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('outbox limits and privacy fail closed across restart without storing credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-private-'));
  const token = 'fixture-device-secret-123';
  try {
    const box = helper.completionOutbox(root, 'https://site', token);
    const value = { job: { id: 'job_1', type: 'POST_PUBLISH' }, body: { status: 'SUCCEEDED', result: token } };
    assert.throws(() => box.save(value));
    const dir = path.join(root, 'remote-agent-completions');
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    assert.equal(files[0].includes(token), false);
    assert.equal(fs.readFileSync(path.join(dir, files[0]), 'utf8').includes(token), false);
    assert.throws(() => load(helperPath).completionOutbox(root, 'https://site', token).read());
    box.clear();
    value.body.result = 'x'.repeat(helper.OUTBOX_MAX_BYTES);
    assert.throws(() => box.save(value));
    assert.ok(fs.statSync(path.join(dir, files[0])).size < 200);
    assert.throws(() => box.read());
    assert.throws(() => load(helperPath).completionOutbox(root, 'https://site', token).read());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

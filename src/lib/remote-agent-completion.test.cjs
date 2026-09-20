const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}, tail = '') {
  if (mocks['@/lib/desktop-activity']) mocks['@/lib/desktop-activity'].beginDesktopActivity ??= () => () => {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8') + tail, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name in mocks ? mocks[name] : name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`), mocks, globals) : require(name), process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, Request, Response, Headers, URL, AbortSignal, ...globals }, { filename: file });
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

test('status snapshot exposes detached image generation without an active remote job', async () => {
  const routePath = path.join(__dirname, '../app/api/remote-agent/poll/route.ts');
  const source = fs.readFileSync(routePath, 'utf8');
  const mocks = {};
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  Object.assign(mocks, {
    '@/lib/db': { prisma: { brandLink: { count: async () => 0 } } },
    '@/lib/desktop-activity': { getDesktopActivitySnapshot: () => ({ count: 1, activities: [{ label: 'brand-post-image-generation', runningForMs: 1234 }] }) },
    '@/lib/naver-session': { getNaverSessionFile: () => path.join(os.tmpdir(), 'absent-status-fixture') },
    '@/lib/connect-contract-store': { hasStoredConnectContract: () => false },
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({ prepareMs: 1, generateMs: 1 }) },
    '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
  });
  const route = load(routePath, mocks, {}, '\nexport const testBuildStatusSnapshot = buildStatusSnapshot;');
  const status = await route.testBuildStatusSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(status.backgroundWork)), { publishing: 0, drafting: 0, processes: 1, imageGeneration: 1, busy: true });
});
for (const jobType of ['SETTINGS_GET', 'POST_PUBLISH']) test(`${jobType}: actual poll timeout and late heartbeat never replay execution`, async () => {
  const activity = load(path.join(__dirname, 'desktop-activity.ts'));
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
    '@/lib/desktop-activity': activity,
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
      assert.ok(activity.getDesktopActivitySnapshot().count > 0, 'claim, heartbeat and completion delivery must block updater readiness');
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
    assert.equal(activity.getDesktopActivitySnapshot().count, 0);
    assert.equal(first.code, 'COMPLETION_DELIVERY_UNCERTAIN');
    assert.equal(first.data.executionStatus, 'SUCCEEDED');
    assert.ok(heartbeats > 1);
    assert.equal(stopped, true);
    recover = true;
    const previousPending = process.env.DESKTOP_UPDATE_INSTALL_PENDING;
    process.env.DESKTOP_UPDATE_INSTALL_PENDING = '1';
    let second;
    try {
      second = await (await route.POST(request)).json();
      assert.equal((await (await route.POST(request)).json()).data.updatePending, true);
    } finally {
      if (previousPending === undefined) delete process.env.DESKTOP_UPDATE_INSTALL_PENDING;
      else process.env.DESKTOP_UPDATE_INSTALL_PENDING = previousPending;
    }
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

for (const status of [409, 413, 401]) test(`permanent ${status} delivery is preserved and cannot starve future claims`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-rejected-'));
  const routePath = path.join(__dirname, '../app/api/remote-agent/poll/route.ts');
  const source = fs.readFileSync(routePath, 'utf8');
  const mocks = {};
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  let configured = true, claims = 0, sends = 0;
  Object.assign(mocks, {
    'next/server': { NextResponse: Response }, '@/lib/remote-agent-completion': helper,
    '@/lib/api-auth': { requireAdminApiKey: () => null }, '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
    '@/lib/remote-activation': { readRemoteActivation: () => configured ? { siteUrl: 'https://site', deviceToken: 'private-credential' } : {}, clearRemoteActivation: () => { configured = false; } },
    '@/lib/connect-contract-store': { hasStoredConnectContract: () => false }, '@/lib/naver-session': { getNaverSessionFile: () => path.join(root, 'absent') },
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
    '../../../../../scripts/lib/app-paths': { getUserDataRoot: () => root }, '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
  });
  const route = load(routePath, mocks, { fetch: async url => {
    if (url.endsWith('/heartbeat')) return Response.json({ success: true, data: { active: false } });
    if (url.endsWith('/claim')) { claims++; return Response.json({ success: true, data: null }); }
    sends++;
    return Response.json({ success: false, error: { code: 'REJECTED', message: 'fixture' } }, { status });
  } });
  const box = helper.completionOutbox(root, 'https://site', 'private-credential');
  const saved = { job: { id: 'job_1', type: 'POST_PUBLISH' }, body: { status: 'SUCCEEDED', result: { postUrl: 'https://example.test/published' } } };
  try {
    box.save(saved);
    const request = new Request('http://localhost/api/remote-agent/poll', { method: 'POST' }); request.nextUrl = new URL(request.url);
    assert.equal((await (await route.POST(request)).json()).code, 'COMPLETION_DELIVERY_REJECTED');
    assert.equal(box.read(), null);
    const rejected = fs.readdirSync(path.join(root, 'remote-agent-completions/rejected')).filter(file => !file.endsWith('.reason.json'));
    assert.equal(rejected.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'remote-agent-completions/rejected', rejected[0]), 'utf8')), saved);
    await route.POST(request);
    assert.equal(sends, 1, 'permanent completion is not sent forever');
    assert.equal(claims, status === 401 ? 0 : 1);
    assert.equal(configured, status !== 401);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('materials handlers separate preparation, selection and publication and preserve local workflow identity', async () => {
  const routePath = path.join(__dirname, '../app/api/remote-agent/poll/route.ts');
  const source = fs.readFileSync(routePath, 'utf8');
  const mocks = {};
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  const requests = [];
  let loseResponse = false;
  let backgroundPending = false;
  Object.assign(mocks, {
    '@/lib/local-automation-error': load(path.join(__dirname, 'local-automation-error.ts')),
    '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
    '@/lib/local-json-fetch': { localJsonFetch: async (url, init, timeoutMs) => {
      const parsed = new URL(url);
      requests.push({ path: parsed.pathname, search: parsed.search, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      assert.ok(timeoutMs === 30000 || requests.at(-1).method === 'GET');
      if (loseResponse) throw new Error('response lost');
      if (parsed.pathname === '/api/materials' && parsed.searchParams.get('jobId') === 'local-workflow-1') {
        return Response.json({ success: true, data: { jobId: 'local-workflow-1', status: backgroundPending ? 'failed' : 'completed', workflowPending: backgroundPending, items: [{
          productId: 'product-1', status: backgroundPending ? 'interrupted' : 'scheduled',
          ...(backgroundPending ? { error: 'shared writer unavailable', errorCode: 'LLM_UNAVAILABLE', causeCode: 'CODEX_MODEL_INCOMPATIBLE' } : {}),
        }] } });
      }
      if (parsed.pathname === '/api/materials') {
        return Response.json({ success: true, data: { materials: [{ productId: 'product-1', revision: 'a'.repeat(64), ready: true, connectKind: 'SHOPPING' }] } });
      }
      return Response.json({ success: true, data: init.method === 'POST' ? { jobId: 'local-workflow-1', status: 'running' } : { materials: [] } });
    } },
  });
  const route = load(routePath, mocks, {}, '\nexport const testExecute = executeJob;');
  const request = new Request('http://localhost/api/remote-agent/poll', { method: 'POST' }); request.nextUrl = new URL(request.url);
  const execute = (type, input) => route.testExecute({ request, job: { id: 'job_source', type, input }, warnings: [], setStage() {}, cancelled: false });
  const prepare = await execute('MATERIALS_PREPARE', { productIds: ['product-1'] });
  assert.equal(requests.at(-1).path, '/api/materials/prepare');
  assert.equal(requests.at(-1).body.sourceJobId, 'job_source');
  assert.equal(prepare.data.workflowPending, true);
  assert.equal(prepare.data.nextCall.arguments.jobId, 'local-workflow-1');
  backgroundPending = true;
  const stillPreparing = await execute('MATERIALS_LIST', { jobId: 'local-workflow-1' });
  assert.equal(stillPreparing.data.workflowPending, true);
  assert.equal(stillPreparing.data.nextCall.arguments.jobId, 'local-workflow-1');
  assert.equal(stillPreparing.data.items[0].error, 'shared writer unavailable');
  assert.equal(stillPreparing.data.items[0].errorCode, 'LLM_UNAVAILABLE');
  assert.equal(stillPreparing.data.items[0].causeCode, 'CODEX_MODEL_INCOMPATIBLE',
    'materials_list MCP result must preserve the safe provider cause code');
  backgroundPending = false;
  const selected = [{ productId: 'product-1', revision: 'a'.repeat(64) }];
  await execute('MATERIALS_PUBLISH', { materials: selected, publishMode: 'now', confirmed: true });
  assert.equal(requests.at(-1).path, '/api/materials/publish');
  assert.deepEqual(requests.at(-1).body.materials, selected);
  assert.equal(requests.at(-1).body.sourceJobId, 'job_source');
  const missingSelection = await execute('POST_SCHEDULE', { confirmed: true });
  assert.equal(missingSelection.data.selectionRequired, true);
  assert.equal(missingSelection.data.executed, false);
  assert.equal(requests.at(-1).path, '/api/materials');
  assert.equal(requests.at(-1).method, 'GET');
  const legacySchedule = await execute('POST_SCHEDULE', { draftId: 'product-1', scheduledDate: '2026-09-09', confirmed: true });
  assert.equal(legacySchedule.kind, 'materials-publish');
  assert.equal(legacySchedule.summary, '선택 소재 예약 등록을 완료했습니다.');
  assert.equal(legacySchedule.data.executed, true);
  assert.equal(legacySchedule.data.workflowPending, false);
  assert.equal(requests.at(-2).path, '/api/materials/publish');
  assert.deepEqual(requests.at(-2).body.materials, selected);
  assert.equal(requests.at(-2).body.publishMode, 'schedule');
  assert.equal(requests.at(-2).body.scheduledAt, '2026-09-09');
  assert.equal(requests.at(-1).path, '/api/materials');
  assert.equal(requests.at(-1).search, '?jobId=local-workflow-1');
  const legacyPublish = await execute('POST_PUBLISH', { draftId: 'product-1', confirmed: true });
  assert.equal(legacyPublish.kind, 'materials-publish');
  assert.equal(legacyPublish.data.executed, true);
  const bulk = await execute('POST_BULK_SCHEDULE', { confirmed: true });
  assert.equal(bulk.data.selectionRequired, true);
  assert.equal(bulk.data.executed, false);
  const publishCallsBeforeUnknown = requests.filter(call => call.path === '/api/materials/publish').length;
  loseResponse = true;
  const unknown = await execute('MATERIALS_PUBLISH', { materials: selected, publishMode: 'now', confirmed: true });
  assert.equal(unknown.data.submissionUncertain, true);
  assert.equal(unknown.data.nextCall.arguments.sourceJobId, 'job_source');
  assert.equal(unknown.data.workflowPending, true);
  assert.equal(requests.filter(call => call.path === '/api/materials/publish').length, publishCallsBeforeUnknown + 1, 'one request per explicit test call, no automatic replay');
});

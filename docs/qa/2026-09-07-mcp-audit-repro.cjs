// Offline diagnostic reproductions. No network, browser, production DB, or generation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(relative, mocks = {}, globals = {}, tail = '') {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8') + tail;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, Request, Response, Headers, URL, AbortSignal, TextEncoder, TextDecoder, ...globals }, { filename: file });
  return module.exports;
}
const helper = load('src/lib/remote-agent-completion.ts');
const http = load('apps/sites/lib/http.ts', { 'next/server': { NextResponse: Response } });
test('900 KiB server limit rejects a result accepted by the 8 MiB desktop outbox', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-size-'));
  const complete = load('apps/sites/app/api/agent/jobs/[id]/complete/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/http': http,
    '@/lib/device': { authenticateDevice: async () => ({ id: 'device', userId: 'owner' }) },
    '@/db/init': {}, '@/db': {}, '@/lib/crypto': {},
  });
  const pending = { job: { id: 'job_1234567890123456', type: 'POST_GET_DRAFT' }, body: { status: 'SUCCEEDED', result: { markdown: '한'.repeat(310000) } } };
  try {
    const box = helper.completionOutbox(dir, 'https://example.test', 'fixture-token');
    box.save(pending);
    assert.equal(box.read().job.id, pending.job.id);
    const response = await complete.POST(new Request('https://example.test/complete', { method: 'POST', body: JSON.stringify(pending.body) }), { params: Promise.resolve({ id: pending.job.id }) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'RESULT_TOO_LARGE');
    box.clear();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const [status, code] of [[409, 'JOB_NOT_ACTIVE'], [413, 'RESULT_TOO_LARGE'], [401, 'DEVICE_REVOKED']]) {
  test(`permanent ${status} completion failure blocks future claim on repeated actual poll calls`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-outbox-'));
    const routeFile = 'src/app/api/remote-agent/poll/route.ts';
    const source = fs.readFileSync(path.join(root, routeFile), 'utf8');
    const mocks = {};
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
    let claims = 0, completions = 0, clearedActivation = 0;
    Object.assign(mocks, {
      'next/server': { NextResponse: Response },
      '@/lib/remote-agent-completion': helper,
      '@/lib/api-auth': { requireAdminApiKey: () => null },
      '@/lib/local-request-auth': { requireTrustedLocalMutation: () => null },
      '@/lib/remote-activation': { readRemoteActivation: () => ({ siteUrl: 'https://example.test', deviceToken: 'fixture-token' }), clearRemoteActivation: () => clearedActivation++ },
      '@/lib/naver-session': { getNaverSessionFile: () => path.join(dir, 'absent') },
      '@/lib/connect-contract-store': { hasStoredConnectContract: () => false },
      '../../../../../scripts/lib/writing-timeout-policy': { getWritingTimeoutPolicy: () => ({}) },
      '../../../../../scripts/lib/app-paths': { getUserDataRoot: () => dir },
      '../../../../../scripts/lib/thumbnail-gen': { isGenerativeThumbnailAvailable: () => false },
    });
    const box = helper.completionOutbox(dir, 'https://example.test', 'fixture-token');
    box.save({ job: { id: 'job_1234567890123456', type: 'POST_PUBLISH' }, body: { status: 'SUCCEEDED', result: { postUrl: 'https://example.test/post' } } });
    const route = load(routeFile, mocks, {
      fetch: async url => {
        if (url.endsWith('/claim')) { claims++; throw new Error('Unexpected claim'); }
        if (url.endsWith('/heartbeat')) return Response.json({ success: status !== 401, data: { active: false } });
        assert.ok(url.endsWith('/complete'));
        completions++;
        return http.apiError(code, 'fixture permanent failure', status);
      },
    });
    try {
      for (let i = 0; i < 3; i++) {
        const request = new Request('http://localhost/api/remote-agent/poll', { method: 'POST' });
        request.nextUrl = new URL(request.url);
        const response = await route.POST(request);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).deliveryCode, code);
      }
      assert.equal(claims, 0);
      assert.equal(completions, 3);
      assert.equal(clearedActivation, 0);
      assert.ok(box.read());
      box.clear();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('semantically identical MCP retries with reordered keys conflict', async () => {
  const sourceFile = 'apps/sites/app/api/mcp/[credential]/route.ts';
  const source = fs.readFileSync(path.join(root, sourceFile), 'utf8');
  const mocks = {};
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) if (!match[1].startsWith('node:')) mocks[match[1]] = {};
  const schema = load('apps/sites/lib/tool-schema.ts');
  const first = { connectKind: 'shopping', draftId: 'product-1', confirmed: true, idempotencyKey: 'same-request-1' };
  const second = { idempotencyKey: 'same-request-1', confirmed: true, draftId: 'product-1', connectKind: 'shopping' };
  let stored;
  Object.assign(mocks, {
    'next/server': { NextResponse: Response },
    '@/db/init': { ensureDatabase: async () => {} },
    '@/db': { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => stored }) }) }) },
    '@/lib/mcp-job-status': { jobGuidance: () => ({}) },
  });
  const route = load(sourceFile, mocks, {}, '\nexport { enqueue as auditEnqueue, TOOLS as auditTools };');
  const tool = route.auditTools.find(t => t.name === 'post_publish');
  const normalizedFirst = schema.validateToolArguments(tool.inputSchema, first).value;
  const normalizedSecond = schema.validateToolArguments(tool.inputSchema, second).value;
  stored = { id: 'job_1234567890123456', type: tool.jobType, inputJson: JSON.stringify(normalizedFirst), status: 'QUEUED' };
  assert.equal((await route.auditEnqueue('owner', tool, normalizedFirst)).structuredContent.reused, true);
  assert.equal((await route.auditEnqueue('owner', tool, normalizedSecond)).structuredContent.code, 'IDEMPOTENCY_CONFLICT');
});

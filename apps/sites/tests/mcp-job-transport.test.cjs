const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}, tail = '') {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8') + tail, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, mocks);
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)), mocks);
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}

const { resultPage, jobGuidance, waitForJob } = load('lib/mcp-job-status.ts');
test('bounded waiting preserves pending jobs across repeated requests', async () => {
  let polls = 0, elapsed = 0;
  const read = async () => ({ status: ++polls > 12 ? 'SUCCEEDED' : 'RUNNING' });
  const sleep = async (ms) => { elapsed += ms; };
  assert.equal((await waitForJob(read, 20000, sleep)).status, 'RUNNING');
  assert.equal(elapsed, 20000);
  assert.equal((await waitForJob(read, 20000, sleep)).status, 'SUCCEEDED');
  assert.equal(jobGuidance('RUNNING', null).mustContinue, true);
  assert.equal(jobGuidance('QUEUED', null).taskOutcome, 'pending');
  assert.equal(jobGuidance('FAILED', 'AUTH_REQUIRED').mustContinue, false);
  assert.equal(await waitForJob(async () => null, 20000, () => { throw Error('must not wait'); }), null);
  assert.equal((await waitForJob(async () => ({ status: 'CANCELLED' }), 20000, () => { throw Error('must not wait'); })).status, 'CANCELLED');
});
test('large multilingual JSON round trips across split surrogate pairs', () => {
  const original = { prompt: '한글😀\\"\n'.repeat(20000) };
  const serialized = JSON.stringify(original);
  let offset = 0;
  let joined = '';
  do {
    const page = resultPage(serialized, offset, 7);
    joined += JSON.parse(JSON.stringify(page)).text;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(joined), original);
});
test('uncertain publication never advises replay; terminal jobs stop polling', () => {
  assert.equal(jobGuidance('FAILED', 'AGENT_LOST_UNCERTAIN').nextAction, 'verify_published');
  assert.equal(jobGuidance('FAILED', 'AGENT_LOST').pollAfterMs, null);
  assert.equal(jobGuidance('RUNNING', null, true).terminal, false);
  assert.equal(resultPage(null, 0, 10).text, 'null');
});

test('agent status keeps bounded background image work counters without arbitrary nested data', () => {
  const { sanitizeStatusSnapshot, parseStatusJson } = load('lib/jobs.ts');
  const stored = sanitizeStatusSnapshot({
    appVersion: '1.3.49',
    backgroundWork: {
      publishing: 0, drafting: 0, processes: 1, imageGeneration: 1, busy: true,
      ownerToken: 'must-not-leak', processKinds: ['private-script.ts'], extra: { secret: true },
    },
  });
  assert.deepEqual(parseStatusJson(stored), {
    appVersion: '1.3.49',
    backgroundWork: { publishing: 0, drafting: 0, processes: 1, imageGeneration: 1, busy: true },
  });
  assert.ok(!stored.includes('must-not-leak'));
  assert.ok(!stored.includes('private-script.ts'));
});

let reads = 0;
let storedResult = '{"hello":"world"}';
const mocks = {
  'cloudflare:workers': { env: {} },
  'next/server': { NextResponse: class extends Response { static json(body, init) { return Response.json(body, init); } } },
  '@/db/init': { ensureDatabase: async () => {} },
  '@/db': { getD1: () => ({ prepare(sql) { return { bind(id, userId) { return { async first() {
    reads++;
    assert.match(sql, /WHERE id=\? AND user_id=\?/);
    return userId === 'owner' && id === 'job_owned' ? { id, status: 'SUCCEEDED', resultJson: storedResult, createdAt: 1, finishedAt: 2 } : null;
  } }; } }; } }) },
  '@/lib/crypto': {},
  '@/lib/jobs': { sweepExpiredLeases: async () => {} },
  '@/lib/mcp': { splitMcpCredential: () => null },
  '@/lib/oauth': { hasOAuthScope: (scope, required) => scope.split(' ').includes(required) },
  '@/lib/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
};
const route = load('app/api/mcp/[credential]/route.ts', mocks);
test('expired context returns owned recovery target and auditable rejection without manuscript logging', async () => {
  const audits = [];
  const recoveryRoute = load('app/api/mcp/[credential]/route.ts', {
    ...mocks,
    '@/lib/crypto': { newId: () => 'draft_rejection_test' },
    '@/db': { getD1: () => ({ prepare(sql) { return { bind(...values) { return {
      async first() { assert.equal(values[1], 'owner'); return { type: 'POST_PREPARE_DRAFT', status: 'SUCCEEDED', finishedAt: Date.now() - 3 * 3600000, inputJson: JSON.stringify({ productId: 'original-product', connectKind: 'shopping' }) }; },
      async run() { audits.push({ sql, values }); return { success: true }; },
    }; } }; } }) },
  });
  const draft = { title: '상품 판단을 위한 제목', sections: Array(5).fill('제품 고유 근거 설명입니다. '.repeat(10)), hashtags: ['제품정보', '선택기준', '사용방법'] };
  const request = new Request('https://example.com/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post_submit_draft', arguments: { contextJobId: 'job_old_context', productId: 'wrong-current-product', draft, idempotencyKey: 'submit-recovery-test' } } }) });
  const result = (await (await recoveryRoute.handleMcpRequest(request, 'owner', 'mcp:write')).json()).result.structuredContent;
  assert.equal(result.code, 'DRAFT_CONTEXT_EXPIRED');
  assert.equal(result.traceId, 'draft_rejection_test');
  assert.equal(result.recovery.nextCall.arguments.productId, 'original-product');
  assert.equal(result.recovery.requiresRevalidation, true);
  assert.equal(audits.length, 1);
  assert.ok(!JSON.stringify(audits).includes(draft.title));
});
async function call(userId, scope, name, args) {
  const request = new Request('https://example.com/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return (await route.handleMcpRequest(request, userId, scope)).json();
}

test('draft repair tool guidance preserves images and reruns current approval quality', async () => {
  const request = new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const payload = await (await route.handleMcpRequest(request, 'owner', 'mcp:read mcp:write')).json();
  const tools = payload.result.tools;
  const submit = tools.find(tool => tool.name === 'post_submit_draft');
  const revise = tools.find(tool => tool.name === 'post_revise_draft');
  const approve = tools.find(tool => tool.name === 'post_approve_draft');
  assert.match(submit.description, /post_revise_draft/u);
  assert.match(submit.description, /전체 패키지를 교체하지 마세요/u);
  assert.match(revise.description, /기존 검수 이미지·슬롯·생성 진행 상태는 유지/u);
  assert.match(approve.description, /현재 품질평가기로 다시 검사/u);
});

test('shopping scene tool requires ordered references; travel keeps its existing input contract', async () => {
  const args = { connectKind: 'shopping', productId: 'product-1', sectionId: 'scene', generatedImageUrl: 'https://example.test/generated.png', idempotencyKey: 'reference-scene-fixture' };
  assert.equal((await call('owner', 'mcp:write', 'post_apply_section_image', args)).result.structuredContent.code, 'PRODUCT_REFERENCE_REQUIRED');
  for (const referenceHashes of [[], ['bad'], ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]])
    assert.equal((await call('owner', 'mcp:write', 'post_apply_section_image', { ...args, referenceHashes })).result.structuredContent.code, 'INVALID_ARGUMENT');
  const { validateToolArguments } = load('lib/tool-schema.ts');
  const listing = await route.handleMcpRequest(new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }), 'owner', 'mcp:read mcp:write');
  const tool = (await listing.json()).result.tools.find(tool => tool.name === 'post_apply_section_image');
  assert.match(tool.description, /실제 원본/u);
  assert.equal(validateToolArguments(tool.inputSchema, { ...args, connectKind: 'travel' }).ok, true);
  const valid = { ...args, referenceHashes: ['b'.repeat(64), 'a'.repeat(64)] };
  const replayRoute = load('app/api/mcp/[credential]/route.ts', { ...mocks, '@/db': { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ({ id: 'job_reference', type: 'POST_APPLY_SECTION_IMAGE', inputJson: JSON.stringify(valid), status: 'SUCCEEDED' }) }) }) }) } });
  const request = new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post_apply_section_image', arguments: valid } }) });
  assert.equal((await (await replayRoute.handleMcpRequest(request, 'owner', 'mcp:write')).json()).result.structuredContent.reused, true, 'Reference order must survive schema validation and queue serialization.');
});

test('shopping scene apply requires PC 1.3.96 while travel and draft reading keep their prior versions', async () => {
  let version = '1.3.95';
  const queued = [];
  const versionRoute = load('app/api/mcp/[credential]/route.ts', { ...mocks,
    '@/lib/crypto': { newId: () => 'job_version_fixture' },
    '@/lib/jobs': { sweepExpiredLeases: async () => {}, findActiveDevice: async () => ({ appVersion: version }), isAgentOnline: async () => true, parseStatusJson: () => null },
    '@/db': { getD1: () => ({ prepare(sql) { return { bind(...values) { return {
      first: async () => sql.includes('COUNT(*)') ? { count: 0 } : null,
      run: async () => { if (sql.includes('INSERT OR IGNORE INTO agent_jobs')) queued.push(JSON.parse(values[4])); return { meta: { changes: 1 } }; },
    }; } }; } }) },
  });
  const invoke = async (name, args) => {
    const request = new Request('https://example.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await (await versionRoute.handleMcpRequest(request, 'owner', 'mcp:read mcp:write')).json()).result.structuredContent;
  };
  const apply = { connectKind: 'shopping', productId: 'product-1', sectionId: 'scene', generatedImageUrl: 'https://example.test/result.png',
    referenceHashes: ['b'.repeat(64), 'a'.repeat(64)], idempotencyKey: 'version-scene-fixture' };
  for (const outdated of ['1.3.95', null]) {
    version = outdated;
    const rejected = await invoke('post_apply_section_image', apply);
    assert.equal(rejected.code, 'APP_UPDATE_REQUIRED');
    assert.equal(rejected.required, '1.3.96');
    assert.equal(queued.length, 0, 'old PCs never receive the new scene contract');
  }
  version = '1.3.95';
  assert.equal((await invoke('agent_get_status', {})).capabilities.shoppingReferenceScenes.supported, false);
  assert.equal((await invoke('post_apply_section_image', { ...apply, connectKind: 'travel', referenceHashes: undefined })).status, 'QUEUED');
  assert.equal((await invoke('post_get_draft', { connectKind: 'shopping', draftId: 'approved-draft' })).status, 'QUEUED');
  version = '1.3.96';
  assert.equal((await invoke('post_apply_section_image', apply)).status, 'QUEUED');
  assert.deepEqual(queued.at(-1).referenceHashes, apply.referenceHashes);
  const capabilities = (await invoke('agent_get_status', {})).capabilities;
  assert.equal(capabilities.shoppingReferenceScenes.minimumAppVersion, '1.3.96');
  assert.equal(capabilities.shoppingReferenceScenes.supported, true);
});

test('legacy shopping draft reads preserve approval and text but suppress obsolete paid-generation instructions', async () => {
  const previous = storedResult;
  try {
    for (const approved of [false, true]) {
      const saved = { kind: 'draft', nextAction: 'ChatGPT 내장 이미지 생성으로 배경을 만드세요.', data: {
        connectKind: 'shopping', approved, approvedAt: approved ? '2026-10-01T00:00:00Z' : null,
        markdown: '보존할 원문😀'.repeat(6000), imageSlots: [{ sectionId: 'scene', imagePrompt: 'Generate environment only', assets: [{ assetKey: 'a'.repeat(64) }], generationMissing: 1 }],
      } };
      storedResult = JSON.stringify(saved);
      const job = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' })).result.structuredContent.job;
      let args = job.resultRead.arguments, joined = '';
      while (true) {
        const page = (await call('owner', 'mcp:read', 'job_result_read', args)).result.structuredContent;
        assert.equal(page.totalChars, job.resultChars);
        joined += page.text;
        if (page.nextOffset === null) break;
        args = { ...args, offset: page.nextOffset };
      }
      const projected = JSON.parse(joined);
      assert.equal(projected.data.approved, approved);
      assert.equal(projected.data.approvedAt, saved.data.approvedAt);
      assert.equal(projected.data.markdown, saved.data.markdown);
      assert.deepEqual(projected.data.imageSlots[0].assets, saved.data.imageSlots[0].assets);
      assert.equal(projected.data.imageSlots[0].imagePrompt, null);
      assert.equal(projected.data.imageSlots[0].referenceReady, false);
      assert.equal(projected.data.imageGenerationCompatibility.required, '1.3.96');
      assert.match(projected.nextAction, /업데이트/u);
      assert.equal(storedResult, JSON.stringify(saved), 'a compatibility view never rewrites saved approval or content');
    }
    const travel = { data: { connectKind: 'travel', imageSlots: [{ imagePrompt: 'Travel scene' }] } };
    storedResult = JSON.stringify(travel, null, 2);
    assert.equal((await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned' })).result.structuredContent.text, storedResult);
  } finally { storedResult = previous; }
});

test('bug report tool requires write scope and explicit consent; lookup requires read scope', async () => {
  const args = { summary: '동기화 오류', idempotencyKey: 'report-test', confirmed: true };
  assert.equal((await call('owner', 'mcp:read', 'bug_report_create', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  assert.equal((await call('owner', 'mcp:write', 'bug_report_create', { ...args, confirmed: false })).result.structuredContent.code, 'INVALID_ARGUMENT');
  assert.equal((await call('owner', 'mcp:write', 'bug_report_get', { reportId: 'bug_test' })).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
});
test('result pages require read scope and cannot read another user job', async () => {
  reads = 0;
  const denied = await call('owner', 'mcp:write', 'job_result_read', { jobId: 'job_owned' });
  assert.equal(denied.result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  assert.equal(reads, 0);
  assert.equal((await call('other', 'mcp:read', 'job_result_read', { jobId: 'job_owned' })).result.structuredContent.code, 'JOB_NOT_FOUND');
  const page = (await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned', limit: 5 })).result.structuredContent;
  assert.equal(page.text, '{"hel');
  assert.equal(page.nextOffset, 5);
});
test('status-only is opt-in; malformed arguments and page limits rejected', async () => {
  const status = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned', includeResult: false })).result.structuredContent;
  assert.equal(status.job.result, null);
  assert.equal(status.job.terminal, true);
  assert.deepEqual((await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' })).result.structuredContent.job.result, { hello: 'world' });
  assert.equal((await call('owner', 'mcp:read', 'job_get', [])).error.code, -32602);
  assert.equal((await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned', limit: 16001 })).result.structuredContent.code, 'INVALID_ARGUMENT');
});
test('publication still requires write scope and explicit confirmation', async () => {
  const args = { connectKind: 'shopping', draftId: 'draft_1', confirmed: true, idempotencyKey: 'test-publish-1' };
  assert.equal((await call('owner', 'mcp:read', 'post_publish', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  assert.equal((await call('owner', 'mcp:write', 'post_publish', { ...args, confirmed: false })).result.structuredContent.code, 'INVALID_ARGUMENT');
});

test('automatic bulk publish requires explicit mode, count and confirmation', async () => {
  const args = { connectKind: 'travel', publishMode: 'now', limit: 10, confirmed: true, idempotencyKey: 'bulk-10-fixture' };
  assert.equal((await call('owner', 'mcp:read', 'post_bulk_publish', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  for (const change of [{ publishMode: 'invalid' }, { limit: 0 }, { limit: 51 }, { confirmed: false }]) {
    assert.equal((await call('owner', 'mcp:write', 'post_bulk_publish', { ...args, ...change })).result.structuredContent.code, 'INVALID_ARGUMENT');
  }
  const { publishMode, ...missingMode } = args;
  assert.equal((await call('owner', 'mcp:write', 'post_bulk_publish', missingMode)).result.structuredContent.code, 'INVALID_ARGUMENT');
});
test('large job_get is bounded and advertised pages reconstruct stored draft', async () => {
  const previous = storedResult;
  storedResult = JSON.stringify({ markdown: '한글😀'.repeat(25000), markdownTruncated: false });
  try {
    const response = await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' });
    assert.ok(JSON.stringify(response).length < 3000);
    assert.equal(response.result.structuredContent.job.resultPaged, true);
    let args = response.result.structuredContent.job.resultRead.arguments;
    let joined = '';
    while (true) {
      const page = (await call('owner', 'mcp:read', 'job_result_read', args)).result.structuredContent;
      joined += page.text;
      if (page.nextOffset === null) break;
      args = { ...args, offset: page.nextOffset };
    }
    assert.equal(joined, storedResult);
  } finally { storedResult = previous; }
});

function nativeReferenceFixture(role, base64) {
  return { role, base64, mimeType: 'image/png', url: `https://example.test/${role}.png`,
    sha256: require('node:crypto').createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex') };
}
const nativeReferenceFixtures = [
  nativeReferenceFixture('product-identity', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0sAAAAASUVORK5CYII='),
  nativeReferenceFixture('approved-scene-continuity', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
];

test('job_get attaches exact ordered native reference pixels even when the result is paged', async () => {
  const previous = storedResult;
  try {
    for (const paged of [false, true]) {
      const references = nativeReferenceFixtures.map(image => ({ ...image, path: 'C:\\private\\seller.png' }));
      storedResult = JSON.stringify({ data: { markdown: paged ? '원문😀'.repeat(12000) : '짧은 원문', nativeReferenceImages: references,
        heroImage: { base64: references[1].base64, mimeType: 'image/png' } } });
      const response = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' })).result;
      const job = response.structuredContent.job;
      assert.equal(Boolean(job.resultPaged), paged);
      assert.equal(job.resultIncluded, !paged);
      assert.deepEqual(response.content.filter(block => block.type === 'image').map(block => block.data),
        [...references.map(image => image.base64), references[1].base64], 'actual source and approved anchor precede the optional hero');
      for (const [index, reference] of references.entries()) {
        const metadata = job.imageAttachments[index];
        assert.equal(metadata.role, reference.role);
        assert.equal(metadata.sha256, reference.sha256);
        assert.equal(metadata.attachmentIndex, index + 1);
        assert.equal(response.content[metadata.contentIndex].data, reference.base64);
      }
      assert.ok(!JSON.stringify(job).includes('base64'));
      assert.ok(!JSON.stringify(job).includes('C:\\private'));
      if (paged) {
        assert.equal(job.result, null);
        let args = job.resultRead.arguments, joined = '';
        while (true) {
          const page = (await call('owner', 'mcp:read', 'job_result_read', args)).result.structuredContent;
          assert.equal(page.totalChars, job.resultChars);
          assert.equal(page.offset, joined.length);
          joined += page.text;
          if (page.nextOffset === null) break;
          args = { ...args, offset: page.nextOffset };
        }
        const projected = JSON.parse(joined);
        assert.equal(projected.data.markdown, JSON.parse(storedResult).data.markdown, 'the complete manuscript survives native projection');
        assert.deepEqual(projected.data.nativeReferenceImages, job.imageAttachments);
        assert.equal(projected.data.heroImageAttached, true);
        assert.ok(!joined.includes('base64'));
        assert.ok(!joined.includes('C:\\private'));
        assert.equal(joined.length, job.resultChars, 'job_get length and page offsets use the same public serialization');
        assert.equal((await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned', offset: joined.length + 1 })).result.structuredContent.code, 'INVALID_OFFSET');
      } else {
        assert.deepEqual(job.result.data.nativeReferenceImages, job.imageAttachments);
      }
      const statusOnly = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned', includeResult: false })).result;
      assert.equal(statusOnly.content.length, 1);
      assert.equal(statusOnly.structuredContent.job.result, null);
    }
  } finally { storedResult = previous; }
});

test('native reference wire bytes do not force paging of a small public draft', async () => {
  const previous = storedResult;
  const references = nativeReferenceFixtures.map(image => nativeReferenceFixture(image.role,
    Buffer.concat([Buffer.from(image.base64, 'base64'), Buffer.alloc(100 * 1024)]).toString('base64')));
  try {
    storedResult = JSON.stringify({ data: { markdown: '한글과 emoji😀를 포함한 원고입니다.', nativeReferenceImages: references } });
    assert.ok(storedResult.length > 32000);
    const response = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' })).result;
    const job = response.structuredContent.job;
    assert.equal(job.resultIncluded, true);
    assert.equal(job.resultPaged, undefined);
    assert.equal(job.resultRead, undefined);
    assert.deepEqual(response.content.filter(block => block.type === 'image').map(block => block.data), references.map(image => image.base64));
    const page = (await call('owner', 'mcp:read', 'job_result_read', { jobId: 'job_owned' })).result.structuredContent;
    assert.equal(page.nextOffset, null);
    assert.deepEqual(JSON.parse(page.text), job.result);
    assert.ok(page.text.length < 2000);
    assert.ok(!page.text.includes('base64'));
    assert.deepEqual(JSON.parse(storedResult).data.nativeReferenceImages, references, 'stored native pixels are not mutated');
  } finally { storedResult = previous; }
});

test('native reference attachment validation fails the whole collection on malformed or oversized pixels', async () => {
  const previous = storedResult;
  const source = nativeReferenceFixtures[0], anchor = nativeReferenceFixtures[1];
  const oversized = nativeReferenceFixture('product-identity', Buffer.concat([Buffer.from(source.base64, 'base64'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64'));
  const large = role => nativeReferenceFixture(role, Buffer.concat([Buffer.from(role === 'product-identity' ? source.base64 : anchor.base64, 'base64'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64'));
  try {
    const invalid = [
      [{ ...source, mimeType: 'image/svg+xml' }], [{ ...source, mimeType: 'image/jpeg' }],
      [{ ...source, base64: 'invalid***' }], [{ ...source, base64: source.base64 + '\n' }],
      [{ ...source, sha256: '0'.repeat(64) }], [{ ...source, url: 'file:///C:/private/seller.png' }],
      [source, { ...source, role: 'approved-scene-continuity' }], [anchor, source], [source, anchor, anchor],
      [oversized], [large('product-identity'), large('approved-scene-continuity')], [source, { ...anchor, sha256: '0'.repeat(64) }],
    ];
    for (const references of invalid) {
      storedResult = JSON.stringify({ data: { nativeReferenceImages: references } });
      const response = (await call('owner', 'mcp:read', 'job_get', { jobId: 'job_owned' })).result;
      assert.equal(response.structuredContent.code, 'IMAGE_REFERENCE_INVALID');
      assert.equal(response.isError, true);
      assert.equal(response.content.filter(block => block.type === 'image').length, 0);
    }
  } finally { storedResult = previous; }
});

test('completion retry accepts only identical result from authenticated owner device', async () => {
  let device = { id: 'device1', userId: 'owner' };
  let stored = null;
  const complete = load('app/api/agent/jobs/[id]/complete/route.ts', {
    ...mocks,
    '@/lib/device': { authenticateDevice: async () => device },
    '@/lib/crypto': { newId: () => 'audit1' },
    '@/db': { getD1: () => ({
      batch: async () => [],
      prepare(sql) { return { bind(...args) { return {
        async run() {
          if (stored) return { meta: { changes: 0 } };
          stored = { status: args[0], resultJson: args[1], errorCode: args[2], errorMessage: args[3] };
          return { meta: { changes: 1 } };
        },
        async first() {
          assert.match(sql, /user_id=\? AND claimed_by_device_id=\?/);
          assert.match(sql, /status='ACTIVE'/);
          return args[1] === 'owner' && args[2] === 'device1' ? stored : null;
        },
      }; } }; },
    }) },
  });
  const send = (body) => complete.POST(new Request('https://site/api/agent/jobs/job_1234567890123456/complete', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'job_1234567890123456' }) });
  const body = { status: 'SUCCEEDED', result: { markdown: '보존한 원문' } };
  assert.equal((await send(body)).status, 200);
  assert.equal((await (await send(body)).json()).data.reused, true);
  assert.equal((await send({ status: 'FAILED', errorCode: 'NETWORK_ERROR' })).status, 409);
  device = { id: 'device2', userId: 'owner' };
  assert.equal((await send(body)).status, 409);
  device = null;
  assert.equal((await send(body)).status, 401);
});

test('SQLite route integration: duplicate completion, late heartbeat and expired publication remain terminal', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT,last_seen_at INTEGER,app_version TEXT,status_json TEXT);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,claimed_by_device_id TEXT,type TEXT,status TEXT,progress INTEGER,result_json TEXT,error_code TEXT,error_message TEXT,updated_at INTEGER,finished_at INTEGER,lease_until INTEGER,stage TEXT,stage_message TEXT,heartbeat_at INTEGER,cancel_requested INTEGER);
    CREATE TABLE audit_events(id TEXT,actor_user_id TEXT,target_user_id TEXT,action TEXT,metadata_json TEXT,created_at INTEGER);
    INSERT INTO devices(id,status) VALUES('device1','ACTIVE');`);
  const d1 = {
    prepare(sql) { return { bind(...args) { return {
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
    }; } }; },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const jobs = load('lib/jobs.ts');
  const shared = { ...mocks, '@/lib/jobs': jobs, '@/lib/device': { authenticateDevice: async () => ({ id: 'device1', userId: 'owner' }) }, '@/lib/crypto': { newId: () => 'audit1' }, '@/db': { getD1: () => d1 } };
  const complete = load('app/api/agent/jobs/[id]/complete/route.ts', shared);
  const heartbeat = load('app/api/agent/jobs/[id]/heartbeat/route.ts', shared);
  const id = 'job_1234567890123456';
  const context = { params: Promise.resolve({ id }) };
  const send = (route, body) => route.POST(new Request('https://site/api/agent/jobs', { method: 'POST', body: JSON.stringify(body) }), context);
  const body = { status: 'SUCCEEDED', result: { postUrl: 'https://example.test/published' } };
  try {
    db.prepare(`INSERT INTO agent_jobs(id,user_id,claimed_by_device_id,type,status,progress,lease_until) VALUES(?,?,?,?,?,?,?)`).run(id, 'owner', 'device1', 'POST_PUBLISH', 'RUNNING', 99, Date.now() + 120000);
    assert.equal((await send(complete, body)).status, 200);
    const before = JSON.stringify(db.prepare('SELECT * FROM agent_jobs').get());
    assert.equal((await (await send(complete, body)).json()).data.reused, true);
    assert.equal((await (await send(heartbeat, { progress: 20, stage: 'publishing' })).json()).data.active, false);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_jobs').get()), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 1);
    // A swept lease is an uncertainty state, never permission to publish again.
    db.prepare("UPDATE agent_jobs SET status='RUNNING',lease_until=1,result_json=NULL").run();
    await jobs.sweepExpiredLeases(d1, 'owner');
    assert.equal(db.prepare('SELECT error_code FROM agent_jobs').get().error_code, 'AGENT_LOST_UNCERTAIN');
    assert.equal((await send(complete, body)).status, 409);
    assert.equal((await (await send(heartbeat, {})).json()).data.active, false);
    assert.equal(db.prepare('SELECT status FROM agent_jobs').get().status, 'FAILED');
  } finally { db.close(); }
});

test('multilingual result larger than inline limit is uploaded, authenticated, hash verified and read losslessly', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT,last_seen_at INTEGER);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,user_id TEXT,claimed_by_device_id TEXT,status TEXT,progress INTEGER,result_json TEXT,error_code TEXT,error_message TEXT,updated_at INTEGER,finished_at INTEGER,lease_until INTEGER,stage TEXT);
    CREATE TABLE agent_job_result_chunks(job_id TEXT,user_id TEXT,result_hash TEXT,chunk_index INTEGER,content TEXT,created_at INTEGER,PRIMARY KEY(job_id,result_hash,chunk_index));
    CREATE TABLE audit_events(id TEXT,actor_user_id TEXT,target_user_id TEXT,action TEXT,metadata_json TEXT,created_at INTEGER);
    INSERT INTO devices(id,status) VALUES('device1','ACTIVE');`);
  const d1 = {
    prepare(sql) { return { bind(...args) { return {
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
    }; } }; }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  let device = { id: 'device1', userId: 'owner' };
  const shared = { ...mocks, '@/lib/device': { authenticateDevice: async () => device }, '@/lib/crypto': { newId: () => 'audit1' }, '@/db': { getD1: () => d1 } };
  const chunk = load('app/api/agent/jobs/[id]/result-chunk/route.ts', shared);
  const complete = load('app/api/agent/jobs/[id]/complete/route.ts', shared);
  const { readCompletionResult } = load('lib/completion-result.ts', shared);
  const { completionWireBody } = load('../../src/lib/remote-agent-completion.ts');
  const id = 'job_1234567890123456';
  const send = (handler, body) => handler.POST(new Request('https://site/api/agent/jobs', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const result = { markdown: '한글😀\\"\n'.repeat(120000) };
  try {
    db.prepare('INSERT INTO agent_jobs(id,user_id,claimed_by_device_id,status) VALUES(?,?,?,?)').run(id, 'owner', 'device1', 'RUNNING');
    let uploads = 0;
    const wire = await completionWireBody({ status: 'SUCCEEDED', result }, async value => {
      uploads++;
      assert.equal((await send(chunk, value)).status, 200);
      assert.equal((await send(chunk, value)).status, 200, 'same chunk retry is idempotent');
    });
    assert.ok(uploads > 1);
    assert.equal(wire.result, undefined);
    assert.equal((await send(complete, wire)).status, 200);
    assert.equal((await (await send(complete, wire)).json()).data.reused, true);
    const stored = db.prepare('SELECT result_json AS resultJson FROM agent_jobs').get().resultJson;
    assert.ok(stored.length < 500, 'D1 job row stores only the verified reference');
    assert.deepEqual(JSON.parse(await readCompletionResult(d1, 'owner', id, stored)), result);
    await assert.rejects(readCompletionResult(d1, 'other', id, stored), /INCOMPLETE/);
    device = { id: 'otherDevice', userId: 'owner' };
    assert.equal((await send(chunk, { sha256: wire.resultReference.sha256, index: 0, content: 'changed' })).status, 409);
    device = { id: 'device1', userId: 'owner' };
    assert.equal((await send(chunk, { sha256: wire.resultReference.sha256, index: 0, content: 'changed' })).status, 409);
    db.prepare('UPDATE agent_job_result_chunks SET content=? WHERE chunk_index=0').run('corrupted');
    await assert.rejects(readCompletionResult(d1, 'owner', id, stored), /INTEGRITY/);
    assert.equal((await send(complete, wire)).status, 422);
  } finally { db.close(); }
});

test('actual enqueue reuses legacy key order but rejects changed revision', async () => {
  const original = { idempotencyKey: 'selected-material-fixture', materials: [{ revision: 'revision-a', productId: 'product-1' }], confirmed: true, publishMode: 'now' };
  const reordered = { publishMode: 'now', confirmed: true, materials: [{ productId: 'product-1', revision: 'revision-a' }], idempotencyKey: 'selected-material-fixture' };
  const route = load('app/api/mcp/[credential]/route.ts', { ...mocks, '@/db': { getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => ({ id: 'job_existing', type: 'MATERIALS_PUBLISH', inputJson: JSON.stringify(original), status: 'SUCCEEDED' }) }) }) }) } }, '\nexport const testEnqueue = enqueue;');
  const tool = { jobType: 'MATERIALS_PUBLISH' };
  assert.equal((await route.testEnqueue('owner', tool, reordered)).structuredContent.reused, true);
  assert.equal((await route.testEnqueue('owner', tool, { ...reordered, materials: [{ productId: 'product-1', revision: 'changed' }] })).structuredContent.code, 'IDEMPOTENCY_CONFLICT');
});

test('selected materials need revision, unique IDs, scheduled date and write scope', async () => {
  const args = { materials: [{ productId: 'product-1', revision: 'revision-a' }], publishMode: 'now', confirmed: true, idempotencyKey: 'selected-material-fixture' };
  assert.equal((await call('owner', 'mcp:read', 'materials_publish', args)).result.structuredContent.code, 'INSUFFICIENT_SCOPE');
  for (const changed of [
    { ...args, materials: [{ productId: 'product-1' }] },
    { ...args, materials: [args.materials[0], args.materials[0]] },
    { ...args, publishMode: 'schedule' },
    { ...args, publishMode: 'schedule', scheduledAt: '2026-02-31' },
    { ...args, confirmed: false },
  ]) assert.equal((await call('owner', 'mcp:write', 'materials_publish', changed)).result.structuredContent.code, 'INVALID_ARGUMENT');
});

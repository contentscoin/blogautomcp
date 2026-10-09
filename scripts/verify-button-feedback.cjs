/* eslint-disable @typescript-eslint/no-require-imports -- Offline VM tests execute the actual TSX components and route with mocked boundaries. */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const nodes = value => value == null || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => value == null || typeof value === 'boolean' ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).trim() === label);
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function load(file, dependencies, globals = {}) {
  const testModule = { exports: {} };
  const context = vm.createContext({ module: testModule, exports: testModule.exports, console, ...globals, require(name) {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new vm.Script(code, { filename: file }).runInContext(context);
  return testModule.exports;
}
const contract = load('src/lib/topic-candidate-contract.ts', {});
const keywordData = { trending: ['정상 키워드'], seasonal: [], combinations: [], tips: [] };
const qualityData = { score: 90, grade: 'A', feedback: [], tips: [] };
const topic = { title: '정상 후보', subtopics: [{ subtitle: '첫 소주제', summary: '확인할 내용' }], content: '## 첫 소주제\n확인한 정보', image_prompt: 'Natural daylight photo', hashtags: ['#주제'] };

function client(file, onFetch) {
  const states = [], hooks = [], effects = [], requests = [], copies = [], alerts = [];
  let cursor = 0, clipboardRejected = false;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useCallback(fn, deps) { const index = cursor++; const previous = hooks[index]; if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) hooks[index] = { fn, deps }; return hooks[index].fn; },
    useEffect(fn, deps) { const index = cursor++; const previous = hooks[index]; if (!previous || !deps || deps.some((value, n) => !Object.is(value, previous.deps[n]))) { previous?.cleanup?.(); hooks[index] = { deps }; effects.push(() => { hooks[index].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const component = load(file, { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'a' }, '@/components/MaterialJobProgress': { MaterialJobProgress: 'progress' }, '@/lib/topic-candidate-contract': contract }, {
    URLSearchParams, Date, Set, navigator: { clipboard: { writeText: async value => { copies.push(value); if (clipboardRejected) throw new Error('clipboard denied'); } } }, alert: value => alerts.push(value),
    fetch: async (url, init = {}) => { requests.push({ url, ...init }); return onFetch(url, init); },
  }).default;
  return { requests, copies, alerts, rejectClipboard(value) { clipboardRejected = value; },
    render() { cursor = 0; return component(); },
    async mount() { this.render(); await this.flush(); return this.render(); },
    async flush() { effects.splice(0).forEach(effect => effect()); await settle(); },
  };
}

test('keyword HTTP failure clears an old result, displays an alert, and can retry', async () => {
  let fail = false;
  const h = client('src/app/keywords/page.tsx', async () => fail ? response({ success: false, error: '키워드 서버 실패' }, 500) : response({ success: true, data: keywordData }));
  let tree = await h.mount(); assert(text(tree).includes('정상 키워드'));
  fail = true; await button(tree, '🔍 분석').props.onClick(); tree = h.render();
  assert(text(tree).includes('키워드 서버 실패')); assert(!text(tree).includes('정상 키워드')); assert(nodes(tree).some(node => node.props?.role === 'alert')); assert.equal(button(tree, '🔍 분석').props.disabled, false);
  fail = false; await button(tree, '🔍 분석').props.onClick(); assert(text(h.render()).includes('정상 키워드'));
});

test('quality failure and malformed success cannot leave an old quality score visible', async () => {
  let result = response({ success: true, data: qualityData });
  const h = client('src/app/keywords/page.tsx', async (_url, init) => JSON.parse(init.body).action === 'quality' ? result : response({ success: true, data: keywordData }));
  let tree = await h.mount(); await button(tree, '📊 품질 분석').props.onClick(); tree = h.render(); assert(text(tree).includes('품질 점수: 90/100'));
  result = response({ success: false, error: '품질 서버 실패' }, 500); await button(tree, '📊 품질 분석').props.onClick(); tree = h.render(); assert(text(tree).includes('품질 서버 실패')); assert(!text(tree).includes('품질 점수:'));
  result = response({ success: true, data: { grade: 'A' } }); await button(tree, '📊 품질 분석').props.onClick(); assert(text(h.render()).includes('응답 형식이 올바르지'));
});

test('keyword clipboard rejection is handled and success is reported only after write resolves', async () => {
  const h = client('src/app/keywords/page.tsx', async () => response({ success: true, data: keywordData }));
  let tree = await h.mount(); h.rejectClipboard(true); await button(tree, '정상 키워드').props.onClick(); tree = h.render(); assert(text(tree).includes('복사하지 못했습니다')); assert(!text(tree).includes('클립보드에 복사했습니다')); assert.equal(h.alerts.length, 0);
  h.rejectClipboard(false); await button(tree, '정상 키워드').props.onClick(); assert(text(h.render()).includes('클립보드에 복사했습니다'));
});

test('a late keyword request cannot overwrite the latest category or clear its loading state', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const h = client('src/app/keywords/page.tsx', async () => (++count === 1 ? first : second).promise);
  let tree = await h.mount(); button(tree, '✈️ 여행').props.onClick(); tree = h.render(); await h.flush(); assert.equal(h.requests.length, 2);
  first.resolve(response({ success: false, error: '늦은 이전 오류' }, 500)); await settle(); tree = h.render(); assert(!text(tree).includes('늦은 이전 오류')); assert.equal(button(tree, '분석 중...').props.disabled, true);
  second.resolve(response({ success: true, data: { ...keywordData, trending: ['여행 최신 결과'] } })); await settle(); assert(text(h.render()).includes('여행 최신 결과'));
});

test('history HTTP failure differs from an empty successful result and offers retry', async () => {
  let result = response({ success: false, error: '기록 조회 실패' }, 500);
  const h = client('src/app/history/page.tsx', async () => result);
  let tree = await h.mount(); assert(text(tree).includes('기록 조회 실패')); assert(!text(tree).includes('발행 기록이 없습니다'));
  result = response({ success: true, data: { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } } }); button(tree, '다시 불러오기').props.onClick(); await settle(); tree = h.render(); assert(text(tree).includes('발행 기록이 없습니다')); assert(!text(tree).includes('기록 조회 실패'));
});

test('history filter races ignore late old data and errors', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const h = client('src/app/history/page.tsx', async () => (++count === 1 ? first : second).promise);
  let tree = await h.mount(); button(tree, '❌ 실패').props.onClick(); h.render(); await h.flush();
  second.resolve(response({ success: true, data: { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } } })); await settle(); first.resolve(response({ success: true, data: { items: [{ id: 'old', title: '다른 필터의 오래된 기록', status: 'PUBLISHED', updatedAt: '2026-10-08T00:00:00Z' }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } } })); await settle(); tree = h.render(); assert(text(tree).includes('발행 기록이 없습니다')); assert(!text(tree).includes('다른 필터의 오래된 기록'));
});

function enterTopicInput(h) {
  let tree = h.render(); const category = nodes(tree).find(node => node.type === 'button' && text(node).includes('기술 / IT')); category.props.onClick(); tree = h.render(); nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: '네이버 블로그' } }); return h.render();
}
test('topic Enter and stale click handlers dispatch one generation request while pending', async () => {
  const pending = deferred(); const h = client('src/app/topic-candidates/page.tsx', async () => pending.promise);
  const tree = enterTopicInput(h); const input = nodes(tree).find(node => node.type === 'input'); input.props.onKeyDown({ key: 'Enter' }); input.props.onKeyDown({ key: 'Enter' }); button(tree, '소재 생성 (10개)').props.onClick(); assert.equal(h.requests.length, 1);
  pending.resolve(response({ topics: [topic] })); await settle(); assert(text(h.render()).includes('정상 후보'));
});

test('invalid topic payload is an explicit error instead of a render crash', async () => {
  const h = client('src/app/topic-candidates/page.tsx', async () => response({ topics: [{ title: '불완전 후보' }] }));
  await button(enterTopicInput(h), '소재 생성 (10개)').props.onClick(); const tree = h.render(); assert(text(tree).includes('응답 형식이 올바르지')); assert(!text(tree).includes('생성된 소재 1개'));
});

test('topic fallback warning remains visible and clipboard denial has truthful feedback', async () => {
  const h = client('src/app/topic-candidates/page.tsx', async () => response({ topics: [topic], fallback: true, warning: '로컬 후보입니다. 근거 확인이 필요합니다.' }));
  await button(enterTopicInput(h), '소재 생성 (10개)').props.onClick(); let tree = h.render(); assert(text(tree).includes('로컬 후보입니다. 근거 확인이 필요합니다.'));
  nodes(tree).find(node => node.type === 'button' && text(node).includes('정상 후보')).props.onClick(); tree = h.render(); h.rejectClipboard(true); button(tree, '복사').props.onClick(); await settle(); tree = h.render(); assert(text(tree).includes('복사하지 못했습니다')); assert(!text(tree).includes('소재를 클립보드에 복사했습니다'));
  h.rejectClipboard(false); button(tree, '복사').props.onClick(); await settle(); assert(text(h.render()).includes('소재를 클립보드에 복사했습니다'));
});

test('queue submission keeps generated input and cannot race a second queue or generation', async () => {
  const pending = deferred(); const h = client('src/app/topic-candidates/page.tsx', async url => url === '/api/topic' ? pending.promise : response({ topics: [topic] }));
  await button(enterTopicInput(h), '소재 생성 (10개)').props.onClick(); let tree = h.render(); nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: '변경된 검색어' } }); nodes(tree).find(node => node.type === 'button' && text(node).includes('정상 후보')).props.onClick(); tree = h.render();
  const add = button(tree, '발행 큐에 추가'); add.props.onClick(); add.props.onClick(); button(tree, '소재 생성 (10개)').props.onClick(); const posts = h.requests.filter(item => item.url === '/api/topic'); assert.equal(posts.length, 1); assert.equal(h.requests.filter(item => item.url === '/api/topic-candidates').length, 1); assert.equal(JSON.parse(posts[0].body).keywords, '네이버 블로그');
  pending.resolve(response({ success: true })); await settle(); assert(text(h.render()).includes('✓ 발행 큐에 추가됨'));
});

function routeHarness() {
  const state = { output: JSON.stringify({ topics: [topic] }), calls: 0, activity: 0, auth: null, update: null, failure: null };
  const json = (data, options = {}) => ({ status: options.status || 200, data });
  const route = load('src/app/api/topic-candidates/route.ts', {
    'next/server': { NextResponse: { json } }, '@/lib/topic-candidate-contract': contract,
    '../../../../scripts/lib/codex-draft-provider': { runCodexDraft: async () => { state.calls++; if (state.failure) throw state.failure; return state.output; }, codexDraftTerminalFailureCode: () => null },
    '../../../../scripts/lib/codex-text': { extractJsonObject: value => JSON.parse(value) }, '@/lib/api-auth': { requireAdminApiKey: () => state.auth },
    '@/lib/update-guard': { requireNoPendingDesktopUpdate: () => state.update }, '@/lib/desktop-activity': { beginDesktopActivity: () => { state.activity++; return () => { state.activity--; }; } },
  }, { process: { env: {} }, console: { warn() {} } });
  return { state, post: body => route.POST({ json: async () => body }), malformed: () => route.POST({ json: async () => { throw new Error('bad JSON'); } }) };
}

test('valid topic API response retains its existing response envelope and releases activity', async () => {
  const h = routeHarness(); const result = await h.post({ category: 'tech', keyword: '블로그' }); assert.equal(result.status, 200); assert.equal(JSON.stringify(result.data), h.state.output); assert.equal(h.state.calls, 1); assert.equal(h.state.activity, 0);
});

test('malformed generated candidates produce validated local fallback with a format warning', async () => {
  for (const output of [{ topics: [{ title: '불완전' }] }, { topics: Array.from({ length: 11 }, () => topic) }, { topics: [{ ...topic, subtopics: null }] }, { topics: [{ ...topic, hashtags: [12] }] }, { topics: [{ ...topic, content: 'x'.repeat(20_001) }] }]) {
    const h = routeHarness(); h.state.output = JSON.stringify(output); const result = await h.post({ category: 'tech', keyword: '블로그' }); assert.equal(result.status, 200); assert.equal(result.data.fallback, true); assert.match(result.data.warning, /응답 형식/); assert.equal(contract.isTopicCandidateList(result.data.topics), true); assert.equal(h.state.activity, 0);
  }
  const h = routeHarness(); h.state.failure = new Error('provider failed'); const result = await h.post({ category: 'tech', keyword: '블로그' }); assert.equal(result.data.fallback, true); assert.match(result.data.warning, /생성이 실패/); assert.equal(h.state.activity, 0);
});

test('topic request/auth/update validation never starts a provider for rejected input', async () => {
  const h = routeHarness(); for (const body of [null, [], { category: 1, keyword: '블로그' }, { category: 'tech', keyword: '   ' }, { category: 'tech', keyword: 'x'.repeat(201) }, { category: 'tech', keyword: '<script>' }]) assert.equal((await h.post(body)).status, 400);
  assert.equal((await h.malformed()).status, 400); h.state.auth = { status: 401 }; assert.equal((await h.post({ category: 'tech', keyword: '블로그' })).status, 401); h.state.auth = null; h.state.update = { status: 423 }; assert.equal((await h.post({ category: 'tech', keyword: '블로그' })).status, 423); assert.equal(h.state.calls, 0);
});

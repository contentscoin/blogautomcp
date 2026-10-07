/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS VM fixture loads transpiled client components. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

const nodes = value => value == null || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => value == null ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const job = (overrides = {}) => ({ jobId: 'rewrite-fixture', kind: 'rewrite', status: 'running', startedAt: '2026-10-08T00:00:00.000Z', sourceJobId: '00000000-0000-4000-8000-000000000001', items: [{ productId: 'failed_product', status: 'preparing', stage: '원고 재작성 중' }], ...overrides });
const list = (overrides = {}) => ({ success: true, data: { materials: [], jobs: [], failedCandidateCount: 1, failedCandidates: [{ productId: 'failed_product', productName: '실패 상품', reason: '내용 검증 실패', errorCode: 'CONTENT_READINESS_FAILED' }], ...overrides } });
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

function harness({ source = 'MaterialLibrary', storage = new Map(), onFetch, initialList = list(), history = false } = {}) {
  const states = [], effectDeps = [], requests = [];
  let cursor = 0, effects = [], uuidCount = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useCallback(callback) { cursor++; return callback; },
    useEffect(effect, deps) { const index = cursor++; const previous = effectDeps[index]; if (!previous || !deps || deps.some((value, n) => !Object.is(value, previous[n]))) { effectDeps[index] = deps; effects.push(effect); } },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const testModule = { exports: {} };
  const context = vm.createContext({
    module: testModule, exports: testModule.exports, require: name => name === 'react' ? react : name === 'next/link' ? { default: 'a' } : { jsx, jsxs: jsx },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crypto: { randomUUID: () => { uuidCount++; return `00000000-0000-4000-8000-${String(uuidCount).padStart(12, '0')}`; } },
    Date, console, setInterval: () => 1, clearInterval() {},
    fetch: async (url, init) => { requests.push({ url, init }); return onFetch ? onFetch(url, init) : response(initialList); },
  });
  const code = ts.transpileModule(fs.readFileSync(`src/components/${source}.tsx`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(code).runInContext(context);
  const props = source === 'MaterialLibrary' ? { connectKind: 'SHOPPING', candidates: [{ id: 'ready_product', productName: '준비완료 상품' }, { id: 'failed_product', productName: '실패 상품' }], onPreview() {}, onChanged() {} } : { history };
  const render = () => { cursor = 0; effects = []; return testModule.exports[source](props); };
  return { requests, storage, render, uuidCount: () => uuidCount, async mount() { render(); effects.forEach(effect => effect()); await settle(); return render(); } };
}
const rewriteButton = tree => nodes(tree).find(node => node.type === 'button' && text(node).startsWith('실패 소재 전체 재작성·검증'));
const retryButton = tree => nodes(tree).find(node => node.type === 'button' && text(node) === '이전 재작성 요청 확인·재시도');

(async () => {
  for (const initialList of [list({ failedCandidateCount: 0, failedCandidates: [] }), list({ jobs: [job({ kind: 'prepare' })] })]) {
    const h = harness({ initialList }); const tree = await h.mount();
    assert.equal(rewriteButton(tree).props.disabled, true, 'zero targets or another running job disables rewrite');
  }
  {
    const h = harness({ initialList: list({ failedCandidateCount: 7 }) });
    const tree = await h.mount();
    assert(text(rewriteButton(tree)).includes('(7개)'), 'target count comes from the server, independent of candidates');
    assert(text(tree).includes('실패 상품 — 내용 검증 실패 (CONTENT_READINESS_FAILED)'));
  }
  {
    let savedJob;
    const h = harness({ onFetch: async (url, init) => {
      if (init?.method === 'POST') { const payload = JSON.parse(init.body); savedJob = job({ sourceJobId: payload.sourceJobId }); return response({ success: true, data: savedJob }, 202); }
      return response(list({ jobs: savedJob ? [savedJob] : [] }));
    } });
    const tree = await h.mount(); rewriteButton(tree).props.onClick(); rewriteButton(tree).props.onClick(); await settle();
    const posts = h.requests.filter(item => item.init?.method === 'POST');
    assert.equal(posts.length, 1, 'double click submits exactly one request');
    assert.equal(posts[0].url, '/api/materials/rewrite-failed');
    assert.deepEqual(JSON.parse(posts[0].init.body), { connectKind: 'SHOPPING', sourceJobId: savedJob.sourceJobId }, 'server selects failed items; UI sends no ready product IDs');
    assert.equal(h.storage.size, 0, 'confirmed receipt clears pending identity');
    assert(text(h.render()).includes('실패 소재 재작성·검증'));
    assert(!h.requests.some(item => item.url.endsWith('/publish')), 'rewrite never publishes');
  }
  {
    let postCount = 0;
    const h = harness({ onFetch: async (url, init) => {
      if (url.includes('sourceJobId=')) return response({ success: false, error: 'not found' }, 404);
      if (init?.method === 'POST') {
        postCount++;
        if (postCount === 1) throw new Error('응답 유실');
        return response({ success: true, data: job({ sourceJobId: JSON.parse(init.body).sourceJobId }) }, 202);
      }
      return response(list());
    } });
    const tree = await h.mount(); rewriteButton(tree).props.onClick(); await settle();
    let next = h.render(); assert.equal(rewriteButton(next).props.disabled, true);
    assert(text(next).includes('같은 요청 ID로 이어집니다'));
    assert(retryButton(next)); retryButton(next).props.onClick(); await settle();
    const payloads = h.requests.filter(item => item.init?.method === 'POST').map(item => JSON.parse(item.init.body));
    assert.equal(payloads.length, 2); assert.equal(payloads[0].sourceJobId, payloads[1].sourceJobId, 'uncertain submission retry preserves identity');
    assert.equal(h.uuidCount(), 1); assert.equal(h.storage.size, 0);
  }
  {
    const storage = new Map([['material-failed-rewrite-v1:SHOPPING', job().sourceJobId]]);
    const h = harness({ storage, onFetch: async url => url.includes('sourceJobId=') ? response({ success: true, data: job({ status: 'completed', items: [{ productId: 'failed_product', status: 'ready', stage: '검증·승인 완료' }] }) }) : response(list({ failedCandidateCount: 0, failedCandidates: [] })) });
    const tree = await h.mount(); assert(retryButton(tree), 'pending request survives reload even after no failed targets remain');
    retryButton(tree).props.onClick(); await settle();
    assert.equal(h.requests.filter(item => item.init?.method === 'POST').length, 0, 'lookup resolves original job without second POST');
    assert.equal(h.uuidCount(), 0); assert.equal(storage.size, 0);
  }
  const inconsistent = job({ status: 'completed', items: [{ productId: 'ready_product', status: 'ready', stage: '검증·승인 완료' }, { productId: 'failed_product', status: 'failed', stage: '원고 검증', error: '검증 실패', errorCode: 'CONTENT_READINESS_FAILED' }] });
  {
    const h = harness({ initialList: list({ jobs: [inconsistent] }) }); const tree = await h.mount();
    assert(text(tree).includes('검증 통과 1/2개 · 실패 1개 · 검증 확인 필요'));
    assert(text(tree).includes('검증 실패 (CONTENT_READINESS_FAILED)'));
  }
  for (const history of [false, true]) {
    const shown = history ? inconsistent : { ...inconsistent, status: 'running' };
    const h = harness({ source: 'MaterialJobProgress', history, initialList: list({ jobs: [shown] }) }); const tree = await h.mount();
    assert(text(tree).includes('실패 소재 재작성·검증'));
    assert(text(tree).includes(history ? '검증 확인 필요' : '검증 통과 1/2 · 실패 1개'));
    if (history) assert(text(tree).includes('CONTENT_READINESS_FAILED'));
  }
  for (const source of ['MaterialLibrary', 'MaterialJobProgress']) {
    for (const empty of [false, true]) {
      const terminalJob = empty ? job({ status: 'completed', items: [] }) : job({ status: 'partial', items: [{ productId: 'failed_product', status: 'failed', stage: '검증 실패' }] });
      const h = harness({ source, history: true, initialList: list({ jobs: [terminalJob] }) });
      const tree = await h.mount();
      assert(text(tree).includes(empty ? '재작성 대상 없음' : '검증 실패 · 확인 필요'));
      assert(!text(tree).includes('일부 검증 완료'));
    }
  }
  console.log('PASS: failed-material button eligibility, server targets, stable request and reload recovery, double-click guard, truthful verification counts/history; no provider or publication calls');
})().catch(error => { console.error(error); process.exitCode = 1; });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const site = 'https://blogautomcp.hiway350051.chatgpt.site';
const privateUrl = 'https://chatgpt.com/plugins/plugin_asdk_app_sites_a4ba33aa14088191b648c875a67bb5ea';
const publicFixtureUrl = 'https://chatgpt.com/plugins/plugin_public_test_fixture';
const nowSeed = Date.parse('2026-10-09T01:00:00Z');

function snapshot(overrides = {}) {
  const base = {
    channel: { exists: false, generation: 0 },
    mcp: { authorized: false, readVerified: false, lastVerifiedAt: null },
    pc: { paired: false, online: false, name: null, roundTripVerified: false, lastVerifiedAt: null },
    naver: { sessionSaved: null }, ready: false,
  };
  return { ...base, ...overrides, channel: { ...base.channel, ...overrides.channel }, mcp: { ...base.mcp, ...overrides.mcp }, pc: { ...base.pc, ...overrides.pc }, naver: { ...base.naver, ...overrides.naver } };
}
function fixture(options = {}) {
  const hooks = [], pendingEffects = [];
  const intervals = new Map(), timeouts = new Map();
  const listeners = { window: new Map(), document: new Map() };
  const requests = [], copied = [], confirmations = [];
  let hookIndex = 0, dirty = false, timerId = 0, refreshes = 0, now = nowSeed;
  let responder = options.fetch || (() => { throw Error('unexpected request'); });
  let confirm = options.confirm ?? true;
  const location = { href: '', reload() {} };
  const listen = surface => ({
    addEventListener(type, callback) {
      if (!listeners[surface].has(type)) listeners[surface].set(type, new Set());
      listeners[surface].get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners[surface].get(type)?.delete(callback); },
  });
  const doc = { visibilityState: 'visible', ...listen('document') };
  const nav = { onLine: true, clipboard: { async writeText(value) { copied.push(value); if (options.clipboardDenied) throw Error('permission denied'); } } };
  const react = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], value => {
        const next = typeof value === 'function' ? value(hooks[index]) : value;
        if (!Object.is(next, hooks[index])) dirty = true;
        hooks[index] = next;
      }];
    },
    useRef(initial) { const index = hookIndex++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useCallback(callback, dependencies) {
      const index = hookIndex++, previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) hooks[index] = { dependencies, callback };
      return hooks[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = hookIndex++, previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) pendingEffects.push(() => {
        previous?.cleanup?.(); hooks[index] = { dependencies, cleanup: callback() };
      });
    },
  };
  class Clock extends Date { static now() { return now; } }
  const router = { refresh() { refreshes++; } };
  const context = vm.createContext({
    URL, Error, AbortController, Date: Clock, document: doc, navigator: nav,
    window: {
      location, ...listen('window'),
      confirm(message) { confirmations.push(message); return confirm; },
      setInterval(callback) { intervals.set(++timerId, callback); return timerId; },
      clearInterval(id) { intervals.delete(id); },
      setTimeout(callback, delay) { timeouts.set(++timerId, { callback, at: now + delay }); return timerId; },
      clearTimeout(id) { timeouts.delete(id); },
    },
    fetch: async (url, init) => { requests.push({ url, ...init }); return responder(url, init); },
  });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const filename = path.join(root, file);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    const localRequire = name => name === 'react' ? react : name === 'next/navigation' ? { useRouter: () => router } : name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name);
    vm.runInContext('(function(require,module,exports){' + source + '\n})', context, { filename })(localRequire, module, module.exports);
    modules.set(file, module.exports);
    return module.exports;
  }
  const metadata = load('lib/plugin-install.ts'), onboarding = load('lib/connection-onboarding.ts');
  const { DashboardActions } = load('app/dashboard/dashboard-actions.tsx');
  const hasConnection = options.props?.hasConnection ?? false;
  const generation = options.props?.generation ?? (hasConnection ? 5 : 0);
  const props = { hasConnection, generation, accountId: 'user-a', accountEmail: 'a@example.test', initialStatus: snapshot({ channel: { exists: hasConnection, generation } }), ...options.props };
  const f = {
    metadata, onboarding, requests, copied, location, confirmations, timeouts, intervals, listeners,
    get refreshes() { return refreshes; },
    respond(callback) { responder = callback; },
    confirm(value) { confirm = value; },
    emit(surface, type) { for (const callback of listeners[surface].get(type) || []) callback(); },
    visible(value) { doc.visibilityState = value ? 'visible' : 'hidden'; f.emit('document', 'visibilitychange'); },
    online(value) { nav.onLine = value; },
    advance(milliseconds, tick = true) {
      now += milliseconds;
      if (tick) for (const callback of intervals.values()) callback();
      for (const [id, timer] of timeouts) if (timer.at <= now) { timeouts.delete(id); timer.callback(); }
    },
    async settle() { await new Promise(setImmediate); return f.render(); },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
    pairResponse(overrides = {}) {
      const code = 'ABCD2345';
      return Response.json({ success: true, data: { code, expiresAt: new Date(now + 90_000).toISOString(), deepLink: 'blogautomcp://pair?code=' + code + '&site=' + encodeURIComponent(site), siteUrl: site, generation: 7, ...overrides } });
    },
    statusResponse(value, accountId = props.accountId) { return Response.json({ success: true, accountId, data: value }); },
    render() {
      let panel;
      for (let attempt = 0; attempt < 5; attempt++) {
        hookIndex = 0; dirty = false; panel = DashboardActions(props);
        for (const effect of pendingEffects.splice(0)) effect();
        if (!dirty) return panel;
      }
      throw Error('fixture render did not settle');
    },
    go(step) {
      const button = elements(f.render(), element => element.type === 'button' && element.props['aria-controls'] === 'onboarding-panel-' + step)[0];
      assert.ok(button); button.props.onClick();
    },
    button(label) {
      const button = elements(f.render(), element => element.type === 'button' && content(element) === label)[0];
      assert.ok(button, 'missing button: ' + label); return button;
    },
  };
  return f;
}
function elements(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...[tree.props?.children].flat(Infinity).flatMap(child => elements(child, predicate))];
}
function content(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return [tree.props?.children].flat(Infinity).map(content).join('');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('public URL requires explicit approval and never exposes the private operator identity or credentials', () => {
  const resolve = fixture().metadata.resolvePublicPluginInstallUrl;
  assert.equal(resolve(publicFixtureUrl), null);
  assert.equal(resolve(publicFixtureUrl, 'true'), null);
  assert.equal(resolve(' ' + publicFixtureUrl + ' ', true), publicFixtureUrl);
  for (const value of [privateUrl, '', null, 123, 'javascript:alert(1)', publicFixtureUrl.replace('https:', 'http:'), publicFixtureUrl.replace('chatgpt.com', 'chatgpt.com.evil.example'), publicFixtureUrl.replace('chatgpt.com', 'user:secret@chatgpt.com'), publicFixtureUrl + '?token=secret', publicFixtureUrl + '#secret', publicFixtureUrl + '/', 'https://chatgpt.com/plugins/%70lugin_public_test_fixture']) assert.equal(resolve(value, true), null);
});

test('guided steps show the own account and first PC action, with accessible revisiting and no click-derived completion', async () => {
  const f = fixture();
  const panel = f.render();
  assert.match(content(panel), /a@example.test/);
  assert.match(content(panel), /휴대폰에서 보고 있다면 PC에서 같은 계정/);
  assert.ok(elements(panel, e => e.type === 'a' && e.props.href === '/api/download/windows' && e.props.download).length);
  const steps = elements(panel, e => e.type === 'button' && e.props['aria-controls']);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].props['aria-current'], 'step');
  assert.ok(steps.every(e => content(e).includes('확인 필요')));
  assert.equal(f.button('PC 앱 연결').props.disabled, false);
  f.go('chatgpt');
  const [link] = elements(f.render(), e => e.type === 'a' && e.props.className?.includes('plugin-connect-button'));
  assert.equal(link.props.href, 'https://chatgpt.com/plugins');
  assert.equal(link.props.onClick, undefined);
  assert.match(content(f.render()), /Plugins → \+ → Add custom MCP server/);
  const inputs = elements(f.render(), e => e.type === 'input');
  assert.deepEqual(inputs.map(e => e.props.value), ['BlogAutoMCP', site + '/api/mcp']);
  assert.ok(inputs.every(e => e.props.readOnly));
  assert.equal(f.requests.length, 0);
  assert.ok(elements(f.render(), e => e.props.href === privateUrl).length === 0);
  f.go('verify'); f.go('pc');
  assert.equal(f.button('PC 앱 연결').props.disabled, false);
});

test('default step follows actual PC channel and OAuth status; returning users need no re-pairing', () => {
  for (const [value, expected] of [
    [snapshot(), 'pc'],
    [snapshot({ pc: { paired: true, name: 'old PC' } }), 'pc'],
    [snapshot({ channel: { exists: true, generation: 1 }, pc: { paired: true, name: 'my PC' } }), 'chatgpt'],
    [snapshot({ channel: { exists: true, generation: 1 }, pc: { paired: true, online: true, name: 'my PC' }, mcp: { authorized: true } }), 'verify'],
  ]) {
    const f = fixture({ props: { initialStatus: value } });
    const active = elements(f.render(), e => e.type === 'button' && e.props['aria-current'] === 'step')[0];
    assert.equal(active.props['aria-controls'], 'onboarding-panel-' + expected);
    if (expected === 'verify') {
      assert.ok(elements(f.render(), e => e.type === 'a' && e.props.href === 'https://chatgpt.com/').length);
      assert.doesNotMatch(content(f.render()), /MCP와 PC 응답이 확인되었습니다/);
    }
  }
});

test('public or already-authorized users get collapsed manual setup and a navigation-only main CTA', () => {
  for (const props of [{ publicPluginInstallUrl: publicFixtureUrl }, { initialStatus: snapshot({ channel: { exists: true, generation: 1 }, pc: { paired: true }, mcp: { authorized: true } }) }]) {
    const f = fixture({ props }); f.go('chatgpt');
    const [help] = elements(f.render(), e => e.type === 'details' && content(e).includes('직접 연결 안내'));
    assert.ok(help);
    assert.equal(help.props.open, undefined);
    assert.ok(elements(help, e => e.type === 'input' && e.props.value === 'BlogAutoMCP').length);
    const [link] = elements(f.render(), e => e.type === 'a' && e.props.className?.includes('plugin-connect-button'));
    assert.equal(link.props.onClick, undefined);
    assert.equal(link.props.rel, 'noopener noreferrer');
    assert.equal(f.requests.length, 0);
  }
});

test('URL and natural read-only verification prompt copying handle denial without jobs or credential mutation', async () => {
  for (const denied of [false, true]) {
    const f = fixture({ clipboardDenied: denied });
    f.go('chatgpt'); await f.button('주소 복사').props.onClick(); await f.settle();
    assert.equal(f.copied[0], site + '/api/mcp');
    assert.match(content(f.render()), denied ? /자동 복사가 차단/ : /MCP 주소를 복사/);
    f.go('verify'); await f.button('확인 요청 복사').props.onClick();
    assert.equal(f.copied[1], f.onboarding.CONNECTION_VERIFY_PROMPT);
    assert.match(f.copied[1], /읽기 전용/);
    assert.match(f.copied[1], /같은 작업번호/);
    assert.doesNotMatch(f.copied[1], /agent_get_status|materials_list|job_get|user-a|a@example/);
    assert.match(content(f.render()), denied ? /자동 복사가 차단/ : /확인 요청을 복사/);
    assert.equal(f.requests.length, 0);
  }
});

test('first PC pair request is account-bound, immediately single-flight and recovers after failure without completing steps', async () => {
  const wait = deferred(), f = fixture({ fetch: () => wait.promise });
  const pair = f.button('PC 앱 연결'), first = pair.props.onClick();
  await pair.props.onClick(); await f.button('연결 상태 다시 확인').props.onClick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].headers['x-blogauto-account-id'], 'user-a');
  assert.deepEqual(JSON.parse(f.requests[0].body), {});
  wait.reject(Error('offline')); await first;
  assert.equal(f.button('PC 앱 연결').props.disabled, false);
  f.respond(() => f.pairResponse()); await f.button('PC 앱 연결').props.onClick();
  assert.match(f.location.href, /^blogautomcp:\/\/pair/);
  assert.match(content(f.render()), /코드 발급은 연결 완료가 아닙니다/);
  const progress = elements(f.render(), e => e.type === 'button' && e.props['aria-controls']);
  assert.ok(progress.every(e => content(e).includes('확인 필요')));
  f.advance(90_000);
  assert.match(content(f.render()), /만료되었습니다/);
  assert.equal(f.button('PC 앱 연결').props.disabled, false);
  assert.equal(f.intervals.size, 0);
});

test('expired and malformed pair codes cannot copy, navigate, or retain an action lock', async () => {
  const f = fixture(); f.respond(() => f.pairResponse()); await f.button('PC 앱 연결').props.onClick();
  const copy = f.button('코드 복사'), [open] = elements(f.render(), e => e.type === 'a' && content(e) === '앱 다시 열기');
  f.advance(90_001, false); await copy.props.onClick();
  let prevented = false; open.props.onClick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.copied.length, 0);
  for (const overrides of [{ deepLink: 'javascript:alert(1)' }, { siteUrl: 'https://evil.test' }, { generation: 0 }, { code: 'short' }, { expiresAt: 'invalid' }]) {
    const g = fixture(); g.respond(() => g.pairResponse(overrides)); await g.button('PC 앱 연결').props.onClick();
    assert.equal(g.location.href, ''); assert.equal(g.button('PC 앱 연결').props.disabled, false);
  }
});

test('legacy rotation is inside advanced details, explicitly confirmed and mutually exclusive with pairing', async () => {
  const wait = deferred(), f = fixture({ props: { hasConnection: true, generation: 5 }, confirm: false, fetch: () => wait.promise });
  const details = elements(f.render(), e => e.type === 'details' && content(e).includes('구버전 앱 연결'))[0];
  assert.ok(details); assert.equal(details.props.open, undefined);
  const rotate = f.button('PC 연결 주소 재발급 · 기존 PC 폐기');
  await rotate.props.onClick(); assert.equal(f.requests.length, 0); assert.match(f.confirmations[0], /대기·실행 작업/);
  f.confirm(true); const first = rotate.props.onClick(); await rotate.props.onClick(); await f.button('PC 앱 연결').props.onClick();
  assert.equal(f.requests.length, 1); assert.deepEqual(JSON.parse(f.requests[0].body), { action: 'rotate' });
  assert.equal(f.requests[0].headers['x-blogauto-account-id'], 'user-a');
  wait.resolve(Response.json({ success: false, error: { message: 'cannot rotate' } }, { status: 500 })); await first;
  assert.equal(f.button('PC 연결 주소 재발급 · 기존 PC 폐기').props.disabled, false);
});

test('whole snapshot parser rejects missing, wrong and inconsistent fields rather than false readiness', () => {
  const parse = fixture().onboarding.parseConnectionStatus;
  const ready = snapshot({ channel: { exists: true, generation: 1 }, pc: { paired: true, online: true, roundTripVerified: true, lastVerifiedAt: nowSeed }, mcp: { authorized: true, readVerified: true, lastVerifiedAt: nowSeed }, ready: true });
  assert.equal(parse(ready).ready, true);
  for (const value of [null, [], {}, { ...ready, pc: [] }, { ...ready, naver: {} }, { ...ready, mcp: { ...ready.mcp, lastVerifiedAt: null } }, snapshot({ ready: true }), snapshot({ pc: { online: true } }), snapshot({ channel: { exists: true, generation: 0 } }), snapshot({ naver: { sessionSaved: true } })]) assert.equal(parse(value), null);
});

test('read status is GET-only, replaces full same-account snapshot, advances guidance and preserves state on malformed data', async () => {
  const f = fixture(); f.respond(() => f.statusResponse(snapshot({ channel: { exists: true, generation: 7 }, pc: { paired: true, online: true, name: 'my PC' } })));
  await f.button('연결 상태 다시 확인').props.onClick();
  assert.equal(f.requests[0].method, 'GET'); assert.equal(f.requests[0].cache, 'no-store');
  assert.equal(f.requests[0].headers['x-blogauto-account-id'], 'user-a');
  assert.equal(f.requests[0].body, undefined);
  assert.match(content(f.render()), /2. 내 ChatGPT/);
  assert.equal(f.refreshes, 1);
  f.go('verify');
  f.respond(() => f.statusResponse({ channel: { exists: true, generation: 9 }, ready: true }));
  await f.button('연결 상태 다시 확인').props.onClick();
  assert.match(content(f.render()), /이전 확인 결과를 유지/);
  assert.match(content(f.render()), /my PC/);
  assert.doesNotMatch(content(f.render()), /MCP와 PC 응답이 확인되었습니다/);
  assert.match(content(f.render()), /최근 조회 기준/);
  assert.match(content(f.render()), /KST/);
});

test('same generation preserves issued secrets; changed or absent channel clears stale codes and legacy URLs', async () => {
  for (const kind of ['pair', 'url']) {
    const f = fixture();
    const issueSecret = async () => {
      if (kind === 'pair') { f.respond(() => f.pairResponse()); await f.button('PC 앱 연결').props.onClick(); }
      else { f.respond(() => Response.json({ success: true, data: { mcpUrl: site + '/api/mcp/test.fixture', generation: 7 } })); const button = elements(f.render(), e => e.type === 'button' && /구버전 PC 연결 주소 발급|PC 연결 주소 재발급/.test(content(e)))[0]; await button.props.onClick(); }
    };
    await issueSecret();
    f.respond(() => f.statusResponse(snapshot({ channel: { exists: true, generation: 7 } }))); await f.button('연결 상태 다시 확인').props.onClick();
    assert.match(content(f.render()), kind === 'pair' ? /ABCD2345/ : /ONE-TIME URL/);
    f.respond(() => f.statusResponse(snapshot({ channel: { exists: true, generation: 8 } }))); await f.button('연결 상태 다시 확인').props.onClick();
    assert.doesNotMatch(content(f.render()), /ABCD2345|ONE-TIME URL/);
    await issueSecret();
    f.respond(() => f.statusResponse(snapshot())); await f.button('연결 상태 다시 확인').props.onClick();
    assert.doesNotMatch(content(f.render()), /ABCD2345|ONE-TIME URL/);
  }
});

test('401, 403, account-changed and foreign status all clear secrets and block later mutations', async () => {
  for (const response of [
    () => Response.json({}, { status: 401 }), () => Response.json({}, { status: 403 }),
    () => Response.json({ error: { code: 'ACCOUNT_CHANGED' } }, { status: 409 }),
    () => Response.json({ success: true, accountId: 'user-b', data: snapshot() }),
  ]) {
    const f = fixture(); f.respond(() => f.pairResponse()); await f.button('PC 앱 연결').props.onClick();
    const oldCopy = f.button('코드 복사');
    f.respond(response); await f.button('연결 상태 다시 확인').props.onClick();
    assert.match(content(f.render()), /로그인이 만료되었거나 계정이 변경/);
    assert.doesNotMatch(content(f.render()), /ABCD2345|ONE-TIME URL/);
    await oldCopy.props.onClick(); assert.equal(f.copied.length, 0);
    assert.equal(f.refreshes, 1);
    assert.equal(elements(f.render(), e => e.type === 'button' && content(e) === 'PC 앱 연결').length, 0);
  }
});

test('a new pair response always closes an older legacy URL before adopting its new generation', async () => {
  const f = fixture();
  f.respond(() => Response.json({ success: true, data: { mcpUrl: site + '/api/mcp/old.fixture', generation: 7 } }));
  await f.button('구버전 PC 연결 주소 발급').props.onClick();
  assert.match(content(f.render()), /ONE-TIME URL/);
  f.respond(() => f.pairResponse({ generation: 8 }));
  await f.button('PC 앱 연결').props.onClick();
  assert.match(content(f.render()), /ABCD2345/);
  assert.doesNotMatch(content(f.render()), /ONE-TIME URL|old\.fixture/);
  f.respond(() => f.statusResponse(snapshot({ channel: { exists: true, generation: 8 } })));
  await f.button('연결 상태 다시 확인').props.onClick();
  assert.match(content(f.render()), /ABCD2345/);
  assert.doesNotMatch(content(f.render()), /ONE-TIME URL|old\.fixture/);
});

test('late pair/status replies after unmount cannot navigate or update a new account, even if fetch ignores abort', async () => {
  for (const kind of ['pair', 'status']) {
    const wait = deferred(), f = fixture({ fetch: () => wait.promise });
    const pending = f.button(kind === 'pair' ? 'PC 앱 연결' : '연결 상태 다시 확인').props.onClick();
    f.unmount(); assert.equal(f.requests[0].signal.aborted, true);
    const b = fixture({ props: { accountId: 'user-b', accountEmail: 'b@example.test' } });
    wait.resolve(kind === 'pair' ? f.pairResponse() : f.statusResponse(snapshot({ channel: { exists: true, generation: 9 } })));
    await pending;
    assert.equal(f.location.href, ''); assert.equal(f.refreshes, 0);
    assert.match(content(b.render()), /b@example.test/); assert.doesNotMatch(content(b.render()), /a@example.test|ABCD2345/);
  }
});

test('return-focus refresh is visible, online, single-flight, throttled and removes listeners/timers on unmount', async () => {
  const wait = deferred(), f = fixture({ fetch: () => wait.promise });
  f.render(); assert.equal(f.requests.length, 0);
  f.emit('window', 'focus'); f.emit('document', 'visibilitychange'); f.emit('window', 'focus');
  assert.equal(f.requests.length, 1);
  wait.resolve(f.statusResponse(snapshot())); await f.settle();
  assert.equal(f.refreshes, 0, 'automatic updates do not reload the entire dashboard');
  f.respond(() => f.statusResponse(snapshot()));
  f.advance(14_999); f.emit('window', 'focus'); assert.equal(f.requests.length, 1);
  f.advance(1); f.emit('window', 'focus'); await f.settle(); assert.equal(f.requests.length, 2);
  f.visible(false); f.advance(15_000); f.emit('window', 'focus'); assert.equal(f.requests.length, 2);
  f.online(false); f.visible(true); assert.equal(f.requests.length, 2);
  f.online(true); const pending = deferred(); f.respond(() => pending.promise); f.emit('window', 'focus');
  assert.equal(f.requests.length, 3); f.unmount();
  assert.equal(f.requests[2].signal.aborted, true);
  assert.equal(f.timeouts.size, 0);
  assert.ok([...f.listeners.window.values(), ...f.listeners.document.values()].every(set => set.size === 0));
  f.emit('window', 'focus'); assert.equal(f.requests.length, 3);
  pending.resolve(f.statusResponse(snapshot())); await new Promise(setImmediate);
  assert.equal(f.refreshes, 0);
});

test('verification offers PC/OAuth recovery and does not treat saved Naver cookies as valid login', () => {
  const f = fixture(); f.go('verify');
  assert.ok(f.button('PC 연결 단계로 이동'));
  const g = fixture({ props: { initialStatus: snapshot({ channel: { exists: true, generation: 1 }, pc: { paired: true, online: true, name: 'PC' }, naver: { sessionSaved: true } }) } });
  g.go('verify'); assert.ok(g.button('내 ChatGPT 연결 단계로 이동'));
  assert.match(content(g.render()), /실제 로그인 유효 여부는 네이버 작업에서 확인/);
  assert.doesNotMatch(content(g.render()), /네이버 로그인 완료/);
});

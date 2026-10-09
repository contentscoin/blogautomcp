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

function fixture(options = {}) {
  const hooks = [];
  const pendingEffects = [];
  const intervals = new Map();
  const requests = [];
  const copied = [];
  const confirmations = [];
  let hookIndex = 0;
  let dirty = false;
  let intervalId = 0;
  let refreshes = 0;
  let now = Date.parse('2026-10-09T01:00:00Z');
  let responder = options.fetch || (() => { throw Error('unexpected request'); });
  let confirm = options.confirm ?? true;
  const location = { href: '' };
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
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(callback, dependencies) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          hooks[index] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    URL, Error, Date: Clock,
    navigator: { clipboard: { async writeText(value) { copied.push(value); if (options.clipboardDenied) throw Error('permission denied'); } } },
    window: {
      location,
      confirm(message) { confirmations.push(message); return confirm; },
      setInterval(callback) { intervals.set(++intervalId, callback); return intervalId; },
      clearInterval(id) { intervals.delete(id); },
    },
    fetch: async (url, init) => { requests.push({ url, ...init }); return responder(url, init); },
  });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const filename = path.join(root, file);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    const localRequire = name => name === 'react' ? react : name === 'next/navigation' ? { useRouter: () => ({ refresh() { refreshes++; } }) } : name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name);
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports);
    modules.set(file, module.exports);
    return module.exports;
  }
  const metadata = load('lib/plugin-install.ts');
  const { DashboardActions } = load('app/dashboard/dashboard-actions.tsx');
  const props = { hasConnection: false, generation: 0, ...options.props };
  const f = {
    metadata, requests, copied, location, confirmations,
    get refreshes() { return refreshes; },
    respond(callback) { responder = callback; },
    confirm(value) { confirm = value; },
    advance(milliseconds, tick = true) { now += milliseconds; if (tick) for (const callback of intervals.values()) callback(); },
    pairResponse(overrides = {}) {
      const code = 'ABCD2345';
      return Response.json({ success: true, data: { code, expiresAt: new Date(now + 90_000).toISOString(), deepLink: `blogautomcp://pair?code=${code}&site=${encodeURIComponent(site)}`, siteUrl: site, generation: 7, ...overrides } });
    },
    render() {
      let panel;
      for (let attempt = 0; attempt < 5; attempt++) {
        hookIndex = 0; dirty = false;
        panel = DashboardActions(props);
        for (const effect of pendingEffects.splice(0)) effect();
        if (!dirty) return panel;
      }
      throw Error('fixture render did not settle');
    },
    button(label) {
      const button = elements(f.render(), element => element.type === 'button' && content(element) === label)[0];
      assert.ok(button, `missing button: ${label}`);
      return button;
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

test('public install config requires explicit approval and rejects private identity and unsafe URLs', () => {
  const { resolvePublicPluginInstallUrl: resolve } = fixture().metadata;
  assert.equal(resolve(publicFixtureUrl), null);
  assert.equal(resolve(publicFixtureUrl, false), null);
  assert.equal(resolve(publicFixtureUrl, 'true'), null);
  assert.equal(resolve(` ${publicFixtureUrl} `, true), publicFixtureUrl);
  for (const value of [privateUrl, '', null, 123, 'javascript:alert(1)', publicFixtureUrl.replace('https:', 'http:'), publicFixtureUrl.replace('chatgpt.com', 'chatgpt.com.evil.example'), publicFixtureUrl.replace('chatgpt.com', 'user:secret@chatgpt.com'), `${publicFixtureUrl}?token=secret`, `${publicFixtureUrl}#secret`, `${publicFixtureUrl}/`, 'https://chatgpt.com/plugins', 'https://chatgpt.com/plugins/%70lugin_public_test_fixture']) assert.equal(resolve(value, true), null, String(value));
});

test('default onboarding begins with PC pairing and gives honest custom MCP guidance without private install CTA', () => {
  for (const hasConnection of [false, true]) {
    const f = fixture({ props: { hasConnection, generation: hasConnection ? 5 : 0 } });
    const panel = f.render();
    const cards = elements(panel, element => element.type === 'article');
    assert.match(content(cards[0]), /^1 · DESKTOP PAIRINGPC 앱 연결/);
    assert.match(content(cards[1]), /Plugins → \+ → Add custom MCP server/);
    assert.match(content(cards[1]), /인증 방식은 OAuth/);
    assert.match(content(cards[1]), /메뉴가 없으면 계정·워크스페이스/);
    assert.match(content(cards[1]), /본인의 계정/);
    assert.match(content(cards[2]), /materials_list\(connectKind: 'shopping'\)/);
    assert.equal(elements(panel, element => element.type === 'a' && element.props.className?.includes('plugin-connect-button')).length, 0);
    assert.equal(elements(panel, element => typeof element.props?.href === 'string' && element.props.href === privateUrl).length, 0);
    assert.equal(f.button('PC 앱 연결').props.disabled, false);
    assert.equal(f.requests.length, 0);
  }
});

test('only a validated server-supplied public install link becomes a navigation-only CTA', () => {
  for (const value of [privateUrl, 'javascript:alert(1)', `${publicFixtureUrl}?credential=secret`, null]) {
    const f = fixture({ props: { publicPluginInstallUrl: value } });
    assert.equal(elements(f.render(), element => element.props.className?.includes('plugin-connect-button')).length, 0);
  }
  const f = fixture({ props: { publicPluginInstallUrl: publicFixtureUrl } });
  const [install] = elements(f.render(), element => element.props.className?.includes('plugin-connect-button'));
  assert.equal(install.props.href, publicFixtureUrl);
  assert.equal(install.props.target, '_blank');
  assert.equal(install.props.rel, 'noopener noreferrer');
  assert.equal(install.props.onClick, undefined);
  assert.equal(f.requests.length, 0);
  assert.doesNotMatch(content(install), /설치 완료|연결 완료/);
});

test('OAuth URL copy succeeds or reports clipboard denial without credential mutation or completion claims', async () => {
  for (const clipboardDenied of [false, true]) {
    const f = fixture({ clipboardDenied });
    await f.button('주소 복사').props.onClick();
    assert.deepEqual(f.copied, [`${site}/api/mcp`]);
    assert.equal(f.requests.length, 0);
    assert.equal(f.location.href, '');
    const pluginCard = elements(f.render(), element => element.type === 'article')[1];
    assert.match(content(pluginCard), clipboardDenied ? /자동 복사가 차단되었습니다/ : /ChatGPT용 MCP 주소를 복사했습니다/);
    assert.doesNotMatch(content(pluginCard), /설치 완료|연결 완료/);
  }
});

test('missing-channel PC pairing sends one request despite immediate doubleclick and recovers after failure', async () => {
  const wait = deferred();
  const f = fixture({ fetch: () => wait.promise });
  const pair = f.button('PC 앱 연결');
  const first = pair.props.onClick();
  await pair.props.onClick();
  await f.button('연결 상태 다시 확인').props.onClick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/device/pair-code');
  assert.equal(f.requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(f.requests[0].body), {});
  assert.equal(f.button('코드 발급 중…').props.disabled, true);
  wait.reject(Error('offline'));
  await first;
  assert.match(content(f.render()), /offline/);
  assert.equal(f.button('PC 앱 연결').props.disabled, false);
  f.respond(() => f.pairResponse());
  await f.button('PC 앱 연결').props.onClick();
  assert.equal(f.requests.length, 2);
  assert.equal(f.location.href, `blogautomcp://pair?code=ABCD2345&site=${encodeURIComponent(site)}`);
  assert.match(content(f.render()), /PC 앱에서 연결을 마친 뒤 연결 상태를 확인/);
  assert.equal(f.confirmations.length, 0, 'issuing a pair code does not rotate the PC channel');
  f.advance(90_000);
  assert.match(content(f.render()), /G7/);
  assert.match(content(f.render()), /코드가 만료되었습니다/);
  assert.equal(f.button('PC 앱 연결').props.disabled, false);
});

test('expired pair code cannot be copied or reopened even before the timer rerenders', async () => {
  const f = fixture();
  f.respond(() => f.pairResponse());
  await f.button('PC 앱 연결').props.onClick();
  const copy = f.button('코드 복사');
  const [open] = elements(f.render(), element => element.type === 'a' && content(element) === '앱 다시 열기');
  f.advance(90_001, false);
  await copy.props.onClick();
  let prevented = false;
  open.props.onClick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.copied.length, 0);
  assert.match(content(f.render()), /코드가 만료되었습니다/);
});

test('malformed, expired or foreign pair responses cannot navigate and release the action lock', async () => {
  for (const overrides of [{ deepLink: 'javascript:alert(1)' }, { siteUrl: 'https://evil.example' }, { generation: 0 }, { generation: '7' }, { code: 'short' }, { expiresAt: 'invalid' }, { expiresAt: '2026-10-08T01:00:00Z' }, { deepLink: `blogautomcp://pair?code=ABCD2345&site=${encodeURIComponent(site)}&token=secret` }]) {
    const f = fixture();
    f.respond(() => f.pairResponse(overrides));
    await f.button('PC 앱 연결').props.onClick();
    assert.equal(f.location.href, '');
    assert.equal(f.button('PC 앱 연결').props.disabled, false);
    assert.match(content(f.render()), /발급 응답을 확인하지 못했습니다/);
  }
});

test('legacy rotation stays advanced, needs explicit confirmation and prevents overlapping submissions', async () => {
  const wait = deferred();
  const f = fixture({ props: { hasConnection: true, generation: 5 }, confirm: false, fetch: () => wait.promise });
  assert.equal(elements(f.render(), element => element.type === 'button' && content(element).includes('재발급 ·')).length, 0);
  f.button('구버전 앱: PC 연결 주소로 연결').props.onClick();
  const rotate = f.button('PC 연결 주소 재발급 · 기존 PC 폐기');
  await rotate.props.onClick();
  assert.equal(f.requests.length, 0);
  assert.match(f.confirmations[0], /대기·실행 작업이 취소/);
  f.confirm(true);
  const first = rotate.props.onClick();
  await rotate.props.onClick();
  await f.button('PC 앱 연결').props.onClick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/mcp-connections');
  assert.deepEqual(JSON.parse(f.requests[0].body), { action: 'rotate' });
  wait.resolve(Response.json({ success: false, error: { message: 'cannot rotate' } }, { status: 500 }));
  await first;
  assert.equal(f.button('PC 연결 주소 재발급 · 기존 PC 폐기').props.disabled, false);
  assert.match(content(f.render()), /cannot rotate/);
});

test('a stale advanced handler still confirms rotation after initial pairing created the channel', async () => {
  const f = fixture({ confirm: false });
  f.button('구버전 앱: PC 연결 주소로 연결').props.onClick();
  const issue = f.button('구버전 PC 연결 주소 발급');
  f.respond(() => f.pairResponse());
  await f.button('PC 앱 연결').props.onClick();
  await issue.props.onClick();
  assert.equal(f.confirmations.length, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/device/pair-code');
});

test('status refresh is GET-only, blocks overlaps and recovers from errors without declaring readiness', async () => {
  const wait = deferred();
  const f = fixture({ fetch: () => wait.promise });
  const refresh = f.button('연결 상태 다시 확인');
  const first = refresh.props.onClick();
  await refresh.props.onClick();
  await f.button('PC 앱 연결').props.onClick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/connection-status');
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].cache, 'no-store');
  assert.equal(f.requests[0].body, undefined);
  wait.resolve(Response.json({ success: false, error: { message: 'temporarily unavailable' } }, { status: 503 }));
  await first;
  assert.equal(f.refreshes, 0);
  assert.equal(f.button('연결 상태 다시 확인').props.disabled, false);
  assert.match(content(f.render()), /temporarily unavailable/);
  f.respond(() => Response.json({ success: true, data: { channel: { exists: true, generation: 8 }, mcp: { authorized: true, readVerified: false, lastVerifiedAt: null }, pc: { paired: true, online: true, name: 'fixture', roundTripVerified: false, lastVerifiedAt: null }, naver: { sessionSaved: null }, ready: false } }));
  await f.button('연결 상태 다시 확인').props.onClick();
  assert.equal(f.refreshes, 1);
  assert.match(content(f.render()), /G8/);
  assert.match(content(f.render()), /서버에서 연결 상태를 새로 확인했습니다/);
  assert.doesNotMatch(content(f.render()), /연결 확인 완료|사용 준비 완료/);
  assert.ok(f.requests.every(request => request.method === 'GET'));
});

test('malformed status response cannot refresh the evidence or mark a PC channel present', async () => {
  const f = fixture({ fetch: () => Response.json({ success: true, data: { channel: { exists: true, generation: 3 } } }) });
  await f.button('연결 상태 다시 확인').props.onClick();
  assert.equal(f.refreshes, 0);
  assert.match(content(f.render()), /연결 상태 응답을 확인하지 못했습니다/);
  assert.match(content(f.render()), /NEW/);
});

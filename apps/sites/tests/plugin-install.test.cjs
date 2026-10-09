const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function fixture() {
  const states = [];
  let stateIndex = 0;
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect() {},
  };
  function load(file) {
    const filename = path.join(root, file);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    const localRequire = name => name === 'react' ? react : name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : require(name);
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  const metadata = load('lib/plugin-install.ts');
  const { DashboardActions } = load('app/dashboard/dashboard-actions.tsx');
  return {
    metadata,
    render(hasConnection = false) {
      stateIndex = 0;
      return DashboardActions({ hasConnection, generation: hasConnection ? 5 : 0 });
    },
  };
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

function restoreGlobals(descriptors) {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

test('plugin install uses the existing official identity without credentials or desktop-derived completion', () => {
  for (const hasConnection of [false, true]) {
    const f = fixture();
    const panel = f.render(hasConnection);
    const [install] = elements(panel, element => element.type === 'a' && element.props.className?.includes('plugin-connect-button'));
    assert.ok(install);
    assert.equal(install.props.href, 'https://chatgpt.com/plugins/plugin_asdk_app_sites_a4ba33aa14088191b648c875a67bb5ea');
    assert.equal(install.props.target, '_blank');
    assert.equal(install.props.rel, 'noopener noreferrer');
    assert.equal(install.props.onClick, undefined, 'navigation must not issue or rotate a PC credential');
    assert.equal(new URL(install.props.href).search, '');
    assert.equal(new URL(install.props.href).hash, '');
    assert.match(content(install), /ChatGPT 플러그인 설치·연결/);
    const [pluginCard] = elements(panel, element => element.type === 'article');
    assert.match(content(pluginCard), /ChatGPT에서 설치 확인과 계정 인증을 마무리/);
    assert.match(content(pluginCard), /이미 설치했다면 같은 화면/);
    assert.doesNotMatch(content(pluginCard), /설치 완료|자동 설치|연결됨/);
  }
});

test('access guidance separates the plugin owner fallback from user permissions', () => {
  const panel = fixture().render();
  const [help] = elements(panel, element => element.type === 'details' && content(element).includes('설치 화면이 열리지 않나요?'));
  assert.match(content(help), /사이트 관리자에게 플러그인 사용 권한 또는 워크스페이스 연결/);
  assert.match(content(help), /플러그인을 만든 계정은 ChatGPT의 Plugins → Personal → Created by you/);
});

test('manual OAuth copying shows success and denial in the plugin card without touching the PC channel', async () => {
  const descriptors = Object.fromEntries(['navigator', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let requests = 0;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { requests++; throw Error('must not issue a PC channel'); } });
  try {
    for (const denied of [false, true]) {
      let copied;
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(value) { copied = value; if (denied) throw Error('permission denied'); } } } });
      const f = fixture();
      const [copy] = elements(f.render(), element => element.type === 'button' && content(element) === '주소 복사');
      await copy.props.onClick();
      assert.equal(copied, f.metadata.BLOGAUTO_OAUTH_MCP_URL);
      const [pluginCard] = elements(f.render(), element => element.type === 'article');
      const [status] = elements(pluginCard, element => element.props?.role === 'status');
      assert.match(content(status), denied ? /자동 복사가 차단되었습니다/ : /ChatGPT용 MCP 주소를 복사했습니다/);
      assert.equal(requests, 0);
    }
  } finally {
    restoreGlobals(descriptors);
  }
});

test('PC pairing remains a separate explicit action and is unavailable before PC channel issuance', async () => {
  const descriptors = Object.fromEntries(['window', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const requests = [];
  const location = { href: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, init) => {
    requests.push({ url, method: init.method, body: JSON.parse(init.body) });
    return Response.json({ success: true, data: { code: '123456', expiresAt: '2026-10-09T01:05:00Z', deepLink: 'brandconnect://pair?code=123456', siteUrl: 'https://blogautomcp.hiway350051.chatgpt.site' } });
  } });
  try {
    const [unavailable] = elements(fixture().render(false), element => element.type === 'button' && content(element) === '먼저 아래에서 PC 연결 주소를 발급하세요');
    assert.equal(unavailable.props.disabled, true);
    const [pair] = elements(fixture().render(true), element => element.type === 'button' && content(element) === 'PC 앱 연결');
    assert.equal(pair.props.disabled, false);
    assert.equal(requests.length, 0);
    await pair.props.onClick();
    assert.deepEqual(requests, [{ url: '/api/device/pair-code', method: 'POST', body: {} }]);
    assert.equal(location.href, 'brandconnect://pair?code=123456');
  } finally {
    restoreGlobals(descriptors);
  }
});

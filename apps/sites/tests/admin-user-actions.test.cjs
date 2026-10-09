const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function user(id, status = 'PENDING_APPROVAL', role = 'USER') {
  return { id, email: `${id}@fixture.invalid`, displayName: id, role, status,
    createdAt: 0, updatedAt: 0, deviceName: null, deviceLastSeenAt: null };
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

function fixture(initialUsers = [user('A'), user('B')]) {
  const hooks = [];
  const requests = [];
  let hookIndex = 0;
  const react = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
  };
  const filename = path.join(__dirname, '../app/admin/users-client.tsx');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => name === 'react' ? react : require(name),
    fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, body: JSON.parse(init.body), resolve, reject })),
  }, { filename });
  const render = () => {
    hookIndex = 0;
    return module.exports.AdminUsers({ initialUsers });
  };
  const row = (id, tree = render()) => elements(tree, element => element.props?.className === 'admin-row' && content(element).includes(`${id}@fixture.invalid`))[0];
  const button = (id, label, tree) => elements(row(id, tree), element => element.type === 'button' && content(element) === label)[0];
  const reply = (index, status = 200, payload) => {
    const request = requests[index];
    const id = decodeURIComponent(request.url.split('/').at(-2));
    request.resolve(Response.json(payload || { success: true, data: { id, status: request.body.status } }, { status }));
  };
  return { requests, render, row, button, reply };
}

test('another row cannot unlock a pending approval or admit its stale rejection handler', async () => {
  const f = fixture();
  const initial = f.render();
  const oldReject = f.button('A', '거절', initial).props.onClick;
  const pendingA = f.button('A', '승인', initial).props.onClick();
  assert.equal(f.button('A', '거절').props.disabled, true);
  assert.equal(f.button('B', '승인').props.disabled, false);
  const pendingB = f.button('B', '승인').props.onClick();
  assert.equal(f.button('A', '거절').props.disabled, true, 'B must not replace A in the pending set');
  await oldReject();
  assert.equal(f.requests.length, 2, 'an old A handler cannot create a competing status request');
  f.reply(1);
  await pendingB;
  assert.equal(f.button('A', '거절').props.disabled, true, 'B completion must leave A locked');
  assert.equal(f.button('B', '거절').props.disabled, false);
  f.reply(0);
  await pendingA;
  assert.equal(f.button('A', '승인').props.disabled, true);
  assert.equal(f.button('A', '거절').props.disabled, false);
  assert.match(content(f.row('A')), /승인됨/);
});

test('an immediate duplicate click is blocked before React rerenders', async () => {
  const f = fixture();
  const approve = f.button('A', '승인', f.render()).props.onClick;
  const pending = approve();
  await approve();
  assert.equal(f.requests.length, 1);
  f.reply(0);
  await pending;
  // This handler still carries the original render, but the confirmed status is current.
  await approve();
  assert.equal(f.requests.length, 1, 'a stale same-status handler must not resend the successful change');
  const reject = f.button('A', '거절').props.onClick();
  assert.equal(f.requests.length, 2, 'a new explicit status change remains available');
  f.reply(1);
  await reject;
  assert.match(content(f.row('A')), /거절/);
});

test('network, HTTP, JSON and mismatched acknowledgements release only the failed row and permit retry', async () => {
  for (const failure of ['network', 'http', 'json', 'wrong-user', 'wrong-status', 'unsuccessful']) {
    const f = fixture();
    const pendingA = f.button('A', '승인').props.onClick();
    const pendingB = f.button('B', '승인').props.onClick();
    if (failure === 'network') f.requests[0].reject(new Error('fixture connection lost'));
    else if (failure === 'http') f.reply(0, 503, { success: false, error: { message: 'fixture denied' } });
    else if (failure === 'json') f.requests[0].resolve(new Response('<html>unavailable</html>', { status: 503 }));
    else if (failure === 'wrong-user') f.reply(0, 200, { success: true, data: { id: 'B', status: 'APPROVED' } });
    else if (failure === 'wrong-status') f.reply(0, 200, { success: true, data: { id: 'A', status: 'REJECTED' } });
    else f.reply(0, 200, { success: false, error: { message: 'fixture unsuccessful' } });
    await pendingA;
    assert.equal(f.button('A', '승인').props.disabled, false, `${failure}: failed row unlocks`);
    assert.equal(f.button('B', '거절').props.disabled, true, `${failure}: unrelated row stays locked`);
    assert.match(content(f.row('A')), /대기/, `${failure}: no unconfirmed optimistic status`);
    assert.equal(elements(f.render(), element => element.props?.role === 'status').length, 1);
    const retry = f.button('A', '승인').props.onClick();
    assert.equal(f.requests.length, 3);
    f.reply(2);
    await retry;
    f.reply(1);
    await pendingB;
    assert.match(content(f.row('A')), /승인됨/);
    assert.match(content(f.row('B')), /승인됨/);
  }
});

test('confirmed current status buttons and owner account remain immutable', () => {
  const f = fixture([user('A', 'APPROVED'), user('B', 'REJECTED'), user('C', 'SUSPENDED'), user('owner', 'APPROVED', 'ADMIN')]);
  assert.equal(f.button('A', '승인').props.disabled, true);
  assert.equal(f.button('B', '거절').props.disabled, true);
  assert.equal(f.button('C', '정지').props.disabled, true);
  assert.equal(f.button('A', '정지').props.disabled, false);
  assert.equal(elements(f.row('owner'), element => element.type === 'button').length, 0);
  assert.match(content(f.row('owner')), /OWNER/);
  assert.equal(f.requests.length, 0);
});

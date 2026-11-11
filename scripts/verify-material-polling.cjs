/* eslint-disable @typescript-eslint/no-require-imports -- Offline deterministic polling fixture. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { loadClientDisplay } = require('./lib/client-display-fixture.cjs');
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fixture({ hidden = false, activeIntervalMs = 4000, electron = false } = {}) {
  let now = 0, serial = 0;
  const timers = new Map(), listeners = new Set(), requests = [], errors = [];
  const visibility = { hidden, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const desktopListeners = new Set();
  const desktop = { addEventListener: (_name, fn) => desktopListeners.add(fn), removeEventListener: (_name, fn) => desktopListeners.delete(fn),
    dispatchEvent() { for (const fn of desktopListeners) fn(); } };
  const { startMaterialPolling } = loadClientDisplay('src/lib/material-polling.ts', () => {}, {
    AbortController, setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const controller = startMaterialPolling({ visibility, activeIntervalMs, desktopVisibility: electron ? desktop : undefined,
    requireDesktopVisibility: electron, onError: error => errors.push(error), poll: signal => new Promise((resolve, reject) => {
    requests.push({ signal, resolve, reject });
  }) });
  return { controller, requests, timers, errors, listeners, desktop, desktopListeners,
    desktopVisible(visible) { desktop.__brandconnectMaterialUiVisible = visible; desktop.dispatchEvent(); },
    visibility(hidden) { visibility.hidden = hidden; for (const fn of listeners) fn(); },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await settle(); },
  };
}
test('slow GETs cannot overlap and active cadence begins only after completion', async () => {
  for (const interval of [4000, 5000]) {
    const f = fixture({ activeIntervalMs: interval }); await settle();
    assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 1, 'only a request deadline while GET is pending');
    await f.advance(10000); assert.equal(f.requests.length, 1);
    f.requests[0].resolve(true); await settle();
    await f.advance(interval - 1); assert.equal(f.requests.length, 1);
    await f.advance(1); assert.equal(f.requests.length, 2);
    assert.equal(f.timers.size, 1, 'only next request deadline'); f.controller.stop();
  }
});
test('idle cadence is 30 seconds and active work discovered on next response restores fast cadence', async () => {
  const f = fixture(); await settle(); f.requests[0].resolve(false); await settle();
  await f.advance(29999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(true); await settle(); await f.advance(4000); assert.equal(f.requests.length, 3);
  f.controller.stop();
});
test('hidden starts do not GET; showing starts once and hides clear scheduled polls', async () => {
  const f = fixture({ hidden: true }); await settle(); await f.advance(120000); assert.equal(f.requests.length, 0);
  f.visibility(false); f.visibility(false); await settle(); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(false); await settle(); assert.equal(f.timers.size, 1);
  f.visibility(true); assert.equal(f.timers.size, 0); await f.advance(120000); assert.equal(f.requests.length, 1);
  f.visibility(false); await settle(); assert.equal(f.requests.length, 2); f.controller.stop();
});
test('hide aborts pending GET and a quick show starts exactly one fresh request even if the old fetch ignores abort', async () => {
  const f = fixture(); await settle(); f.visibility(true);
  assert.equal(f.requests[0].signal.aborted, true);
  f.visibility(false); f.visibility(false); await settle(); assert.equal(f.requests.length, 2);
  f.requests[0].resolve(true); await settle(); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].signal.aborted, false); assert.equal(f.errors.length, 0);
  f.controller.stop();
});
test('post-action refresh waits for an old poll then reads a fresh response instead of reusing it', async () => {
  const f = fixture(); await settle(); let refreshed = false;
  const refresh = f.controller.refresh().then(() => { refreshed = true; });
  await settle(); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(false); await settle(); assert.equal(f.requests.length, 2); assert.equal(refreshed, false);
  f.requests[1].resolve(true); await refresh;
  assert.equal(refreshed, true); assert.equal(f.timers.size, 1);
  await f.advance(4000); assert.equal(f.requests.length, 3); f.controller.stop();
});
test('rapid visibility toggles coalesce resume waiters into one fresh GET', async () => {
  const f = fixture(); await settle();
  f.visibility(true); f.visibility(false); f.visibility(true); f.visibility(false);
  await settle(); assert.equal(f.requests.length, 2);
  f.requests[0].resolve(true); f.requests[1].resolve(false); await settle();
  assert.equal(f.requests.length, 2, 'older resume waiters cannot queue another GET');
  await f.advance(30000); assert.equal(f.requests.length, 3); f.controller.stop();
});
test('failed polling retains cadence, reports once and allows post-action fresh recovery', async () => {
  const f = fixture(); await settle(); const refresh = f.controller.refresh();
  f.requests[0].reject(new Error('read failed')); await settle();
  assert.equal(f.errors.length, 1); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(false); await refresh; await f.advance(30000);
  assert.equal(f.requests.length, 3); f.controller.stop();
});
test('unmount aborts pending GET, clears listeners/timers and discards late completion/resume', async () => {
  const f = fixture(); await settle(); const refresh = f.controller.refresh();
  f.controller.stop(); assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.listeners.size, 0);
  f.requests[0].resolve(true); await refresh; f.visibility(false); await f.advance(120000);
  assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.errors.length, 0);
});
test('effect cleanup before its initial microtask starts sends no GET', async () => {
  const f = fixture(); f.controller.stop(); await settle(); assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 0);
});
test('30 second deadline aborts a permanently hung request, cleans up and resumes without stale completion', async () => {
  const f = fixture(); await settle(); await f.advance(30000);
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.errors.length, 1);
  assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 1);
  await f.advance(30000); assert.equal(f.requests.length, 2);
  f.requests[0].resolve(true); f.requests[1].resolve(false); await settle();
  await f.advance(4000); assert.equal(f.requests.length, 2, 'late old active verdict cannot replace idle cadence');
  await f.advance(26000); assert.equal(f.requests.length, 3); f.controller.stop();
});
test('hide/unmount cleans up deadline and Electron native hint controls actual hidden state with document.hidden=false', async () => {
  const f = fixture({ electron: true }); await settle();
  assert.equal(f.requests.length, 0, 'initial Electron visibility is unknown until native hint arrives');
  f.desktopVisible(false); await settle(); assert.equal(f.requests.length, 0, 'show:false starts remain idle');
  f.desktopVisible(true); f.desktopVisible(true); await settle(); assert.equal(f.requests.length, 1);
  f.desktopVisible(false); await settle(); assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.timers.size, 0); await f.advance(120000); assert.equal(f.requests.length, 1); assert.equal(f.errors.length, 0);
  f.desktopVisible(true); await settle(); assert.equal(f.requests.length, 2);
  f.controller.stop(); await settle(); assert.equal(f.desktopListeners.size, 0); assert.equal(f.timers.size, 0);
});
test('actual Electron bridge publishes native show/hide/minimize/restore/load state and ignores out-of-order hints', async () => {
  const source = fs.readFileSync('scripts/electron/main.cjs', 'utf8').replace(/\r\n/g, '\n');
  const bridge = source.match(/function installMaterialUiVisibilityBridge\([^)]*\) \{[\s\S]*?\n\}/)[0];
  assert.match(source, /backgroundThrottling: false/);
  assert.match(source, /installMaterialUiVisibilityBridge\(browserWindow\)/);
  const f = fixture({ electron: true });
  const window = new EventEmitter(), contents = new EventEmitter(), scripts = [];
  let visible = false, minimized = false, destroyed = false;
  window.isDestroyed = () => destroyed; window.isVisible = () => visible; window.isMinimized = () => minimized;
  contents.isDestroyed = () => destroyed; contents.executeJavaScript = script => { scripts.push(script); return Promise.resolve(); };
  window.webContents = contents;
  vm.runInNewContext(`${bridge}; installMaterialUiVisibilityBridge(browserWindow);`, { browserWindow: window });
  const apply = script => vm.runInNewContext(script, { window: f.desktop, Event: class {} });
  contents.emit('did-finish-load'); apply(scripts.pop()); await settle(); assert.equal(f.requests.length, 0);
  visible = true; window.emit('show'); const oldShow = scripts.pop();
  visible = false; window.emit('hide'); apply(scripts.pop()); apply(oldShow); await settle();
  assert.equal(f.requests.length, 0, 'delayed show cannot revive a newer hide');
  visible = true; window.emit('show'); apply(scripts.pop()); await settle(); assert.equal(f.requests.length, 1);
  minimized = true; window.emit('minimize'); apply(scripts.pop()); await settle(); assert.equal(f.requests[0].signal.aborted, true);
  minimized = false; window.emit('restore'); apply(scripts.pop()); await settle(); assert.equal(f.requests.length, 2);
  contents.emit('did-finish-load'); apply(scripts.pop()); await settle(); assert.equal(f.requests.length, 2, 'reload/duplicate hint does not duplicate a live request');
  destroyed = true; window.emit('hide'); assert.equal(scripts.length, 0); f.controller.stop();
});

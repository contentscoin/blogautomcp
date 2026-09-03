import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopAutoUpdater, updateOrigin } = require('./electron/auto-update.cjs');

const environmentKeys = [
  'AUTO_UPDATE_ALLOW_LOCAL_HTTP',
  'AUTO_UPDATE_CHECK_INTERVAL_MS',
  'AUTO_UPDATE_DOWNLOAD',
  'AUTO_UPDATE_FORCE',
  'AUTO_UPDATE_INSTALL',
  'AUTO_UPDATE_IDLE_CONFIRM_MS',
  'AUTO_UPDATE_IDLE_RECHECK_MS',
  'AUTO_UPDATE_INSTALL_DELAY_MS',
  'AUTO_UPDATE_START_DELAY_MS',
  'AUTO_UPDATE_TEST_MODE',
  'DESKTOP_UPDATE_ERROR',
  'DESKTOP_UPDATE_INSTALL_PENDING',
  'DESKTOP_UPDATE_PROGRESS',
  'DESKTOP_UPDATE_STATUS',
  'DESKTOP_UPDATE_VERSION',
  'REMOTE_DEVICE_TOKEN',
  'REMOTE_SITE_URL',
];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'blogautomcp-updater-test-'));
let manager;

function restoreEnvironment() {
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

class FakeNsisUpdater extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.checkCount = 0;
    this.installArguments = null;
    FakeNsisUpdater.instances.push(this);
  }

  async checkForUpdates() {
    this.checkCount += 1;
    this.emit('checking-for-update');
    this.emit('update-available', { version: '1.1.1' });
    return { updateInfo: { version: '1.1.1' } };
  }

  quitAndInstall(...args) {
    this.installArguments = args;
  }
}

class FakeNotification {
  static shown = [];

  static isSupported() {
    return true;
  }

  constructor(options) {
    this.options = options;
  }

  show() {
    FakeNotification.shown.push(this.options);
  }
}

try {
  delete process.env.AUTO_UPDATE_ALLOW_LOCAL_HTTP;
  assert.equal(updateOrigin('https://updates.example.test/path'), 'https://updates.example.test');
  assert.equal(updateOrigin('http://updates.example.test/path'), null);
  assert.equal(updateOrigin('http://127.0.0.1:43130/path'), null);
  process.env.AUTO_UPDATE_ALLOW_LOCAL_HTTP = '1';
  assert.equal(updateOrigin('http://127.0.0.1:43130/path'), 'http://127.0.0.1:43130');
  assert.equal(updateOrigin('not-a-url'), null);

  process.env.AUTO_UPDATE_FORCE = '1';
  process.env.AUTO_UPDATE_TEST_MODE = '1';
  process.env.AUTO_UPDATE_DOWNLOAD = 'false';
  process.env.AUTO_UPDATE_START_DELAY_MS = '10';
  process.env.AUTO_UPDATE_CHECK_INTERVAL_MS = '1000';
  process.env.AUTO_UPDATE_INSTALL_DELAY_MS = '10';
  process.env.AUTO_UPDATE_IDLE_RECHECK_MS = '10';
  process.env.AUTO_UPDATE_IDLE_CONFIRM_MS = '10';
  process.env.REMOTE_SITE_URL = 'https://updates.example.test/dashboard';
  process.env.REMOTE_DEVICE_TOKEN = 'A'.repeat(43);

  let readinessChecks = 0;
  let preparedForInstall = false;
  manager = createDesktopAutoUpdater({
    app: { getVersion: () => '1.1.0', isPackaged: true },
    Notification: FakeNotification,
    NsisUpdater: FakeNsisUpdater,
    userDataDir: temporaryDirectory,
    getReadiness: async () => {
      readinessChecks += 1;
      return { ready: readinessChecks > 1 };
    },
    beforeInstall: async () => {
      preparedForInstall = true;
    },
  });

  manager.start();
  await waitFor(() => FakeNsisUpdater.instances[0]?.checkCount > 0, '시작 직후 업데이트 확인이 실행되지 않았습니다.');
  const updater = FakeNsisUpdater.instances[0];
  assert.equal(updater.options.provider, 'generic');
  assert.equal(updater.options.url, 'https://updates.example.test/api/updates/windows/');
  assert.equal(updater.options.useMultipleRangeRequest, false);
  assert.equal(updater.options.requestHeaders.authorization, `Bearer ${'A'.repeat(43)}`);
  assert.equal(updater.requestHeaders.authorization, `Bearer ${'A'.repeat(43)}`);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(manager.getState().status, 'available');

  updater.emit('error', new Error(`device token ${'A'.repeat(43)}`));
  assert.ok(!manager.getState().error.includes('A'.repeat(43)));
  updater.logger.info(`authorization Bearer ${'A'.repeat(43)}`);
  updater.emit('update-downloaded', { version: '1.1.1' });
  assert.equal(process.env.DESKTOP_UPDATE_INSTALL_PENDING, '1');
  await waitFor(() => updater.installArguments !== null, '유휴 상태에서 자동 설치가 시작되지 않았습니다.');
  assert.equal(readinessChecks, 3);
  assert.equal(preparedForInstall, true);
  assert.deepEqual(updater.installArguments, [true, true]);
  assert.equal(manager.getState().status, 'installing');
  assert.ok(FakeNotification.shown.some((item) => item.title === '업데이트 다운로드 완료'));

  const log = await readFile(path.join(temporaryDirectory, 'logs', 'auto-update.log'), 'utf8');
  assert.ok(log.includes('Bearer [REDACTED]'));
  assert.ok(!log.includes('A'.repeat(43)));

  manager.stop();
  process.env.AUTO_UPDATE_INSTALL = 'false';
  manager = createDesktopAutoUpdater({
    app: { getVersion: () => '1.1.0', isPackaged: true },
    Notification: FakeNotification, NsisUpdater: FakeNsisUpdater,
    userDataDir: temporaryDirectory,
    getReadiness: async () => ({ ready: true }),
    beforeInstall: async () => { throw new Error('Fixture must not install'); },
  });
  await manager.checkNow('manual');
  const fixtureUpdater = FakeNsisUpdater.instances.at(-1);
  assert.equal(fixtureUpdater.autoInstallOnAppQuit, false);
  fixtureUpdater.emit('update-downloaded', { version: '1.1.1' });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(fixtureUpdater.installArguments, null);
  assert.equal(manager.getState().status, 'downloaded');
  assert.equal(process.env.DESKTOP_UPDATE_INSTALL_PENDING, undefined);
  manager.stop();
  delete process.env.AUTO_UPDATE_TEST_MODE;
  manager = createDesktopAutoUpdater({
    app: { getVersion: () => '1.1.0', isPackaged: true },
    Notification: FakeNotification, NsisUpdater: FakeNsisUpdater,
    userDataDir: temporaryDirectory,
    getReadiness: async () => ({ ready: false }), beforeInstall: async () => {},
  });
  await manager.checkNow('manual');
  assert.equal(FakeNsisUpdater.instances.at(-1).autoInstallOnAppQuit, true, 'Production must ignore test-only install suppression');

  console.log(JSON.stringify({
    success: true,
    provider: updater.options.provider,
    authHeaderAttached: true,
    updateDetected: true,
    waitsForIdle: readinessChecks === 3,
    silentInstallRequested: updater.installArguments.join(',') === 'true,true',
    tokenRedacted: true,
  }));
} finally {
  manager?.stop();
  restoreEnvironment();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

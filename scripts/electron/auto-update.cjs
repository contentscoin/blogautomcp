/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 15 * 1000;
const IDLE_RECHECK_MS = 15 * 1000;
const IDLE_CONFIRM_MS = 3 * 1000;

function numericEnv(name, fallback, minimum) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function updateOrigin(siteUrl) {
  try {
    const url = new URL(siteUrl);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(process.env.AUTO_UPDATE_ALLOW_LOCAL_HTTP === '1' && localHttp)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function createLogger(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const sensitiveValues = new Set();
  const redact = (value) => {
    let output = String(value).replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]');
    for (const secret of sensitiveValues) output = output.split(secret).join('[REDACTED]');
    return output;
  };
  const write = (level, values) => {
    const line = `[${new Date().toISOString()}] ${level} ${values.map((value) => redact(value instanceof Error ? value.stack || value.message : value)).join(' ')}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  };
  return {
    debug: (...values) => write('DEBUG', values),
    info: (...values) => write('INFO', values),
    warn: (...values) => write('WARN', values),
    error: (...values) => write('ERROR', values),
    addSensitive: (value) => { if (value) sensitiveValues.add(String(value)); },
    redact,
  };
}

function createDesktopAutoUpdater({ app, Notification, NsisUpdater, userDataDir, getReadiness, beforeInstall }) {
  const logger = createLogger(path.join(userDataDir, 'logs', 'auto-update.log'));
  const testMode = process.env.AUTO_UPDATE_TEST_MODE === '1';
  const checkIntervalMs = numericEnv('AUTO_UPDATE_CHECK_INTERVAL_MS', DEFAULT_CHECK_INTERVAL_MS, testMode ? 100 : 30_000);
  const startDelayMs = numericEnv('AUTO_UPDATE_START_DELAY_MS', DEFAULT_START_DELAY_MS, testMode ? 10 : 3_000);
  const idleRecheckMs = numericEnv('AUTO_UPDATE_IDLE_RECHECK_MS', IDLE_RECHECK_MS, testMode ? 10 : 1_000);
  const idleConfirmMs = numericEnv('AUTO_UPDATE_IDLE_CONFIRM_MS', IDLE_CONFIRM_MS, testMode ? 10 : 500);
  const downloadedInstallDelayMs = numericEnv('AUTO_UPDATE_INSTALL_DELAY_MS', 1_000, testMode ? 10 : 500);
  const autoDownload = process.env.AUTO_UPDATE_DOWNLOAD !== 'false';
  let updater = null;
  let updaterOrigin = '';
  let startTimer = null;
  let checkTimer = null;
  let installTimer = null;
  let checkInFlight = false;
  let downloaded = false;
  let stopped = false;
  let idleConfirmations = 0;
  let manualCheck = false;
  let state = { status: 'disabled', version: app.getVersion(), progress: 0, error: '' };
  delete process.env.DESKTOP_UPDATE_INSTALL_PENDING;

  function setState(status, details = {}) {
    const error = typeof details.error === 'string' ? logger.redact(details.error).slice(0, 500) : '';
    state = {
      status,
      version: typeof details.version === 'string' ? details.version : state.version,
      progress: typeof details.progress === 'number' ? details.progress : state.progress,
      error,
    };
    process.env.DESKTOP_UPDATE_STATUS = state.status;
    process.env.DESKTOP_UPDATE_VERSION = state.version;
    process.env.DESKTOP_UPDATE_PROGRESS = String(Math.round(state.progress));
    process.env.DESKTOP_UPDATE_ERROR = state.error.slice(0, 500);
    logger.info(`state=${state.status} version=${state.version} progress=${Math.round(state.progress)}${state.error ? ` error=${state.error}` : ''}`);
  }

  function notify(title, body) {
    try {
      if (Notification?.isSupported?.()) new Notification({ title, body, silent: true }).show();
    } catch (error) {
      logger.warn('notification failed', error);
    }
  }

  function scheduleInstall(delayMs) {
    if (stopped || installTimer) return;
    installTimer = setTimeout(() => {
      installTimer = null;
      void installWhenSafe();
    }, delayMs);
  }

  async function installWhenSafe() {
    if (stopped || !downloaded || !updater) return;
    let readiness;
    try {
      readiness = await getReadiness();
    } catch (error) {
      setState('waiting-for-idle', { error: error instanceof Error ? error.message : '작업 상태 확인 실패' });
      scheduleInstall(idleRecheckMs);
      return;
    }
    if (!readiness?.ready) {
      idleConfirmations = 0;
      setState('waiting-for-idle', { version: state.version });
      scheduleInstall(idleRecheckMs);
      return;
    }
    idleConfirmations += 1;
    if (idleConfirmations < 2) {
      scheduleInstall(idleConfirmMs);
      return;
    }
    setState('installing', { version: state.version, progress: 100 });
    try {
      await beforeInstall();
      updater.quitAndInstall(true, true);
    } catch (error) {
      setState('install-error', { error: error instanceof Error ? error.message : '업데이트 설치 준비 실패' });
      scheduleInstall(30_000);
    }
  }

  function bindUpdater(nextUpdater) {
    nextUpdater.logger = logger;
    nextUpdater.autoDownload = autoDownload;
    nextUpdater.autoInstallOnAppQuit = true;
    nextUpdater.allowDowngrade = false;
    nextUpdater.allowPrerelease = false;
    nextUpdater.disableWebInstaller = true;
    nextUpdater.on('checking-for-update', () => setState('checking', { version: app.getVersion(), progress: 0 }));
    nextUpdater.on('update-available', (info) => {
      setState('available', { version: info.version, progress: 0 });
      if (!autoDownload) notify('업데이트 확인', `${info.version} 버전을 사용할 수 있습니다.`);
    });
    nextUpdater.on('update-not-available', () => {
      setState('current', { version: app.getVersion(), progress: 0 });
      if (manualCheck) notify('업데이트 확인', '현재 최신 버전을 사용 중입니다.');
    });
    nextUpdater.on('download-progress', (progress) => {
      setState('downloading', { version: state.version, progress: progress.percent || 0 });
    });
    nextUpdater.on('update-downloaded', (info) => {
      downloaded = true;
      process.env.DESKTOP_UPDATE_INSTALL_PENDING = '1';
      setState('downloaded', { version: info.version, progress: 100 });
      notify('업데이트 다운로드 완료', `${info.version} 버전을 준비했습니다. 진행 중인 포스팅이 끝나면 자동 재시작합니다.`);
      scheduleInstall(downloadedInstallDelayMs);
    });
    nextUpdater.on('error', (error) => {
      setState('error', { error: error instanceof Error ? error.message : String(error) });
    });
  }

  function ensureUpdater(origin, token) {
    logger.addSensitive(token);
    if (!updater || updaterOrigin !== origin) {
      if (updater) updater.removeAllListeners();
      updaterOrigin = origin;
      updater = new NsisUpdater({
        provider: 'generic',
        url: new URL('/api/updates/windows/', origin).toString(),
        channel: 'latest',
        useMultipleRangeRequest: false,
        requestHeaders: { authorization: `Bearer ${token}` },
      });
      bindUpdater(updater);
    }
    updater.requestHeaders = { authorization: `Bearer ${token}` };
    return updater;
  }

  async function checkNow(reason = 'scheduled') {
    if (stopped || checkInFlight || downloaded) return;
    const origin = updateOrigin(process.env.REMOTE_SITE_URL || '');
    const token = (process.env.REMOTE_DEVICE_TOKEN || '').trim();
    if (!origin || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState('waiting-for-activation', { version: app.getVersion(), progress: 0 });
      return;
    }
    checkInFlight = true;
    manualCheck = reason === 'manual';
    try {
      await ensureUpdater(origin, token).checkForUpdates();
    } catch (error) {
      setState('error', { error: error instanceof Error ? error.message : String(error) });
      if (manualCheck) notify('업데이트 확인 실패', '중앙 업데이트 서버에 연결하지 못했습니다.');
    } finally {
      manualCheck = false;
      checkInFlight = false;
    }
  }

  function start() {
    const forced = process.env.AUTO_UPDATE_FORCE === '1';
    if (process.env.AUTO_UPDATE_DISABLED === '1' || (!forced && (!app.isPackaged || process.platform !== 'win32'))) {
      setState('disabled', { version: app.getVersion(), progress: 0 });
      return;
    }
    stopped = false;
    setState('starting', { version: app.getVersion(), progress: 0 });
    startTimer = setTimeout(() => {
      startTimer = null;
      void checkNow('startup');
    }, startDelayMs);
    checkTimer = setInterval(() => void checkNow('scheduled'), checkIntervalMs);
  }

  function stop() {
    stopped = true;
    if (startTimer) clearTimeout(startTimer);
    if (checkTimer) clearInterval(checkTimer);
    if (installTimer) clearTimeout(installTimer);
    startTimer = null;
    checkTimer = null;
    installTimer = null;
  }

  return { start, stop, checkNow, getState: () => ({ ...state }) };
}

module.exports = { createDesktopAutoUpdater, updateOrigin };

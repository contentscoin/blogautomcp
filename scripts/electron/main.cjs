#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { app, BrowserWindow, dialog, Menu, Notification, shell, Tray } = require("electron");
const next = require("next");
const { NsisUpdater } = require("electron-updater");
const { createDesktopAutoUpdater } = require("./auto-update.cjs");

const APP_HOST = process.env.APP_HOST || "127.0.0.1";
const APP_PORT = Number.parseInt(process.env.APP_PORT || "43127", 10) || 43127;
const APP_BASE_URL = `http://${APP_HOST}:${APP_PORT}`;

let nextServer = null;
let nextAppInstance = null;
let serverStartPromise = null;
let serverRestartPromise = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let desktopUpdater = null;
let interruptedDraftsRecovered = false;

function resolveProjectRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }

  return path.resolve(__dirname, "../..");
}

function configureAutoStart() {
  if (process.platform !== "win32" || !app.isPackaged || process.env.DISABLE_AUTO_START === "1") {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: ["--hidden"],
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function ensureTray(projectRoot) {
  if (tray) {
    return;
  }

  tray = new Tray(path.join(projectRoot, "src", "app", "favicon.ico"));
  tray.setToolTip("BrandConnect Automation");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "BrandConnect 열기", click: showMainWindow },
    { label: "로컬 서버 재시작", click: () => void restartLocalServer() },
    { label: "업데이트 확인", click: () => void desktopUpdater?.checkNow("manual") },
    { type: "separator" },
    {
      label: "완전히 종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", showMainWindow);
}

function configureRuntimePaths(projectRoot) {
  if (process.cwd() !== projectRoot) {
    process.chdir(projectRoot);
  }
  const userData = app.getPath("userData");
  process.env.DESKTOP_APP_VERSION = app.getVersion();
  // Keep the local callback on loopback while preserving the app's actual port.
  process.env.LOCAL_APP_ORIGIN = process.env.LOCAL_APP_ORIGIN || APP_BASE_URL;
  process.env.DESKTOP_USER_DATA = process.env.DESKTOP_USER_DATA || userData;
  process.env.SESSION_STORAGE_DIR = process.env.SESSION_STORAGE_DIR || path.join(userData, "playwright", "storage");
  process.env.DESKTOP_PROJECT_ROOT = process.env.DESKTOP_PROJECT_ROOT || projectRoot;
  process.env.BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || "chrome";
  require("dotenv").config({ path: path.join(userData, ".env"), override: false, quiet: true });
  process.env.CHATGPT_BROWSER_VISIBILITY =
    process.env.CHATGPT_BROWSER_VISIBILITY ||
    ((process.env.CHATGPT_HEADLESS || "").trim().toLowerCase() === "true"
      ? "headless"
      : "background");
  const browserChatGptEnabled =
    (process.env.CHATGPT_BROWSER_AUTOMATION_ENABLED || "false").trim().toLowerCase() === "true";
  process.env.CHATGPT_BROWSER_AUTOMATION_ENABLED = browserChatGptEnabled ? "true" : "false";
  // 기본 엔진은 OpenAI API 키 + Spec-first 파이프라인. Codex/ChatGPT 웹 자동작성은 설정에서 켜는 선택 경로다.
  process.env.CODEX_DRAFT_ENABLED = process.env.CODEX_DRAFT_ENABLED || "false";
  process.env.CODEX_DRAFT_MODEL = process.env.CODEX_DRAFT_MODEL?.trim() || "gpt-5.5";
  process.env.AI_PROVIDER = process.env.AI_PROVIDER || "openai";
  process.env.BROWSER_GPT_MODE = browserChatGptEnabled ? "true" : "false";
  process.env.ALLOW_CHATGPT_BROWSER_MODE = browserChatGptEnabled ? "true" : "false";
  process.env.CHATGPT_BASE_URL = "https://chatgpt.com/";
  // 썸네일 생성도 ChatGPT 브라우저 자동화를 쓰지 않는다. 사용자 .env로도 켤 수 없게 고정한다.
  process.env.PRODUCT_THUMBNAIL_CHATGPT_ENABLED = "false";
  process.env.PRODUCT_THUMBNAIL_ALLOW_CHATGPT_BROWSER_MODE = "false";
  if (!process.env.DATABASE_URL) {
    const databasePath = app.isPackaged
      ? path.join(userData, "data", "blogautomcp.db")
      : path.join(projectRoot, "prisma", "blogautomcp.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
  }
}

async function ensureLocalDatabase(projectRoot) {
  const schemaPath = path.join(projectRoot, "prisma", "schema.prisma");
  const prismaCli = require.resolve("prisma/build/index.js", { paths: [projectRoot] });
  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [prismaCli, "db", "push", "--schema", schemaPath, "--skip-generate"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PRISMA_HIDE_UPDATE_MESSAGE: "1",
        },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`로컬 DB 초기화 실패: ${(stderr || stdout || error.message).trim()}`));
        else resolve();
      },
    );
  });
}

async function recoverInterruptedDrafts(projectRoot) {
  if (interruptedDraftsRecovered) return;
  interruptedDraftsRecovered = true;

  const { PrismaClient } = require(path.join(projectRoot, "src", "generated", "prisma"));
  const prisma = new PrismaClient();
  try {
    const recovered = await prisma.brandLink.updateMany({
      where: { status: "DRAFTING" },
      data: {
        status: "FAILED",
        errorMessage: "이전 앱 실행 중 초안 작성이 중단되었습니다. 다시 시도해 주세요.",
      },
    });
    if (recovered.count > 0) {
      console.warn(`[startup] interrupted drafts recovered: ${recovered.count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: APP_HOST });

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      resolve(false);
    });
  });
}

async function ensureServerReady() {
  if (nextServer) {
    return APP_BASE_URL;
  }

  if (serverStartPromise) {
    return serverStartPromise;
  }

  serverStartPromise = (async () => {
    const portInUse = await isPortOpen(APP_PORT);
    if (portInUse) {
      throw new Error(`로컬 포트 ${APP_PORT}이(가) 다른 프로그램에서 사용 중입니다.`);
    }

    const nextDir = resolveProjectRoot();
    configureRuntimePaths(nextDir);
    await ensureLocalDatabase(nextDir);
    await recoverInterruptedDrafts(nextDir);

    nextAppInstance = next({
      dev: !app.isPackaged,
      dir: nextDir,
    });

    const requestHandler = nextAppInstance.getRequestHandler();
    await nextAppInstance.prepare();

    nextServer = http.createServer((req, res) => {
      requestHandler(req, res);
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => reject(new Error(`웹 서버 시작 실패: ${error.message}`));

      nextServer.once("error", onError);
      nextServer.listen(APP_PORT, APP_HOST, () => {
        nextServer.off("error", onError);
        resolve();
      });
    });

    return APP_BASE_URL;
  })();

  try {
    return await serverStartPromise;
  } finally {
    serverStartPromise = null;
  }
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return;
  }

  const url = await ensureServerReady();
  const startHidden = process.argv.includes("--hidden");

  const browserWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1280,
    minHeight: 800,
    title: "BrandConnect Automation",
    backgroundColor: "#111827",
    webPreferences: {
      contextIsolation: true,
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
    show: !startHidden,
  });
  mainWindow = browserWindow;

  // ADMIN_API_KEY 가 설정되면 로컬 서버의 관리자 API 는 실제 자격 증명을 요구한다.
  // 렌더러(대시보드)가 로컬 서버로 보내는 요청에만 키 헤더를 붙여 준다.
  const adminApiKey = process.env.ADMIN_API_KEY?.trim();
  if (adminApiKey) {
    browserWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: [`${APP_BASE_URL}/*`] },
      (details, callback) => {
        callback({ requestHeaders: { ...details.requestHeaders, "x-admin-api-key": adminApiKey } });
      },
    );
  }

  browserWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const target = new URL(targetUrl);
      if (target.protocol === "https:" || target.protocol === "http:") {
        void shell.openExternal(target.toString()).catch(() => {});
      }
    } catch {
      // 잘못된 URL이나 외부 프로토콜은 열지 않는다.
    }
    return { action: "deny" };
  });

  browserWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      browserWindow.hide();
    }
  });

  browserWindow.on("closed", () => {
    if (mainWindow === browserWindow) {
      mainWindow = null;
    }
  });

  await browserWindow.loadURL(url);

  if (!app.isPackaged) {
    browserWindow.webContents.openDevTools();
  }
}

async function shutdownServer() {
  if (nextServer) {
    const serverToClose = nextServer;
    await new Promise((resolve) => {
      serverToClose.close(resolve);
      serverToClose.closeIdleConnections?.();
    });
  }

  if (nextAppInstance && nextAppInstance.close) {
    await nextAppInstance.close();
  }

  nextServer = null;
  nextAppInstance = null;
}

function getRelaunchArgs() {
  const args = [];
  if (process.argv.includes("--hidden") || app.commandLine.hasSwitch("hidden")) {
    args.push("--hidden");
  }
  const userDataDir = app.commandLine.getSwitchValue("user-data-dir");
  if (userDataDir) {
    args.push(`--user-data-dir=${userDataDir}`);
  }
  return args;
}

async function restartLocalServer() {
  if (isQuitting) {
    throw new Error("프로그램이 종료 중이라 서버를 다시 시작할 수 없습니다.");
  }
  if (serverRestartPromise) {
    return serverRestartPromise;
  }

  serverRestartPromise = (async () => {
    // A prepared production Next instance cannot always be initialized twice
    // in the same process. Relaunching Electron reliably replaces both the
    // embedded web/MCP server and its renderer while preserving user data.
    desktopUpdater?.stop();
    isQuitting = true;
    app.relaunch({ args: getRelaunchArgs() });
    app.exit(0);
  })();

  try {
    await serverRestartPromise;
  } finally {
    serverRestartPromise = null;
  }
}

function installDesktopControlBridge() {
  globalThis.__brandconnectDesktopControl = {
    restartServer: restartLocalServer,
    checkForUpdates: async () => {
      if (!desktopUpdater) {
        throw new Error("자동 업데이트 관리자가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.");
      }
      await desktopUpdater.checkNow("manual");
      return desktopUpdater.getState();
    },
    getState: () => ({
      available: true,
      restarting: Boolean(serverRestartPromise),
      update: desktopUpdater?.getState() ?? null,
    }),
  };
}

async function getUpdateReadiness() {
  const headers = {};
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (adminKey) headers["x-admin-api-key"] = adminKey;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${APP_BASE_URL}/api/system/update-readiness`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `업데이트 준비 상태 확인 실패 (${response.status})`);
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 작업 큐 워치독. 렌더러(RemoteAgentPoller)가 폴링을 멈춘 상태(창이 닫히거나 렌더러가
 * 죽은 경우)에도 MCP 작업이 실행되도록 메인 프로세스가 주기적으로 로컬 폴 엔드포인트를
 * 직접 호출한다. 폴 라우트는 프로세스 내 단일 실행 락을 갖고 있어 두 폴러가 겹쳐도
 * 작업은 한 번에 하나만 실행된다.
 */
const REMOTE_AGENT_WATCHDOG_INTERVAL_MS = 45_000;
let remoteAgentWatchdogTimer = null;
let remoteAgentWatchdogBusy = false;

async function pollRemoteAgentOnce() {
  if (remoteAgentWatchdogBusy || isQuitting || !nextServer) return;
  remoteAgentWatchdogBusy = true;
  const headers = { "content-type": "application/json", origin: APP_BASE_URL };
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (adminKey) headers["x-admin-api-key"] = adminKey;
  const controller = new AbortController();
  // 작업 실행(발행)은 수십 분 걸릴 수 있다. 폴 요청은 작업이 끝날 때까지 열려 있으므로
  // 타임아웃을 길게 두고, 워치독 자체는 busy 플래그로 중복 호출을 막는다.
  const timeout = setTimeout(() => controller.abort(), 3 * 60 * 60 * 1000);
  try {
    await fetch(`${APP_BASE_URL}/api/remote-agent/poll`, { method: "POST", headers, body: "{}", signal: controller.signal });
  } catch {
    // 서버 재시작 중이거나 네트워크 문제 — 다음 주기에 다시 시도한다.
  } finally {
    clearTimeout(timeout);
    remoteAgentWatchdogBusy = false;
  }
}

function startRemoteAgentWatchdog() {
  if (remoteAgentWatchdogTimer) return;
  remoteAgentWatchdogTimer = setInterval(() => {
    void pollRemoteAgentOnce();
  }, REMOTE_AGENT_WATCHDOG_INTERVAL_MS);
  if (typeof remoteAgentWatchdogTimer.unref === "function") remoteAgentWatchdogTimer.unref();
}

function stopRemoteAgentWatchdog() {
  if (!remoteAgentWatchdogTimer) return;
  clearInterval(remoteAgentWatchdogTimer);
  remoteAgentWatchdogTimer = null;
}

/**
 * 딥링크 페어링: 사이트 대시보드의 "PC 앱 연결" 버튼이 blogautomcp://pair?code=…&site=… 를 연다.
 * 메인 프로세스가 코드를 로컬 API(/api/remote-agent)에 넘겨 사이트와 페어링하고 창을 띄운다.
 * site 는 로컬 API 의 허용 목록으로 다시 검증되므로 임의 페이지가 만든 링크로는 연결되지 않는다.
 */
const DEEP_LINK_PROTOCOL = "blogautomcp";
let pendingDeepLink = null;

function registerDeepLinkProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    }
  } catch {
    // 프로토콜 등록 실패는 치명적이지 않다(코드 입력 폴백이 있다).
  }
}

function extractDeepLink(argv) {
  if (!Array.isArray(argv)) return null;
  const found = argv.find((value) => typeof value === "string" && value.toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}://`));
  return found || null;
}

function parsePairDeepLink(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;
  const action = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (action !== "pair") return null;
  const code = (url.searchParams.get("code") || "").trim();
  const site = (url.searchParams.get("site") || "").trim();
  if (!/^[A-Za-z0-9-\s]{8,12}$/.test(code)) return null;
  return { code, site };
}

function notifyDesktop(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch {
    // 알림 실패는 무시
  }
}

async function handlePairDeepLink(rawUrl) {
  const parsed = parsePairDeepLink(rawUrl);
  if (!parsed) return;
  if (!nextServer) {
    pendingDeepLink = rawUrl;
    return;
  }
  showMainWindow();
  const headers = { "content-type": "application/json", origin: APP_BASE_URL };
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (adminKey) headers["x-admin-api-key"] = adminKey;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${APP_BASE_URL}/api/remote-agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pairCode: parsed.code, ...(parsed.site ? { siteUrl: parsed.site } : {}) }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      notifyDesktop("PC 연결 실패", payload?.error || `사이트 연결에 실패했습니다 (${response.status}).`);
    } else {
      notifyDesktop("PC 연결 완료", "이 PC가 BlogAutoMCP 계정에 연결되었습니다. 네이버 로그인을 진행하세요.");
    }
  } catch (error) {
    notifyDesktop("PC 연결 실패", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
    // 렌더러의 활성화 게이트를 즉시 갱신한다.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('window.dispatchEvent(new Event("blogautomcp:activation-changed")); true;').catch(() => undefined);
    }
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = extractDeepLink(argv);
    if (link) void handlePairDeepLink(link);
    else showMainWindow();
  });

  // macOS 는 open-url 로 딥링크를 받는다.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handlePairDeepLink(url);
  });

  app.on("window-all-closed", () => {
    // The tray process intentionally keeps the local MCP agent alive.
  });

  app.on("before-quit", async () => {
    isQuitting = true;
    stopRemoteAgentWatchdog();
    desktopUpdater?.stop();
    await shutdownServer();
  });

  app.whenReady().then(async () => {
    const projectRoot = resolveProjectRoot();
    configureAutoStart();
    registerDeepLinkProtocol();
    installDesktopControlBridge();
    ensureTray(projectRoot);
    await createWindow();
    desktopUpdater = createDesktopAutoUpdater({
      app,
      Notification,
      NsisUpdater,
      userDataDir: app.getPath("userData"),
      getReadiness: getUpdateReadiness,
      beforeInstall: async () => {},
    });
    desktopUpdater.start();
    startRemoteAgentWatchdog();
    // 앱이 딥링크로 처음 실행된 경우(Windows 는 argv 로 전달) 서버 준비 후 처리한다.
    const initialLink = pendingDeepLink || extractDeepLink(process.argv);
    pendingDeepLink = null;
    if (initialLink) void handlePairDeepLink(initialLink);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("BrandConnect Automation 시작 실패", message);
    app.quit();
  });

  app.on("activate", () => {
    showMainWindow();
  });
}

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
    (process.env.CHATGPT_BROWSER_AUTOMATION_ENABLED || "true").trim().toLowerCase() === "true";
  process.env.CHATGPT_BROWSER_AUTOMATION_ENABLED = browserChatGptEnabled ? "true" : "false";
  process.env.CODEX_DRAFT_ENABLED = process.env.CODEX_DRAFT_ENABLED || "true";
  process.env.CODEX_DRAFT_MODEL = process.env.CODEX_DRAFT_MODEL?.trim() || "gpt-5.5";
  process.env.AI_PROVIDER = process.env.AI_PROVIDER || "codex";
  process.env.BROWSER_GPT_MODE = browserChatGptEnabled ? "true" : "false";
  process.env.ALLOW_CHATGPT_BROWSER_MODE = browserChatGptEnabled ? "true" : "false";
  process.env.CHATGPT_USE_CUSTOM_GPTS = "false";
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.on("window-all-closed", () => {
    // The tray process intentionally keeps the local MCP agent alive.
  });

  app.on("before-quit", async () => {
    isQuitting = true;
    desktopUpdater?.stop();
    await shutdownServer();
  });

  app.whenReady().then(async () => {
    const projectRoot = resolveProjectRoot();
    configureAutoStart();
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
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("BrandConnect Automation 시작 실패", message);
    app.quit();
  });

  app.on("activate", () => {
    showMainWindow();
  });
}

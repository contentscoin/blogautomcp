#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow } = require("electron");
const next = require("next");

const APP_HOST = process.env.APP_HOST || "127.0.0.1";
const APP_PORT = Number.parseInt(process.env.APP_PORT || "3000", 10) || 3000;
const APP_BASE_URL = `http://${APP_HOST}:${APP_PORT}`;

let nextServer = null;
let nextAppInstance = null;

function resolveProjectRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }

  return path.resolve(__dirname, "../..");
}

/**
 * 패키징 앱은 번들에 .env가 없으므로(보안), 사용자가 쓰기 가능한 userData 폴더에 둔
 * `.env`로 API키·네이버 설정 등을 주입할 수 있게 한다. (DATABASE_URL은 이후 prepareDatabase가
 * 덮어쓰므로 사용자가 잘못 지정해도 안전)
 */
function loadUserConfig() {
  if (!app.isPackaged) return;
  try {
    const envPath = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(envPath)) {
      // dotenv는 번들된 의존성. override:false라 이미 설정된 값은 보존.
      require("dotenv").config({ path: envPath, override: false });
      console.log(`사용자 설정 로드: ${envPath}`);
    }
  } catch (error) {
    console.error("사용자 설정(.env) 로드 실패:", error && error.message);
  }
}

/**
 * 패키징된 앱은 설치 경로(읽기 전용)에 DB를 쓸 수 없으므로, 쓰기 가능한 userData로
 * SQLite DB를 옮기고 DATABASE_URL을 절대경로로 고정한다. 첫 실행 시 번들된 빈 스키마
 * 템플릿(prisma/template.db, 없으면 prisma/dev.db)을 복사한다.
 * 개발 모드에서는 기존 상대경로(file:./dev.db)를 그대로 둔다.
 */
function prepareDatabase() {
  if (!app.isPackaged) return;

  const userDataDir = app.getPath("userData");
  const userDbPath = path.join(userDataDir, "app.db");

  if (!fs.existsSync(userDbPath)) {
    const root = resolveProjectRoot();
    const candidates = [
      path.join(root, "prisma", "template.db"),
      path.join(root, "prisma", "dev.db"),
    ];
    const template = candidates.find((p) => fs.existsSync(p));
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      if (template) {
        fs.copyFileSync(template, userDbPath);
      } else {
        // 템플릿이 없으면 빈 파일 생성(스키마는 첫 마이그레이션/푸시 필요).
        fs.writeFileSync(userDbPath, "");
      }
    } catch (error) {
      console.error("DB 준비 실패:", error && error.message);
    }
  }

  // Prisma가 읽도록 절대경로로 주입.
  process.env.DATABASE_URL = `file:${userDbPath}`;
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
  // 개발 모드에서만 이미 떠 있는 dev 서버(npm run dev)를 재사용한다.
  // 패키징 앱은 다른 서비스가 점유한 포트를 재사용하면 엉뚱한/빈 페이지를 로드하므로
  // 절대 재사용하지 않고 항상 자체 Next 서버를 빈 포트에 띄운다.
  if (!app.isPackaged && (await isPortOpen(APP_PORT))) {
    return APP_BASE_URL;
  }

  const nextDir = resolveProjectRoot();

  nextAppInstance = next({
    dev: !app.isPackaged,
    dir: nextDir,
  });

  const requestHandler = nextAppInstance.getRequestHandler();
  await nextAppInstance.prepare();

  nextServer = http.createServer((req, res) => {
    requestHandler(req, res);
  });

  // 선호 포트(APP_PORT)가 비어 있으면 사용하고, 점유돼 있으면 0으로 OS가 빈 포트를 할당.
  const preferredBusy = await isPortOpen(APP_PORT);
  const desiredPort = preferredBusy ? 0 : APP_PORT;

  const boundPort = await new Promise((resolve, reject) => {
    const onError = (error) => reject(new Error(`웹 서버 시작 실패: ${error.message}`));

    nextServer.once("error", onError);
    nextServer.listen(desiredPort, APP_HOST, () => {
      nextServer.off("error", onError);
      const addr = nextServer.address();
      resolve(addr && typeof addr === "object" ? addr.port : APP_PORT);
    });
  });

  return `http://${APP_HOST}:${boundPort}`;
}

async function createWindow() {
  const url = await ensureServerReady();

  const browserWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1280,
    minHeight: 800,
    title: "BrandConnect Automation",
    backgroundColor: "#111827",
    webPreferences: {
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  await browserWindow.loadURL(url);

  if (!app.isPackaged) {
    browserWindow.webContents.openDevTools();
  }
}

async function shutdownServer() {
  if (nextServer) {
    await new Promise((resolve) => nextServer.close(resolve));
  }

  if (nextAppInstance && nextAppInstance.close) {
    await nextAppInstance.close();
  }

  nextServer = null;
  nextAppInstance = null;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await shutdownServer();
});

app.whenReady().then(() => {
  if (app.isPackaged) {
    // 패키징 마커: run-script가 npx 대신 Electron 내장 node로 스크립트를 실행하도록.
    process.env.DESKTOP_PACKAGED = "1";
    process.env.DESKTOP_ELECTRON_EXEC = process.execPath;
    process.env.DESKTOP_PROJECT_ROOT = resolveProjectRoot();
    // 패키징 앱은 Chromium을 번들하지 않고(심볼릭링크 패키징 문제 회피) 시스템 Chrome을 사용.
    if (!process.env.BROWSER_CHANNEL) {
      process.env.BROWSER_CHANNEL = "chrome";
    }
    // 쓰기 가능한 userData를 서버/스크립트에 노출(설정·세션 저장 경로용).
    const userData = app.getPath("userData");
    process.env.DESKTOP_USER_DATA = userData;
    if (!process.env.SESSION_STORAGE_DIR) {
      process.env.SESSION_STORAGE_DIR = path.join(userData, "playwright", "storage");
    }
  }
  loadUserConfig();
  prepareDatabase();
  return createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

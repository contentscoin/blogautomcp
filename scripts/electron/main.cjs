#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
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
  const portInUse = await isPortOpen(APP_PORT);
  if (portInUse) {
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

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(new Error(`웹 서버 시작 실패: ${error.message}`));

    nextServer.once("error", onError);
    nextServer.listen(APP_PORT, APP_HOST, () => {
      nextServer.off("error", onError);
      resolve();
    });
  });

  return APP_BASE_URL;
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

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

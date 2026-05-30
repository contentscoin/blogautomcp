#!/usr/bin/env node

import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const host = process.env.HOST || "0.0.0.0";
const openBrowser = process.env.OPEN_BROWSER !== "0";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "next",
  "dev",
  "--hostname",
  host,
  "--port",
  port,
];

const child = spawn(npxCommand, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

let opened = false;

function openUrl(url) {
  if (!openBrowser || opened) return;
  opened = true;

  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" });
    return;
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", `"${url}"`], {
      detached: true,
      stdio: "ignore",
    });
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  const match = text.match(/Local:\s*(https?:\/\/[^\s]+)/);
  if (match) {
    openUrl(match[1]);
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

const onExit = (code) => {
  process.exit(code ?? 0);
};

child.on("error", (error) => {
  console.error("개발 서버 실행 실패:", error);
  process.exit(1);
});

child.on("close", onExit);

process.on("SIGINT", () => {
  if (!child.killed) child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  if (!child.killed) child.kill("SIGTERM");
});

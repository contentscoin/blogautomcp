// Isolated UI fixture: every API call is mocked; no user database is copied.
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), "blog-auto-publish-qa-"));
const calls = [];
const rows = ["SHOPPING", "TRAVEL", "TRAVEL", "TRAVEL"].map((connectKind, index) => ({
  id: "qa-product-" + index, connectKind, productName: "테스트 상품 " + index,
  url: "https://example.test/product", sourceUrl: "https://example.test/product",
  status: "READY", createdAt: "2026-09-07T00:00:00Z", scheduledPublishAt: "2026-10-01T00:00:00Z",
  draftPrepared: index % 2 === 0, draftApproved: false, errorMessage: null,
}));
const apiJobs = new Map();
const proxy = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/_qa/requests") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(calls)); return; }
  if (url.pathname.startsWith("/api/")) {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    let data = {};
    if (req.method !== "GET") calls.push({ path: url.pathname, body });
    if (url.pathname === "/api/brandlinks") data = rows;
    else if (url.pathname === "/api/remote-agent") data = { configured: true, deviceId: "qa-device", siteUrl: "http://127.0.0.1:43141" };
    else if (url.pathname === "/api/topic-tasks") data = [];
    else if (url.pathname === "/api/settings") data = { draftCreationMode: "codex", fields: [], configured: {}, values: {} };
    else if (url.pathname.includes("selection-options")) data = { categories: [], promotions: [], registrationAvailable: true };
    else if (url.pathname.endsWith("auto-publish")) {
      if (req.method === "POST") apiJobs.set(url.pathname, 0);
      const polls = (apiJobs.get(url.pathname) || 0) + 1;
      if (req.method === "GET") apiJobs.set(url.pathname, polls);
      data = { status: polls < 3 ? "running" : "completed", stage: "자동 검수", result: { status: "PUBLISHED" } };
    } else if (/bulk-(today|schedule)$/.test(url.pathname)) {
      data = req.method === "POST" ? { targetCount: Math.min(body.limit, 3), targetIds: rows.slice(1).map(row => row.id), jobId: "qa-job" } : { status: "completed" };
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ success: true, data }));
    return;
  }
  // Never forward mutations to the real API server.
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  const upstream = httpRequest({ host: "127.0.0.1", port: 43140, path: req.url, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(503); res.end("Preview starting"); });
  upstream.end();
});
proxy.listen(43141, "127.0.0.1");
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "43140"], {
  windowsHide: true, stdio: "inherit", env: { ...process.env, DESKTOP_USER_DATA: dir,
    DATABASE_URL: "file:" + path.join(dir, "empty.db").replaceAll("\\", "/"),
    SESSION_STORAGE_DIR: path.join(dir, "sessions"), REMOTE_SITE_URL: "http://127.0.0.1:43141",
    REMOTE_DEVICE_ID: "", REMOTE_DEVICE_TOKEN: "", ADMIN_API_KEY: "qa-only" },
});
console.log("UI QA: http://127.0.0.1:43141 (all APIs mocked)");
process.on("SIGINT", () => { child.kill(); proxy.close(); });
process.on("SIGTERM", () => { child.kill(); proxy.close(); });
child.on("exit", code => { proxy.close(); process.exitCode = code || 0; });

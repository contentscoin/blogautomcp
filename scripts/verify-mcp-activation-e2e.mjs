import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function listenOnBrowserSafePort(server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 32_000 + Math.floor(Math.random() * 12_000);
    try {
      return await listen(server, port);
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("브라우저 검증용 빈 포트를 찾지 못했습니다.");
}

async function waitFor(url, child, logs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js가 조기 종료되었습니다.\n${logs.join("").slice(-4000)}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js 시작 대기 시간이 초과되었습니다.\n${logs.join("").slice(-4000)}`);
}

async function json(response) {
  const payload = await response.json();
  return { response, payload };
}

const userData = await mkdtemp(join(tmpdir(), "blogautomcp-activation-e2e-"));
let revoked = false;
let pairCalls = 0;
let expectedToken = "";
const claimBodies = [];

const mockServer = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/device/pair") {
    pairCalls += 1;
    expectedToken = `token-e2e-${pairCalls}`;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      success: true,
      data: { deviceId: `device-e2e-${pairCalls}`, deviceToken: expectedToken },
    }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/agent/jobs/claim") {
    let body = "";
    for await (const chunk of request) body += chunk;
    claimBodies.push(body ? JSON.parse(body) : null);
    const tokenMatches = request.headers.authorization === `Bearer ${expectedToken}`;
    response.writeHead(revoked || !tokenMatches ? 401 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(revoked || !tokenMatches
      ? { success: false, error: { code: "DEVICE_REVOKED", message: "장치 인증이 폐기되었습니다." } }
      : { success: true, data: null }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ success: false }));
});

const mockPort = await listen(mockServer);
const portProbe = createServer();
const appPort = await listenOnBrowserSafePort(portProbe);
await new Promise((resolve) => portProbe.close(resolve));
const appOrigin = `http://127.0.0.1:${appPort}`;
const logs = [];
const child = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DESKTOP_USER_DATA: userData,
    DATABASE_URL: `file:${join(userData, "e2e.db").replaceAll("\\", "/")}`,
    REMOTE_SITE_URL: "",
    REMOTE_DEVICE_ID: "",
    REMOTE_DEVICE_TOKEN: "",
    ADMIN_API_KEY: "",
    DESKTOP_APP_VERSION: "1.1.12-test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

try {
  await waitFor(`${appOrigin}/api/remote-agent`, child, logs);

  const before = await json(await fetch(`${appOrigin}/api/remote-agent`, { cache: "no-store" }));
  assert.equal(before.response.status, 200);
  assert.equal(before.payload.data.configured, false);

  const locked = await json(await fetch(`${appOrigin}/api/keywords`, { cache: "no-store" }));
  assert.equal(locked.response.status, 428);
  assert.equal(locked.payload.code, "MCP_ACTIVATION_REQUIRED");

  const paired = await json(await fetch(`${appOrigin}/api/remote-agent`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appOrigin },
    body: JSON.stringify({
      mcpUrl: `http://127.0.0.1:${mockPort}/api/mcp/e2e.secret`,
      deviceName: "E2E PC",
    }),
  }));
  assert.equal(paired.response.status, 200, JSON.stringify(paired.payload));
  assert.equal(paired.payload.data.configured, true);
  assert.equal(pairCalls, 1);

  const unlocked = await json(await fetch(`${appOrigin}/api/keywords`, { cache: "no-store" }));
  assert.equal(unlocked.response.status, 200);

  const healthyPoll = await json(await fetch(`${appOrigin}/api/remote-agent/poll`, {
    method: "POST",
    headers: { origin: appOrigin },
  }));
  assert.equal(healthyPoll.response.status, 200);
  assert.equal(healthyPoll.payload.data.configured, true);
  assert.equal(claimBodies.at(-1)?.appVersion, "1.1.12-test");

  const repaired = await json(await fetch(`${appOrigin}/api/remote-agent`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appOrigin },
    body: JSON.stringify({
      mcpUrl: `http://127.0.0.1:${mockPort}/api/mcp/e2e.reconnected`,
      deviceName: "E2E PC reconnected",
    }),
  }));
  assert.equal(repaired.response.status, 200, JSON.stringify(repaired.payload));
  assert.equal(repaired.payload.data.deviceId, "device-e2e-2");
  assert.equal(pairCalls, 2);

  const reconnectedPoll = await json(await fetch(`${appOrigin}/api/remote-agent/poll`, {
    method: "POST",
    headers: { origin: appOrigin },
  }));
  assert.equal(reconnectedPoll.response.status, 200, JSON.stringify(reconnectedPoll.payload));
  assert.equal(reconnectedPoll.payload.data.configured, true);

  revoked = true;
  const revokedPoll = await json(await fetch(`${appOrigin}/api/remote-agent/poll`, {
    method: "POST",
    headers: { origin: appOrigin },
  }));
  assert.equal(revokedPoll.response.status, 401);

  const after = await json(await fetch(`${appOrigin}/api/remote-agent`, { cache: "no-store" }));
  assert.equal(after.response.status, 200);
  assert.equal(after.payload.data.configured, false);

  const relocked = await json(await fetch(`${appOrigin}/api/keywords`, { cache: "no-store" }));
  assert.equal(relocked.response.status, 428);
  assert.equal(relocked.payload.code, "MCP_ACTIVATION_REQUIRED");

  const envFile = await readFile(join(userData, ".env"), "utf8");
  assert.equal(envFile.includes("REMOTE_DEVICE_TOKEN"), false);
  assert.equal(envFile.includes("REMOTE_DEVICE_ID"), false);
  assert.equal(envFile.includes("REMOTE_SITE_URL"), false);

  console.log("PASS: unpaired lock -> MCP pair -> live MCP reconnect -> revoked re-lock");
} finally {
  child.kill();
  await new Promise((resolve) => mockServer.close(resolve));
  await rm(userData, { recursive: true, force: true });
}

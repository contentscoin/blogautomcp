/** Isolated loopback-only behavior checks; no external requests or generation. */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import {
  localJsonFetch,
  LOCAL_JSON_FETCH_TIMEOUT_MS,
  LOCAL_JSON_FETCH_MAX_BODY_BYTES,
} from "../src/lib/local-json-fetch";

let checks = 0;
let hits = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();
const later = (callback: () => void, delay: number) => {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
  timers.add(timer);
};
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  hits += 1;
  switch (req.url) {
    case "/echo": {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(201, "Created", { "content-type": "application/json", "x-local-result": "preserved" });
        res.end(JSON.stringify({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") }));
      });
      break;
    }
    case "/slow-headers": later(() => { res.end('{"success":true}'); }, 80); break;
    case "/stalled-headers": break;
    case "/stalled-body": res.writeHead(200); res.write('{"partial":'); break;
    case "/trickle": {
      res.writeHead(200);
      const write = () => { if (!res.destroyed) { res.write(" "); later(write, 10); } };
      write();
      break;
    }
    case "/redirect": res.writeHead(302, { location: "/echo" }); res.end(); break;
    case "/external-redirect": res.writeHead(307, { location: "http://example.invalid/" }); res.end(); break;
    case "/error": res.writeHead(403, { "content-type": "application/json" }); res.end('{"success":false}'); break;
    case "/empty": res.writeHead(204); res.end(); break;
    case "/not-modified": res.writeHead(304); res.end(); break;
    case "/head": res.writeHead(200, { "content-length": "99999999" }); res.end(); break;
    case "/large-header": res.writeHead(200, { "content-length": LOCAL_JSON_FETCH_MAX_BODY_BYTES + 1 }); res.flushHeaders(); break;
    case "/large-chunked":
    case "/exact-limit": {
      const size = LOCAL_JSON_FETCH_MAX_BODY_BYTES + (req.url === "/large-chunked" ? 1 : 0);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const chunk = Buffer.alloc(1024 * 1024, 120);
      let sent = 0;
      const write = () => {
        while (sent < size && !res.destroyed) {
          const part = chunk.subarray(0, Math.min(chunk.length, size - sent));
          sent += part.length;
          if (!res.write(part)) { res.once("drain", write); return; }
        }
        if (!res.destroyed) res.end();
      };
      write();
      break;
    }
    case "/truncated": res.writeHead(200, { "content-length": "1000" }); res.write("partial"); later(() => res.destroy(), 10); break;
    default: res.writeHead(404); res.end("missing");
  }
});
server.on("upgrade", (_req, socket) => { socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n"); });

async function check(name: string, test: () => Promise<void>) {
  await test();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  try {
    await check("POST JSON, Origin/admin headers, status and Response methods preserved", async () => {
      assert.equal(LOCAL_JSON_FETCH_TIMEOUT_MS, 3 * 60 * 60 * 1000);
      const body = JSON.stringify({ title: "한글 이미지", count: 12 });
      const response = await localJsonFetch(`${origin}/echo`, {
        method: "POST", body, cache: "no-store",
        headers: { origin, "content-type": "application/json", "x-admin-api-key": "offline-fixture-key" },
      });
      assert.equal(response.status, 201);
      assert.equal(response.statusText, "Created");
      assert.equal(response.ok, true);
      assert.equal(response.headers.get("x-local-result"), "preserved");
      const payload = await response.json();
      assert.equal(payload.body, body);
      assert.equal(payload.method, "POST");
      assert.equal(payload.headers.origin, origin);
      assert.equal(payload.headers["x-admin-api-key"], "offline-fixture-key");
    });
    await check("localhost pinned to loopback while Host and explicit Headers remain intact", async () => {
      const response = await localJsonFetch(`http://localhost:${port}/echo`, { headers: new Headers({ origin: "http://localhost", "x-test": "value" }) });
      const payload = await response.json();
      assert.equal(payload.headers.host, `localhost:${port}`);
      assert.equal(payload.headers["x-test"], "value");
      assert.equal(payload.headers.origin, "http://localhost");
    });
    await check("delayed headers complete within configurable total deadline", async () => {
      assert.deepEqual(await (await localJsonFetch(`${origin}/slow-headers`, {}, 1000)).json(), { success: true });
    });
    for (const endpoint of ["stalled-headers", "stalled-body", "trickle"]) {
      await check(`total deadline covers ${endpoint}`, async () => {
        const started = Date.now();
        await assert.rejects(localJsonFetch(`${origin}/${endpoint}`, {}, 80), { name: "TimeoutError" });
        assert.ok(Date.now() - started < 2000);
      });
    }
    for (const endpoint of ["redirect", "external-redirect"]) {
      await check(`${endpoint} rejected without following`, async () => {
        const before = hits;
        await assert.rejects(localJsonFetch(`${origin}/${endpoint}`, { redirect: "follow" }), /redirects are not allowed/);
        assert.equal(hits, before + 1);
      });
    }
    await check("non-2xx and bodyless statuses preserved", async () => {
      const forbidden = await localJsonFetch(`${origin}/error`);
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.ok, false);
      assert.deepEqual(await forbidden.json(), { success: false });
      for (const [endpoint, status] of [["empty", 204], ["not-modified", 304]] as const) {
        const response = await localJsonFetch(`${origin}/${endpoint}`);
        assert.equal(response.status, status);
        assert.equal(response.body, null);
      }
      const head = await localJsonFetch(`${origin}/head`, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.body, null);
    });
    await check("abort before request sends nothing and preserves reason", async () => {
      const controller = new AbortController();
      const reason = new Error("fixture cancelled");
      controller.abort(reason);
      const before = hits;
      await assert.rejects(localJsonFetch(`${origin}/echo`, { signal: controller.signal }), (error) => error === reason);
      assert.equal(hits, before);
    });
    for (const endpoint of ["stalled-headers", "stalled-body"]) {
      await check(`abort cancels ${endpoint}`, async () => {
        const controller = new AbortController();
        const pending = localJsonFetch(`${origin}/${endpoint}`, { signal: controller.signal }, 1000);
        later(() => controller.abort(), 30);
        await assert.rejects(pending, { name: "AbortError" });
      });
    }
    await check("32 MiB boundary accepted; larger declared and streamed bodies rejected", async () => {
      const response = await localJsonFetch(`${origin}/exact-limit`);
      assert.equal((await response.arrayBuffer()).byteLength, LOCAL_JSON_FETCH_MAX_BODY_BYTES);
      await assert.rejects(localJsonFetch(`${origin}/large-header`), /exceeds 32 MiB/);
      await assert.rejects(localJsonFetch(`${origin}/large-chunked`), /exceeds 32 MiB/);
    });
    await check("truncated responses and protocol upgrades reject", async () => {
      await assert.rejects(localJsonFetch(`${origin}/truncated`), /aborted|reset|closed/i);
      await assert.rejects(localJsonFetch(`${origin}/upgrade`, { headers: { connection: "Upgrade", upgrade: "fixture" } }), /upgrades are not allowed/);
    });
    await check("non-loopback, HTTPS, credential URLs and invalid options rejected before I/O", async () => {
      const before = hits;
      for (const url of ["http://example.invalid/", "http://192.168.0.1/", "http://localhost.example.invalid/", "https://127.0.0.1/", `http://user:pass@127.0.0.1:${port}/`]) {
        await assert.rejects(localJsonFetch(url), /loopback HTTP URL/);
      }
      for (const timeout of [0, -1, NaN, Infinity, 2_147_483_648]) {
        await assert.rejects(localJsonFetch(`${origin}/echo`, {}, timeout), /timeoutMs/);
      }
      await assert.rejects(localJsonFetch(`${origin}/echo`, { method: "POST", body: new URLSearchParams("a=1") }), /JSON string/);
      await assert.rejects(localJsonFetch(`${origin}/echo`, { body: "invalid GET body" }), /method\/body/);
      await assert.rejects(localJsonFetch(`${origin}/echo`, { method: "POST", body: "x".repeat(LOCAL_JSON_FETCH_MAX_BODY_BYTES + 1) }), /exceeds 32 MiB/);
      assert.equal(hits, before);
    });
    console.log(`Verified ${checks} isolated loopback transport checks.`);
  } finally {
    timers.forEach(clearTimeout);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  hasValidBrowserOrigin,
  readObject,
  requestBodyWithinLimit,
  safeReturnTo,
} from "./http";

process.env.SITE_URL = "https://mcp.example.test";

test("browser mutations accept only the configured production origin", () => {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    const allowed = new NextRequest("https://mcp.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://mcp.example.test" },
    });
    const rejected = new NextRequest("https://mcp.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(hasValidBrowserOrigin(allowed), true);
    assert.equal(hasValidBrowserOrigin(rejected), false);
  } finally {
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
  }
});

test("JSON object reader rejects arrays and oversized bodies", async () => {
  const objectRequest = new NextRequest("https://mcp.example.test/api/action", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await readObject(objectRequest), { ok: true });

  const arrayRequest = new NextRequest("https://mcp.example.test/api/action", {
    method: "POST",
    body: "[]",
  });
  assert.equal(await readObject(arrayRequest), null);

  const oversized = new NextRequest("https://mcp.example.test/api/action", {
    method: "POST",
    headers: { "content-length": String(64 * 1024 + 1) },
    body: "{}",
  });
  assert.equal(requestBodyWithinLimit(oversized, 64 * 1024), false);
  assert.equal(await readObject(oversized), null);
});

test("return paths remain same-site", () => {
  assert.equal(safeReturnTo("/oauth/authorize?state=1"), "/oauth/authorize?state=1");
  assert.equal(safeReturnTo("//attacker.example"), "/dashboard");
  assert.equal(safeReturnTo("https://attacker.example"), "/dashboard");
});

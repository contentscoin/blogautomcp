import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/settings/route";
import policy from "./lib/draft-runtime-policy.json";
import { buildChatGptBrowserAutomationEnv, isChatGptBrowserAutomationEnabled } from "../src/lib/chatgpt-browser-automation";

async function main() {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blogautomcp-fixed-settings-"));
  const previousEnv = { ...process.env };
  try {
    process.env.DESKTOP_USER_DATA = testRoot;
    process.env.REMOTE_SITE_URL = "https://fixture.invalid";
    process.env.REMOTE_DEVICE_ID = "fixture";
    process.env.REMOTE_DEVICE_TOKEN = "fixture-not-a-live-token";
    delete process.env.ADMIN_API_KEY;
    const legacy = Object.fromEntries(Object.keys(policy).map((key) => [key, key === "AI_PROVIDER" ? "openai" : "false"]));
    Object.assign(process.env, legacy);
    const envPath = path.join(testRoot, ".env");
    fs.writeFileSync(envPath, Object.entries({ ...legacy, OPENAI_API_KEY: "fixture-secret", NAVER_BLOG_ID: "fixture-blog", UNRELATED: "keep" }).map(([k, v]) => `${k}="${v}"`).join("\n"));
    const before = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
    assert.equal(before.success, true);
    assert.deepEqual(before.data.fixedDraftSettings, policy);
    assert.equal(before.data.codexDraftEnabled, true);
    assert.equal(before.data.browserDraftAutomationEnabled, true);
    for (const key of Object.keys(policy)) {
      assert.equal(before.data.fields.some((field: { key: string }) => field.key === key), false, key);
    }
    assert.equal(before.data.values.OPENAI_API_KEY, "********");
    const saved = await POST(new NextRequest("http://localhost/api/settings", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ values: { ...legacy, OPENAI_API_KEY: "********", NAVER_BLOG_ID: "new-blog", UNAUTHORIZED_KEY: "not-allowed" } }),
    }));
    assert.equal(saved.status, 200);
    const injected = await POST(new NextRequest("http://localhost/api/settings", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ values: { NAVER_BLOG_ID: "ok\nREMOTE_SITE_URL=https://evil.example" } }),
    }));
    assert.equal(injected.status, 400);
    const content = fs.readFileSync(envPath, "utf8");
    for (const [key, value] of Object.entries(policy)) {
      assert.equal(process.env[key], value);
      assert.ok(content.includes(`${key}="${value}"`));
    }
    assert.ok(content.includes('OPENAI_API_KEY="fixture-secret"'));
    assert.ok(content.includes('UNRELATED="keep"'));
    assert.ok(content.includes('NAVER_BLOG_ID="new-blog"'));
    assert.equal(content.includes("UNAUTHORIZED_KEY"), false);
    assert.equal(isChatGptBrowserAutomationEnabled(legacy), true);
    assert.equal(buildChatGptBrowserAutomationEnv(false).BROWSER_GPT_MODE, "false", "Codex routing must not be preempted by web mode");

    // Execute the real desktop bootstrap with legacy settings, without launching Electron.
    const source = fs.readFileSync("scripts/electron/main.cjs", "utf8").replace(/\r\n/g, "\n");
    const bootstrap = source.match(/function configureRuntimePaths\(projectRoot\) \{[\s\S]*?\n\}\n/);
    assert.ok(bootstrap);
    const runtimeEnv = { ...legacy, DATABASE_URL: "file:fixture.db" };
    vm.runInNewContext(`${bootstrap[0]}\nconfigureRuntimePaths('fixture-root');`, {
      process: { env: runtimeEnv, cwd: () => "fixture-root" },
      app: { getPath: () => testRoot, getVersion: () => "fixture" },
      path, fs, APP_BASE_URL: "http://localhost:43127", draftRuntimePolicy: policy,
      require: (name: string) => { assert.equal(name, "dotenv"); return { config: () => undefined }; },
    });
    for (const [key, value] of Object.entries(policy)) assert.equal(runtimeEnv[key as keyof typeof runtimeEnv], value);
    assert.equal((runtimeEnv as Record<string, string>).BROWSER_GPT_MODE, "false");
    const register = source.match(/function registerDeepLinkProtocol\(\) \{[\s\S]*?\n\}\n/);
    assert.ok(register);
    for (const testMode of ["1", "0"]) {
      let registrations = 0;
      vm.runInNewContext(`${register[0]}\nregisterDeepLinkProtocol();`, {
        process: { env: { AUTO_UPDATE_TEST_MODE: testMode } },
        app: { setAsDefaultProtocolClient: () => { registrations += 1; } },
        DEEP_LINK_PROTOCOL: "blogautomcp",
      });
      assert.equal(registrations, testMode === "1" ? 0 : 1);
    }
    console.log("PASS: fixed settings API, legacy migration, secret preservation, desktop bootstrap, Codex-first routing");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    assert.equal(path.dirname(testRoot), path.resolve(os.tmpdir()));
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

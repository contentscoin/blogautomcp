import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lock-regression-"));
  const lockPath = path.join(dir, "chatgpt-profile.lock");
  let listing: string | Error = "INFO: No tasks are running which match the specified criteria.";
  const module = { exports: {} as typeof import("./lib/chatgpt-profile-lock") };
  const deps: Record<string, unknown> = {
    "node:fs": fs, "node:path": path, "node:crypto": crypto,
    "./app-paths": { getSessionStorageDir: () => dir },
    "node:child_process": { execFileSync: () => {
      if (listing instanceof Error) throw listing;
      return listing;
    } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("scripts/lib/chatgpt-profile-lock.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, require: (name: string) => deps[name],
    process: { platform: "win32", pid: process.pid, env: {}, kill: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); } },
    console, setTimeout,
  });
  const seed = () => fs.writeFileSync(lockPath, JSON.stringify({ ownerId: "old", pid: 164968, purpose: "fixture", acquiredAt: "2026-09-14T11:07:29.191Z" }));
  try {
    seed();
    const lock = await module.exports.acquireChatGptProfileLock({ timeoutMs: 200 });
    await lock.release();
    assert.equal(fs.existsSync(lockPath), false, "dead EPERM owner must be recoverable");
    for (const value of ['"chrome.exe","164968","Console","1","1,000 K"', new Error("listing unavailable")]) {
      listing = value;
      seed();
      await assert.rejects(module.exports.acquireChatGptProfileLock({ timeoutMs: 20, pollMs: 10 }), /CHATGPT_BROWSER_BUSY/);
      assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).ownerId, "old", "live or unknown owner must be preserved");
    }
    console.log("PASS Windows EPERM dead-owner recovery, live-owner exclusion, probe-failure preservation");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

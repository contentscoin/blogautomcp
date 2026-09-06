const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/app/api/brandlinks/[id]/auto-publish/route.ts", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let status = "READY", active = 0, executions = 0, finish, cancelEpoch = 0, result;
const mocks = {
  "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
  "@/lib/api-auth": { requireAdminApiKey: req => req.denied ? { status: 403 } : null },
  "@/lib/update-guard": { requireNoPendingDesktopUpdate: () => null },
  "@/lib/db": { prisma: { brandLink: {
    findUnique: async () => ({ status }), count: async () => 0,
  } } },
  "@/lib/desktop-activity": {
    beginAutomaticPublishing: () => { active++; return () => { active--; }; },
    automaticPublishingCancellationCheck: () => { const epoch = cancelEpoch; return () => { if (epoch !== cancelEpoch) throw Error("cancelled"); }; },
  },
  "../../../../../../scripts/lib/scheduled-draft-workflow": {
    localScheduleCall: async () => ({ success: true }),
    runAutomaticDraftWorkflow: async (id, publication, deps) => {
      executions++;
      await new Promise(resolve => { finish = resolve; });
      await deps.call("/publish", "POST", {});
      return result = { status: publication.publishMode === "now" ? "PUBLISHED" : "SCHEDULED" };
    },
  },
};
const mod = { exports: {} };
const sandbox = { module: mod, exports: mod.exports, require: name => {
  if (!(name in mocks)) throw Error("Unexpected dependency: " + name);
  return mocks[name];
}, setTimeout, clearTimeout, console, Map, Date, Number, Promise };
vm.runInNewContext(code, sandbox);
const { POST, GET } = mod.exports;
const params = { params: Promise.resolve({ id: "product-123" }) };
const req = body => ({ json: async () => body });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  assert.equal((await POST({ denied: true }, params)).status, 403);
  assert.equal((await POST(req({ publishMode: "schedule", scheduledDate: "2026-02-31" }), params)).status, 400);
  status = "PUBLISHED";
  assert.equal((await POST(req({ publishMode: "now" }), params)).status, 409);
  status = "READY";
  assert.equal((await POST(req({ publishMode: "now" }), params)).status, 202);
  assert.equal((await POST(req({ publishMode: "now" }), params)).status, 409);
  assert.equal((await GET({}, params)).body.data.status, "running");
  assert.equal(executions, 1);
  finish(); await tick();
  assert.equal((await GET({}, params)).body.data.status, "completed");
  assert.equal(result.status, "PUBLISHED");
  assert.equal(active, 0);
  await POST(req({ publishMode: "schedule", scheduledDate: "2026-10-01" }), params);
  cancelEpoch++;
  finish(); await tick();
  assert.equal((await GET({}, params)).body.data.status, "failed");
  assert.equal(active, 0);
  assert.equal((await GET({}, { params: Promise.resolve({ id: "unknown" }) })).status, 404);
  console.log("Auto publish route: auth, date, duplicate protection, async completion, cancellation, missing-job checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

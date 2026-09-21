import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import vm from "node:vm";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import ts from "typescript";
import sharp from "sharp";
import { readSuccessfulImageAuditReceipt as read, writeSuccessfulImageAuditReceipt as write, invalidateSuccessfulImageAuditReceipt as invalidate, withSuccessfulImageAuditLock } from "./lib/publish-image-audit-receipt";
import type { PublishImageAuditOptions, PublishImageAuditResult } from "./lib/publish-image-audit";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "image-audit-receipt-"));
const priorRoot = process.env.DESKTOP_USER_DATA;
process.env.DESKTOP_USER_DATA = fixtureRoot;
const key = "a".repeat(64);
const alternate = "b".repeat(64);
const receiptFile = (id: string) => path.join(fixtureRoot, "data/publication-image-audit-receipts", crypto.createHash("sha256").update(id).digest("hex") + ".json");
async function main() {
  // Independent processes race first creation of the same appdata signing key.
  await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", `require('./scripts/lib/publish-image-audit-receipt').writeSuccessfulImageAuditReceipt('worker-${i}', '${key}')`],
      { env: { ...process.env, TS_NODE_PROJECT: "tsconfig.scripts.json" }, stdio: "pipe", windowsHide: true });
    let errors = "";
    child.stderr.on("data", chunk => { errors += String(chunk); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(errors)));
  })));
  for (let i = 0; i < 4; i++) assert.equal(read(`worker-${i}`, key), true);
  assert.equal(read("worker-0", alternate), false);
  fs.copyFileSync(receiptFile("worker-0"), receiptFile("wrong-id"));
  assert.equal(read("wrong-id", key), false);
  const row = JSON.parse(fs.readFileSync(receiptFile("worker-0"), "utf8"));
  row.key = alternate;
  fs.writeFileSync(receiptFile("worker-0"), JSON.stringify(row));
  assert.equal(read("worker-0", alternate), false, "tamper cannot create an approval");
  fs.writeFileSync(receiptFile("worker-0"), "malformed");
  assert.equal(read("worker-0", key), false);
  write("invalidate", key); invalidate("invalidate"); assert.equal(read("invalidate", key), false);
  const order: string[] = [];
  await Promise.all([
    withSuccessfulImageAuditLock("serialized", async () => { order.push("start"); await new Promise(resolve => setTimeout(resolve, 200)); write("serialized", key); order.push("pass"); }),
    withSuccessfulImageAuditLock("serialized", async () => { order.push("failure"); invalidate("serialized"); }),
  ]);
  assert.deepEqual(order, ["start", "pass", "failure"]);
  assert.equal(read("serialized", key), false, "later failure wins");

  const holder = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "-e",
    "require('./scripts/lib/publish-image-audit-receipt').withSuccessfulImageAuditLock('crash-owner', async()=>{console.log('ACQUIRED');await new Promise(()=>{});})"],
    { env: { ...process.env, TS_NODE_PROJECT: "tsconfig.scripts.json" }, windowsHide: true, stdio: "pipe" });
  await new Promise<void>((resolve, reject) => { holder.once("error", reject); holder.stdout.on("data", chunk => { if (String(chunk).includes("ACQUIRED")) resolve(); }); });
  const exited = new Promise<void>(resolve => holder.once("exit", () => resolve()));
  holder.kill(); await exited;
  let crashRecovered = false;
  await withSuccessfulImageAuditLock("crash-owner", async () => { crashRecovered = true; });
  assert.equal(crashRecovered, true, "OS releases lock after owner crash, no orphan/reaper state");

  const sourcePath = path.resolve("scripts/lib/publish-image-audit.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const moduleRequire = createRequire(sourcePath);
  let calls = 0;
  let verdict = "accept";
  const provider = async (request: { imagePaths: string[] }) => {
    calls++;
    if (verdict === "auth") throw new Error("CODEX_AUTH_REQUIRED");
    return JSON.stringify({ reviews: request.imagePaths.map((_, index) => ({ index: index + 1, accepted: verdict === "accept", identityMatches: true,
      notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", reason: "fixture selected product" })) });
  };
  const ledgerProbes: Array<Promise<string>> = [];
  const probeLedgerLock = () => {
    const directory = path.resolve(fixtureRoot, "data/publication-image-audit-receipts");
    const identity = crypto.createHash("sha256").update(process.platform === "win32" ? directory.toLowerCase() : directory)
      .update(crypto.createHash("sha256").update("ledger-boundary").digest("hex")).digest("hex");
    const endpoint = process.platform === "win32" ? { path: `\\\\.\\pipe\\blogautomcp-image-audit-${identity}` }
      : { host: "127.0.0.1", port: 32768 + Number.parseInt(identity.slice(0, 4), 16) % 28000, exclusive: true };
    ledgerProbes.push(new Promise(resolve => {
      const server = net.createServer();
      server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code || "UNKNOWN"));
      server.listen(endpoint, () => server.close(() => resolve("UNLOCKED")));
    }));
  };
  const load = (text = source, probeLedger = false) => {
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { exports, Buffer, console, setTimeout, process, require: (id: string) => id === "./codex-draft-provider" ? { runCodexDraft: provider } :
        probeLedger && id === "./publish-image-rejections" ? { clearReviewedPublicationImageRejections: probeLedgerLock, recordPublicationImageRejections: probeLedgerLock } : moduleRequire(id) });
    return (probeLedger ? exports.assertPublishImagesSafe : exports.auditPublishImages) as (options: PublishImageAuditOptions) => Promise<PublishImageAuditResult>;
  };
  const audit = load();
  const image = path.join(fixtureRoot, "image.png");
  const makeImage = async (background: string) => { await sharp({ create: { width: 200, height: 200, channels: 3, background } }).png().toFile(image); };
  await makeImage("white");
  const options = { brandLinkId: "integration", productName: "selected product", composition: { sections: [], renderNodes: [{ kind: "image", role: "thumbnail", sectionId: null, assetPath: image }] } } as unknown as PublishImageAuditOptions;
  assert.equal((await audit(options)).receiptReused, false); assert.equal(calls, 1);
  assert.equal((await audit(options)).receiptReused, true); assert.equal(calls, 1);
  await audit({ ...options, selectedProduct: "different option" }); assert.equal(calls, 2);
  await makeImage("black"); await audit(options); assert.equal(calls, 3);
  const changedPolicy = load(source.replace("final-publication-image-audit/v1", "final-publication-image-audit/v2"));
  await changedPolicy(options); assert.equal(calls, 4);
  const changedPrompt = load(source.replace("Reject announcement/expiry-date tables", "Reject announcement/expiry-date tables with a changed review policy"));
  await changedPrompt(options); assert.equal(calls, 5);
  await audit(options); assert.equal(calls, 6);
  verdict = "reject";
  assert.equal((await audit({ ...options, forceReview: true })).ok, false); assert.equal(calls, 7);
  assert.equal((await audit(options)).ok, false); assert.equal(calls, 8);
  verdict = "accept"; await audit(options); assert.equal(calls, 9);
  verdict = "auth"; await assert.rejects(audit({ ...options, forceReview: true }), /CODEX_AUTH_REQUIRED/);
  verdict = "accept"; await audit(options); assert.equal(calls, 11, "auth revoked prior receipt");
  fs.renameSync(image, image + ".old"); assert.equal((await audit(options)).ok, false);
  fs.renameSync(image + ".old", image); await audit(options); assert.equal(calls, 12);
  await audit({ ...options, review: async request => provider({ imagePaths: request.imagePaths! }) });
  assert.equal(calls, 13, "injected reviewer cannot reuse production receipt");
  assert.equal((await audit(options)).receiptReused, true); assert.equal(calls, 13);
  const bodyOptions = { ...options, brandLinkId: "body-context", composition: {
    sections: [{ id: "body", imageIntent: "전체 구성 또는 패키지 사진" }],
    renderNodes: [{ kind: "image", role: "detail", sectionId: "body", assetPath: image },
      { kind: "heading", sectionId: "body", text: "어떤 제품인지" },
      { kind: "paragraph", sectionId: "body", text: "실제 발행 본문" }],
  } } as unknown as PublishImageAuditOptions;
  await audit(bodyOptions);
  const beforeBody = calls;
  assert.equal((await audit(bodyOptions)).receiptReused, true);
  const paragraph = bodyOptions.composition.renderNodes[2];
  if (paragraph.kind === "paragraph") paragraph.text = "수정한 실제 발행 본문";
  await audit(bodyOptions); assert.equal(calls, beforeBody + 1);
  bodyOptions.composition.renderNodes.reverse();
  await audit(bodyOptions); assert.equal(calls, beforeBody + 2, "render node ordering invalidates");
  await audit({ ...options, brandLinkId: "injected-only", review: async request => provider({ imagePaths: request.imagePaths! }) });
  assert.equal(fs.existsSync(receiptFile("injected-only")), false, "injected reviewer never writes receipts");
  const assertWithLedgerProbe = load(source, true);
  await assertWithLedgerProbe({ ...options, brandLinkId: "ledger-boundary" });
  assert.deepEqual(await Promise.all(ledgerProbes), ["EADDRINUSE", "EADDRINUSE"], "success clearing and rejection recording both remain inside audit lock");
  console.log("image audit receipts: signed/tamper/wrong-id/concurrent key/lock, exact bytes/options/prompts/policy, force failure/auth/missing invalidation and injected reviewer isolation PASS");
}
main().finally(() => { if (priorRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = priorRoot; fs.rmSync(fixtureRoot, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });

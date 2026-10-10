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
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";

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
  let photoClaimMatches = true;
  let inspectRequest: ((request: { imagePaths: string[]; userPrompt: string }) => void) | undefined;
  let inspectGalleryRead: (() => void) | undefined;
  const provider = async (request: { imagePaths: string[]; userPrompt?: string }) => {
    calls++;
    if (verdict === "auth") throw new Error("CODEX_AUTH_REQUIRED");
    const slotLine = request.userPrompt?.split("\n").find(line => line.startsWith("Each attached image belongs ONLY"));
    const finalCount = slotLine ? JSON.parse(slotLine.slice(slotLine.indexOf("["))).length : request.imagePaths.length;
    if (request.userPrompt) inspectRequest?.({ imagePaths: request.imagePaths, userPrompt: request.userPrompt });
    return JSON.stringify({ reviews: request.imagePaths.slice(0, finalCount).map((_, index) => ({ index: index + 1, accepted: verdict === "accept", identityMatches: true, photoClaimMatches,
      notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "fixture selected product" })) });
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
        id === "./selected-gallery-comparison" ? { ...moduleRequire(id), readSelectedGalleryComparisons: async (options: unknown) => {
          const gallery = await moduleRequire(id).readSelectedGalleryComparisons(options);
          inspectGalleryRead?.(); return gallery;
        } } :
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
  const changedPolicy = load(source.replace("final-publication-image-audit/v2-natural-photo", "final-publication-image-audit/v3-test-policy"));
  await changedPolicy(options); assert.equal(calls, 4);
  const changedPrompt = load(source.replace("Every body image must be ONE natural photograph.", "Every body image must be ONE natural photograph with a changed review policy."));
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
  photoClaimMatches = false;
  assert.equal((await audit({ ...bodyOptions, forceReview: true })).ok, false,
    "a positive overall verdict with unsupported photo proof cannot write a success receipt");
  const afterPhotoClaimFailure = calls;
  assert.equal((await audit(bodyOptions)).ok, false);
  assert.equal(calls, afterPhotoClaimFailure + 1, "failed photo-claim check revokes an older receipt and rechecks unchanged bytes");
  photoClaimMatches = true;
  assert.equal((await audit(bodyOptions)).ok, true);
  await audit({ ...options, brandLinkId: "injected-only", review: async request => provider({ imagePaths: request.imagePaths! }) });
  assert.equal(fs.existsSync(receiptFile("injected-only")), false, "injected reviewer never writes receipts");
  const assertWithLedgerProbe = load(source, true);
  await assertWithLedgerProbe({ ...options, brandLinkId: "ledger-boundary" });
  assert.deepEqual(await Promise.all(ledgerProbes), ["EADDRINUSE", "EADDRINUSE"], "success clearing and rejection recording both remain inside audit lock");
  const referenceA = path.join(fixtureRoot, "bound-reference-a.png"), referenceB = path.join(fixtureRoot, "bound-reference-b.png");
  await sharp({ create: { width: 220, height: 180, channels: 3, background: "#bbddcc" } }).png().toFile(referenceA);
  await sharp({ create: { width: 220, height: 180, channels: 3, background: "#aabbcc" } }).png().toFile(referenceB);
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const referenced = { ...bodyOptions, brandLinkId: "bound-reference-receipt", composition: structuredClone(bodyOptions.composition),
    sourceSnapshotId: "selected-receipt-snapshot", imageAssets: [{ path: image, sourcePath: image, sha256: hash(image), role: "body", sectionId: "body",
      provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true,
      referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, sourceSnapshotId: "selected-receipt-snapshot", referencePath: referenceA,
        referenceSha256: hash(referenceA), reviewedOutputSha256: hash(image), reviewStatus: "passed",
        checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(check => [check, true])) } }] } as unknown as PublishImageAuditOptions;
  Object.assign(referenced.composition.sections[0], { imageSource: "staged-ai", imageIntent: "AI 연출 이미지: 생활 공간" });
  const referencedNode = referenced.composition.renderNodes.find(node => node.kind === "image")!;
  Object.assign(referencedNode, { caption: REFERENCE_SCENE_CAPTION, role: "scene" });
  inspectRequest = request => {
    const slotLine = request.userPrompt.split("\n").find(line => line.startsWith("Each attached image belongs ONLY"))!;
    const [slot] = JSON.parse(slotLine.slice(slotLine.indexOf("[")));
    assert.equal(slot.comparisonReferenceImageIndex, 2);
    assert.equal(slot.referenceSha256, referenced.imageAssets![0].referenceScene!.referenceSha256);
    assert.equal(request.imagePaths.length, 2, "receipt protects a request containing the actual final and reference bytes");
  };
  const referenceBeforeCalls = calls;
  assert.equal((await audit(referenced)).ok, true); assert.equal(calls, referenceBeforeCalls + 1);
  const referenceKeyA = JSON.parse(fs.readFileSync(receiptFile(referenced.brandLinkId!), "utf8")).key;
  assert.equal((await audit(referenced)).receiptReused, true); assert.equal(calls, referenceBeforeCalls + 1, "new temporary snapshot paths do not invalidate the exact reference request");
  Object.assign(referenced.imageAssets![0].referenceScene!, { referencePath: referenceB, referenceSha256: hash(referenceB) });
  assert.equal((await audit(referenced)).receiptReused, false); assert.equal(calls, referenceBeforeCalls + 2);
  assert.notEqual(JSON.parse(fs.readFileSync(receiptFile(referenced.brandLinkId!), "utf8")).key, referenceKeyA, "changed bound reference bytes/mapping cannot reuse an older final-image approval");
  const intactReference = fs.readFileSync(referenceB);
  fs.writeFileSync(referenceB, fs.readFileSync(referenceA));
  assert.equal((await audit(referenced)).ok, false); assert.equal(calls, referenceBeforeCalls + 2, "reference byte change without matching proof is rejected before provider");
  assert.equal(fs.existsSync(receiptFile(referenced.brandLinkId!)), false, "a broken reference revokes prior successful receipt");
  fs.writeFileSync(referenceB, intactReference);
  assert.equal((await audit(referenced)).receiptReused, false); assert.equal(calls, referenceBeforeCalls + 3);
  referenced.imageAssets![0].referenceScene!.reviewedOutputSha256 = "f".repeat(64);
  assert.equal((await audit(referenced)).ok, false); assert.equal(calls, referenceBeforeCalls + 3, "an output-proof mismatch cannot pass via a matching old reference receipt");
  const heroIntentOptions = { ...options, brandLinkId: "hero-intent-context", imageAssets: [{ path: image, sourcePath: image,
    sha256: hash(image), role: "hero", imageIntent: "토너 외형 확인", provenance: "PHOTO_TEXT_THUMBNAIL", creationMethod: "local-composite" }] } as PublishImageAuditOptions;
  inspectRequest = request => {
    const line = request.userPrompt.split("\n").find(text => text.startsWith("Each attached image belongs ONLY"))!;
    const [slot] = JSON.parse(line.slice(line.indexOf("[")));
    assert.equal(slot.role, "thumbnail");
    assert.equal(slot.imageIntent, heroIntentOptions.imageAssets![0].imageIntent);
  };
  const beforeHeroIntent = calls;
  assert.equal((await audit(heroIntentOptions)).ok, true); assert.equal(calls, beforeHeroIntent + 1);
  const heroIntentKey = JSON.parse(fs.readFileSync(receiptFile(heroIntentOptions.brandLinkId!), "utf8")).key;
  assert.equal((await audit(heroIntentOptions)).receiptReused, true); assert.equal(calls, beforeHeroIntent + 1);
  heroIntentOptions.imageAssets![0].imageIntent = "유리 바스켓 보기";
  assert.equal((await audit(heroIntentOptions)).receiptReused, false); assert.equal(calls, beforeHeroIntent + 2,
    "unchanged thumbnail bytes cannot reuse approval for a different actual asset intent");
  assert.notEqual(JSON.parse(fs.readFileSync(receiptFile(heroIntentOptions.brandLinkId!), "utf8")).key, heroIntentKey);
  const bodyIntentOptions = { ...bodyOptions, brandLinkId: "body-asset-intent-context", imageAssets: [{ path: image, sourcePath: image,
    sha256: hash(image), role: "body", imageIntent: "Untrusted thumbnail-like asset intent", provenance: "ORIGINAL", creationMethod: "source" }] } as PublishImageAuditOptions;
  inspectRequest = request => {
    const line = request.userPrompt.split("\n").find(text => text.startsWith("Each attached image belongs ONLY"))!;
    const [slot] = JSON.parse(line.slice(line.indexOf("[")));
    assert.equal(slot.imageIntent, bodyIntentOptions.composition.sections[0].imageIntent);
  };
  const beforeBodyIntent = calls;
  assert.equal((await audit(bodyIntentOptions)).ok, true); assert.equal(calls, beforeBodyIntent + 1);
  bodyIntentOptions.imageAssets![0].imageIntent = "Changed irrelevant body asset intent";
  assert.equal((await audit(bodyIntentOptions)).receiptReused, true); assert.equal(calls, beforeBodyIntent + 1,
    "body asset intent is not publication context and cannot replace the actual section intent");
  const galleryUrl = "https://shop-phinf.pstatic.net/selected/whole-kit.png?type=w860";
  const galleryReceipt = `${referenceA}.retrieval.json`;
  fs.writeFileSync(galleryReceipt, JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: galleryUrl,
    sha256: hash(referenceA), retrievedAt: "2025-01-01T00:00:00.000Z", identityVerified: false }));
  const gallerySnapshot = createProductSnapshot({ productId: "gallery-receipt", connectKind: "SHOPPING", externalProductId: "kit-123",
    sourceUrl: "https://brand.naver.com/seller/products/123", product: { name: "selected toner/serum/cream kit", referenceImageUrls: [galleryUrl] } });
  const galleryOptions = { ...options, brandLinkId: "gallery-context", sourceSnapshotId: gallerySnapshot.snapshotId,
    selectedSourceSnapshot: gallerySnapshot, selectedSourceProductId: "gallery-receipt", selectedSourceDirectory: fixtureRoot };
  inspectRequest = request => {
    assert.equal(request.imagePaths.length, 2, "exact cached whole-kit pixels are comparison-only alongside the final thumbnail");
    assert.match(request.userPrompt, /role":"selected-gallery-comparison"/u);
    assert.match(request.userPrompt, /"selectedGalleryComparisonImageIndexes":\[2\]/u);
  };
  const beforeGallery = calls;
  assert.equal((await audit(galleryOptions)).ok, true); assert.equal(calls, beforeGallery + 1);
  const galleryKey = JSON.parse(fs.readFileSync(receiptFile(galleryOptions.brandLinkId!), "utf8")).key;
  assert.equal((await audit(galleryOptions)).receiptReused, true); assert.equal(calls, beforeGallery + 1);
  fs.appendFileSync(galleryReceipt, "\n");
  assert.equal((await audit(galleryOptions)).receiptReused, false); assert.equal(calls, beforeGallery + 2);
  assert.notEqual(JSON.parse(fs.readFileSync(receiptFile(galleryOptions.brandLinkId!), "utf8")).key, galleryKey,
    "unchanged published and comparison pixels cannot reuse a request with different actual retrieval receipt bytes");
  const savedGalleryBytes = fs.readFileSync(referenceA);
  fs.writeFileSync(referenceA, fs.readFileSync(referenceB));
  const modifiedGalleryReceipt = JSON.parse(fs.readFileSync(galleryReceipt, "utf8"));
  modifiedGalleryReceipt.sha256 = hash(referenceA);
  fs.writeFileSync(galleryReceipt, JSON.stringify(modifiedGalleryReceipt));
  assert.equal((await audit(galleryOptions)).receiptReused, false); assert.equal(calls, beforeGallery + 3,
    "new intact source pixels require a fresh final visual verdict, never inherit the old membership verdict");
  fs.writeFileSync(referenceA, savedGalleryBytes);
  modifiedGalleryReceipt.sha256 = hash(referenceA);
  fs.writeFileSync(galleryReceipt, JSON.stringify(modifiedGalleryReceipt));
  for (const changed of ["source", "receipt"] as const) {
    const preservedSource = fs.readFileSync(referenceA), preservedReceipt = fs.readFileSync(galleryReceipt);
    let galleryReads = 0;
    inspectGalleryRead = () => {
      if (++galleryReads !== 4) return; // Final async discovery already returned captured descriptors.
      if (changed === "source") fs.writeFileSync(referenceA, fs.readFileSync(referenceB));
      else fs.appendFileSync(galleryReceipt, "\n");
    };
    try {
      const late = await audit({ ...galleryOptions, brandLinkId: `gallery-final-race-${changed}`, forceReview: true });
      assert.equal(galleryReads, 4); assert.equal(late.ok, false);
      assert.equal(late.failures[0].code, "IMAGE_CHANGED",
        "a stale descriptor returned after await cannot hide a later mutation of an earlier gallery original/receipt");
      assert.equal(fs.existsSync(receiptFile(`gallery-final-race-${changed}`)), false, "late source changes never write approval receipts");
    } finally {
      inspectGalleryRead = undefined;
      fs.writeFileSync(referenceA, preservedSource); fs.writeFileSync(galleryReceipt, preservedReceipt);
    }
  }
  fs.unlinkSync(galleryReceipt);
  inspectRequest = undefined;
  console.log("image audit receipts: signed/tamper/wrong-id/concurrent key/lock, exact bytes/options/prompts/policy, force failure/auth/missing invalidation and injected reviewer isolation PASS");
}
main().finally(() => { if (priorRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = priorRoot; fs.rmSync(fixtureRoot, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });

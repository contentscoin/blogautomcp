import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import vm from "node:vm";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import ts from "typescript";
import sharp from "sharp";
import { readSuccessfulImageAuditReceipt as read, readSuccessfulImageAuditReceiptDetails as details, writeSuccessfulImageAuditReceipt as write, invalidateSuccessfulImageAuditReceipt as invalidate, withSuccessfulImageAuditLock } from "./lib/publish-image-audit-receipt";
import type { PublishImageAuditOptions, PublishImageAuditResult } from "./lib/publish-image-audit";
import { REFERENCE_SCENE_CAPTION, REFERENCE_SCENE_REVIEW_CHECKS, REFERENCE_SCENE_STRATEGY_VERSION } from "../src/lib/brand-post-image-evidence";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { referencePlaneFixtureRow } from "./test-fixtures/reference-plane-review";

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
  const printWarnings=[{nodeIndex:7,sha256:"c".repeat(64),evidenceSha256:"d".repeat(64)}];
  write("print-unverified",key,alternate,printWarnings);
  assert.deepEqual(details("print-unverified",key),{printWarnings});
  assert.equal(details("print-unverified",alternate),null);
  const signedWarning=fs.readFileSync(receiptFile("print-unverified"));
  for(const mutate of [(value:Record<string,unknown>)=>{delete value.printWarnings;},(value:Record<string,unknown>)=>{(value.printWarnings as typeof printWarnings)[0].sha256="e".repeat(64);},
    (value:Record<string,unknown>)=>{(value.printWarnings as typeof printWarnings)[0].nodeIndex=8;},(value:Record<string,unknown>)=>{(value.printWarnings as typeof printWarnings)[0].evidenceSha256="f".repeat(64);}]) {
    const altered=JSON.parse(signedWarning.toString());mutate(altered);fs.writeFileSync(receiptFile("print-unverified"),JSON.stringify(altered));
    assert.equal(read("print-unverified",key),false,"warning removal/target/evidence tampering cannot become an unwarned success");
  }
  fs.writeFileSync(receiptFile("print-unverified"),signedWarning);
  const suspectedWarnings=[{...printWarnings[0],kind:"suspected-omission-uncorroborated" as const}];
  write("suspected-print",key,alternate,suspectedWarnings);assert.deepEqual(details("suspected-print",key),{printWarnings:suspectedWarnings});
  const suspectedBytes=fs.readFileSync(receiptFile("suspected-print"));
  for(const kind of [undefined,"observation-limit","confirmed-missing"]) {
    const changed=JSON.parse(suspectedBytes.toString());if(kind===undefined)delete changed.printWarnings[0].kind;else changed.printWarnings[0].kind=kind;
    fs.writeFileSync(receiptFile("suspected-print"),JSON.stringify(changed));assert.equal(read("suspected-print",key),false,"suspected-omission disclosure cannot be stripped, relabelled or promoted");
  }
  fs.writeFileSync(receiptFile("suspected-print"),suspectedBytes);
  for(const warnings of [[],[...printWarnings,...printWarnings],[{...printWarnings[0],nodeIndex:-1}],[{...printWarnings[0],sha256:"invalid"}],Array.from({length:65},(_,nodeIndex)=>({...printWarnings[0],nodeIndex}))])
    assert.throws(()=>write("bad-warning",key,undefined,warnings),/INVALID_PRINT_WARNINGS/);
  write("legacy-no-warning",key);assert.deepEqual(details("legacy-no-warning",key),{});
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
  let inspectRequest: ((request: { imagePaths: string[]; userPrompt: string; systemPrompt?: string }) => void) | undefined;
  let inspectGalleryRead: (() => void) | undefined;
  let nativePacketCalls = 0;
  const provider = async (request: { imagePaths: string[]; systemPrompt?: string; userPrompt?: string }) => {
    const task = /publication-image-task\/([A-D]-[A-Za-z-]+)/u.exec(request.systemPrompt || "")?.[1];
    // `calls` tracks one fresh audit candidate as the old combined transport
    // did. Native A/C/D are separately counted so receipt reuse must skip ALL
    // packets, rather than merely hiding changed transport cardinality.
    if (!task || task === "A-visible") calls++;
    nativePacketCalls++;
    if (verdict === "auth") throw new Error("CODEX_AUTH_REQUIRED");
    if (task) {
      const data = JSON.parse(request.userPrompt!.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
      if (request.userPrompt) inspectRequest?.({ imagePaths: request.imagePaths, userPrompt: request.userPrompt, systemPrompt:request.systemPrompt });
      if (task === "A-visible") return JSON.stringify({ reason: "Offline selected visible structure", memberBrandScope: "selected-main-product-body", memberBrandObservation: "Offline main physical member",
        visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
          { part: "Contour", referenceObservation: "Offline source contour", candidateObservation: "Offline candidate contour" },
          { part: "Construction", referenceObservation: "Offline source construction", candidateObservation: "Offline candidate construction" }], conflict: "" },
        picturedMemberEvidence: { scope: "pictured-member-only", memberFactIndex: 0, picturedMember: data.selectedSubjectFacts.picturedMemberCandidates[0].memberLabel,
          verdict: "selected-member-visible", selectedFact: data.selectedSubjectFacts.picturedMemberCandidates[0].sourceFact,
          referenceObservation: "Offline selected source member", candidateObservation: "Offline corresponding candidate member", conflict: "" },
        identityMatches: true, accepted: verdict === "accept" });
      if (task === "C-photo-claims") return JSON.stringify({ reason: "Offline published photo claim", photoClaimMatches, intrinsicPrintProofClaim: false,
        photoClaimObjection: photoClaimMatches ? { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" }
          : data.role === "thumbnail" ? { origin: "thumbnail-headline", sourceIndex: null, quote: "Synthetic conflicting headline", scope: "pictured-appearance", conflict: "Offline adverse photo claim" }
            : { origin: "section-body", sourceIndex: 0, quote: data.displayedParagraphs[0].text, scope: "pictured-appearance", conflict: "Offline adverse photo claim" },
        optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] }, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, reviewClass: "product-photo", accepted: true });
      if (task === "D-pixel-format") return JSON.stringify({ reason: "Offline natural photograph", pixelFormatObjection: { kind: "none", location: "", observation: "" },
        notice: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, accepted: true });
      assert.fail("Unexpected native task in receipt-only fixture: " + task);
    }
    if (request.systemPrompt?.includes("blind transcription observer")) {
      calls--; // B's independent unprinted-surface observation is not a new audit candidate.
      return JSON.stringify({ observation: { literal: "", box: null, identifierRole: "none", location: "not-observed", readability: "absent" } });
    }
    const slotLine = request.userPrompt?.split("\n").find(line => line.startsWith("Each attached image belongs ONLY"));
    const slots = slotLine ? JSON.parse(slotLine.slice(slotLine.indexOf("["))) as Array<{ role: string; sectionBody: string[] }> : [];
    const finalCount = slotLine ? slots.length : request.imagePaths.length;
    if (request.userPrompt) inspectRequest?.({ imagePaths: request.imagePaths, userPrompt: request.userPrompt });
    return JSON.stringify({ reviews: request.imagePaths.slice(0, finalCount).map((_, index) => referencePlaneFixtureRow({ userPrompt: request.userPrompt || "" }, { index: index + 1, accepted: verdict === "accept", identityMatches: true, photoClaimMatches,
      photoClaimObjection: photoClaimMatches ? { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" }
        : slots[index]?.role === "thumbnail" ? { origin: "thumbnail-headline", sourceIndex: null, quote: "Synthetic conflicting headline", scope: "pictured-appearance", conflict: "Offline adverse photo claim" }
          : { origin: "section-body", sourceIndex: 0, quote: slots[index]?.sectionBody[0], scope: "pictured-appearance", conflict: "Offline adverse photo claim" },
      notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, textPolicyMatches: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo", reason: "fixture selected product" })) });
  };
  // A ledger hook is synchronous. Scheduling a probe in this process lets its
  // listen event run after the enclosing audit lock closes (a Linux CI race).
  // A separate process must finish its OS bind attempt BEFORE the hook returns.
  const probeOsListener = (endpoint: {path:string} | {host:string;port:number;exclusive:true}): string => execFileSync(process.execPath,["-e",
    "const net=require('node:net');const server=net.createServer();"+
    "const timeout=setTimeout(()=>{process.stderr.write('OS lock probe timed out');process.exit(2)},3000);timeout.unref();"+
    "server.once('error',error=>{process.stdout.write(error.code||'UNKNOWN');});"+
    "server.listen(JSON.parse(process.argv[1]),()=>server.close(()=>process.stdout.write('UNLOCKED')));",
    JSON.stringify(endpoint)],{encoding:"utf8",timeout:5000,windowsHide:true}).trim();
  const ledgerProbes: string[] = [];
  const probeLedgerLock = () => {
    const directory = path.resolve(fixtureRoot, "data/publication-image-audit-receipts");
    const identity = crypto.createHash("sha256").update(process.platform === "win32" ? directory.toLowerCase() : directory)
      .update(crypto.createHash("sha256").update("ledger-boundary").digest("hex")).digest("hex");
    const endpoint = process.platform === "win32" ? { path: `\\\\.\\pipe\\blogautomcp-image-audit-${identity}` }
      : { host: "127.0.0.1", port: 32768 + Number.parseInt(identity.slice(0, 4), 16) % 28000, exclusive: true as const };
    ledgerProbes.push(probeOsListener(endpoint));
  };
  const load = (text = source, probeLedger = false, changedScopedQuestion = false) => {
    const exports: Record<string, unknown> = {};
    let nativeModules: Record<string, Record<string, unknown>> = {};
    const fixtureModule = (id: string): Record<string, unknown> => {
      if (nativeModules[id]) return nativeModules[id];
      const output: Record<string, unknown> = {}; nativeModules[id] = output;
      let fixtureSource = fs.readFileSync(moduleRequire.resolve(id), "utf8");
      if (id === "./publication-image-scoped-review" && changedScopedQuestion) {
        // Mutate the task's stable prefix, not wording retired by a scope change.
        const updated = fixtureSource.replace('"TASK A: ', '"TASK A: [changed offline comparison question] ');
        assert.notEqual(updated, fixtureSource, "the actual isolated question must change"); fixtureSource = updated;
      }
      vm.runInNewContext(ts.transpileModule(fixtureSource, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
      } }).outputText, { exports: output, Buffer, console, setTimeout, process, structuredClone, require: (dependency: string) =>
        dependency === "./codex-draft-provider" ? { runCodexDraft: provider } :
          ["./publication-image-scoped-review", "./intrinsic-identifier-observer"].includes(dependency) ? fixtureModule(dependency) : moduleRequire(dependency) });
      return output;
    };
    const seam = (id: string) => new Proxy({}, { get: (_target, key) => fixtureModule(id)[String(key)] });
    const scopedSeam = seam("./publication-image-scoped-review"), identifierSeam = seam("./publication-identifier-review");
    vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { exports, Buffer, console, setTimeout, process, structuredClone, require: (id: string) => id === "./codex-draft-provider" ? { runCodexDraft: provider } :
        id === "./publication-image-scoped-review" ? scopedSeam : id === "./publication-identifier-review" ? identifierSeam :
        id === "./selected-gallery-comparison" ? { ...moduleRequire(id), readSelectedGalleryComparisons: async (options: unknown) => {
          const gallery = await moduleRequire(id).readSelectedGalleryComparisons(options);
          inspectGalleryRead?.(); return gallery;
        } } :
        probeLedger && id === "./publish-image-rejections" ? { ...moduleRequire(id), clearReviewedPublicationImageRejections: probeLedgerLock,
          recordPublicationImageRejections: probeLedgerLock, recordPublicationImageRegenerationHolds: probeLedgerLock } : moduleRequire(id) });
    const execute = (probeLedger ? exports.assertPublishImagesSafe : exports.auditPublishImages) as (options: PublishImageAuditOptions) => Promise<PublishImageAuditResult>;
    return (options: PublishImageAuditOptions) => {
      // Fresh process-local packet caches model the CLI/process boundary. The
      // persisted signed whole receipt must be the reason for zero calls.
      nativeModules = {};
      return execute(options);
    };
  };
  const audit = load();
  const image = path.join(fixtureRoot, "image.png");
  const ownUrl = "https://shop-phinf.pstatic.net/selected/current.png?type=w860";
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const makeImage = async (background: string) => { await sharp({ create: { width: 200, height: 200, channels: 3, background } }).png().toFile(image);
    fs.writeFileSync(image + ".retrieval.json", JSON.stringify({ version: "product-image-retrieval/v1", sourceUrl: ownUrl, sha256: hash(image), retrievedAt: "2025-01-01T00:00:00.000Z" })); };
  await makeImage("white");
  const ownSnapshot = createProductSnapshot({ productId: "own-receipt", connectKind: "SHOPPING", externalProductId: "123",
    sourceUrl: "https://brand.naver.com/fixture/products/123", product: { name: "selected product", referenceImageUrls: [ownUrl] } });
  const options = { brandLinkId: "integration", productName: "selected product", selectedProduct: JSON.stringify({ selectedTitle: "selected product" }),
    sourceSnapshotId: ownSnapshot.snapshotId, selectedSourceSnapshot: ownSnapshot, selectedSourceProductId: ownSnapshot.productId, selectedSourceDirectory: fixtureRoot,
    composition: { sections: [], renderNodes: [{ kind: "image", role: "thumbnail", sectionId: null, assetPath: image }] } } as unknown as PublishImageAuditOptions;
  assert.equal((await audit(options)).receiptReused, false); assert.equal(calls, 1);
  const firstPackets = nativePacketCalls; assert.equal(firstPackets, 3, "a fresh exact-canonical candidate runs independent A/C/D; deterministic B makes no provider call");
  assert.equal((await audit(options)).receiptReused, true); assert.equal(calls, 1);
  assert.equal(nativePacketCalls, firstPackets, "whole receipt reuse skips every isolated packet");
  await audit({ ...options, selectedProduct: JSON.stringify({ selectedTitle: "different option" }) }); assert.equal(calls, 2);
  await makeImage("black"); await audit(options); assert.equal(calls, 3);
  const changedPolicySource = source.replace(/final-publication-image-audit\/v[\w.-]+/u, "final-publication-image-audit/test-policy");
  assert.notEqual(changedPolicySource, source, "the current policy marker must actually change");
  const changedPolicy = load(changedPolicySource);
  await changedPolicy(options); assert.equal(calls, 4);
  const changedPrompt = load(source, false, true);
  await changedPrompt(options); assert.equal(calls, 5);
  await audit(options); assert.equal(calls, 6);
  verdict = "reject";
  assert.equal((await audit({ ...options, forceReview: true })).ok, false); assert.equal(calls, 7);
  assert.equal((await audit(options)).ok, false); assert.equal(calls, 8);
  verdict = "accept"; await audit(options); assert.equal(calls, 9);
  verdict = "auth"; const authFailure = await audit({ ...options, forceReview: true });
  assert.equal(authFailure.ok, false); assert(authFailure.failures.some(row => row.code === "INVALID_REVIEW" && row.reason.includes("CODEX_AUTH_REQUIRED")));
  assert.equal(fs.existsSync(receiptFile(options.brandLinkId!)), false, "auth failure diagnostics revoke the previous signed receipt");
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
  assert.deepEqual(ledgerProbes, ["EADDRINUSE", "EADDRINUSE", "EADDRINUSE"], "every ledger hook completes its OS probe while the audit lock remains held");
  // Explicitly exercise the TCP path used on Linux even on a Windows host;
  // the production ledger probes above also exercise Windows named pipes.
  const portableListener=net.createServer();
  await new Promise<void>((resolve,reject)=>{portableListener.once("error",reject);portableListener.listen({host:"127.0.0.1",port:0,exclusive:true},resolve);});
  const boundAddress=portableListener.address();assert(boundAddress && typeof boundAddress!=="string");
  const portableEndpoint={host:"127.0.0.1",port:boundAddress.port,exclusive:true as const};
  assert.equal(probeOsListener(portableEndpoint),"EADDRINUSE","a real held TCP listener must block the child synchronously");
  await new Promise<void>((resolve,reject)=>portableListener.close(error=>error?reject(error):resolve()));
  assert.equal(probeOsListener(portableEndpoint),"UNLOCKED","the independent probe must actually bind once the OS listener is released");
  console.log("OS lock probes: all 3 synchronous ledger hooks reject the independent process; held/free TCP controls PASS");
  const referenceA = path.join(fixtureRoot, "bound-reference-a.png"), referenceB = path.join(fixtureRoot, "bound-reference-b.png");
  await sharp({ create: { width: 220, height: 180, channels: 3, background: "#bbddcc" } }).png().toFile(referenceA);
  await sharp({ create: { width: 220, height: 180, channels: 3, background: "#aabbcc" } }).png().toFile(referenceB);
  const referenceUrlA="https://shop-phinf.pstatic.net/selected/bound-a.png",referenceUrlB="https://shop-phinf.pstatic.net/selected/bound-b.png";
  for(const [file,url] of [[referenceA,referenceUrlA],[referenceB,referenceUrlB]]) fs.writeFileSync(`${file}.retrieval.json`,JSON.stringify({version:"product-image-retrieval/v1",sourceUrl:url,sha256:hash(file),retrievedAt:"2025-01-01T00:00:00.000Z"}));
  const referenceSnapshot=createProductSnapshot({productId:ownSnapshot.productId,connectKind:"SHOPPING",externalProductId:"123",sourceUrl:ownSnapshot.sourceUrl,
    product:{name:"selected product",referenceImageUrls:[ownUrl,referenceUrlA,referenceUrlB]}});
  const referenced = { ...bodyOptions, brandLinkId: "bound-reference-receipt", composition: structuredClone(bodyOptions.composition),
    selectedSourceSnapshot:referenceSnapshot,sourceSnapshotId:referenceSnapshot.snapshotId,
    imageAssets: [{ path: image, sourcePath: image, sha256: hash(image), role: "body", sectionId: "body",
      provenance: "GENERATED_SCENE", creationMethod: "reference-guided-scene", remoteGenerated: true,
      referenceScene: { strategyVersion: REFERENCE_SCENE_STRATEGY_VERSION, sourceSnapshotId: referenceSnapshot.snapshotId, referencePath: referenceA,
        referenceSha256: hash(referenceA), reviewedOutputSha256: hash(image), reviewStatus: "passed",
        checks: Object.fromEntries(REFERENCE_SCENE_REVIEW_CHECKS.map(check => [check, true])) } }] } as unknown as PublishImageAuditOptions;
  Object.assign(referenced.composition.sections[0], { imageSource: "staged-ai", imageIntent: "AI 연출 이미지: 생활 공간" });
  const referencedNode = referenced.composition.renderNodes.find(node => node.kind === "image")!;
  Object.assign(referencedNode, { caption: REFERENCE_SCENE_CAPTION, role: "scene" });
  inspectRequest = request => {
    if(!request.systemPrompt?.includes("/A-visible")) return;
    const data=JSON.parse(request.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
    assert.equal(data.candidateSha256,hash(image));
    assert.equal(data.primaryReferenceSha256, referenced.imageAssets![0].referenceScene!.referenceSha256);
    assert.equal(request.imagePaths.length, 2, "isolated A protects this actual final and OWN reference, never another gallery photo");
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
    const data=JSON.parse(request.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
    if(request.systemPrompt?.includes("/C-photo-claims") || request.systemPrompt?.includes("/D-pixel-format")) assert.equal(data.role,"thumbnail");
    assert(!request.userPrompt.includes(heroIntentOptions.imageAssets![0].imageIntent!),"unpublished desired styling is not evidence in any native final task");
  };
  const beforeHeroIntent = calls;
  assert.equal((await audit(heroIntentOptions)).ok, true); assert.equal(calls, beforeHeroIntent + 1);
  const heroIntentKey = JSON.parse(fs.readFileSync(receiptFile(heroIntentOptions.brandLinkId!), "utf8")).key;
  assert.equal((await audit(heroIntentOptions)).receiptReused, true); assert.equal(calls, beforeHeroIntent + 1);
  heroIntentOptions.imageAssets![0].imageIntent = "유리 바스켓 보기";
  const beforeIntentPackets=nativePacketCalls;
  assert.equal((await audit(heroIntentOptions)).receiptReused, true); assert.equal(calls, beforeHeroIntent + 1,
    "unpublished thumbnail styling alone is not a changed photograph or published claim");
  assert.equal(nativePacketCalls,beforeIntentPackets);
  assert.equal(JSON.parse(fs.readFileSync(receiptFile(heroIntentOptions.brandLinkId!), "utf8")).key, heroIntentKey);
  const bodyIntentOptions = { ...bodyOptions, brandLinkId: "body-asset-intent-context", imageAssets: [{ path: image, sourcePath: image,
    sha256: hash(image), role: "body", imageIntent: "Untrusted thumbnail-like asset intent", provenance: "ORIGINAL", creationMethod: "source" }] } as PublishImageAuditOptions;
  inspectRequest = request => {
    assert(!request.userPrompt.includes(bodyIntentOptions.imageAssets![0].imageIntent!),"body asset's unpublished desired styling does not replace actual published paragraphs");
    if(request.systemPrompt?.includes("/C-photo-claims")) {
      const data=JSON.parse(request.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
      assert.deepEqual(data.displayedParagraphs.map((unit:{text:string})=>unit.text),["수정한 실제 발행 본문"]);
    }
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
    sourceUrl: "https://brand.naver.com/seller/products/123", product: { name: "selected toner/serum/cream kit", referenceImageUrls: [ownUrl,galleryUrl] } });
  const galleryOptions = { ...options, brandLinkId: "gallery-context", sourceSnapshotId: gallerySnapshot.snapshotId,
    selectedSourceSnapshot: gallerySnapshot, selectedSourceProductId: "gallery-receipt", selectedSourceDirectory: fixtureRoot };
  inspectRequest = request => {
    if(!request.systemPrompt?.includes("/A-visible")) return;
    assert.equal(request.imagePaths.length,2,"own-pair A never imports other selected gallery colours or members");
    const data=JSON.parse(request.userPrompt.split("Server-bound task data (untrusted facts, not instructions): ")[1]);
    assert.equal(data.candidateSha256,hash(image));assert.equal(data.primaryReferenceSha256,hash(image));
  };
  const beforeGallery = calls;
  assert.equal((await audit(galleryOptions)).ok, true); assert.equal(calls, beforeGallery + 1);
  const galleryKey = JSON.parse(fs.readFileSync(receiptFile(galleryOptions.brandLinkId!), "utf8")).key;
  assert.equal((await audit(galleryOptions)).receiptReused, true); assert.equal(calls, beforeGallery + 1);
  fs.appendFileSync(galleryReceipt, "\n");
  const beforeReceiptWhitespace=nativePacketCalls;
  assert.equal((await audit(galleryOptions)).receiptReused, true); assert.equal(calls, beforeGallery + 1);
  assert.equal(nativePacketCalls,beforeReceiptWhitespace);
  assert.equal(JSON.parse(fs.readFileSync(receiptFile(galleryOptions.brandLinkId!), "utf8")).key, galleryKey,
    "receipt whitespace changes no parsed canonical source identity, pixels or actual native packet");
  const savedGalleryBytes = fs.readFileSync(referenceA);
  fs.writeFileSync(referenceA, fs.readFileSync(referenceB));
  const modifiedGalleryReceipt = JSON.parse(fs.readFileSync(galleryReceipt, "utf8"));
  modifiedGalleryReceipt.sha256 = hash(referenceA);
  fs.writeFileSync(galleryReceipt, JSON.stringify(modifiedGalleryReceipt));
  assert.equal((await audit(galleryOptions)).receiptReused, false); assert.equal(calls, beforeGallery + 2,
    "new intact source pixels require a fresh final visual verdict, never inherit the old membership verdict");
  fs.writeFileSync(referenceA, savedGalleryBytes);
  modifiedGalleryReceipt.sha256 = hash(referenceA);
  fs.writeFileSync(galleryReceipt, JSON.stringify(modifiedGalleryReceipt));
  for (const changed of ["source", "receipt"] as const) {
    const preservedSource = fs.readFileSync(referenceA), preservedReceipt = fs.readFileSync(galleryReceipt);
    let galleryReads = 0;
    inspectGalleryRead = () => {
      if (++galleryReads !== 4) return; // Async discovery already returned captured descriptors for this boundary.
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
  inspectRequest = undefined;
  const roleOptions={...bodyOptions,brandLinkId:"actual-render-role",composition:structuredClone(bodyOptions.composition)};
  const roleInitial=await audit(roleOptions);assert.equal(roleInitial.ok,true);
  const roleInitialKey=JSON.parse(fs.readFileSync(receiptFile(roleOptions.brandLinkId!),"utf8")).key;
  const roleImage=roleOptions.composition.renderNodes.find(node=>node.kind==="image")!;
  const beforeRoleCalls=calls,beforeRolePackets=nativePacketCalls;Object.assign(roleImage,{role:"summary"});
  const changedRole=await audit(roleOptions);
  assert.equal(changedRole.ok,true);assert.equal(changedRole.receiptReused,false);
  assert.equal(calls,beforeRoleCalls+1);assert.equal(nativePacketCalls,beforeRolePackets+3);
  assert.notEqual(JSON.parse(fs.readFileSync(receiptFile(roleOptions.brandLinkId!),"utf8")).key,roleInitialKey,
    "a changed actual rendered role binds new C/D questions even when final bytes and A own pair are unchanged");
  const parsedIdentityOptions={...galleryOptions,brandLinkId:"parsed-source-identity"};
  const initialParsedIdentity=await audit(parsedIdentityOptions);assert.equal(initialParsedIdentity.ok,true);
  assert(initialParsedIdentity.scopedReviews![0].identifierInput!.canonicalReferences.some(row=>row.sha256===hash(referenceA)));
  const beforeParsedIdentity=calls,originalReceiptBytes=fs.readFileSync(galleryReceipt);
  const changedIdentity=JSON.parse(originalReceiptBytes.toString());changedIdentity.sourceUrl="https://shop-phinf.pstatic.net/unselected/not-selected.png";
  fs.writeFileSync(galleryReceipt,JSON.stringify(changedIdentity));
  const changedParsedIdentity=await audit(parsedIdentityOptions);
  assert.equal(changedParsedIdentity.ok,true);assert.equal(changedParsedIdentity.receiptReused,false);assert.equal(calls,beforeParsedIdentity+1);
  assert(!changedParsedIdentity.scopedReviews![0].identifierInput!.canonicalReferences.some(row=>row.sha256===hash(referenceA)),
    "a receipt URL outside the selected snapshot removes that source instead of inheriting canonical status");
  const sourceIdentitySnapshot=createProductSnapshot({productId:gallerySnapshot.productId,connectKind:"SHOPPING",externalProductId:"kit-123",
    sourceUrl:"https://brand.naver.com/changed-seller/products/123",product:gallerySnapshot.product});
  const identityOptions={...galleryOptions,brandLinkId:"source-snapshot-identity"};fs.writeFileSync(galleryReceipt,originalReceiptBytes);
  assert.equal((await audit(identityOptions)).ok,true);const beforeSnapshotIdentity=calls;
  const identityChanged=await audit({...identityOptions,selectedSourceSnapshot:sourceIdentitySnapshot,sourceSnapshotId:sourceIdentitySnapshot.snapshotId});
  assert.equal(identityChanged.ok,true);assert.equal(identityChanged.receiptReused,false);assert.equal(calls,beforeSnapshotIdentity+1,
    "changed parsed source/snapshot identity cannot reuse exact prior visual success for the same image bytes");
  fs.unlinkSync(galleryReceipt);
  console.log("image audit receipts: warning HMAC preservation/tamper, concurrent key/lock, exact native A/C/D/own-source/bytes/role/body/source identity/policy, no requery for unpublished intent or receipt whitespace, force/auth/missing and await byte-change invalidation, no injected authority PASS");
}
main().finally(() => { if (priorRoot === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = priorRoot; fs.rmSync(fixtureRoot, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });

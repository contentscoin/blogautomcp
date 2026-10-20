/** Isolated orchestration checks. No AI, native OCR, generator or live package. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
import { reviewShoppingReferenceScene, SCENE_FIDELITY_CHECKS } from "./lib/shopping-reference-scene";
import { reviewPublicationIdentifiers, type PublicationIdentifierReviewInput } from "./lib/publication-identifier-review";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scene-publication-identifiers-"));
const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let cases = 0;
async function main() {
  const source = path.join(directory, "source.png"), candidate = path.join(directory, "candidate.png"), support = path.join(directory, "support.png"), receipt = path.join(directory, "receipt.json");
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "#303030" } }).png().toFile(source);
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "#353535" } }).png().toFile(candidate);
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "#404040" } }).png().toFile(support);
  fs.writeFileSync(receipt, "immutable offline retrieval proof");
  const before = [source, candidate, support, receipt].map(hash), snapshot = "a".repeat(64);
  const reference = { path: source, sha256: hash(source), subject: "selected visible component", geometry: "observed structure", labels: "no printed word", reviewedAt: "2026-10-21" };
  const supportingReferences = [{ ...reference, path: support, sha256: hash(support), sourceSnapshotId: snapshot,
    sourceUrl: "https://shop-phinf.pstatic.net/offline/detail.png", receiptPath: receipt, receiptSha256: hash(receipt), purpose: "intrinsic-label" as const, reason: "local corresponding face" }];
  const options = { reference, outputPath: candidate, supportingReferences, sourceSnapshotId: snapshot,
    productName: "untrusted expected brand must never prime B", imageIntent: "natural illustration", sectionTitle: "same manuscript", bodyExcerpt: "original text" };
  const checks = Object.fromEntries(SCENE_FIDELITY_CHECKS.map(key => [key, true]));
  const comparisons = Object.fromEntries(["productShape", "intrinsicPrinting", "visibleOption", "sceneContext"].map(key => [key,
    { result: "consistent", variation: "none", referenceObservation: "selected observed component", candidateObservation: "corresponding component", basis: "visible structure comparison" }]));
  const mainPass = { identifierObservation: { candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [] },
    comparisons, checks, identityMatches: true, illustrativeOnly: true, intrinsicPrintProofClaim: false, accepted: true, reason: "matching observed geometry" };
  const neutralB = { sourceImageIndex: 2, sourceSha256: hash(source), sourceObservation: "no intrinsic identifier on this face",
    candidateObservation: "no intrinsic identifier on corresponding face", correspondenceObservation: "same local component surface and visible colour",
    samePhysicalPart: true, samePhysicalSurface: true, sameSelectedVisibleOption: true,
    sourcePrintState: "absent", candidatePrintState: "absent-on-exposed-face", sourceBox: null, candidateBox: null, sourceLiteral: "", identifierRole: "non-identifying",
    sourceRegionCoverage: "not-observed", candidateRegionCoverage: "not-observed", candidateSurfaceCondition: "clearly-exposed-blank",
    candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [], reason: "No local print conflict; geometry is a separate task", accepted: true };

  // Explicit DI uses the real B validator, but its task is never native authority.
  let actualBCalls = 0;
  const diPass = await reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(mainPass), reviewIdentifiers: async input => {
    actualBCalls++;
    const result = await reviewPublicationIdentifiers(input, { review: async () => JSON.stringify(neutralB) });
    assert.equal(result.nativeExecution, false); assert.equal(result.status, "pass"); cases += 2; return result;
  } });
  assert.equal(diPass.reviewStatus, "passed"); assert.equal(actualBCalls, 1); cases += 2;

  const sceneFile = path.resolve("scripts/lib/shopping-reference-scene.ts"), scopedRequire = createRequire(sceneFile);
  const code = ts.transpileModule(fs.readFileSync(sceneFile, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  type Seam = { status: "pass" | "hold" | "conflict" | "unverified"; issue?: string; mutate?: (input: PublicationIdentifierReviewInput) => void; missing?: boolean };
  const load = (answers: unknown[], seam: Seam) => {
    let bCalls = 0, mainCalls = 0;
    const captures: PublicationIdentifierReviewInput[] = [], nativeFlags: boolean[] = [];
    const loaded = { exports: {} };
    vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Buffer, process, Error, console,
      require: (name: string) => name === "./codex-draft-provider" ? { runCodexDraft: async () => JSON.stringify(answers[Math.min(mainCalls++, answers.length - 1)]) }
        : name === "./publication-identifier-review" ? {
          reviewPublicationIdentifiers: async function(input: PublicationIdentifierReviewInput, ...rest: unknown[]) {
            assert.equal(rest.length, 0, "default B receives no injected provider/OCR dependency"); cases++;
            bCalls++; captures.push(json(input)); seam.mutate?.(input);
            return { version: "publication-identifier-review/v1", status: seam.status, reason: "offline independent local print result", nativeExecution: seam.status !== "unverified",
              rawB: "raw B kept unchanged", requestSha256: "b".repeat(64), responseSha256: "c".repeat(64),
              ...(seam.status === "conflict" ? seam.missing ? { missingPrintEvidence: { scope: "same-exposed-corresponding-print-location" } } :
                { identifierConflict: { pair: { sourceLiteral: "exact source", candidateLiteral: "different candidate" } } } : {}) };
          },
          publicationIdentifierReviewEvidenceIssue: (_result: unknown, input: PublicationIdentifierReviewInput, native: boolean) => {
            nativeFlags.push(native); assert.equal(input.candidateSha256, hash(candidate)); return seam.issue ?? null;
          },
        } : name === "./intrinsic-identifier-corroboration" ? { corroborateIntrinsicIdentifierPair: async () => { throw Error("native letter task must be B only, not duplicated from A"); } }
          : scopedRequire(name),
    }, { filename: sceneFile });
    return { api: loaded.exports as { reviewShoppingReferenceScene: typeof reviewShoppingReferenceScene },
      counts: () => ({ bCalls, mainCalls, captures, nativeFlags }) };
  };
  const native = load([mainPass], { status: "pass" });
  assert.equal((await native.api.reviewShoppingReferenceScene(options)).reviewStatus, "passed"); cases++;
  const captured = native.counts();
  assert.equal(captured.bCalls, 1); assert.deepEqual(captured.nativeFlags, [true]);
  assert.deepEqual(captured.captures[0].canonicalReferences.map(row => [row.path, row.sha256, row.sourceSnapshotId]),
    [[source, hash(source), snapshot], [support, hash(support), snapshot]]);
  assert.equal(captured.captures[0].primaryReference.path, source); assert.equal(captured.captures[0].candidatePath, candidate);
  assert.deepEqual(Object.keys(captured.captures[0]).sort(), ["candidatePath", "candidateSha256", "canonicalReferences", "primaryReference", "workspace", "scopeGate"].sort());
  const { scopeGate, ...blindInputs } = captured.captures[0];
  assert.equal(scopeGate!.kind, "scene-native-positive/v1");
  assert.ok(!JSON.stringify(blindInputs).includes(options.productName), "private gate is never a blind observer word hint"); cases += 8;
  const localLimitTask=load([mainPass],{status:"unverified"}),localLimit=await localLimitTask.api.reviewShoppingReferenceScene(options);
  assert.equal(localLimit.reviewStatus,"passed");assert.equal(localLimit.printObservationWarning!.result.status,"unverified");assert.equal(localLimit.printObservationWarning!.result.nativeExecution,false);
  assert.equal(localLimit.printObservationWarning!.input.scopeGate?.kind,"scene-native-positive/v1");assert.equal(localLimitTask.counts().bCalls,1);cases+=5;

  for (const missing of [false, true]) {
    const task = load([mainPass], { status: "conflict", missing });
    await assert.rejects(task.api.reviewShoppingReferenceScene(options), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /^REFERENCE_SCENE_FIDELITY_FAILED:/u);
      const details = error as Error & { originalVerdict: unknown; fidelityFailure: Record<string, unknown>; publicationIdentifierReview: Record<string, unknown>; publicationIdentifierInput: PublicationIdentifierReviewInput };
      assert.deepEqual(json(details.originalVerdict), mainPass, "main favorable booleans are never overwritten");
      assert.equal(details.publicationIdentifierReview.status, "conflict");
      assert.deepEqual(json(details.fidelityFailure), { version: "shopping-scene-fidelity-failure/v1", failedChecks: ["labelHierarchy"],
        comparisonFailures: ["intrinsicPrinting"], identityMatches: false, illustrativeOnly: true, accepted: false });
      assert.equal(details.publicationIdentifierInput.candidateSha256, hash(candidate)); return true;
    }); cases += 5;
  }
  for (const seam of [{ status: "hold" }, { status: "conflict", issue: "forged or uncorroborated B proof" }] as const) {
    const negativeMain = { ...mainPass, identityMatches: false, accepted: false, checks: { ...checks, noFramesOrPanels: false } };
    await assert.rejects(load([negativeMain], seam).api.reviewShoppingReferenceScene(options), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /^REFERENCE_SCENE_REVIEW_INVALID:/u);
      assert.ok(!("fidelityFailure" in error)); assert.deepEqual(json((error as Error & { originalVerdict: unknown }).originalVerdict), negativeMain); return true;
    }); cases += 3;
  }
  // Independent pass never erases any main geometry/option/layout/claim adverse.
  for (const patch of [{ identityMatches: false }, { illustrativeOnly: false }, { checks: { ...checks, silhouette: false } },
    { checks: { ...checks, noAddedText: false } }, { checks: { ...checks, noFramesOrPanels: false } },
    { comparisons: { ...comparisons, visibleOption: { ...comparisons.visibleOption, result: "contradiction" } } }]) {
    const raw = { ...mainPass, ...patch, accepted: false };
    const actualAdverse=load([raw],{status:"pass"});
    await assert.rejects(actualAdverse.api.reviewShoppingReferenceScene(options), error =>
      error instanceof Error && /^REFERENCE_SCENE_FIDELITY_FAILED:/u.test(error.message));
    assert.equal(actualAdverse.counts().mainCalls,1,"an actual geometry/option/claim/format negative never spends the consistency-only retry"); cases+=2;
  }
  const observationOnly = { ...mainPass, identityMatches: false, accepted: false,
    comparisons: { ...comparisons, productShape: { ...comparisons.productShape, result: "unverifiable" } } };
  await assert.rejects(load([observationOnly], { status: "pass" }).api.reviewShoppingReferenceScene(options), /^Error: REFERENCE_SCENE_REVIEW_INVALID:/u); cases++;
  for(const patch of [{identityMatches:false},{illustrativeOnly:false},{checks:{...checks,noFramesOrPanels:false}}]){
    await assert.rejects(load([{...mainPass,...patch,accepted:false}],{status:"unverified"}).api.reviewShoppingReferenceScene(options),/^Error: REFERENCE_SCENE_FIDELITY_FAILED:/u);cases++;
  }
  const retry = load([{ ...mainPass, accepted: false }, mainPass], { status: "pass" });
  assert.equal((await retry.api.reviewShoppingReferenceScene(options)).reviewStatus, "passed");
  assert.equal(retry.counts().bCalls, 1, "main internally inconsistent one-review retry cannot resubmit B"); assert.equal(retry.counts().mainCalls, 2); cases += 3;
  const retryGate=retry.counts().captures[0].scopeGate;
  assert.equal(retryGate?.kind,"scene-native-positive/v1");
  if(retryGate?.kind==="scene-native-positive/v1") assert.deepEqual(JSON.parse(retryGate.rawResponse),mainPass,"B visibility scope receives the final consistent native verdict, never the first accepted-only inconsistency");cases+=2;
  const twiceInconsistent=load([{...mainPass,accepted:false}],{status:"pass"});
  await assert.rejects(twiceInconsistent.api.reviewShoppingReferenceScene(options),/REFERENCE_SCENE_REVIEW_INVALID/u);
  assert.equal(twiceInconsistent.counts().mainCalls,2);assert.equal(twiceInconsistent.counts().bCalls,0,"a second inconsistent raw verdict grants no B/approval/generation work");cases+=3;
  await assert.rejects(load([mainPass], { status: "pass", mutate: input => { input.candidateSha256 = "f".repeat(64); } }).api.reviewShoppingReferenceScene(options), /REFERENCE_SCENE_CHANGED/u); cases++;
  await assert.rejects(load([mainPass], { status: "pass" }).api.reviewShoppingReferenceScene({ ...options, sourceSnapshotId: "e".repeat(64) }), /REFERENCE_SCENE_REVIEW_INVALID/u); cases++;

  // A caller-injected B result cannot mint native fidelity-retry authority.
  await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(mainPass), reviewIdentifiers: async input => {
    const result = await reviewPublicationIdentifiers(input, { review: async () => JSON.stringify(neutralB) });
    return { ...result, status: "conflict", reason: "forged DI conflict" };
  } }), error => error instanceof Error && /^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message) && !("fidelityFailure" in error)); cases++;
  await assert.rejects(reviewShoppingReferenceScene(options,{review:async()=>JSON.stringify(mainPass),reviewIdentifiers:async input=>({...await reviewPublicationIdentifiers(input,{review:async()=>JSON.stringify(neutralB)}),status:"unverified" as const})}),error=>error instanceof Error&&/^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message)&&!("fidelityFailure" in error));cases++;
  assert.deepEqual([source, candidate, support, receipt].map(hash), before); cases++;
  console.log(`PASS scene independent publication identifiers: ${cases} offline checks; native B once, exact source/candidate/snapshot binding, typed negative only, DI/unknown hold, main adverse and all original bytes preserved; provider/generation/live writes 0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

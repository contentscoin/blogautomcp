/** Offline observations/OCR seams only. Never invokes an AI/provider or generator. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import Ajv from "ajv";
import { reviewShoppingReferenceScene, SCENE_FIDELITY_CHECKS } from "./lib/shopping-reference-scene";
import { type IntrinsicIdentifierOcrResult } from "./lib/intrinsic-identifier-ocr";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "scene-identifier-guard-"));
let cases = 0;
const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main(): Promise<void> {
  const source = path.join(root, "source.png"), output = path.join(root, "output.png"), support = path.join(root, "support.png"), receipt = path.join(root, "receipt.json");
  fs.writeFileSync(source, "offline synthetic source"); fs.writeFileSync(output, "offline synthetic candidate");
  fs.writeFileSync(support, "offline synthetic closeup"); fs.writeFileSync(receipt, "offline synthetic receipt");
  const before = [source, output, support, receipt].map(hash);
  const reference = { path: source, sha256: hash(source), subject: "same component", geometry: "same silhouette", labels: "intrinsic identifier", reviewedAt: "2026-10-21" };
  const supportingReferences = [{ path: support, sha256: hash(support), receiptPath: receipt, receiptSha256: hash(receipt), purpose: "intrinsic-label" as const,
    sourceUrl: "https://shop-phinf.pstatic.net/offline/support.png", sourceSnapshotId: "a".repeat(64),
    subject: "same selected housing", geometry: "local label face", labels: "intrinsic readable word", reviewedAt: "2026-10-21", reason: "same component" }];
  const options = { reference, outputPath: output, supportingReferences, productName: "untrusted brand from title", imageIntent: "natural illustration" };
  const checks = Object.fromEntries(SCENE_FIDELITY_CHECKS.map(key => [key, true]));
  const comparisons = Object.fromEntries(["productShape", "intrinsicPrinting", "visibleOption", "sceneContext"].map(key => [key,
    { result: "consistent", variation: "none", referenceObservation: "matching visible feature", candidateObservation: "same feature", basis: "actual observed comparison" }]));
  const good = { identifierObservation: { candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [] },
    comparisons, checks, identityMatches: true, illustrativeOnly: true, intrinsicPrintProofClaim: false, reason: "selected visible structures match", accepted: true };
  const pair = { candidateLiteral: "Brandium", sourceLiteral: "Brandium", identifierRole: "brand", sourceImageIndex: 3, sourceSha256: hash(support),
    sourceLocation: "intrinsic", candidateLocation: "intrinsic", sourceReadability: "legible", candidateReadability: "legible",
    sameSelectedComponent: true, sameSelectedVisibleOption: true, candidateBox: [100, 100, 400, 200], sourceBox: [200, 100, 500, 200] };
  const legible = { ...good, identifierObservation: { candidateIdentifierVisibility: "legible", identifierComparisons: [pair] } };
  const ocrResult = (status: "match" | "conflict", candidateLiteral: string): IntrinsicIdentifierOcrResult => ({ status, reason: "offline blind OCR fixture",
    evidence: { version: "intrinsic-identifier-ocr/v1", nativeExecution: false, sourceLiteral: pair.sourceLiteral, normalizedSourceLiteral: "brandium",
      source: { originalSha256: hash(support), box: [200, 100, 500, 200], pixelBox: { left: 200, top: 100, width: 300, height: 100 }, regionSha256: "1".repeat(64), transcripts: [],
        consensus: { literal: "Brandium", normalized: "brandium", minimumConfidence: 92, presets: ["raw-1x", "gray-normal-invert-2x"] } },
      candidate: { originalSha256: hash(output), box: [100, 100, 400, 200], pixelBox: { left: 100, top: 100, width: 300, height: 100 }, regionSha256: "2".repeat(64), transcripts: [],
        consensus: { literal: candidateLiteral, normalized: candidateLiteral.toLowerCase(), minimumConfidence: 92, presets: ["raw-1x", "gray-normal-invert-2x"] } },
      engine: { binaryPath: "offline", binarySha256: "3".repeat(64), traineddataPath: "offline", traineddataSha256: "4".repeat(64), configHash: "5".repeat(64) } } });
  let schema: unknown;
  const passed = await reviewShoppingReferenceScene(options, { review: async call => {
    schema = call.outputSchema;
    assert.deepEqual(call.imagePaths, [source, output, support]);
    assert.match(call.userPrompt, /Inspect the candidate's own physical product printing FIRST/u);
    assert.match(call.userPrompt, /never autocomplete|Never autocomplete/u);
    assert.match(call.userPrompt, /"primaryReferenceImageIndex":1/u);
    assert.match(call.userPrompt, /"imageIndex":3/u);
    assert.ok(call.userPrompt.indexOf("INDEPENDENT LITERAL OBSERVATION") < call.userPrompt.indexOf("Context (untrusted"));
    cases += 6; return JSON.stringify(good);
  }, identifierOcr: async () => { throw Error("unprinted candidate must not request OCR"); } });
  assert.equal(passed.reviewStatus, "passed"); cases++;
  const validator = new Ajv({ allErrors: true }).compile(schema as object);
  assert.equal(validator(good), true); cases++;
  assert.equal(validator(legible), true); cases++;
  for (const answer of [{ ...good, identifierObservation: undefined }, { ...good, identifierObservation: { candidateIdentifierVisibility: "legible", identifierComparisons: [] } },
    { ...good, identifierObservation: { candidateIdentifierVisibility: "maybe", identifierComparisons: [] } },
    { ...legible, identifierObservation: { candidateIdentifierVisibility: "unreadable", identifierComparisons: [pair] } },
    ...[{ sourceImageIndex: 2 }, { sourceSha256: "0".repeat(64) }, { sourceImageIndex: 9 }, { candidateBox: null }, { candidateLiteral: "" },
      { candidateReadability: "absent" }, { sameSelectedComponent: false }, { sameSelectedVisibleOption: false }, { sourceLocation: "external-badge" }].map(patch =>
      ({ ...legible, identifierObservation: { candidateIdentifierVisibility: "legible", identifierComparisons: [{ ...pair, ...patch }] } }))]) {
    let ocrCalls = 0;
    await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(answer), identifierOcr: async () => { ocrCalls++; return ocrResult("match", "Brandium"); } }),
      error => error instanceof Error && /^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message) && !("fidelityFailure" in error));
    assert.equal(ocrCalls, 0, "invalid observation must not call OCR"); cases++;
  }
  let sawExactSource = false;
  const withWords = await reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(legible), identifierOcr: async request => {
    assert.equal(request.sourcePath, support); assert.equal(request.sourceSha256, hash(support)); assert.equal(request.candidatePath, output);
    assert.deepEqual(request.sourceBox, pair.sourceBox); assert.deepEqual(request.candidateBox, pair.candidateBox);
    assert.ok(!("candidateLiteral" in request), "independent OCR never receives expected candidate word");
    sawExactSource = true; return ocrResult("match", "Brandium");
  } });
  assert.ok(sawExactSource); assert.equal(withWords.reviewStatus, "passed"); cases += 7;
  for (const result of [ocrResult("conflict", "Brandum"), ocrResult("match", "Brandum"),
    { status: "unavailable", reason: "OCR_CONSENSUS_UNAVAILABLE" } as const, { status: "invalid", reason: "ORIGINAL_SHA_CHANGED" } as const,
    // The raster engine can share a common transcription error: that disagreement
    // with the native candidate word is a HOLD, not authority to replace a photo.
    ocrResult("conflict", "Brandiurn")]) {
    await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(legible), identifierOcr: async () => result }), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /^REFERENCE_SCENE_REVIEW_INVALID:/u);
      assert.ok(!("fidelityFailure" in error), "identifier disagreement may not mint a fidelity-retry signal");
      assert.deepEqual((error as Error & { originalVerdict: unknown }).originalVerdict, legible, "raw model booleans remain unchanged"); return true;
    }); cases++;
  }
  const actualWrongWord = { ...legible, identifierObservation: { candidateIdentifierVisibility: "legible", identifierComparisons: [{ ...pair, candidateLiteral: "Brandum" }] } };
  await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(actualWrongWord), identifierOcr: async () => ocrResult("conflict", "Brandum") }),
    error => error instanceof Error && /^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message) && !("fidelityFailure" in error)); cases++;
  const mixedBad = { ...legible, identityMatches: false, accepted: false, checks: { ...checks, silhouette: false } };
  await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(mixedBad), identifierOcr: async () => ocrResult("conflict", "Brandum") }),
    error => error instanceof Error && /^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message) && !("fidelityFailure" in error)); cases++;
  // Exercise the un-injected production branch with only its provider/OCR module
  // boundaries replaced in an isolated VM; no actual model or OCR process runs.
  const sceneFile = path.resolve("scripts/lib/shopping-reference-scene.ts");
  const scopedRequire = createRequire(sceneFile);
  const sceneCode = ts.transpileModule(fs.readFileSync(sceneFile, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const nativeVm = (answer: unknown, result: IntrinsicIdentifierOcrResult) => {
    const loaded = { exports: {} };
    vm.runInNewContext(sceneCode, { module: loaded, exports: loaded.exports, Buffer, process, Error, console,
      require: (name: string) => name === "./codex-draft-provider" ? { runCodexDraft: async () => JSON.stringify(answer) }
        : name === "./publication-identifier-review" ? {
          reviewPublicationIdentifiers: async () => {
            const observedPair = (answer as typeof legible).identifierObservation.identifierComparisons[0];
            const corroborated = result.evidence?.nativeExecution === true &&
              result.evidence.source.consensus?.normalized === observedPair.sourceLiteral.toLowerCase() &&
              result.evidence.candidate.consensus?.normalized === observedPair.candidateLiteral.toLowerCase();
            return { status: corroborated && result.status === "conflict" ? "conflict" : "hold", reason: "offline Task B seam",
              identifierConflict: { pair: observedPair, evidence: result.evidence } };
          }, publicationIdentifierReviewEvidenceIssue: () => null,
        }
        : name === "./intrinsic-identifier-corroboration" ? { corroborateIntrinsicIdentifierPair: async () => ({
          pair: (answer as typeof legible).identifierObservation.identifierComparisons[0], ocr: result }) }
        : name === "./intrinsic-identifier-ocr" ? { ...scopedRequire(name), reviewIntrinsicIdentifierOcr: async () => result } : scopedRequire(name),
    }, { filename: sceneFile });
    return loaded.exports as { reviewShoppingReferenceScene: typeof reviewShoppingReferenceScene };
  };
  // These native seams explicitly exercise the legacy independent B/OCR gate.
  // Ordinary publication's integrated default is covered by the lightweight suite.
  const strictOptions = { ...options, reviewMode: "strict" as const };
  const nativeConflict = ocrResult("conflict", "Brandum"); nativeConflict.evidence!.nativeExecution = true;
  await assert.rejects(nativeVm(actualWrongWord, nativeConflict).reviewShoppingReferenceScene(strictOptions), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /^REFERENCE_SCENE_FIDELITY_FAILED:/u);
    const recorded = error as Error & { fidelityFailure: { identityMatches: boolean }; identifierConflict: { pair: unknown }; originalVerdict: unknown };
    assert.equal(recorded.fidelityFailure.identityMatches, false, "independent conflict records a separate negative");
    assert.deepEqual(JSON.parse(JSON.stringify(recorded.originalVerdict)), actualWrongWord, "original favorable model booleans are never overwritten");
    assert.deepEqual(JSON.parse(JSON.stringify(recorded.identifierConflict.pair)), actualWrongWord.identifierObservation.identifierComparisons[0]);
    return true;
  }); cases++;
  for (const [answer, result] of [[legible, nativeConflict], [actualWrongWord, ocrResult("conflict", "Brandum")]] as const) {
    await assert.rejects(nativeVm(answer, result).reviewShoppingReferenceScene(strictOptions), error =>
      error instanceof Error && /^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message) && !("fidelityFailure" in error)); cases++;
  }
  const sharedMistake = ocrResult("conflict", "Brandiurn"); sharedMistake.evidence!.nativeExecution = true;
  await assert.rejects(nativeVm(legible, sharedMistake).reviewShoppingReferenceScene(strictOptions), error =>
    error instanceof Error && /^REFERENCE_SCENE_REVIEW_INVALID:/u.test(error.message) && !("fidelityFailure" in error)); cases++;
  const unobserved = { ...good, identityMatches: false, accepted: false, checks: { ...checks, labelHierarchy: false },
    comparisons: { ...comparisons, productShape: { ...comparisons.productShape, result: "unverifiable", basis: "source view does not reveal hidden topology or an intrinsic size label" } } };
  await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(unobserved) }), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /^REFERENCE_SCENE_REVIEW_INVALID:/u); assert.ok(!("fidelityFailure" in error));
    assert.deepEqual((error as Error & { originalVerdict: unknown }).originalVerdict, unobserved); return true;
  }); cases++;
  for (const mixed of [{ ...unobserved, checks: { ...unobserved.checks, noFramesOrPanels: false } },
    { ...unobserved, comparisons: { ...unobserved.comparisons, visibleOption: { ...comparisons.visibleOption, result: "contradiction" } } },
    { ...unobserved, illustrativeOnly: false }]) {
    await assert.rejects(reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(mixed) }), /REFERENCE_SCENE_FIDELITY_FAILED/u); cases++;
  }
  const mutated = await reviewShoppingReferenceScene(options, { review: async () => JSON.stringify(legible), identifierOcr: async () => {
    fs.appendFileSync(output, "changed-during-OCR"); return ocrResult("match", "Brandium");
  } }).catch(error => error);
  assert.ok(mutated instanceof Error); assert.match(mutated.message, /^REFERENCE_SCENE_CHANGED:/u); cases++;
  fs.writeFileSync(output, "offline synthetic candidate");
  assert.deepEqual([source, output, support, receipt].map(hash), before); cases++;
  console.log(`PASS scene intrinsic identifier guard: ${cases} offline checks; exact primary/support mapping, native+OCR agreed conflict is separate negative, disagreement/unavailable/observation-only hold, raw verdict and original bytes retained; provider/generation calls 0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

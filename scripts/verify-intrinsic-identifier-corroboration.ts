/** Offline transcription-stage boundaries; never a product approval or authority file. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { corroborateIntrinsicIdentifierPair } from "./lib/intrinsic-identifier-corroboration";
import type { IntrinsicIdentifierPair } from "./lib/intrinsic-identifier-comparison";
import type { IntrinsicIdentifierOcrResult } from "./lib/intrinsic-identifier-ocr";
import { INTRINSIC_IDENTIFIER_OBSERVER_VERSION, intrinsicIdentifierObserverRequestSha256,
  type IntrinsicIdentifierObserverEvidence, type IntrinsicIdentifierObservation } from "./lib/intrinsic-identifier-observer";

const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const sourceSha = "a".repeat(64), candidateSha = "b".repeat(64);
const pair: IntrinsicIdentifierPair = { candidateLiteral: "Voltum", sourceLiteral: "Volt(i)um (unclear source observation)", identifierRole: "brand",
  sourceImageIndex: 4, sourceSha256: sourceSha, sourceLocation: "intrinsic", candidateLocation: "intrinsic", sourceReadability: "legible",
  candidateReadability: "legible", sameSelectedComponent: true, sameSelectedVisibleOption: true,
  sourceBox: [300, 418, 457, 475], candidateBox: [417, 607, 494, 624] };
const consensus = (literal: string) => ({ literal, normalized: literal.toLowerCase(), minimumConfidence: 90, presets: ["raw-1x", "gray-normal-invert-2x"] });
function ocr(status: IntrinsicIdentifierOcrResult["status"], reason: string, source = "Volt", candidate = "Voltum"): IntrinsicIdentifierOcrResult {
  return { status, reason, evidence: { version: "intrinsic-identifier-ocr/v1", nativeExecution: true,
    sourceLiteral: pair.sourceLiteral, normalizedSourceLiteral: pair.sourceLiteral.toLowerCase(),
    source: { originalSha256: sourceSha, box: pair.sourceBox!, pixelBox: { left: 1, top: 1, width: 100, height: 30 }, regionSha256: "c".repeat(64), transcripts: [], consensus: consensus(source) },
    candidate: { originalSha256: candidateSha, box: pair.candidateBox!, pixelBox: { left: 1, top: 1, width: 100, height: 30 }, regionSha256: "d".repeat(64), transcripts: [], consensus: consensus(candidate) },
    engine: { binaryPath: "offline-fixture", binarySha256: "e".repeat(64), traineddataPath: "offline-fixture", traineddataSha256: "f".repeat(64), configHash: "0".repeat(64) } } };
}
function evidence(sha: string, observation: IntrinsicIdentifierObservation): IntrinsicIdentifierObserverEvidence {
  const rawResponse = JSON.stringify({ observation });
  return { version: INTRINSIC_IDENTIFIER_OBSERVER_VERSION, nativeExecution: true, imageSha256: sha,
    requestSha256: intrinsicIdentifierObserverRequestSha256(sha), responseSha256: hash(rawResponse), rawResponse, observation };
}
const sourceObservation: IntrinsicIdentifierObservation = { literal: "Voltium", box: [285, 418, 669, 535], identifierRole: "brand", location: "intrinsic", readability: "legible" };
const candidateObservation: IntrinsicIdentifierObservation = { literal: "Voltum", box: [407, 598, 495, 634], identifierRole: "brand", location: "intrinsic", readability: "legible" };
let checks = 0;
async function exercise(settings: { first?: IntrinsicIdentifierOcrResult; allow?: boolean; patch?: Partial<IntrinsicIdentifierPair>;
  bad?: (value: IntrinsicIdentifierObserverEvidence, index: number) => void; observerStatus?: "observed" | "unavailable" } = {}) {
  const actualPair = { ...pair, ...settings.patch }, before = JSON.stringify(actualPair), observed: unknown[] = [], calls: unknown[] = [];
  const result = await corroborateIntrinsicIdentifierPair({ pair: actualPair, sourcePath: "source.png", candidatePath: "candidate.png",
    candidateSha256: candidateSha, workspace: "offline-qa", allowBlindObservation: settings.allow !== false }, {
    ocr: async options => { calls.push(structuredClone(options)); return calls.length === 1 ? settings.first || ocr("unavailable", "SOURCE_LITERAL_NOT_CONFIRMED") : ocr("conflict", "BLIND_OCR_IDENTIFIER_CONFLICT", "Voltium"); },
    observe: async options => { const index = observed.length; observed.push(structuredClone(options));
      const item = evidence(options.sha256, structuredClone(index === 0 ? sourceObservation : candidateObservation)); settings.bad?.(item, index);
      return { status: settings.observerStatus || "observed", reason: "offline", evidence: item }; },
  });
  assert.equal(JSON.stringify(actualPair), before, "original native literal/ROI and semantic observations are immutable");
  checks++;
  return { result, observed, calls };
}

async function main() {
  const pass = await exercise();
  assert.equal(pass.observed.length, 2); assert.equal(pass.calls.length, 2); assert.equal(pass.result.ocr.status, "conflict");
  assert.equal(pass.result.pair.sourceLiteral, "Voltium"); assert.deepEqual(pass.result.pair.sourceBox, sourceObservation.box);
  assert.equal(pass.result.pair.sourceImageIndex, 4); assert.equal(pass.result.pair.sameSelectedComponent, true);
  assert.equal(pass.result.blindObservations?.source.rawResponse, JSON.stringify({ observation: sourceObservation })); checks += 8;
  for (const request of pass.observed) { assert.deepEqual(Object.keys(request as object).sort(), ["path", "sha256"]); checks++; }
  const direct = await exercise({ first: ocr("conflict", "BLIND_OCR_IDENTIFIER_CONFLICT", "Voltium"), patch: { sourceLiteral: "Voltium" } });
  assert.equal(direct.observed.length, 0); assert.equal(direct.calls.length, 1); checks += 2;
  for (const first of [
    { status: "unavailable", reason: "OCR_RUNTIME_UNAVAILABLE" } as const,
    { status: "invalid", reason: "ORIGINAL_SHA_CHANGED" } as const,
    { status: "unavailable", reason: "OCR_BUDGET_EXHAUSTED" } as const,
    { status: "invalid", reason: "UNSAFE_QA_WORKSPACE" } as const,
    { ...ocr("unavailable", "SOURCE_LITERAL_NOT_CONFIRMED"), evidence: { ...ocr("unavailable", "SOURCE_LITERAL_NOT_CONFIRMED").evidence!, nativeExecution: false } },
  ]) { const held = await exercise({ first }); assert.equal(held.observed.length, 0); assert.equal(held.calls.length, 1); checks += 2; }
  for (const patch of [{ sameSelectedComponent: null }, { sameSelectedVisibleOption: false }, { sourceLocation: "external-badge" as const },
    { sourceReadability: "unreadable" as const }, { identifierRole: "non-identifying" as const }]) {
    const held = await exercise({ patch }); assert.equal(held.calls.length, 0); assert.equal(held.observed.length, 0); checks += 2;
  }
  const disabled = await exercise({ allow: false }); assert.equal(disabled.observed.length, 0); checks++;
  const unavailable = await exercise({ observerStatus: "unavailable" }); assert.equal(unavailable.calls.length, 1); assert.equal(unavailable.result.blindObservations, undefined); checks += 2;
  for (const bad of [
    (value: IntrinsicIdentifierObserverEvidence) => { value.nativeExecution = false; },
    (value: IntrinsicIdentifierObserverEvidence) => { value.imageSha256 = "9".repeat(64); },
    (value: IntrinsicIdentifierObserverEvidence) => { value.requestSha256 = "9".repeat(64); },
    (value: IntrinsicIdentifierObserverEvidence) => { value.responseSha256 = "9".repeat(64); },
    (value: IntrinsicIdentifierObserverEvidence) => { value.rawResponse += " "; },
    (value: IntrinsicIdentifierObserverEvidence) => { value.observation.literal = "Voltium corrected"; },
    (value: IntrinsicIdentifierObserverEvidence) => { const row = { ...value.observation, identifierRole: "sku" as const }; Object.assign(value, evidence(value.imageSha256, row)); },
    (value: IntrinsicIdentifierObserverEvidence) => { const row = { ...value.observation, box: [10, 10, 100, 60] as [number, number, number, number] }; Object.assign(value, evidence(value.imageSha256, row)); },
    (value: IntrinsicIdentifierObserverEvidence) => { const row = { ...value.observation, literal: "", box: null, identifierRole: "none" as const, location: "not-observed" as const, readability: "unreadable" as const }; Object.assign(value, evidence(value.imageSha256, row)); },
  ]) { const held = await exercise({ bad }); assert.equal(held.calls.length, 1); assert.equal(held.result.blindObservations, undefined); checks += 2; }
  console.log(`PASS intrinsic identifier corroboration: ${checks} offline checks; separate blind single-image tasks only for native literal uncertainty, original observations retained, no provider/network/live writes`);
}
void main();

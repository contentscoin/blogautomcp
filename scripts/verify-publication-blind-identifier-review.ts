/** Native orchestration is isolated by module seams; no model/OCR process/live files. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import sharp from "sharp";
import ts from "typescript";
import Ajv from "ajv";
import { reviewPublicationIdentifiers, publicationIdentifierReviewEvidenceIssue, selectBlindPublicationIdentifierSource,
  type PublicationIdentifierReviewInput, type PublicationIdentifierComparison } from "./lib/publication-identifier-review";
import { INTRINSIC_IDENTIFIER_OBSERVER_VERSION, intrinsicIdentifierObserverRequestSha256, serializeIntrinsicIdentifierObserverResponse, type IntrinsicIdentifierObserverEvidence, type IntrinsicIdentifierObservation } from "./lib/intrinsic-identifier-observer";
import { normalizeIntrinsicIdentifierLiteral, type IntrinsicIdentifierOcrEvidence } from "./lib/intrinsic-identifier-ocr";
import type { IdentifierBox } from "./lib/intrinsic-identifier-comparison";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";

const hash = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-blind-pair-"));
const sourceBox: IdentifierBox = [297, 416, 668, 509], candidateBox: IdentifierBox = [414, 608, 488, 635];
let checks = 0;
async function main() {
  const inputs = path.join(root, "inputs"), qa = path.join(root, "qa"); fs.mkdirSync(inputs); fs.mkdirSync(qa);
  const candidate = path.join(inputs, "candidate.png"), primary = path.join(inputs, "primary.png"), detail = path.join(inputs, "detail.png");
  for (const [index, file] of [candidate, primary, detail].entries()) await sharp({ create: {
    width: index === 0 ? 1254 : 860, height: index === 0 ? 1254 : 860, channels: 3, background: `rgb(${60 + index * 40},90,120)`,
  } }).png().toFile(file);
  const binary = path.join(root, "offline-engine"), data = path.join(root, "offline-trained-data");
  fs.writeFileSync(binary, "never executed"); fs.writeFileSync(data, "never loaded by native OCR");
  const initial = [candidate, primary, detail, binary, data].map(fileHash), snapshot = hash("one selected source snapshot");
  const input: PublicationIdentifierReviewInput = { candidatePath: candidate, candidateSha256: fileHash(candidate),
    primaryReference: { path: primary, sha256: fileHash(primary) }, canonicalReferences: [
      { path: primary, sha256: fileHash(primary), sourceSnapshotId: snapshot }, { path: detail, sha256: fileHash(detail), sourceSnapshotId: snapshot },
    ], workspace: qa };
  const observed = (file: string, literal: string, box: IdentifierBox | null, readability: IntrinsicIdentifierObservation["readability"], native = true): IntrinsicIdentifierObserverEvidence => {
    const observation: IntrinsicIdentifierObservation = { literal, box, identifierRole: readability === "legible" ? "brand" : "none",
      location: readability === "legible" ? "intrinsic" : "not-observed", readability };
    const rawResponse = serializeIntrinsicIdentifierObserverResponse(observation), imageSha256 = fileHash(file);
    return { version: INTRINSIC_IDENTIFIER_OBSERVER_VERSION, nativeExecution: native, imageSha256,
      requestSha256: intrinsicIdentifierObserverRequestSha256(imageSha256), responseSha256: hash(rawResponse), rawResponse, observation };
  };
  // Pure picker tests are not native proof: execution/reader validate source
  // receipts, native observations and exact context independently afterwards.
  const vote=(index:number,literal:string,box:IdentifierBox=[100,100,200,150],role:IntrinsicIdentifierObservation["identifierRole"]="brand")=>{
    const evidence=observed(detail,literal,box,"legible");evidence.observation.identifierRole=role;
    return {imageIndex:index,sha256:hash(`distinct canonical source ${index}`),evidence};
  };
  const isolated={candidate:observed(candidate,"unrelated-candidate",candidateBox,"legible"),sources:[vote(2,"misread",[100,100,600,300]),vote(3,"source-word"),vote(4,"source-word",[100,100,250,160])]};
  assert.equal(selectBlindPublicationIdentifierSource(isolated).imageIndex,4,"two exact source-only votes beat a larger singleton word");checks++;
  const noisySources={...isolated,sources:[...isolated.sources,vote(5,"different-singleton")]};
  assert.equal(selectBlindPublicationIdentifierSource(noisySources).imageIndex,4,"unique repeated source reading selects an input despite two distinct noisy singletons; it is not a verdict");checks++;
  const changedCandidate=copy(noisySources);changedCandidate.candidate.observation.literal="different-singleton";
  assert.equal(selectBlindPublicationIdentifierSource(changedCandidate).imageIndex,4,"candidate text cannot influence source selection");checks++;
  for(const literal of ["misread","source-word","unrelated-expected-word"]) {const changed=copy(isolated);changed.candidate.observation.literal=literal;assert.equal(selectBlindPublicationIdentifierSource(changed).imageIndex,4);checks++;}
  const solo={...isolated,sources:[vote(3,"one-observed-source")]};assert.equal(selectBlindPublicationIdentifierSource(solo).imageIndex,3);checks++;
  const mixedRoles={...isolated,sources:[vote(2,"long product title",[10,10,700,300],"product-line"),vote(3,"long product title",[10,10,700,300],"product-line"),vote(4,"physical brand")]};
  for(const literal of ["physical brand","long product title","different letters"]) {
    const changed=copy(mixedRoles);changed.candidate.observation.literal=literal;
    assert.equal(selectBlindPublicationIdentifierSource(changed).imageIndex,4,"role compatibility excludes repeated product titles without using candidate letters");checks++;
  }
  assert.throws(()=>selectBlindPublicationIdentifierSource({...mixedRoles,sources:mixedRoles.sources.slice(0,2)}),/BLIND_SOURCE_IDENTIFIER_ROLE_UNAVAILABLE/);checks++;
  assert.throws(()=>selectBlindPublicationIdentifierSource({...mixedRoles,sources:[mixedRoles.sources[0],vote(3,"brand A"),vote(4,"brand B")]}),/BLIND_SOURCE_LITERAL_CONSENSUS_UNRESOLVED/,"an incompatible OWN primary cannot resolve brand disagreement");checks++;
  const enlarged={...isolated,sources:[vote(2,"Unknown",[352,494,392,510]),vote(3,"tiny misread",[351,565,437,673]),vote(4,"clear source",[297,422,671,533])]};
  for(const literal of ["Unknown","tiny misread","clear source","different candidate"]) {
    const changed=copy(enlarged);changed.candidate.observation.literal=literal;
    assert.equal(selectBlindPublicationIdentifierSource(changed).imageIndex,4,"4x larger source word routes to a clear comparison input, independent of candidate spelling");checks++;
  }
  assert.equal(selectBlindPublicationIdentifierSource({...enlarged,sources:[enlarged.sources[0],vote(3,"A",[100,100,200,150]),vote(4,"B",[100,100,300,199])]}).imageIndex,2,"less than 4x footprint retains primary fallback");checks++;
  assert.equal(selectBlindPublicationIdentifierSource({...enlarged,sources:[...enlarged.sources,vote(5,"external role",[100,100,800,250],"product-line")]}).imageIndex,4,"larger incompatible role cannot override physical brand target");checks++;
  for(const sources of [[vote(2,"A"),vote(3,"B")],[vote(2,"word"),vote(3,"Word")],[vote(2,"word"),vote(3,"word ")],
    [vote(2,"word"),vote(3,"word",[100,100,200,150],"model")],[vote(2,"A"),vote(3,"A"),vote(4,"B"),vote(5,"B")],
  ]) {
    assert.equal(selectBlindPublicationIdentifierSource({...isolated,sources}).imageIndex,2,"gallery disagreement routes only to the exact OWN primary, not a favorable candidate word");checks++;
  }
  const unavailable=[vote(2,"unreadable"),vote(3,"A"),vote(4,"B")];unavailable[0].evidence.observation.readability="unreadable";
  assert.throws(()=>selectBlindPublicationIdentifierSource({...isolated,sources:unavailable}),/BLIND_SOURCE_/);checks++;
  for(const sources of [[],[{...vote(2,"A"),sha256:hash("duplicate")},{...vote(3,"A"),sha256:hash("duplicate")}]] ) {
    assert.throws(()=>selectBlindPublicationIdentifierSource({...isolated,sources}),/BLIND_SOURCE_/);checks++;
  }
  const reordered={...isolated,sources:[isolated.sources[2],isolated.sources[0],isolated.sources[1]]};
  assert.equal(selectBlindPublicationIdentifierSource(reordered).sha256,isolated.sources[2].sha256,"area/index tie break does not count repeated or reordered votes");checks++;
  const sourceWord = "Markora", wrongWord = "Markra";
  const evidence = (literal = wrongWord, sourceLiteral = sourceWord, sourcePath = detail, candidatePath = candidate): IntrinsicIdentifierOcrEvidence => {
    const consensus = (word: string) => ({ literal: word, normalized: normalizeIntrinsicIdentifierLiteral(word), minimumConfidence: 93,
      presets: ["raw-1x", "gray-normal-invert-2x"] });
    return { version: "intrinsic-identifier-ocr/v1", nativeExecution: true, sourceLiteral, normalizedSourceLiteral: normalizeIntrinsicIdentifierLiteral(sourceLiteral),
      source: { originalSha256: fileHash(sourcePath), box: sourceBox, pixelBox: { left: 250, top: 350, width: 330, height: 90 }, regionSha256: hash("source region"), transcripts: [], consensus: consensus(sourceLiteral) },
      candidate: { originalSha256: fileHash(candidatePath), box: candidatePath === sourcePath ? sourceBox : candidateBox,
        pixelBox: candidatePath === sourcePath ? { left: 250, top: 350, width: 330, height: 90 } : { left: 510, top: 750, width: 110, height: 42 },
        regionSha256: hash(candidatePath === sourcePath ? "source region" : "candidate region"), transcripts: [], consensus: consensus(literal) },
      engine: { binaryPath: binary, binarySha256: fileHash(binary), traineddataPath: data, traineddataSha256: fileHash(data), configHash: hash("offline config") } };
  };
  const row = (candidateLiteral = wrongWord): PublicationIdentifierComparison => ({
    sourceImageIndex: 3, sourceSha256: fileHash(detail), sourceObservation: "one actual intrinsic word on the corresponding selected housing face",
    candidateObservation: "actual independent word on that same exposed surface", correspondenceObservation: "same local housing, face and visible colour",
    samePhysicalPart: true, samePhysicalSurface: true, sameSelectedVisibleOption: true, sourcePrintState: "present", candidatePrintState: "present",
    sourceBox, candidateBox, sourceLiteral: sourceWord, identifierRole: "brand", sourceRegionCoverage: "entire-observed-identifier",
    candidateRegionCoverage: "entire-corresponding-print-location", candidateSurfaceCondition: "marked", candidateIdentifierVisibility: "legible",
    identifierComparisons: [{ sourceLiteral: sourceWord, candidateLiteral, identifierRole: "brand", sourceImageIndex: 3, sourceSha256: fileHash(detail),
      sourceLocation: "intrinsic", candidateLocation: "intrinsic", sourceReadability: "legible", candidateReadability: "legible",
      sameSelectedComponent: true, sameSelectedVisibleOption: true, sourceBox, candidateBox }], reason: "local physical correspondence; independent letters remain literal", accepted: true,
  });
  const wrap = (comparison: PublicationIdentifierComparison) => ({ coordinateSpace: "normalized-1000", sourceImageSize: { width: 860, height: 860 },
    candidateImageSize: { width: 1254, height: 1254 }, comparison });
  const moduleFile = path.resolve("scripts/lib/publication-identifier-review.ts"), scopedRequire = createRequire(moduleFile);
  const code = ts.transpileModule(fs.readFileSync(moduleFile, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  type Mode = { observerFailurePath?: string; providerError?: string; comparison?: PublicationIdentifierComparison; raw?: Record<string, unknown>; candidateLiteral?: string; candidateReadability?: IntrinsicIdentifierObservation["readability"];
    sourceReadability?: IntrinsicIdentifierObservation["readability"]; primaryReadability?: IntrinsicIdentifierObservation["readability"]; observeMutate?: (value: IntrinsicIdentifierObserverEvidence) => void;
    ocrMutate?: (value: IntrinsicIdentifierOcrEvidence) => void; requestMutate?: () => void; sourceOnly?: boolean; ocrUnavailable?: boolean; invalidSchema?: boolean };
  const load = (mode: Mode = {}) => {
    let calls = 0, ocrCalls = 0, observeCalls = 0;
    const actualRequests: CodexDraftOptions[] = [], observationInputs: unknown[] = [];
    const loaded = { exports: {} };
    vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Buffer, process, Error, console,
      require: (name: string) => name === "./codex-draft-provider" ? { runCodexDraft: async (call: CodexDraftOptions) => {
        calls++; actualRequests.push(copy(call));
        if (mode.providerError) throw Error(mode.providerError);
        const applicability = call.systemPrompt!.includes("B-print-applicability");
        const expectedSource = mode.candidateReadability === "absent" && mode.primaryReadability === "absent" ? primary : detail;
        assert.deepEqual([...call.imagePaths!], [candidate, expectedSource], "one actual selected local source, never impose other-face printing on an own unprinted face");
        assert.equal(call.maxImages, 2);
        if (!applicability) { assert.match(call.userPrompt, /Coordinates are NOT pixels/u);
          assert.match(call.userPrompt, /NORMALIZED 0\.\.1000/u); assert.match(call.userPrompt, /OCR\/non-read is NOT blank/u); }
        assert.ok(!call.userPrompt.includes("expectedBrand") && !call.userPrompt.includes("selectedTitle")); checks += 5;
        const raw = applicability ? { sourceObservation:"same inner control face is actually unprinted",candidateObservation:"same unprinted inner control face",
          correspondenceObservation:"four buttons and connector identify the SAME physical face",samePhysicalPart:true,samePhysicalSurface:true,sameSelectedVisibleOption:null,
          sourcePrintLocation:"unprinted",candidatePrintLocation:"own-unprinted-face",sourceBox:null,candidateBox:null,witness:"same four buttons and connector on both faces",
          applicability:"not-applicable-own-unprinted-face",accepted:true } : mode.raw || wrap(mode.comparison || row(mode.candidateLiteral || wrongWord));
        // Match the actual JSON transport; cross-VM Array constructors are not
        // semantic differences in an array-valued exact-observation enum.
        assert.equal(new Ajv().compile(copy(call.outputSchema) as object)(raw), !mode.invalidSchema, "two-image coordinate/schema contract"); checks++;
        mode.requestMutate?.(); return JSON.stringify(raw);
      } } : name === "./intrinsic-identifier-observer" ? { ...scopedRequire(name), observeIntrinsicIdentifier: async (options: { path: string; sha256: string }) => {
        observeCalls++; observationInputs.push(copy(options));
        assert.deepEqual(Object.keys(options).sort(), ["path", "sha256"]); checks++;
        if (mode.observerFailurePath === options.path) return { status: "invalid", reason: "OBSERVER_RESPONSE_INVALID", diagnostic: {
          stage: "response", imageSha256: options.sha256, issue: "OBSERVER_BOX_HEIGHT_LIMIT", rawResponse: "unchanged oversized native source reply", responseSha256: hash("unchanged oversized native source reply"),
        } };
        const candidateReadability = mode.candidateReadability || "legible", sourceReadability = mode.sourceReadability || "legible";
        const value = options.path === candidate ? observed(candidate, candidateReadability === "legible" ? mode.candidateLiteral || wrongWord : "", candidateReadability === "legible" ? candidateBox : null, candidateReadability)
          : options.path === primary ? observed(primary, mode.primaryReadability === "legible" ? sourceWord : "", mode.primaryReadability === "legible" ? [300, 420, 360, 445] : null, mode.primaryReadability || "unreadable")
            : observed(detail, sourceReadability === "legible" ? sourceWord : "", sourceReadability === "legible" ? sourceBox : null, sourceReadability);
        mode.observeMutate?.(value); return { status: value.observation.readability === "legible" ? "observed" : "unreadable", reason: "offline independent one-image result", evidence: value };
      } } : name === "./intrinsic-identifier-ocr" ? { ...scopedRequire(name), reviewIntrinsicIdentifierOcr: async (options: { sourcePath: string; candidatePath: string }) => {
        ocrCalls++;
        assert.equal(options.sourcePath, detail);
        if (mode.sourceOnly) assert.equal(options.candidatePath, detail, "a missing mark is NEVER inferred from OCR of the candidate blank");
        else assert.equal(options.candidatePath, candidate);
        checks++;
        if (mode.ocrUnavailable) return { status: "unavailable", reason: "offline unreadable region" };
        const value = mode.sourceOnly ? evidence(sourceWord, sourceWord, detail, detail) : evidence(mode.candidateLiteral || wrongWord);
        mode.ocrMutate?.(value);
        return { status: mode.sourceOnly || mode.candidateLiteral === sourceWord ? "match" : "conflict", reason: "offline blind raster evidence", evidence: value };
      } } : scopedRequire(name),
    }, { filename: moduleFile });
    return { api: loaded.exports as { reviewPublicationIdentifiers: typeof reviewPublicationIdentifiers; publicationIdentifierReviewEvidenceIssue: typeof publicationIdentifierReviewEvidenceIssue },
      counts: () => ({ calls, ocrCalls, observeCalls, actualRequests, observationInputs }) };
  };
  const native = load(); const conflict = await native.api.reviewPublicationIdentifiers(input);
  assert.equal(conflict.status, "conflict"); assert.equal(conflict.nativeExecution, true); assert.equal(conflict.comparison!.accepted, true);
  assert.equal(conflict.identifierConflict!.pair.sourceLiteral, sourceWord); assert.equal(conflict.identifierConflict!.pair.candidateLiteral, wrongWord);
  assert.equal(native.api.publicationIdentifierReviewEvidenceIssue(conflict, input), null); checks += 6;
  assert.equal(conflict.requestSha256, hash(JSON.stringify({ ...native.counts().actualRequests[0], imagePaths: native.counts().actualRequests[0].imagePaths!.map(fileHash) }))); checks++;
  await native.api.reviewPublicationIdentifiers(input); assert.equal(native.counts().calls, 1); assert.equal(native.counts().ocrCalls, 1); assert.equal(native.counts().observeCalls, 3); checks += 3;
  for (const mutate of [
    (value: typeof conflict) => { delete value.blindInputObservations; },
    (value: typeof conflict) => { value.blindInputObservations!.sources[1].evidence.observation.literal = "invented"; },
    (value: typeof conflict) => { value.context!.localPair!.sourceImageIndex = 2; },
    (value: typeof conflict) => { value.context!.localPair!.sourceDimensions.width = 1000; },
    (value: typeof conflict) => { value.blindInputObservations!.sources.reverse(); },
    (value: typeof conflict) => { value.requestSha256 = hash("different pair request"); },
    (value: typeof conflict) => { value.status = "pass"; delete value.identifierConflict; },
  ]) { const changed = copy(conflict); mutate(changed); assert(native.api.publicationIdentifierReviewEvidenceIssue(changed, input)); checks++; }
  for (const patch of [{ samePhysicalPart: false }, { samePhysicalSurface: null }, { sameSelectedVisibleOption: false },
    { sourceBox: [255, 361, 577, 449] as IdentifierBox }, // v4 actual PIXEL box mistakenly returned as normalized.
    { sourceLiteral: `${sourceWord} (uncertain)` }, { candidatePrintState: "not-observed" as const }]) {
    const test = load({ comparison: { ...row(), ...patch }, invalidSchema: "sourceLiteral" in patch }); const held = await test.api.reviewPublicationIdentifiers(input);
    assert.equal(held.status, "hold"); assert.equal(test.counts().ocrCalls, 0); assert.equal(held.identifierConflict, undefined); checks += 3;
  }
  const invalidSourceObserver = load({ observerFailurePath: detail });
  const invalidSourceResult = await invalidSourceObserver.api.reviewPublicationIdentifiers(input);
  assert.equal(invalidSourceResult.status, "hold"); assert.equal(invalidSourceResult.taskDiagnostic!.stage, "source-observer");
  assert.equal(invalidSourceResult.taskDiagnostic!.imageSha256, fileHash(detail));
  assert.equal(invalidSourceResult.taskDiagnostic!.observerDiagnostic!.issue, "OBSERVER_BOX_HEIGHT_LIMIT");
  assert.match(invalidSourceObserver.api.publicationIdentifierReviewEvidenceIssue(invalidSourceResult, input)!, /source-observer.*OBSERVER_RESPONSE_INVALID.*OBSERVER_BOX_HEIGHT_LIMIT/u);
  assert.equal(invalidSourceObserver.counts().calls, 0); assert.equal(invalidSourceObserver.counts().ocrCalls, 0); checks += 7;
  for (const providerError of ["HIGH_DEMAND: service unavailable", "Invalid schema for response_format: array enum unsupported"]) {
    const broken = load({ providerError }); const brokenResult = await broken.api.reviewPublicationIdentifiers(input);
    assert.equal(brokenResult.status, "hold"); assert.equal(brokenResult.taskDiagnostic!.stage, "local-pair");
    assert.equal(brokenResult.taskDiagnostic!.reason, providerError);
    assert.ok(broken.api.publicationIdentifierReviewEvidenceIssue(brokenResult, input)?.includes(providerError));
    assert.equal(broken.counts().calls, 1); assert.equal(broken.counts().ocrCalls, 0);
    assert.equal(brokenResult.identifierConflict, undefined); assert.equal(brokenResult.missingPrintEvidence, undefined); checks += 8;
  }
  const forgedDiagnostic = copy(conflict); delete forgedDiagnostic.blindInputObservations;
  forgedDiagnostic.taskDiagnostic = { stage: "source-observer", imageSha256: fileHash(detail), status: "unavailable", reason: "diagnostic is never authority" };
  assert.ok(native.api.publicationIdentifierReviewEvidenceIssue(forgedDiagnostic, input)); checks++;
  const matched = load({ candidateLiteral: sourceWord }); const match = await matched.api.reviewPublicationIdentifiers(input);
  assert.equal(match.status, "pass"); assert.equal(matched.api.publicationIdentifierReviewEvidenceIssue(match, input), null); checks += 2;
  const negative = load({ candidateLiteral: sourceWord, comparison: { ...row(sourceWord), accepted: false } });
  const heldNegative = await negative.api.reviewPublicationIdentifiers(input); assert.equal(heldNegative.status, "hold"); assert.equal(heldNegative.comparison!.accepted, false); checks += 2;
  for (const mode of [{ ocrUnavailable: true }, { ocrMutate: (value: IntrinsicIdentifierOcrEvidence) => { value.candidate.consensus!.minimumConfidence = 84; } },
    { observeMutate: (value: IntrinsicIdentifierObserverEvidence) => { value.nativeExecution = false; } },
    { observeMutate: (value: IntrinsicIdentifierObserverEvidence) => { value.requestSha256 = hash("different observer instruction"); } },
    { observeMutate: (value: IntrinsicIdentifierObserverEvidence) => { value.rawResponse = JSON.stringify(value.observation); value.responseSha256 = hash(value.rawResponse); } },
    { observeMutate: (value: IntrinsicIdentifierObserverEvidence) => { Object.assign(value, { version: "intrinsic-identifier-observer/v1" }); } }]) {
    const test = load(mode); assert.equal((await test.api.reviewPublicationIdentifiers(input)).status, "hold"); checks++;
  }
  for (const raw of [{ ...wrap(row()), coordinateSpace: "pixels" }, { ...wrap(row()), sourceImageSize: { width: 1000, height: 1000 } }]) {
    const test = load({ raw, invalidSchema: true }); assert.equal((await test.api.reviewPublicationIdentifiers(input)).status, "hold");
    assert.equal(test.counts().ocrCalls, 0); checks += 2;
  }
  const missingRow: PublicationIdentifierComparison = { ...row(), candidatePrintState: "absent-on-exposed-face", candidateIdentifierVisibility: "no-intrinsic-identifiers-observed",
    candidateSurfaceCondition: "clearly-exposed-blank", identifierComparisons: [], accepted: false, reason: "The entire same exposed print location is actually blank" };
  const missing = load({ candidateReadability: "absent", sourceOnly: true, comparison: missingRow });
  const missingResult = await missing.api.reviewPublicationIdentifiers(input);
  assert.equal(missingResult.status, "conflict"); assert.ok(missingResult.missingPrintEvidence); assert.equal(missing.api.publicationIdentifierReviewEvidenceIssue(missingResult, input), null); checks += 3;
  for (const patch of [{ candidateRegionCoverage: "partial" }, { candidateSurfaceCondition: "reflection-or-glare" },
    { candidateSurfaceCondition: "faint-or-unreadable" }, { samePhysicalSurface: false }, { accepted: true }]) {
    const test = load({ candidateReadability: "absent", sourceOnly: true, comparison: { ...missingRow, ...patch } as PublicationIdentifierComparison });
    assert.equal((await test.api.reviewPublicationIdentifiers(input)).status, "hold"); assert.equal(test.counts().ocrCalls, 0); checks += 2;
  }
  const unknown = load({ candidateReadability: "unreadable", sourceOnly: true, comparison: { ...missingRow, accepted: true,
    candidatePrintState: "not-observed", candidateSurfaceCondition: "unknown" } });
  assert.equal((await unknown.api.reviewPublicationIdentifiers(input)).status, "hold"); assert.equal(unknown.counts().ocrCalls, 0); checks += 2;
  const faint = load({ candidateReadability: "unreadable", sourceOnly: true, comparison: { ...missingRow, accepted: true,
    candidatePrintState: "present-unreadable", candidateIdentifierVisibility: "unreadable", candidateSurfaceCondition: "faint-or-unreadable" } });
  const faintResult = await faint.api.reviewPublicationIdentifiers(input);
  assert.equal(faintResult.status, "pass"); assert.equal(faint.api.publicationIdentifierReviewEvidenceIssue(faintResult, input), null); assert.equal(faintResult.missingPrintEvidence, undefined); checks += 3;
  const absentSource = load({ sourceReadability: "unreadable" }); assert.equal((await absentSource.api.reviewPublicationIdentifiers(input)).status, "hold");
  assert.equal(absentSource.counts().calls, 0); checks += 2;
  const unprintedOwn: PublicationIdentifierComparison = { ...row(), sourceImageIndex: 2, sourceSha256: fileHash(primary),
    sourceObservation: "The own selected inner face is actually unprinted", candidateObservation: "That same inner face is actually unprinted",
    correspondenceObservation: "Same local part, surface and visible colour; the other-colour outer logo is not this face",
    sourcePrintState: "absent", candidatePrintState: "absent-on-exposed-face", sourceBox: null, candidateBox: null, sourceLiteral: "", identifierRole: "non-identifying",
    sourceRegionCoverage: "not-observed", candidateRegionCoverage: "not-observed", candidateSurfaceCondition: "clearly-exposed-blank",
    candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [] };
  const own = load({ candidateReadability: "absent", primaryReadability: "absent", comparison: unprintedOwn });
  const ownResult = await own.api.reviewPublicationIdentifiers(input);
  assert.equal(ownResult.status, "pass"); assert.equal(own.api.publicationIdentifierReviewEvidenceIssue(ownResult, input), null);
  assert.equal(ownResult.context!.localPair, undefined); assert.equal(own.counts().ocrCalls, 0); assert.equal(own.counts().calls, 1);
  assert.equal(ownResult.nativeExecution, false); assert.ok(ownResult.ownUnprintedReference); checks += 6;
  for (const mutate of [(value: typeof ownResult) => { value.nativeExecution = true; },
    (value: typeof ownResult) => { value.status = "conflict"; },
    (value: typeof ownResult) => { value.blindInputObservations!.sources[0].evidence.observation.readability = "unreadable"; },
    (value: typeof ownResult) => { value.blindInputObservations!.candidate.nativeExecution = false; },
    (value: typeof ownResult) => { value.ownUnprintedReference!.observationsSha256 = hash("different"); }]) {
    const bad = copy(ownResult); mutate(bad); assert(own.api.publicationIdentifierReviewEvidenceIssue(bad, input)); checks++;
  }
  for (const primaryReadability of ["legible", "unreadable", "ambiguous"] as const) {
    const test = load({ candidateReadability: "absent", primaryReadability, sourceOnly: true, comparison: missingRow });
    const result = await test.api.reviewPublicationIdentifiers(input);
    assert.equal(result.context!.localPair!.sourceImageIndex, 3, "a marked/unreadable/ambiguous primary must not enter both-absent own-face branch");
    assert.equal(test.counts().actualRequests[0].imagePaths![1], detail); checks += 2;
  }
  const unprintedSetTask = load({ candidateReadability: "absent", primaryReadability: "absent", sourceReadability: "absent" });
  const unprintedSet = await unprintedSetTask.api.reviewPublicationIdentifiers(input);
  assert.equal(unprintedSet.status, "pass"); assert.equal(unprintedSet.nativeExecution, false);
  assert.equal(unprintedSet.unprintedReferenceSet?.version, "not-applicable-unprinted-reference-set/v1");
  assert.equal(unprintedSet.context!.localPair, undefined); assert.equal(unprintedSet.comparison, null);
  assert.equal(unprintedSetTask.counts().calls + unprintedSetTask.counts().ocrCalls, 0);
  assert.equal(unprintedSetTask.counts().observeCalls, 3); assert.equal(unprintedSetTask.api.publicationIdentifierReviewEvidenceIssue(unprintedSet, input), null); checks += 8;
  for (const mutate of [
    (value: typeof unprintedSet) => { value.nativeExecution = true; },
    (value: typeof unprintedSet) => { value.status = "conflict"; },
    (value: typeof unprintedSet) => { value.blindInputObservations!.sources[1].evidence.nativeExecution = false; },
    (value: typeof unprintedSet) => { value.blindInputObservations!.candidate.observation.readability = "unreadable"; },
    (value: typeof unprintedSet) => { value.blindInputObservations!.sources.reverse(); },
    (value: typeof unprintedSet) => { value.unprintedReferenceSet!.observationsSha256 = hash("different observation set"); },
  ]) { const bad = copy(unprintedSet); mutate(bad); assert(unprintedSetTask.api.publicationIdentifierReviewEvidenceIssue(bad, input)); checks++; }
  const changedSetInput = copy(input); changedSetInput.canonicalReferences[0].sourceSnapshotId = hash("changed source snapshot");
  assert(unprintedSetTask.api.publicationIdentifierReviewEvidenceIssue(unprintedSet, changedSetInput)); checks++;
  for (const sourceReadability of ["legible", "unreadable", "ambiguous"] as const) {
    const test = load({ candidateReadability: "absent", primaryReadability: "absent", sourceReadability, comparison: unprintedOwn });
    const result = await test.api.reviewPublicationIdentifiers(input);
    assert.equal(result.unprintedReferenceSet, undefined, "one non-absent source prevents set-wide not-applicability");
    assert.equal(test.counts().calls, 1, "own genuinely unprinted SAME face requires its native positive applicability witness");
    assert.ok(result.ownUnprintedReference); checks += 3;
  }
  for (const candidateReadability of ["legible", "unreadable", "ambiguous"] as const) {
    const test = load({ candidateReadability, primaryReadability: "absent", sourceReadability: "absent" });
    const result = await test.api.reviewPublicationIdentifiers(input);
    assert.equal(result.status, "hold"); assert.equal(result.unprintedReferenceSet, undefined); assert.equal(test.counts().calls, 0); checks += 3;
  }
  const injectedUnprintedSet = await reviewPublicationIdentifiers(input, { observe: async options => ({ status: "unreadable", reason: "explicit DI",
    evidence: observed(options.path, "", null, "absent", false) }), review: async () => { throw Error("injected absences cannot make native applicability"); } });
  assert.equal(injectedUnprintedSet.status, "hold"); assert.equal(injectedUnprintedSet.unprintedReferenceSet, undefined); checks += 2;
  const selfInput = { ...input, candidatePath: detail, candidateSha256: fileHash(detail), primaryReference: { path: detail, sha256: fileHash(detail) } };
  const selfTask = load(); const self = await selfTask.api.reviewPublicationIdentifiers(selfInput);
  assert.equal(self.status, "pass"); assert.equal(self.nativeExecution, false); assert.equal(self.exactSourceIdentity?.version, "exact-canonical-source-bytes/v1");
  assert.equal(self.comparison, null); assert.equal(self.rawB, ""); assert.equal(selfTask.counts().calls + selfTask.counts().observeCalls + selfTask.counts().ocrCalls, 0);
  assert.equal(selfTask.api.publicationIdentifierReviewEvidenceIssue(self, selfInput), null); checks += 7;
  for (const mutate of [(value: typeof self) => { value.nativeExecution = true; }, (value: typeof self) => { value.status = "conflict"; },
    (value: typeof self) => { value.exactSourceIdentity!.sourceSnapshotId = hash("another snapshot"); },
    (value: typeof self) => { value.rawB = "fabricated native response"; }, (value: typeof self) => { value.strategyVersion = "blind-two-image/v1"; }]) {
    const bad = copy(self); mutate(bad); assert(selfTask.api.publicationIdentifierReviewEvidenceIssue(bad, selfInput)); checks++;
  }
  const legacy = await reviewPublicationIdentifiers(input, { review: async () => "{}" }); legacy.nativeExecution = true;
  assert(publicationIdentifierReviewEvidenceIssue(legacy, input), "legacy DI cannot claim new native authority"); checks++;
  assert.deepEqual([candidate, primary, detail, binary, data].map(fileHash), initial); checks++;
  console.log(`PASS blind-first local identifier review: ${checks} offline assertions; independent one-image observations, deterministic clear-word source, exactly two comparison images, explicit per-image normalized coordinates, exact-source mechanical skip, native OCR conflict/entire blank, unknown/DI/mutation holds; provider/native OCR/generation/live writes 0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

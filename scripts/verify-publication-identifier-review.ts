/** Offline Task-B packet/negative-authority tests. No provider, live package,
 * HMAC writer, regeneration, approval or publication is called. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import Ajv from "ajv";
import { reviewPublicationIdentifiers, parsePublicationIdentifierComparison, publicationIdentifierReviewEvidenceIssue,
  publicationMissingPrintEvidenceIssue, verifyPublicationIdentifierRegionEvidence, PUBLICATION_IDENTIFIER_REVIEW_SCHEMA,
  type PublicationIdentifierReviewInput, type PublicationIdentifierComparison } from "./lib/publication-identifier-review";
import { normalizeIntrinsicIdentifierLiteral, type IntrinsicIdentifierOcrEvidence } from "./lib/intrinsic-identifier-ocr";
import type { IntrinsicIdentifierPair, IdentifierBox } from "./lib/intrinsic-identifier-comparison";
import type { CodexDraftOptions } from "./lib/codex-draft-provider";
import { intrinsicIdentifierObserverRequestSha256, INTRINSIC_IDENTIFIER_OBSERVER_VERSION, type IntrinsicIdentifierObserverEvidence } from "./lib/intrinsic-identifier-observer";

const hash = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const fileHash = (file: string) => hash(fs.readFileSync(file));
const box: IdentifierBox = [100, 100, 600, 180];
let checks = 0;
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-print-only-"));
  try {
    const inputs = path.join(root, "inputs"), workspace = path.join(root, "qa"), runtime = path.join(root, "runtime");
    for (const dir of [inputs, workspace, runtime]) fs.mkdirSync(dir);
    const candidatePath = path.join(inputs, "candidate.png"), sourcePath = path.join(inputs, "primary.png"), supportPath = path.join(inputs, "support.png");
    for (const [index, file] of [candidatePath, sourcePath, supportPath].entries()) await sharp({ create: { width: 640, height: 480,
      channels: 3, background: `rgb(${100 + index * 40},120,170)` } }).png().toFile(file);
    const binaryPath = path.join(runtime, "offline-engine.bin"), traineddataPath = path.join(runtime, "offline-eng.data");
    fs.writeFileSync(binaryPath, "offline engine bytes, never executed"); fs.writeFileSync(traineddataPath, "offline training bytes");
    const originals = [candidatePath, sourcePath, supportPath, binaryPath, traineddataPath].map(file => ({ file, bytes: fs.readFileSync(file), sha256: fileHash(file) }));
    const snapshot = hash("isolated selected snapshot");
    const input: PublicationIdentifierReviewInput = { candidatePath, candidateSha256: fileHash(candidatePath),
      primaryReference: { path: sourcePath, sha256: fileHash(sourcePath) },
      canonicalReferences: [{ path: sourcePath, sha256: fileHash(sourcePath), sourceSnapshotId: snapshot },
        { path: supportPath, sha256: fileHash(supportPath), sourceSnapshotId: snapshot }], workspace };
    const neutral: PublicationIdentifierComparison = { sourceImageIndex: 2, sourceSha256: fileHash(sourcePath),
      sourceObservation: "The selected visible local face has no intrinsic identifier", candidateObservation: "The corresponding candidate local face has no intrinsic identifier",
      correspondenceObservation: "The locally visible part, surface and colour correspond; hidden whole geometry is not assessed",
      samePhysicalPart: true, samePhysicalSurface: true, sameSelectedVisibleOption: true,
      sourcePrintState: "absent", candidatePrintState: "absent-on-exposed-face", sourceBox: null, candidateBox: null,
      sourceLiteral: "", identifierRole: "non-identifying", sourceRegionCoverage: "not-observed", candidateRegionCoverage: "not-observed",
      candidateSurfaceCondition: "clearly-exposed-blank", candidateIdentifierVisibility: "no-intrinsic-identifiers-observed",
      identifierComparisons: [], reason: "No concrete local print conflict; this is not a whole-product approval", accepted: true };
    const makeInput = () => structuredClone(input);
    let calls = 0, actualPacketDigest = "";
    const callChecks = (call: CodexDraftOptions) => {
      calls++;
      assert.match(call.systemPrompt, /publication-image-task\/B-intrinsic-print/u);
      assert.match(call.systemPrompt, /not a whole-product\/SKU authenticator, geometry reviewer, claim reviewer, format reviewer or image generator/u);
      assert.doesNotMatch(call.systemPrompt + call.userPrompt, /Voltium|Voltum|BYC|selectedTitle|productName|expectedBrand/u);
      assert.deepEqual(call.imagePaths, [candidatePath, sourcePath, supportPath], "candidate first, selected primary second, canonical support deduplicated in exact order");
      assert.equal(call.maxImages, 3); assert.equal(call.preserveImageOrder, true); assert.equal(call.researchMode, "disabled"); assert.equal(call.noTransientRetry, true);
      actualPacketDigest = hash(JSON.stringify({ ...call, imagePaths: call.imagePaths!.map(fileHash) }));
      assert.match(call.userPrompt, /sourceBox must enclose its entire observed word, candidateBox the ENTIRE corresponding location/u);
      assert.match(call.userPrompt, /OCR not reading the candidate never establishes blankness/u);
      assert.equal(new Ajv().compile(call.outputSchema as object)(neutral), true);
    };
    const pass = await reviewPublicationIdentifiers(makeInput(), { review: async call => { callChecks(call); return JSON.stringify(neutral); } });
    assert.equal(calls, 1); assert.equal(pass.status, "pass"); assert.equal(pass.nativeExecution, false); assert.equal(pass.comparison!.accepted, true); checks += 4;
    assert.equal(pass.requestSha256, actualPacketDigest, "digest binds the actual provider packet with image paths replaced by exact ordered original hashes"); checks++;
    assert.equal(publicationIdentifierReviewEvidenceIssue(pass, input, false), null); checks++;
    assert(publicationIdentifierReviewEvidenceIssue(pass, input), "injected B cannot become native HMAC authority"); checks++;
    assert(!("identityMatches" in PUBLICATION_IDENTIFIER_REVIEW_SCHEMA.properties) && !("photoClaimMatches" in PUBLICATION_IDENTIFIER_REVIEW_SCHEMA.properties)); checks++;
    const unreadable = { ...neutral, sourcePrintState: "present" as const, candidatePrintState: "present-unreadable" as const,
      candidateSurfaceCondition: "faint-or-unreadable" as const, candidateIdentifierVisibility: "unreadable" as const,
      sourceObservation: "A small source mark exists but its words are unreadable", candidateObservation: "A real corresponding small mark exists; no absent ink is inferred" };
    for (const verdict of [unreadable, { ...unreadable, accepted: false }]) {
      const result = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify(verdict),
        ocr: async () => { throw Error("unreadable mark must not request missing-print OCR"); } });
      assert.equal(result.status, verdict.accepted ? "pass" : "hold"); assert.equal(result.missingPrintEvidence, undefined); checks += 2;
    }
    for (const field of Object.keys(neutral)) {
      const row: Record<string, unknown> = { ...neutral }; delete row[field];
      assert.equal(parsePublicationIdentifierComparison(JSON.stringify(row), pass.context!), null); checks++;
    }
    for (const patch of [{ extra: "unexpected whole-SKU instruction" }, { accepted: "true" }, { samePhysicalPart: "true" },
      { sourceImageIndex: 1 }, { sourceSha256: hash("other") }, { sourceBox: [0, 0, 1000, 1000] },
      { candidateIdentifierVisibility: "legible" }, { identifierComparisons: [{}] }]) {
      assert.equal(parsePublicationIdentifierComparison(JSON.stringify({ ...neutral, ...patch }), pass.context!), null); checks++;
    }
    const sourceWord = "Markora", candidateWord = "Markra";
    const pair: IntrinsicIdentifierPair = { sourceLiteral: sourceWord, candidateLiteral: candidateWord, identifierRole: "brand", sourceImageIndex: 2,
      sourceSha256: fileHash(sourcePath), sourceLocation: "intrinsic", candidateLocation: "intrinsic", sourceReadability: "legible", candidateReadability: "legible",
      sameSelectedComponent: true, sameSelectedVisibleOption: true, sourceBox: box, candidateBox: box };
    const marked: PublicationIdentifierComparison = { ...neutral, sourcePrintState: "present", candidatePrintState: "present", sourceLiteral: sourceWord,
      identifierRole: "brand", sourceBox: box, candidateBox: box, sourceRegionCoverage: "entire-observed-identifier", candidateRegionCoverage: "entire-corresponding-print-location",
      candidateSurfaceCondition: "marked", candidateIdentifierVisibility: "legible", identifierComparisons: [pair], accepted: true };
    const crop = async (file: string, regionBox: IdentifierBox) => {
      const left = Math.floor(regionBox[0] * 640 / 1000), top = Math.floor(regionBox[1] * 480 / 1000);
      const pixelBox = { left, top, width: Math.ceil(regionBox[2] * 640 / 1000) - left, height: Math.ceil(regionBox[3] * 480 / 1000) - top };
      return { originalSha256: fileHash(file), box: regionBox, pixelBox,
        regionSha256: hash(await sharp(fs.readFileSync(file)).rotate().extract(pixelBox).png().toBuffer()),
        transcripts: [], consensus: null, imageWidth: 640, imageHeight: 480 };
    };
    const makeOcr = async (source: string, candidate: string, sourceLiteral = sourceWord, candidateLiteral = candidateWord): Promise<IntrinsicIdentifierOcrEvidence> => {
      const consensus = (literal: string) => ({ literal, normalized: normalizeIntrinsicIdentifierLiteral(literal), minimumConfidence: 91,
        presets: ["raw-1x", "gray-normal-invert-2x"] });
      return { version: "intrinsic-identifier-ocr/v1", nativeExecution: false, sourceLiteral, normalizedSourceLiteral: normalizeIntrinsicIdentifierLiteral(sourceLiteral),
        source: { ...await crop(source, box), consensus: consensus(sourceLiteral) }, candidate: { ...await crop(candidate, box), consensus: consensus(candidateLiteral) },
        engine: { binaryPath, binarySha256: fileHash(binaryPath), traineddataPath, traineddataSha256: fileHash(traineddataPath), configHash: hash("offline config") } };
    };
    const conflict = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify(marked),
      corroborate: async options => ({ pair: options.pair, ocr: { status: "conflict", reason: "offline actual differing letters", evidence: await makeOcr(sourcePath, candidatePath) } }) });
    assert.equal(conflict.status, "conflict"); assert.equal(conflict.comparison!.accepted, true, "derived print conflict never changes a raw positive boolean");
    assert.equal(conflict.rawB, JSON.stringify(marked)); assert.equal(publicationIdentifierReviewEvidenceIssue(conflict, input, false), null); checks += 4;
    assert(publicationIdentifierReviewEvidenceIssue(conflict, input), "offline OCR/B evidence cannot authorize native generation"); checks++;
    const strippedConflict = structuredClone(conflict); strippedConflict.status = "pass"; delete strippedConflict.identifierConflict;
    assert(publicationIdentifierReviewEvidenceIssue(strippedConflict, input, false), "a real readable conflict cannot become pass by deleting derived evidence"); checks++;
    const matching = { ...marked, identifierComparisons: [{ ...pair, candidateLiteral: sourceWord }] };
    const matched = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify(matching),
      corroborate: async options => ({ pair: options.pair, ocr: { status: "match", reason: "matching actual local letters", evidence: await makeOcr(sourcePath, candidatePath, sourceWord, sourceWord) } }) });
    assert.equal(matched.status, "pass"); assert.equal(matched.identifierMatches!.length, 1);
    assert.equal(publicationIdentifierReviewEvidenceIssue(matched, input, false), null); checks += 3;
    for (const mutate of [
      (value: typeof matched) => { delete value.identifierMatches; },
      (value: typeof matched) => { value.identifierMatches = []; },
      (value: typeof matched) => { value.identifierMatches!.push(structuredClone(value.identifierMatches![0])); },
      (value: typeof matched) => { value.identifierMatches![0].pair.candidateLiteral = candidateWord; },
      (value: typeof matched) => { value.identifierMatches![0].evidence.sourceLiteral = "fabricated source"; },
      (value: typeof matched) => { value.identifierMatches![0].evidence.candidate.consensus!.minimumConfidence = 84; },
      (value: typeof matched) => { value.identifierMatches![0].evidence.candidate.originalSha256 = hash("other image"); },
    ]) { const changed = structuredClone(matched); mutate(changed); assert(publicationIdentifierReviewEvidenceIssue(changed, input, false)); checks++; }
    const observed = (sha256: string, literal: string): IntrinsicIdentifierObserverEvidence => {
      const observation = { literal, box, identifierRole: "brand" as const, location: "intrinsic" as const, readability: "legible" as const };
      const rawResponse = JSON.stringify({ observation });
      return { version: INTRINSIC_IDENTIFIER_OBSERVER_VERSION, nativeExecution: false, imageSha256: sha256,
        requestSha256: intrinsicIdentifierObserverRequestSha256(sha256), responseSha256: hash(rawResponse), rawResponse, observation };
    };
    const blindMatched = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify(marked),
      corroborate: async options => ({ pair: { ...options.pair, sourceLiteral: candidateWord },
        ocr: { status: "match", reason: "independent observations and OCR match actual word", evidence: await makeOcr(sourcePath, candidatePath, candidateWord, candidateWord) },
        blindObservations: { source: observed(fileHash(sourcePath), candidateWord), candidate: observed(input.candidateSha256, candidateWord) } }) });
    assert.equal(blindMatched.status, "pass"); assert.equal(blindMatched.rawB, JSON.stringify(marked), "blind observations never rewrite main raw literal/box/boolean");
    assert.equal(blindMatched.comparison!.identifierComparisons[0].sourceLiteral, sourceWord);
    assert.equal(publicationIdentifierReviewEvidenceIssue(blindMatched, input, false), null);
    assert(publicationIdentifierReviewEvidenceIssue(blindMatched, input), "injected blind positive evidence is not native approval authority"); checks += 5;
    for (const patch of [{ sameSelectedComponent: false }, { sameSelectedVisibleOption: null }, { sourceLocation: "external-badge" as const }]) {
      let extraOcr = 0;
      const held = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify({ ...marked, identifierComparisons: [{ ...pair, ...patch }] }),
        corroborate: async () => { extraOcr++; throw Error("unconfirmed local reference cannot dispatch OCR or become a positive print pass"); } });
      assert.equal(held.status, "hold"); assert.equal(extraOcr, 0); checks += 2;
    }
    const falseButMatching = { ...marked, accepted: false, identifierComparisons: [{ ...pair, candidateLiteral: sourceWord }] };
    const heldNegative = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify(falseButMatching),
      corroborate: async options => ({ pair: options.pair, ocr: { status: "match", reason: "matching letters", evidence: await makeOcr(sourcePath, candidatePath, sourceWord, sourceWord) } }) });
    assert.equal(heldNegative.status, "hold"); assert.equal(heldNegative.comparison!.accepted, false); checks += 2;
    const missing: PublicationIdentifierComparison = { ...marked, identifierComparisons: [], candidateIdentifierVisibility: "no-intrinsic-identifiers-observed",
      candidatePrintState: "absent-on-exposed-face", candidateSurfaceCondition: "clearly-exposed-blank", accepted: false,
      reason: "The whole corresponding exposed local print location is actually blank; not an OCR non-read" };
    let sourceOcrCalls = 0;
    const missingResult = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify(missing), ocr: async options => {
      sourceOcrCalls++; assert.equal(options.sourcePath, sourcePath); assert.equal(options.candidatePath, sourcePath);
      assert.equal(options.candidateSha256, fileHash(sourcePath)); assert.deepEqual(options.candidateBox, box);
      return { status: "match", reason: "source only lettering confirmed", evidence: await makeOcr(sourcePath, sourcePath, sourceWord, sourceWord) };
    } });
    assert.equal(missingResult.status, "conflict"); assert.equal(sourceOcrCalls, 1); assert.equal(missingResult.identifierConflict, undefined);
    assert.equal(publicationIdentifierReviewEvidenceIssue(missingResult, input, false), null); checks += 4;
    assert(publicationIdentifierReviewEvidenceIssue(missingResult, input)); checks++;
    const evidence = missingResult.missingPrintEvidence!;
    const strippedMissing = structuredClone(missingResult); strippedMissing.status = "pass"; delete strippedMissing.missingPrintEvidence;
    assert(publicationIdentifierReviewEvidenceIssue(strippedMissing, input, false)); checks++;
    assert.equal(publicationMissingPrintEvidenceIssue(evidence, missingResult.comparison!, missingResult.context!, false), null); checks++;
    assert.equal(await verifyPublicationIdentifierRegionEvidence(evidence.sourceRegion, sourcePath), true);
    assert.equal(await verifyPublicationIdentifierRegionEvidence(evidence.candidateRegion, candidatePath), true); checks += 2;
    for (const patch of [{ samePhysicalPart: false }, { samePhysicalPart: null }, { samePhysicalSurface: false }, { samePhysicalSurface: null },
      { sameSelectedVisibleOption: false }, { sameSelectedVisibleOption: null }, { candidateSurfaceCondition: "faint-or-unreadable" },
      { candidateSurfaceCondition: "marked" }, { candidateSurfaceCondition: "occluded" }, { candidateSurfaceCondition: "reflection-or-glare" },
      { candidateSurfaceCondition: "unknown" }, { candidateRegionCoverage: "partial" }, { sourceRegionCoverage: "partial" },
      { candidateRegionCoverage: "not-observed" }, { sourcePrintState: "not-observed" }, { candidatePrintState: "present-unreadable" },
      { accepted: true }, { sourceBox: null }, { candidateBox: null }, { identifierRole: "non-identifying" }]) {
      let extraOcr = 0;
      const held = await reviewPublicationIdentifiers(makeInput(), { review: async () => JSON.stringify({ ...missing, ...patch }),
        ocr: async () => { extraOcr++; throw Error("unsafe blank must hold before OCR"); } });
      assert.equal(held.status, "hold"); assert.equal(held.missingPrintEvidence, undefined); assert.equal(extraOcr, 0); checks += 3;
    }
    for (const mutate of [
      (value: typeof evidence) => { value.candidateRegion.regionSha256 = hash("other crop"); },
      (value: typeof evidence) => { value.candidateRegion.pixelBox.left++; },
      (value: typeof evidence) => { value.candidateRegion.box[0]++; },
      (value: typeof evidence) => { value.sourceSha256 = hash("other source"); },
      (value: typeof evidence) => { value.sourceOnlyOcr.candidate.originalSha256 = input.candidateSha256; },
      (value: typeof evidence) => { value.sourceOnlyOcr.sourceLiteral = "unbound literal"; },
      (value: typeof evidence) => { value.sourceOnlyOcr.candidate.regionSha256 = hash("different source crop"); },
      (value: typeof evidence) => { value.sourceOnlyOcr.candidate.pixelBox.left++; },
      (value: typeof evidence) => { value.sourceOnlyOcr.source.consensus!.minimumConfidence = 84.99; },
      (value: typeof evidence) => { value.sourceOnlyOcr.source.consensus!.presets = ["raw-1x", "raw-1x"]; },
      (value: typeof evidence) => { value.sourceOnlyOcrScope = "candidate non-read means blank" as typeof value.sourceOnlyOcrScope; },
    ]) {
      const changed = structuredClone(missingResult); mutate(changed.missingPrintEvidence!);
      if (changed.missingPrintEvidence!.candidateRegion.regionSha256 !== evidence.candidateRegion.regionSha256)
        assert.equal(await verifyPublicationIdentifierRegionEvidence(changed.missingPrintEvidence!.candidateRegion, candidatePath), false);
      else assert(publicationIdentifierReviewEvidenceIssue(changed, input, false));
      checks++;
    }
    for (const mutate of [(value: typeof conflict) => { value.rawB += " "; }, (value: typeof conflict) => { value.requestSha256 = hash("other request"); },
      (value: typeof conflict) => { value.context!.primaryReferenceSha256 = hash("other primary"); },
      (value: typeof conflict) => { value.identifierConflict!.pair.sameSelectedComponent = false; },
      (value: typeof conflict) => { value.identifierConflict!.evidence.candidate.consensus!.normalized = normalizeIntrinsicIdentifierLiteral(sourceWord); },
      (value: typeof conflict) => { value.comparison!.accepted = false; }]) {
      const changed = structuredClone(conflict); mutate(changed); assert(publicationIdentifierReviewEvidenceIssue(changed, input, false)); checks++;
    }
    for (const badInput of [{ ...makeInput(), candidateSha256: hash("wrong") }, { ...makeInput(), expectedBrand: "forbidden expected word" },
      { ...makeInput(), canonicalReferences: [...input.canonicalReferences, { ...input.canonicalReferences[0], sourceSnapshotId: hash("other snapshot") }] },
      { ...makeInput(), canonicalReferences: Array.from({ length: 6 }, () => input.canonicalReferences[0]) }]) {
      let called = 0;
      const held = await reviewPublicationIdentifiers(badInput, { review: async () => { called++; throw Error("unsafe packet must not dispatch"); } });
      assert.equal(held.status, "hold"); assert.equal(called, 0); checks += 2;
    }
    let fiveCalls = 0;
    const fiveReferences = makeInput(); fiveReferences.canonicalReferences = [input.canonicalReferences[1]];
    for (let index = 0; index < 4; index++) {
      const file = path.join(inputs, `extra-selected-reference-${index}.png`);
      await sharp({ create: { width: 640, height: 480, channels: 3, background: `rgb(${30 + index * 20},70,150)` } }).png().toFile(file);
      fiveReferences.canonicalReferences.push({ path: file, sha256: fileHash(file), sourceSnapshotId: snapshot });
    }
    const fiveAccepted = await reviewPublicationIdentifiers(fiveReferences, { review: async call => {
      fiveCalls++; assert.equal(call.imagePaths!.length, 7); assert.equal(new Set(call.imagePaths!.map(fileHash)).size, 7); checks += 2;
      return JSON.stringify(neutral);
    } });
    assert.equal(fiveAccepted.status, "pass"); assert.equal(fiveCalls, 1); checks += 2;
    fs.writeFileSync(sourcePath, Buffer.concat([originals[1].bytes, Buffer.alloc(8 * 1024 * 1024)]));
    const oversized = makeInput(); oversized.primaryReference.sha256 = fileHash(sourcePath); oversized.canonicalReferences[0].sha256 = fileHash(sourcePath);
    let oversizedCalls = 0;
    const oversizedResult = await reviewPublicationIdentifiers(oversized, { review: async () => { oversizedCalls++; throw Error("oversized input must hold before provider"); } });
    assert.equal(oversizedResult.status, "hold"); assert.equal(oversizedCalls, 0); checks += 2;
    fs.writeFileSync(sourcePath, originals[1].bytes);
    const mutableInput = makeInput(), immutableRaw = JSON.stringify(neutral);
    const raced = await reviewPublicationIdentifiers(mutableInput, { review: async () => {
      fs.appendFileSync(candidatePath, "changed during review"); return immutableRaw;
    } });
    assert.equal(raced.status, "hold"); assert.equal(raced.rawB, immutableRaw, "race preserves raw B trace rather than granting authority"); checks += 2;
    fs.writeFileSync(candidatePath, originals[0].bytes);
    const requestRace = await reviewPublicationIdentifiers(makeInput(), { review: async call => { call.imagePaths!.reverse(); return immutableRaw; } });
    assert.equal(requestRace.status, "hold"); checks++;
    const workspaceRaceInput = makeInput();
    const workspaceRace = await reviewPublicationIdentifiers(workspaceRaceInput, { review: async () => { workspaceRaceInput.workspace = root; return immutableRaw; } });
    assert.equal(workspaceRace.status, "hold"); checks++;
    for (const original of originals) assert.equal(fileHash(original.file), original.sha256, "original input/runtime files remain exact"); checks++;
    assert.deepEqual(fs.readdirSync(workspace), [], "mocked B/OCR path creates no proof, crop or authority files"); checks++;
    console.log(`PASS independent publication identifier review: ${checks} offline assertions; local-print task isolation, immutable indexed packets/raw booleans, readable conflicts, native exposed-blank + source-only OCR, uncertain/foreign/malformed holds, no native authority from injection; provider/generation/live mutations0`);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^publication-print-only-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

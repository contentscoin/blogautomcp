/** Pure structural gates; no model, OCR process, source mutation or network. */
import assert from "node:assert/strict";
import { intrinsicIdentifierComparisonIssue, corroboratableIdentifierPairs, intrinsicIdentifierBoxesOverlap, type IntrinsicIdentifierPair } from "./lib/intrinsic-identifier-comparison";
import { referencePlaneComparisonIssue } from "./lib/reference-plane-grounding";
import { normalizeIntrinsicIdentifierLiteral } from "./lib/intrinsic-identifier-ocr";
let checks = 0;
const context = { primaryReferenceImageIndex: 2, primaryReferenceSha256: "a".repeat(64), supplementalReferences: [{ imageIndex: 4, sha256: "b".repeat(64) }] };
const pair: IntrinsicIdentifierPair = { candidateLiteral: "Voltum", sourceLiteral: "Voltium", identifierRole: "brand", sourceImageIndex: 4, sourceSha256: "b".repeat(64),
  sourceLocation: "intrinsic", candidateLocation: "intrinsic", sourceReadability: "legible", candidateReadability: "legible",
  sameSelectedComponent: true, sameSelectedVisibleOption: true, sourceBox: [200, 300, 500, 380], candidateBox: [400, 500, 550, 560] };
const comparison = { primaryReferenceImageIndex: 2, primaryReferenceSha256: "a".repeat(64), primaryObservation: "observed own source", candidateObservation: "observed own candidate",
  objectionKind: "none", evidenceImageIndex: 4, samePhysicalPart: true, samePhysicalSurface: false, sameSelectedVisibleOption: true,
  referencePrintState: "present", candidatePrintState: "present", candidateIdentifierVisibility: "legible", identifierComparisons: [pair], evidenceObservation: "same component's intrinsic brand on another face", basis: "independent words" };
const row = { identityMatches: true, referenceComparison: comparison };
assert.equal(referencePlaneComparisonIssue(row, context), null); assert.equal(corroboratableIdentifierPairs(comparison).length, 1); checks += 2;
for (const patch of [{ candidateIdentifierVisibility: "unreadable" }, { candidatePrintState: "not-observed" }, { candidatePrintState: "present-unreadable" },
  { identifierComparisons: [] }, { identifierComparisons: [pair, pair, pair] }, { candidateIdentifierVisibility: undefined }]) {
  assert.ok(intrinsicIdentifierComparisonIssue({ ...comparison, ...patch }, context)); checks++;
}
for (const patch of [{ sourceImageIndex: 8 }, { sourceSha256: "c".repeat(64) }, { candidateLiteral: "" }, { candidateBox: [10, 10, 9, 20] },
  { candidateBox: [-1, 10, 90, 20] }, { sourceLiteral: "x".repeat(81) }, { sourceBox: null }, { sourceLocation: "unknown" }]) {
  assert.ok(intrinsicIdentifierComparisonIssue({ ...comparison, identifierComparisons: [{ ...pair, ...patch }] }, context)); checks++;
}
for (const patch of [{ sameSelectedComponent: false }, { sameSelectedVisibleOption: false }, { sourceLocation: "external-badge" as const },
  { candidateLocation: "external-badge" as const }, { identifierRole: "non-identifying" as const }]) {
  assert.equal(corroboratableIdentifierPairs({ identifierComparisons: [{ ...pair, ...patch }] }).length, 0); checks++;
}
const unprinted = { ...comparison, candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [], referencePrintState: "absent",
  candidatePrintState: "absent-on-exposed-face" };
assert.equal(referencePlaneComparisonIssue({ ...row, referenceComparison: unprinted }, context), null); checks++;
const unreadable = { ...comparison, samePhysicalSurface: true, candidateIdentifierVisibility: "unreadable", identifierComparisons: [], candidatePrintState: "present-unreadable" };
assert.equal(referencePlaneComparisonIssue({ ...row, referenceComparison: unreadable }, context), null); checks++;
const sourceUnknown = { ...pair, sourceReadability: "not-observed" as const, sourceImageIndex: null, sourceSha256: null, sourceLiteral: "", sourceBox: null };
assert.equal(intrinsicIdentifierComparisonIssue({ ...comparison, identifierComparisons: [sourceUnknown] }, context), null);
assert.equal(corroboratableIdentifierPairs({ identifierComparisons: [sourceUnknown] }).length, 0); checks += 2;
for (const [a, b, equal] of [["Ｖｏｌｔｉｕｍ", "VOLTIUM", true], ["Vol ti-um", "Voltium", true], ["Voltium", "Voltum", false],
  ["Voltium", "Voltiurn", false], ["A0l1", "AOIl", false], ["Model-12", "model12", true], ["Model12", "Model1", false]] as const) {
  assert.equal(normalizeIntrinsicIdentifierLiteral(a) === normalizeIntrinsicIdentifierLiteral(b), equal); checks++;
}
for (const [a, b, sameLocus] of [
  [[300, 418, 457, 475], [285, 418, 669, 535], true],
  [[417, 607, 494, 624], [407, 598, 495, 634], true],
  [[100, 100, 300, 200], [299, 100, 600, 200], false],
  [[100, 100, 300, 200], [200, 100, 500, 200], true],
  [[100, 100, 300, 200], [201, 100, 500, 200], false],
  [[100, 100, 300, 200], [10, 10, 99, 99], false],
] as const) {
  assert.equal(intrinsicIdentifierBoxesOverlap([...a], [...b]), sameLocus); checks++;
}
console.log(`intrinsic identifier comparison: ${checks} checks passed; process/provider/network calls 0`);

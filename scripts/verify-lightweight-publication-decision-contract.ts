/** Offline regression for the two actual 170 consistency failures. Original
 * negative responses stay negative; only a newly requested detailed contract
 * omits aggregate approval. No account, provider, image or live-data writes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, LIGHTWEIGHT_PUBLICATION_REVIEW_RULE,
  lightweightPublicationDetailedSchema, lightweightPublicationDetailedRows, lightweightPublicationReferenceIssue } from "./lib/lightweight-publication-review";

const incidents = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/test-fixtures/lightweight-publication-170-incident.json"), "utf8")) as {
  fixtures: Array<{ name: string; sourceRollout: string; sourceResponseSha256: string; rawReview: Record<string, unknown>;
    requestSlot: { role: string; exactCanonicalSellerOriginal: boolean; visualContract: { purpose: string } } }>;
};
const reference = { primaryReferenceImageIndex: 2, primaryReferenceSha256: "a".repeat(64), supplementalReferences: [] };
const slot = { role: "scene", allowProductPhoto: true, referenceContext: reference };
const good: Record<string, unknown> = { index: 1, reason: "The actual selected source and candidate show the same housing and cap. Plain white studio photography illustrates product appearance; tiny unreadable letters are not certified.",
  visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
    { part: "housing", referenceObservation: "selected round housing", candidateObservation: "same selected round housing" },
    { part: "cap", referenceObservation: "short cap", candidateObservation: "same short cap" }], conflict: "" },
  optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] },
  photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" },
  referenceComparison: { primaryReferenceImageIndex: 2, primaryReferenceSha256: reference.primaryReferenceSha256, objectionKind: "none", observation: "Matching visible housing and cap" },
  identityMatches: true, photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false, optionsClearlyLabeled: false,
  singlePhotograph: true, noGraphicLayout: true, visibleAddedText: { headline: "", otherAddedText: [] }, thumbnailHeadlineLegible: true, reviewClass: "product-photo" };
const wire = (row: Record<string, unknown>) => JSON.stringify({ contractVersion: LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, reviews: [row] });
const read = (row: Record<string, unknown>) => lightweightPublicationDetailedRows(wire(row), [slot])[0];

for (const incident of incidents.fixtures) {
  assert.equal(incident.rawReview.accepted, false);
  assert.equal(incident.rawReview.identityMatches, true);
  const rawBefore = JSON.stringify(incident.rawReview);
  const legacy = JSON.stringify({ reviews: [incident.rawReview] });
  assert.deepEqual(lightweightPublicationDetailedRows(legacy, [slot]), [null], "legacy negative raw bytes cannot enter the new contract");
  assert.equal(read(incident.rawReview), null, "adding a new envelope never strips a legacy accepted=false");
  assert.equal(JSON.stringify(incident.rawReview), rawBefore, "actual negative reason and every raw field remain unchanged");
  assert.match(incident.sourceResponseSha256, /^[a-f0-9]{64}$/u);
}
const appearance = incidents.fixtures.find(value => value.name === "robot-original-appearance-scope")!;
assert.equal(appearance.requestSlot.exactCanonicalSellerOriginal, true);
assert.equal(appearance.requestSlot.role, "scene");
assert.equal(appearance.requestSlot.visualContract.purpose, "product-appearance");
assert.match(String(appearance.rawReview.reason), /흰 배경/u);
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /role=scene is placement metadata/u);
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /plain or white background/u);

// The native wire schema removes the redundant aggregate rather than asking a
// second examiner or changing any returned false flag into a favorable flag.
const schema = { type: "object", properties: { reviews: { type: "array", items: { type: "object", properties: {
  ...Object.fromEntries(Object.keys(good).map(key => [key, {}])), accepted: { type: "boolean" }, textPolicyMatches: { type: "boolean" },
}, required: [...Object.keys(good), "accepted", "textPolicyMatches"], additionalProperties: false } } }, required: ["reviews"], additionalProperties: false };
const beforeSchema = JSON.stringify(schema);
const detailed = lightweightPublicationDetailedSchema(schema);
assert.equal(JSON.stringify(schema), beforeSchema);
const validate = new Ajv({ allErrors: true }).compile(detailed);
assert.equal(validate(JSON.parse(wire(good))), true);
for (const accepted of [false, true, null, "true"]) {
  assert.equal(validate(JSON.parse(wire({ ...good, accepted }))), false);
  assert.equal(read({ ...good, accepted }), null, "even a favorable legacy aggregate is not relabeled as detailed native evidence");
}
for (const textPolicyMatches of [false, true, null, "true"]) {
  assert.equal(validate(JSON.parse(wire({ ...good, textPolicyMatches }))), false);
  assert.equal(read({ ...good, textPolicyMatches }), null, "old text-policy verdicts are never promoted into literal observations");
}
const original = JSON.stringify(good), projected = read(good)!;
assert.equal(projected.accepted, true);
assert.equal(JSON.stringify(good), original);
assert.equal(Object.hasOwn(good, "accepted"), false);
assert.equal(Object.hasOwn(good, "textPolicyMatches"), false);
assert.deepEqual(Object.fromEntries(Object.entries(projected).filter(([key]) => key !== "accepted" && key !== "textPolicyMatches")), good);
const thumbnailSlot = { ...slot, role: "thumbnail" };
const twoLineHeadline = { ...good, visibleAddedText: { headline: "향·용량\n구성", otherAddedText: [] }, reason: "One accurate large headline, '향·용량 구성', wraps after '향·용량' onto two lines over the same full-bleed photo; no second title or panel is present" };
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /SAME headline may wrap onto at most two lines/u);
assert.equal(lightweightPublicationDetailedRows(wire(twoLineHeadline), [thumbnailSlot])[0]?.accepted, true);
for (const patch of [
  { visibleAddedText: { headline: "향·용량 구성", otherAddedText: ["별도의 가격 주장"] }, reason: "Two independent headlines make separate claims over the photograph" },
  { noGraphicLayout: false, reason: "A separate panel or frame carries the headline" },
  { thumbnailHeadlineLegible: false, reason: "The last essential Korean letter is clipped at the canvas edge" },
]) assert.equal(lightweightPublicationDetailedRows(wire({ ...twoLineHeadline, ...patch }), [thumbnailSlot])[0]?.accepted, false);
assert.equal(read({ ...twoLineHeadline, reason: "The body photo contains added title text" })?.accepted, false);

for (const patch of [{ noGraphicLayout: false }, { visibleAddedText: { headline: "", otherAddedText: ["실제 추가 설명"] } }, { singlePhotograph: false }, { notice: true }]) {
  const raw = { ...good, ...patch, reason: "An actual forbidden frame/text, impossible scene or seller notice is observed" };
  const snapshot = JSON.stringify(raw);
  assert.equal(read(raw)?.accepted, false);
  assert.equal(JSON.stringify(raw), snapshot);
}
for (const kind of ["concrete-conflict", "unresolved"]) {
  const raw = { ...good, identityMatches: false, reason: "Actual wrong housing or insufficient visible identity", visibleIdentityEvidence: {
    basis: kind === "unresolved" ? "insufficient-visible-structure" : "concrete-conflict",
    landmarks: kind === "unresolved" ? [] : [{ part: "housing", referenceObservation: "selected round housing", candidateObservation: "different rectangular housing" }],
    conflict: "Actual selected structure conflicts or cannot be resolved" },
  referenceComparison: { primaryReferenceImageIndex: reference.primaryReferenceImageIndex, primaryReferenceSha256: reference.primaryReferenceSha256,
    objectionKind: kind, observation: "Actual adverse observed source/candidate comparison" } };
  assert.equal(read(raw)?.accepted, false);
  assert.equal(read({ ...raw, identityMatches: true }), null, "a typed negative witness can never be hidden by a favorable flag");
}
const unsupportedClaim = { ...good, photoClaimMatches: false, reason: "The photograph does not show the two items claimed in actual text", photoClaimObjection: {
  origin: "section-body", sourceIndex: 0, quote: "사진에는 두 개가 보입니다.", scope: "quantity", conflict: "Only one item is visible" } };
assert.equal(read(unsupportedClaim)?.accepted, false);
assert.equal(read({ ...unsupportedClaim, photoClaimMatches: true }), null);
assert.equal(read({ ...good, visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [], conflict: "A readable wrong logo is actually observed" } }), null);
assert.equal(read({ ...good, identityMatches: "true" }), null);
assert.equal(read({ ...good, referenceComparison: { ...good.referenceComparison as object, primaryReferenceSha256: "b".repeat(64) } }), null);
assert.deepEqual(lightweightPublicationDetailedRows(JSON.stringify({ contractVersion: "older-or-forged", reviews: [good] }), [slot]), [null]);
assert.deepEqual(lightweightPublicationDetailedRows(JSON.stringify({ contractVersion: LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, reviews: [good, good] }), [slot, slot]), [null, null]);

// A verified crop can lack an exact whole-image primary. Its native comparison
// may explicitly name a real selected-gallery attachment without borrowing a
// final image, another slot's private primary, or a model-invented source.
const choices = [{ imageIndex: 3, sha256: "b".repeat(64) }, { imageIndex: 4, sha256: "c".repeat(64) }];
const cropSlot = { role: "detail", allowProductPhoto: true, referenceContext: null, availableCanonicalReferences: choices };
const chosenComparison = { primaryReferenceImageIndex: 4, primaryReferenceSha256: "c".repeat(64), objectionKind: "none", observation: "Actually attached selected-gallery photograph shows this same visible crop" };
const cropRaw = { ...good, referenceComparison: chosenComparison };
const cropBefore = JSON.stringify(cropRaw);
assert.equal(lightweightPublicationDetailedRows(wire(cropRaw), [cropSlot])[0]?.accepted, true);
assert.equal(JSON.stringify(cropRaw), cropBefore);
assert.equal(lightweightPublicationDetailedRows(wire({ ...good, referenceComparison: null }), [cropSlot])[0]?.accepted, true,
  "null comparison remains permitted when its actual identity landmark evidence is complete");
assert.equal(lightweightPublicationReferenceIssue(chosenComparison, null, true), "unmapped final image must have a null reference comparison",
  "existing no-choices callers retain the original contract");
for (const patch of [
  { primaryReferenceImageIndex: 1 }, // final/candidate attachment
  { primaryReferenceImageIndex: 2 }, // another final or private own primary
  { primaryReferenceImageIndex: 99 }, // never attached
  { primaryReferenceSha256: "d".repeat(64) }, // foreign product/source
  { primaryReferenceImageIndex: 3 }, // real index with the wrong real SHA
  { primaryReferenceSha256: "C".repeat(64) }, // no favorable SHA normalization
]) assert.equal(lightweightPublicationDetailedRows(wire({ ...good, referenceComparison: { ...chosenComparison, ...patch } }), [cropSlot])[0], null);
assert.equal(lightweightPublicationDetailedRows(wire(cropRaw), [{ ...slot, availableCanonicalReferences: choices }])[0], null,
  "an existing own primary remains exact even when the alternative is in the canonical gallery");
assert.equal(lightweightPublicationDetailedRows(wire(cropRaw), [{ ...cropSlot, availableCanonicalReferences: [] }])[0], null);
assert.equal(lightweightPublicationDetailedRows(wire(cropRaw), [{ ...cropSlot, availableCanonicalReferences: [...choices, { imageIndex: 4, sha256: "d".repeat(64) }] }])[0], null);
const cropUnknown = { ...cropRaw, identityMatches: false,
  visibleIdentityEvidence: { basis: "insufficient-visible-structure", landmarks: [], conflict: "The actual attached source does not resolve this cropped product part" },
  referenceComparison: { ...chosenComparison, objectionKind: "unresolved" }, reason: "Actual source/candidate identity remains uncertain" };
const cropUnknownBefore = JSON.stringify(cropUnknown);
assert.equal(lightweightPublicationDetailedRows(wire(cropUnknown), [cropSlot])[0]?.accepted, false);
assert.equal(JSON.stringify(cropUnknown), cropUnknownBefore);
assert.equal(lightweightPublicationDetailedRows(wire({ ...cropUnknown, identityMatches: true }), [cropSlot])[0], null);
console.log("PASS detailed publication decision contract: actual 170 negative rows preserved; new native schema has no aggregate approval; derived conjunction retains negative identity/format/claim evidence, exact source bindings and plain-original appearance scope; provider/live writes 0");

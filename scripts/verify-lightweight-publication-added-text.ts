/** Offline 172 literal-text contract regression. The two actual negative 171
 * rows remain immutable; no provider, image generation or live-data writes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, LIGHTWEIGHT_UNREADABLE_ADDED_TEXT,
  LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, lightweightPublicationDetailedRows,
  lightweightPublicationDetailedSchema } from "./lib/lightweight-publication-review";

const referenceContext = { primaryReferenceImageIndex: 2, primaryReferenceSha256: "a".repeat(64), supplementalReferences: [] };
const thumbnail = { role: "thumbnail", allowProductPhoto: true, referenceContext };
const body = { ...thumbnail, role: "detail" };
const good: Record<string, unknown> = { index: 1, reason: "One accurate two-line headline overlaps only a non-identifying product surface; actual source geometry remains clear and all essential headline letters are readable",
  visibleIdentityEvidence: { basis: "observed-correspondence", landmarks: [
    { part: "round body", referenceObservation: "round selected body with central sensor", candidateObservation: "same round body and central sensor" },
    { part: "dock", referenceObservation: "tall dock with striped front and lower recess", candidateObservation: "same striped dock and lower recess" }], conflict: "" },
  optionConflictWitness: { origin: "none", quote: "", visibleAlternatives: [] },
  photoClaimObjection: { origin: "none", sourceIndex: null, quote: "", scope: "none", conflict: "" },
  referenceComparison: { primaryReferenceImageIndex: 2, primaryReferenceSha256: referenceContext.primaryReferenceSha256, objectionKind: "none", observation: "Actual selected source structure matches" },
  visibleAddedText: { headline: "제품\n사양체크", otherAddedText: [] },
  identityMatches: true, photoClaimMatches: true, notice: false, mixedOptions: false, explicitNamedComparison: false,
  optionsClearlyLabeled: false, singlePhotograph: true, noGraphicLayout: true, thumbnailHeadlineLegible: true, reviewClass: "product-photo" };
const wire = (row: Record<string, unknown>) => JSON.stringify({ contractVersion: LIGHTWEIGHT_PUBLICATION_DETAILED_CONTRACT, reviews: [row] });
const read = (row: Record<string, unknown>, slot = thumbnail) => lightweightPublicationDetailedRows(wire(row), [slot])[0];

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/test-fixtures/lightweight-publication-171-text-policy-incident.json"), "utf8")) as {
  fixtures: Array<{ contractVersion: string; sourceResponseSha256: string; rawReview: Record<string, unknown> }>;
};
for (const incident of fixture.fixtures) {
  const before = JSON.stringify(incident.rawReview);
  assert.equal(incident.rawReview.textPolicyMatches, false);
  assert.equal(incident.rawReview.identityMatches, true);
  assert.deepEqual(lightweightPublicationDetailedRows(JSON.stringify({ contractVersion: incident.contractVersion, reviews: [incident.rawReview] }), [thumbnail]), [null]);
  assert.equal(read(incident.rawReview), null, "a new envelope cannot promote an old false native text-policy flag");
  assert.equal(JSON.stringify(incident.rawReview), before);
  assert.match(incident.sourceResponseSha256, /^[a-f0-9]{64}$/u);
}

const originalSchema = { type: "object", properties: { reviews: { type: "array", items: { type: "object", properties: {
  ...Object.fromEntries(Object.keys(good).map(key => [key, {}])), accepted: { type: "boolean" }, textPolicyMatches: { type: "boolean" },
}, required: [...Object.keys(good), "accepted", "textPolicyMatches"], additionalProperties: false } } }, required: ["reviews"], additionalProperties: false };
const beforeSchema = JSON.stringify(originalSchema), schema = lightweightPublicationDetailedSchema(originalSchema);
assert.equal(JSON.stringify(originalSchema), beforeSchema);
const validate = new Ajv({ allErrors: true }).compile(schema);
assert.equal(validate(JSON.parse(wire(good))), true);
for (const textPolicyMatches of [false, true]) {
  const row = { ...good, textPolicyMatches };
  assert.equal(validate(JSON.parse(wire(row))), false);
  assert.equal(read(row), null);
}
assert.equal(read({ ...good, accepted: false }), null);
for (const added of [{ headline: "제품 제목" }, { otherAddedText: [] }, { headline: "제목", otherAddedText: [], extra: "hidden" },
  { headline: 123, otherAddedText: [] }, { headline: "제목", otherAddedText: "배지" }, { headline: "제목", otherAddedText: [123] }]) {
  const row = { ...good, visibleAddedText: added };
  assert.equal(validate(JSON.parse(wire(row))), false);
  assert.equal(read(row), null);
}

const before = JSON.stringify(good), projected = read(good)!;
assert.equal(projected.textPolicyMatches, true);
assert.equal(projected.accepted, true);
assert.equal(JSON.stringify(good), before);
assert.equal(Object.hasOwn(good, "textPolicyMatches"), false);
assert.equal(Object.hasOwn(good, "accepted"), false);
assert.deepEqual(Object.fromEntries(Object.entries(projected).filter(([key]) => key !== "accepted" && key !== "textPolicyMatches")), good);
assert.equal(read({ ...good, visibleAddedText: { headline: "50ml 향·용량 구성", otherAddedText: [] } })?.accepted, true,
  "factual numerals in the single headline are not guessed to be another price/badge message");
assert.equal(read(good, body)?.textPolicyMatches, false, "body roles cannot inherit headline permission");
assert.equal(read({ ...good, visibleAddedText: { headline: "", otherAddedText: [] } }, body)?.textPolicyMatches, true);
const absentHeadline = { ...good, visibleAddedText: { headline: "", otherAddedText: [] } };
assert.equal(read(absentHeadline), null, "an absent thumbnail headline contradicts a favorable actual headline-legibility verdict");
const absentAndIllegible = { ...absentHeadline, thumbnailHeadlineLegible: false }, absentBefore = JSON.stringify(absentAndIllegible);
assert.equal(read(absentAndIllegible)?.accepted, false, "an honestly adverse missing-headline verdict stays adverse");
assert.equal(read(absentAndIllegible)?.thumbnailHeadlineLegible, false);
assert.equal(JSON.stringify(absentAndIllegible), absentBefore);
assert.equal(read(absentHeadline, body)?.accepted, true, "body headline-legibility N/A=true remains permitted");

for (const text of ["별도의 제목", "오늘만 특가", "추가 설명 배지"]) {
  const raw = { ...good, visibleAddedText: { headline: "제품 사양체크", otherAddedText: [text] } }, snapshot = JSON.stringify(raw);
  assert.equal(read(raw)?.textPolicyMatches, false);
  assert.equal(read(raw)?.accepted, false);
  assert.equal(JSON.stringify(raw), snapshot);
}
for (const duplicate of ["제품 사양체크", "제품\n사양체크", " 제품  사양체크 "]) {
  assert.equal(read({ ...good, visibleAddedText: { headline: "제품 사양체크", otherAddedText: [duplicate] } }), null,
    "a duplicated headline observation is HOLD, not proof of forbidden external copy or regeneration authority");
}
for (const unreadable of [LIGHTWEIGHT_UNREADABLE_ADDED_TEXT, "__unreadable_added_text__"]) {
  const raw = { ...good, visibleAddedText: { headline: "제품 사양체크", otherAddedText: [unreadable] } }, snapshot = JSON.stringify(raw);
  assert.equal(read(raw), null, "visibly present unreadable added text cannot become an empty positive observation");
  assert.equal(read(raw, body), null);
  assert.equal(JSON.stringify(raw), snapshot);
}
assert.equal(read({ ...good, thumbnailHeadlineLegible: false })?.accepted, false, "actual clipped/unreadable headline remains adverse");
assert.equal(read({ ...good, noGraphicLayout: false })?.accepted, false, "a real panel/frame remains adverse");
assert.equal(read({ ...good, identityMatches: false, visibleIdentityEvidence: { basis: "concrete-conflict", landmarks: [
  { part: "body", referenceObservation: "selected round body", candidateObservation: "wrong rectangular body" }], conflict: "Wrong visible product structure" },
  referenceComparison: { ...referenceContext, supplementalReferences: [], objectionKind: "concrete-conflict", observation: "Actually wrong visible product structure" } }), null,
  "malformed extra comparison fields remain HOLD rather than being silently deleted");
assert.equal(read({ ...good, identityMatches: false, visibleIdentityEvidence: { basis: "concrete-conflict", landmarks: [
  { part: "body", referenceObservation: "selected round body", candidateObservation: "wrong rectangular body" }], conflict: "Wrong visible product structure" },
  referenceComparison: { primaryReferenceImageIndex: 2, primaryReferenceSha256: referenceContext.primaryReferenceSha256,
    objectionKind: "concrete-conflict", observation: "Actually wrong visible product structure" } })?.accepted, false,
  "thumbnail overlap permission never overrides a valid actual wrong-product finding");
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /overlap alone is not a defect/u);
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /Intrinsic physical product printing is not added text/u);
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /plain nonexplanatory source-brand watermark/u);
assert.match(LIGHTWEIGHT_PUBLICATION_REVIEW_RULE, /never combine them into the headline/u);
console.log("PASS added-text observation contract: actual 171 false flags preserved; new wire derives sole-headline/body permission from exact literal arrays; duplicates/unreadable are HOLD; extra copy, panels, clipping and malformed evidence remain blocked; provider/live writes 0");

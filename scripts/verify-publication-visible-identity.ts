/** Offline typed evidence regressions. No pixels, provider or live files are altered. */
import assert from "node:assert/strict";
import Ajv from "ajv";
import { buildProduct9Canvas, selectedProductContextFrom9Canvas } from "./lib/product-9canvas";
import { VISIBLE_IDENTITY_EVIDENCE_SCHEMA, OPTION_CONFLICT_WITNESS_SCHEMA, VISIBLE_IDENTITY_EVIDENCE_RULE, OPTION_CONFLICT_WITNESS_RULE,
  visibleIdentityReviewContext, visibleIdentityEvidenceIssue, optionConflictWitnessIssue } from "./lib/publication-visible-identity";

let checks = 0;
const context = visibleIdentityReviewContext(selectedProductContextFrom9Canvas(buildProduct9Canvas({
  name: "BYC 히트핏 남자 내복 상하 세트", features: ["선택 옵션: FREE(95-100) / XL(105-110)", "색상: 회색, 검정", "소재: 폴리에스터"],
})));
assert.equal(context.confirmedOptionLabel, "FREE(95-100) / XL(105-110)"); checks++;
assert(context.catalogRangeFacts.includes("색상: 회색, 검정"));
assert.equal(context.colourSelectionStatus, "not-inferred-from-label-or-catalog"); checks++;
assert(!("confirmedColour" in context)); checks++;
const none = { origin: "none", quote: "", visibleAlternatives: [] };
const landmarks = [
  { part: "neckline", referenceObservation: "The selected reference has a narrow round crew neckline", candidateObservation: "The candidate shows the same narrow round crew neckline" },
  { part: "cuff seam", referenceObservation: "The source has close-fitting black sleeves and narrow cuff seams", candidateObservation: "Matching black sleeves and corresponding narrow cuff seams are visible" },
];
const good = { identityMatches: true, mixedOptions: false, accepted: true, visibleIdentityEvidence: { basis: "observed-correspondence", landmarks, conflict: "" }, optionConflictWitness: none };
const before = JSON.stringify(good);
assert.equal(visibleIdentityEvidenceIssue(good, context), null); checks++;
assert.equal(optionConflictWitnessIssue(good, context), null); checks++;
const ajv = new Ajv();
assert.equal(ajv.compile(VISIBLE_IDENTITY_EVIDENCE_SCHEMA)(good.visibleIdentityEvidence), true); checks++;
assert.equal(ajv.compile(OPTION_CONFLICT_WITNESS_SCHEMA)(none), true); checks++;

for (const raw of ["plain product title, black at the end", "not JSON", "null", "[]", "1", "\"colour: black\""]) {
  const parsed = visibleIdentityReviewContext(raw);
  assert.equal(parsed.selectedProductParsed, false); assert.equal(parsed.confirmedOptionLabel, null); assert.deepEqual(parsed.catalogRangeFacts, []); checks++;
}
for (const patch of [
  { optionResolution: { catalogCandidatesFromTitle: ["gray", "black"], confirmedOptionLabel: null } },
  { selectedOption: { status: "confirmed", label: "black" } },
  { optionResolution: { confirmedOptionLabel: "black" }, selectedOption: { status: "ambiguous", label: "black" } },
  { optionResolution: { confirmedOptionLabel: "black" }, selectedOption: { status: "confirmed", label: "gray" } },
]) {
  assert.equal(visibleIdentityReviewContext(JSON.stringify(patch)).confirmedOptionLabel, null); checks++;
}
const exactLabel = "  선택색상： Ivory / M  ";
assert.equal(visibleIdentityReviewContext(JSON.stringify({ optionResolution: { confirmedOptionLabel: exactLabel } })).confirmedOptionLabel, exactLabel); checks++;
const featureContext = visibleIdentityReviewContext(JSON.stringify({ validatedSellerFeatures: [
  { text: "colour: gray / black", evidenceIds: ["e1"] }, { text: "설명 중 마지막 색상 검정", evidenceIds: ["e2"] },
  { text: "색상: 추측", evidenceIds: [] }, { text: "색상: 추측", evidenceIds: [""] }, "색상: 직접 문자열",
] }));
assert.deepEqual(featureContext.catalogRangeFacts, ["colour: gray / black"]); assert.equal(featureContext.confirmedOptionLabel, null); checks++;

for (const evidence of [undefined, null, [], {}, { ...good.visibleIdentityEvidence, extra: true },
  { ...good.visibleIdentityEvidence, landmarks: [] }, { ...good.visibleIdentityEvidence, landmarks: [landmarks[0]] },
  { ...good.visibleIdentityEvidence, landmarks: [landmarks[0], landmarks[0]] },
  { ...good.visibleIdentityEvidence, landmarks: [landmarks[0], { ...landmarks[0], part: " NECKLINE " }] },
  { ...good.visibleIdentityEvidence, conflict: "Uncertified market SKU" }, { ...good.visibleIdentityEvidence, basis: "concrete-conflict" },
  { ...good.visibleIdentityEvidence, landmarks: [{ ...landmarks[0], referenceObservation: "" }, landmarks[1]] },
  { ...good.visibleIdentityEvidence, landmarks: [{ ...landmarks[0], extra: "forged" }, landmarks[1]] },
]) {
  assert(visibleIdentityEvidenceIssue({ ...good, visibleIdentityEvidence: evidence }, context)); checks++;
}
for (const identity of ["true", 1, null, undefined]) { assert(visibleIdentityEvidenceIssue({ ...good, identityMatches: identity }, context)); checks++; }
const wrongCut = { ...good, accepted: false, identityMatches: false, visibleIdentityEvidence: { basis: "concrete-conflict", landmarks: [
  { part: "neckline", referenceObservation: "Round crew-neck source", candidateObservation: "A visibly deep V-neck candidate" },
], conflict: "The visible neckline has changed from round crew to deep V" }, referenceComparison: { objectionKind: "shape" } };
assert.equal(visibleIdentityEvidenceIssue(wrongCut, context), null); assert.equal(wrongCut.identityMatches, false); assert.equal(wrongCut.accepted, false); checks++;
for (const conflict of ["different visible colour", "actual wrong intrinsic brand", "missing exposed band connection"]) {
  const adverse = { ...wrongCut, visibleIdentityEvidence: { ...wrongCut.visibleIdentityEvidence, conflict } };
  assert.equal(visibleIdentityEvidenceIssue(adverse, context), null); assert.equal(adverse.identityMatches, false); checks++;
}
const unresolved = { ...wrongCut, visibleIdentityEvidence: { ...wrongCut.visibleIdentityEvidence, basis: "insufficient-visible-structure", conflict: "The visible sleeve/collar is occluded and cannot be compared" },
  referenceComparison: { objectionKind: "unresolved" } };
assert.equal(visibleIdentityEvidenceIssue(unresolved, context), null); assert.equal(unresolved.accepted, false); checks++;
assert.equal(visibleIdentityEvidenceIssue({ ...unresolved, visibleIdentityEvidence: { ...unresolved.visibleIdentityEvidence, landmarks: [] } }, context), null,
  "a fully unobservable product remains unresolved HOLD without fabricated landmarks"); checks++;
assert(visibleIdentityEvidenceIssue({ ...wrongCut, visibleIdentityEvidence: { ...wrongCut.visibleIdentityEvidence, landmarks: [] } }, context)); checks++;
assert(visibleIdentityEvidenceIssue({ ...unresolved, referenceComparison: { objectionKind: "shape" } }, context)); checks++;
assert(visibleIdentityEvidenceIssue({ ...wrongCut, referenceComparison: { objectionKind: "unresolved" } }, context)); checks++;
assert(visibleIdentityEvidenceIssue({ ...wrongCut, visibleIdentityEvidence: { ...wrongCut.visibleIdentityEvidence, conflict: " " } }, context)); checks++;

for (const witness of [undefined, null, [], {}, { ...none, extra: true }, { ...none, quote: "black" },
  { ...none, visibleAlternatives: ["gray", "black"] }, { ...none, origin: "confirmed-selection" }]) {
  assert(optionConflictWitnessIssue({ ...good, optionConflictWitness: witness }, context)); checks++;
}
const actualChoice = visibleIdentityReviewContext(JSON.stringify({ optionResolution: { confirmedOptionLabel: "선택: 검정 M" } }));
const mixed = { ...good, accepted: false, identityMatches: false, mixedOptions: true,
  optionConflictWitness: { origin: "confirmed-selection", quote: actualChoice.confirmedOptionLabel!, visibleAlternatives: ["black round-neck M", "gray V-neck L"] } };
assert.equal(optionConflictWitnessIssue(mixed, actualChoice), null); assert.equal(mixed.accepted, false); checks++;
for (const witness of [{ ...mixed.optionConflictWitness, quote: "검정 M" }, { ...mixed.optionConflictWitness, quote: "선택: 검정 M " },
  { ...mixed.optionConflictWitness, quote: "색상: 회색, 검정" }, { ...mixed.optionConflictWitness, visibleAlternatives: ["black"] },
  { ...mixed.optionConflictWitness, visibleAlternatives: ["Black", " black "] }, { ...mixed.optionConflictWitness, visibleAlternatives: ["black", ""] },
  { ...mixed.optionConflictWitness, origin: "none" }]) {
  assert(optionConflictWitnessIssue({ ...mixed, optionConflictWitness: witness }, actualChoice)); checks++;
}
assert(optionConflictWitnessIssue({ ...mixed, optionConflictWitness: { ...mixed.optionConflictWitness, quote: "검정" } }, context), "catalog last-black does not become a confirmed selection"); checks++;
const published = "이 사진에는 구매한 검정 상의와 회색 하의가 한 세트로 모두 들어 있습니다.";
const claimContext = { ...context, role: "scene", sectionTitle: "세트 구성", sectionBody: ["카탈로그 색상은 회색과 검정입니다.", published] };
const bundle = { ...mixed, photoClaimMatches: false,
  photoClaimObjection: { origin: "section-body", sourceIndex: 1, quote: published, scope: "complete-set", conflict: "The published mixed purchase bundle is not shown" },
  optionConflictWitness: { origin: "published-purchase-bundle", quote: published, visibleAlternatives: ["black top", "gray bottoms"] } };
assert.equal(optionConflictWitnessIssue(bundle, claimContext), null); checks++;
for (const patch of [{ sourceIndex: 0 }, { sourceIndex: null }, { sourceIndex: "1" }, { quote: published.slice(0, -1) },
  { origin: "thumbnail-headline" }, { scope: "pictured-appearance" }, { conflict: "" }, { extra: true }]) {
  assert(optionConflictWitnessIssue({ ...bundle, photoClaimObjection: { ...bundle.photoClaimObjection, ...patch } }, claimContext)); checks++;
}
assert(optionConflictWitnessIssue({ ...bundle, photoClaimMatches: true }, claimContext)); checks++;
assert(optionConflictWitnessIssue(bundle, { ...claimContext, role: "thumbnail" })); checks++;
assert(optionConflictWitnessIssue(bundle, { ...claimContext, sectionBody: [published] })); checks++;
const titleBundle = { ...bundle, photoClaimObjection: { ...bundle.photoClaimObjection, origin: "section-title", sourceIndex: null }, optionConflictWitness: bundle.optionConflictWitness };
assert.equal(optionConflictWitnessIssue(titleBundle, { ...claimContext, sectionTitle: published }), null); checks++;
assert(optionConflictWitnessIssue(titleBundle, claimContext)); checks++;
const comparisonText = "검정 A와 회색 B를 이름별로 나란히 비교합니다.";
const namedContext = { ...context, role: "scene", sectionTitle: "A와 B 비교", sectionBody: [comparisonText] };
const namedComparison = { ...mixed, accepted: true, identityMatches: true, explicitNamedComparison: true, optionsClearlyLabeled: true,
  optionConflictWitness: { origin: "published-named-comparison", quote: comparisonText, visibleAlternatives: ["black A", "gray B"] } };
assert.equal(optionConflictWitnessIssue(namedComparison, namedContext), null); assert.equal(namedComparison.accepted, true); checks++;
assert.equal(optionConflictWitnessIssue({ ...namedComparison, optionConflictWitness: { ...namedComparison.optionConflictWitness, quote: namedContext.sectionTitle } }, namedContext), null); checks++;
for (const quote of [comparisonText.slice(0, -1), ` ${comparisonText}`, "카탈로그 선택지 검정과 회색"]) {
  assert(optionConflictWitnessIssue({ ...namedComparison, optionConflictWitness: { ...namedComparison.optionConflictWitness, quote } }, namedContext)); checks++;
}
for (const field of ["explicitNamedComparison", "optionsClearlyLabeled"]) for (const value of [false, null, "true"]) {
  assert(optionConflictWitnessIssue({ ...namedComparison, [field]: value }, namedContext)); checks++;
}
assert(optionConflictWitnessIssue(namedComparison, { ...namedContext, role: "thumbnail" })); checks++;
assert(optionConflictWitnessIssue(namedComparison, { ...namedContext, role: undefined })); checks++;
assert(optionConflictWitnessIssue({ ...namedComparison, mixedOptions: false }, namedContext)); checks++;
assert.equal(ajv.compile(OPTION_CONFLICT_WITNESS_SCHEMA)(namedComparison.optionConflictWitness), true); checks++;
for (const flag of ["false", 0, null, undefined]) { assert(optionConflictWitnessIssue({ ...good, mixedOptions: flag }, context)); checks++; }
assert.equal(JSON.stringify(good), before); checks++;
assert(VISIBLE_IDENTITY_EVIDENCE_RULE.includes("not market uniqueness") && OPTION_CONFLICT_WITNESS_RULE.includes("last colour")); checks++;
console.log(`PASS publication visible identity: ${checks} offline assertions; exact selected label vs catalog range, two observed landmarks, concrete conflict/unresolved distinction, exact published bundle quote, raw booleans unchanged; provider/generation/live writes0`);

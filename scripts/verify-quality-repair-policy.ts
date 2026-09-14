import assert from "node:assert/strict";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { compareQualityRepairCandidates, shouldAcceptQualityRepair } from "./lib/quality-repair-policy";

const baseline = getBrandLinkContentReadiness({
  productName: "상품", title: "상품", sections: [], hashtags: [], brandLink: "",
  generationSource: "AI", hasRepresentativeImage: false,
});
const before = { ...baseline, score: 80, blockers: [], signals: [{ key: "review-substance", label: "판단", status: "fail" as const }] };
assert.equal(shouldAcceptQualityRepair(before, before), false);
assert.equal(shouldAcceptQualityRepair(before, { ...before, score: 82 }), true);
assert.equal(shouldAcceptQualityRepair(before, { ...before, score: 99, blockers: [{ code: "unsupported-experience-claim", tier: "safety", reason: "허위 체험" }] }), false);
assert.equal(shouldAcceptQualityRepair(before, { ...before, signals: [] }), true);
assert.equal(shouldAcceptQualityRepair(before, { ...before, score: 60, signals: [] }), false);
assert.equal(shouldAcceptQualityRepair(before, { ...before, score: 84, signals: [...before.signals, {key:"evidence-density",label:"근거",status:"fail"}] }), false);
const unsafe = { ...before, blockers: [{ code: "unsupported-experience-claim" as const, tier: "safety" as const, reason: "허위 체험" }] };
assert.equal(shouldAcceptQualityRepair(unsafe, { ...before, score: 75 }), true);

const usefulness = baseline.quality.categories.find((category) => category.key === "usefulness")!;
const specificity = baseline.quality.categories.find((category) => category.key === "specificity")!;
const withMandatoryFailures = {
  ...before,
  score: 90,
  quality: { ...before.quality, categories: [
    { ...usefulness, status: "fail" as const },
    { ...specificity, status: "fail" as const },
  ] },
};
const fewerMandatoryFailures = {
  ...withMandatoryFailures,
  score: 86,
  quality: { ...withMandatoryFailures.quality, categories: [
    { ...usefulness, status: "pass" as const },
    { ...specificity, status: "fail" as const },
  ] },
};
assert.equal(compareQualityRepairCandidates(withMandatoryFailures, fewerMandatoryFailures), 1,
  "fewer mandatory failures outrank a lower aggregate score");
assert.equal(compareQualityRepairCandidates(fewerMandatoryFailures, {
  ...fewerMandatoryFailures,
  score: 99,
  quality: { ...fewerMandatoryFailures.quality, categories: [
    { ...usefulness, status: "fail" as const },
    { ...specificity, status: "pass" as const },
  ] },
}), -1, "a candidate cannot swap one mandatory failure for another");

const sourceInsufficient = {
  ...before,
  score: 90,
  quality: { ...before.quality, sourceEvidence: {
    level: "sparse" as const, sufficient: false, coveredCount: 0, requiredCount: 2,
    groundedCount: 0, requiredGroundedCount: 2,
  } },
};
const sourceSufficient = {
  ...sourceInsufficient,
  score: 85,
  quality: { ...sourceInsufficient.quality, sourceEvidence: {
    ...sourceInsufficient.quality.sourceEvidence!, level: "usable" as const, sufficient: true,
  } },
};
assert.equal(compareQualityRepairCandidates(sourceInsufficient, sourceSufficient), 1,
  "source sufficiency outranks aggregate score");
assert.equal(compareQualityRepairCandidates(sourceSufficient, { ...sourceInsufficient, score: 100 }), -1,
  "a higher score cannot regress canonical source sufficiency");
const sourceSufficientWithBlocker = {
  ...sourceSufficient,
  blockers: [{ code: "too-short-content" as const, tier: "structure" as const, reason: "짧음" }],
};
assert.equal(compareQualityRepairCandidates(sourceSufficientWithBlocker, {
  ...sourceInsufficient,
  score: 100,
  blockers: [],
}), -1, "removing a blocker cannot compensate for sufficient-to-insufficient source regression");
assert.equal(compareQualityRepairCandidates({ ...sourceSufficient, canPublish: true }, {
  ...sourceSufficient,
  canPublish: false,
  score: 100,
}), -1, "a publishable draft cannot be replaced by a candidate that fails an approval gate");

const structureBlocked = {
  ...withMandatoryFailures,
  blockers: [{ code: "too-short-content" as const, tier: "structure" as const, reason: "짧음" }],
};
assert.equal(compareQualityRepairCandidates(structureBlocked, {
  ...structureBlocked,
  blockers: [],
  quality: { ...structureBlocked.quality, categories: [
    { ...usefulness, status: "fail" as const },
    { ...specificity, status: "fail" as const },
    { ...baseline.quality.categories.find((category) => category.key === "diversity")!, status: "fail" as const },
  ] },
}), -1, "removing a blocker cannot introduce a new mandatory category failure");
const cleanSourceInsufficient = {
  ...sourceInsufficient,
  quality: { ...sourceInsufficient.quality, categories: [{ ...usefulness, status: "pass" as const }] },
};
assert.equal(compareQualityRepairCandidates(cleanSourceInsufficient, {
  ...cleanSourceInsufficient,
  quality: {
    ...cleanSourceInsufficient.quality,
    sourceEvidence: { ...sourceSufficient.quality.sourceEvidence! },
    categories: [{ ...usefulness, status: "fail" as const }],
  },
}), -1, "richer source metadata cannot introduce a new mandatory category failure");

console.log("Repair selection: 15 acceptance/regression cases passed");

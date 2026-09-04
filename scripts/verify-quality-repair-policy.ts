import assert from "node:assert/strict";
import { getBrandLinkContentReadiness } from "./lib/brandlink-content-readiness";
import { shouldAcceptQualityRepair } from "./lib/quality-repair-policy";

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
console.log("Repair selection: 7 acceptance/regression cases passed");

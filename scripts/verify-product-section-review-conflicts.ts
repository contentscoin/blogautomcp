import assert from "node:assert/strict";
import crypto from "node:crypto";
import { findProductSectionReviewConflicts } from "./lib/product-section-review-conflicts";

const hash = (value: unknown): string => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assignment = (selectedIndex = 1, reason = "Visible selected product", reviewClass = "product-photo") =>
  ({ targetIndex: 1, selectedIndex, reviewClass, reason });
const decision = (selectedIndex = 1, reason = "Wrong visible option") => ({ targetIndex: 1, selectedIndex, reason });
const bounds = { targetCount: 2, candidateCount: 17,
  allowedPairs: new Set(Array.from({ length: 17 }, (_, index) => `0:${index}`)) };
const check = (parsed: unknown, expected: string[]) => {
  const before = hash(parsed), allowedBefore = [...bounds.allowedPairs];
  assert.deepEqual([...findProductSectionReviewConflicts(parsed, bounds)].sort(), [...expected].sort());
  assert.equal(hash(parsed), before, "completed raw response is not changed");
  assert.deepEqual([...bounds.allowedPairs], allowedBefore, "allowed input bindings are not changed");
};

for (const other of ["rejections", "notSelected"]) {
  check({ assignments: [assignment()], [other]: [decision()] }, ["0:0"]);
}
check({ assignments: [], rejections: [decision()], notSelected: [decision(1, "Rank omission")] }, ["0:0"]);
check({ assignments: [assignment(), assignment(1, "Different verdict reason")] }, ["0:0"]);
check({ assignments: [assignment(), assignment(1, "Visible selected product", "feature-evidence")] }, ["0:0"]);
check({ assignments: [assignment(), { ...assignment() }] }, []);
check({ assignments: [assignment()], rejections: [decision(2)], notSelected: [decision(3)] }, []);

// The observed completed response shape: one conflict must not erase the other
// ten proposals or the five explicit adverse verdicts. No selection is made here.
const proposals = Array.from({ length: 11 }, (_, index) => Object.freeze(assignment(index + 1)));
const rejections = Array.from({ length: 5 }, (_, index) => Object.freeze(decision(index + 12)));
const omission = Object.freeze(decision(2, "Visible evidence is uncertain; not a ranking-only omission"));
const response = Object.freeze({ assignments: Object.freeze(proposals),
  rejections: Object.freeze(rejections), notSelected: Object.freeze([omission]) });
check(response, ["0:1"]);
const conflicts = findProductSectionReviewConflicts(response, bounds);
assert.equal(response.assignments.filter(row => !conflicts.has(`0:${row.selectedIndex - 1}`)).length, 10);
assert.equal(response.rejections.length, 5);
for (let index = 0; index < proposals.length; index++) assert.equal(response.assignments[index], proposals[index]);
for (let index = 0; index < rejections.length; index++) assert.equal(response.rejections[index], rejections[index]);
assert.equal(response.notSelected[0], omission);
assert.equal(response.assignments[1], proposals[1], "conflicting positive remains raw evidence, not an adopted assignment");

// Invalid rows and pairs outside this batch cannot quarantine valid candidates.
for (const invalid of [null, false, "not a row", [], { targetIndex: "1", selectedIndex: 1 },
  { targetIndex: 1, selectedIndex: "1" }, { targetIndex: 1.5, selectedIndex: 1 },
  { targetIndex: 0, selectedIndex: 1 }, { targetIndex: 3, selectedIndex: 1 },
  { targetIndex: 1, selectedIndex: 0 }, { targetIndex: 1, selectedIndex: 18 },
  { targetIndex: 1, selectedIndex: Infinity }, { targetIndex: NaN, selectedIndex: 1 },
  { targetIndex: 2, selectedIndex: 1 }]) {
  check({ assignments: [assignment()], rejections: [invalid], notSelected: [invalid] }, []);
}
for (const invalid of [null, false, "not a response", [], {}]) check(invalid, []);
check({ assignments: {}, rejections: null, notSelected: "invalid" }, []);
check({ assignments: [{ targetIndex: 2, selectedIndex: 1, reviewClass: "product-photo", reason: "outside allowed pairs" }],
  rejections: [{ targetIndex: 2, selectedIndex: 1, reason: "outside allowed pairs" }] }, []);

// Repeated normalization is deterministic and cannot consume a provider call,
// approve an image, change a rejection ledger or reset any workflow budget.
assert.deepEqual([...findProductSectionReviewConflicts(response, bounds)], [...conflicts]);
console.log("Verified pure source-review conflict isolation, exact evidence preservation and bounded pair guards.");

import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, isSameIdempotentRequest } from "./idempotency";

test("canonical JSON ignores object key order but preserves values", () => {
  assert.equal(
    canonicalJson({ count: 10, connectKind: "shopping", nested: { b: 2, a: 1 } }),
    canonicalJson({ nested: { a: 1, b: 2 }, connectKind: "shopping", count: 10 }),
  );
  assert.notEqual(canonicalJson({ count: 10 }), canonicalJson({ count: 20 }));
});

test("idempotent reuse requires the same job type and input", () => {
  const base = {
    existingType: "BRANDCONNECT_SYNC_PRODUCTS",
    existingInput: { connectKind: "travel", count: 10, idempotencyKey: "sync-1234" },
  };
  assert.equal(isSameIdempotentRequest({
    ...base,
    requestedType: "BRANDCONNECT_SYNC_PRODUCTS",
    requestedInput: { idempotencyKey: "sync-1234", count: 10, connectKind: "travel" },
  }), true);
  assert.equal(isSameIdempotentRequest({
    ...base,
    requestedType: "BRANDCONNECT_SYNC_PRODUCTS",
    requestedInput: { idempotencyKey: "sync-1234", count: 50, connectKind: "travel" },
  }), false);
  assert.equal(isSameIdempotentRequest({
    ...base,
    requestedType: "POST_PUBLISH",
    requestedInput: base.existingInput,
  }), false);
});

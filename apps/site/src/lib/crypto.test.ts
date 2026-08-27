import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, hashToken, keyedHash, pkceChallenge, safeEqualText, verifyPassword } from "./crypto";

test("password hashes verify only the original password", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^scrypt-v1\$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
  assert.equal(await verifyPassword("anything", "not-a-password-hash"), false);
});

test("token helpers are stable and domain-separated", () => {
  assert.equal(hashToken("same"), hashToken("same"));
  assert.notEqual(hashToken("same"), hashToken("different"));
  assert.equal(keyedHash("value", "key-a"), keyedHash("value", "key-a"));
  assert.notEqual(keyedHash("value", "key-a"), keyedHash("value", "key-b"));
  assert.equal(safeEqualText("abc", "abc"), true);
  assert.equal(safeEqualText("abc", "abcd"), false);
});

test("PKCE challenge matches the RFC 7636 S256 example", () => {
  assert.equal(
    pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

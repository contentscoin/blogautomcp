import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProductSnapshot, readProductSnapshot } from "../src/lib/draft-context-snapshot";

const productId = "2800ccf0-980c-45be-89bb-7cb64744232f";
const snapshot = createProductSnapshot({
  productId,
  connectKind: "TRAVEL",
  externalProductId: "JHP621LJ4N-20260928",
  sourceUrl: "https://example.test/travel/JHP621LJ4N-20260928",
  capturedAt: "2026-09-03T00:00:00.000Z",
  product: {
    name: "다낭 5일",
    finalUrl: "https://example.test/travel/JHP621LJ4N-20260929",
    referenceImageUrls: ["https://example.test/images/one.jpg"],
  },
});

assert.equal(readProductSnapshot(snapshot, { productId, connectKind: "TRAVEL" })?.snapshotId, snapshot.snapshotId);
assert.equal(readProductSnapshot(snapshot, { productId: "different", connectKind: "TRAVEL" }), null);
assert.equal(readProductSnapshot({ ...snapshot, product: { ...snapshot.product, name: "다른 상품" } }), null);

const root = process.cwd();
const cloudRoute = fs.readFileSync(path.join(root, "apps", "sites", "app", "api", "mcp", "[credential]", "route.ts"), "utf8");
const localDraftRoute = fs.readFileSync(path.join(root, "src", "app", "api", "brandlinks", "[id]", "draft", "route.ts"), "utf8");
const pollRoute = fs.readFileSync(path.join(root, "src", "app", "api", "remote-agent", "poll", "route.ts"), "utf8");

assert.ok(cloudRoute.includes("args.productId = preparedProductId"), "submit must derive the canonical product id from contextJobId");
assert.ok(cloudRoute.includes("args.contextSnapshot = contextData"), "cloud submit must forward the immutable context snapshot");
assert.ok(!cloudRoute.includes("code: 'DRAFT_CONTEXT_MISMATCH'"), "ambiguous mismatch error must be removed");
assert.ok(cloudRoute.includes("code: 'PRODUCT_SNAPSHOT_CHANGED'"), "snapshot failures need a precise error code");
assert.ok(localDraftRoute.includes("BRANDLINK_SUBMITTED_CONTEXT_PATH"), "local draft submit must pin the forwarded snapshot");
assert.ok(pollRoute.includes("contextSnapshot: input.contextSnapshot"), "remote poller must forward the context to the local API");
assert.ok(pollRoute.includes("uploadDraftImageAssets"), "draft image results must get HTTPS asset URLs");

console.log(JSON.stringify({ ok: true, snapshotId: snapshot.snapshotId, canonicalProductId: productId, httpsImageBridge: true }));

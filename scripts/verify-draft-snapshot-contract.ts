import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createProductSnapshot, readProductSnapshot } from "../src/lib/draft-context-snapshot";
import { buildPreparedDraftView } from "../src/lib/draft-context-view";
import { resolvePreparedDraftContext } from "../apps/sites/lib/draft-context";

const productId = "2800ccf0-980c-45be-89bb-7cb64744232f";
const mutableProduct = { name: "유토렉스 칫솔살균기", referenceImageUrls: ["https://example.test/original.jpg"] };
const detached = createProductSnapshot({ productId, connectKind: "SHOPPING", externalProductId: "utorex-1", sourceUrl: "https://example.test/utorex", product: mutableProduct });
mutableProduct.name = "국내생산 100% 3년연속 브랜드 대상 수상";
mutableProduct.referenceImageUrls.push("https://example.test/other.jpg");
assert.equal(detached.product.name, "유토렉스 칫솔살균기");
assert.deepEqual(detached.product.referenceImageUrls, ["https://example.test/original.jpg"]);
assert.ok(readProductSnapshot(detached), "collection mutations must not invalidate an existing snapshot");
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
assert.ok(cloudRoute.includes("args.contextSnapshot = resolved.forward"), "cloud submit must forward the resolved immutable context snapshot");
assert.ok(!cloudRoute.includes("code: 'DRAFT_CONTEXT_MISMATCH'"), "ambiguous mismatch error must be removed");
assert.ok(cloudRoute.includes("rejectContext('PRODUCT_SNAPSHOT_CHANGED'"), "snapshot failures need a traceable error code");
assert.ok(localDraftRoute.includes("BRANDLINK_SUBMITTED_CONTEXT_PATH"), "local draft submit must pin the forwarded snapshot");
assert.ok(pollRoute.includes("contextSnapshot: input.contextSnapshot"), "remote poller must forward the context to the local API");
assert.ok(pollRoute.includes("uploadDraftImageAssets"), "draft image results must get HTTPS asset URLs");

assert.ok(pollRoute.includes("@/lib/draft-context-view"), "the executor must build the prepared view from the shared module");

// 준비 결과 → 사이트 검증 → PC 스냅샷 검사 왕복. 1.3.10 은 컨텍스트를 data.context 아래로 내려
// 이 왕복이 전부 PRODUCT_SNAPSHOT_CHANGED 로 끊겼다.
const preparedContext: Record<string, unknown> = {
  version: "brand-draft-context/v2",
  productId,
  connectKind: "TRAVEL",
  externalProductId: snapshot.externalProductId,
  sourceUrl: snapshot.sourceUrl,
  snapshotId: snapshot.snapshotId,
  generatedAt: snapshot.capturedAt,
  snapshot,
  product: { ...snapshot.product, price: "1,290,000원", storeName: "모두투어" },
  generation: {
    minimumSectionCount: 7,
    maximumSectionCount: 12,
    systemPrompt: "system",
    userPrompt: "user",
    outputSchema: { title: "string" },
    writingContract: { version: "writing-contract/v1" },
    qualityChecklist: { version: "brand-draft-quality-checklist/v1" },
  },
  imageIntents: [{ title: "장소", intent: "해변" }],
  nextAction: "post_submit_draft",
};

const warnings: string[] = [];
const view = buildPreparedDraftView(preparedContext, productId, "job_prepare_1", warnings);
assert.equal(readProductSnapshot(view.snapshot, { productId, connectKind: "TRAVEL" })?.snapshotId, snapshot.snapshotId, "the prepared view must keep a verifiable snapshot at the top level");
assert.equal(view.snapshotId, snapshot.snapshotId);
assert.equal(view.version, "brand-draft-context/v2");
assert.ok(!("context" in view), "the v2 context must not be nested under context");
assert.ok(Array.isArray(view.verifiedFacts) && (view.verifiedFacts as string[]).some((line) => line.startsWith("상품명:")), "ChatGPT reads verifiedFacts from the top level");
assert.equal(view.systemPrompt, "system");
assert.deepEqual(warnings, []);

const expectation = { productId, connectKind: "travel" };
const legacyV1 = resolvePreparedDraftContext({ data: { version: "brand-draft-context/v1", productId } }, expectation);
assert.equal(legacyV1.ok, false);
if (!legacyV1.ok) assert.equal(legacyV1.code, "DRAFT_CONTEXT_LEGACY");
const missingSnapshot = resolvePreparedDraftContext({ data: { version: "brand-draft-context/v2", productId } }, expectation);
if (!missingSnapshot.ok) assert.equal(missingSnapshot.code, "DRAFT_CONTEXT_SNAPSHOT_MISSING");
const resolvedFixed = resolvePreparedDraftContext({ data: view, productId }, expectation);
assert.equal(resolvedFixed.ok, true, "the 1.3.11 result shape must resolve");
if (resolvedFixed.ok) {
  assert.equal(resolvedFixed.snapshotId, snapshot.snapshotId);
  assert.equal(readProductSnapshot(resolvedFixed.forward.snapshot, { productId, connectKind: "TRAVEL" })?.snapshotId, snapshot.snapshotId);
  for (const heavy of ["systemPrompt", "userPrompt", "generation", "harness", "verifiedFacts", "context", "product"]) {
    assert.ok(!(heavy in resolvedFixed.forward), `forwarded context must stay slim: ${heavy}`);
  }
  assert.equal(resolvedFixed.forward.contextJobId, "job_prepare_1");
}

// 이미 배포된 1.3.10 PC 도 사이트만 고치면 통과해야 한다.
const legacyNested = { data: { context: preparedContext, productId, connectKind: "travel", snapshotId: snapshot.snapshotId } };
const resolvedNested = resolvePreparedDraftContext(legacyNested, expectation);
assert.equal(resolvedNested.ok, true, "the 1.3.10 nested result shape must still resolve");
if (resolvedNested.ok) {
  assert.equal(resolvedNested.snapshotId, snapshot.snapshotId);
  assert.equal(readProductSnapshot(resolvedNested.forward.snapshot, { productId, connectKind: "TRAVEL" })?.snapshotId, snapshot.snapshotId);
}

const tamperedNested = { data: { context: { ...preparedContext, snapshotId: "0".repeat(64) }, productId, snapshotId: "0".repeat(64) } };
const resolvedTampered = resolvePreparedDraftContext(tamperedNested, expectation);
assert.equal(resolvedTampered.ok, false);
if (!resolvedTampered.ok) assert.equal(resolvedTampered.code, "PRODUCT_SNAPSHOT_CHANGED");
assert.equal(resolvePreparedDraftContext({ data: view, productId }, { productId: "other", connectKind: "travel" }).ok, false);
assert.equal(resolvePreparedDraftContext({ data: view, productId }, { productId, connectKind: "shopping" }).ok, false);

// 예산을 넘기면 최상위 프롬프트만 비우고 generation 원본은 남긴다.
const oversizeWarnings: string[] = [];
const oversize = buildPreparedDraftView({
  ...preparedContext,
  generation: { ...(preparedContext.generation as Record<string, unknown>), systemPrompt: "가".repeat(900 * 1024) },
}, productId, "job_prepare_2", oversizeWarnings);
assert.equal(oversize.systemPrompt, null);
assert.equal(readProductSnapshot(oversize.snapshot, { productId, connectKind: "TRAVEL" })?.snapshotId, snapshot.snapshotId);
assert.ok(oversizeWarnings.some((warning) => warning.includes("generation 안에서만")));

console.log(JSON.stringify({ ok: true, snapshotId: snapshot.snapshotId, canonicalProductId: productId, httpsImageBridge: true, preparedViewRoundTrip: true, legacyNestedAccepted: true }));

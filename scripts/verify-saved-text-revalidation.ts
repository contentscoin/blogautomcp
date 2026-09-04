import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";
import { revalidateSavedBrandPostText, resolveSavedQcSource, type RecheckIdentity } from "../src/lib/brand-post-revalidation";
import { resolvePostDocument } from "../src/lib/post-composition-contract";
import { readBrandPostPackage, writeBrandPostPackageManifest, packagePreview, type BrandPostPackageManifestV2 } from "../src/lib/brand-post-package";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "saved-text-qc-"));
const oldData = process.env.DESKTOP_USER_DATA;
process.env.DESKTOP_USER_DATA = temp;
try {
  const identity: RecheckIdentity = { productId: "saved-qc-fixture", connectKind: "TRAVEL", externalProductId: "123", sourceUrl: "https://example.test/item/123", productName: "대만 타이베이 여행", brandLink: "https://naver.me/fixture" };
  const snapshot = createProductSnapshot({ ...identity, product: { name: identity.productName, description: "대만 타이베이 지우펀 야시장 역사 문화", features: ["지우펀", "타이베이"] } });
  const image = path.join(temp, "hero.png");
  fs.writeFileSync(image, "isolated image fixture");
  const composition = resolvePostDocument({ connectKind: "TRAVEL", title: "대만 타이베이 골목과 지우펀 풍경", sections: ["지우펀 골목\n역사와 문화가 담긴 골목에서 야경을 즐겨요. 편한 신발로 이동하세요.", "이 글은 네이버 여행 커넥트 활동으로 수수료를 제공받습니다."], imagePaths: [image], hashtags: ["대만", "지우펀", "타이베이"], connectUrl: identity.brandLink, qualityPreset: "PREMIUM" });
  const fixture: BrandPostPackageManifestV2 = {
    version: "brand-post-package/v2", contractVersion: "post-composition-contract/v1", brandLinkId: identity.productId, connectKind: "TRAVEL", title: composition.title,
    generationSource: "AI", composition, sourceSnapshot: snapshot, markdownPath: path.join(temp, "post.md"), heroImagePath: image, bodyImagePaths: [], hashtags: ["대만", "지우펀", "타이베이"], imagePolicy: "TRAVEL_EDITORIAL", createdAt: "2026-09-01", approvedAt: "2026-09-02",
    thumbnailSpec: { version: "thumbnail-spec/v2", canvas: { width: 1000, height: 1000, aspect: "1:1" }, style: "fixture", sourcePolicy: "TRAVEL_EDITORIAL", sourceImagePath: image },
  };
  const first = revalidateSavedBrandPostText(fixture, identity);
  fixture.contentQuality = { ...first.contentQuality!, code: "missing-review-substance", reason: "추천·비추천 여행자, 상품별 최종 판단, 편집 역할 preparation" };
  const original = JSON.stringify(fixture);
  const result = revalidateSavedBrandPostText(fixture, identity);
  assert.notEqual(result.contentQuality?.reason, fixture.contentQuality.reason);
  assert.equal(result.contentQuality?.canPublish, false, "An actually short body must remain blocked despite stale old reason");
  assert.equal(result.approvedAt, null);
  assert.equal(JSON.stringify(fixture), original, "Pure recheck must not mutate input");
  assert.equal(result.textQualityRevalidation?.inputFingerprint, first.textQualityRevalidation?.inputFingerprint);
  assert.equal("sourceSnapshot" in packagePreview(result), false, "Source facts stay server-side");
  assert.throws(() => revalidateSavedBrandPostText(fixture, { ...identity, productId: "another-product" }));
  assert.throws(() => revalidateSavedBrandPostText(fixture, { ...identity, externalProductId: "456" }));
  assert.doesNotThrow(() => revalidateSavedBrandPostText(fixture, { ...identity, productName: "새 가격 상품 제목", sourceUrl: "https://example.test/item/123?date=next" }));
  const urlIdentity = { ...identity, externalProductId: null };
  const urlFixture = { ...fixture, sourceSnapshot: createProductSnapshot({ ...urlIdentity, product: snapshot.product }) };
  assert.doesNotThrow(() => revalidateSavedBrandPostText(urlFixture, { ...urlIdentity, sourceUrl: `${identity.sourceUrl}#details` }));
  assert.throws(() => revalidateSavedBrandPostText(urlFixture, { ...urlIdentity, sourceUrl: "https://example.test/item/other" }), (error: unknown) => (error as { code: string }).code === "PRODUCT_SNAPSHOT_CHANGED");
  const tampered = structuredClone(fixture);
  tampered.sourceSnapshot!.product.description = "tampered";
  assert.throws(() => revalidateSavedBrandPostText(tampered, identity));
  const unsafe = structuredClone(fixture);
  unsafe.composition.sections[0].body.push("제가 직접 다녀왔어요.");
  unsafe.composition.renderNodes.push({ kind: "paragraph", sectionId: unsafe.composition.sections[0].id, text: "제가 직접 다녀왔어요." });
  unsafe.composition.experienceMode = "VERIFIED_EXPERIENCE";
  const unsafeResult = revalidateSavedBrandPostText(unsafe, identity);
  assert.ok(unsafeResult.contentQuality?.blockers.some((item) => item.code === "unsupported-experience-claim"));
  assert.notEqual(result.textQualityRevalidation?.inputFingerprint, unsafeResult.textQualityRevalidation?.inputFingerprint);
  const mismatch = structuredClone(fixture);
  mismatch.composition.sections[0].body.push("unrendered content");
  assert.throws(() => revalidateSavedBrandPostText(mismatch, identity), /렌더/);
  const legacy = { ...fixture, sourceSnapshot: undefined };
  assert.throws(() => resolveSavedQcSource(legacy, identity));
  const context = { version: "brand-draft-context/v2", productId: identity.productId, connectKind: identity.connectKind, snapshot };
  assert.equal(resolveSavedQcSource(legacy, identity, context).origin, "saved-context");
  assert.throws(() => resolveSavedQcSource(legacy, identity, { ...context, productId: "another-product" }));
  legacy.postSpec = { version: "post-spec/v1", productId: identity.productId, connectKind: identity.connectKind, productName: identity.productName, facts: { lines: ["지우펀 역사 골목"] } };
  assert.equal(resolveSavedQcSource(legacy, identity).origin, "legacy-post-spec");
  assert.throws(() => resolveSavedQcSource(legacy, { ...identity, productName: "다른 상품" }));
  writeBrandPostPackageManifest(fixture);
  const raw = readBrandPostPackage(identity.productId, { migrate: false });
  assert.deepEqual(raw, fixture, "Read-only load must not run old migrations");
  console.log("PASS saved text revalidation: actual-body, safety, provenance, identity, audit and read-only cases");
} finally {
  if (oldData === undefined) delete process.env.DESKTOP_USER_DATA; else process.env.DESKTOP_USER_DATA = oldData;
  fs.rmSync(temp, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { normalizeTypedProductFact } from "./lib/product-source-facts";
import { buildProductReviewAnalysis, hasSufficientProductReviewEvidence, isMeaningfulProductEvidenceFeature } from "./lib/product-editorial-plan";
import { planSellerSourceReadingBatches } from "./lib/product-source-intake";
import { recordDownloadedProductSourcePhoto } from "./lib/product-photo-source";
import { readSelectedGalleryComparisons } from "./lib/selected-gallery-comparison";
import { createProductSnapshot } from "../src/lib/draft-context-snapshot";

async function main() {
  const productName = "캐리어 네임택 러기지택 골프네임택 여행 가방 이름표 표시 커스텀 주문제작";
  const actualDomRows = ["원산지: 국산(경기도)", "주요소재: 기타", "형태: 스트랩형", "디테일: 이니셜"];
  const normalized = actualDomRows.map(normalizeTypedProductFact).filter(Boolean);
  assert.deepEqual(normalized, ["원산지: 국산(경기도)", "형태: 스트랩형", "디테일: 이니셜"]);
  assert(normalized.slice(1).every(isMeaningfulProductEvidenceFeature));
  const input = { productName, description: "", targetSectionCount: 11 };
  assert.equal(hasSufficientProductReviewEvidence({ ...input, features: actualDomRows.slice(0, 2) }), false,
    "origin, generic material and the title alone still cannot support a manuscript");
  assert.equal(hasSufficientProductReviewEvidence({ ...input, features: normalized }), false,
    "preserving two real attributes does not silently lower the existing evidence threshold");
  const facts = buildProductReviewAnalysis({ ...input, features: normalized }).verifiedSignals;
  assert(facts.includes("형태: 스트랩형") && facts.includes("디테일: 이니셜"));
  assert.equal(hasSufficientProductReviewEvidence({ ...input, features: [...normalized, "규격: 50mm x 90mm"] }), true,
    "a separate fixture with an additional explicit dimension uses the unchanged gate; that dimension is not an incident-product claim");
  for (const value of ["형태: 치료효과 보장", "형태: 기타", "형태: 옵션 선택", "디테일: 이니셜 미지원", "디테일: 전원 자동 차단"])
    assert.equal(normalizeTypedProductFact(value), "", "a recognized attribute must not admit arbitrary claims or unknown values");

  // Actual source pool order: later ordinary design examples first, publication
  // candidates 0..4 last. No provider is available in this regression.
  const pool = [...Array.from({ length: 19 }, (_, index) => `seller-${index + 5}`), ...Array.from({ length: 5 }, (_, index) => `seller-${index}`)];
  const batches = planSellerSourceReadingBatches([...pool, pool[0]], 8);
  assert.equal(batches.length, 2); assert.equal(batches.flat().length, 16);
  assert.equal(new Set(batches.flat()).size, 16);
  assert.deepEqual(batches[0], pool.slice(0, 8), "high-priority detail reading is preserved");
  for (const index of [0, 1, 2, 3, 4, 21, 22, 23]) assert(batches.flat().includes(`seller-${index}`), "tail instructions and main sources are not starved");
  assert.deepEqual(planSellerSourceReadingBatches(pool.slice(0, 10), 8).flat(), pool.slice(0, 10));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "custom-product-source-"));
  try {
    const file = path.join(directory, "downloaded-original.png");
    const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#b9dbea" } }).png().toBuffer();
    fs.writeFileSync(file, bytes);
    const sourceUrl = "https://shop-phinf.pstatic.net/fixture/custom-selected.png?type=w860";
    const snapshot = createProductSnapshot({ productId: "custom-source-fixture", connectKind: "SHOPPING", sourceUrl: "https://smartstore.naver.com/fixture/products/1",
      externalProductId: "1", product: { name: productName, description: "", features: normalized, referenceImageUrls: [sourceUrl] } });
    const read = () => readSelectedGalleryComparisons({ snapshot, productId: snapshot.productId, sourceDirectory: directory });
    assert.deepEqual(await read(), [], "an unregistered candidate is not canonical source evidence");
    const paths = recordDownloadedProductSourcePhoto(file, sourceUrl);
    assert.equal(paths.length, 2);
    const receiptBytes = fs.readFileSync(paths[0]);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    assert.equal(receipt.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.identityVerified, false); assert.equal(receipt.rightsGranted, false);
    assert.equal((await read())[0]?.sha256, receipt.sha256, "actual download lineage reaches the same-context comparison reader");
    recordDownloadedProductSourcePhoto(file, sourceUrl);
    assert(fs.readFileSync(paths[0]).equals(receiptBytes), "a repeat observation cannot rewrite the original retrieval receipt");
    assert.throws(() => recordDownloadedProductSourcePhoto(file, "https://shop-phinf.pstatic.net/fixture/different.png"), /PROVENANCE_CONFLICT/u);
    assert(fs.readFileSync(paths[0]).equals(receiptBytes));
    assert.throws(() => recordDownloadedProductSourcePhoto(file, "http://127.0.0.1/private"), /허용되지/u);
    fs.writeFileSync(file, await sharp(bytes).negate().png().toBuffer());
    assert.deepEqual(await read(), [], "changed pixels do not retain canonical comparison lineage");
    assert.throws(() => recordDownloadedProductSourcePhoto(file, sourceUrl), /PROVENANCE_CONFLICT/u);
    assert(fs.readFileSync(paths[0]).equals(receiptBytes));
  } finally {
    const target = path.resolve(directory), temporaryRoot = path.resolve(os.tmpdir());
    assert(target.startsWith(temporaryRoot + path.sep) && path.basename(target).startsWith("custom-product-source-"));
    fs.rmSync(target, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, observedCustomAttributes: 2, sourceReadingCallsMaximum: 2,
    selectedImageCount: 16, immutableRetrievalLineage: true, networkCalls: 0, providerCalls: 0, operatingDataWrites: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readProductSnapshot } from "../../src/lib/draft-context-snapshot";
import { isAllowedProductPhotoUrl } from "./product-photo-source";
import { isReviewImageUrl, isSalesPageProductImageUrl } from "./product-image-selection";

/** All intact, unambiguous selected-gallery receipt hashes, not visual approval.
 * Unlike the bounded comparison shortlist, this pool must not hide a later
 * canonical source that is the only photo matching the actual published text. */
export function readCanonicalSellerSourceHashes(options: {
  snapshot: unknown; productId: string; sourceDirectory: string;
}): Set<string> {
  const snapshot = readProductSnapshot(options.snapshot, { productId: options.productId, connectKind: "SHOPPING" });
  if (!snapshot || !options.productId || !path.isAbsolute(options.sourceDirectory))
    throw new Error("REJECTED_ORIGINAL_REPAIR_INVALID: 선택 상품 원본 문맥이 유효하지 않습니다.");
  const urls = new Set((Array.isArray(snapshot.product.referenceImageUrls) ? snapshot.product.referenceImageUrls : []).filter((url): url is string => typeof url === "string" &&
    isAllowedProductPhotoUrl(url) && isSalesPageProductImageUrl(url) && !isReviewImageUrl(url)).slice(0, 20));
  const directory = path.resolve(options.sourceDirectory);
  let names: string[];
  try {
    if (fs.lstatSync(directory).isSymbolicLink() || path.resolve(fs.realpathSync(directory)).toLowerCase() !== directory.toLowerCase())
      throw new Error("Invalid source directory");
    names = fs.readdirSync(directory).filter(name => name.endsWith(".retrieval.json"));
  } catch { throw new Error("REJECTED_ORIGINAL_REPAIR_INVALID: 선택 상품의 검증 원본 캐시가 없습니다."); }
  const hashesByUrl = new Map<string, Set<string>>();
  for (const name of names) {
    try {
      const receiptPath = path.join(directory, name), file = receiptPath.slice(0, -".retrieval.json".length);
      const receiptStat = fs.lstatSync(receiptPath), stat = fs.lstatSync(file);
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size < 1 || receiptStat.size > 32 * 1024 ||
          !stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 24 * 1024 * 1024) continue;
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      if (receipt.version !== "product-image-retrieval/v1" || !urls.has(receipt.sourceUrl) ||
          !/^[a-f0-9]{64}$/u.test(receipt.sha256 || "") || !Number.isFinite(Date.parse(receipt.retrievedAt || "")) ||
          Date.parse(receipt.retrievedAt) > Date.now()) continue;
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (hash !== receipt.sha256) continue;
      const hashes = hashesByUrl.get(receipt.sourceUrl) || new Set<string>(); hashes.add(hash); hashesByUrl.set(receipt.sourceUrl, hashes);
    } catch { /* Unbound, forged or changed cache bytes are never eligible. */ }
  }
  return new Set([...hashesByUrl.values()].filter(hashes => hashes.size === 1).flatMap(hashes => [...hashes]));
}

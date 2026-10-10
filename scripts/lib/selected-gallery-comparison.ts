import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readProductSnapshot } from "../../src/lib/draft-context-snapshot";
import { isAllowedProductPhotoUrl } from "./product-photo-source";
import { isReviewImageUrl, isSalesPageProductImageUrl } from "./product-image-selection";

export interface SelectedGalleryComparisonImage {
  path: string;
  sha256: string;
  sourceUrl: string;
  sourceSnapshotId: string;
  receiptPath: string;
  receiptSha256: string;
}

// Discovery only: quantities must come from canonical facts. No filename can
// certify the actual pictured product or option; the reviewer reads the pixels.
function quantityTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of value.normalize("NFKC").matchAll(/(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)\s*(ml|kg|mg|g|l)(?![\p{L}\p{N}])/giu)) {
    const [integer, decimal = ""] = match[1].split(".");
    const whole = integer.replace(/^0+(?=\d)/u, "");
    const fraction = decimal.replace(/0+$/u, "");
    const amount = fraction ? `${whole}.${fraction}` : whole;
    if (amount !== "0") tokens.add(`${amount}${match[2].toLowerCase()}`);
  }
  return tokens;
}

function filenameMatchesQuantity(url: string, selectedQuantities: Set<string>): boolean {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
    return [...quantityTokens(filename)].some(token => selectedQuantities.has(token));
  } catch { return false; }
}

/** Server-owned snapshot/gallery lineage only, NEVER visual identity approval.
 * Read cached original bytes; no download, normalization or package mutation. */
export async function readSelectedGalleryComparisons(options: {
  snapshot: unknown; productId: string; sourceDirectory: string; maximum?: number;
  publicationOriginalSha256?: string;
}): Promise<SelectedGalleryComparisonImage[]> {
  const snapshot = readProductSnapshot(options.snapshot, { productId: options.productId, connectKind: "SHOPPING" });
  if (!options.productId || !snapshot || !options.sourceDirectory || !path.isAbsolute(options.sourceDirectory))
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 비교 근거의 저장 상품 스냅샷을 검증할 수 없습니다.");
  const gallery = Array.isArray(snapshot.product.referenceImageUrls)
    ? [...new Set(snapshot.product.referenceImageUrls.filter((url): url is string => typeof url === "string" &&
      isAllowedProductPhotoUrl(url) && isSalesPageProductImageUrl(url) && !isReviewImageUrl(url)))].slice(0, 20) : [];
  const maximum = Math.max(1, Math.min(5, Math.floor(Number.isFinite(options.maximum) ? options.maximum! : 5)));
  const product = snapshot.product;
  const selectedQuantities = new Set([product.name, product.description, ...(Array.isArray(product.features) ? product.features : [])]
    .filter((value): value is string => typeof value === "string").flatMap(value => [...quantityTokens(value)]));
  let directory: string, names: string[];
  try { directory = fs.realpathSync(options.sourceDirectory); names = fs.readdirSync(directory).filter(name => name.endsWith(".retrieval.json")).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // Legacy cache absent.
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 비교 근거의 원본 캐시 경로가 올바르지 않습니다.");
  }
  const candidates = new Map<string, SelectedGalleryComparisonImage[]>();
  for (const name of names) {
    try {
      const receiptPath = path.join(directory, name);
      const receiptStat = fs.statSync(receiptPath);
      if (!receiptStat.isFile() || receiptStat.size < 1 || receiptStat.size > 32 * 1024 || path.dirname(fs.realpathSync(receiptPath)) !== directory) continue;
      const receiptBytes = fs.readFileSync(receiptPath), receipt = JSON.parse(receiptBytes.toString("utf8"));
      if (receipt.version !== "product-image-retrieval/v1" || !gallery.includes(receipt.sourceUrl) ||
          typeof receipt.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
          typeof receipt.retrievedAt !== "string" || !Number.isFinite(Date.parse(receipt.retrievedAt)) || Date.parse(receipt.retrievedAt) > Date.now()) continue;
      const file = path.join(directory, name.slice(0, -".retrieval.json".length)), stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024 || path.dirname(fs.realpathSync(file)) !== directory) continue;
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (sha256 !== receipt.sha256) continue;
      const candidate = { path: file, sha256, sourceUrl: receipt.sourceUrl, sourceSnapshotId: snapshot.snapshotId,
        receiptPath, receiptSha256: crypto.createHash("sha256").update(receiptBytes).digest("hex") };
      candidates.set(receipt.sourceUrl, [...(candidates.get(receipt.sourceUrl) ?? []), candidate]);
    } catch { /* Unbound or corrupt cached bytes cannot become comparison evidence. */ }
  }
  const selected: SelectedGalleryComparisonImage[] = [], seen = new Set<string>();
  let supplementalQuantityCount = 0, supplementalOriginalCount = 0;
  for (const url of gallery) {
    const matching = candidates.get(url) ?? [];
    // Multiple different recorded originals for one URL are ambiguous; no
    // newest receipt or filename guess can identify the frozen source pixels.
    if (new Set(matching.map(candidate => candidate.sha256)).size !== 1) continue;
    const candidate = matching[0];
    const quantityContext = supplementalQuantityCount < 2 && filenameMatchesQuantity(url, selectedQuantities);
    const originalContext = supplementalOriginalCount === 0 && candidate.sha256 === options.publicationOriginalSha256;
    // Two static originals, two quantity-discovered contexts, and at most one
    // exact publication ORIGINAL from the same canonical gallery. Matching
    // source bytes establish lineage only, never visual identity approval.
    if (selected.length >= 2 && !quantityContext && !originalContext) continue;
    if (!seen.has(candidate.sha256)) {
      // Optional gallery discovery must not promote animated or broken cache
      // entries into declared evidence and then block an unrelated final photo.
      // Decode all pages to distinguish a static image from a first-frame read;
      // never extract an animation frame or repair source bytes here.
      try {
        const bytes = fs.readFileSync(candidate.path);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) continue;
        const metadata = await sharp(bytes, { animated: true, failOn: "warning" }).metadata();
        if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 ||
            !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) continue;
        await sharp(bytes, { animated: true, failOn: "warning" }).rotate().png().toBuffer();
        if (crypto.createHash("sha256").update(fs.readFileSync(candidate.path)).digest("hex") !== candidate.sha256 ||
            crypto.createHash("sha256").update(fs.readFileSync(candidate.receiptPath)).digest("hex") !== candidate.receiptSha256) continue;
        if (selected.length >= 2) {
          if (quantityContext) supplementalQuantityCount++;
          else supplementalOriginalCount++;
        }
        selected.push(candidate); seen.add(candidate.sha256);
      } catch { /* An optional undecodable original is not comparison evidence. */ }
    }
    if (selected.length >= maximum) break;
  }
  // Do not return a stale earlier binding if its files changed while a later
  // optional gallery candidate was being decoded.
  return selected.filter(candidate => {
    try {
      return crypto.createHash("sha256").update(fs.readFileSync(candidate.path)).digest("hex") === candidate.sha256 &&
        crypto.createHash("sha256").update(fs.readFileSync(candidate.receiptPath)).digest("hex") === candidate.receiptSha256;
    } catch { return false; }
  });
}

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
  // Fill only a spare comparison slot, after every existing priority. Geometry
  // discovers one bounded detail candidate; it cannot certify a catalog, SKU,
  // included component or quantity. Very long seller documents are not readable
  // single-image context. Existing references must never be displaced by this.
  if (selected.length < maximum) {
    const details: Array<{ candidate: SelectedGalleryComparisonImage; aspect: number }> = [];
    for (const url of gallery) {
      const matching = candidates.get(url) ?? [];
      if (new Set(matching.map(candidate => candidate.sha256)).size !== 1) continue;
      const candidate = matching[0];
      if (seen.has(candidate.sha256)) continue;
      try {
        const bytes = fs.readFileSync(candidate.path);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) continue;
        const metadata = await sharp(bytes, { animated: true, failOn: "warning" }).metadata();
        if (!metadata.width || !metadata.height || metadata.height <= metadata.width || metadata.height > 4096 ||
            (metadata.pages ?? 1) !== 1 || !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) continue;
        details.push({ candidate, aspect: metadata.height / metadata.width });
      } catch { /* Unreadable optional details are not comparison evidence. */ }
    }
    // Stable sort retains canonical gallery order for equal aspect ratios.
    details.sort((a, b) => b.aspect - a.aspect);
    for (const { candidate } of details) {
      try {
        const bytes = fs.readFileSync(candidate.path);
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) continue;
        const decoded = await sharp(bytes, { animated: true, failOn: "warning" }).rotate().png().toBuffer();
        // An optional detail alone must fit the unchanged final-audit transport
        // ceiling. The audit still enforces its full per-request byte budget.
        if (decoded.length > 8 * 1024 * 1024 ||
            crypto.createHash("sha256").update(fs.readFileSync(candidate.path)).digest("hex") !== candidate.sha256 ||
            crypto.createHash("sha256").update(fs.readFileSync(candidate.receiptPath)).digest("hex") !== candidate.receiptSha256) continue;
        selected.push(candidate); seen.add(candidate.sha256);
        break;
      } catch { /* A broken detail cannot hide the next usable bounded detail. */ }
    }
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

/** Preserve the slot's independently bound canonical primary even when the
 * optional comparison shortlist omitted it. This is receipt/byte lineage only;
 * no pixel verdict, literal certification or repair authority is created. */
export async function readPublicationIdentifierReferenceBindings(options: {
  snapshot: unknown; productId: string; sourceDirectory: string;
  publicationOriginalSha256?: string; primaryReference: { path: string; sha256: string };
}): Promise<SelectedGalleryComparisonImage[]> {
  const base = await readSelectedGalleryComparisons(options);
  const primary = options.primaryReference;
  if (!primary || !/^[a-f0-9]{64}$/u.test(primary.sha256) || !path.isAbsolute(primary.path))
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진의 고정 원본 연결이 유효하지 않습니다.");
  const stat = fs.statSync(primary.path);
  if (!stat.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024 ||
      crypto.createHash("sha256").update(fs.readFileSync(primary.path)).digest("hex") !== primary.sha256)
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진의 고정 원본 바이트가 변경되었습니다.");
  const own = base.find(reference => reference.sha256 === primary.sha256) ??
    (await readSelectedGalleryComparisons({ ...options, publicationOriginalSha256: primary.sha256 }))
      .find(reference => reference.sha256 === primary.sha256);
  // An unreceipted primary remains unreceipted. Never infer its snapshot from
  // another source's ID or manufacture canonical membership from scene metadata.
  if (!own) return base;
  if (crypto.createHash("sha256").update(fs.readFileSync(primary.path)).digest("hex") !== primary.sha256 ||
      crypto.createHash("sha256").update(fs.readFileSync(own.path)).digest("hex") !== own.sha256 ||
      crypto.createHash("sha256").update(fs.readFileSync(own.receiptPath)).digest("hex") !== own.receiptSha256)
    throw new Error("SELECTED_SOURCE_CONTEXT_INVALID: 본문 사진 원본의 수집 증거가 변경되었습니다.");
  // The primary was already attached/observed separately. Keep every existing
  // optional reference when space permits; only the final optional item yields
  // to the exact own primary at the unchanged five-reference ceiling.
  return [...base.filter(reference => reference.sha256 !== own.sha256).slice(0, 4), own];
}

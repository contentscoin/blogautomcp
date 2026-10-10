import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { selectVerifiedProductPhoto, selectVerifiedProductPhotos } from "./product-photo-review";

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export const PRODUCT_SOURCE_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

function validProductSourceReceipts(outputDir: string): Array<{ file: string; sourceUrl: string; sha256: string; retrievedAt: number }> {
  try {
    return fs.readdirSync(outputDir).filter(name => name.endsWith(".retrieval.json")).flatMap(name => {
      try {
        const receipt = JSON.parse(fs.readFileSync(path.join(outputDir, name), "utf8"));
        const file = path.join(outputDir, name.slice(0, -".retrieval.json".length));
        const stat = fs.statSync(file);
        if (receipt.version !== "product-image-retrieval/v1" || !isAllowedProductPhotoUrl(receipt.sourceUrl) ||
            !/^[a-f0-9]{64}$/u.test(receipt.sha256 || "") || !stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_BYTES ||
            crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== receipt.sha256) return [];
        return [{ file, sourceUrl: receipt.sourceUrl, sha256: receipt.sha256, retrievedAt: Date.parse(receipt.retrievedAt || "") }];
      } catch { return []; }
    });
  } catch { return []; }
}

/** Resume from an intact download receipt; cached pixels still require visual review. */
export function readSavedProductSourceCandidates(outputDir: string): string[] {
  return validProductSourceReceipts(outputDir).map(receipt => receipt.file);
}

export function isAllowedProductPhotoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (host === "pstatic.net" || host.endsWith(".pstatic.net") || host === "naver.net" || host.endsWith(".naver.net") ||
        // Exact seller detail CDN observed on the product page; never trust
        // arbitrary CloudFront tenants or a hostname suffix lookalike.
        host === "d15zs6bxpcjiwz.cloudfront.net");
  } catch { return false; }
}

/** This is source retrieval only. The returned pixels still require photo QC. */
export async function downloadProductSourcePhoto(url: string, outputDir: string): Promise<string> {
  if (!isAllowedProductPhotoUrl(url)) throw new Error("허용되지 않은 상품 사진 주소입니다.");
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25_000) });
  if (!response.ok || !response.body) throw new Error(`상품 사진 다운로드 실패 (${response.status})`);
  if (!(response.headers.get("content-type") || "").toLowerCase().startsWith("image/") ||
      Number(response.headers.get("content-length") || "0") > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    throw new Error("상품 사진 응답 형식 또는 크기가 올바르지 않습니다.");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("상품 사진이 허용 크기를 초과했습니다.");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("상품 사진 응답이 비어 있습니다.");
  const bytes = Buffer.concat(chunks);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.format || !["jpeg", "png", "webp", "gif", "avif", "heif"].includes(metadata.format) ||
      !metadata.width || !metadata.height) throw new Error("다운로드 결과가 상품 사진 파일이 아닙니다.");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.resolve(outputDir, `${hash}.${metadata.format === "jpeg" ? "jpg" : metadata.format}`);
  try { fs.writeFileSync(file, bytes, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" ||
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== hash) throw error;
  }
  // Retrieval is not a rights grant or a model-identity approval. Keep its
  // origin separately from the subsequent visual QC / locked-product receipt.
  fs.writeFileSync(`${file}.retrieval.json`, JSON.stringify({
    version: "product-image-retrieval/v1", sourceUrl: url, sha256: hash,
    retrievedAt: new Date().toISOString(), identityVerified: false, rightsGranted: false,
  }), "utf8");
  return file;
}

/**
 * Final publication audit accepts only a single, fully decodable static frame. Seller galleries
 * often contain animated GIF/WebP banners or JPEGs with harmless decoder warnings. Keep a clean
 * static sibling (first frame, re-encoded PNG) so those photos can still be reviewed and used.
 * Returns null when the file cannot be decoded at all.
 */
export async function ensureStaticDecodableImage(file: string): Promise<string | null> {
  let bytes: Buffer;
  try { bytes = fs.readFileSync(file); } catch { return null; }
  try {
    const metadata = await sharp(bytes, { failOn: "warning" }).metadata();
    if ((metadata.pages ?? 1) === 1) {
      await sharp(bytes, { failOn: "warning" }).rotate().raw().toBuffer();
      return file;
    }
  } catch { /* fall through to a tolerant re-encode */ }
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const target = path.join(path.dirname(file), `${hash}.static.png`);
  try {
    const png = await sharp(bytes, { failOn: "error", page: 0, pages: 1 }).rotate().png().toBuffer();
    const check = await sharp(png, { failOn: "warning" }).metadata();
    if (!check.width || !check.height) return null;
    if (fs.existsSync(target)) {
      // Legacy static receipts contain the original SHA, not this re-encode's
      // SHA. Recompute lineage from the intact original; never bless or replace
      // a changed sibling merely because its content-derived filename matches.
      if (!fs.readFileSync(target).equals(png)) return null;
    } else {
      let created = false;
      try { fs.writeFileSync(target, png, { flag: "wx" }); created = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !fs.readFileSync(target).equals(png)) return null;
      }
      if (created && fs.existsSync(`${file}.retrieval.json`) && !fs.existsSync(`${target}.retrieval.json`)) {
        fs.copyFileSync(`${file}.retrieval.json`, `${target}.retrieval.json`, fs.constants.COPYFILE_EXCL);
      }
    }
    return target;
  } catch {
    return null;
  }
}

/**
 * Collect intact seller-gallery files without deciding whether they are plain
 * product photos. A later section-intent review may legitimately accept an
 * official feature panel that the generic packshot filter must reject.
 */
export async function collectShoppingProductSourceCandidates(options: {
  localCandidates: string[];
  sourceImageUrls?: string[];
  outputDir: string;
  maximum?: number;
  /** A deliberate seller-source refresh bypasses recent retrieval reuse. */
  forceRefresh?: boolean;
}, dependencies: { download: typeof downloadProductSourcePhoto; normalize?: (file: string) => Promise<string | null>;
  now?: () => number } = { download: downloadProductSourcePhoto }): Promise<string[]> {
  const maximum = Math.max(1, Math.min(20, Math.floor(options.maximum || 16)));
  const byHash = new Map<string, string>();
  const add = async (file: string, expectedSourceHash?: string) => {
    if (byHash.size >= maximum) return false;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_BYTES) return false;
      if (expectedSourceHash && crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expectedSourceHash) return false;
      // Animated or warning-laden files are swapped for their static sibling; undecodable ones are skipped.
      const usable = await (dependencies.normalize ?? ensureStaticDecodableImage)(path.resolve(file));
      if (!usable) return false;
      if (expectedSourceHash && crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== expectedSourceHash) return false;
      const resolved = path.resolve(usable);
      const hash = crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
      if (!byHash.has(hash)) byHash.set(hash, resolved);
      return true;
    } catch { return false; /* A missing local candidate is retried from saved URLs. */ }
  };
  // A deliberate refresh must reach the seller even when saved local files
  // already fill the candidate quota. Keep the default preserved-source order.
  if (!options.forceRefresh) for (const file of options.localCandidates) await add(file);
  const sources = [...new Set(options.sourceImageUrls || [])].filter(isAllowedProductPhotoUrl).slice(0, 20);
  const now = (dependencies.now ?? Date.now)();
  // Reusing a receipt is retrieval only, never approval or a negative QA cache.
  // Expiry and explicit refresh allow a seller to replace pixels at the same URL.
  const recentReceipts = options.forceRefresh ? [] : validProductSourceReceipts(options.outputDir)
    .filter(receipt => Number.isFinite(receipt.retrievedAt) && receipt.retrievedAt <= now && now - receipt.retrievedAt < PRODUCT_SOURCE_RECEIPT_TTL_MS)
    .sort((left, right) => right.retrievedAt - left.retrievedAt);
  let downloaded = 0;
  for (const url of sources) {
    if (byHash.size >= maximum) break;
    const recent = recentReceipts.filter(receipt => receipt.sourceUrl === url);
    // Equal-time receipts for different pixels are ambiguous; refresh instead.
    const latest = recent.filter(receipt => receipt.retrievedAt === recent[0]?.retrievedAt);
    if (recent.length && new Set(latest.map(receipt => receipt.sha256)).size === 1 && await add(recent[0].file, recent[0].sha256)) {
      downloaded += 1;
      continue;
    }
    try {
      await add(await dependencies.download(url, options.outputDir));
      downloaded += 1;
    } catch { /* One unavailable seller image does not block the rest. */ }
  }
  if (options.forceRefresh) for (const file of options.localCandidates) await add(file);
  if (byHash.size === 0 && sources.length > 0 && downloaded === 0) {
    throw new Error("PRODUCT_SOURCE_DOWNLOAD_FAILED: 저장된 판매페이지 상품 이미지를 내려받지 못했습니다.");
  }
  return [...byHash.values()];
}

export async function selectShoppingProductSource(options: {
  localCandidates: string[];
  productName: string;
  sourceImageUrls?: string[];
  outputDir: string;
}, dependencies = { verify: selectVerifiedProductPhoto, download: downloadProductSourcePhoto }): Promise<string | null> {
  const local = await dependencies.verify(options.localCandidates, options.productName);
  if (local) return local;
  const sources = [...new Set(options.sourceImageUrls || [])].filter(isAllowedProductPhotoUrl).slice(0, 12);
  let downloaded = 0;
  for (const url of sources) {
    let file: string;
    try { file = await dependencies.download(url, options.outputDir); downloaded += 1; }
    catch { continue; } // One removed seller image does not block the next photo.
    // Provider/login/version errors are not evidence that a photo is absent.
    const accepted = await dependencies.verify([file], options.productName);
    if (accepted) return accepted;
  }
  if (sources.length > 0 && downloaded === 0) {
    throw new Error("PRODUCT_SOURCE_DOWNLOAD_FAILED: 저장된 판매페이지 상품 사진을 내려받지 못했습니다.");
  }
  return null;
}

/** Collect distinct, individually reviewed photos for section-specific use. */
export async function selectShoppingProductSources(options: {
  localCandidates: string[];
  productName: string;
  sourceImageUrls?: string[];
  outputDir: string;
  maximum: number;
  /** Successful composites already using these source bytes get lower priority. */
  excludeSha256?: string[];
}, dependencies = { verify: selectVerifiedProductPhotos, download: downloadProductSourcePhoto }): Promise<string[]> {
  const maximum = Math.max(1, Math.min(12, Math.floor(options.maximum)));
  const excluded = new Set(options.excludeSha256 || []);
  const fileHash = (file: string): string | null => {
    try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
    catch { return null; }
  };
  const selected = await dependencies.verify(
    options.localCandidates.filter(file => {
      const hash = fileHash(file);
      return hash != null && !excluded.has(hash);
    }),
    options.productName,
    maximum,
  );
  const byHash = new Map<string, string>();
  for (const file of selected) {
    try {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (!excluded.has(hash)) byHash.set(hash, file);
    }
    catch { /* A vanished local candidate is retried from saved URLs below. */ }
  }
  const sources = [...new Set(options.sourceImageUrls || [])].filter(isAllowedProductPhotoUrl).slice(0, 12);
  let downloaded = 0;
  for (const url of sources) {
    if (byHash.size >= maximum) break;
    let file: string;
    try { file = await dependencies.download(url, options.outputDir); downloaded += 1; }
    catch { continue; }
    const accepted = await dependencies.verify([file], options.productName, 1);
    if (!accepted[0]) continue;
    try {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(accepted[0])).digest("hex");
      if (!excluded.has(hash)) byHash.set(hash, accepted[0]);
    }
    catch { /* Continue to the next source. */ }
  }
  if (byHash.size === 0 && sources.length > 0 && downloaded === 0) {
    throw new Error("PRODUCT_SOURCE_DOWNLOAD_FAILED: 저장된 판매페이지 상품 사진을 내려받지 못했습니다.");
  }
  return [...byHash.values()].slice(0, maximum);
}

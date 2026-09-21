import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { selectVerifiedProductPhoto, selectVerifiedProductPhotos } from "./product-photo-review";

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** Resume from an intact download receipt; cached pixels still require visual review. */
export function readSavedProductSourceCandidates(outputDir: string): string[] {
  try {
    return fs.readdirSync(outputDir).filter(name => name.endsWith(".retrieval.json")).flatMap(name => {
      try {
        const receipt = JSON.parse(fs.readFileSync(path.join(outputDir, name), "utf8"));
        const file = path.join(outputDir, name.slice(0, -".retrieval.json".length));
        if (receipt.version !== "product-image-retrieval/v1" || !isAllowedProductPhotoUrl(receipt.sourceUrl) ||
            !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_IMAGE_BYTES ||
            crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== receipt.sha256) return [];
        return [file];
      } catch { return []; }
    });
  } catch { return []; }
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
 * Collect intact seller-gallery files without deciding whether they are plain
 * product photos. A later section-intent review may legitimately accept an
 * official feature panel that the generic packshot filter must reject.
 */
export async function collectShoppingProductSourceCandidates(options: {
  localCandidates: string[];
  sourceImageUrls?: string[];
  outputDir: string;
  maximum?: number;
}, dependencies = { download: downloadProductSourcePhoto }): Promise<string[]> {
  const maximum = Math.max(1, Math.min(20, Math.floor(options.maximum || 16)));
  const byHash = new Map<string, string>();
  const add = (file: string) => {
    if (byHash.size >= maximum) return;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_BYTES) return;
      const resolved = path.resolve(file);
      const hash = crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
      if (!byHash.has(hash)) byHash.set(hash, resolved);
    } catch { /* A missing local candidate is retried from saved URLs. */ }
  };
  for (const file of options.localCandidates) add(file);
  const sources = [...new Set(options.sourceImageUrls || [])].filter(isAllowedProductPhotoUrl).slice(0, 20);
  let downloaded = 0;
  for (const url of sources) {
    if (byHash.size >= maximum) break;
    try {
      add(await dependencies.download(url, options.outputDir));
      downloaded += 1;
    } catch { /* One unavailable seller image does not block the rest. */ }
  }
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

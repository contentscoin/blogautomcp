import { isReviewImageUrl, isSalesPageProductImageUrl, isUsableBlogProductImageDimension } from "./product-image-selection";

/** Normalize an echoed page title, not product/option identity. Naver appends
 * " : 스토어명" to the title; that suffix must not turn the same title into a
 * second, independent description. Model names, options and numeric specs stay. */
export function canonicalProductEvidenceName(value: string | null | undefined): string {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim()
    .replace(/\s+[:：]\s+[^:：]{1,80}$/u, "").trim();
}

export function isProductTitleEcho(value: string | null | undefined, productName: string): boolean {
  const key = (text: string | null | undefined) => String(text || "").normalize("NFKC")
    .replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
  const title = key(productName);
  const description = key(value);
  // Strip only the known page-title suffix. A description such as
  // "테팔 블렌더 : 용량 300ml" adds a fact and must not be shortened to a title.
  return Boolean(title && description && (description === title ||
    description === key(canonicalProductEvidenceName(productName))));
}

export interface SellerSourceEvidenceImage {
  path: string;
  url: string;
  index: number;
  width: number;
  height: number;
  size: number;
  publicationCandidate: boolean;
  detailCrop?: boolean;
}

export const SELLER_SOURCE_IMAGE_LIMIT = 24;
export const SELLER_SOURCE_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Reading seller text is separate from publishing a natural product photo.
 * Wide specifications, later panels and small compressed text images remain
 * readable evidence candidates; their contents still need OCR/vision grounding. */
export function isReadableSellerSourceImage(image: Pick<SellerSourceEvidenceImage, "url" | "width" | "height" | "size">): boolean {
  return isSalesPageProductImageUrl(image.url) && !isReviewImageUrl(image.url) &&
    Number.isFinite(image.width) && Number.isFinite(image.height) && Number.isFinite(image.size) &&
    image.width >= 360 && image.height >= 180 && image.width <= 20_000 && image.height <= 40_000 &&
    image.width * image.height <= 40_000_000 && image.size >= 1_000 && image.size <= SELLER_SOURCE_MAX_IMAGE_BYTES;
}

/** Keep the existing photo/crop list untouched. The evidence pool reaches the
 * later specification panels before spending its budget on the first gallery
 * pictures; no item in this list is thereby approved for publication. */
export function planSellerSourceEvidenceImages(images: readonly SellerSourceEvidenceImage[], maximum = SELLER_SOURCE_IMAGE_LIMIT): SellerSourceEvidenceImage[] {
  const limit = Math.max(0, Math.min(SELLER_SOURCE_IMAGE_LIMIT, Math.floor(maximum)));
  const seen = new Set<string>();
  const priority = (image: SellerSourceEvidenceImage) => image.detailCrop ? 0 :
    !isUsableBlogProductImageDimension(image.width, image.height) ? 1 : !image.publicationCandidate ? 2 : 3;
  return images.filter(image => {
    if (seen.has(image.path) || !isReadableSellerSourceImage(image)) return false;
    seen.add(image.path);
    return true;
  }).sort((left, right) => priority(left) - priority(right) || left.index - right.index).slice(0, limit);
}

/** At most two existing reader calls, with no duplicate attachment. This also
 * uses both chunks when the seller publishes ordinary/wide panels without tall
 * crops. The caller stops before the second chunk once evidence is sufficient. */
export function planSellerSourceReadingBatches(images: readonly string[], maximumPerBatch = 8): string[][] {
  const maximum = Math.max(1, Math.min(16, Math.floor(maximumPerBatch)));
  const unique = [...new Set(images)].slice(0, maximum * 2);
  return [unique.slice(0, maximum), unique.slice(maximum)].filter(batch => batch.length > 0);
}

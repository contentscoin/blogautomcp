export interface ProductThumbnailCopySettings {
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

export interface ProductThumbnailSettings {
  version: 1;
  sourceImageUrl: string;
  generatedPath: string;
  copy: ProductThumbnailCopySettings;
  updatedAt: string;
}

export const PRODUCT_THUMBNAIL_SETTING_PREFIX = "brandlink.thumbnail.";

const LIMITS: Record<keyof ProductThumbnailCopySettings, number> = {
  productNameLabel: 36,
  headline: 24,
  subline: 44,
  badge: 16,
  cta: 20,
};

const BLOCKED_COPY = /(?:직접\s*(?:써|사용|구매)|인생템|최저가|품절\s*임박|무조건\s*추천|No\.?\s*1|1위)/iu;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function productThumbnailSettingKey(brandLinkId: string): string {
  return `${PRODUCT_THUMBNAIL_SETTING_PREFIX}${brandLinkId}`;
}

export function normalizeProductThumbnailCopy(
  input: Partial<ProductThumbnailCopySettings>,
  fallbackProductName: string,
): ProductThumbnailCopySettings {
  const copy: ProductThumbnailCopySettings = {
    productNameLabel: clean(input.productNameLabel) || clean(fallbackProductName) || "추천 상품",
    headline: clean(input.headline) || "구매 전 확인",
    subline: clean(input.subline) || "장단점 빠르게 체크",
    badge: clean(input.badge) || "구매 체크",
    cta: clean(input.cta) || "장단점 보기",
  };

  for (const key of Object.keys(copy) as Array<keyof ProductThumbnailCopySettings>) {
    if (copy[key].length > LIMITS[key]) {
      throw new Error(`${key} 문구는 ${LIMITS[key]}자 이하여야 합니다.`);
    }
    if (BLOCKED_COPY.test(copy[key])) {
      throw new Error(`${key}에 근거 없는 순위·최저가·체험·긴급성 문구를 사용할 수 없습니다.`);
    }
  }
  return copy;
}

export function parseProductThumbnailSettings(value: string | null | undefined): ProductThumbnailSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ProductThumbnailSettings>;
    if (parsed.version !== 1 || !parsed.copy || !clean(parsed.generatedPath)) return null;
    return {
      version: 1,
      sourceImageUrl: clean(parsed.sourceImageUrl),
      generatedPath: clean(parsed.generatedPath),
      copy: normalizeProductThumbnailCopy(parsed.copy, parsed.copy.productNameLabel || "추천 상품"),
      updatedAt: clean(parsed.updatedAt) || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

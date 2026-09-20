import { chooseProductName } from "./product-name-identity";
import type { TravelPageResearch } from "./travel-content";

export interface MergeableProductInfo {
  name: string;
  description: string;
  features: string[];
  price: string;
  originalPrice: string;
  discountRate: string;
  couponInfo: string;
  deliveryInfo: string;
  reviewCount: string;
  rating: string;
  representativeImagePath: string | null;
  imagePaths: string[];
  detailImagePaths: string[];
  sourceImageUrls: string[];
  finalUrl?: string | null;
  storeName?: string | null;
  travelPageResearch?: TravelPageResearch | null;
}

const GENERIC_NAME_TOKEN = /^(?:상품|제품|공식|스토어|쇼핑|커넥트|브랜드|정품|무료배송|할인|특가|이벤트|프로모션|단독|추천|공식몰|브랜드스토어)$/u;
/** Naver detail titles often append " : 스토어명" or " : 브랜드 공식몰". */
const STORE_SUFFIX_PATTERN =
  /\s*[:：]\s*[^\s:：].{0,80}$/u;

function normalizedName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^\s*\[[^\]]{1,100}\]\s*/u, "")
    .replace(STORE_SUFFIX_PATTERN, " ")
    .replace(/(?:EVENT|이벤트|프로모션|특가|무료\s*배송|단독)\s*/giu, " ")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function namesAreCompatible(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = Math.min(left.length, right.length);
  return shorter >= 6 && (left.includes(right) || right.includes(left));
}

function nameTokens(value: string): string[] {
  return normalizedName(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !GENERIC_NAME_TOKEN.test(token));
}

function modelTokens(value: string): Set<string> {
  return new Set(nameTokens(value).filter((token) => /\d/u.test(token)));
}

function productLocator(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of ["productId", "productNo", "itemId", "goodsNo"]) {
      const found = url.searchParams.get(key);
      if (found) return found.toLocaleLowerCase();
    }
    const pathMatch = url.pathname.match(/(?:products?|items?|goods)\/([^/?#]+)/iu);
    return pathMatch?.[1] ? pathMatch[1].toLocaleLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Live evidence may be accumulated only for the same product. A redirect to a
 * different detail page must never donate a richer-looking set of facts.
 */
export function isSameProductInfoIdentity(base: MergeableProductInfo, live: MergeableProductInfo): boolean {
  const baseLocator = productLocator(base.finalUrl);
  const liveLocator = productLocator(live.finalUrl);
  if (baseLocator && liveLocator && baseLocator !== liveLocator) return false;

  const left = normalizedName(base.name);
  const right = normalizedName(live.name);
  if (!left || !right) return false;
  const compatibleNames = namesAreCompatible(left, right);
  // A short/category URL on one side cannot donate a missing product locator to
  // a merely similar name. Allow the transition when normalized names match or
  // one is a store-suffix extension of the other (e.g. "...2개" vs "...2개 켄뷰 공식몰").
  if (Boolean(baseLocator) !== Boolean(liveLocator) && !compatibleNames) return false;
  if (compatibleNames) {
    return true;
  }

  const leftModels = modelTokens(base.name);
  const rightModels = modelTokens(live.name);
  if (leftModels.size > 0 && rightModels.size > 0 && ![...leftModels].some((token) => rightModels.has(token))) {
    return false;
  }

  const leftTokens = new Set(nameTokens(base.name));
  const rightTokens = new Set(nameTokens(live.name));
  if (!leftTokens.size || !rightTokens.size) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap >= 1 && overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

function unique(values: string[], maximum = 40): string[] {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))).slice(0, maximum);
}

/** Cached variant rows must be re-observed, not revived by union. */
export function mergeCurrentProductFeatures(base: string[], live: string[]): string[] {
  const observed = unique(live);
  if (!observed.length) return unique(base);
  const label = (value: string) => value.split(/[:：]/u)[0].replace(/\s+/gu, "");
  const currentLabels = new Set(observed.map(label));
  return unique([...observed, ...base.filter(value => !isCachedOptionClaim(value) && !currentLabels.has(label(value)))]);
}

function isCachedOptionClaim(value: string): boolean {
  return /^(?:선택\s*)?(?:옵션|상품\s*구성|구성|구성품|수량|개수|용량|중량|모델명|향|향계열|색상|사이즈)\s*[:：]/u.test(value.trim())
    || /리필|\brefill\b/iu.test(value)
    || /(?:본품|증정품)\s*[+＋]|\d+\s*(?:개입|개|ml|mL|kg|g|매|팩)\s*(?:세트|구성|묶음)/u.test(value);
}

function mergeDescription(base: string, live: string, hasCurrentEvidence: boolean): string {
  // Cached option sentences cannot serve as fresh evidence for the selected SKU.
  // Keep unrelated sentences (including the rest of a mixed paragraph).
  const prior = (hasCurrentEvidence ? base.split(/(?<=[.!?。])\s+|\r?\n/u)
    .filter(sentence => !isCachedOptionClaim(sentence)).join("\n") : base).trim();
  const current = live.trim();
  if (!prior) return current;
  if (!current || prior === current || prior.includes(current)) return prior;
  if (current.includes(prior)) return current;
  return `${prior}\n${current}`.slice(0, 24_000);
}

function mergeTravelResearch(
  base: TravelPageResearch | null | undefined,
  live: TravelPageResearch | null | undefined,
): TravelPageResearch | null {
  if (!base) return live || null;
  if (!live) return base;

  const highlights = new Map<string, { name: string; description: string }>();
  for (const item of [...base.highlights, ...live.highlights]) {
    const key = item.name.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
    const previous = highlights.get(key);
    if (!previous || item.description.length > previous.description.length) highlights.set(key, item);
  }
  const schedules = new Map<number, TravelPageResearch["schedules"][number]>();
  for (const item of [...base.schedules, ...live.schedules]) {
    const previous = schedules.get(item.day);
    schedules.set(item.day, previous
      ? {
          day: item.day,
          activities: unique([...previous.activities, ...item.activities], 24),
          meals: unique([...previous.meals, ...item.meals], 3),
          transport: item.transport || previous.transport || null,
        }
      : item);
  }

  return {
    source: "naver-package-next-data",
    durationDays: Math.max(base.durationDays || 0, live.durationDays || 0) || null,
    destinations: unique([...base.destinations, ...live.destinations], 8),
    highlights: [...highlights.values()].slice(0, 24),
    schedules: [...schedules.values()].sort((left, right) => left.day - right.day),
    flights: unique([...base.flights, ...live.flights], 4),
    shopping: unique([...base.shopping, ...live.shopping], 8),
  };
}

export function mergeProductInfo<T extends MergeableProductInfo>(base: T | null, live: T): T {
  if (!base) return live;
  if (!isSameProductInfoIdentity(base, live)) {
    throw new Error(`PRODUCT_IDENTITY_MISMATCH: 저장 상품 "${base.name}"과 새 상세페이지 "${live.name}"의 신원이 일치하지 않습니다.`);
  }

  const representativeImagePath = live.representativeImagePath || base.representativeImagePath;
  return {
    ...base,
    name: chooseProductName([base.name, live.name]),
    description: mergeDescription(base.description, live.description, Boolean(live.description.trim() || live.features.some(value => value.trim()))),
    features: mergeCurrentProductFeatures(live.description.trim() ? base.features.filter(value => !isCachedOptionClaim(value)) : base.features, live.features),
    price: live.price || base.price,
    originalPrice: live.originalPrice || base.originalPrice,
    discountRate: live.discountRate || base.discountRate,
    couponInfo: live.couponInfo || base.couponInfo,
    deliveryInfo: live.deliveryInfo || base.deliveryInfo,
    reviewCount: live.reviewCount || base.reviewCount,
    rating: live.rating || base.rating,
    representativeImagePath,
    imagePaths: unique([
      ...(representativeImagePath ? [representativeImagePath] : []),
      ...base.imagePaths,
      ...live.imagePaths,
    ], 80),
    detailImagePaths: unique([...base.detailImagePaths, ...live.detailImagePaths], 80),
    sourceImageUrls: unique([...live.sourceImageUrls, ...base.sourceImageUrls], 80),
    finalUrl: live.finalUrl || base.finalUrl || null,
    storeName: live.storeName || base.storeName || null,
    travelPageResearch: mergeTravelResearch(base.travelPageResearch, live.travelPageResearch),
  } as T;
}

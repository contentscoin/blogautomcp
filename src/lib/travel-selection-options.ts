import type { ConnectItem } from "./connect-item";

export interface TravelSelectionCategory {
  id: string;
  name: string;
  parentId: null;
  depth: number;
  productCount: number;
}

export interface TravelSelectionPromotion {
  value: string;
  label: string;
  count: number;
}

const CATEGORY_FIELDS = [
  { key: "countryNames", prefix: "country", label: "국가" },
  { key: "cityNames", prefix: "city", label: "도시" },
  { key: "duration", prefix: "duration", label: "일정" },
  { key: "productType", prefix: "productType", label: "상품유형" },
] as const;

const PROMOTION_RULES: Array<{
  value: string;
  label: string;
  matches: (item: ConnectItem) => boolean;
}> = [
  {
    value: "travel-benefit:discount",
    label: "할인 상품",
    matches: (item) => {
      const discountedRate = toNumber(item.raw.discountedRate);
      const salePrice = toNumber(item.raw.salePrice);
      return discountedRate > 0 || (salePrice > 0 && item.price > 0 && item.price < salePrice);
    },
  },
  {
    value: "travel-benefit:confirmed",
    label: "출발확정",
    matches: (item) => /출발\s*확정/u.test(item.name),
  },
  {
    value: "travel-benefit:no-shopping",
    label: "노쇼핑",
    matches: (item) => /노\s*쇼핑|쇼핑\s*없/u.test(item.name),
  },
  {
    value: "travel-benefit:deal",
    label: "특가·핫딜",
    matches: (item) => /특가|핫딜|타임딜|할인/u.test(item.name),
  },
  {
    value: "travel-benefit:tour-ticket",
    label: "투어·티켓",
    matches: (item) => hasMeaningfulValue(getExtra(item).tourTicket),
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getExtra(item: ConnectItem): Record<string, unknown> {
  return isRecord(item.raw.extra) ? item.raw.extra : {};
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTextValues(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized && normalized.length <= 60 ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap(toTextValues)));
  }
  return [];
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value.trim().length > 0 && !/^(false|none|null|0)$/i.test(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

function getItemCategoryIds(item: ConnectItem): Set<string> {
  const extra = getExtra(item);
  const ids = new Set<string>();
  for (const field of CATEGORY_FIELDS) {
    for (const value of toTextValues(extra[field.key])) {
      ids.add(`${field.prefix}:${value}`);
      // 이전 버전에서 값 자체를 ID로 저장한 선택도 한 번은 호환한다.
      ids.add(value);
    }
  }
  return ids;
}

function getItemPromotionValues(item: ConnectItem): Set<string> {
  return new Set(PROMOTION_RULES.filter((rule) => rule.matches(item)).map((rule) => rule.value));
}

export function buildTravelSelectionOptions(
  items: ConnectItem[],
  categoryLimit = 80
): { categories: TravelSelectionCategory[]; promotions: TravelSelectionPromotion[] } {
  const categoryCounts = new Map<string, { name: string; count: number; order: number }>();

  for (const item of items) {
    const extra = getExtra(item);
    const seen = new Set<string>();
    for (const [order, field] of CATEGORY_FIELDS.entries()) {
      for (const value of toTextValues(extra[field.key])) {
        const id = `${field.prefix}:${value}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const current = categoryCounts.get(id);
        if (current) current.count += 1;
        else categoryCounts.set(id, { name: `${field.label} · ${value}`, count: 1, order });
      }
    }
  }

  const sortedGroups = CATEGORY_FIELDS.map((_, order) =>
    Array.from(categoryCounts.entries())
      .filter(([, option]) => option.order === order)
      .sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name, "ko"))
  );
  // 도시가 많아도 국가·일정·상품유형이 목록 밖으로 밀려나지 않게 종류별 몫을 둔다.
  const quotas = [
    Math.max(10, Math.floor(categoryLimit * 0.3)),
    Math.max(12, Math.floor(categoryLimit * 0.5)),
    Math.max(6, Math.floor(categoryLimit * 0.15)),
    Math.max(2, Math.floor(categoryLimit * 0.05)),
  ];
  const balancedEntries = sortedGroups.flatMap((group, index) => group.slice(0, quotas[index]));

  const categories: TravelSelectionCategory[] = balancedEntries
    .slice(0, categoryLimit)
    .map(([id, option]) => ({
      id,
      name: option.name,
      parentId: null,
      depth: option.order,
      productCount: option.count,
    }));

  const promotions = PROMOTION_RULES.map((rule) => ({
    value: rule.value,
    label: rule.label,
    count: items.filter(rule.matches).length,
  })).filter((option) => option.count > 0);

  return { categories, promotions };
}

export function matchesTravelSelectionFilters(
  item: ConnectItem,
  categoryFilters: string[],
  promotionFilters: string[]
): boolean {
  const categoryMatches =
    categoryFilters.length === 0 || categoryFilters.some((filter) => getItemCategoryIds(item).has(filter));
  if (!categoryMatches) return false;

  const promotionValues = getItemPromotionValues(item);
  return promotionFilters.length === 0 || promotionFilters.some((filter) => promotionValues.has(filter));
}

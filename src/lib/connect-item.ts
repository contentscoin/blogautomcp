/**
 * 커넥트 목록 응답(JSON)에서 항목 배열과 필드 이름을 추론한다.
 *
 * 쇼핑커넥트는 `data[]` / `productName` 처럼 키 이름이 고정된 계약을 쓰지만,
 * 여행커넥트는 응답 계약을 미리 알 수 없다. 그래서 키 이름을 하드코딩하지 않고,
 * 후보 키 이름과 값의 형태를 함께 보고 가장 그럴듯한 매핑을 고른다.
 * 여기서 나온 매핑은 계약 파일로 저장돼 다음 실행부터 재사용된다.
 */

export interface ConnectFieldMap {
  id: string | null;
  name: string;
  storeName: string | null;
  price: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
}

export interface ConnectItem {
  externalItemId: string | null;
  name: string;
  storeName: string;
  price: number;
  imageUrl: string | null;
  linkUrl: string | null;
  /** 원본 행. 배지/프로모션 추출처럼 호출자마다 다른 해석을 하도록 남겨둔다. */
  raw: Record<string, unknown>;
}

export interface DetectedItemArray {
  /** `$.data` 처럼 payload 루트에서의 경로. 계약 파일에 저장한다. */
  path: string;
  rows: Record<string, unknown>[];
  score: number;
}

const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_NODES = 4000;

/** 키 이름 비교용 정규화: `product_name`, `productName`, `PRODUCT-NAME` → `productname` */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 앞쪽일수록 강한 후보. 인덱스가 그대로 점수(작을수록 좋음)로 쓰인다. */
const FIELD_KEY_CANDIDATES: Record<keyof ConnectFieldMap, string[]> = {
  id: [
    "affiliateproductid",
    "productid",
    "itemid",
    "goodsid",
    "packageid",
    "travelproductid",
    "id",
    "productno",
    "itemno",
    "no",
    "seq",
    "key",
  ],
  name: [
    "productname",
    "itemname",
    "goodsname",
    "packagename",
    "producttitle",
    "displayname",
    "title",
    "name",
    "subject",
    "label",
  ],
  storeName: [
    "storename",
    "mallname",
    "sellername",
    "shopname",
    "brandname",
    "partnername",
    "providername",
    "agencyname",
    "supplyname",
    "channelname",
  ],
  price: [
    "discountedsaleprice",
    "saleprice",
    "salesprice",
    "finalprice",
    "lowestprice",
    "minprice",
    "discountprice",
    "price",
    "amount",
    "cost",
  ],
  imageUrl: [
    "representimageurl",
    "mainimageurl",
    "thumbnailimageurl",
    "thumbnailurl",
    "imageurl",
    "imgurl",
    "thumbnail",
    "image",
    "img",
    "photo",
  ],
  linkUrl: [
    "affiliateurl",
    "producturl",
    "detailurl",
    "landingurl",
    "linkurl",
    "pcurl",
    "mobileurl",
    "shorturl",
    "url",
    "link",
    "href",
  ],
};

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function looksLikeImageUrl(value: unknown): boolean {
  if (!isHttpUrl(value)) return false;
  return /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(value) || /(?:image|img|thumb|phinf|pstatic)/i.test(value);
}

export function toFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * 값이 해당 필드로 쓸 만한지 본다. 키 이름만 믿으면 `title`이 안내문구인 경우처럼
 * 엉뚱한 값을 집을 수 있어서, 값의 형태도 함께 확인한다.
 */
function isPlausibleValue(field: keyof ConnectFieldMap, value: unknown): boolean {
  switch (field) {
    case "id":
      if (typeof value === "number") return Number.isFinite(value) && value > 0;
      return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64;
    case "name":
      return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 300 && !isHttpUrl(value);
    case "storeName":
      return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 120 && !isHttpUrl(value);
    case "price":
      return toFiniteNumber(value) > 0;
    case "imageUrl":
      return looksLikeImageUrl(value);
    case "linkUrl":
      return isHttpUrl(value);
    default:
      return false;
  }
}

/** 행 대부분에서 그럴듯한 값을 갖는 키를, 후보 이름 순위가 높은 쪽부터 고른다. */
function pickField(
  field: keyof ConnectFieldMap,
  rows: Record<string, unknown>[],
  usedKeys: Set<string>
): string | null {
  const candidates = FIELD_KEY_CANDIDATES[field];
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);

  let best: { key: string; rank: number; coverage: number } | null = null;
  for (const key of keys) {
    if (usedKeys.has(key)) continue;
    const normalized = normalizeKey(key);
    const rank = candidates.indexOf(normalized);
    if (rank < 0) continue;

    const plausible = rows.filter((row) => isPlausibleValue(field, row[key])).length;
    const coverage = plausible / rows.length;
    // 절반 이상의 행에서 쓸 수 있어야 그 필드의 대표 키로 인정한다.
    if (coverage < 0.5) continue;

    if (!best || rank < best.rank || (rank === best.rank && coverage > best.coverage)) {
      best = { key, rank, coverage };
    }
  }

  return best?.key ?? null;
}

/**
 * 이름 필드는 필수다. 후보 키 이름에 걸리는 게 없으면, 값이 이름처럼 생긴 문자열
 * 키 중 가장 커버리지가 높은 것을 쓴다(계약을 모르는 여행커넥트 대비).
 */
function pickNameFallback(rows: Record<string, unknown>[], usedKeys: Set<string>): string | null {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);

  let best: { key: string; coverage: number; averageLength: number } | null = null;
  for (const key of keys) {
    if (usedKeys.has(key)) continue;
    const values = rows.map((row) => row[key]).filter((value) => isPlausibleValue("name", value)) as string[];
    const coverage = values.length / rows.length;
    if (coverage < 0.8) continue;
    const averageLength = values.reduce((sum, value) => sum + value.trim().length, 0) / values.length;
    // 너무 짧은 값(코드·구분자)보다 상품명처럼 긴 값을 선호한다.
    if (averageLength < 4) continue;
    if (!best || averageLength > best.averageLength) best = { key, coverage, averageLength };
  }

  return best?.key ?? null;
}

export function detectFieldMap(rows: Record<string, unknown>[]): ConnectFieldMap | null {
  if (rows.length === 0) return null;

  const used = new Set<string>();
  const name = pickField("name", rows, used) ?? pickNameFallback(rows, used);
  if (!name) return null;
  used.add(name);

  const map: ConnectFieldMap = { id: null, name, storeName: null, price: null, imageUrl: null, linkUrl: null };
  for (const field of ["id", "storeName", "price", "imageUrl", "linkUrl"] as const) {
    const key = pickField(field, rows, used);
    map[field] = key;
    if (key) used.add(key);
  }
  return map;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 객체 배열이 목록처럼 보이는 정도. 길이보다 "이름으로 쓸 값이 있는가"를 우선한다.
 * 배지·필터 목록처럼 키가 한두 개뿐인 배열을 상품 목록으로 오인하지 않기 위함이다.
 */
function scoreRows(rows: Record<string, unknown>[]): number {
  if (rows.length === 0) return 0;
  const map = detectFieldMap(rows);
  if (!map) return 0;

  const averageKeyCount = rows.reduce((sum, row) => sum + Object.keys(row).length, 0) / rows.length;
  let score = 10 + Math.min(rows.length, 40) + Math.min(averageKeyCount, 30);
  if (map.id) score += 15;
  if (map.price) score += 12;
  if (map.imageUrl) score += 8;
  if (map.storeName) score += 6;
  if (map.linkUrl) score += 4;
  return score;
}

/** payload 전체를 훑어 목록 후보 배열을 점수순으로 돌려준다. */
export function findItemArrays(payload: unknown): DetectedItemArray[] {
  const found: DetectedItemArray[] = [];
  let visited = 0;

  const walk = (value: unknown, currentPath: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH || visited > MAX_SCAN_NODES || value === null || value === undefined) return;
    visited += 1;

    if (Array.isArray(value)) {
      const rows = value.filter(isPlainObject);
      // 배열 원소 대부분이 객체일 때만 목록 후보로 본다.
      if (rows.length >= 1 && rows.length >= value.length * 0.6) {
        const score = scoreRows(rows);
        if (score > 0) found.push({ path: currentPath, rows, score });
      }
      for (const [index, entry] of value.slice(0, 5).entries()) {
        walk(entry, `${currentPath}[${index}]`, depth + 1);
      }
      return;
    }

    if (isPlainObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        walk(entry, `${currentPath}.${key}`, depth + 1);
      }
    }
  };

  walk(payload, "$", 0);
  return found.sort((a, b) => b.score - a.score);
}

/** `$.data` 같은 경로로 payload에서 배열을 다시 꺼낸다(저장된 계약 재사용용). */
export function readArrayAtPath(payload: unknown, itemsPath: string): Record<string, unknown>[] | null {
  if (itemsPath === "$") return Array.isArray(payload) ? payload.filter(isPlainObject) : null;

  const segments = itemsPath.replace(/^\$/, "").match(/\.[^.[\]]+|\[\d+\]/g);
  if (!segments) return null;

  let current: unknown = payload;
  for (const segment of segments) {
    if (current === null || current === undefined) return null;
    if (segment.startsWith("[")) {
      const index = Number.parseInt(segment.slice(1, -1), 10);
      if (!Array.isArray(current)) return null;
      current = current[index];
      continue;
    }
    if (!isPlainObject(current)) return null;
    current = current[segment.slice(1)];
  }

  return Array.isArray(current) ? current.filter(isPlainObject) : null;
}

export function normalizeConnectItems(
  rows: Record<string, unknown>[],
  fieldMap: ConnectFieldMap
): ConnectItem[] {
  const items: ConnectItem[] = [];
  for (const row of rows) {
    const name = typeof row[fieldMap.name] === "string" ? (row[fieldMap.name] as string).trim() : "";
    if (!name) continue;

    const rawId = fieldMap.id ? row[fieldMap.id] : null;
    const storeValue = fieldMap.storeName ? row[fieldMap.storeName] : null;
    const imageValue = fieldMap.imageUrl ? row[fieldMap.imageUrl] : null;
    const linkValue = fieldMap.linkUrl ? row[fieldMap.linkUrl] : null;

    items.push({
      externalItemId:
        typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() || null : null,
      name,
      storeName: typeof storeValue === "string" ? storeValue.trim() : "",
      price: fieldMap.price ? toFiniteNumber(row[fieldMap.price]) : 0,
      imageUrl: isHttpUrl(imageValue) ? imageValue.trim() : null,
      linkUrl: isHttpUrl(linkValue) ? linkValue.trim() : null,
      raw: row,
    });
  }
  return items;
}

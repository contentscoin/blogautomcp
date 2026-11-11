import type { Page, Response } from "playwright";

/**
 * 쇼핑 상품 페이지가 스스로 들고 있는 구조화 데이터(내장 상태 JSON, 페이지가 받은 JSON 응답)에서
 * 상품 사실을 읽는다. 스토어의 CSS 클래스는 자주 바뀌지만 데이터 필드는 덜 바뀐다.
 *
 * 실제 키 이름은 스토어·시점마다 다를 수 있어 후보 목록으로 탐색한다. 찾지 못하면
 * found=false를 돌려주고 호출부는 기존 DOM 수집으로 동작한다.
 */
export interface ShoppingProductCard {
  found: boolean;
  name: string;
  categoryPath: string;
  price: string;
  originalPrice: string;
  discountRate: string;
  reviewCount: string;
  rating: string;
  imageUrls: string[];
  detailImageUrls: string[];
  detailText: string;
  /** `라벨: 값` 형식의 속성·상품정보제공고시 줄 */
  factLines: string[];
  /** `옵션명: 값1, 값2` 형식 */
  optionLines: string[];
  /** 진단용: 상품 노드를 찾은 경로 */
  sourceKeys: string[];
}

const EMPTY_CARD: ShoppingProductCard = {
  found: false, name: "", categoryPath: "", price: "", originalPrice: "", discountRate: "",
  reviewCount: "", rating: "", imageUrls: [], detailImageUrls: [], detailText: "",
  factLines: [], optionLines: [], sourceKeys: [],
};

const MAX_DEPTH = 9;
const MAX_NODES = 60_000;
const MAX_STATE_BYTES = 6_000_000;

const NAME_KEYS = ["name", "productName", "dispName", "productTitle", "title"];
const SALE_PRICE_KEYS = ["discountedSalePrice", "mobileDiscountedSalePrice", "benefitPrice", "finalPrice", "lowPrice"];
const LIST_PRICE_KEYS = ["salePrice", "price", "originalPrice", "consumerPrice", "normalPrice"];
const DISCOUNT_RATE_KEYS = ["discountedRatio", "discountRate", "discountedRate", "discountRatio", "mobileDiscountedRatio"];
const IMAGE_LIST_KEYS = ["productImages", "images", "imageList", "representImages", "optionalImages", "additionalImages"];
const IMAGE_SINGLE_KEYS = ["representImage", "representativeImage", "representImageUrl", "imageUrl", "image", "thumbnailUrl"];
const DETAIL_KEYS = ["detailContents", "detailContent", "detailContentText", "productDetail", "detailHtml", "renderContent", "editorContent"];
const CATEGORY_KEYS = ["wholeCategoryName", "categoryPath", "fullCategoryName", "categoryFullName", "categoryName"];
const REVIEW_COUNT_KEYS = ["totalReviewCount", "reviewCount", "reviewAmount", "reviewCnt"];
const RATING_KEYS = ["averageReviewScore", "reviewScore", "averageScore", "ratingValue", "starScore"];
const ATTRIBUTE_KEYS = ["productAttributes", "attributes", "productInfoProvidedNotice", "productInfoProvidedNoticeView", "noticeItems", "specs", "specifications", "productInfos", "detailAttributes"];
const OPTION_KEYS = ["options", "optionCombinations", "combinationOptions", "optionStandards", "simpleOptions", "selectOptions"];
const LABEL_KEYS = ["name", "title", "label", "attributeName", "itemName", "key", "groupName"];
const VALUE_KEYS = ["value", "content", "attributeValue", "itemValue", "text", "minAttributeValue", "valueName"];
// 검색 노출용 문구는 상품 사실이 아니다.
const PROMOTIONAL_KEY = /(?:seo|tag|keyword|search|hash|promotion|banner|advert|recommend|related|similar|best|ranking)/iu;
// 다른 상품 목록 안의 항목을 이 상품으로 착각하지 않도록 건너뛴다.
const LISTING_KEY = /(?:recommend|related|similar|together|best|ranking|recent|otherProducts|storeProducts|categoryProducts|reviews?$|qna|inquir)/iu;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const clean = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/gu, " ").trim() : "";

function firstText(node: Json, keys: readonly string[], maxLength = 300): string {
  for (const key of keys) {
    const value = clean(node[key]);
    if (value && value.length <= maxLength) return value;
  }
  return "";
}

function firstNumber(node: Json, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = node[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && /^[\d,.]+$/u.test(raw.trim()) ? Number(raw.replace(/,/gu, "")) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function normalizeImageUrl(value: unknown): string {
  const raw = isObject(value) ? clean(value.url ?? value.imageUrl ?? value.src ?? value.originalUrl) : clean(value);
  if (!raw) return "";
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  if (!/^https?:\/\/[^\s"'<>]+$/iu.test(url)) return "";
  if (/\.(?:svg|gif)(?:\?|$)/iu.test(url) || /(?:sprite|icon|logo|badge|blank)/iu.test(url)) return "";
  return url;
}

function collectImages(node: Json): string[] {
  const urls: string[] = [];
  for (const key of IMAGE_SINGLE_KEYS) {
    const url = normalizeImageUrl(node[key]);
    if (url) urls.push(url);
  }
  for (const key of IMAGE_LIST_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    for (const item of list.slice(0, 40)) {
      const url = normalizeImageUrl(item);
      if (url) urls.push(url);
    }
  }
  return Array.from(new Set(urls));
}

function scoreProductNode(node: Json): number {
  const name = firstText(node, NAME_KEYS);
  if (name.length < 3) return 0;
  let score = 0;
  if (firstNumber(node, [...SALE_PRICE_KEYS, ...LIST_PRICE_KEYS]) !== null) score += 2;
  if (collectImages(node).length > 0) score += 2;
  if (DETAIL_KEYS.some((key) => node[key] !== undefined)) score += 2;
  if (ATTRIBUTE_KEYS.some((key) => node[key] !== undefined)) score += 1;
  if (OPTION_KEYS.some((key) => node[key] !== undefined)) score += 1;
  if (CATEGORY_KEYS.some((key) => node[key] !== undefined) || isObject(node.category)) score += 1;
  if (REVIEW_COUNT_KEYS.some((key) => node[key] !== undefined) || isObject(node.reviewAmount)) score += 1;
  return score >= 3 ? score : 0;
}

function findProductNode(states: readonly unknown[]): { node: Json; path: string } | null {
  let best: { node: Json; path: string; score: number; depth: number } | null = null;
  let visited = 0;
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    if (Array.isArray(value)) {
      // 배열 속 객체는 대개 목록이다. 앞쪽 몇 개만 본다.
      value.slice(0, 5).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isObject(value)) return;
    visited += 1;
    const score = scoreProductNode(value);
    // 같은 점수면 더 얕은 노드가 페이지의 주 상품일 가능성이 높다.
    if (score > 0 && (!best || score > best.score || (score === best.score && depth < best.depth))) {
      best = { node: value, path, score, depth };
    }
    for (const [key, child] of Object.entries(value)) {
      if (LISTING_KEY.test(key)) continue;
      if (typeof child === "object" && child !== null) visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  states.forEach((state, index) => visit(state, `state${index}`, 0));
  const found = best as { node: Json; path: string } | null;
  return found ? { node: found.node, path: found.path } : null;
}

/** 상세 HTML에서 보이는 글자와 이미지 주소만 남긴다. */
export function extractDetailFromHtml(html: string): { text: string; imageUrls: string[] } {
  const imageUrls = Array.from(new Set(
    Array.from(html.matchAll(/<img\b[^>]*?\b(?:data-src|src)\s*=\s*["']([^"']+)["']/giu))
      .map((match) => normalizeImageUrl(match[1].replace(/&amp;/gu, "&")))
      .filter(Boolean),
  )).slice(0, 60);
  const text = html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/giu, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'")
    .split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).filter((line) => line.length >= 2)
    .join("\n")
    .slice(0, 12_000);
  return { text, imageUrls };
}

function detailFromNode(node: Json): { text: string; imageUrls: string[] } {
  for (const key of DETAIL_KEYS) {
    const value = node[key];
    const html = typeof value === "string" ? value : isObject(value)
      ? clean(value.detailContentText ?? value.content ?? value.html ?? value.editorContent ?? value.text) : "";
    if (html.length >= 20) return extractDetailFromHtml(html);
  }
  return { text: "", imageUrls: [] };
}

function pairLines(value: unknown, depth = 0, parentKey = ""): string[] {
  if (depth > 4 || PROMOTIONAL_KEY.test(parentKey)) return [];
  if (Array.isArray(value)) return value.slice(0, 60).flatMap((item) => pairLines(item, depth + 1, parentKey));
  if (!isObject(value)) return [];
  const label = firstText(value, LABEL_KEYS, 40);
  const content = firstText(value, VALUE_KEYS, 160);
  const own = label.length >= 2 && content && label !== content && !/^[-:：|]+$/u.test(content) ? [`${label}: ${content}`] : [];
  const nested = Object.entries(value)
    .filter(([key, child]) => typeof child === "object" && child !== null && !PROMOTIONAL_KEY.test(key))
    .flatMap(([key, child]) => pairLines(child, depth + 1, key));
  // 라벨 없이 `키: 값`으로만 적힌 고시 정보(예: { material: "면 100%" })는 사람이 읽을 라벨이 없어 쓰지 않는다.
  return [...own, ...nested];
}

function optionLines(node: Json): string[] {
  const groups = new Map<string, Set<string>>();
  const add = (name: string, value: string) => {
    if (name.length < 1 || name.length > 30 || !value || value.length > 60) return;
    if (!groups.has(name)) groups.set(name, new Set());
    groups.get(name)!.add(value);
  };
  for (const key of OPTION_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    for (const item of list.slice(0, 200)) {
      if (!isObject(item)) continue;
      // 조합형: optionName1/optionName2 … , 표준형: groupName + name/value
      for (let index = 1; index <= 4; index += 1) {
        const value = clean(item[`optionName${index}`]);
        if (value) add(clean(item[`optionGroupName${index}`]) || `옵션${index}`, value);
      }
      const group = clean(item.groupName ?? item.optionGroupName ?? item.optionName);
      const value = clean(item.name ?? item.value ?? item.optionValue ?? item.optionValueName);
      if (group && value && group !== value) add(group, value);
    }
  }
  return Array.from(groups.entries()).slice(0, 6)
    .map(([name, values]) => `${name}: ${Array.from(values).slice(0, 12).join(", ")}`);
}

function formatWon(value: number | null): string {
  return value === null ? "" : `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function categoryPathOf(node: Json): string {
  const direct = firstText(node, CATEGORY_KEYS, 200);
  if (direct) return direct.replace(/\s*>\s*/gu, " > ");
  const category = node.category;
  if (isObject(category)) {
    const nested = firstText(category, CATEGORY_KEYS, 200);
    if (nested) return nested.replace(/\s*>\s*/gu, " > ");
    const levels = ["category1Name", "category2Name", "category3Name", "category4Name"].map((key) => clean(category[key])).filter(Boolean);
    if (levels.length) return levels.join(" > ");
  }
  return "";
}

function reviewOf(node: Json): { reviewCount: string; rating: string } {
  const sources = [node, node.reviewAmount, node.reviewSummary, node.review].filter(isObject);
  let reviewCount = "";
  let rating = "";
  for (const source of sources) {
    if (!reviewCount) {
      const count = firstNumber(source, REVIEW_COUNT_KEYS);
      if (count !== null) reviewCount = Math.round(count).toLocaleString("ko-KR");
    }
    if (!rating) {
      const score = firstNumber(source, RATING_KEYS);
      if (score !== null && score <= 5) rating = String(Math.round(score * 100) / 100);
    }
  }
  return { reviewCount, rating };
}

/** 순수 함수: 내장 상태·응답 JSON 목록에서 이 페이지의 상품 카드를 만든다. */
export function parseShoppingProductCard(states: readonly unknown[]): ShoppingProductCard {
  try {
    const hit = findProductNode(states);
    if (!hit) return { ...EMPTY_CARD };
    const { node, path } = hit;
    const salePrice = firstNumber(node, SALE_PRICE_KEYS);
    const listPrice = firstNumber(node, LIST_PRICE_KEYS);
    const price = salePrice ?? listPrice;
    const originalPrice = salePrice !== null && listPrice !== null && listPrice > salePrice ? listPrice : null;
    const rate = firstNumber(node, DISCOUNT_RATE_KEYS)
      ?? (originalPrice !== null && price !== null ? Math.round((1 - price / originalPrice) * 100) : null);
    const detail = detailFromNode(node);
    const factLines = Array.from(new Set(
      ATTRIBUTE_KEYS.flatMap((key) => pairLines(node[key], 0, key)),
    )).slice(0, 40);
    return {
      found: true,
      name: firstText(node, NAME_KEYS),
      categoryPath: categoryPathOf(node),
      price: formatWon(price),
      originalPrice: formatWon(originalPrice),
      discountRate: rate !== null && rate > 0 && rate < 100 ? `${Math.round(rate)}%` : "",
      ...reviewOf(node),
      imageUrls: collectImages(node),
      detailImageUrls: detail.imageUrls,
      detailText: detail.text,
      factLines,
      optionLines: optionLines(node),
      sourceKeys: [path],
    };
  } catch {
    return { ...EMPTY_CARD };
  }
}

/** 페이지가 받는 상품 관련 JSON 응답을 모은다. page.goto 전에 호출한다. */
export function attachShoppingJsonCapture(page: Page, limit = 12): { states: unknown[]; urls: string[]; detach: () => void } {
  const states: unknown[] = [];
  const urls: string[] = [];
  const handler = async (response: Response) => {
    if (states.length >= limit) return;
    try {
      const url = response.url();
      const host = new URL(url).hostname;
      if (!/(?:^|\.)naver\.(?:com|net)$/u.test(host) || !/product/iu.test(url)) return;
      if (!/json/iu.test(response.headers()["content-type"] || "") || !response.ok()) return;
      const body = await response.text();
      if (body.length > MAX_STATE_BYTES) return;
      states.push(JSON.parse(body) as unknown);
      urls.push(url.split("?")[0]);
    } catch {
      // 본문을 읽지 못한 응답은 근거로 쓰지 않는다.
    }
  };
  page.on("response", handler);
  return { states, urls, detach: () => page.off("response", handler) };
}

/** 페이지에 내장된 상태 JSON을 읽는다. 실패하면 빈 배열. */
export async function collectShoppingPageState(page: Page): Promise<unknown[]> {
  const texts = await page.evaluate((maxBytes: number) => {
    const output: string[] = [];
    const push = (value: unknown) => {
      try {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (text && text.length > 2 && text.length <= maxBytes) output.push(text);
      } catch {
        // 순환 참조 등은 건너뛴다.
      }
    };
    const globals = globalThis as unknown as Record<string, unknown>;
    for (const key of ["__PRELOADED_STATE__", "__INITIAL_STATE__", "__APOLLO_STATE__"]) {
      if (globals[key]) push(globals[key]);
    }
    for (const script of Array.from(document.querySelectorAll('script#__NEXT_DATA__, script[type="application/json"]')).slice(0, 8)) {
      push(script.textContent || "");
    }
    return output;
  }, MAX_STATE_BYTES).catch(() => [] as string[]);
  return texts.flatMap((text) => {
    try { return [JSON.parse(text) as unknown]; } catch { return []; }
  });
}

const SENSITIVE_KEY = /(?:token|cookie|authorization|session|secret|password|email|phone|mobile|tel|address|memberNo|memberId|userId|loginId|naverId|nickname|birth|account|\bip\b)/iu;

/** 캡처 파일을 공유해도 되도록 계정·인증 관련 값을 지운다. */
export function redactSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > 20) return null;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveFields(item, depth + 1));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, SENSITIVE_KEY.test(key) ? "[removed]" : redactSensitiveFields(child, depth + 1)]));
}

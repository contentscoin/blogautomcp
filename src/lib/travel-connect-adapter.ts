/**
 * 여행커넥트 목록 어댑터.
 *
 * 쇼핑커넥트는 엔드포인트와 응답 키가 알려져 있어 바로 호출하면 되지만,
 * 여행커넥트는 계약이 공개돼 있지 않다. 그래서 두 단계로 동작한다.
 *
 *  1) 저장된 계약이 있으면 그 엔드포인트를 쿠키로 직접 호출한다(빠른 경로).
 *  2) 없거나 실패하면 로그인된 Playwright 세션으로 실제 화면을 열어
 *     화면이 스스로 부르는 목록 JSON을 가로채고, 거기서 계약을 만들어 저장한다.
 *
 * 엔드포인트 이름을 추측해서 하드코딩하지 않는다. 관측한 것만 쓴다.
 */

import { getSpaceIdFromConnectUrl, type ConnectKind } from "./brandconnect-kind";
import {
  detectFieldMap,
  findItemArrays,
  normalizeConnectItems,
  readArrayAtPath,
  type ConnectItem,
} from "./connect-item";
import {
  readStoredConnectContract,
  writeStoredConnectContract,
  type StoredConnectContract,
  type StoredConnectFeed,
} from "./connect-contract-store";
import { buildCookieHeaderForHost, getNaverSessionFile } from "./naver-session";

export const TRAVEL_CONNECT_HOME = "https://brandconnect.naver.com/";

/** 응답 구조만 담은 진단 기록. 값(개인정보)은 담지 않는다. */
export interface ResponseShapeNode {
  path: string;
  type: "array" | "object";
  length?: number;
  keys?: string[];
}

export interface ResponseProfile {
  endpoint: string;
  status: number;
  shapes: ResponseShapeNode[];
}

export interface DiscoveryResult {
  contract: StoredConnectContract;
  items: ConnectItem[];
  profiles: ResponseProfile[];
  finalUrl: string;
}

export class ConnectSessionExpiredError extends Error {
  constructor(message = "네이버 또는 브랜드커넥트 로그인이 만료되었습니다. 다시 로그인하세요.") {
    super(message);
    this.name = "ConnectSessionExpiredError";
  }
}

export class ConnectContractNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectContractNotFoundError";
  }
}

const DISCOVERY_NAVIGATION_TIMEOUT_MS = 45_000;
const DISCOVERY_SETTLE_MS = 4_000;
const CONTRACT_FETCH_TIMEOUT_MS = 12_000;
const MAX_PROFILES = 80;
const MAX_RESPONSE_BYTES = 2_000_000;
/** 항목 배열로 인정할 최소 개수. 배지/필터 배열을 목록으로 오인하지 않기 위한 하한선. */
const MIN_DISCOVERED_ITEMS = 3;

function isBrandConnectHost(hostname: string): boolean {
  return (
    hostname === "brandconnect.naver.com" ||
    hostname === "gw-brandconnect.naver.com" ||
    hostname.endsWith(".brandconnect.naver.com")
  );
}

/** 값 없이 키/타입만 기록한다(개인정보 원문 저장 금지). */
export function collectShapes(
  value: unknown,
  currentPath = "$",
  depth = 0,
  output: ResponseShapeNode[] = []
): ResponseShapeNode[] {
  if (depth > 6 || output.length >= 120 || value === null) return output;
  if (Array.isArray(value)) {
    output.push({ path: currentPath, type: "array", length: value.length });
    for (const item of value.slice(0, 3)) collectShapes(item, `${currentPath}[]`, depth + 1, output);
    return output;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 80).sort();
    output.push({ path: currentPath, type: "object", keys });
    for (const key of keys.slice(0, 30)) collectShapes(record[key], `${currentPath}.${key}`, depth + 1, output);
  }
  return output;
}

export function isValidConnectUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "brandconnect.naver.com";
  } catch {
    return false;
  }
}

/** 목록 크기를 뜻하는 쿼리 파라미터. 재조회 때 더 많이 받아오는 데 쓴다. */
const LIMIT_QUERY_KEYS = new Set(["limit", "size", "pagesize", "count", "perpage", "rows"]);
const CONTRACT_FETCH_CONCURRENCY = 4;

function buildContractRequestUrl(feed: StoredConnectFeed, limit: number): string {
  const url = new URL(feed.listEndpoint);
  for (const [key, value] of Object.entries(feed.listQuery)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (LIMIT_QUERY_KEYS.has(normalized)) {
      const captured = Number.parseInt(value, 10);
      // 캡처 당시 값보다 작게 줄이지는 않는다(화면 기본 페이지 크기를 존중).
      url.searchParams.set(key, String(Math.max(limit, Number.isFinite(captured) ? captured : 0)));
      continue;
    }
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function toLegacyFeed(contract: StoredConnectContract): StoredConnectFeed {
  return {
    listEndpoint: contract.listEndpoint,
    listQuery: contract.listQuery,
    itemsPath: contract.itemsPath,
    fieldMap: contract.fieldMap,
    sampleCount: contract.sampleCount,
  };
}

function stableQueryKey(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function feedIdentity(feed: StoredConnectFeed): string {
  return `${feed.listEndpoint}?${stableQueryKey(feed.listQuery)}#${feed.itemsPath}`;
}

function contractFeeds(contract: StoredConnectContract): StoredConnectFeed[] {
  const feeds = contract.feeds?.length ? contract.feeds : [toLegacyFeed(contract)];
  return Array.from(new Map(feeds.map((feed) => [feedIdentity(feed), feed])).values());
}

function normalizedItemUrl(value: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function connectItemIdentity(item: ConnectItem): string {
  const id = item.externalItemId?.trim();
  if (id) return `id:${id}`;
  const link = normalizedItemUrl(item.linkUrl);
  if (link) return `url:${link}`;
  return `name:${item.name.replace(/\s+/g, " ").trim().toLowerCase()}|${item.storeName
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()}`;
}

function itemRichness(item: ConnectItem): number {
  return (
    (item.externalItemId ? 4 : 0) +
    (item.linkUrl ? 3 : 0) +
    (item.imageUrl ? 2 : 0) +
    (item.price > 0 ? 2 : 0) +
    (item.storeName ? 1 : 0) +
    Object.keys(item.raw).length / 100
  );
}

/** 여러 추천 피드에서 같은 상품을 하나로 합치되 정보가 더 풍부한 행을 보존한다. */
export function mergeConnectItems(groups: ConnectItem[][]): ConnectItem[] {
  const merged = new Map<string, ConnectItem>();
  for (const item of groups.flat()) {
    const key = connectItemIdentity(item);
    const previous = merged.get(key);
    if (!previous || itemRichness(item) > itemRichness(previous)) merged.set(key, item);
  }
  return Array.from(merged.values());
}

async function fetchContractFeed(
  contract: StoredConnectContract,
  feed: StoredConnectFeed,
  storageStatePath: string,
  limit: number
): Promise<ConnectItem[] | null> {
  const requestUrl = buildContractRequestUrl(feed, limit);
  const endpointHost = new URL(requestUrl).hostname;

  let cookieHeader = "";
  try {
    cookieHeader = buildCookieHeaderForHost(storageStatePath, endpointHost);
  } catch {
    return null;
  }
  if (!cookieHeader) return null;

  const spaceId = getSpaceIdFromConnectUrl(contract.sourceUrl);
  const response = await fetch(requestUrl, {
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: cookieHeader,
      origin: "https://brandconnect.naver.com",
      referer: contract.sourceUrl,
      ...(spaceId ? { "x-space-id": spaceId } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(CONTRACT_FETCH_TIMEOUT_MS),
  }).catch(() => null);

  if (!response) return null;
  if (response.status === 401 || response.status === 403) throw new ConnectSessionExpiredError();
  if (!response.ok) return null;

  const payload: unknown = await response.json().catch(() => null);
  if (payload === null) return null;

  const rows = readArrayAtPath(payload, feed.itemsPath);
  if (!rows || rows.length === 0) return null;
  const items = normalizeConnectItems(rows, feed.fieldMap);
  return items.length > 0 ? items : null;
}

/** 저장된 계약으로 목록을 바로 가져온다. 실패하면 null(호출자가 재탐색으로 넘어간다). */
export async function listItemsViaContract(
  contract: StoredConnectContract,
  options: { limit?: number; storageStatePath?: string } = {}
): Promise<ConnectItem[] | null> {
  const storageStatePath = options.storageStatePath || getNaverSessionFile();
  const feeds = contractFeeds(contract);
  const groups: ConnectItem[][] = [];
  const limit = options.limit ?? 60;

  // 한 피드 실패 때문에 나머지 정상 추천 구간까지 버리지 않는다. 인증 만료만 즉시 전파한다.
  for (let index = 0; index < feeds.length; index += CONTRACT_FETCH_CONCURRENCY) {
    const batch = feeds.slice(index, index + CONTRACT_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((feed) => fetchContractFeed(contract, feed, storageStatePath, limit))
    );
    for (const items of results) {
      if (items?.length) groups.push(items);
    }
  }

  const items = mergeConnectItems(groups);
  return items.length > 0 ? items : null;
}

interface DiscoveryOptions {
  kind: ConnectKind;
  categoryUrl?: string | null;
  storageStatePath?: string;
  headless?: boolean;
  limit?: number;
}

/**
 * 로그인된 브라우저로 실제 목록 화면을 열고, 화면이 부르는 JSON을 가로채
 * 목록 계약을 만들어 저장한다.
 */
export async function discoverConnectContract(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const storageStatePath = options.storageStatePath || getNaverSessionFile();
  const configuredUrl =
    options.categoryUrl?.trim() && isValidConnectUrl(options.categoryUrl.trim())
      ? options.categoryUrl.trim()
      : null;

  const profiles: ResponseProfile[] = [];
  const captured: Array<{ url: string; payload: unknown }> = [];
  const pending: Promise<void>[] = [];
  let finalUrl = configuredUrl || TRAVEL_CONNECT_HOME;

  // Playwright는 Next 서버 번들에서 제외돼 있다(next 기본 serverExternalPackages).
  // 캡처를 요청했을 때만 런타임에 로드한다.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL?.trim() || undefined,
    // 브랜드커넥트는 headless Chrome에서 첫 응답 전에 멈추는 경우가 있어,
    // 기본값은 일반 창이다. 환경변수로만 headless를 켠다.
    headless: options.headless ?? process.env.BRANDCONNECT_CAPTURE_HEADLESS?.trim().toLowerCase() === "true",
  });

  try {
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();

    page.on("response", (response) => {
      pending.push(
        (async () => {
          if (captured.length >= MAX_PROFILES) return;
          let url: URL;
          try {
            url = new URL(response.url());
          } catch {
            return;
          }
          if (!isBrandConnectHost(url.hostname)) return;
          if (!(response.headers()["content-type"] || "").toLowerCase().includes("json")) return;
          if (Number(response.headers()["content-length"] || "0") > MAX_RESPONSE_BYTES) return;

          const payload: unknown = await response.json().catch(() => null);
          if (payload === null) return;

          captured.push({ url: response.url(), payload });
          profiles.push({
            endpoint: `${url.origin}${url.pathname}`,
            status: response.status(),
            shapes: collectShapes(payload),
          });
        })()
      );
    });

    await page.goto(configuredUrl || TRAVEL_CONNECT_HOME, {
      waitUntil: "commit",
      timeout: DISCOVERY_NAVIGATION_TIMEOUT_MS,
    });

    if (!configuredUrl) {
      await page.waitForTimeout(2_000);
      const travelHref = await page
        .locator("a")
        .evaluateAll((anchors) => {
          const match = anchors.find((anchor) => {
            const text = (anchor.textContent || "").toLowerCase();
            const href = (anchor.getAttribute("href") || "").toLowerCase();
            return text.includes("여행") || text.includes("travel") || href.includes("travel");
          });
          return match?.getAttribute("href") || null;
        })
        .catch(() => null);
      if (travelHref) {
        await page
          .goto(new URL(travelHref, page.url()).toString(), {
            waitUntil: "commit",
            timeout: DISCOVERY_NAVIGATION_TIMEOUT_MS,
          })
          .catch(() => {});
      }
    }

    await page.waitForTimeout(DISCOVERY_SETTLE_MS);
    // 목록은 스크롤해야 더 불러오는 경우가 많다. 몇 번 굴려 추가 응답을 유도한다.
    for (let index = 0; index < 4; index += 1) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(750);
    }
    await Promise.allSettled(pending);

    finalUrl = page.url();
    const visibleText = await page.locator("body").innerText().catch(() => "");
    if (/nidlogin|login\.naver/i.test(finalUrl) || (/로그인/.test(visibleText) && captured.length === 0)) {
      throw new ConnectSessionExpiredError();
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const discoveredFeeds = buildMultiFeedListDiscovery(captured, options.kind);
  if (!discoveredFeeds) {
    throw new ConnectContractNotFoundError(
      captured.length === 0
        ? "여행커넥트 화면에서 JSON 응답을 찾지 못했습니다. 목록 URL과 로그인 상태를 확인하세요."
        : "여행커넥트 응답에서 목록으로 쓸 항목 배열을 찾지 못했습니다. 상품이 보이는 목록 화면 URL을 입력한 뒤 다시 시도하세요."
    );
  }

  const best = discoveredFeeds.primary;
  const contract: StoredConnectContract = {
    kind: options.kind,
    capturedAt: new Date().toISOString(),
    listEndpoint: best.endpoint,
    listQuery: best.query,
    itemsPath: best.itemsPath,
    fieldMap: best.fieldMap,
    sourceUrl: finalUrl,
    sampleCount: discoveredFeeds.items.length,
    feeds: discoveredFeeds.feeds,
  };

  // 화면에서 자동 호출된 기본 탭뿐 아니라 recommend-tabs에서 관측한 모든
  // section/tab 조합을 직접 조회해 전체 상품군을 한 번에 계약에 반영한다.
  const expandedItems = await listItemsViaContract(contract, {
    limit: options.limit,
    storageStatePath,
  }).catch((error) => {
    if (error instanceof ConnectSessionExpiredError) throw error;
    return null;
  });
  const items = expandedItems?.length ? expandedItems : discoveredFeeds.items;
  contract.sampleCount = items.length;
  writeStoredConnectContract(contract);

  return { contract, items, profiles: dedupeProfiles(profiles), finalUrl };
}

export interface BestListResponse {
  endpoint: string;
  query: Record<string, string>;
  itemsPath: string;
  fieldMap: NonNullable<ReturnType<typeof detectFieldMap>>;
  items: ConnectItem[];
  score: number;
}

interface RecommendationTabPair {
  section: string;
  tabId: string;
}

export interface MultiFeedListDiscovery {
  primary: BestListResponse;
  feeds: StoredConnectFeed[];
  items: ConnectItem[];
}

/** 가로챈 응답들 중 목록으로 가장 그럴듯한 하나를 고른다. */
function scoreConnectKindAffinity(
  kind: ConnectKind,
  url: URL,
  rows: Record<string, unknown>[]
): number {
  const pathname = url.pathname.toLowerCase();
  const sample = rows.slice(0, 12);
  const travelMetadataCount = sample.filter((row) => {
    const extra = row.extra;
    return (
      typeof extra === "object" &&
      extra !== null &&
      ["cityNames", "countryNames", "duration", "startDate", "tourTicket", "productType"].some(
        (key) => key in (extra as Record<string, unknown>)
      )
    );
  }).length;
  const travelServiceCount = sample.filter((row) =>
    typeof row.connectServiceType === "string" && /travel|tour/i.test(row.connectServiceType)
  ).length;

  if (kind === "travel") {
    let score = 0;
    if (pathname.includes("/connect/recommend-products")) score += 120;
    if (pathname.includes("/affiliate-products/")) score -= 120;
    if (travelMetadataCount > 0) score += 100 + travelMetadataCount;
    if (travelServiceCount > 0) score += 80 + travelServiceCount;
    return score;
  }

  return pathname.includes("/affiliate-products/") ? 40 : 0;
}

function bestListResponseForEntry(
  entry: { url: string; payload: unknown },
  kind: ConnectKind
): BestListResponse | null {
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return null;
  }

  let best: BestListResponse | null = null;
  for (const candidate of findItemArrays(entry.payload).slice(0, 3)) {
    if (candidate.rows.length < MIN_DISCOVERED_ITEMS) continue;
    const fieldMap = detectFieldMap(candidate.rows);
    if (!fieldMap) continue;
    const items = normalizeConnectItems(candidate.rows, fieldMap);
    if (items.length < MIN_DISCOVERED_ITEMS) continue;

    const score = candidate.score + items.length + scoreConnectKindAffinity(kind, url, candidate.rows);
    if (best && score <= best.score) continue;
    best = {
      endpoint: `${url.origin}${url.pathname}`,
      query: Object.fromEntries(url.searchParams.entries()),
      itemsPath: candidate.path,
      fieldMap,
      items,
      score,
    };
  }
  return best;
}

/** 응답마다 가장 가능성 높은 상품 배열 하나만 남긴다. 필터 탭 배열의 오인을 줄인다. */
export function collectListResponses(
  captured: Array<{ url: string; payload: unknown }>,
  kind: ConnectKind
): BestListResponse[] {
  return captured
    .map((entry) => bestListResponseForEntry(entry, kind))
    .filter((entry): entry is BestListResponse => entry !== null);
}

/** 같은 화면에 쇼핑·여행 응답이 함께 있어도 요청한 커넥트 종류를 우선한다. */
export function pickBestListResponse(
  captured: Array<{ url: string; payload: unknown }>,
  kind: ConnectKind
): BestListResponse | null {
  return collectListResponses(captured, kind).reduce<BestListResponse | null>(
    (best, candidate) => (!best || candidate.score > best.score ? candidate : best),
    null
  );
}

function stringValueByNormalizedKey(
  value: Record<string, unknown>,
  expected: string
): string | null {
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") !== expected) continue;
    return typeof entry === "string" && entry.trim() ? entry.trim() : null;
  }
  return null;
}

function arrayValueByNormalizedKey(
  value: Record<string, unknown>,
  expected: string
): unknown[] | null {
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") !== expected) continue;
    return Array.isArray(entry) ? entry : null;
  }
  return null;
}

/** recommend-tabs 응답에서 개인정보 값 없이 section/tabId 계약만 추출한다. */
export function extractRecommendationTabPairs(payloads: unknown[]): RecommendationTabPair[] {
  const pairs = new Map<string, RecommendationTabPair>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const section = stringValueByNormalizedKey(record, "section");
    const tabs = arrayValueByNormalizedKey(record, "tabs");
    if (section && tabs) {
      for (const tab of tabs) {
        if (typeof tab !== "object" || tab === null || Array.isArray(tab)) continue;
        const tabId = stringValueByNormalizedKey(tab as Record<string, unknown>, "tabid");
        if (!tabId) continue;
        pairs.set(`${section}\u0000${tabId}`, { section, tabId });
      }
    }
    for (const entry of Object.values(record)) visit(entry, depth + 1);
  };

  for (const payload of payloads) visit(payload, 0);
  return Array.from(pairs.values());
}

function queryKey(query: Record<string, string>, expected: string): string | null {
  return (
    Object.keys(query).find(
      (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === expected
    ) || null
  );
}

function queryValue(query: Record<string, string>, expected: string): string | null {
  const key = queryKey(query, expected);
  return key ? query[key] || null : null;
}

function responseToFeed(response: BestListResponse): StoredConnectFeed {
  return {
    listEndpoint: response.endpoint,
    listQuery: response.query,
    itemsPath: response.itemsPath,
    fieldMap: response.fieldMap,
    sampleCount: response.items.length,
  };
}

/**
 * 상품 응답과 탭 계약을 합쳐 재사용 가능한 다중 피드 계약을 만든다.
 * 탭 API가 없는 커넥트도 관측된 상품 응답 피드들을 그대로 보존한다.
 */
export function buildMultiFeedListDiscovery(
  captured: Array<{ url: string; payload: unknown }>,
  kind: ConnectKind
): MultiFeedListDiscovery | null {
  const responses = collectListResponses(captured, kind);
  const primary = responses.reduce<BestListResponse | null>(
    (best, candidate) => (!best || candidate.score > best.score ? candidate : best),
    null
  );
  if (!primary) return null;

  // 필터 목록 등 다른 응답 계약이 섞이지 않도록 최상위 상품 엔드포인트와 같은 응답만 합친다.
  const productResponses = responses.filter(
    (response) => response.endpoint === primary.endpoint && response.itemsPath === primary.itemsPath
  );
  const observedFeeds = productResponses.map(responseToFeed);
  const expandedFeeds: StoredConnectFeed[] = [];

  if (kind === "travel") {
    const pairs = extractRecommendationTabPairs(captured.map((entry) => entry.payload));
    for (const pair of pairs) {
      const sameSection = productResponses.find(
        (response) => queryValue(response.query, "section") === pair.section
      );
      const template = sameSection || primary;
      const sectionKey = queryKey(template.query, "section");
      const tabIdKey = queryKey(template.query, "tabid");
      if (!sectionKey || !tabIdKey) continue;
      expandedFeeds.push({
        listEndpoint: template.endpoint,
        listQuery: {
          ...template.query,
          [sectionKey]: pair.section,
          [tabIdKey]: pair.tabId,
        },
        itemsPath: template.itemsPath,
        fieldMap: template.fieldMap,
        sampleCount: 0,
      });
    }
  }

  const feeds = Array.from(
    new Map([...observedFeeds, ...expandedFeeds].map((feed) => [feedIdentity(feed), feed])).values()
  );
  return {
    primary,
    feeds: feeds.length > 0 ? feeds : [responseToFeed(primary)],
    items: mergeConnectItems(productResponses.map((response) => response.items)),
  };
}

function dedupeProfiles(profiles: ResponseProfile[]): ResponseProfile[] {
  return Array.from(
    new Map(profiles.map((profile) => [`${profile.endpoint}:${JSON.stringify(profile.shapes)}`, profile])).values()
  );
}

export interface ListTravelItemsResult {
  items: ConnectItem[];
  contract: StoredConnectContract;
  /** 저장된 계약을 그대로 썼는지, 브라우저로 다시 탐색했는지. */
  source: "contract" | "discovery";
}

/**
 * 여행커넥트 목록을 가져온다.
 * 저장된 계약이 있으면 바로 호출하고, 없거나 더 이상 통하지 않으면 브라우저로 재탐색한다.
 */
export async function listTravelItems(
  options: {
    categoryUrl?: string | null;
    limit?: number;
    storageStatePath?: string;
    allowDiscovery?: boolean;
  } = {}
): Promise<ListTravelItemsResult> {
  const stored = readStoredConnectContract("travel");
  // v1 단일 피드 계약은 정상 응답을 주더라도 전체 목록을 놓친다. 자동 탐색이 허용된
  // 호출에서는 한 번 재캡처해 v2 다중 피드 계약으로 마이그레이션한다.
  if (stored && (stored.feeds?.length || options.allowDiscovery === false)) {
    const items = await listItemsViaContract(stored, {
      limit: options.limit,
      storageStatePath: options.storageStatePath,
    });
    if (items) return { items, contract: stored, source: "contract" };
  }

  if (options.allowDiscovery === false) {
    throw new ConnectContractNotFoundError(
      stored
        ? "저장된 여행커넥트 계약으로 목록을 가져오지 못했습니다. 여행 계약 자동 캡처를 다시 실행하세요."
        : "여행커넥트 계약이 아직 캡처되지 않았습니다. 여행 계약 자동 캡처를 먼저 실행하세요."
    );
  }

  const discovered = await discoverConnectContract({
    kind: "travel",
    categoryUrl: options.categoryUrl,
    storageStatePath: options.storageStatePath,
    limit: options.limit,
  });
  return { items: discovered.items, contract: discovered.contract, source: "discovery" };
}

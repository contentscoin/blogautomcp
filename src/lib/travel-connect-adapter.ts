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

function buildContractRequestUrl(contract: StoredConnectContract, limit: number): string {
  const url = new URL(contract.listEndpoint);
  for (const [key, value] of Object.entries(contract.listQuery)) {
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

/** 저장된 계약으로 목록을 바로 가져온다. 실패하면 null(호출자가 재탐색으로 넘어간다). */
export async function listItemsViaContract(
  contract: StoredConnectContract,
  options: { limit?: number; storageStatePath?: string } = {}
): Promise<ConnectItem[] | null> {
  const storageStatePath = options.storageStatePath || getNaverSessionFile();
  const requestUrl = buildContractRequestUrl(contract, options.limit ?? 60);
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

  const rows = readArrayAtPath(payload, contract.itemsPath);
  if (!rows || rows.length === 0) return null;

  const items = normalizeConnectItems(rows, contract.fieldMap);
  return items.length > 0 ? items : null;
}

interface DiscoveryOptions {
  kind: ConnectKind;
  categoryUrl?: string | null;
  storageStatePath?: string;
  headless?: boolean;
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

  const best = pickBestListResponse(captured);
  if (!best) {
    throw new ConnectContractNotFoundError(
      captured.length === 0
        ? "여행커넥트 화면에서 JSON 응답을 찾지 못했습니다. 목록 URL과 로그인 상태를 확인하세요."
        : "여행커넥트 응답에서 목록으로 쓸 항목 배열을 찾지 못했습니다. 상품이 보이는 목록 화면 URL을 입력한 뒤 다시 시도하세요."
    );
  }

  const contract: StoredConnectContract = {
    kind: options.kind,
    capturedAt: new Date().toISOString(),
    listEndpoint: best.endpoint,
    listQuery: best.query,
    itemsPath: best.itemsPath,
    fieldMap: best.fieldMap,
    sourceUrl: finalUrl,
    sampleCount: best.items.length,
  };
  writeStoredConnectContract(contract);

  return { contract, items: best.items, profiles: dedupeProfiles(profiles), finalUrl };
}

interface BestListResponse {
  endpoint: string;
  query: Record<string, string>;
  itemsPath: string;
  fieldMap: NonNullable<ReturnType<typeof detectFieldMap>>;
  items: ConnectItem[];
  score: number;
}

/** 가로챈 응답들 중 목록으로 가장 그럴듯한 하나를 고른다. */
function pickBestListResponse(captured: Array<{ url: string; payload: unknown }>): BestListResponse | null {
  let best: BestListResponse | null = null;

  for (const entry of captured) {
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }

    for (const candidate of findItemArrays(entry.payload).slice(0, 3)) {
      if (candidate.rows.length < MIN_DISCOVERED_ITEMS) continue;
      const fieldMap = detectFieldMap(candidate.rows);
      if (!fieldMap) continue;
      const items = normalizeConnectItems(candidate.rows, fieldMap);
      if (items.length < MIN_DISCOVERED_ITEMS) continue;

      const score = candidate.score + items.length;
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
  }

  return best;
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
  if (stored) {
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
  });
  return { items: discovered.items, contract: discovered.contract, source: "discovery" };
}

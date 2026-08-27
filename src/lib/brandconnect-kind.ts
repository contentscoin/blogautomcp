export const CONNECT_KINDS = ["shopping", "travel"] as const;
export type ConnectKind = (typeof CONNECT_KINDS)[number];
export type StoredConnectKind = "SHOPPING" | "TRAVEL";

export interface ConnectContract {
  kind: ConnectKind;
  configuredUrl: string | null;
  contractAvailable: boolean;
  captureRequired: boolean;
}

export interface TravelConnectTab {
  section: string;
  tabId: string;
  title: string;
  totalCount: number;
}

export const TRAVEL_CONNECT_SERVICE_TYPE = "TRAVEL_PACKAGE";

export function parseConnectKind(value: unknown, fallback: ConnectKind = "shopping"): ConnectKind {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "travel" ? "travel" : normalized === "shopping" ? "shopping" : fallback;
}

export function toStoredConnectKind(kind: ConnectKind): StoredConnectKind {
  return kind === "travel" ? "TRAVEL" : "SHOPPING";
}

export function resolveConnectContract(kind: ConnectKind, requestedUrl?: string | null): ConnectContract {
  const configuredUrl = requestedUrl?.trim() || (kind === "travel"
    ? process.env.BRANDCONNECT_TRAVEL_CATEGORY_URL?.trim()
    : process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL?.trim()) || null;
  const contractAvailable = true;
  return { kind, configuredUrl, contractAvailable, captureRequired: !contractAvailable };
}

export function buildTravelConnectUrl(spaceId: string): string {
  return `https://brandconnect.naver.com/${spaceId}/travel-connect/products`;
}

export function buildTravelTabKey(section: string, tabId: string): string {
  return `${section}:${tabId}`;
}

export function parseTravelConnectTabs(payload: unknown): TravelConnectTab[] {
  if (typeof payload !== "object" || payload === null) return [];
  const sections = (payload as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return [];

  const tabs: TravelConnectTab[] = [];
  for (const sectionRow of sections) {
    if (typeof sectionRow !== "object" || sectionRow === null) continue;
    const sectionObject = sectionRow as Record<string, unknown>;
    const section = typeof sectionObject.section === "string" ? sectionObject.section.trim() : "";
    if (!section || !Array.isArray(sectionObject.tabs)) continue;
    for (const tabRow of sectionObject.tabs) {
      if (typeof tabRow !== "object" || tabRow === null) continue;
      const tabObject = tabRow as Record<string, unknown>;
      const tabId = typeof tabObject.tabId === "string" ? tabObject.tabId.trim() : "";
      const title = typeof tabObject.title === "string" ? tabObject.title.trim() : tabId;
      const totalCount = typeof tabObject.totalCount === "number" && Number.isFinite(tabObject.totalCount)
        ? tabObject.totalCount
        : 0;
      if (tabId && title) tabs.push({ section, tabId, title, totalCount });
    }
  }
  return tabs;
}

export function getSpaceIdFromConnectUrl(url: string): string | null {
  return url.match(/brandconnect\.naver\.com\/(\d+)(?:\/|$)/)?.[1] ?? null;
}

export function getShoppingCategoryIdFromUrl(url: string): string | null {
  return url.match(/\/category\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
}

export function buildCaptureRequiredPayload(contract: ConnectContract) {
  return {
    code: "CONNECT_CONTRACT_CAPTURE_REQUIRED",
    connectKind: contract.kind,
    captureRequired: true,
    configuredUrl: contract.configuredUrl,
    message: "여행커넥트의 실제 목록 API/응답 계약이 아직 캡처되지 않았습니다. 로그인된 세션에서 계약을 캡처한 뒤 어댑터를 연결해야 합니다.",
  };
}

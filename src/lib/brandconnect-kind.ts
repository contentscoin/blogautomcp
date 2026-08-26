export const CONNECT_KINDS = ["shopping", "travel"] as const;
export type ConnectKind = (typeof CONNECT_KINDS)[number];
export type StoredConnectKind = "SHOPPING" | "TRAVEL";

export interface ConnectContract {
  kind: ConnectKind;
  configuredUrl: string | null;
  contractAvailable: boolean;
  captureRequired: boolean;
}

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
  const contractAvailable = kind === "shopping";
  return { kind, configuredUrl, contractAvailable, captureRequired: !contractAvailable };
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

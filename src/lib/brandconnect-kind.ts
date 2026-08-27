export const CONNECT_KINDS = ["shopping", "travel"] as const;
export type ConnectKind = (typeof CONNECT_KINDS)[number];
export type StoredConnectKind = "SHOPPING" | "TRAVEL";

export const CONNECT_KIND_LABELS: Record<ConnectKind, string> = {
  shopping: "쇼핑커넥트",
  travel: "여행커넥트",
};

export interface ConnectContract {
  kind: ConnectKind;
  configuredUrl: string | null;
  /** 목록을 조회할 수 있는가. 여행커넥트는 계약을 캡처해야 true가 된다. */
  listAvailable: boolean;
  /**
   * 상품 등록·발행까지 할 수 있는가.
   * 제휴 링크 발급과 블로그 에디터 삽입 계약까지 확인된 종류만 true다.
   * 목록만 되는 상태에서 발행을 허용하면 잘못된 링크가 글에 들어갈 수 있다.
   */
  registrationAvailable: boolean;
  /** 목록 계약 캡처가 필요한 상태인가(= !listAvailable). */
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

export function getConfiguredConnectUrl(kind: ConnectKind, requestedUrl?: string | null): string | null {
  return (
    requestedUrl?.trim() ||
    (kind === "travel"
      ? process.env.BRANDCONNECT_TRAVEL_CATEGORY_URL?.trim()
      : process.env.BRANDCONNECT_SHOPPING_CATEGORY_URL?.trim()) ||
    null
  );
}

/**
 * 순수 함수 버전. 사용 가능 여부는 호출자가 결정한다.
 * 저장된 계약 파일을 함께 보고 판단하려면 `connect-contract-store`의
 * `resolveConnectContract`를 쓴다.
 */
export function buildConnectContract(
  kind: ConnectKind,
  requestedUrl: string | null | undefined,
  capability: { listAvailable: boolean; registrationAvailable: boolean }
): ConnectContract {
  return {
    kind,
    configuredUrl: getConfiguredConnectUrl(kind, requestedUrl),
    listAvailable: capability.listAvailable,
    registrationAvailable: capability.registrationAvailable,
    captureRequired: !capability.listAvailable,
  };
}

export function getSpaceIdFromConnectUrl(url: string): string | null {
  return url.match(/brandconnect\.naver\.com\/(\d+)(?:\/|$)/)?.[1] ?? null;
}

export function getShoppingCategoryIdFromUrl(url: string): string | null {
  return url.match(/\/category\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
}

export function buildCaptureRequiredPayload(contract: ConnectContract) {
  const label = CONNECT_KIND_LABELS[contract.kind];
  return {
    code: "CONNECT_CONTRACT_CAPTURE_REQUIRED",
    connectKind: contract.kind,
    captureRequired: true,
    configuredUrl: contract.configuredUrl,
    message: `${label}의 목록 응답 계약이 아직 캡처되지 않았습니다. 로그인된 세션에서 "${label} 계약 자동 캡처"를 한 번 실행하면 이후에는 자동으로 목록을 불러옵니다.`,
  };
}


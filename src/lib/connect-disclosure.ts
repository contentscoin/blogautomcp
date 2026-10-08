/** System-owned affiliate notices shared by generation, assembly and publication. */
export const SHOPPING_CONNECT_DISCLOSURE =
  "이 글은 네이버 쇼핑 커넥트 활동의 일환으로, 구매 발생 시 수수료를 제공받습니다.";

export const TRAVEL_CONNECT_DISCLOSURE =
  "이 글은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받습니다.";

export function getConnectAffiliateDisclosure(kind: "SHOPPING" | "TRAVEL"): string {
  return kind === "TRAVEL" ? TRAVEL_CONNECT_DISCLOSURE : SHOPPING_CONNECT_DISCLOSURE;
}

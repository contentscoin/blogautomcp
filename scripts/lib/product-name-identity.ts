/** Reject promotion-only labels without deleting real model numbers or claims in a product title. */
export function isPromotionOnlyProductName(value: string): boolean {
  const remainder = value
    .replace(/국내\s*생산|\d+\s*%|\d+\s*년\s*연속|브랜드\s*대상\s*수상|무료\s*배송|특가|이벤트|쿠폰|할인|혜택|최대\s*적립/gu, "")
    .replace(/[\s\p{P}\p{S}\d]/gu, "");
  return Boolean(value.trim()) && !remainder;
}

export function chooseProductName(candidates: Array<string | null | undefined>): string {
  return candidates.map((name) => (name || "").replace(/\s+/gu, " ").trim())
    .find((name) => name.length > 3 && !isPromotionOnlyProductName(name)
      && !/^(?:naver|네이버|상품)$/iu.test(name)
      && !/security verification|보안 인증|네이버 브랜드 커넥트/iu.test(name)) || "";
}

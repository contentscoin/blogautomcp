/** Shared defaults for the approved, text-led shopping article strategy. */
export const SHOPPING_POST_STRATEGY_VERSION = "shopping-post-strategy/v2" as const;
/** Legacy drafts remain identifiable until an explicit image replan upgrades them. */
export type ShoppingPostStrategyVersion = "shopping-post-strategy/v1" | typeof SHOPPING_POST_STRATEGY_VERSION;

export const SHOPPING_POST_STRATEGY = {
  version: SHOPPING_POST_STRATEGY_VERSION,
  sections: { min: 5, preferred: 6, max: 8 },
  // Keep the existing evidence/length floor; the sample's length is not a quota.
  characters: { min: 1200, max: 2800 },
  images: { min: 5, recommended: 5, max: 14 },
  bodyPhotos: { original: 1, lifestyle: 3, total: 4 },
  thumbnailCount: 1,
  affiliateDisclosurePlacement: "top",
} as const;

/** The thumbnail is separate. One original opens the article; three scenes are spread through it. */
export function shoppingPhotoRoleAt(index: number, sectionCount: number): "original" | "scene" | "none" {
  if (index === 0) return "original";
  const sceneIndexes = new Set([1, Math.floor(sectionCount / 2), sectionCount - 1].filter(value => value > 0));
  return sceneIndexes.has(index) ? "scene" : "none";
}

export const SHOPPING_NATURAL_PHOTO_RULE = "본문은 판매페이지 원본 상품 사진 1장과 서로 다른 자연스러운 AI 연출 사진 3장을 기본으로 합니다. 각 파일은 사진 한 장으로 만들고 이미지 안 설명문·정보 카드·장식 프레임·콜라주를 넣지 않습니다. 원본을 반복하거나 실패한 컷을 원본으로 대체해 수량을 채우지 않습니다. 확인된 사양·가격·치수는 본문에 쓰고 AI 안내는 이미지 바깥 캡션에 둡니다. 썸네일은 별도 1장이며 큰 제목 텍스트를 사용할 수 있습니다.";

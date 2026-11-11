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

/** 연출 사진을 못 채운 글이 발행될 수 있는 최소 장수: 썸네일 1 + 판매페이지 원본 1. */
export const SHOPPING_RELAXED_IMAGE_FLOOR = 2;

/**
 * 연출 사진 완화가 기록된 구성인지. 완화는 이미지 준비가 실패한 뒤 명시적 재계획에서만 기록되며
 * (imageFloor를 계약 최소보다 낮게 저장), 이 표시가 있는 글은 원본 1장만으로도 구성 검사를 통과한다.
 */
export function isShoppingSceneCoverageRelaxed(composition: { strategyVersion?: string; imageFloor?: number; sceneCoverage?: string } | null | undefined): boolean {
  // imageFloor만으로는 인정하지 않는다. 이전 재계획이 남긴 하한이 자연사진 계약을 우회하면 안 된다.
  return composition?.strategyVersion === SHOPPING_POST_STRATEGY_VERSION && composition.sceneCoverage === "relaxed" &&
    typeof composition.imageFloor === "number" &&
    composition.imageFloor >= SHOPPING_RELAXED_IMAGE_FLOOR && composition.imageFloor < SHOPPING_POST_STRATEGY.images.min;
}

/** 연출 사진이 완화된 글에서 본문에 쓸 수 있는 서로 다른 판매자 실사진 수. */
export const SHOPPING_RELAXED_ORIGINAL_LIMIT = 4;

/** 본문 원본 사진 상한. 기본은 1장이고, 연출 사진이 완화된 글만 서로 다른 실사진을 더 쓴다. */
export function shoppingOriginalPhotoLimit(composition: Parameters<typeof isShoppingSceneCoverageRelaxed>[0]): number {
  return isShoppingSceneCoverageRelaxed(composition) ? SHOPPING_RELAXED_ORIGINAL_LIMIT : 1;
}

export const SHOPPING_NATURAL_PHOTO_RULE = "본문은 판매페이지 원본 상품 사진 1장과 서로 다른 자연스러운 AI 연출 사진 3장을 기본으로 합니다. 각 파일은 사진 한 장으로 만들고 이미지 안 설명문·정보 카드·장식 프레임·콜라주를 넣지 않습니다. 원본을 반복하거나 실패한 컷을 원본으로 대체해 수량을 채우지 않습니다. 확인된 사양·가격·치수는 본문에 쓰고 AI 안내는 이미지 바깥 캡션에 둡니다. 썸네일은 별도 1장이며 큰 제목 텍스트를 사용할 수 있습니다.";

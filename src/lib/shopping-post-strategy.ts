/** Shared defaults for the approved, text-led shopping article strategy. */
export const SHOPPING_POST_STRATEGY_VERSION = "shopping-post-strategy/v1" as const;
export type ShoppingPostStrategyVersion = typeof SHOPPING_POST_STRATEGY_VERSION;

export const SHOPPING_POST_STRATEGY = {
  version: SHOPPING_POST_STRATEGY_VERSION,
  sections: { min: 5, preferred: 6, max: 8 },
  // Keep the existing evidence/length floor; the sample's length is not a quota.
  characters: { min: 1200, max: 2800 },
  images: { min: 5, recommended: 5, max: 14 },
  affiliateDisclosurePlacement: "top",
} as const;

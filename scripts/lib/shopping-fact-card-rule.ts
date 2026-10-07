import path from "node:path";

/** Legacy output prefix retained only to detect and reject old body cards. */
export const SHOPPING_FACT_CARD_FILE_PREFIX = "shopping-fact-card-";

export function isShoppingFactCardPath(file: string): boolean {
  return path.basename(file).startsWith(SHOPPING_FACT_CARD_FILE_PREFIX);
}

export const SHOPPING_FACT_CARD_AUDIT_RULE_EN = [
  "A shopping body slot marked editorialFactCard=true is a forbidden legacy information card. Reject it even when its seller photograph and facts are accurate.",
  "Shopping body images must be natural single-scene photographs. Reject explanatory frames around seller photos, captions burned into photos, fact lists, colored panels, cards, diagrams, collages, insets and presentation layouts.",
  "Only the explicitly identified representative thumbnail may contain its large headline overlay. This exception never permits a text panel, thumbnail or old editorial card to fill a body-photo slot.",
].join(" ");

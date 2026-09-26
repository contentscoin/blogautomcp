import path from "node:path";

/** Output file prefix of `createShoppingFactCard`; the audit uses it to label the slot. */
export const SHOPPING_FACT_CARD_FILE_PREFIX = "shopping-fact-card-";

export function isShoppingFactCardPath(file: string): boolean {
  return path.basename(file).startsWith(SHOPPING_FACT_CARD_FILE_PREFIX);
}

export const SHOPPING_FACT_CARD_AUDIT_RULE_EN = [
  "A slot marked editorialFactCard=true is an information card: a whole seller photo in a white frame beside a short list of facts on a flat background.",
  "Judge product identity from the framed photo only. The fact list is a summary, not an announcement, coupon, shipping or option notice, so do not reject it as a notice or text-only panel.",
  "When the listed facts state the feature the section text claims, the card is feature-evidence (legible seller facts beside the real product); it need not show the feature in operation.",
  "Do not require an actual usage scene for such a card. Reject it if the framed photo is the wrong product or mixed options, or if a listed fact contradicts the published section text.",
].join(" ");

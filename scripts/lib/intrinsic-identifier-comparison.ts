import type { ReferencePlaneContext } from "./reference-plane-grounding";
import type { reviewIntrinsicIdentifierOcr } from "./intrinsic-identifier-ocr";
import type { observeIntrinsicIdentifier } from "./intrinsic-identifier-observer";

export const INTRINSIC_IDENTIFIER_POLICY_VERSION = "intrinsic-identifier-comparison/v1";
export const INTRINSIC_IDENTIFIER_RULE_EN = `${INTRINSIC_IDENTIFIER_POLICY_VERSION} INDEPENDENT LITERAL OBSERVATION: Inspect the candidate's own physical product printing FIRST, before reading a selected brand name or source word into it. candidateIdentifierVisibility concerns actual intrinsic brand/product-line/model/SKU identifiers, not a thumbnail headline, floating seller badge, watermark, background text or tiny capacity/specification. If an identifying word is legible, set legible and transcribe its actual candidateLiteral character by character, with a tight normalized [left,top,right,bottom] word/short-line box in that candidate's own image (integers 0..1000). Never autocomplete a familiar name, insert a missing letter, silently correct spelling or quote a source/title as candidate pixels. Then independently transcribe sourceLiteral from a numbered selected reference's actual physical printing, binding its sourceImageIndex/SHA and tight box. A legitimate close-up of the SAME selected component may supply its readable brand even on another surface; different kit members, gifts, options and external seller artwork may not. Give identifierRole, both print locations/readabilities and actual component/visible-option correspondence. Use an empty literal and null box when not legible; use an empty identifierComparisons array for unprinted or unreadable intrinsic identifiers, without inventing brand/model/size printing on plain garments. Legible requires at least one actual intrinsic identifying comparison; it cannot coexist with candidatePrintState=not-observed or present-unreadable. Unreadable tiny letters remain an observation limit when independently distinguishing structure/option establishes compatibility; do not require OCR of absent/hidden/unreadable marks. Readable different identifying letters are a concrete conflict, not permitted microtext variation. Keep all original identity/claim/format verdicts honest; these observations never override an adverse verdict. Literal pairs are independently checked against only those bounded source/candidate pixel regions, without supplying an expected word to OCR.`;

const READABILITY = ["legible", "unreadable", "absent", "not-observed"] as const;
const LOCATION = ["intrinsic", "external-badge", "not-observed"] as const;
const ROLES = ["brand", "product-line", "model", "sku", "non-identifying"] as const;
export type IdentifierBox = [number, number, number, number];
export interface IntrinsicIdentifierPair {
  candidateLiteral: string;
  sourceLiteral: string;
  identifierRole: typeof ROLES[number];
  sourceImageIndex: number | null;
  sourceSha256: string | null;
  sourceLocation: typeof LOCATION[number];
  candidateLocation: typeof LOCATION[number];
  sourceReadability: typeof READABILITY[number];
  candidateReadability: typeof READABILITY[number];
  sameSelectedComponent: boolean | null;
  sameSelectedVisibleOption: boolean | null;
  candidateBox: IdentifierBox | null;
  sourceBox: IdentifierBox | null;
}
export interface IntrinsicIdentifierServerConflict {
  version: "intrinsic-identifier-conflict/v1";
  pair: IntrinsicIdentifierPair;
  evidence: NonNullable<Awaited<ReturnType<typeof reviewIntrinsicIdentifierOcr>>["evidence"]>;
  /** Separate bounded single-image observations; the original comparison is never rewritten. */
  blindObservations?: {
    source: NonNullable<Awaited<ReturnType<typeof observeIntrinsicIdentifier>>["evidence"]>;
    candidate: NonNullable<Awaited<ReturnType<typeof observeIntrinsicIdentifier>>["evidence"]>;
  };
}
const PAIR_KEYS = ["candidateLiteral", "sourceLiteral", "identifierRole", "sourceImageIndex", "sourceSha256", "sourceLocation", "candidateLocation",
  "sourceReadability", "candidateReadability", "sameSelectedComponent", "sameSelectedVisibleOption", "candidateBox", "sourceBox"] as const;
const box = { anyOf: [{ type: "null" }, { type: "array", minItems: 4, maxItems: 4, items: { type: "integer", minimum: 0, maximum: 1000 } }] } as const;
export const INTRINSIC_IDENTIFIER_SCHEMA = { type: "array", maxItems: 2, items: { type: "object", properties: {
  candidateLiteral: { type: "string", maxLength: 80 }, sourceLiteral: { type: "string", maxLength: 80 },
  identifierRole: { type: "string", enum: ROLES }, sourceImageIndex: { type: ["integer", "null"] },
  sourceSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
  sourceLocation: { type: "string", enum: LOCATION }, candidateLocation: { type: "string", enum: LOCATION },
  sourceReadability: { type: "string", enum: READABILITY }, candidateReadability: { type: "string", enum: READABILITY },
  sameSelectedComponent: { type: ["boolean", "null"] }, sameSelectedVisibleOption: { type: ["boolean", "null"] },
  candidateBox: box, sourceBox: box,
}, required: PAIR_KEYS, additionalProperties: false } } as const;
function validBox(value: unknown): value is IdentifierBox {
  return Array.isArray(value) && value.length === 4 && value.every(x => Number.isInteger(x) && x >= 0 && x <= 1000) && value[0] < value[2] && value[1] < value[3];
}
/** A blind full-word ROI may expand a clipped substring, but cannot move to a
 * different product/mark elsewhere in a multi-component source photograph. */
export function intrinsicIdentifierBoxesOverlap(a: IdentifierBox | null, b: IdentifierBox | null): boolean {
  if (!validBox(a) || !validBox(b)) return false;
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const smaller = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return width * height >= smaller / 2;
}
export function intrinsicIdentifierComparisonIssue(comparison: Record<string, unknown>, context: ReferencePlaneContext): string | null {
  const pairs = comparison.identifierComparisons;
  if (!["legible", "unreadable", "no-intrinsic-identifiers-observed"].includes(String(comparison.candidateIdentifierVisibility)) ||
      !Array.isArray(pairs) || pairs.length > 2) return "explicit intrinsic identifier visibility/comparisons are required";
  for (const value of pairs) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...PAIR_KEYS].sort().join("|"))
      return "intrinsic identifier comparison fields are missing or unexpected";
    const pair = value as IntrinsicIdentifierPair;
    if (!ROLES.includes(pair.identifierRole) || !LOCATION.includes(pair.sourceLocation) || !LOCATION.includes(pair.candidateLocation) ||
        !READABILITY.includes(pair.sourceReadability) || !READABILITY.includes(pair.candidateReadability) ||
        ![pair.sameSelectedComponent, pair.sameSelectedVisibleOption].every(x => x === null || typeof x === "boolean")) return "invalid intrinsic identifier role/location/readability/correspondence";
    for (const side of ["source", "candidate"] as const) {
      const literal = pair[`${side}Literal`], region = pair[`${side}Box`], readability = pair[`${side}Readability`];
      if (typeof literal !== "string" || literal.length > 80 || (readability === "legible" ? !literal.trim() || !validBox(region) : literal !== "" || region !== null))
        return "legible identifiers require an actual literal/tight box; unobserved letters cannot be guessed";
    }
    const source = pair.sourceImageIndex === context.primaryReferenceImageIndex ? { sha256: context.primaryReferenceSha256 }
      : context.supplementalReferences.find(reference => reference.imageIndex === pair.sourceImageIndex);
    if (pair.sourceReadability === "not-observed" && pair.sourceImageIndex === null && pair.sourceSha256 === null) continue;
    if (!source || pair.sourceSha256 !== source.sha256) return "identifier source index/SHA is not a reference for this exact candidate";
  }
  const legible = pairs.some((pair: IntrinsicIdentifierPair) => pair.candidateLocation === "intrinsic" && pair.identifierRole !== "non-identifying" && pair.candidateReadability === "legible");
  if ((comparison.candidateIdentifierVisibility === "legible") !== legible) return "intrinsic identifier visibility contradicts its actual literal observations";
  if (legible && comparison.candidatePrintState !== "present") return "legible intrinsic candidate text cannot be unobserved or unreadable";
  return null;
}
export function corroboratableIdentifierPairs(comparison: Record<string, unknown>): IntrinsicIdentifierPair[] {
  return (comparison.identifierComparisons as IntrinsicIdentifierPair[]).filter(pair => pair.identifierRole !== "non-identifying" &&
    pair.sourceLocation === "intrinsic" && pair.candidateLocation === "intrinsic" && pair.sourceReadability === "legible" &&
    pair.candidateReadability === "legible" && pair.sameSelectedComponent === true && pair.sameSelectedVisibleOption === true);
}

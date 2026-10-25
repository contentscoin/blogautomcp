/** Structured final-QA observations, never an image approval or generation authority. */
export const VISIBLE_IDENTITY_POLICY_VERSION = "publication-visible-identity/v1";
export const VISIBLE_IDENTITY_EVIDENCE_RULE = "Judge visible fidelity to this slot's own mapped selected reference, not market uniqueness, authenticity, exact purchased SKU or an unseen label. State at least two different actually observed physical landmarks in BOTH reference and candidate for observed-correspondence, such as neckline and cuff/seam construction, or housing shape and band connection. A title/category/brand, provenance, absence of a printed identifier on an intrinsically unprinted source, or generic recognition is not a physical landmark. A genuinely changed cut, seam, construction, colour, readable brand or confirmed visible option remains a concrete conflict. Use concrete-conflict with the actual opposing observations and a specific conflict; use insufficient-visible-structure for genuinely inadequate observations, preserving the adverse identity verdict as HOLD rather than inventing a defect. This contract never changes a verdict, certifies pixels, or allows regeneration.";
export const OPTION_CONFLICT_WITNESS_RULE = "catalogRangeFacts and catalogCandidatesFromTitle describe listing alternatives, never a confirmed colour, purchased option or complete bundle. Do not promote the last colour in a seller feature into the selected colour. Only the WHOLE exact server-supplied confirmedOptionLabel establishes that label; a size-only label establishes no colour, and no label certifies an actual completed purchase. For mixedOptions=false return exactly origin=none, quote='', visibleAlternatives=[]. For mixedOptions=true identify at least two genuinely distinguishable visible alternatives and trace their conflict to either the WHOLE exact confirmedOptionLabel or the same WHOLE actual published title/body paragraph already grounded by photoClaimObjection with quantity/complete-set scope. An already allowed explicitly named comparison in a non-thumbnail body slot may instead use published-named-comparison with the WHOLE exact actual section title/body paragraph, explicitNamedComparison=true and optionsClearlyLabeled=true; the actual alternative naming, labels and comparison permission must still be judged from pixels and published text. No substring, normalized, invented or catalog-feature quotation is a confirmed selection or published comparison. Genuinely unresolved identity is an identity HOLD, not invented mixed options; actual confirmed-option conflict or unsupported photographed purchase-bundle claims still reject.";

export interface VisibleIdentityReviewContext {
  version: typeof VISIBLE_IDENTITY_POLICY_VERSION;
  selectedProductParsed: boolean;
  confirmedOptionLabel: string | null;
  catalogRangeFacts: string[];
  catalogCandidatesFromTitle: string[];
  /** Deliberately no semantic colour inference, even from a confirmed size label. */
  colourSelectionStatus: "not-inferred-from-label-or-catalog";
}
export interface VisibleIdentityEvidenceContext extends VisibleIdentityReviewContext {
  role?: string;
  sectionTitle?: string;
  sectionBody?: readonly string[];
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const distinct = (values: string[]): boolean => new Set(values.map(value => value.normalize("NFKC").trim().toLocaleLowerCase("en-US"))).size === values.length;

/** Parse only the server-owned selected-product JSON. Never infer selection
 * from prose, the title, a feature's ordering or a catalog range's final item. */
export function visibleIdentityReviewContext(selectedProduct: string): VisibleIdentityReviewContext {
  const result: VisibleIdentityReviewContext = { version: VISIBLE_IDENTITY_POLICY_VERSION, selectedProductParsed: false,
    confirmedOptionLabel: null, catalogRangeFacts: [], catalogCandidatesFromTitle: [], colourSelectionStatus: "not-inferred-from-label-or-catalog" };
  let source: Record<string, unknown> | null;
  try { source = object(JSON.parse(selectedProduct)); } catch { return result; }
  if (!source) return result;
  result.selectedProductParsed = true;
  const resolution = object(source.optionResolution);
  if (resolution && text(resolution.confirmedOptionLabel)) {
    const selected = object(source.selectedOption);
    // Both fields, when supplied, must agree. Do not repair contradictory facts.
    if (!selected || (selected.status === "confirmed" && selected.label === resolution.confirmedOptionLabel))
      result.confirmedOptionLabel = resolution.confirmedOptionLabel;
  }
  if (resolution && Array.isArray(resolution.catalogCandidatesFromTitle)) result.catalogCandidatesFromTitle =
    [...new Set(resolution.catalogCandidatesFromTitle.filter(text))];
  if (Array.isArray(source.validatedSellerFeatures)) result.catalogRangeFacts = [...new Set(source.validatedSellerFeatures.flatMap(value => {
    const feature = object(value);
    if (!feature || !text(feature.text) || !Array.isArray(feature.evidenceIds) || !feature.evidenceIds.length || !feature.evidenceIds.every(text)) return [];
    // A syntactic labelled feature is retained verbatim as catalog data. This
    // intentionally does not classify its values, choose a colour, or search
    // arbitrary seller prose for option semantics.
    return /^\s*(?:색상|컬러|색깔|옵션|선택\s*옵션|선택\s*상품|사이즈|colou?r|options?|sizes?)\s*[:：]/iu.test(feature.text) ? [feature.text] : [];
  }))];
  return result;
}

const LANDMARK_SCHEMA = { type: "object", properties: {
  part: { type: "string", minLength: 1 }, referenceObservation: { type: "string", minLength: 1 }, candidateObservation: { type: "string", minLength: 1 },
}, required: ["part", "referenceObservation", "candidateObservation"], additionalProperties: false } as const;
export const VISIBLE_IDENTITY_EVIDENCE_SCHEMA = { type: "object", description: VISIBLE_IDENTITY_EVIDENCE_RULE, properties: {
  basis: { type: "string", enum: ["observed-correspondence", "concrete-conflict", "insufficient-visible-structure"] },
  landmarks: { type: "array", items: LANDMARK_SCHEMA }, conflict: { type: "string" },
}, required: ["basis", "landmarks", "conflict"], additionalProperties: false } as const;
export const OPTION_CONFLICT_WITNESS_SCHEMA = { type: "object", description: OPTION_CONFLICT_WITNESS_RULE, properties: {
  origin: { type: "string", enum: ["none", "confirmed-selection", "published-purchase-bundle", "published-named-comparison"] },
  quote: { type: "string" }, visibleAlternatives: { type: "array", items: { type: "string", minLength: 1 } },
}, required: ["origin", "quote", "visibleAlternatives"], additionalProperties: false } as const;

/** Syntactic/traceability consistency only. null is NOT an approval, and an
 * invalid review is HOLD, never evidence of an actual image defect. */
export function visibleIdentityEvidenceIssue(row: Record<string, unknown>, context: VisibleIdentityReviewContext): string | null {
  if (context.version !== VISIBLE_IDENTITY_POLICY_VERSION) return "visible identity context is missing or has the wrong version";
  const evidence = object(row.visibleIdentityEvidence);
  if (!evidence || !exactKeys(evidence, ["basis", "landmarks", "conflict"])) return "visibleIdentityEvidence fields are missing or unexpected";
  if (!Array.isArray(evidence.landmarks) || typeof evidence.conflict !== "string")
    return "visible identity requires actual landmark observations and a string conflict";
  const landmarks = evidence.landmarks.map(object);
  if (landmarks.some(landmark => !landmark || !exactKeys(landmark, ["part", "referenceObservation", "candidateObservation"]) ||
      ![landmark.part, landmark.referenceObservation, landmark.candidateObservation].every(text)))
    return "each visible landmark requires an exact part and nonempty reference/candidate observations";
  if (!distinct(landmarks.map(landmark => landmark!.part as string))) return "visible landmarks must name different physical parts";
  if (row.identityMatches === true) return evidence.basis === "observed-correspondence" && landmarks.length >= 2 && evidence.conflict === ""
    ? null : "favorable identity requires two observed corresponding landmarks and an empty conflict";
  if (row.identityMatches !== false) return "visible identity requires an original boolean identityMatches";
  if (evidence.basis !== "concrete-conflict" && evidence.basis !== "insufficient-visible-structure")
    return "adverse identity requires concrete-conflict or insufficient-visible-structure evidence";
  if (evidence.basis === "concrete-conflict" && landmarks.length < 1) return "a concrete identity conflict requires at least one actually observed opposing landmark";
  if (!evidence.conflict.trim()) return "adverse identity requires the actual conflict or observation insufficiency";
  const comparison = object(row.referenceComparison);
  if (comparison && ((evidence.basis === "concrete-conflict" && comparison.objectionKind === "unresolved") ||
      (evidence.basis === "insufficient-visible-structure" && comparison.objectionKind !== "unresolved")))
    return "visible identity basis contradicts the structured reference objection";
  return null;
}

/** Keep option selection separate from catalog facts and trace any actual
 * purchase-bundle assertion to the exact already indexed published text. */
export function optionConflictWitnessIssue(row: Record<string, unknown>, context: VisibleIdentityEvidenceContext): string | null {
  if (context.version !== VISIBLE_IDENTITY_POLICY_VERSION) return "option witness context is missing or has the wrong version";
  const witness = object(row.optionConflictWitness);
  if (!witness || !exactKeys(witness, ["origin", "quote", "visibleAlternatives"]) || typeof witness.quote !== "string" ||
      !Array.isArray(witness.visibleAlternatives) || !witness.visibleAlternatives.every(text)) return "optionConflictWitness fields are missing or malformed";
  if (row.mixedOptions === false) return witness.origin === "none" && witness.quote === "" && witness.visibleAlternatives.length === 0
    ? null : "unmixed options require the exact empty none witness";
  if (row.mixedOptions !== true) return "option witness requires an original boolean mixedOptions";
  if (witness.visibleAlternatives.length < 2 || !distinct(witness.visibleAlternatives as string[]))
    return "mixed options require two different actually visible alternatives";
  if (witness.origin === "confirmed-selection") return context.confirmedOptionLabel !== null && witness.quote === context.confirmedOptionLabel
    ? null : "confirmed selection witness must quote the whole exact confirmed option label, never a catalog fact";
  if (witness.origin === "published-named-comparison") {
    if (row.explicitNamedComparison !== true || row.optionsClearlyLabeled !== true || typeof context.role !== "string" || context.role === "thumbnail")
      return "published named comparison requires a non-thumbnail slot and the original explicit comparison/labeled-option flags";
    return text(witness.quote) && (witness.quote === context.sectionTitle || context.sectionBody?.includes(witness.quote))
      ? null : "named comparison must quote the whole exact actual published title or paragraph";
  }
  if (witness.origin !== "published-purchase-bundle") return "mixed options require confirmed selection or an actual published purchase-bundle witness";
  const claim = object(row.photoClaimObjection);
  if (row.photoClaimMatches !== false || !claim || !exactKeys(claim, ["origin", "sourceIndex", "quote", "scope", "conflict"]) ||
      (claim.scope !== "quantity" && claim.scope !== "complete-set") || !text(claim.conflict) || claim.quote !== witness.quote || !text(witness.quote))
    return "purchase-bundle witness requires the same grounded adverse quantity/complete-set photoClaimObjection";
  if (context.role === "thumbnail") return "purchase-bundle text witness requires server-indexed section text, not unverified thumbnail transcription";
  if (claim.origin === "section-title") return claim.sourceIndex === null && claim.quote === context.sectionTitle
    ? null : "purchase-bundle title must be the whole exact published section title";
  return claim.origin === "section-body" && typeof claim.sourceIndex === "number" && Number.isInteger(claim.sourceIndex) && claim.sourceIndex >= 0 &&
    context.sectionBody !== undefined && claim.sourceIndex < context.sectionBody.length && claim.quote === context.sectionBody[claim.sourceIndex]
    ? null : "purchase-bundle body must be the whole exact indexed published paragraph";
}

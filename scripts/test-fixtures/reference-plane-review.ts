/** Offline fixture adapter only. New plane-contract negatives use raw reviewers.
 * Preserve existing verdicts; supply explicit synthetic reference evidence so
 * older gate regressions do not accidentally test a missing new field. */
import type { PublishImageAuditOptions } from "../lib/publish-image-audit";
import type { ReferencePlaneContext } from "../lib/reference-plane-grounding";
type AuditCall = Pick<Parameters<NonNullable<PublishImageAuditOptions["review"]>>[0], "userPrompt">;

export function referencePlaneFixtureRow<T extends { index: number }>(call: AuditCall, row: T): T & { referenceComparison: unknown } {
  const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"));
  const slots = line ? JSON.parse(line.slice(line.indexOf("["))) as Array<{ index: number; sectionTitle?: string; referencePlaneMap?: ReferencePlaneContext }> : [];
  const context = slots.find(slot => slot.index === row.index)?.referencePlaneMap;
  const input = row as T & { identityMatches?: unknown; mixedOptions?: unknown; explicitNamedComparison?: unknown; optionsClearlyLabeled?: unknown;
    visibleIdentityEvidence?: unknown; optionConflictWitness?: unknown; referenceComparison?: unknown };
  // Explicit synthetic observations belong only to this offline legacy gate
  // adapter. New contract/authority tests inject their raw fields directly.
  const verdict = { ...input, visibleIdentityEvidence: input.visibleIdentityEvidence ?? {
    basis: input.identityMatches === false ? (input.referenceComparison && (input.referenceComparison as Record<string, unknown>).objectionKind !== "unresolved" ? "concrete-conflict" : "insufficient-visible-structure") : "observed-correspondence",
    landmarks: [{ part: "Synthetic silhouette", referenceObservation: "Offline source contour", candidateObservation: "Offline candidate contour" },
      { part: "Synthetic construction", referenceObservation: "Offline source construction", candidateObservation: "Offline candidate construction" }],
    conflict: input.identityMatches === false ? "Original offline adverse observation retained" : "",
  }, optionConflictWitness: input.optionConflictWitness ?? (input.mixedOptions === true && input.explicitNamedComparison === true && input.optionsClearlyLabeled === true
    ? { origin: "published-named-comparison", quote: slots.find(slot => slot.index === row.index)?.sectionTitle || "", visibleAlternatives: ["Offline option A", "Offline option B"] }
    : { origin: "none", quote: "", visibleAlternatives: [] }) };
  if (verdict.referenceComparison != null) return verdict as T & { referenceComparison: unknown };
  return { ...verdict, referenceComparison: context ? {
    primaryReferenceImageIndex: context.primaryReferenceImageIndex, primaryReferenceSha256: context.primaryReferenceSha256,
    primaryObservation: "Synthetic offline primary observation", candidateObservation: "Synthetic offline candidate observation",
    objectionKind: verdict.identityMatches === false ? "unresolved" : "none",
    evidenceImageIndex: context.primaryReferenceImageIndex, samePhysicalPart: null, samePhysicalSurface: null,
    sameSelectedVisibleOption: null, referencePrintState: "not-observed", candidatePrintState: "not-observed",
    candidateIdentifierVisibility: "no-intrinsic-identifiers-observed", identifierComparisons: [],
    evidenceObservation: "Synthetic offline mapped evidence", basis: "Legacy gate fixture only; no visual acceptance is inferred",
  } : null };
}

export function withReferencePlaneFixture(options: PublishImageAuditOptions): PublishImageAuditOptions {
  const reviewer = options.review;
  if (!reviewer) return options;
  // Preserve the options identity: several existing mutation regressions change
  // these exact options while the asynchronous pixel review is in progress.
  options.review = async call => {
    const raw = await reviewer(call);
    try {
      const parsed = JSON.parse(raw) as { reviews?: Array<{ index: number }> };
      if (Array.isArray(parsed.reviews)) parsed.reviews = parsed.reviews.map(row => referencePlaneFixtureRow(call, row));
      return JSON.stringify(parsed);
    } catch { return raw; }
  };
  return options;
}

/** Offline fixture adapter only. New plane-contract negatives use raw reviewers.
 * Preserve existing verdicts; supply explicit synthetic reference evidence so
 * older gate regressions do not accidentally test a missing new field. */
import type { PublishImageAuditOptions } from "../lib/publish-image-audit";
import type { ReferencePlaneContext } from "../lib/reference-plane-grounding";
type AuditCall = Pick<Parameters<NonNullable<PublishImageAuditOptions["review"]>>[0], "userPrompt">;

export function referencePlaneFixtureRow<T extends { index: number }>(call: AuditCall, row: T): T & { referenceComparison: unknown } {
  const line = call.userPrompt.split("\n").find(value => value.startsWith("Each attached image belongs ONLY"));
  const slots = line ? JSON.parse(line.slice(line.indexOf("["))) as Array<{ index: number; referencePlaneMap?: ReferencePlaneContext }> : [];
  const context = slots.find(slot => slot.index === row.index)?.referencePlaneMap;
  const verdict = row as T & { identityMatches?: unknown; referenceComparison?: unknown };
  if (verdict.referenceComparison != null) return verdict as T & { referenceComparison: unknown };
  return { ...row, referenceComparison: context ? {
    primaryReferenceImageIndex: context.primaryReferenceImageIndex, primaryReferenceSha256: context.primaryReferenceSha256,
    primaryObservation: "Synthetic offline primary observation", candidateObservation: "Synthetic offline candidate observation",
    objectionKind: verdict.identityMatches === false ? "unresolved" : "none",
    evidenceImageIndex: context.primaryReferenceImageIndex, samePhysicalPart: null, samePhysicalSurface: null,
    sameSelectedVisibleOption: null, referencePrintState: "not-observed", candidatePrintState: "not-observed",
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

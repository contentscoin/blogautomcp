import type { BrandLinkContentReadiness } from "./brandlink-content-readiness";

export type QualityRepairComparison = -1 | 0 | 1;

function compareLowerIsBetter(before: number, after: number): QualityRepairComparison {
  if (after < before) return 1;
  if (after > before) return -1;
  return 0;
}

function compareHigherIsBetter(before: number, after: number): QualityRepairComparison {
  if (after > before) return 1;
  if (after < before) return -1;
  return 0;
}

function mandatoryFailureKeys(report: BrandLinkContentReadiness): Set<string> {
  const categories = report.quality?.categories?.length
    ? report.quality.categories
    : report.qualityFailures || [];
  return new Set(categories.filter((category) => category.status === "fail").map((category) => category.key));
}

function failedSignalCount(report: BrandLinkContentReadiness): number {
  return report.signals.filter((signal) => signal.status === "fail").length;
}

function sourceSufficiencyRank(report: BrandLinkContentReadiness): number {
  // Missing evidence metadata is unknown, never an improvement over an explicit failure.
  return report.quality?.sourceEvidence?.sufficient === true ? 1 : 0;
}

/**
 * Compare a repair candidate with the currently selected draft.
 *
 * Hard blockers, canonical source sufficiency and mandatory category failures
 * are gates. The aggregate score is only considered after those gates are
 * non-regressive, so a cosmetically higher score cannot hide a new safety or
 * evidence failure.
 */
export function compareQualityRepairCandidates(
  before: BrandLinkContentReadiness,
  after: BrandLinkContentReadiness,
): QualityRepairComparison {
  // Preserve approval gates before considering any local improvement. In
  // particular, removing a prose blocker must never compensate for losing the
  // frozen source evidence that makes the remaining prose reviewable.
  if (before.canPublish && !after.canPublish) return -1;

  const beforeSourceRank = sourceSufficiencyRank(before);
  const afterSourceRank = sourceSufficiencyRank(after);
  if (afterSourceRank < beforeSourceRank) return -1;

  const beforeMandatoryFailures = mandatoryFailureKeys(before);
  const afterMandatoryFailures = mandatoryFailureKeys(after);
  // No positive comparison (including removal of another blocker or richer
  // source metadata) may hide a newly failing required category.
  if ([...afterMandatoryFailures].some((key) => !beforeMandatoryFailures.has(key))) return -1;

  const previousBlockers = new Set(before.blockers.map((item) => item.code));
  const newBlockers = after.blockers.filter((item) => !previousBlockers.has(item.code));
  if (newBlockers.some((item) => item.tier === "safety")) return -1;
  // A new structure blocker also cannot be committed merely for a higher score.
  if (newBlockers.length > 0) return -1;

  const safetyBlockerComparison = compareLowerIsBetter(
    before.blockers.filter((item) => item.tier === "safety").length,
    after.blockers.filter((item) => item.tier === "safety").length,
  );
  if (safetyBlockerComparison !== 0) return safetyBlockerComparison;

  const blockerComparison = compareLowerIsBetter(before.blockers.length, after.blockers.length);
  if (blockerComparison !== 0) return blockerComparison;

  const sourceComparison = compareHigherIsBetter(beforeSourceRank, afterSourceRank);
  if (sourceComparison !== 0) return sourceComparison;

  // Do not exchange one required category failure for another. This prevents
  // oscillation between superficially different, still-unapprovable drafts.
  const mandatoryComparison = compareLowerIsBetter(beforeMandatoryFailures.size, afterMandatoryFailures.size);
  if (mandatoryComparison !== 0) return mandatoryComparison;

  if (after.canPublish && !before.canPublish) return 1;
  if (!after.canPublish && before.canPublish) return -1;

  const beforeFailedSignals = failedSignalCount(before);
  const afterFailedSignals = failedSignalCount(after);
  // Soft signal cleanup is useful only when the measured quality did not fall;
  // conversely, a score gain cannot introduce another failing signal.
  if (afterFailedSignals > beforeFailedSignals) return -1;
  if (after.score < before.score) return -1;
  if (afterFailedSignals < beforeFailedSignals) return 1;
  return compareHigherIsBetter(before.score, after.score);
}

/** A repair is accepted only when it is a strict, gate-preserving improvement. */
export function shouldAcceptQualityRepair(before: BrandLinkContentReadiness, after: BrandLinkContentReadiness): boolean {
  return compareQualityRepairCandidates(before, after) > 0;
}

import type { BrandLinkContentReadiness } from "./brandlink-content-readiness";

/** A higher aggregate score must never replace a safer draft with a new blocker. */
export function shouldAcceptQualityRepair(before: BrandLinkContentReadiness, after: BrandLinkContentReadiness): boolean {
  const previousBlockers = new Set(before.blockers.map((item) => item.code));
  if (after.blockers.some((item) => !previousBlockers.has(item.code))) return false;
  if (after.canPublish) return true;
  if (after.blockers.length < before.blockers.length) return true;
  const failed = (report: BrandLinkContentReadiness) => report.signals.filter((signal) => signal.status === "fail").length;
  return after.score >= before.score && failed(after) < failed(before) ||
    after.score > before.score && failed(after) <= failed(before);
}

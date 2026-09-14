/** Content and image gates are separate: never advise rewriting a passing article for missing images.
 * Readiness returns structural blockers before category failures, so structure-only
 * (or empty) blockers do not prove that editorial quality passed, even at 96 points.
 */
export function isDraftEditorialQualityPassed(quality?: {
  canPublish: boolean;
  code?: string;
  score?: number;
  blockers?: Array<{ code: string }>;
  quality?: { score: number; passScore?: number; categories?: Array<{ status: string }> };
  signals: Array<{ key: string; status: string }>;
} | null): boolean {
  if (!quality) return false;
  if (quality.signals.some(signal => signal.status === "fail" && signal.key !== "composition-quality")) return false;
  if (quality.blockers?.some(blocker => blocker.code !== "composition-quality")) return false;
  if (quality.quality?.categories?.some(category => category.status === "fail")) return false;
  if (quality.quality?.passScore !== undefined && quality.quality.score < quality.quality.passScore) return false;
  if (quality.code && quality.code !== "ok" && quality.code !== "composition-quality") return false;
  return quality.canPublish || quality.signals.some(signal => signal.status === "fail" && signal.key === "composition-quality");
}

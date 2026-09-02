/** Content and image gates are separate: never advise rewriting a passing article for missing images. */
export function isDraftEditorialQualityPassed(quality?: {
  canPublish: boolean;
  signals: Array<{ key: string; status: string }>;
} | null): boolean {
  if (!quality) return false;
  if (quality.canPublish) return true;
  const failures = quality.signals.filter((signal) => signal.status === "fail");
  return failures.length > 0 && failures.every((signal) => signal.key === "composition-quality");
}

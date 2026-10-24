export interface ProductSectionReviewConflictBounds {
  targetCount: number;
  candidateCount: number;
  /** Zero-based target:candidate pairs belonging to this completed response. */
  allowedPairs: ReadonlySet<string>;
}

/** Identify ambiguous pairs without changing any verdict or making a new review.
 * Callers quarantine these pairs; a conflict is never permission to publish. */
export function findProductSectionReviewConflicts(
  parsed: unknown,
  bounds: ProductSectionReviewConflictBounds,
): Set<string> {
  const conflicts = new Set<string>();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return conflicts;
  const response = parsed as Record<string, unknown>;
  const seen = new Map<string, { group: string; assignment?: string }>();
  for (const group of ["assignments", "rejections", "notSelected"]) {
    const rows = response[group];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const { targetIndex, selectedIndex } = row as Record<string, unknown>;
      if (typeof targetIndex !== "number" || !Number.isInteger(targetIndex) ||
          typeof selectedIndex !== "number" || !Number.isInteger(selectedIndex) ||
          targetIndex < 1 || targetIndex > bounds.targetCount ||
          selectedIndex < 1 || selectedIndex > bounds.candidateCount) continue;
      const key = `${targetIndex - 1}:${selectedIndex - 1}`;
      if (!bounds.allowedPairs.has(key)) continue;
      // Exact repeated assignments are harmless. Different class/reason values
      // are unresolved; neither version may be silently preferred.
      const assignment = group === "assignments"
        ? JSON.stringify([row.reviewClass, row.reason]) : undefined;
      const previous = seen.get(key);
      if (previous && (previous.group !== group ||
          (group === "assignments" && previous.assignment !== assignment))) conflicts.add(key);
      if (!previous) seen.set(key, { group, assignment });
    }
  }
  return conflicts;
}

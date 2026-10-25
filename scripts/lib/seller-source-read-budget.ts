/** Optional seller DOM enrichment must never hold the whole writing job open.
 * Late DOM answers are ignored; only independently collected source data can
 * survive a timeout. This helper grants no evidence or publication authority. */
export function createSellerSourceReadBudget(options: {
  maximumMs?: number; now?: () => number;
  onEvent?: (stage: string, status: "started" | "complete" | "failed" | "timeout" | "skipped") => void;
} = {}) {
  const now = options.now || (() => performance.now());
  const duration = Number.isFinite(options.maximumMs) && options.maximumMs! > 0 ? Math.min(20_000, options.maximumMs!) : 18_000;
  const deadline = now() + duration;
  let exhausted = false;
  const event = (stage: string, status: Parameters<NonNullable<typeof options.onEvent>>[1]) => {
    try { options.onEvent?.(stage, status); } catch { /* Logging cannot create source evidence or a retry. */ }
  };
  return {
    get timedOut() { return exhausted; },
    async read<T>(stage: string, operation: () => Promise<T>, fallback: T, stageMaximumMs = duration): Promise<T> {
      const stageLimit = Number.isFinite(stageMaximumMs) && stageMaximumMs > 0 ? stageMaximumMs : duration;
      const remaining = Math.min(deadline - now(), stageLimit);
      if (exhausted || remaining <= 0) { exhausted = true; event(stage, "skipped"); return fallback; }
      const stageDeadline = now() + remaining;
      let timer: ReturnType<typeof setTimeout> | undefined;
      event(stage, "started");
      try {
        const result = await Promise.race([operation(), new Promise<T>(resolve => {
          timer = setTimeout(() => { exhausted = true; event(stage, "timeout"); resolve(fallback); }, remaining);
        })]);
        // A busy event loop may deliver the operation before an overdue timer.
        // An already late read still cannot become the current source answer.
        if (exhausted || now() >= stageDeadline) {
          if (!exhausted) event(stage, "timeout");
          exhausted = true; return fallback;
        }
        event(stage, "complete"); return result;
      } catch { event(stage, "failed"); return fallback; }
      finally { if (timer !== undefined) clearTimeout(timer); }
    },
  };
}

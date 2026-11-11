/** Join the existing detached source-only worker before a remote response fills
 * its shared seller cache. This coordinates callers; it never approves pixels. */
type SourceRepairResult = {
  errors: readonly string[];
  manifest: { imageGeneration?: { ownerToken?: string } };
};
type RepairState = { status?: string; ownerToken?: string; errors?: readonly string[] };
type RepairOutcome = { ready: boolean; reason?: string };
type RepairTask = {
  ownerToken?: string;
  pending: boolean;
  completion: Promise<RepairOutcome>;
};
const shared = globalThis as typeof globalThis & { brandPostScheduledSourceRepairs?: Map<string, RepairTask> };
const tasks = shared.brandPostScheduledSourceRepairs ??= new Map<string, RepairTask>();
const blocked = (reason: string): RepairOutcome => ({ ready: false, reason });

export function trackScheduledSourceImageRepair<T extends SourceRepairResult>(
  id: string, run: () => Promise<T>, readOwner: () => string | undefined,
): Promise<T> {
  if (tasks.get(id)?.pending) return Promise.reject(new Error("SOURCE_REPAIR_BUSY: 기존 원본 배정 작업을 기다려야 합니다."));
  const task: RepairTask = { pending: true, completion: Promise.resolve(blocked("pending")) };
  tasks.set(id, task);
  let operation: Promise<T>;
  try { operation = run(); } catch (error) { operation = Promise.reject(error); }
  // repairBrandPostImages claims/persists ownership synchronously before its first await.
  try { task.ownerToken = readOwner(); } catch { /* An uncertain owner cannot bypass the active-work guard. */ }
  task.completion = operation.then(result => {
    task.ownerToken = result.manifest.imageGeneration?.ownerToken || task.ownerToken;
    // source-only deliberately leaves staged photos for the explicit image step.
    // A real source failure or cancellation must not launch another model behind it.
    return result.errors.every(error => error.includes("IMAGE_GENERATION_REQUIRED:"))
      ? { ready: true } : blocked("failed");
  }, () => blocked("failed")).then(outcome => {
    task.pending = false;
    if (outcome.ready && tasks.get(id) === task) tasks.delete(id);
    return outcome;
  });
  return operation;
}

export async function waitForScheduledSourceImageRepair(id: string, options: {
  isActive: () => boolean;
  readState: () => RepairState | null | undefined;
  isCancelled?: () => boolean;
  onWaiting?: () => void;
  timeoutMs?: number;
}): Promise<RepairOutcome & { waited: boolean }> {
  const task = tasks.get(id);
  const unsafe = (requireState = false): RepairOutcome | null => {
    if (options.isCancelled?.()) return blocked("cancelled");
    const state = options.readState();
    if (requireState && !state) return blocked("state-missing");
    if (options.isActive() || state?.status === "running") return blocked("active");
    if (state?.errors?.some(error => /USER_CANCELLED|중지|취소|IMAGE_RESUME_REQUIRED|IMAGE_OUTPUT_AMBIGUOUS|OWNERSHIP_LOST|AGENT_LOST|CHATGPT_BROWSER_AUTH_REQUIRED|CODEX_(?:QUOTA_EXHAUSTED|USAGE_LIMIT_REACHED|TRANSIENT_FAILURE|AUTH_REQUIRED|TIMEOUT)/u.test(error)))
      return blocked("stopped");
    return null;
  };
  if (options.isCancelled?.()) return { ...blocked("cancelled"), waited: false };
  if (!task) return { ...(unsafe() || { ready: true }), waited: false };
  const state = options.readState();
  // A later explicit material repair owns its own result. Do not let a prior
  // stopped source-only response poison that new owner's completed work.
  if (!task.pending && task.ownerToken && state?.ownerToken && task.ownerToken !== state.ownerToken) {
    if (tasks.get(id) === task) tasks.delete(id);
    return { ...(unsafe(true) || { ready: true }), waited: false };
  }
  const waited = task.pending;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancellation: ReturnType<typeof setInterval> | undefined;
  try {
    if (waited) options.onWaiting?.();
    const deadline = new Promise<RepairOutcome>(resolve => {
      timeout = setTimeout(() => resolve(blocked("timeout")), Math.max(1, Math.min(120_000, options.timeoutMs ?? 120_000)));
      if (options.isCancelled) cancellation = setInterval(() => {
        if (options.isCancelled?.()) resolve(blocked("cancelled"));
      }, 250);
    });
    const outcome = await Promise.race([task.completion, deadline]);
    return { ...(!outcome.ready ? outcome : unsafe(true) || outcome), waited };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (cancellation) clearInterval(cancellation);
  }
}

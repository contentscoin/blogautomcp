/** Central delivery completion and a PC material workflow have separate lifetimes. */
export type MaterialRecoveryJob = {
  type: string; status: string; result: unknown; errorCode: string | null;
  claimedAt: number | null; claimedDeviceId: string | null;
};
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }

export function materialRecoveryStatus(job: MaterialRecoveryJob) {
  const envelope = object(job.result);
  const data = object(envelope.data);
  const localJob = object(data.job);
  const items = Array.isArray(localJob.items) ? localJob.items : Array.isArray(data.items) ? data.items : [];
  const count = (state: string) => items.filter(item => object(item).status === state).length;
  const workflowId = data.workflowJobId || localJob.jobId || localJob.id || data.jobId || envelope.workflowJobId;
  const workflowJobId = typeof workflowId === 'string' && workflowId ? workflowId : null;
  const localStatus = String(localJob.status || data.status || '').toLowerCase();
  // Claims write both receipt fields atomically and never clear them. A queued
  // cancellation with no claim receipt cannot have been dispatched to the PC.
  const executionNotAdmitted = ['MATERIALS_REWRITE_FAILED', 'MATERIALS_REPAIR_BLOCKED'].includes(job.type) &&
    job.status === 'CANCELLED' && job.errorCode === 'USER_CANCELLED' && job.claimedAt === null && job.claimedDeviceId === null && job.result === null;
  const transportPending = ['QUEUED', 'RUNNING'].includes(job.status);
  const localRunning = data.workflowPending === true || [localStatus, String(data.status || '').toLowerCase()].some(status => ['queued', 'running'].includes(status));
  const localTerminal = Boolean(workflowJobId) && ['completed', 'partial', 'failed', 'interrupted', 'cancelled'].includes(localStatus) && data.workflowPending !== true;
  const workflowPending = !executionNotAdmitted && (transportPending || localRunning || !localTerminal);
  return {
    workflowPending,
    workflowUncertain: workflowPending && !transportPending && !localRunning,
    executionNotAdmitted,
    workflowJobId,
    readyCount: typeof data.readyCount === 'number' ? data.readyCount : count('ready'),
    failedCount: typeof data.failedCount === 'number' ? data.failedCount : count('failed'),
    interruptedCount: typeof data.interruptedCount === 'number' ? data.interruptedCount : count('interrupted'),
    summary: typeof envelope.summary === 'string' ? envelope.summary : null,
  };
}

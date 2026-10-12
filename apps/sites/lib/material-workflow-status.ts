type JsonObject = Record<string, unknown>;
const MATERIAL_JOB_TYPES = new Set(['MATERIALS_PREPARE', 'MATERIALS_REWRITE_FAILED', 'MATERIALS_REPAIR_BLOCKED', 'MATERIALS_PUBLISH', 'MATERIALS_LIST']);
const LOCAL_TERMINAL = new Set(['completed', 'partial', 'failed', 'interrupted', 'cancelled']);
const AUTH_REQUIRED = new Set(['AUTH_REQUIRED', 'UNAUTHORIZED', 'CODEX_AUTH_REQUIRED', 'CODEX_LOGIN_REQUIRED', 'CHATGPT_BROWSER_AUTH_REQUIRED', 'CHATGPT_BROWSER_LOGIN_REQUIRED', 'NAVER_SESSION_EXPIRED', 'NAVER_SESSION_FORBIDDEN', 'NAVER_SESSION_CONFIGURATION_REQUIRED']);
const SOURCE_REQUIRED = new Set(['SOURCE_EVIDENCE_REQUIRED', 'IMAGE_SOURCE_BINDING_REQUIRED', 'PRODUCT_SOURCE_REQUIRED', 'PRODUCT_REFERENCE_REQUIRED', 'PREWRITING_SOURCE_CHANGED', 'PREWRITING_PHOTO_CHANGED']);
const RESULT_UNCERTAIN = new Set(['OUTCOME_UNKNOWN', 'AGENT_LOST_UNCERTAIN', 'PREPARATION_RESULT_UNCERTAIN', 'IMAGE_OUTPUT_AMBIGUOUS', 'IMAGE_RESUME_REQUIRED']);
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const identifier = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
const code = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : undefined;
type MaterialWorkflowProjection = {
  workflowJobId: string | null; sourceJobId: string; workflowStatus: string; workflowTerminal: boolean; workflowPending: boolean;
  workflowUncertain: boolean; transportTerminal: boolean; completionState: string; executionNotAdmitted?: boolean;
  productStates: Array<{ productId: string; status: string; state: string; errorCode?: string; causeCode?: string }>;
  acceptedCount?: number; productStatesTruncated?: boolean; currentReadinessVerified?: boolean;
  readyCount: number; failedCount: number; interruptedCount: number; materialPreparationComplete: boolean;
  nextCall?: { tool: string; arguments: { jobId?: string; sourceJobId?: string; waitMs?: number; includeResult?: boolean } }; pollAfterMs?: number;
};

export function isMaterialWorkflowJob(type: string): boolean { return MATERIAL_JOB_TYPES.has(type); }

/** A delivery receipt is not proof that the PC finished its durable material workflow. */
export function materialWorkflowProjection(type: string, sourceJobId: string, transportStatus: string, result: unknown,
  claim?: { claimedAt: number | null; claimedDeviceId: string | null; errorCode: string | null }): MaterialWorkflowProjection | null {
  if (!isMaterialWorkflowJob(type)) return null;
  const envelope = object(result), data = object(envelope.data), local = object(data.job);
  const workflowJobId = identifier(data.workflowJobId) || identifier(data.jobId) || identifier(local.jobId) || identifier(local.id);
  if (transportStatus === 'CANCELLED' && claim?.errorCode === 'USER_CANCELLED' && claim.claimedAt === null && claim.claimedDeviceId === null && result === null)
    return { workflowJobId: null, sourceJobId, workflowStatus: 'not-admitted', workflowTerminal: true, workflowPending: false,
      workflowUncertain: false, transportTerminal: true, productStates: [], readyCount: 0, failedCount: 0, interruptedCount: 0,
      materialPreparationComplete: false, executionNotAdmitted: true, completionState: 'cancelled' };
  // General inventory reads have no material workflow to resume.
  if (type === 'MATERIALS_LIST' && !workflowJobId && data.submissionUncertain !== true) return null;
  const workflowStatus = String(local.status || data.status || '').toLowerCase();
  const items = Array.isArray(local.items) ? local.items : Array.isArray(data.items) ? data.items : [];
  const materials = Array.isArray(data.materials) ? data.materials : [];
  const transportPending = ['QUEUED', 'RUNNING'].includes(transportStatus);
  const running = data.workflowPending === true || ['running', 'queued'].includes(workflowStatus) ||
    items.some(value => ['queued', 'preparing', 'publishing'].includes(String(object(value).status))) ||
    materials.some(value => object(value).materialStatus === 'PREPARING' || object(object(value).imageGeneration).status === 'running');
  const workflowTerminal = Boolean(workflowJobId) && LOCAL_TERMINAL.has(workflowStatus) && !running;
  const workflowPending = transportPending || !workflowTerminal;
  const materialById = new Map(materials.map(value => [identifier(object(value).productId), object(value)]));
  const allProductStates = items.flatMap(value => {
    const item = object(value), productId = identifier(item.productId);
    const status = String(item.status || 'unknown'), errorCode = code(item.errorCode), causeCode = code(item.causeCode);
    const codes = [errorCode, causeCode].filter((value): value is string => Boolean(value));
    const state = status === 'outcome_unknown' || codes.some(value => RESULT_UNCERTAIN.has(value)) ? 'needs_outcome_check'
      : codes.some(value => AUTH_REQUIRED.has(value)) ? 'needs_auth'
        : codes.some(value => SOURCE_REQUIRED.has(value)) ? 'needs_input'
          : ['queued', 'preparing', 'publishing'].includes(status) ? 'pending'
            : status === 'ready' && productId && materialById.has(productId) && materialById.get(productId)?.ready !== true ? 'blocked' : status;
    return productId ? [{ productId, status, state, ...(errorCode ? { errorCode } : {}), ...(causeCode ? { causeCode } : {}) }] : [];
  });
  const productStates = allProductStates.slice(0, 50);
  const selectedIds = new Set(allProductStates.map(item => item.productId));
  const currentReadinessVerified = allProductStates.length > 0 && allProductStates.length === items.length && selectedIds.size === items.length &&
    materials.length === items.length && materialById.size === materials.length && !materialById.has(null) &&
    allProductStates.every(item => materialById.has(item.productId));
  const allReady = currentReadinessVerified && allProductStates.every(item => item.status === 'ready' && item.state === 'ready' && !item.errorCode && !item.causeCode && materialById.get(item.productId)?.ready === true);
  const readyCount = currentReadinessVerified ? allProductStates.filter(item => item.status === 'ready' && item.state === 'ready' && !item.errorCode && !item.causeCode && materialById.get(item.productId)?.ready === true).length : 0;
  const failedCount = allProductStates.filter(item => item.status === 'failed').length;
  const interruptedCount = allProductStates.filter(item => item.status === 'interrupted').length;
  const publishing = type === 'MATERIALS_PUBLISH' || data.kind === 'publish' || local.kind === 'publish';
  const completionState = workflowPending ? 'pending'
    : allProductStates.some(item => item.state === 'needs_outcome_check') ? 'needs_outcome_check'
      : allProductStates.some(item => item.state === 'needs_auth') ? 'needs_auth'
        : allProductStates.some(item => item.state === 'needs_input') ? 'needs_input'
          : workflowStatus === 'completed' && !publishing ? allReady ? 'ready' : 'blocked' : workflowStatus;
  const nextCall = workflowPending ? transportPending
    ? { tool: 'job_get', arguments: { jobId: sourceJobId, waitMs: 20000, includeResult: false } }
    : { tool: 'materials_list', arguments: workflowJobId ? { jobId: workflowJobId } : { sourceJobId } } : null;
  return { workflowJobId, sourceJobId, workflowStatus: workflowStatus || 'unknown', workflowTerminal, workflowPending,
    workflowUncertain: workflowPending && !transportPending && !running,
    transportTerminal: !transportPending, completionState, productStates, acceptedCount: items.length,
    productStatesTruncated: allProductStates.length > productStates.length, currentReadinessVerified, readyCount, failedCount, interruptedCount,
    materialPreparationComplete: !publishing && workflowTerminal && workflowStatus === 'completed' && allReady,
    ...(nextCall ? { nextCall, pollAfterMs: 3000 } : {}),
  };
}

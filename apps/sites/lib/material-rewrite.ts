import { enqueueAgentJob } from '@/lib/agent-job-queue';
import { validateToolArguments, type JsonSchema } from '@/lib/tool-schema';

export const MATERIALS_REWRITE_MIN_APP = '1.3.98';
const CONNECT_KIND = { type: 'string', enum: ['shopping', 'travel'] };
const ID = { type: 'string', minLength: 1, maxLength: 160 };
const IDEMPOTENCY = { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,120}$', description: '재시도 시 같은 값을 보내면 작업이 중복 생성되지 않습니다.' };
export const MATERIALS_REWRITE_INPUT_SCHEMA: JsonSchema = { type: 'object', properties: {
  connectKind: CONNECT_KIND,
  productIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 8, maxLength: 80, pattern: '^[A-Za-z0-9_-]{8,80}$' } },
  idempotencyKey: IDEMPOTENCY,
}, required: ['idempotencyKey'], additionalProperties: false };
export const MATERIALS_LIST_INPUT_SCHEMA: JsonSchema = { type: 'object', properties: { connectKind: CONNECT_KIND, jobId: ID, sourceJobId: ID, idempotencyKey: IDEMPOTENCY }, additionalProperties: false };
export const MATERIALS_REWRITE_QUEUE_TOOL = { jobType: 'MATERIALS_REWRITE_FAILED', minAppVersion: MATERIALS_REWRITE_MIN_APP };
export const MATERIALS_LIST_QUEUE_TOOL = { jobType: 'MATERIALS_LIST', minAppVersion: '1.3.26' };
/** Source-id forwarding in MATERIALS_LIST was introduced in the 1.3.98 PC workflow. */
export const MATERIALS_SOURCE_READ_MIN_APP = '1.3.98';

async function queue(userId: string, schema: JsonSchema, tool: { jobType: string; minAppVersion: string }, args: Record<string, unknown>) {
  const validation = validateToolArguments(schema, args);
  if (!validation.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: `인자를 확인하세요: ${validation.errors.slice(0, 5).join('; ')}` };
  if (Array.isArray(validation.value.productIds) && new Set(validation.value.productIds).size !== validation.value.productIds.length)
    return { ok: false, code: 'INVALID_ARGUMENT', message: '같은 상품을 중복 재작성할 수 없습니다.' };
  return enqueueAgentJob(userId, tool, validation.value);
}
/** Caller provides a server-authenticated account id, never an id from the request body. */
export function queueFailedMaterialRewrite(userId: string, args: Record<string, unknown>) { return queue(userId, MATERIALS_REWRITE_INPUT_SCHEMA, MATERIALS_REWRITE_QUEUE_TOOL, args); }
export function queueMaterialWorkflowRead(userId: string, args: Record<string, unknown>) {
  return queue(userId, MATERIALS_LIST_INPUT_SCHEMA,
    !args.jobId && args.sourceJobId ? { ...MATERIALS_LIST_QUEUE_TOOL, minAppVersion: MATERIALS_SOURCE_READ_MIN_APP } : MATERIALS_LIST_QUEUE_TOOL, args);
}

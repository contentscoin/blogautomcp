import { enqueueAgentJob } from '@/lib/agent-job-queue';
import { MATERIALS_REWRITE_INPUT_SCHEMA } from '@/lib/material-rewrite';
import { validateToolArguments } from '@/lib/tool-schema';

export const MATERIALS_REPAIR_MIN_APP = '1.3.99';
export const MATERIALS_REPAIR_INPUT_SCHEMA = MATERIALS_REWRITE_INPUT_SCHEMA;
export const MATERIALS_REPAIR_QUEUE_TOOL = { jobType: 'MATERIALS_REPAIR_BLOCKED', minAppVersion: MATERIALS_REPAIR_MIN_APP };

/** Repair only the missing/blocked parts of existing materials; never select a publication action. */
export function queueBlockedMaterialRepair(userId: string, args: Record<string, unknown>) {
  const validation = validateToolArguments(MATERIALS_REPAIR_INPUT_SCHEMA, args);
  if (!validation.ok) return Promise.resolve({ ok: false, code: 'INVALID_ARGUMENT', message: `인자를 확인하세요: ${validation.errors.slice(0, 5).join('; ')}` });
  if (Array.isArray(validation.value.productIds) && new Set(validation.value.productIds).size !== validation.value.productIds.length)
    return Promise.resolve({ ok: false, code: 'INVALID_ARGUMENT', message: '같은 소재를 중복 보완할 수 없습니다.' });
  return enqueueAgentJob(userId, MATERIALS_REPAIR_QUEUE_TOOL, validation.value);
}

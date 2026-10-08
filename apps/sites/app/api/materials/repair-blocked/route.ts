import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { getD1 } from '@/db';
import { apiError, hasTrustedBrowserOrigin, jsonValue, readObject } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rate-limit';
import { queueMaterialWorkflowRead } from '@/lib/material-rewrite';
import { queueBlockedMaterialRepair } from '@/lib/material-repair';
import { readCompletionResult } from '@/lib/completion-result';
import { sweepExpiredLeases } from '@/lib/jobs';

const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
type OwnedJob = { id: string; type: string; status: string; progress: number; stage: string | null; stageMessage: string | null; errorCode: string | null; errorMessage: string | null; resultJson: string | null };

async function readOwnedJob(userId: string, jobId: string): Promise<(OwnedJob & { result: unknown }) | null> {
  const d1 = getD1();
  await sweepExpiredLeases(d1, userId);
  const job = await d1.prepare(`SELECT id,type,status,progress,stage,stage_message AS stageMessage,error_code AS errorCode,error_message AS errorMessage,result_json AS resultJson FROM agent_jobs WHERE id=? AND user_id=? LIMIT 1`).bind(jobId, userId).first<OwnedJob>();
  if (!job || !['MATERIALS_REPAIR_BLOCKED', 'MATERIALS_LIST'].includes(job.type)) return null;
  return { ...job, result: jsonValue(await readCompletionResult(d1, userId, jobId, job.resultJson)) };
}

async function authenticatedAccount() {
  const identity = await getChatGPTUser();
  if (!identity) return { error: apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401) };
  const account = await ensureAccount(identity);
  if (!canUseMcp(account)) return { error: apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403) };
  return { account };
}

function response(data: JsonObject) {
  if (data.ok === false) {
    const code = String(data.code || 'REQUEST_FAILED');
    return apiError(code, String(data.message || '접수하지 못했습니다.'), code === 'INVALID_ARGUMENT' ? 422 : 409);
  }
  return NextResponse.json({ success: true, data }, { headers: HEADERS });
}

/** Browser callers never supply a user id, device id, job type or publication options. */
export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return apiError('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403);
  const auth = await authenticatedAccount();
  if (auth.error) return auth.error;
  const limit = await enforceRateLimit(getD1(), `materials-repair:user:${auth.account!.id}`, 12, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429);
  const body = await readObject(request, 16 * 1024);
  if (!body) return apiError('INVALID_REQUEST', '요청 형식을 확인하세요.', 400);
  return response(await queueBlockedMaterialRepair(auth.account!.id, body));
}

/** Polling an existing job is read only; it never queues a repair or another materials query. */
export async function GET(request: Request) {
  const auth = await authenticatedAccount();
  if (auth.error) return auth.error;
  const jobId = new URL(request.url).searchParams.get('jobId') || '';
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(jobId)) return apiError('INVALID_ARGUMENT', '작업번호를 확인하세요.', 422);
  let job: Awaited<ReturnType<typeof readOwnedJob>>;
  try { job = await readOwnedJob(auth.account!.id, jobId); }
  catch { return apiError('RESULT_INTEGRITY_FAILED', '저장 결과를 확인하지 못했습니다. 원 작업을 다시 실행하지 말고 전달 상태를 확인하세요.', 409); }
  if (!job) return apiError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
  // Avoid returning a manuscript, image payload or large material list to the progress widget.
  const envelope = object(job.result);
  const data = object(envelope.data);
  const localJob = object(data.job);
  const items = Array.isArray(localJob.items) ? localJob.items : Array.isArray(data.items) ? data.items : [];
  const count = (state: string) => items.filter(item => object(item).status === state).length;
  const workflowJobId = data.workflowJobId || localJob.id || data.jobId || envelope.workflowJobId;
  const workflowKnown = typeof data.workflowPending === 'boolean' || typeof localJob.status === 'string';
  const workflowPending = !workflowKnown || data.workflowPending === true || (typeof localJob.status === 'string' && ['queued', 'running'].includes(localJob.status.toLowerCase()));
  return NextResponse.json({ success: true, data: {
    jobId, status: job.status, progress: job.progress, stage: job.stage, stageMessage: job.stageMessage,
    errorCode: job.errorCode, errorMessage: job.errorMessage,
    workflowPending,
    workflowJobId: typeof workflowJobId === 'string' ? workflowJobId : null,
    readyCount: typeof data.readyCount === 'number' ? data.readyCount : count('ready'),
    failedCount: typeof data.failedCount === 'number' ? data.failedCount : count('failed'),
    interruptedCount: typeof data.interruptedCount === 'number' ? data.interruptedCount : count('interrupted'),
    summary: typeof envelope.summary === 'string' ? envelope.summary : null,
  } }, { headers: HEADERS });
}

/** One explicit read request, anchored to an owned repair, resumes verification observation. */
export async function PATCH(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return apiError('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403);
  const auth = await authenticatedAccount();
  if (auth.error) return auth.error;
  const body = await readObject(request, 4096);
  if (!body || Object.keys(body).some(key => !['repairJobId', 'idempotencyKey'].includes(key)) || typeof body.repairJobId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(body.repairJobId))
    return apiError('INVALID_ARGUMENT', '원래 보완 작업번호를 확인하세요.', 422);
  const limit = await enforceRateLimit(getD1(), `materials-repair-read:user:${auth.account!.id}`, 12, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429);
  let job: Awaited<ReturnType<typeof readOwnedJob>>;
  try { job = await readOwnedJob(auth.account!.id, body.repairJobId); }
  catch { return apiError('RESULT_INTEGRITY_FAILED', '저장 결과를 확인하지 못했습니다.', 409); }
  if (!job) return apiError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
  if (job.type !== 'MATERIALS_REPAIR_BLOCKED' || job.status !== 'SUCCEEDED') return apiError('JOB_NOT_FINISHED', '보완 접수 결과가 아직 준비되지 않았습니다.', 409);
  const envelope = object(job.result);
  const data = object(envelope.data);
  const workflowJobId = data.workflowJobId || object(data.job).id || data.jobId || envelope.workflowJobId;
  if (typeof workflowJobId !== 'string') return apiError('WORKFLOW_RESULT_UNAVAILABLE', '소재 작업번호를 확인하지 못했습니다. ChatGPT의 job_get으로 원 작업 결과를 확인하세요.', 409);
  return response(await queueMaterialWorkflowRead(auth.account!.id, { jobId: workflowJobId, sourceJobId: body.repairJobId, idempotencyKey: body.idempotencyKey }));
}

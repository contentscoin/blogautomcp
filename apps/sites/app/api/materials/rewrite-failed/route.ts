import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { getD1 } from '@/db';
import { hasTrustedBrowserOrigin, jsonValue, readObject } from '@/lib/http';
import { materialRecoveryRejection as apiError } from '@/lib/material-recovery-http';
import { materialRecoveryStatus } from '@/lib/material-recovery-status';
import { enforceRateLimit } from '@/lib/rate-limit';
import { queueFailedMaterialRewrite, queueMaterialWorkflowRead } from '@/lib/material-rewrite';
import { readCompletionResult } from '@/lib/completion-result';
import { sweepExpiredLeases } from '@/lib/jobs';

const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
type JsonObject = Record<string, unknown>;
type OwnedJob = { id: string; type: string; status: string; progress: number; stage: string | null; stageMessage: string | null; errorCode: string | null; errorMessage: string | null; resultJson: string | null; claimedAt: number | null; claimedDeviceId: string | null };

async function readOwnedJob(userId: string, jobId: string): Promise<(OwnedJob & { result: unknown }) | null> {
  const d1 = getD1();
  await sweepExpiredLeases(d1, userId);
  const job = await d1.prepare(`SELECT id,type,status,progress,stage,stage_message AS stageMessage,error_code AS errorCode,error_message AS errorMessage,result_json AS resultJson,claimed_at AS claimedAt,claimed_by_device_id AS claimedDeviceId FROM agent_jobs WHERE id=? AND user_id=? LIMIT 1`).bind(jobId, userId).first<OwnedJob>();
  if (!job || !['MATERIALS_REWRITE_FAILED', 'MATERIALS_LIST'].includes(job.type)) return null;
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
  const limit = await enforceRateLimit(getD1(), `materials-rewrite:user:${auth.account!.id}`, 12, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429);
  const body = await readObject(request, 16 * 1024);
  if (!body) return apiError('INVALID_REQUEST', '요청 형식을 확인하세요.', 400);
  return response(await queueFailedMaterialRewrite(auth.account!.id, body));
}

/** Polling an existing job is read only; it never queues a rewrite or another materials query. */
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
  return NextResponse.json({ success: true, data: {
    jobId, status: job.status, progress: job.progress, stage: job.stage, stageMessage: job.stageMessage,
    errorCode: job.errorCode, errorMessage: job.errorMessage,
    ...materialRecoveryStatus(job),
  } }, { headers: HEADERS });
}

/** One explicit read request, anchored to an owned rewrite, resumes verification observation. */
export async function PATCH(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return apiError('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403);
  const auth = await authenticatedAccount();
  if (auth.error) return auth.error;
  const body = await readObject(request, 4096);
  if (!body || Object.keys(body).some(key => !['rewriteJobId', 'idempotencyKey'].includes(key)) || typeof body.rewriteJobId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(body.rewriteJobId) || typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(body.idempotencyKey))
    return apiError('INVALID_ARGUMENT', '원래 재작성 작업번호를 확인하세요.', 422);
  const limit = await enforceRateLimit(getD1(), `materials-rewrite-read:user:${auth.account!.id}`, 12, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429);
  let job: Awaited<ReturnType<typeof readOwnedJob>>;
  try { job = await readOwnedJob(auth.account!.id, body.rewriteJobId); }
  catch { return apiError('RESULT_INTEGRITY_FAILED', '저장 결과를 확인하지 못했습니다.', 409); }
  if (!job) return apiError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
  if (job.type !== 'MATERIALS_REWRITE_FAILED' || !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) return apiError('JOB_NOT_FINISHED', '재작성 접수 결과가 아직 준비되지 않았습니다.', 409);
  const status = materialRecoveryStatus(job);
  if (status.executionNotAdmitted) return NextResponse.json({ success: true, data: { jobId: job.id, status: job.status, ...status } }, { headers: HEADERS });
  // A transport failure may still have started a PC workflow. Reconcile by the
  // owned source id when its reply was lost; this queues only a read, never a rewrite.
  return response(await queueMaterialWorkflowRead(auth.account!.id, {
    ...(status.workflowJobId ? { jobId: status.workflowJobId } : {}),
    sourceJobId: job.id, idempotencyKey: body.idempotencyKey,
  }));
}

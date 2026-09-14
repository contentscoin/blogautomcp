import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { newId } from '@/lib/crypto';
import { apiError, readObject } from '@/lib/http';
import { COMPLETION_BODY_MAX_BYTES, COMPLETION_INLINE_MAX_BYTES } from '@/lib/completion-contract';
import { completionReference, readCompletionResult } from '@/lib/completion-result';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  const body = await readObject(request, COMPLETION_BODY_MAX_BYTES);
  if (!body) return apiError('INVALID_REQUEST', '요청 형식 또는 크기를 확인하세요.', 400);
  const status = body.status === 'SUCCEEDED' ? 'SUCCEEDED' : body.status === 'FAILED' ? 'FAILED' : null;
  if (!status) return apiError('INVALID_STATUS', 'status는 SUCCEEDED 또는 FAILED여야 합니다.', 422);
  const reference = body.resultReference === undefined ? null : completionReference(body.resultReference);
  if (body.resultReference !== undefined && (!reference || body.result !== undefined || status !== 'SUCCEEDED')) return apiError('INVALID_RESULT_REFERENCE', '결과 참조 형식이 올바르지 않습니다.', 422);
  const resultJson = reference ? JSON.stringify({ completionReference: reference }) : status === 'SUCCEEDED' && body.result !== undefined ? JSON.stringify(body.result) : null;
  if (!reference && resultJson && new TextEncoder().encode(resultJson).byteLength > COMPLETION_INLINE_MAX_BYTES) return apiError('RESULT_UPLOAD_REQUIRED', '큰 결과는 result-chunk에 저장한 뒤 resultReference로 완료하세요.', 413);
  const errorCode = status === 'FAILED' && typeof body.errorCode === 'string' ? body.errorCode.trim().slice(0, 80) : null;
  const errorMessage = status === 'FAILED' && typeof body.errorMessage === 'string' ? body.errorMessage.trim().slice(0, 2000) : null;
  const { id } = await context.params;
  if (!/^job_[A-Za-z0-9_-]{16}$/.test(id)) return apiError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404);

  await ensureDatabase();
  const d1 = getD1();
  if (reference) {
    try { await readCompletionResult(d1, device.userId, id, resultJson); }
    catch { return apiError('RESULT_INTEGRITY_FAILED', '결과 조각이 누락되었거나 해시가 다릅니다. 저장된 동일 결과를 다시 전송하세요.', 422); }
  }
  const now = Date.now();
  const updated = await d1.prepare(`
    UPDATE agent_jobs
       SET status=?, progress=100, result_json=?, error_code=?, error_message=?, updated_at=?, finished_at=?, lease_until=NULL, stage='finished'
     WHERE id=? AND user_id=? AND claimed_by_device_id=? AND status='RUNNING'
       AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE')
  `).bind(status, resultJson, errorCode, errorMessage, now, now, id, device.userId, device.id, device.id).run();
  if (Number(updated.meta.changes || 0) !== 1) {
    // A committed response can be lost on the network. Accept only an identical
    // completion from the same still-active device; never overwrite a terminal job.
    const previous = await d1.prepare(`SELECT status,result_json AS resultJson,error_code AS errorCode,error_message AS errorMessage FROM agent_jobs WHERE id=? AND user_id=? AND claimed_by_device_id=? AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE') LIMIT 1`)
      .bind(id, device.userId, device.id, device.id)
      .first<{ status: string; resultJson: string | null; errorCode: string | null; errorMessage: string | null }>();
    if (previous && previous.status === status && previous.resultJson === resultJson && previous.errorCode === errorCode && previous.errorMessage === errorMessage) {
      return NextResponse.json({ success: true, data: { id, status, reused: true } }, { headers: { 'cache-control': 'no-store' } });
    }
    return apiError('JOB_NOT_ACTIVE', '완료할 수 있는 실행 중 작업이 아니거나 저장된 결과와 다릅니다. job_get으로 확인하세요.', 409);
  }

  await d1.batch([
    d1.prepare(`UPDATE devices SET last_seen_at=? WHERE id=? AND status='ACTIVE'`).bind(now, device.id),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), device.userId, device.userId, 'AGENT_JOB_COMPLETED', JSON.stringify({ jobId: id, status, errorCode }), now),
  ]);
  return NextResponse.json({ success: true, data: { id, status } }, { headers: { 'cache-control': 'no-store' } });
}

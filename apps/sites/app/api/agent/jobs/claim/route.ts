import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { apiError, jsonValue, readObject } from '@/lib/http';
import { JOB_LEASE_MS, sanitizeStatusSnapshot, sweepExpiredLeases } from '@/lib/jobs';

type QueuedJob = {
  id: string;
  type: string;
  inputJson: string;
  createdAt: number;
};
type ClaimedJob = QueuedJob & { status: string; errorCode: string | null; cancelRequested: number | null };
type ClaimOutcome = ClaimedJob & { assignmentId: string | null };
const CLAIM_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only capability detection: older Sites ignore unknown POST fields. */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  return NextResponse.json({ success: true, data: { claimProtocol: 'blogautomcp.claim/v2' } }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  await ensureDatabase();
  const d1 = getD1();
  const body = await readObject(request, 32 * 1024);
  if (!body) return apiError('INVALID_REQUEST', '작업 수신 요청은 크기 제한 내의 JSON 객체여야 합니다.', 400);
  const now = Date.now();
  if (body.claimRequestId !== undefined && (typeof body.claimRequestId !== 'string' || !CLAIM_REQUEST_ID.test(body.claimRequestId)))
    return apiError('INVALID_CLAIM_REQUEST', 'claimRequestId는 UUID여야 합니다.', 422);
  const claimRequestId = typeof body.claimRequestId === 'string' ? body.claimRequestId.toLowerCase() : null;
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim().slice(0, 40) : '';
  const statusJson = sanitizeStatusSnapshot(body.status);
  const heartbeat = await d1.prepare(
    `UPDATE devices SET last_seen_at=?, app_version=COALESCE(NULLIF(?, ''), app_version), status_json=COALESCE(?, status_json) WHERE id=? AND status='ACTIVE'`,
  ).bind(now, appVersion, statusJson, device.id).run();
  if (Number(heartbeat.meta.changes || 0) !== 1) return apiError('DEVICE_REVOKED', 'PC 인증이 폐기되었습니다.', 401);

  // 이 PC 가 예전에 잡았다가 응답이 끊긴 작업이 있으면 정리한다(임대 만료).
  await sweepExpiredLeases(d1, device.userId, now);

  const reply = (job: QueuedJob, reused = false) => NextResponse.json({
    success: true,
    data: { id: job.id, type: job.type, input: jsonValue(job.inputJson) || {}, createdAt: new Date(job.createdAt).toISOString(), leaseMs: JOB_LEASE_MS },
    ...(claimRequestId ? { claimRequestId, claimOutcome: 'job', claimReused: reused } : {}),
  }, { headers: { 'cache-control': 'no-store' } });
  if (claimRequestId) {
    // D1 batch is one transaction. Its immutable ledger row records BOTH assigned
    // and empty outcomes before acknowledgement. A delayed original POST cannot
    // claim a later job after a retry has already acknowledged this key as empty.
    const committed = await d1.batch<ClaimOutcome>([
      d1.prepare(`INSERT OR IGNORE INTO agent_claim_intents(user_id,device_id,request_id,job_id,created_at)
        SELECT ?,?,?,(SELECT id FROM agent_jobs WHERE user_id=? AND status='QUEUED' ORDER BY created_at ASC,id ASC LIMIT 1),?
        WHERE EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE')`)
        .bind(device.userId, device.id, claimRequestId, device.userId, now, device.id),
      d1.prepare(`UPDATE agent_jobs
        SET status='RUNNING',progress=1,claimed_by_device_id=?,claimed_at=?,updated_at=?,heartbeat_at=?,lease_until=?,stage='claimed',claim_request_id=?
        WHERE id=(SELECT job_id FROM agent_claim_intents WHERE user_id=? AND device_id=? AND request_id=?)
          AND user_id=? AND status='QUEUED'
          AND claimed_by_device_id IS NULL AND claim_request_id IS NULL
          AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE')`)
        .bind(device.id, now, now, now, now + JOB_LEASE_MS, claimRequestId, device.userId, device.id, claimRequestId, device.userId, device.id),
      d1.prepare(`SELECT c.job_id AS assignmentId,j.id,j.type,j.input_json AS inputJson,j.created_at AS createdAt,j.status,j.error_code AS errorCode,j.cancel_requested AS cancelRequested
        FROM agent_claim_intents c LEFT JOIN agent_jobs j
          ON j.id=c.job_id AND j.user_id=c.user_id AND j.claimed_by_device_id=c.device_id AND j.claim_request_id=c.request_id
        WHERE c.user_id=? AND c.device_id=? AND c.request_id=?
          AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE') LIMIT 1`)
        .bind(device.userId, device.id, claimRequestId, device.id),
    ]);
    const previous = committed[2]?.results?.[0];
    if (!previous) return apiError('CLAIM_STATE_CHANGED', '기기 또는 작업 배정 상태를 확인하지 못했습니다. 같은 claimRequestId를 보존하세요.', 409);
    if (previous.assignmentId === null) return NextResponse.json({ success: true, data: null,
      claimRequestId, claimResolved: true, claimOutcome: 'empty' }, { headers: { 'cache-control': 'no-store' } });
    if (!previous.id || !previous.status) return apiError('CLAIM_ASSIGNMENT_UNRESOLVED', '원 작업 배정을 확인하지 못했습니다. 새 작업을 요청하지 말고 같은 claimRequestId를 보존하세요.', 409);
    // A lost claim response is retried with the same durable PC intent. Returning
    // that exact assignment does not requeue it or authorize replay after execution.
    // The PC records execution-started before dispatch and never retries that state.
    if (previous.status === 'RUNNING' && Number(previous.cancelRequested || 0) !== 1) {
      // A delayed original must not shorten a newer same-key retry's lease.
      const renewalNow = Date.now();
      const renewed = await d1.prepare(`UPDATE agent_jobs SET updated_at=MAX(COALESCE(updated_at,0),?),heartbeat_at=MAX(COALESCE(heartbeat_at,0),?),lease_until=MAX(COALESCE(lease_until,0),?) WHERE id=? AND user_id=? AND claimed_by_device_id=? AND claim_request_id=? AND status='RUNNING' AND COALESCE(cancel_requested,0)=0 AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE')`)
        .bind(renewalNow, renewalNow, renewalNow + JOB_LEASE_MS, previous.id, device.userId, device.id, claimRequestId, device.id).run();
      if (Number(renewed.meta.changes || 0) === 1) return reply(previous, Number(committed[0]?.meta.changes || 0) !== 1);
      // A concurrent completion/cancellation/revocation won. The next same-intent
      // lookup can resolve it; never return an executable job from a stale row.
      return apiError('CLAIM_STATE_CHANGED', '작업 상태가 변경되었습니다. 새 작업을 요청하지 말고 같은 claimRequestId로 확인하세요.', 409);
    }
    return NextResponse.json({ success: true, data: null, claimRequestId, claimResolved: true, claimOutcome: 'job',
      claimedJob: { id: previous.id, type: previous.type, status: previous.status, errorCode: previous.errorCode, cancelRequested: Number(previous.cancelRequested || 0) === 1 } },
    { headers: { 'cache-control': 'no-store' } });
  }

  // Backward-compatible unkeyed claims. New PCs enable recovery only after GET v2.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await d1.prepare(`SELECT id,type,input_json AS inputJson,created_at AS createdAt FROM agent_jobs WHERE user_id=? AND status='QUEUED' ORDER BY created_at ASC LIMIT 1`).bind(device.userId).first<QueuedJob>();
    if (!next) return NextResponse.json({ success: true, data: null }, { headers: { 'cache-control': 'no-store' } });
    const claimed = await d1.prepare(`
      UPDATE agent_jobs
         SET status='RUNNING', progress=1, claimed_by_device_id=?, claimed_at=?, updated_at=?, heartbeat_at=?, lease_until=?, stage='claimed'
       WHERE id=? AND user_id=? AND status='QUEUED'
         AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE')
    `).bind(device.id, now, now, now, now + JOB_LEASE_MS, next.id, device.userId, device.id).run();
    if (Number(claimed.meta.changes || 0) === 1) {
      return reply(next);
    }
  }
  return NextResponse.json({ success: true, data: null }, { headers: { 'cache-control': 'no-store' } });
}

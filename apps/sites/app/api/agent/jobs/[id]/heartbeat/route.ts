import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { apiError, readObject } from '@/lib/http';
import { cleanStage, JOB_LEASE_MS, sanitizeStatusSnapshot } from '@/lib/jobs';

/**
 * 실행 중 작업 하트비트.
 *
 * 예전에는 작업 claim 이 유일한 하트비트라서, 초안 생성처럼 몇 분 걸리는 작업 동안
 * devices.last_seen_at 이 멈추고 90초 뒤 PC가 "오프라인"으로 뒤집혔다. 그 사이의
 * 모든 MCP 호출은 AGENT_OFFLINE 으로 거부됐다. 데스크톱은 작업을 실행하는 동안
 * 이 엔드포인트를 주기적으로 호출해 PC 생존, 임대 연장, 진행 단계를 함께 알린다.
 *
 * 응답의 active=false 는 작업이 더 이상 이 PC의 RUNNING 작업이 아니라는 뜻이고
 * cancelRequested=true 는 ChatGPT 가 취소를 요청했다는 뜻이다. 데스크톱은 이를 보고
 * 실행을 중단할 수 있다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  const { id } = await context.params;
  if (!/^job_[A-Za-z0-9_-]{16}$/.test(id)) return apiError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
  const body = (await readObject(request, 32 * 1024)) || {};
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim().slice(0, 40) : '';
  const rawProgress = typeof body.progress === 'number' && Number.isFinite(body.progress) ? Math.round(body.progress) : null;
  // claim=1, complete=100 을 보존하기 위해 하트비트 진행률은 1~99 로 제한한다.
  const progress = rawProgress === null ? null : Math.min(99, Math.max(1, rawProgress));
  const stage = cleanStage(body.stage);
  const stageMessage = cleanStage(body.message, 300);
  const statusJson = sanitizeStatusSnapshot(body.status);

  await ensureDatabase();
  const d1 = getD1();
  const now = Date.now();
  const seen = await d1.prepare(
    `UPDATE devices SET last_seen_at=?, app_version=COALESCE(NULLIF(?, ''), app_version), status_json=COALESCE(?, status_json) WHERE id=? AND status='ACTIVE'`,
  ).bind(now, appVersion, statusJson, device.id).run();
  if (Number(seen.meta.changes || 0) !== 1) return apiError('DEVICE_REVOKED', 'PC 인증이 폐기되었습니다.', 401);

  const updated = await d1.prepare(`
    UPDATE agent_jobs
       SET updated_at=?, heartbeat_at=?, lease_until=?,
           progress=COALESCE(?, progress), stage=COALESCE(?, stage), stage_message=COALESCE(?, stage_message)
     WHERE id=? AND user_id=? AND claimed_by_device_id=? AND status='RUNNING'
  `).bind(now, now, now + JOB_LEASE_MS, progress, stage, stageMessage, id, device.userId, device.id).run();
  const active = Number(updated.meta.changes || 0) === 1;
  const flags = active
    ? await d1.prepare(`SELECT cancel_requested AS cancelRequested FROM agent_jobs WHERE id=? LIMIT 1`).bind(id).first<{ cancelRequested: number }>()
    : null;
  return NextResponse.json(
    { success: true, data: { id, active, cancelRequested: Number(flags?.cancelRequested || 0) === 1, progress, leaseUntil: active ? new Date(now + JOB_LEASE_MS).toISOString() : null } },
    { headers: { 'cache-control': 'no-store' } },
  );
}

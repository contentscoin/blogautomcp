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

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  await ensureDatabase();
  const d1 = getD1();
  const now = Date.now();
  const body = (await readObject(request, 32 * 1024)) || {};
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim().slice(0, 40) : '';
  const statusJson = sanitizeStatusSnapshot(body.status);
  const heartbeat = await d1.prepare(
    `UPDATE devices SET last_seen_at=?, app_version=COALESCE(NULLIF(?, ''), app_version), status_json=COALESCE(?, status_json) WHERE id=? AND status='ACTIVE'`,
  ).bind(now, appVersion, statusJson, device.id).run();
  if (Number(heartbeat.meta.changes || 0) !== 1) return apiError('DEVICE_REVOKED', 'PC 인증이 폐기되었습니다.', 401);

  // 이 PC 가 예전에 잡았다가 응답이 끊긴 작업이 있으면 정리한다(임대 만료).
  await sweepExpiredLeases(d1, device.userId, now);

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
      return NextResponse.json({
        success: true,
        data: { id: next.id, type: next.type, input: jsonValue(next.inputJson) || {}, createdAt: new Date(next.createdAt).toISOString(), leaseMs: JOB_LEASE_MS },
      }, { headers: { 'cache-control': 'no-store' } });
    }
  }
  return NextResponse.json({ success: true, data: null }, { headers: { 'cache-control': 'no-store' } });
}

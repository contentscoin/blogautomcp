import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { apiError, readObject } from '@/lib/http';
import { COMPLETION_CHUNK_CHARS, COMPLETION_MAX_CHUNKS } from '@/lib/completion-contract';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  const body = await readObject(request, 1024 * 1024);
  if (!body || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256) ||
      !Number.isInteger(body.index) || Number(body.index) < 0 || Number(body.index) >= COMPLETION_MAX_CHUNKS ||
      typeof body.content !== 'string' || body.content.length > COMPLETION_CHUNK_CHARS) return apiError('INVALID_CHUNK', '결과 조각 형식이 올바르지 않습니다.', 422);
  const { id } = await context.params;
  if (!/^job_[A-Za-z0-9_-]{16}$/.test(id)) return apiError('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
  await ensureDatabase();
  const d1 = getD1();
  const owner = await d1.prepare("SELECT status FROM agent_jobs WHERE id=? AND user_id=? AND claimed_by_device_id=? AND status IN ('RUNNING','SUCCEEDED') AND EXISTS (SELECT 1 FROM devices WHERE id=? AND status='ACTIVE')")
    .bind(id, device.userId, device.id, device.id).first<{ status: string }>();
  if (!owner) return apiError('JOB_NOT_ACTIVE', '현재 기기의 실행 결과만 저장할 수 있습니다.', 409);
  // Same job may upload only one immutable result: retries cannot expand storage indefinitely.
  const first = await d1.prepare('SELECT result_hash AS hash FROM agent_job_result_chunks WHERE job_id=? LIMIT 1').bind(id).first<{ hash: string }>();
  if (first && first.hash !== body.sha256) return apiError('RESULT_CONFLICT', '이미 저장 중인 결과와 다릅니다.', 409);
  await d1.prepare('INSERT OR IGNORE INTO agent_job_result_chunks (job_id,user_id,result_hash,chunk_index,content,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM agent_job_result_chunks WHERE job_id=? AND result_hash<>?)')
    .bind(id, device.userId, body.sha256, body.index, body.content, Date.now(), id, body.sha256).run();
  const saved = await d1.prepare('SELECT content FROM agent_job_result_chunks WHERE job_id=? AND user_id=? AND result_hash=? AND chunk_index=?')
    .bind(id, device.userId, body.sha256, body.index).first<{ content: string }>();
  if (saved?.content !== body.content) return apiError('RESULT_CONFLICT', '결과 조각이 이전 요청과 다릅니다.', 409);
  return NextResponse.json({ success: true, data: { id, index: body.index } }, { headers: { 'cache-control': 'no-store' } });
}

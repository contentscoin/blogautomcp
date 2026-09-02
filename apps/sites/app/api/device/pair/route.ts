import { NextResponse } from 'next/server';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { hashToken, newId, randomToken } from '@/lib/crypto';
import { apiError, readObject } from '@/lib/http';
import { parseMcpUrl, resolveMcpConnection } from '@/lib/mcp';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  await ensureDatabase();
  const limit = await enforceRateLimit(getD1(), `pair:ip:${clientIp(request)}`, 10, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '페어링 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  const body = await readObject(request, 32 * 1024);
  if (!body) return apiError('INVALID_REQUEST', '요청 형식을 확인하세요.', 400);
  const mcpUrl = typeof body.mcpUrl === 'string' ? body.mcpUrl.trim() : '';
  const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim().slice(0, 80) : null;
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim().slice(0, 40) : null;
  if (!deviceName) return apiError('DEVICE_NAME_REQUIRED', 'PC 이름을 입력하세요.', 422);

  const expectedOrigin = new URL(request.url).origin;
  const credential = parseMcpUrl(mcpUrl, expectedOrigin);
  if (!credential) return apiError('INVALID_MCP_URL', '이 사이트에서 발급한 MCP URL인지 확인하세요.', 422);
  const connection = await resolveMcpConnection(credential.endpointId, credential.secret);
  if (!connection) return apiError('INVALID_MCP_URL', 'MCP URL이 유효하지 않거나 폐기되었습니다.', 401);

  await ensureDatabase();
  const d1 = getD1();
  const now = Date.now();
  const deviceId = newId('device');
  const deviceToken = randomToken(32);
  const tokenHash = await hashToken(deviceToken);
  const active = await d1.prepare(`SELECT COUNT(*) AS count FROM devices WHERE user_id=? AND status='ACTIVE'`).bind(connection.userId).first<{ count: number }>();

  await d1.batch([
    d1.prepare(`UPDATE devices SET status='REPLACED', revoked_at=? WHERE user_id=? AND status='ACTIVE'`).bind(now, connection.userId),
    d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', progress=100, error_code='DEVICE_REPLACED', error_message='새 PC가 인증되어 기존 PC 작업이 취소됨', updated_at=?, finished_at=? WHERE user_id=? AND status='RUNNING'`).bind(now, now, connection.userId),
    d1.prepare(`INSERT INTO devices (id,user_id,token_hash,name,platform,app_version,status,paired_at,last_seen_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?)`).bind(deviceId, connection.userId, tokenHash, deviceName, platform, appVersion, now, now),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), connection.userId, connection.userId, 'DEVICE_PAIRED', JSON.stringify({ deviceId, deviceName, platform, appVersion, replacedExisting: Number(active?.count || 0) > 0 }), now),
  ]);

  return NextResponse.json({
    success: true,
    data: { deviceId, deviceToken, pollIntervalMs: 3000 },
    message: '이 PC가 활성 장치로 연결되었습니다. 기존 PC 인증은 폐기되었습니다.',
  }, { status: 201, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

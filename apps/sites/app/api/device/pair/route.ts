import { NextResponse } from 'next/server';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { apiError, readObject } from '@/lib/http';
import { parseMcpUrl, resolveMcpConnection } from '@/lib/mcp';
import { hashPairCode, normalizePairCode, pairDeviceForUser } from '@/lib/pairing';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';

/**
 * PC 장치 페어링. 두 경로를 지원한다.
 * - pairCode: 사이트 "PC 앱 연결" 버튼이 발급한 일회성 코드(기본 경로, 딥링크/수동 입력)
 * - mcpUrl: 발급받은 MCP URL 붙여넣기(구버전 앱 호환)
 * 어느 경로든 같은 배치로 기존 PC 를 원자 교체한다.
 */
export async function POST(request: Request) {
  await ensureDatabase();
  const d1 = getD1();
  const limit = await enforceRateLimit(d1, `pair:ip:${clientIp(request)}`, 10, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '페어링 시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  const body = await readObject(request, 32 * 1024);
  if (!body) return apiError('INVALID_REQUEST', '요청 형식을 확인하세요.', 400);
  const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim().slice(0, 80) : null;
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim().slice(0, 40) : null;
  if (!deviceName) return apiError('DEVICE_NAME_REQUIRED', 'PC 이름을 입력하세요.', 422);

  let userId: string | null = null;
  let method: 'mcp-url' | 'pair-code';
  if (typeof body.pairCode === 'string' && body.pairCode.trim()) {
    method = 'pair-code';
    const code = normalizePairCode(body.pairCode);
    if (!code) return apiError('INVALID_PAIR_CODE', '연결 코드는 8자입니다. 사이트에 표시된 코드를 다시 확인하세요.', 422);
    const codeHash = await hashPairCode(code);
    const now = Date.now();
    // 원자적 소진: 만료 전·미사용 코드만 사용 처리되고, changes==1 일 때만 계속한다.
    const consumed = await d1.prepare(`UPDATE pair_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?`).bind(now, codeHash, now).run();
    if (Number(consumed.meta.changes || 0) !== 1) return apiError('INVALID_PAIR_CODE', '연결 코드가 틀렸거나 만료되었습니다. 사이트에서 코드를 다시 발급하세요.', 401);
    const row = await d1.prepare(`
      SELECT p.user_id AS userId
        FROM pair_codes p
        JOIN users u ON u.id = p.user_id
       WHERE p.code_hash=? AND u.status='APPROVED' AND u.role IN ('USER','ADMIN')
         AND EXISTS (SELECT 1 FROM mcp_connections m WHERE m.user_id=p.user_id AND m.status='ACTIVE')
       LIMIT 1
    `).bind(codeHash).first<{ userId: string }>();
    if (!row) return apiError('NOT_APPROVED', '승인된 계정의 활성 MCP 연결이 아닙니다. 사이트에서 MCP 주소를 먼저 발급하세요.', 403);
    userId = row.userId;
  } else {
    method = 'mcp-url';
    const mcpUrl = typeof body.mcpUrl === 'string' ? body.mcpUrl.trim() : '';
    const expectedOrigin = new URL(request.url).origin;
    const credential = parseMcpUrl(mcpUrl, expectedOrigin);
    if (!credential) return apiError('INVALID_MCP_URL', '이 사이트에서 발급한 MCP URL인지 확인하세요.', 422);
    const connection = await resolveMcpConnection(credential.endpointId, credential.secret);
    if (!connection) return apiError('INVALID_MCP_URL', 'MCP URL이 유효하지 않거나 폐기되었습니다.', 401);
    userId = connection.userId;
  }

  const paired = await pairDeviceForUser(d1, userId, { deviceName, platform, appVersion, method });
  return NextResponse.json({
    success: true,
    data: { deviceId: paired.deviceId, deviceToken: paired.deviceToken, pollIntervalMs: 3000, method },
    message: paired.replacedExisting ? '이 PC가 활성 장치로 연결되었습니다. 기존 PC 인증은 폐기되었습니다.' : '이 PC가 활성 장치로 연결되었습니다.',
  }, { status: 201, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

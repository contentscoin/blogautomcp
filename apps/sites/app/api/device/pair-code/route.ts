import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { hashToken, newId, randomToken } from '@/lib/crypto';
import { apiError, hasTrustedBrowserOrigin } from '@/lib/http';
import { buildPairDeepLink, generatePairCode, hashPairCode, PAIR_CODE_TTL_MS } from '@/lib/pairing';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * PC 앱 연결용 일회성 페어 코드 발급.
 *
 * 예전에는 사용자가 같은 MCP URL 을 ChatGPT 와 PC 앱에 두 번 붙여넣어야 했다. 이제 사이트의
 * "PC 앱 연결" 버튼이 코드를 발급하고 딥링크(blogautomcp://pair)로 앱에 넘긴다. 코드는 해시만
 * 저장하고 90초 뒤 만료되며 한 번만 쓸 수 있다. MCP URL 붙여넣기 경로는 구버전 호환으로 남는다.
 */
export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return apiError('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403);
  const identity = await getChatGPTUser();
  if (!identity) return apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401);
  const account = await ensureAccount(identity);
  if (!canUseMcp(account)) return apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403);

  await ensureDatabase();
  const d1 = getD1();
  const limit = await enforceRateLimit(d1, `pair-code:user:${account.id}`, 5, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', '연결 코드 발급이 너무 잦습니다. 잠시 후 다시 시도하세요.', 429);
  const code = generatePairCode();
  const codeHash = await hashPairCode(code);
  const now = Date.now();
  const expiresAt = now + PAIR_CODE_TTL_MS;
  const secretHash = await hashToken(randomToken(32));
  const issued = await d1.batch([
    // Prepare only an absent PC channel. Never rotate or reactivate an existing one.
    d1.prepare(`INSERT INTO mcp_connections(id,user_id,endpoint_id,secret_hash,generation,status,created_at)
      SELECT ?,?,?,?,1,'ACTIVE',? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND status='APPROVED' AND role IN ('USER','ADMIN'))
      ON CONFLICT(user_id) DO NOTHING`).bind(newId('mcp'), account.id, randomToken(15), secretHash, now, account.id),
    d1.prepare(`INSERT INTO pair_codes (id,user_id,code_hash,expires_at,used_at,created_at)
      SELECT ?,?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM users u JOIN mcp_connections m ON m.user_id=u.id
        WHERE u.id=? AND u.status='APPROVED' AND u.role IN ('USER','ADMIN') AND m.status='ACTIVE')`)
      .bind(newId('pair'), account.id, codeHash, expiresAt, now, account.id),
    d1.prepare(`DELETE FROM pair_codes WHERE expires_at < ?`).bind(now - 24 * 60 * 60 * 1000),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM pair_codes WHERE user_id=? AND code_hash=?)`)
      .bind(newId('audit'), account.id, account.id, 'PAIR_CODE_ISSUED', JSON.stringify({ expiresAt }), now, account.id, codeHash),
  ]);
  if (Number(issued[1]?.meta.changes || 0) !== 1) return apiError('PC_CHANNEL_UNAVAILABLE', '승인 계정의 활성 PC 연결을 확인할 수 없습니다. 정지된 연결은 관리자가 확인해야 합니다.', 403);
  const channel = await d1.prepare('SELECT generation FROM mcp_connections WHERE user_id=? AND status=\'ACTIVE\'').bind(account.id).first<{ generation: number }>();
  if (!channel) return apiError('PC_CHANNEL_UNAVAILABLE', '활성 PC 연결을 확인할 수 없습니다.', 403);
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    success: true,
    data: { code, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: Math.round(PAIR_CODE_TTL_MS / 1000), deepLink: buildPairDeepLink(origin, code), siteUrl: origin, generation: channel.generation },
    message: '90초 안에 PC 앱에서 이 코드를 사용하세요.',
  }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

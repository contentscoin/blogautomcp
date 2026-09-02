import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { newId } from '@/lib/crypto';
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
  const connection = await d1.prepare(`SELECT id FROM mcp_connections WHERE user_id=? AND status='ACTIVE' LIMIT 1`).bind(account.id).first<{ id: string }>();
  if (!connection) return apiError('MCP_NOT_ISSUED', '먼저 MCP 주소를 발급하세요. PC 는 MCP 연결에 묶여 동작합니다.', 409);

  const code = generatePairCode();
  const codeHash = await hashPairCode(code);
  const now = Date.now();
  const expiresAt = now + PAIR_CODE_TTL_MS;
  await d1.batch([
    // 사용자당 살아 있는 코드는 하나만 둔다(이전 미사용 코드 만료 처리).
    d1.prepare(`UPDATE pair_codes SET used_at=? WHERE user_id=? AND used_at IS NULL`).bind(now, account.id),
    d1.prepare(`INSERT INTO pair_codes (id,user_id,code_hash,expires_at,used_at,created_at) VALUES (?,?,?,?,NULL,?)`).bind(newId('pair'), account.id, codeHash, expiresAt, now),
    d1.prepare(`DELETE FROM pair_codes WHERE expires_at < ?`).bind(now - 24 * 60 * 60 * 1000),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), account.id, account.id, 'PAIR_CODE_ISSUED', JSON.stringify({ expiresAt }), now),
  ]);
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    success: true,
    data: { code, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds: Math.round(PAIR_CODE_TTL_MS / 1000), deepLink: buildPairDeepLink(origin, code), siteUrl: origin },
    message: '90초 안에 PC 앱에서 이 코드를 사용하세요.',
  }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

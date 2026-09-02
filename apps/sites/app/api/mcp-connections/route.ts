import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { ensureDatabase } from '@/db/init';
import { getD1, getDb } from '@/db';
import { mcpConnections } from '@/db/schema';
import { hashToken, newId, randomToken } from '@/lib/crypto';
import { apiError, hasTrustedBrowserOrigin, readObject } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401);
  const account = await ensureAccount(identity);
  if (!canUseMcp(account)) return apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403);
  const [connection] = await getDb().select({ generation: mcpConnections.generation, createdAt: mcpConnections.createdAt }).from(mcpConnections).where(and(eq(mcpConnections.userId, account.id), eq(mcpConnections.status, 'ACTIVE'))).limit(1);
  return NextResponse.json({ success: true, data: { exists: Boolean(connection), generation: connection?.generation || 0, createdAt: connection?.createdAt || null } }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return apiError('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403);
  const identity = await getChatGPTUser();
  if (!identity) return apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401);
  const account = await ensureAccount(identity);
  if (!canUseMcp(account)) return apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403);
  const body = await readObject(request);
  if (!body || !['issue', 'rotate'].includes(String(body.action || ''))) return apiError('INVALID_REQUEST', '발급 요청을 확인하세요.', 400);
  await ensureDatabase();
  const d1 = getD1();
  const limit = await enforceRateLimit(d1, `mcp-issue:user:${account.id}`, 5, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', 'MCP 주소 발급 요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  const current = await d1.prepare('SELECT generation FROM mcp_connections WHERE user_id = ? AND status = ? LIMIT 1').bind(account.id, 'ACTIVE').first<{ generation: number }>();
  const now = Date.now();
  const endpointId = randomToken(15);
  const secret = randomToken(32);
  const secretHash = await hashToken(secret);
  const generation = (current?.generation || 0) + 1;
  await d1.batch([
    d1.prepare(`INSERT INTO mcp_connections (id,user_id,endpoint_id,secret_hash,generation,status,created_at,rotated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id, endpoint_id=excluded.endpoint_id, secret_hash=excluded.secret_hash, generation=excluded.generation, status='ACTIVE', rotated_at=excluded.rotated_at`).bind(newId('mcp'), account.id, endpointId, secretHash, generation, now, current ? now : null),
    d1.prepare(`UPDATE devices SET status='REVOKED', revoked_at=? WHERE user_id=? AND status='ACTIVE'`).bind(now, account.id),
    d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', error_code='MCP_ROTATED', error_message='MCP 주소 재발급으로 취소됨', updated_at=?, finished_at=? WHERE user_id=? AND status IN ('QUEUED','RUNNING')`).bind(now, now, account.id),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), account.id, account.id, current ? 'MCP_ROTATED' : 'MCP_ISSUED', JSON.stringify({ generation }), now),
  ]);
  const origin = new URL(request.url).origin;
  return NextResponse.json({ success: true, data: { mcpUrl: `${origin}/api/mcp/${endpointId}.${secret}`, generation }, message: '이 주소는 닫으면 다시 볼 수 없습니다.' }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

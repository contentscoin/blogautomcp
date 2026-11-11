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
  const expectedAccount = request.headers.get('x-blogauto-account-id');
  if (expectedAccount !== null && expectedAccount !== account.id) return apiError('ACCOUNT_CHANGED', '로그인 계정이 변경되었습니다. 페이지를 새로 열어 본인 계정을 확인하세요.', 409);
  if (!canUseMcp(account)) return apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403);
  const body = await readObject(request);
  if (!body || !['issue', 'rotate'].includes(String(body.action || ''))) return apiError('INVALID_REQUEST', '발급 요청을 확인하세요.', 400);
  await ensureDatabase();
  const d1 = getD1();
  const limit = await enforceRateLimit(d1, `mcp-issue:user:${account.id}`, 5, 60_000);
  if (!limit.allowed) return apiError('RATE_LIMITED', 'MCP 주소 발급 요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  const now = Date.now();
  const endpointId = randomToken(15);
  const secret = randomToken(32);
  const secretHash = await hashToken(secret);
  if (body.action === 'issue') {
    // A stale first-time tab must never turn issuance into an implicit rotation.
    const connectionId = newId('mcp');
    const issued = await d1.batch([
      d1.prepare(`INSERT INTO mcp_connections (id,user_id,endpoint_id,secret_hash,generation,status,created_at)
        SELECT ?,?,?,?,1,'ACTIVE',? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND status='APPROVED' AND role IN ('USER','ADMIN'))
        ON CONFLICT(user_id) DO NOTHING`).bind(connectionId, account.id, endpointId, secretHash, now, account.id),
      d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at)
        SELECT ?,?,?,'MCP_ISSUED','{"generation":1}',? WHERE EXISTS (SELECT 1 FROM mcp_connections WHERE id=? AND user_id=?)`)
        .bind(newId('audit'), account.id, account.id, now, connectionId, account.id),
    ]);
    if (Number(issued[0]?.meta.changes || 0) !== 1) return apiError('PC_CHANNEL_EXISTS', 'PC 연결이 이미 있거나 계정 상태가 변경되었습니다. 연결 상태를 확인하세요. 기존 PC는 변경하지 않았습니다.', 409);
    const origin = new URL(request.url).origin;
    return NextResponse.json({ success: true, data: { mcpUrl: `${origin}/api/mcp/${endpointId}.${secret}`, generation: 1 }, message: '이 주소는 닫으면 다시 볼 수 없습니다.' }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  const connectionId = newId('mcp');
  const rotatedHere = `EXISTS (SELECT 1 FROM mcp_connections WHERE id=? AND user_id=?)`;
  const rotated = await d1.batch([
    d1.prepare(`INSERT INTO mcp_connections (id,user_id,endpoint_id,secret_hash,generation,status,created_at,rotated_at)
      SELECT ?,?,?,?,1,'ACTIVE',?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND status='APPROVED' AND role IN ('USER','ADMIN'))
      ON CONFLICT(user_id) DO UPDATE SET id=excluded.id, endpoint_id=excluded.endpoint_id, secret_hash=excluded.secret_hash,
        generation=mcp_connections.generation+1, status='ACTIVE', rotated_at=excluded.rotated_at`)
      .bind(connectionId, account.id, endpointId, secretHash, now, now, account.id),
    d1.prepare(`UPDATE devices SET status='REVOKED', revoked_at=? WHERE user_id=? AND status='ACTIVE' AND ${rotatedHere}`).bind(now, account.id, connectionId, account.id),
    d1.prepare(`UPDATE pair_codes SET used_at=? WHERE user_id=? AND used_at IS NULL AND ${rotatedHere}`).bind(now, account.id, connectionId, account.id),
    d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', error_code='MCP_ROTATED', error_message='MCP 주소 재발급으로 취소됨', updated_at=?, finished_at=? WHERE user_id=? AND status IN ('QUEUED','RUNNING') AND ${rotatedHere}`).bind(now, now, account.id, connectionId, account.id),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at)
      SELECT ?,?,?,'MCP_ROTATED',json_object('generation',generation),? FROM mcp_connections WHERE id=? AND user_id=?`)
      .bind(newId('audit'), account.id, account.id, now, connectionId, account.id),
    d1.prepare(`SELECT generation FROM mcp_connections WHERE id=? AND user_id=?`).bind(connectionId, account.id),
  ]);
  if (Number(rotated[0]?.meta.changes || 0) !== 1) return apiError('NOT_APPROVED', '계정 승인이 변경되어 재발급하지 않았습니다.', 403);
  const generation = Number((rotated[5]?.results?.[0] as { generation: number } | undefined)?.generation);
  const origin = new URL(request.url).origin;
  return NextResponse.json({ success: true, data: { mcpUrl: `${origin}/api/mcp/${endpointId}.${secret}`, generation }, message: '이 주소는 닫으면 다시 볼 수 없습니다.' }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, isAdmin } from '@/lib/account';
import { ensureDatabase } from '@/db/init';
import { getD1, getDb } from '@/db';
import { users } from '@/db/schema';
import { newId } from '@/lib/crypto';
import { apiError, hasTrustedBrowserOrigin, readObject } from '@/lib/http';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return apiError('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403);
  const identity = await getChatGPTUser();
  if (!identity) return apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401);
  const admin = await ensureAccount(identity);
  if (!isAdmin(admin)) return apiError('FORBIDDEN', '관리자 권한이 필요합니다.', 403);
  const body = await readObject(request);
  const status = String(body?.status || '');
  if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) return apiError('INVALID_STATUS', '지원하지 않는 상태입니다.', 400);
  const { id } = await context.params;
  if (!id || id.length > 160) return apiError('NOT_FOUND', '사용자를 찾을 수 없습니다.', 404);
  await ensureDatabase();
  const [target] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return apiError('NOT_FOUND', '사용자를 찾을 수 없습니다.', 404);
  if (target.role === 'ADMIN') return apiError('ADMIN_LOCKED', '관리자 계정 상태는 변경할 수 없습니다.', 409);
  const now = Date.now();
  const d1 = getD1();
  const statements = [
    d1.prepare('UPDATE users SET status=?, updated_at=? WHERE id=?').bind(status, now, id),
    d1.prepare('INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)').bind(newId('audit'), admin.id, id, 'USER_STATUS_CHANGED', JSON.stringify({ status }), now),
  ];
  if (status !== 'APPROVED') {
    statements.push(d1.prepare(`UPDATE devices SET status='REVOKED', revoked_at=? WHERE user_id=? AND status='ACTIVE'`).bind(now, id));
    statements.push(d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', error_code='ACCOUNT_DISABLED', error_message='계정 상태 변경으로 취소됨', updated_at=?, finished_at=? WHERE user_id=? AND status IN ('QUEUED','RUNNING')`).bind(now, now, id));
  }
  await d1.batch(statements);
  return NextResponse.json({ success: true, data: { id, status } }, { headers: { 'cache-control': 'no-store' } });
}

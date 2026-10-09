import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { canUseMcp, ensureAccount } from '@/lib/account';
import { apiError } from '@/lib/http';
import { readConnectionStatus } from '@/lib/connection-status';

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401);
  const account = await ensureAccount(identity);
  if (!canUseMcp(account)) return apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403);
  return NextResponse.json({ success: true, data: await readConnectionStatus(account.id) }, { headers: { 'cache-control': 'no-store' } });
}

import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { canUseMcp, ensureAccount } from '@/lib/account';
import { apiError } from '@/lib/http';
import { readConnectionStatus } from '@/lib/connection-status';

export async function GET(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return apiError('UNAUTHENTICATED', 'ChatGPT 로그인이 필요합니다.', 401);
  const account = await ensureAccount(identity);
  const expectedAccount = request.headers.get('x-blogauto-account-id');
  if (expectedAccount !== null && expectedAccount !== account.id) return apiError('ACCOUNT_CHANGED', '로그인 계정이 변경되었습니다. 페이지를 새로 열어 본인 계정을 확인하세요.', 409);
  if (!canUseMcp(account)) return apiError('NOT_APPROVED', '관리자 승인이 필요합니다.', 403);
  return NextResponse.json({ success: true, accountId: account.id, data: await readConnectionStatus(account.id) }, { headers: { 'cache-control': 'no-store' } });
}

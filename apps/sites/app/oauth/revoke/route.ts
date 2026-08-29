import { NextResponse } from 'next/server';
import { revokeOAuthToken } from '@/lib/oauth';

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) return response();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32 * 1024) return response();
  const form = new URLSearchParams(await request.text());
  await revokeOAuthToken(form.get('token') || '', form.get('client_id') || '');
  return response();
}

function response() {
  return new NextResponse(null, { status: 200, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
}

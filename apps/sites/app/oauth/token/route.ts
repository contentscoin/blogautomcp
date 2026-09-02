import { NextResponse } from 'next/server';
import { exchangeAuthorizationCode, exchangeRefreshToken, trustedSiteOrigin } from '@/lib/oauth';

const HEADERS = { 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff' };

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) return oauthError('invalid_request', 400);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32 * 1024) return oauthError('invalid_request', 400);
  const form = new URLSearchParams(await request.text());
  const grantType = form.get('grant_type');
  const origin = trustedSiteOrigin(request);
  if (!origin) return oauthError('invalid_request', 400);
  const token = grantType === 'authorization_code'
    ? await exchangeAuthorizationCode(form, origin)
    : grantType === 'refresh_token'
      ? await exchangeRefreshToken(form, origin)
      : null;
  if (!token) return oauthError(grantType ? 'invalid_grant' : 'invalid_request', 400);
  return NextResponse.json(token, { headers: HEADERS });
}

function oauthError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

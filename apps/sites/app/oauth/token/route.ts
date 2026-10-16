import { NextResponse } from 'next/server';
import { exchangeAuthorizationCode, exchangeRefreshToken, isSupportedOAuthClient, readOAuthForm, trustedSiteOrigin } from '@/lib/oauth';

const HEADERS = { 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff' };

export async function POST(request: Request) {
  const form = await readOAuthForm(request);
  if (!form || ['grant_type', 'client_id', 'resource', 'code', 'code_verifier', 'redirect_uri', 'refresh_token', 'scope'].some(key => form.getAll(key).length > 1)) return oauthError('invalid_request', 400);
  const grantType = form.get('grant_type');
  const origin = trustedSiteOrigin(request);
  if (!origin) return oauthError('invalid_request', 400);
  if (!grantType) return oauthError('invalid_request', 400);
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') return oauthError('unsupported_grant_type', 400);
  if (!isSupportedOAuthClient(form.get('client_id')) || request.headers.has('authorization') || ['client_secret', 'client_assertion', 'client_assertion_type'].some(key => form.has(key))) return oauthError('invalid_client', 400);
  try {
    const token = grantType === 'authorization_code'
      ? await exchangeAuthorizationCode(form, origin)
      : await exchangeRefreshToken(form, origin);
    if (!token) return oauthError('invalid_grant', 400);
    return NextResponse.json(token, { headers: HEADERS });
  } catch {
    return oauthError('server_error', 500);
  }
}

function oauthError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

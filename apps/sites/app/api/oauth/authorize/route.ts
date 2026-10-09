import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { hasTrustedBrowserOrigin } from '@/lib/http';
import { authorizationErrorCallback, issueAuthorizationCode, oauthIssuer, parseAuthorizationRequest, readOAuthForm, trustedSiteOrigin, validateChatGPTClientMetadata, type AuthorizationError } from '@/lib/oauth';

const HEADERS = { 'cache-control': 'no-store', pragma: 'no-cache', 'referrer-policy': 'no-referrer' };

function errorResponse(origin: string, form: URLSearchParams | null, error: AuthorizationError, status: number) {
  const callback = form && authorizationErrorCallback(form, origin, error);
  return callback ? NextResponse.redirect(callback, { status: 303, headers: HEADERS })
    : NextResponse.json({ error, iss: oauthIssuer(origin) }, { status, headers: HEADERS });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'invalid_request' }, { status: 403 });
  const origin = trustedSiteOrigin(request);
  if (!origin) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: HEADERS });
  const form = await readOAuthForm(request);
  if (!form) return errorResponse(origin, null, 'invalid_request', 400);
  const parsed = parseAuthorizationRequest(form, origin);
  if (!parsed.ok) return errorResponse(origin, form, parsed.errorCode, 400);
  if (!await validateChatGPTClientMetadata()) return errorResponse(origin, form, 'temporarily_unavailable', 503);
  try {
    const identity = await getChatGPTUser();
    if (!identity) return errorResponse(origin, form, 'access_denied', 401);
    const account = await ensureAccount(identity);
    if (!canUseMcp(account)) return errorResponse(origin, form, 'access_denied', 403);
    const code = await issueAuthorizationCode(account.id, parsed.value);
    const target = new URL(parsed.value.redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', parsed.value.state);
    target.searchParams.set('iss', oauthIssuer(origin));
    return NextResponse.redirect(target, { status: 303, headers: HEADERS });
  } catch {
    return errorResponse(origin, form, 'server_error', 500);
  }
}

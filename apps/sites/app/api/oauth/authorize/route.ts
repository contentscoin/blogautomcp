import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { hasTrustedBrowserOrigin } from '@/lib/http';
import { issueAuthorizationCode, oauthIssuer, parseAuthorizationRequest, trustedSiteOrigin } from '@/lib/oauth';

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'invalid_request' }, { status: 403 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32 * 1024) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const identity = await getChatGPTUser();
  if (!identity) return NextResponse.json({ error: 'login_required' }, { status: 401 });
  const account = await ensureAccount(identity);
  if (!canUseMcp(account)) return NextResponse.json({ error: 'access_denied' }, { status: 403 });

  const form = new URLSearchParams(await request.text());
  const origin = trustedSiteOrigin(request);
  if (!origin) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const parsed = parseAuthorizationRequest(form, origin);
  if (!parsed.ok) return NextResponse.json({ error: 'invalid_request', error_description: parsed.error }, { status: 400 });
  const code = await issueAuthorizationCode(account.id, parsed.value);
  const target = new URL(parsed.value.redirectUri);
  target.searchParams.set('code', code);
  target.searchParams.set('state', parsed.value.state);
  target.searchParams.set('iss', oauthIssuer(origin));
  return NextResponse.redirect(target, 303);
}

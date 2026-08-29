import { NextResponse } from 'next/server';
import { handleMcpRequest } from './[credential]/route';
import { authenticateMcpOAuth, mcpResource, trustedSiteOrigin } from '@/lib/oauth';

const RESPONSE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };

export async function POST(request: Request) {
  const identity = await authenticateMcpOAuth(request);
  if (!identity) return oauthChallenge(request);
  return handleMcpRequest(request, identity.userId, identity.scope);
}

export function GET(request: Request) {
  return oauthChallenge(request);
}

function oauthChallenge(request: Request) {
  const origin = trustedSiteOrigin(request);
  if (!origin) return NextResponse.json({ error: 'invalid_origin' }, { status: 400, headers: RESPONSE_HEADERS });
  const metadata = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
  return NextResponse.json({
    error: 'unauthorized',
    error_description: 'ChatGPT에서 이 MCP 앱을 연결해 주세요.',
  }, {
    status: 401,
    headers: {
      ...RESPONSE_HEADERS,
      'www-authenticate': `Bearer resource_metadata="${metadata}", resource="${mcpResource(origin)}", scope="mcp:read mcp:write offline_access"`,
    },
  });
}

import { NextResponse } from 'next/server';
import { DEFAULT_OAUTH_SCOPE, mcpResource, oauthIssuer, trustedSiteOrigin } from '@/lib/oauth';

export async function GET(request: Request, context: { params: Promise<{ wellKnown: string[] }> }) {
  const { wellKnown } = await context.params;
  const path = `/${wellKnown.join('/')}`;
  const origin = trustedSiteOrigin(request);
  if (!origin) return NextResponse.json({ error: 'invalid_origin' }, { status: 400 });
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/api/mcp') {
    return NextResponse.json({
      resource: mcpResource(origin),
      authorization_servers: [oauthIssuer(origin)],
      scopes_supported: DEFAULT_OAUTH_SCOPE.split(' '),
      resource_documentation: `${origin}/dashboard`,
    }, { headers: { 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  }
  if (path === '/.well-known/oauth-authorization-server') {
    return NextResponse.json({
      issuer: oauthIssuer(origin),
      authorization_response_iss_parameter_supported: true,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: DEFAULT_OAUTH_SCOPE.split(' '),
    }, { headers: { 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  }
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

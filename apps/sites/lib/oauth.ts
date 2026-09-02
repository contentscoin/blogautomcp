import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { hashToken, randomToken, safeEqualText } from '@/lib/crypto';

export const OAUTH_SCOPES = ['mcp:read', 'mcp:write', 'offline_access'] as const;
export const DEFAULT_OAUTH_SCOPE = OAUTH_SCOPES.join(' ');
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const PRODUCTION_SITE_ORIGIN = 'https://blogautomcp.hiway350051.chatgpt.site';

type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  responseType: 'code';
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  resource: string;
  scope: string;
  state: string;
};

export type OAuthIdentity = {
  userId: string;
  email: string;
  scope: string;
};

export function mcpResource(origin: string): string {
  return `${origin}/api/mcp`;
}

export function oauthIssuer(origin: string): string {
  return origin;
}

export function trustedSiteOrigin(request: Request): string | null {
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (url.origin === PRODUCTION_SITE_ORIGIN) return PRODUCTION_SITE_ORIGIN;
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;
  return null;
}

export function trustedSiteOriginValue(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin === PRODUCTION_SITE_ORIGIN) return PRODUCTION_SITE_ORIGIN;
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;
  } catch { /* invalid URL */ }
  return null;
}

export function parseAuthorizationRequest(
  input: URLSearchParams,
  origin: string,
): { ok: true; value: AuthorizationRequest } | { ok: false; error: string } {
  const clientId = input.get('client_id') || '';
  const redirectUri = input.get('redirect_uri') || '';
  const responseType = input.get('response_type') || '';
  const codeChallenge = input.get('code_challenge') || '';
  const codeChallengeMethod = input.get('code_challenge_method') || '';
  const resource = input.get('resource') || '';
  const state = input.get('state') || '';
  const scopeResult = normalizeScope(input.get('scope'));

  if (clientId !== CHATGPT_CLIENT_ID) return { ok: false, error: '지원하지 않는 OAuth 클라이언트입니다.' };
  if (redirectUri !== CHATGPT_REDIRECT_URI) return { ok: false, error: '허용되지 않은 OAuth 콜백 주소입니다.' };
  if (responseType !== 'code') return { ok: false, error: 'response_type은 code여야 합니다.' };
  if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return { ok: false, error: 'PKCE S256 code_challenge가 필요합니다.' };
  }
  if (resource !== mcpResource(origin)) return { ok: false, error: 'MCP resource가 일치하지 않습니다.' };
  if (!state || state.length > 1024) return { ok: false, error: 'OAuth state를 확인할 수 없습니다.' };
  if (!scopeResult.ok) return scopeResult;

  return {
    ok: true,
    value: {
      clientId,
      redirectUri,
      responseType: 'code',
      codeChallenge,
      codeChallengeMethod: 'S256',
      resource,
      scope: scopeResult.scope,
      state,
    },
  };
}

export async function issueAuthorizationCode(userId: string, request: AuthorizationRequest): Promise<string> {
  await ensureDatabase();
  const code = randomToken(32);
  const now = Date.now();
  await getD1().prepare(`
    INSERT INTO oauth_authorization_codes
      (code_hash,user_id,client_id,redirect_uri,resource,scope,code_challenge,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    await hashToken(code), userId, request.clientId, request.redirectUri,
    request.resource, request.scope, request.codeChallenge,
    now + AUTHORIZATION_CODE_TTL_MS, now,
  ).run();
  return code;
}

export async function exchangeAuthorizationCode(input: URLSearchParams, origin: string) {
  const code = input.get('code') || '';
  const clientId = input.get('client_id') || '';
  const redirectUri = input.get('redirect_uri') || '';
  const resource = input.get('resource') || '';
  const verifier = input.get('code_verifier') || '';
  if (!code || clientId !== CHATGPT_CLIENT_ID || redirectUri !== CHATGPT_REDIRECT_URI || resource !== mcpResource(origin)) return null;
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;

  await ensureDatabase();
  const d1 = getD1();
  const now = Date.now();
  const codeHash = await hashToken(code);
  const row = await d1.prepare(`
    SELECT code_hash AS codeHash,user_id AS userId,client_id AS clientId,
           redirect_uri AS redirectUri,resource,scope,code_challenge AS codeChallenge
      FROM oauth_authorization_codes c
      JOIN users u ON u.id=c.user_id
     WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?
       AND u.status='APPROVED' AND u.role IN ('USER','ADMIN') LIMIT 1
  `).bind(codeHash, now).first<{
    codeHash: string; userId: string; clientId: string; redirectUri: string;
    resource: string; scope: string; codeChallenge: string;
  }>();
  if (!row || row.clientId !== clientId || row.redirectUri !== redirectUri || row.resource !== resource) return null;
  const challenge = await pkceChallenge(verifier);
  if (!safeEqualText(challenge, row.codeChallenge)) return null;

  // 코드 소모와 토큰 발급을 한 트랜잭션(batch)으로 묶는다. 소모 UPDATE 가 0행이면
  // (동시 요청이 먼저 썼거나 만료) INSERT 도 함께 무효가 되고, INSERT 가 실패하면 소모도 되돌아간다.
  return issueTokenPair(row.userId, clientId, resource, row.scope, {
    consume: d1.prepare(`UPDATE oauth_authorization_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL`).bind(now, codeHash),
  });
}

export async function exchangeRefreshToken(input: URLSearchParams, origin: string) {
  const refreshToken = input.get('refresh_token') || '';
  const clientId = input.get('client_id') || '';
  const resource = input.get('resource') || '';
  if (!refreshToken || clientId !== CHATGPT_CLIENT_ID || resource !== mcpResource(origin)) return null;

  await ensureDatabase();
  const d1 = getD1();
  const now = Date.now();
  const refreshTokenHash = await hashToken(refreshToken);
  const row = await d1.prepare(`
    SELECT t.id,t.user_id AS userId,t.client_id AS clientId,t.resource,t.scope
      FROM oauth_tokens t
      JOIN users u ON u.id=t.user_id
     WHERE t.refresh_token_hash=? AND t.status='ACTIVE' AND t.refresh_expires_at>?
       AND u.status='APPROVED' AND u.role IN ('USER','ADMIN') LIMIT 1
  `).bind(refreshTokenHash, now).first<{ id: string; userId: string; clientId: string; resource: string; scope: string }>();
  if (!row || row.clientId !== clientId || row.resource !== resource) return null;

  const requestedScope = normalizeScope(input.get('scope') || row.scope);
  if (!requestedScope.ok || !isScopeSubset(requestedScope.scope, row.scope)) return null;
  // 기존 토큰 회전과 새 토큰 발급을 한 트랜잭션으로 묶는다(부분 실패 시 기존 토큰이 살아남는다).
  return issueTokenPair(row.userId, clientId, resource, requestedScope.scope, {
    consume: d1.prepare(`UPDATE oauth_tokens SET status='ROTATED',rotated_at=? WHERE id=? AND status='ACTIVE'`).bind(now, row.id),
  });
}

export async function authenticateMcpOAuth(request: Request): Promise<OAuthIdentity | null> {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) return null;
  await ensureDatabase();
  const tokenHash = await hashToken(match[1]);
  const origin = trustedSiteOrigin(request);
  if (!origin) return null;
  const row = await getD1().prepare(`
    SELECT t.user_id AS userId,t.scope,u.email
      FROM oauth_tokens t
      JOIN users u ON u.id=t.user_id
     WHERE t.access_token_hash=? AND t.status='ACTIVE' AND t.access_expires_at>?
       AND t.resource=? AND u.status='APPROVED' AND u.role IN ('USER','ADMIN')
     LIMIT 1
  `).bind(tokenHash, Date.now(), mcpResource(origin)).first<OAuthIdentity>();
  return row || null;
}

export function hasOAuthScope(granted: string, required: string): boolean {
  return granted.split(/\s+/).includes(required);
}

export async function revokeOAuthToken(token: string, clientId: string): Promise<void> {
  if (!token || clientId !== CHATGPT_CLIENT_ID) return;
  await ensureDatabase();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await getD1().prepare(`
    UPDATE oauth_tokens SET status='REVOKED',revoked_at=?
     WHERE client_id=? AND status='ACTIVE'
       AND (access_token_hash=? OR refresh_token_hash=?)
  `).bind(now, clientId, tokenHash, tokenHash).run();
}

/**
 * 새 access/refresh 토큰을 발급한다.
 *
 * `consume` 이 주어지면(코드 소모·기존 토큰 회전) 그 UPDATE 와 INSERT 를 D1 batch(단일 트랜잭션)로
 * 실행한다. INSERT 는 SQLite `changes()` 로 직전 UPDATE 가 정확히 1행을 바꿨을 때만 행을 쓰므로,
 * 이미 소모된 코드·회전된 토큰으로는 새 토큰이 만들어지지 않고, INSERT 가 실패하면 소모도 함께 롤백된다.
 */
async function issueTokenPair(
  userId: string,
  clientId: string,
  resource: string,
  scope: string,
  options: { consume?: D1PreparedStatement } = {},
) {
  const d1 = getD1();
  const accessToken = randomToken(32);
  const refreshToken = scope.split(/\s+/).includes('offline_access') ? randomToken(32) : null;
  const now = Date.now();
  const insertValues = [
    `oauth_${randomToken(12)}`, await hashToken(accessToken),
    refreshToken ? await hashToken(refreshToken) : null,
    userId, clientId, resource, scope, now + ACCESS_TOKEN_TTL_MS,
    refreshToken ? now + REFRESH_TOKEN_TTL_MS : null, now,
  ];
  if (options.consume) {
    const insert = d1.prepare(`
      INSERT INTO oauth_tokens
        (id,access_token_hash,refresh_token_hash,user_id,client_id,resource,scope,status,access_expires_at,refresh_expires_at,created_at)
      SELECT ?,?,?,?,?,?,?,'ACTIVE',?,?,? WHERE changes()=1
    `).bind(...insertValues);
    const [consumed, inserted] = await d1.batch([options.consume, insert]);
    if (Number(consumed.meta.changes || 0) !== 1 || Number(inserted.meta.changes || 0) !== 1) return null;
  } else {
    await d1.prepare(`
      INSERT INTO oauth_tokens
        (id,access_token_hash,refresh_token_hash,user_id,client_id,resource,scope,status,access_expires_at,refresh_expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?)
    `).bind(...insertValues).run();
  }
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };
}

function normalizeScope(scope: string | null): { ok: true; scope: string } | { ok: false; error: string } {
  const requested = (scope || DEFAULT_OAUTH_SCOPE).trim().split(/\s+/).filter(Boolean);
  if (!requested.length || requested.some((value) => !OAUTH_SCOPES.includes(value as typeof OAUTH_SCOPES[number]))) {
    return { ok: false, error: '지원하지 않는 OAuth scope가 포함되어 있습니다.' };
  }
  return { ok: true, scope: [...new Set(requested)].join(' ') };
}

function isScopeSubset(candidate: string, granted: string): boolean {
  const allowed = new Set(granted.split(/\s+/));
  return candidate.split(/\s+/).every((scope) => allowed.has(scope));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

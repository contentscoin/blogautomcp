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
const MAX_OAUTH_FORM_BYTES = 32 * 1024;
const CLIENT_METADATA_TTL_MS = 5 * 60 * 1000;
let clientMetadataValidUntil = 0;
let clientMetadataPending: Promise<boolean> | null = null;

export type AuthorizationError = 'invalid_request' | 'unsupported_response_type' | 'invalid_scope' | 'access_denied' | 'temporarily_unavailable' | 'server_error';

export function isSupportedOAuthClient(clientId: string | null): boolean { return clientId === CHATGPT_CLIENT_ID; }

/** Only this verified, predefined client may select a callback; never fetch user-supplied URLs. */
export function hasTrustedOAuthCallback(input: URLSearchParams): boolean {
  return input.getAll('client_id').length === 1 && input.get('client_id') === CHATGPT_CLIENT_ID
    && input.getAll('redirect_uri').length === 1 && input.get('redirect_uri') === CHATGPT_REDIRECT_URI;
}

export function authorizationErrorCallback(input: URLSearchParams, origin: string, error: AuthorizationError): URL | null {
  if (!hasTrustedOAuthCallback(input)) return null;
  const target = new URL(CHATGPT_REDIRECT_URI);
  target.searchParams.set('error', error);
  target.searchParams.set('iss', oauthIssuer(origin));
  const state = input.get('state');
  if (input.getAll('state').length === 1 && state && state.length <= 1024) target.searchParams.set('state', state);
  return target;
}

/** Enforce the real byte limit even when Content-Length is missing or misleading. */
export async function readOAuthForm(request: Request): Promise<URLSearchParams | null> {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return null;
  const text = await readBoundedOAuthText(request);
  return text === null ? null : new URLSearchParams(text);
}

async function readBoundedOAuthText(message: Request | Response): Promise<string | null> {
  const length = message.headers.get('content-length');
  if (length !== null && (!Number.isSafeInteger(Number(length)) || Number(length) < 0 || Number(length) > MAX_OAUTH_FORM_BYTES)) return null;
  if (!message.body) return null;
  const reader = message.body.getReader();
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_OAUTH_FORM_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch { return null; } finally { reader.releaseLock(); }
}

/** CIMD is checked during new authorization only; refresh remains independent of this network request. */
export async function validateChatGPTClientMetadata(): Promise<boolean> {
  if (Date.now() < clientMetadataValidUntil) return true;
  clientMetadataPending ??= (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let stage = 'fetch';
    let status: number | null = null;
    const fail = (reason: string) => {
      // Never log OAuth requests, response bodies, account data or credentials.
      console.warn('[oauth-client-metadata]', JSON.stringify({ stage, status, reason }));
      return false;
    };
    try {
      // Inspect redirects without following them; this also works in Workers
      // runtimes whose Request constructor rejects redirect: 'error'.
      const response = await fetch(CHATGPT_CLIENT_ID, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json' } });
      status = response.status;
      stage = 'headers';
      if (!response.ok) return fail('http-status');
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) return fail('content-type');
      stage = 'body';
      const text = await readBoundedOAuthText(response);
      if (text === null) return fail('bounded-body');
      stage = 'json';
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('document-shape');
      stage = 'contract';
      const metadata = value as Record<string, unknown>;
      const includes = (field: unknown, expected: string) => Array.isArray(field) && field.every(item => typeof item === 'string') && field.includes(expected);
      const authMethods = metadata.token_endpoint_auth_methods_supported ?? [metadata.token_endpoint_auth_method];
      if (metadata.client_id !== CHATGPT_CLIENT_ID || !includes(metadata.redirect_uris, CHATGPT_REDIRECT_URI)
        || !includes(metadata.grant_types, 'authorization_code') || !includes(metadata.response_types, 'code') || !includes(authMethods, 'none')) return fail('client-contract');
      clientMetadataValidUntil = Date.now() + CLIENT_METADATA_TTL_MS;
      return true;
    } catch (error) {
      const reason = controller.signal.aborted ? 'timeout'
        : error instanceof TypeError ? 'type-error'
        : error instanceof SyntaxError ? 'invalid-json' : 'request-error';
      return fail(reason);
    } finally { clearTimeout(timeout); }
  })();
  try { return await clientMetadataPending; } finally { clientMetadataPending = null; }
}

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
): { ok: true; value: AuthorizationRequest } | { ok: false; error: string; errorCode: AuthorizationError } {
  const clientId = input.get('client_id') || '';
  const redirectUri = input.get('redirect_uri') || '';
  const responseType = input.get('response_type') || '';
  const codeChallenge = input.get('code_challenge') || '';
  const codeChallengeMethod = input.get('code_challenge_method') || '';
  const resource = input.get('resource') || '';
  const state = input.get('state') || '';
  const scopeResult = normalizeScope(input.get('scope'));

  const fail = (error: string, errorCode: AuthorizationError = 'invalid_request') => ({ ok: false as const, error, errorCode });
  if (['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state'].some(key => input.getAll(key).length > 1)) return fail('중복된 OAuth 매개변수를 사용할 수 없습니다.');
  if (clientId !== CHATGPT_CLIENT_ID) return fail('지원하지 않는 OAuth 클라이언트입니다.');
  if (redirectUri !== CHATGPT_REDIRECT_URI) return fail('허용되지 않은 OAuth 콜백 주소입니다.');
  if (responseType !== 'code') return fail('response_type은 code여야 합니다.', 'unsupported_response_type');
  if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return fail('PKCE S256 code_challenge가 필요합니다.');
  }
  if (resource !== mcpResource(origin)) return fail('MCP resource가 일치하지 않습니다.');
  if (!state || state.length > 1024) return fail('OAuth state를 확인할 수 없습니다.');
  if (!scopeResult.ok) return fail(scopeResult.error, 'invalid_scope');

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
  if (!hasPublicTokenParameters(input)) return null;
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
    consume: d1.prepare(`UPDATE oauth_authorization_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?
      AND EXISTS (SELECT 1 FROM users WHERE id=oauth_authorization_codes.user_id AND status='APPROVED' AND role IN ('USER','ADMIN'))`).bind(now, codeHash, Date.now()),
  });
}

export async function exchangeRefreshToken(input: URLSearchParams, origin: string) {
  if (!hasPublicTokenParameters(input)) return null;
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

  const requestedScope = normalizeScope(input.has('scope') ? input.get('scope') : row.scope);
  if (!requestedScope.ok || !isScopeSubset(requestedScope.scope, row.scope)) return null;
  // 기존 토큰 회전과 새 토큰 발급을 한 트랜잭션으로 묶는다(부분 실패 시 기존 토큰이 살아남는다).
  return issueTokenPair(row.userId, clientId, resource, requestedScope.scope, {
    consume: d1.prepare(`UPDATE oauth_tokens SET status='ROTATED',rotated_at=? WHERE id=? AND status='ACTIVE' AND refresh_expires_at>?
      AND EXISTS (SELECT 1 FROM users WHERE id=oauth_tokens.user_id AND status='APPROVED' AND role IN ('USER','ADMIN'))`).bind(now, row.id, Date.now()),
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
  const requested = (scope === null ? DEFAULT_OAUTH_SCOPE : scope).trim().split(/\s+/).filter(Boolean);
  if (!requested.length || requested.some((value) => !OAUTH_SCOPES.includes(value as typeof OAUTH_SCOPES[number]))) {
    return { ok: false, error: '지원하지 않는 OAuth scope가 포함되어 있습니다.' };
  }
  return { ok: true, scope: [...new Set(requested)].join(' ') };
}

function isScopeSubset(candidate: string, granted: string): boolean {
  const allowed = new Set(granted.split(/\s+/));
  return candidate.split(/\s+/).every((scope) => allowed.has(scope));
}

function hasPublicTokenParameters(input: URLSearchParams): boolean {
  if (['client_secret', 'client_assertion', 'client_assertion_type'].some(key => input.has(key))) return false;
  return ['grant_type', 'code', 'client_id', 'redirect_uri', 'resource', 'code_verifier', 'refresh_token', 'scope'].every(key => input.getAll(key).length <= 1);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

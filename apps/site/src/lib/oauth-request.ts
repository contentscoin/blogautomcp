import { db } from "@/lib/db";
import { parseMcpUrl, resolveMcpConnection } from "@/lib/mcp-connection";
import { userCanUseMcp } from "@/lib/auth";

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  resource: string;
  scope: string;
  codeChallenge: string;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export async function validateAuthorizationRequest(
  raw: Record<string, string | string[] | undefined>,
  userId?: string,
): Promise<{ request: AuthorizationRequest; connectionId: string } | { error: string }> {
  const clientId = first(raw.client_id);
  const redirectUri = first(raw.redirect_uri);
  const responseType = first(raw.response_type);
  const state = first(raw.state);
  const resource = first(raw.resource);
  const scope = first(raw.scope) || "mcp:tools";
  const codeChallenge = first(raw.code_challenge);
  const codeChallengeMethod = first(raw.code_challenge_method);

  if (!clientId || !redirectUri || responseType !== "code" || !resource || !codeChallenge) return { error: "필수 OAuth 파라미터가 누락되었습니다." };
  if (!/^mcp_[A-Za-z0-9_-]{32}$/.test(clientId)) return { error: "OAuth client_id 형식이 올바르지 않습니다." };
  if (redirectUri.length > 2048 || resource.length > 2048 || state.length > 1024) return { error: "OAuth 파라미터가 허용 길이를 초과했습니다." };
  if (scope !== "mcp:tools") return { error: "mcp:tools 권한만 요청할 수 있습니다." };
  if (codeChallengeMethod !== "S256") return { error: "PKCE S256만 지원합니다." };
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return { error: "PKCE challenge 형식이 올바르지 않습니다." };

  const client = await db.oAuthClient.findUnique({ where: { id: clientId } });
  const redirectUris = client && Array.isArray(client.redirectUris) ? client.redirectUris.filter((item): item is string => typeof item === "string") : [];
  if (!client || !redirectUris.includes(redirectUri)) return { error: "등록되지 않은 OAuth 클라이언트 또는 redirect URI입니다." };

  const parsed = parseMcpUrl(resource);
  if (!parsed) return { error: "MCP resource URL이 올바르지 않습니다." };
  const connection = await resolveMcpConnection(parsed.endpointId, parsed.secret);
  if (!connection) return { error: "MCP 연결이 폐기되었거나 유효하지 않습니다." };
  if (!userCanUseMcp(connection.user)) return { error: "승인되지 않은 계정입니다." };
  if (userId && connection.userId !== userId) return { error: "이 MCP 연결의 소유자 계정으로 로그인해야 합니다." };

  return { request: { clientId, redirectUri, state, resource, scope, codeChallenge }, connectionId: connection.id };
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken, pkceChallenge, randomToken, safeEqualText } from "@/lib/crypto";
import { signMcpAccessToken } from "@/lib/oauth";
import { userCanUseMcp } from "@/lib/auth";
import { requestBodyWithinLimit } from "@/lib/http";

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: { "cache-control": "no-store" } });
}

async function issueTokens(input: { userId: string; clientId: string; connectionId: string; generation: number; resource: string; scope: string; rotateRefresh?: { id: string; expectedHash: string } }) {
  const accessToken = await signMcpAccessToken({ userId: input.userId, connectionId: input.connectionId, generation: input.generation, resource: input.resource, scope: input.scope });
  const refreshToken = randomToken(40);
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (input.rotateRefresh) {
    const rotated = await db.oAuthRefreshToken.updateMany({
      where: { id: input.rotateRefresh.id, tokenHash: input.rotateRefresh.expectedHash, revokedAt: null },
      data: { tokenHash: refreshHash, lastUsedAt: new Date(), expiresAt },
    });
    if (rotated.count !== 1) return null;
  } else {
    await db.oAuthRefreshToken.create({ data: { tokenHash: refreshHash, userId: input.userId, clientId: input.clientId, connectionId: input.connectionId, generation: input.generation, scope: input.scope, resource: input.resource, expiresAt } });
  }
  return NextResponse.json({ access_token: accessToken, token_type: "Bearer", expires_in: 900, refresh_token: refreshToken, scope: input.scope }, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
}

export async function POST(request: NextRequest) {
  if (!requestBodyWithinLimit(request, 16 * 1024)) return oauthError("invalid_request", "Request body is too large.", 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", "Request body must be form encoded.");
  }
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");
  if (typeof clientId !== "string" || !/^mcp_[A-Za-z0-9_-]{32}$/.test(clientId)) return oauthError("invalid_client", "client_id is required.", 401);
  const client = await db.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client) return oauthError("invalid_client", "Unknown client.", 401);

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const verifier = form.get("code_verifier");
    const resource = form.get("resource");
    if ([code, redirectUri, verifier, resource].some((value) => typeof value !== "string")) return oauthError("invalid_request", "code, redirect_uri, code_verifier and resource are required.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(code as string) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier as string) || (redirectUri as string).length > 2048 || (resource as string).length > 2048) return oauthError("invalid_request", "OAuth parameter format is invalid.");
    const record = await db.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashToken(code as string) }, include: { connection: { include: { user: true } } } });
    if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource || record.expiresAt <= new Date() || record.usedAt) return oauthError("invalid_grant", "Authorization code is invalid or expired.");
    if (!safeEqualText(pkceChallenge(verifier as string), record.codeChallenge)) return oauthError("invalid_grant", "PKCE verification failed.");
    if (record.connection.status !== "ACTIVE" || !userCanUseMcp(record.connection.user)) return oauthError("invalid_grant", "Account or MCP connection is not active.");
    const consumed = await db.oAuthAuthorizationCode.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) return oauthError("invalid_grant", "Authorization code was already used.");
    const issued = await issueTokens({ userId: record.userId, clientId, connectionId: record.connectionId, generation: record.connection.generation, resource: record.resource, scope: record.scope });
    return issued || oauthError("server_error", "Token issuance failed.", 500);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    const resource = form.get("resource");
    if (typeof refreshToken !== "string" || !/^[A-Za-z0-9_-]{54}$/.test(refreshToken)) return oauthError("invalid_request", "refresh_token is required.");
    if (typeof resource === "string" && resource.length > 2048) return oauthError("invalid_request", "resource is too long.");
    const record = await db.oAuthRefreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) }, include: { connection: true, user: true } });
    if (!record || record.clientId !== clientId || record.revokedAt || record.expiresAt <= new Date()) return oauthError("invalid_grant", "Refresh token is invalid or expired.");
    if (typeof resource === "string" && resource !== record.resource) return oauthError("invalid_target", "Resource does not match the original grant.");
    if (record.connection.status !== "ACTIVE" || record.connection.generation !== record.generation || !userCanUseMcp(record.user)) return oauthError("invalid_grant", "Account or MCP connection is no longer active.");
    const issued = await issueTokens({ userId: record.userId, clientId, connectionId: record.connectionId, generation: record.generation, resource: record.resource, scope: record.scope, rotateRefresh: { id: record.id, expectedHash: hashToken(refreshToken) } });
    return issued || oauthError("invalid_grant", "Refresh token was already rotated.");
  }

  return oauthError("unsupported_grant_type", "Supported grants are authorization_code and refresh_token.");
}

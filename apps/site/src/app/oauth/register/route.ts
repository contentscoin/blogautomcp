import { NextRequest, NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { readObject } from "@/lib/http";
import { consumeRateLimit, getClientAddress, rateLimitError } from "@/lib/rate-limit";

function allowedRedirectUri(raw: string): boolean {
  try {
    if (raw.length > 2048) return false;
    const url = new URL(raw);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname.endsWith(".chatgpt.com") || url.hostname === "platform.openai.com")) return true;
    return process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rate = await consumeRateLimit({ action: "OAUTH_DCR", identifier: getClientAddress(request), limit: 50, windowMs: 60 * 60 * 1000 });
  if (!rate.allowed) return rateLimitError(rate.retryAfterSeconds);
  const body = await readObject(request);
  if (!body) return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((item): item is string => typeof item === "string") : [];
  if (!redirectUris.length || redirectUris.length > 10 || redirectUris.some((uri) => !allowedRedirectUri(uri))) return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  const authMethod = body.token_endpoint_auth_method === undefined ? "none" : body.token_endpoint_auth_method;
  if (authMethod !== "none") return NextResponse.json({ error: "invalid_client_metadata", error_description: "Only public PKCE clients are supported." }, { status: 400 });
  const clientId = `mcp_${randomToken(24)}`;
  const name = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 120) : null;
  await db.oAuthClient.create({ data: { id: clientId, name, redirectUris, tokenEndpointAuthMethod: "none" } });
  return NextResponse.json({ client_id: clientId, client_name: name, redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, { status: 201 });
}

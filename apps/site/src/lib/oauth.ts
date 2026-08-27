import { jwtVerify, SignJWT } from "jose";
import { getAuthSecret, getSiteUrl } from "@/lib/env";

const encoder = new TextEncoder();

function key(): Uint8Array {
  return encoder.encode(getAuthSecret());
}

export interface McpAccessClaims {
  userId: string;
  connectionId: string;
  generation: number;
  resource: string;
  scope: string;
}

export async function signMcpAccessToken(claims: McpAccessClaims): Promise<string> {
  return new SignJWT({
    connection_id: claims.connectionId,
    generation: claims.generation,
    scope: claims.scope,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(getSiteUrl())
    .setSubject(claims.userId)
    .setAudience(claims.resource)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key());
}

export async function verifyMcpAccessToken(token: string, resource: string): Promise<McpAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: getSiteUrl(),
      audience: resource,
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.connection_id !== "string" ||
      typeof payload.generation !== "number" ||
      typeof payload.scope !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      connectionId: payload.connection_id,
      generation: payload.generation,
      resource,
      scope: payload.scope,
    };
  } catch {
    return null;
  }
}

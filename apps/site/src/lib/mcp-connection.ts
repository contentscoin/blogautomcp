import { db } from "@/lib/db";
import { hashToken, safeEqualText } from "@/lib/crypto";
import { getSiteUrl } from "@/lib/env";

const MCP_PATH = /\/api\/mcp\/([A-Za-z0-9_-]{20})\.([A-Za-z0-9_-]{43})$/;

export function parseMcpUrl(rawUrl: string): { endpointId: string; secret: string; resource: string } | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
      return null;
    }
    if (url.origin !== new URL(getSiteUrl()).origin) return null;
    const match = url.pathname.match(MCP_PATH);
    if (!match) return null;
    url.search = "";
    url.hash = "";
    return { endpointId: match[1], secret: match[2], resource: url.toString().replace(/\/$/, "") };
  } catch {
    return null;
  }
}

export async function resolveMcpConnection(endpointId: string, secret: string) {
  const connection = await db.mcpConnection.findUnique({
    where: { endpointId },
    include: { user: true },
  });
  if (!connection || connection.status !== "ACTIVE") return null;
  if (!safeEqualText(hashToken(secret), connection.secretHash)) return null;
  return connection;
}

export function splitMcpCredential(credential: string): { endpointId: string; secret: string } | null {
  const separator = credential.indexOf(".");
  if (separator < 10) return null;
  const endpointId = credential.slice(0, separator);
  const secret = credential.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{20}$/.test(endpointId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { endpointId, secret };
}

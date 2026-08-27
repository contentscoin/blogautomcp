import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { hashToken, safeEqualText } from '@/lib/crypto';

const ENDPOINT_PATTERN = /^[A-Za-z0-9_-]{20}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type McpCredential = {
  endpointId: string;
  secret: string;
};

export type ResolvedMcpConnection = {
  id: string;
  userId: string;
  generation: number;
  email: string;
};

export function splitMcpCredential(value: string): McpCredential | null {
  const separator = value.indexOf('.');
  if (separator < 0 || separator !== value.lastIndexOf('.')) return null;
  const endpointId = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  return ENDPOINT_PATTERN.test(endpointId) && SECRET_PATTERN.test(secret)
    ? { endpointId, secret }
    : null;
}

export function parseMcpUrl(value: string, expectedOrigin: string): McpCredential | null {
  if (!value || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.origin !== expectedOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) return null;
  const match = /^\/api\/mcp\/([^/]+)$/.exec(url.pathname);
  return match ? splitMcpCredential(match[1]) : null;
}

export async function resolveMcpConnection(
  endpointId: string,
  secret: string,
): Promise<ResolvedMcpConnection | null> {
  if (!ENDPOINT_PATTERN.test(endpointId) || !SECRET_PATTERN.test(secret)) return null;
  await ensureDatabase();
  const row = await getD1().prepare(`
    SELECT m.id, m.user_id AS userId, m.secret_hash AS secretHash,
           m.generation, u.email
      FROM mcp_connections m
      JOIN users u ON u.id = m.user_id
     WHERE m.endpoint_id = ?
       AND m.status = 'ACTIVE'
       AND u.status = 'APPROVED'
       AND u.role IN ('USER', 'ADMIN')
     LIMIT 1
  `).bind(endpointId).first<ResolvedMcpConnection & { secretHash: string }>();
  if (!row) return null;
  const candidateHash = await hashToken(secret);
  if (!safeEqualText(row.secretHash, candidateHash)) return null;
  return { id: row.id, userId: row.userId, generation: row.generation, email: row.email };
}

import { ensureDatabase } from '@/db/init';
import { getD1 } from '@/db';
import { hashToken } from '@/lib/crypto';

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthenticatedDevice = {
  id: string;
  userId: string;
  name: string;
  platform: string | null;
  appVersion: string | null;
};

export async function authenticateDevice(request: Request): Promise<AuthenticatedDevice | null> {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  const token = match?.[1] || '';
  if (!DEVICE_TOKEN_PATTERN.test(token)) return null;
  await ensureDatabase();
  const tokenHash = await hashToken(token);
  return getD1().prepare(`
    SELECT d.id, d.user_id AS userId, d.name, d.platform, d.app_version AS appVersion
      FROM devices d
      JOIN users u ON u.id = d.user_id
     WHERE d.token_hash = ?
       AND d.status = 'ACTIVE'
       AND u.status = 'APPROVED'
       AND u.role IN ('USER', 'ADMIN')
     LIMIT 1
  `).bind(tokenHash).first<AuthenticatedDevice>();
}

import { eq } from 'drizzle-orm';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { ensureDatabase } from '@/db/init';
import { getDb } from '@/db';
import { users } from '@/db/schema';

export const ADMIN_EMAIL = 'hiway@kakao.com';
export type Account = typeof users.$inferSelect;

export async function ensureAccount(identity: ChatGPTUser): Promise<Account> {
  await ensureDatabase();
  const db = getDb();
  const email = identity.email.trim().toLowerCase();
  const now = Date.now();
  const admin = email === ADMIN_EMAIL;
  await db.insert(users).values({ id: identity.userId, email, displayName: identity.displayName, role: admin ? 'ADMIN' : 'USER', status: admin ? 'APPROVED' : 'PENDING_APPROVAL', createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: users.id, set: { email, displayName: identity.displayName, ...(admin ? { role: 'ADMIN', status: 'APPROVED' } : {}), updatedAt: now } });
  const [account] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
  if (!account) throw new Error('계정을 준비하지 못했습니다.');
  return account;
}

export function canUseMcp(account: Account): boolean { return account.status === 'APPROVED' && ['USER', 'ADMIN'].includes(account.role); }
export function isAdmin(account: Account): boolean { return account.role === 'ADMIN' && account.email === ADMIN_EMAIL && account.status === 'APPROVED'; }

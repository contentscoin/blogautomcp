import { getD1 } from '@/db';
import { ensureDatabase } from '@/db/init';
import { DEVICE_ONLINE_MS, parseStatusJson } from '@/lib/jobs';

export const CONNECTION_CHECK_TTL_MS = 15 * 60 * 1000;

// Called only after a successful, authenticated OAuth read tool. Never store
// arguments, tokens or result bodies, and keep one bounded record per account.
export async function recordMcpRead(userId: string, tool: string, jobId: string | null) {
  await ensureDatabase();
  await getD1().prepare(`
    INSERT INTO mcp_connection_checks (user_id,last_read_at,read_tool,channel_id,read_job_id)
    SELECT u.id,?,?,m.id,? FROM users u
    LEFT JOIN mcp_connections m ON m.user_id=u.id AND m.status='ACTIVE'
    WHERE u.id=? AND u.status='APPROVED' AND u.role IN ('USER','ADMIN')
    ON CONFLICT(user_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at),
      read_tool=excluded.read_tool, channel_id=excluded.channel_id,
      read_job_id=CASE WHEN excluded.read_job_id IS NOT NULL THEN excluded.read_job_id
        WHEN mcp_connection_checks.channel_id IS excluded.channel_id THEN mcp_connection_checks.read_job_id ELSE NULL END
  `).bind(Date.now(), tool, jobId, userId).run();
}

export async function readConnectionStatus(userId: string, now = Date.now()) {
  await ensureDatabase();
  const d1 = getD1();
  const [account, channel, device, oauth, check] = await Promise.all([
    d1.prepare(`SELECT status,role FROM users WHERE id=?`).bind(userId).first<{ status: string; role: string }>(),
    d1.prepare(`SELECT id,generation FROM mcp_connections WHERE user_id=? AND status='ACTIVE'`).bind(userId).first<{ id: string; generation: number }>(),
    d1.prepare(`SELECT id,name,last_seen_at AS lastSeenAt,status_json AS statusJson FROM devices WHERE user_id=? AND status='ACTIVE' ORDER BY paired_at DESC LIMIT 1`).bind(userId).first<{ id: string; name: string; lastSeenAt: number | null; statusJson: string | null }>(),
    d1.prepare(`SELECT id FROM oauth_tokens WHERE user_id=? AND status='ACTIVE' AND (access_expires_at>? OR refresh_expires_at>?) LIMIT 1`).bind(userId, now, now).first<{ id: string }>(),
    d1.prepare(`SELECT last_read_at AS lastReadAt,channel_id AS channelId,read_job_id AS readJobId FROM mcp_connection_checks WHERE user_id=?`).bind(userId).first<{ lastReadAt: number; channelId: string | null; readJobId: string | null }>(),
  ]);
  const allowed = account?.status === 'APPROVED' && ['USER', 'ADMIN'].includes(account.role);
  const recent = (time: number | null | undefined, ttl: number) => typeof time === 'number' && time <= now && time > now - ttl;
  const authorized = Boolean(allowed && oauth);
  const readVerified = Boolean(authorized && recent(check?.lastReadAt, CONNECTION_CHECK_TTL_MS));
  const online = Boolean(allowed && channel && recent(device?.lastSeenAt, DEVICE_ONLINE_MS));
  const job = check?.readJobId && device && channel?.id === check.channelId
    ? await d1.prepare(`SELECT finished_at AS finishedAt FROM agent_jobs WHERE id=? AND user_id=? AND claimed_by_device_id=? AND status='SUCCEEDED' AND error_code IS NULL AND type IN ('MATERIALS_LIST','BRANDCONNECT_LIST_PRODUCTS','BRANDCONNECT_LIST_CATEGORIES','POST_GET_DRAFT','BLOG_PROFILE_GET','BLOG_DESIGN_GET','THUMBNAIL_PREPARE','POST_PREPARE_DRAFT')`).bind(check.readJobId, userId, device.id).first<{ finishedAt: number | null }>()
    : null;
  const roundTripVerified = Boolean(online && readVerified && recent(job?.finishedAt, CONNECTION_CHECK_TTL_MS));
  const snapshot = parseStatusJson(device?.statusJson ?? null);
  return {
    channel: { exists: Boolean(allowed && channel), generation: allowed ? channel?.generation || 0 : 0 },
    mcp: { authorized, readVerified, lastVerifiedAt: check?.lastReadAt ?? null },
    pc: { paired: Boolean(allowed && device), online, name: device?.name ?? null, roundTripVerified, lastVerifiedAt: job?.finishedAt ?? null },
    // A saved cookie is not proof that Naver still accepts the session.
    naver: { sessionSaved: online && typeof snapshot?.naverSessionPresent === 'boolean' ? snapshot.naverSessionPresent : null },
    ready: Boolean(channel && readVerified && roundTripVerified),
  };
}

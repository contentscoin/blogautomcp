import type { getD1 } from '@/db';

type D1 = ReturnType<typeof getD1>;

/** claim 후 이 시간 안에 하트비트가 없으면 PC 가 사라진 것으로 본다. */
export const JOB_LEASE_MS = 120_000;
/** 마지막 접속(claim/heartbeat) 기준 온라인 판정 */
export const DEVICE_ONLINE_MS = 90_000;
/** 발행 계열 작업은 PC 유실 시 발행 여부가 불확실하다 → 별도 코드로 표시 */
export const PUBLISH_JOB_TYPES = new Set(['POST_PUBLISH', 'POST_SCHEDULE', 'POST_BULK_SCHEDULE']);

export type ActiveDevice = {
  id: string;
  name: string;
  platform: string | null;
  appVersion: string | null;
  lastSeenAt: number | null;
  statusJson: string | null;
};

export async function findActiveDevice(d1: D1, userId: string): Promise<ActiveDevice | null> {
  return d1.prepare(`SELECT id,name,platform,app_version AS appVersion,last_seen_at AS lastSeenAt,status_json AS statusJson FROM devices WHERE user_id=? AND status='ACTIVE' ORDER BY paired_at DESC LIMIT 1`).bind(userId).first<ActiveDevice>();
}

/**
 * 임대가 만료된 RUNNING 작업을 정리한다. 서버리스라 크론 대신 조회/큐잉 시점에 lazy 하게 돈다.
 * 발행 계열은 네이버에 글이 올라갔을 수도 있으므로 AGENT_LOST_UNCERTAIN 으로 남겨
 * post_verify_published 로 확인하도록 안내한다.
 */
export async function sweepExpiredLeases(d1: D1, userId: string, now = Date.now()): Promise<number> {
  const uncertain = await d1.prepare(`
    UPDATE agent_jobs
       SET status='FAILED', error_code='AGENT_LOST_UNCERTAIN',
           error_message='로컬 프로그램 응답이 끊겨 작업이 중단되었습니다. 발행이 이미 되었을 수 있으니 post_verify_published 로 확인하세요.',
           updated_at=?, finished_at=?, lease_until=NULL
     WHERE user_id=? AND status='RUNNING' AND lease_until IS NOT NULL AND lease_until < ?
       AND type IN ('POST_PUBLISH','POST_SCHEDULE','POST_BULK_SCHEDULE')
  `).bind(now, now, userId, now).run();
  const lost = await d1.prepare(`
    UPDATE agent_jobs
       SET status='FAILED', error_code='AGENT_LOST',
           error_message='로컬 프로그램 응답이 끊겨 작업이 중단되었습니다. PC 앱이 켜져 있는지 확인한 뒤 다시 요청하세요.',
           updated_at=?, finished_at=?, lease_until=NULL
     WHERE user_id=? AND status='RUNNING' AND lease_until IS NOT NULL AND lease_until < ?
  `).bind(now, now, userId, now).run();
  return Number(uncertain.meta.changes || 0) + Number(lost.meta.changes || 0);
}

/** 온라인 = 최근 접속이 있거나, 실행 중 작업의 하트비트가 임대 안에 살아 있음 */
export async function isAgentOnline(d1: D1, userId: string, device: ActiveDevice | null, now = Date.now()): Promise<boolean> {
  if (!device) return false;
  if (device.lastSeenAt && now - device.lastSeenAt < DEVICE_ONLINE_MS) return true;
  const running = await d1.prepare(`SELECT COUNT(*) AS count FROM agent_jobs WHERE user_id=? AND status='RUNNING' AND claimed_by_device_id=? AND lease_until IS NOT NULL AND lease_until >= ?`).bind(userId, device.id, now).first<{ count: number }>();
  return Number(running?.count || 0) > 0;
}

export function parseStatusJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** 데스크톱이 보내는 상태 스냅샷을 검증·축약해 저장한다 (비밀값 없음). */
export function sanitizeStatusSnapshot(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = ['naverSessionPresent', 'naverSessionSavedAt', 'naverBlogIdConfigured', 'travelContractReady', 'updatePending', 'openaiConfigured', 'generativeThumbnail', 'pipelineVersion', 'appVersion', 'platform', 'checkedAt'];
  const output: Record<string, unknown> = {};
  for (const key of allowed) {
    const item = source[key];
    if (typeof item === 'boolean' || (typeof item === 'string' && item.length <= 120) || typeof item === 'number') output[key] = item;
  }
  return Object.keys(output).length > 0 ? JSON.stringify(output) : null;
}

export function cleanStage(value: unknown, max = 80): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

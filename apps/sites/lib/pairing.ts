import { hashToken, newId, randomToken } from '@/lib/crypto';

/** 사람이 옮겨 적기 쉬운 8자 코드(혼동 문자 0/O/1/I 제외). 40비트 엔트로피 + 90초 TTL + IP 레이트리밋. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_TTL_MS = 90_000;
export const PAIR_CODE_LENGTH = 8;

export function generatePairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIR_CODE_LENGTH));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/** 입력 정규화: 대문자, 공백·하이픈 제거, 0→O 1→I 같은 혼동 문자 보정. */
export function normalizePairCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  return cleaned.length === PAIR_CODE_LENGTH && [...cleaned].every((char) => CODE_ALPHABET.includes(char)) ? cleaned : null;
}

export async function hashPairCode(code: string): Promise<string> {
  return hashToken(`pair-code:${code}`);
}

export function buildPairDeepLink(origin: string, code: string): string {
  return `blogautomcp://pair?code=${encodeURIComponent(code)}&site=${encodeURIComponent(origin)}`;
}

export type PairedDevice = { deviceId: string; deviceToken: string; replacedExisting: boolean };

/**
 * 사용자의 활성 PC 를 새 장치로 원자 교체한다. MCP URL 경로와 페어 코드 경로가 같은 배치를 쓴다:
 * 기존 ACTIVE 장치 REPLACED → RUNNING 작업 취소 → 새 장치 INSERT → 감사 기록.
 */
export async function pairDeviceForUser(
  d1: D1Database,
  userId: string,
  input: { deviceName: string; platform: string | null; appVersion: string | null; method: 'mcp-url' | 'pair-code' },
): Promise<PairedDevice> {
  const now = Date.now();
  const deviceId = newId('device');
  const deviceToken = randomToken(32);
  const tokenHash = await hashToken(deviceToken);
  const active = await d1.prepare(`SELECT COUNT(*) AS count FROM devices WHERE user_id=? AND status='ACTIVE'`).bind(userId).first<{ count: number }>();
  const replacedExisting = Number(active?.count || 0) > 0;
  await d1.batch([
    d1.prepare(`UPDATE devices SET status='REPLACED', revoked_at=? WHERE user_id=? AND status='ACTIVE'`).bind(now, userId),
    d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', progress=100, error_code='DEVICE_REPLACED', error_message='새 PC가 인증되어 기존 PC 작업이 취소됨', updated_at=?, finished_at=?, lease_until=NULL WHERE user_id=? AND status='RUNNING'`).bind(now, now, userId),
    d1.prepare(`INSERT INTO devices (id,user_id,token_hash,name,platform,app_version,status,paired_at,last_seen_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?)`).bind(deviceId, userId, tokenHash, input.deviceName, input.platform, input.appVersion, now, now),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).bind(newId('audit'), userId, userId, 'DEVICE_PAIRED', JSON.stringify({ deviceId, deviceName: input.deviceName, platform: input.platform, appVersion: input.appVersion, method: input.method, replacedExisting }), now),
  ]);
  return { deviceId, deviceToken, replacedExisting };
}

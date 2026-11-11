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

export const DEVICE_PAIR_PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export type PairedDevice = { deviceId: string; deviceToken: string; replacedExisting: boolean; recovered?: boolean };
export class PairingError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

/**
 * 사용자의 활성 PC 를 새 장치로 원자 교체한다. MCP URL 경로와 페어 코드 경로가 같은 배치를 쓴다:
 * 기존 ACTIVE 장치 REPLACED → RUNNING 작업 취소 → 새 장치 INSERT → 감사 기록.
 */
export async function pairDeviceForUser(
  d1: D1Database,
  userId: string,
  input: { deviceName: string; platform: string | null; appVersion: string | null; method: 'mcp-url' | 'pair-code';
    pairCodeHash?: string; deviceToken?: string; connectionId?: string; connectionGeneration?: number },
): Promise<PairedDevice> {
  const now = Date.now();
  const deviceId = newId('device');
  const deviceToken = input.deviceToken || randomToken(32);
  if (!DEVICE_PAIR_PROOF_PATTERN.test(deviceToken)) throw new PairingError('INVALID_PAIR_PROOF', 'PC 연결 증명을 확인하세요.', 422);
  const tokenHash = await hashToken(deviceToken);
  const approved = `EXISTS (SELECT 1 FROM users u JOIN mcp_connections m ON m.user_id=u.id
    WHERE u.id=? AND u.status='APPROVED' AND u.role IN ('USER','ADMIN') AND m.status='ACTIVE'
      ${input.connectionId ? 'AND m.id=? AND m.generation=?' : ''})`;
  const approvalArgs = input.connectionId ? [userId, input.connectionId, input.connectionGeneration] : [userId];
  const recover = async (): Promise<PairedDevice | null> => {
    if (!input.deviceToken) return null; // A short code alone never retrieves a permanent token.
    const row = input.pairCodeHash
      ? await d1.prepare(`SELECT d.id FROM pair_codes p JOIN devices d ON d.id=p.paired_device_id AND d.user_id=p.user_id
          WHERE p.code_hash=? AND p.user_id=? AND p.used_at IS NOT NULL AND p.pairing_token_hash=?
            AND d.token_hash=? AND d.status='ACTIVE' AND ${approved}`).bind(input.pairCodeHash, userId, tokenHash, tokenHash, ...approvalArgs).first<{ id: string }>()
      : await d1.prepare(`SELECT d.id FROM devices d WHERE d.user_id=? AND d.token_hash=? AND d.status='ACTIVE' AND ${approved}`)
          .bind(userId, tokenHash, ...approvalArgs).first<{ id: string }>();
    return row ? { deviceId: row.id, deviceToken, replacedExisting: false, recovered: true } : null;
  };
  const prior = await recover();
  if (prior) return prior;
  const marker = input.pairCodeHash
    ? `EXISTS (SELECT 1 FROM pair_codes p WHERE p.code_hash=? AND p.user_id=? AND p.paired_device_id=? AND p.pairing_token_hash=? AND p.used_at=?) AND ${approved}`
    : approved;
  const markerArgs = input.pairCodeHash ? [input.pairCodeHash, userId, deviceId, tokenHash, now, ...approvalArgs] : approvalArgs;
  const statements = [
    ...(input.pairCodeHash ? [d1.prepare(`UPDATE pair_codes SET used_at=?,pairing_token_hash=?,paired_device_id=?
      WHERE code_hash=? AND user_id=? AND used_at IS NULL AND expires_at>? AND ${approved}`)
      .bind(now, tokenHash, deviceId, input.pairCodeHash, userId, now, ...approvalArgs)] : []),
    d1.prepare(`UPDATE devices SET status='REPLACED', revoked_at=? WHERE user_id=? AND status='ACTIVE' AND ${marker}`).bind(now, userId, ...markerArgs),
    d1.prepare(`UPDATE agent_jobs SET status='CANCELLED', progress=100, error_code='DEVICE_REPLACED', error_message='새 PC가 인증되어 기존 PC 작업이 취소됨', updated_at=?, finished_at=?, lease_until=NULL WHERE user_id=? AND status='RUNNING' AND ${marker}`).bind(now, now, userId, ...markerArgs),
    d1.prepare(`INSERT INTO devices (id,user_id,token_hash,name,platform,app_version,status,paired_at,last_seen_at)
      SELECT ?,?,?,?,?,?,'ACTIVE',?,? WHERE ${marker}`).bind(deviceId, userId, tokenHash, input.deviceName, input.platform, input.appVersion, now, now, ...markerArgs),
    d1.prepare(`INSERT INTO audit_events (id,actor_user_id,target_user_id,action,metadata_json,created_at)
      SELECT ?,?,?,?,?,? WHERE ${marker}`).bind(newId('audit'), userId, userId, 'DEVICE_PAIRED', JSON.stringify({ deviceId, method: input.method }), now, ...markerArgs),
  ];
  // D1 batch is transactional: code consumption, replacement and insert either all commit or all roll back.
  let results;
  try { results = await d1.batch(statements); }
  catch (error) {
    // A simultaneous same-proof MCP URL request can win before this batch.
    // A failed batch rolled back; only an exact active receipt can resolve it.
    const raced = await recover();
    if (raced) return raced;
    throw error;
  }
  const offset = input.pairCodeHash ? 1 : 0;
  if (Number(results[offset + 2]?.meta.changes || 0) !== 1) {
    const raced = await recover();
    if (raced) return raced;
    throw new PairingError(input.pairCodeHash ? 'INVALID_PAIR_CODE' : 'NOT_APPROVED', '코드가 만료·사용되었거나 활성 연결과 계정 승인을 확인할 수 없습니다.', input.pairCodeHash ? 401 : 403);
  }
  return { deviceId, deviceToken, replacedExisting: Number(results[offset]?.meta.changes || 0) > 0 };
}

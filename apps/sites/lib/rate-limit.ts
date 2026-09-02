import type { getD1 } from '@/db';

type D1 = ReturnType<typeof getD1>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * 고정 윈도우 카운터. 정확한 슬라이딩 윈도우보다 단순하지만 endpoint 열거·페어링 시도
 * 같은 남용을 막기에는 충분하다. 경쟁 조건으로 한두 건이 더 통과할 수 있다.
 */
export async function enforceRateLimit(d1: D1, key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  const row = await d1.prepare(`SELECT window_start AS windowStart, count FROM rate_limits WHERE key=? LIMIT 1`).bind(key).first<{ windowStart: number; count: number }>();
  if (!row || now - row.windowStart >= windowMs) {
    await d1.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1`).bind(key, now).run();
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (row.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, row.windowStart + windowMs - now) };
  }
  await d1.prepare(`UPDATE rate_limits SET count=count+1 WHERE key=?`).bind(key).run();
  return { allowed: true, remaining: limit - row.count - 1, retryAfterMs: 0 };
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

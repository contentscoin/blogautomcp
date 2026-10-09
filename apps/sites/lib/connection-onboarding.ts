export type OnboardingStep = 'pc' | 'chatgpt' | 'verify';

export type ConnectionStatusSnapshot = {
  channel: { exists: boolean; generation: number };
  mcp: { authorized: boolean; readVerified: boolean; lastVerifiedAt: number | null };
  pc: { paired: boolean; online: boolean; name: string | null; roundTripVerified: boolean; lastVerifiedAt: number | null };
  naver: { sessionSaved: boolean | null };
  ready: boolean;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

/** Validate every displayed field and reject inconsistent completion claims. */
export function parseConnectionStatus(value: unknown): ConnectionStatusSnapshot | null {
  const data = object(value);
  const channel = object(data?.channel);
  const mcp = object(data?.mcp);
  const pc = object(data?.pc);
  const naver = object(data?.naver);
  if (!data || !channel || !mcp || !pc || !naver || typeof data.ready !== 'boolean') return null;
  if (typeof channel.exists !== 'boolean' || typeof channel.generation !== 'number' || !Number.isSafeInteger(channel.generation) || channel.generation < 0 || channel.exists !== (channel.generation > 0)) return null;
  if (typeof mcp.authorized !== 'boolean' || typeof mcp.readVerified !== 'boolean' || !timestamp(mcp.lastVerifiedAt)) return null;
  if (typeof pc.paired !== 'boolean' || typeof pc.online !== 'boolean' || typeof pc.roundTripVerified !== 'boolean' || !timestamp(pc.lastVerifiedAt) || (pc.name !== null && (typeof pc.name !== 'string' || !pc.name.trim()))) return null;
  if (naver.sessionSaved !== null && typeof naver.sessionSaved !== 'boolean') return null;
  if (mcp.readVerified && (!mcp.authorized || mcp.lastVerifiedAt === null)) return null;
  if (pc.online && (!pc.paired || !channel.exists)) return null;
  if (pc.roundTripVerified && (!pc.online || !mcp.readVerified || pc.lastVerifiedAt === null)) return null;
  if (naver.sessionSaved !== null && !pc.online) return null;
  if (data.ready !== (channel.exists && mcp.readVerified && pc.roundTripVerified)) return null;
  return {
    channel: { exists: channel.exists, generation: channel.generation },
    mcp: { authorized: mcp.authorized, readVerified: mcp.readVerified, lastVerifiedAt: mcp.lastVerifiedAt },
    pc: { paired: pc.paired, online: pc.online, name: pc.name, roundTripVerified: pc.roundTripVerified, lastVerifiedAt: pc.lastVerifiedAt },
    naver: { sessionSaved: naver.sessionSaved },
    ready: data.ready,
  };
}

export function emptyConnectionStatus(hasConnection = false, generation = 0): ConnectionStatusSnapshot {
  const exists = hasConnection && Number.isSafeInteger(generation) && generation > 0;
  return {
    channel: { exists, generation: exists ? generation : 0 },
    mcp: { authorized: false, readVerified: false, lastVerifiedAt: null },
    pc: { paired: false, online: false, name: null, roundTripVerified: false, lastVerifiedAt: null },
    naver: { sessionSaved: null }, ready: false,
  };
}

export function defaultOnboardingStep(status: ConnectionStatusSnapshot): OnboardingStep {
  return !status.channel.exists || !status.pc.paired ? 'pc' : !status.mcp.authorized ? 'chatgpt' : 'verify';
}

export const CONNECTION_VERIFY_PROMPT = 'BlogAutoMCP로 연결된 내 PC 상태와 쇼핑 소재 목록을 읽기 전용으로 확인해줘. 작업이 접수되면 같은 작업번호로 완료 또는 오류가 확인될 때까지 조회해줘. 새 글·이미지 생성, 예약·발행, PC 재연결은 하지 마.';

export function connectionTimestamp(value: number | null): string {
  return value === null ? '아직 확인되지 않음' : `${new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`;
}

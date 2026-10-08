type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }

export class MaterialRecoveryRequestError extends Error {
  constructor(message: string, readonly requestRejected: boolean) { super(message); }
}

/** A transport error, malformed body or generic HTTP failure is not nonadmission proof. */
export async function requestMaterialRecoveryJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const payload = object(await response.json());
  if (!response.ok || payload.success !== true) {
    const error = object(payload.error);
    throw new MaterialRecoveryRequestError(String(error.message || '작업 응답을 확인하지 못했습니다.'),
      payload.success === false && payload.requestAccepted === false && typeof error.code === 'string');
  }
  return object(payload.data);
}

type ReadIntent = { idempotencyKey: string; queryJobId?: string; readIdempotencyKey?: string; readRequestUnconfirmed?: boolean };
/** A late response must not erase a newer read intent or a confirmation from another tab. */
export function sameRecoveryRead(current: ReadIntent | null, attempted: ReadIntent): boolean {
  return Boolean(current && current.idempotencyKey === attempted.idempotencyKey &&
    current.readIdempotencyKey === attempted.readIdempotencyKey && attempted.readIdempotencyKey);
}

export function rejectRecoveryRead<T extends ReadIntent>(current: T | null, attempted: ReadIntent, error: unknown): T | null {
  if (!(error instanceof MaterialRecoveryRequestError) || !error.requestRejected || !sameRecoveryRead(current, attempted) ||
      !current?.readRequestUnconfirmed || current.queryJobId !== attempted.queryJobId) return null;
  // Retain the key: another tab's same-key read may have been accepted before
  // this rejection. Its later acknowledgement can still attach the receipt.
  return { ...current, readRequestUnconfirmed: false };
}

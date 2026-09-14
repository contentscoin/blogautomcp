export interface NaverScheduleSubmissionSignal {
  relevant: boolean;
  successfulResponse: boolean;
  hasTargetDate: boolean;
  hasScheduleMode: boolean;
  reservationId: string | null;
  responseAccepted: boolean;
  confirmed: boolean;
}

function decodePayload(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function isNaverPublishingEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return /^(?:[a-z0-9-]+\.)*naver\.com$/i.test(url.hostname) &&
      /write|publish|post|reserve|reservation|schedule|save|rabbit/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function inspectNaverScheduleSubmissionSignal(input: {
  url: string;
  postData: string;
  status: number;
  targetYmd: string;
  responseBody?: unknown;
}): NaverScheduleSubmissionSignal {
  const lowerUrl = input.url.toLowerCase();
  const decodedPayload = decodePayload(input.postData).replace(/\\u([0-9a-f]{4})/gi, (_, code) =>
    String.fromCharCode(Number.parseInt(code, 16))
  );
  const compactPayload = decodedPayload.replace(/\s+/g, "").toLowerCase();
  const dotted = input.targetYmd.replace(/-/g, ".");
  const slashed = input.targetYmd.replace(/-/g, "/");
  const compact = input.targetYmd.replace(/-/g, "");

  const relevant = isNaverPublishingEndpoint(input.url);
  const successfulResponse = input.status >= 200 && input.status < 300;
  const hasTargetDate =
    compactPayload.includes(input.targetYmd) ||
    compactPayload.includes(dotted) ||
    compactPayload.includes(slashed) ||
    compactPayload.includes(compact);
  const hasScheduleMode =
    /reserve|reservation|schedule|pretime|pre_date|predate|pre_post|prepost|reservedtime/.test(
      `${lowerUrl} ${compactPayload}`
    ) ||
    /radio_time(?:%22|["'=:\s])+pre/.test(compactPayload) ||
    /publish(?:mode|type)(?:%22|["'=:\s])+(?:reserve|schedule|pre)/.test(compactPayload);

  // HTTP success and request shape alone cannot prove that Naver accepted it.
  // Unknown response contracts remain unverified; never treat HTML/redirects as success.
  let body: unknown = input.responseBody;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const envelope = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const nested = envelope.result ?? envelope.data;
  const result = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : envelope;
  const rejected = envelope.success === false || envelope.isSuccess === false || result.success === false || result.isSuccess === false || Boolean(envelope.error || result.error || envelope.errorCode || result.errorCode);
  const responseAccepted = !rejected && (envelope.success === true || envelope.isSuccess === true || envelope.result === true || result.success === true || result.isSuccess === true);
  const rawId = result.reservationId ?? result.reserveId ?? result.logNo ?? result.postId ?? envelope.reservationId ?? envelope.logNo;
  // Numeric identifiers must retain their exact value; rounded JSON numbers cannot be receipts.
  const validIdType = typeof rawId === 'string' || (typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0);
  const reservationId = validIdType && /^[A-Za-z0-9_-]{1,100}$/.test(String(rawId)) && String(rawId) !== '0' ? String(rawId) : null;
  return {
    relevant,
    successfulResponse,
    hasTargetDate,
    hasScheduleMode,
    reservationId,
    responseAccepted,
    confirmed: relevant && successfulResponse && hasTargetDate && hasScheduleMode && responseAccepted && Boolean(reservationId),
  };
}

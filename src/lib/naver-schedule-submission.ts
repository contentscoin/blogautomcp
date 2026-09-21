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

function expandPayload(value: string): string {
  let expanded = value;
  // Naver's editor has used URL-encoded form values and JSON strings nested in
  // other JSON payloads. Decode a few bounded rounds so the signal checker sees
  // the date/mode regardless of which transport wrapper carried it.
  for (let i = 0; i < 3; i += 1) {
    const next = decodePayload(expanded).replace(/\\u([0-9a-f]{4})/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16))
    );
    if (next === expanded) break;
    expanded = next;
  }
  return expanded;
}

function epochCarriesTargetDate(payload: string, targetYmd: string): boolean {
  const target = /^\d{4}-\d{2}-\d{2}$/.test(targetYmd) ? targetYmd : "";
  if (!target) return false;
  const candidates = payload.match(/\b\d{10}(?:\d{3})?\b/g) || [];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (!Number.isSafeInteger(numeric)) continue;
    const millis = candidate.length === 10 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    if (!Number.isFinite(date.getTime())) continue;
    // The editor may submit UTC or local midnight. Accept the target day and
    // its adjacent UTC day while the request is explicitly in schedule mode.
    const utcYmd = date.toISOString().slice(0, 10);
    if (utcYmd === target) return true;
    for (const offsetDays of [-1, 1]) {
      const adjacent = new Date(millis + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (adjacent === target) return true;
    }
  }
  return false;
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
  // Query parameters are part of the submission contract too. They are often
  // where the editor keeps the reservation date while the body only contains
  // the article write envelope.
  const queryPayload = (() => {
    try {
      const url = new URL(input.url);
      return [...url.searchParams.entries()].map(([key, value]) => `${key}=${value}`).join("&");
    } catch {
      return "";
    }
  })();
  const decodedPayload = expandPayload(`${input.postData}&${queryPayload}`);
  const compactPayload = decodedPayload.replace(/\s+/g, "").toLowerCase();
  const dotted = input.targetYmd.replace(/-/g, ".");
  const slashed = input.targetYmd.replace(/-/g, "/");
  const compact = input.targetYmd.replace(/-/g, "");
  const [year, month, day] = input.targetYmd.split("-");
  const unpaddedDotted = `${year}.${Number(month)}.${Number(day)}`;
  const unpaddedSlashed = `${year}/${Number(month)}/${Number(day)}`;
  const korean = `${year}년${Number(month)}월${Number(day)}일`;

  const relevant = isNaverPublishingEndpoint(input.url);
  const successfulResponse = input.status >= 200 && input.status < 300;
  const hasTargetDate =
    compactPayload.includes(input.targetYmd) ||
    compactPayload.includes(dotted) ||
    compactPayload.includes(slashed) ||
    compactPayload.includes(compact) ||
    compactPayload.includes(unpaddedDotted) ||
    compactPayload.includes(unpaddedSlashed) ||
    compactPayload.includes(korean) ||
    epochCarriesTargetDate(compactPayload, input.targetYmd);
  const hasScheduleMode =
    /reserve|reservation|schedule|pretime|pre_date|predate|pre_post|prepost|reservedtime/.test(
      `${lowerUrl} ${compactPayload}`
    ) ||
    /(?:예약|예약발행|scheduled)/.test(compactPayload) ||
    /radio_time(?:%22|["'=:\s])+pre/.test(compactPayload) ||
    /publish(?:mode|type)(?:%22|["'=:\s])+(?:reserve|schedule|pre|예약)/.test(compactPayload);

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

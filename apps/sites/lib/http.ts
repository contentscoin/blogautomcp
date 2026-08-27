import { NextResponse } from 'next/server';

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, {
    status,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
  });
}

export async function readObject(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  const rawLength = request.headers.get('content-length');
  if (rawLength) {
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) return null;
  }
  try {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0;
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function hasTrustedBrowserOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
  }
  return ['same-origin', 'same-site'].includes(request.headers.get('sec-fetch-site') || '');
}

export function jsonValue(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

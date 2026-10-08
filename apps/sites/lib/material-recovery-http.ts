import { NextResponse } from 'next/server';

/** Only call before queue admission is possible, or after an explicit queue rejection. */
export function materialRecoveryRejection(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, requestAccepted: false, error: { code, message } }, {
    status,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiKey } from '@/lib/api-auth';
import { getDesktopReadiness } from '@/lib/desktop-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const readiness = await getDesktopReadiness();
  return NextResponse.json({
    success: true,
    data: {
      ...readiness,
      update: {
        currentVersion: process.env.DESKTOP_APP_VERSION || process.env.npm_package_version || null,
        status: process.env.DESKTOP_UPDATE_STATUS || 'unknown',
        version: process.env.DESKTOP_UPDATE_VERSION || null,
        progress: Number(process.env.DESKTOP_UPDATE_PROGRESS || '0'),
        error: process.env.DESKTOP_UPDATE_ERROR || null,
        installPending: process.env.DESKTOP_UPDATE_INSTALL_PENDING === '1',
      },
    },
  }, { headers: { 'cache-control': 'no-store' } });
}

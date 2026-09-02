import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  if (!/^[a-f0-9]{32}\.(?:png|jpg|webp)$/.test(asset)) return new NextResponse('Not found', { status: 404 });
  const object = await env.INSTALLERS.get(`agent-assets/${asset}`);
  if (!object) return new NextResponse('Not found', { status: 404 });
  const expiresAt = Number(object.customMetadata?.expiresAt || '0');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await env.INSTALLERS.delete(`agent-assets/${asset}`).catch(() => undefined);
    return new NextResponse('Gone', { status: 410 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('content-security-policy', "default-src 'none'");
  headers.set('x-content-type-options', 'nosniff');
  return new NextResponse(object.body, { headers });
}

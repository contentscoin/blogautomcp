import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device';
import { apiError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ASSET_TTL_SECONDS = 7 * 24 * 60 * 60;

function imageExtension(contentType: string, bytes: Uint8Array): string | null {
  if (contentType === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (contentType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (contentType === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError('DEVICE_REVOKED', 'PC 인증이 유효하지 않습니다.', 401);
  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (declaredLength > MAX_IMAGE_BYTES) return apiError('ASSET_TOO_LARGE', '이미지는 12MB 이하여야 합니다.', 413);
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength < 16 || buffer.byteLength > MAX_IMAGE_BYTES) return apiError('INVALID_IMAGE', '이미지 크기를 확인하세요.', 413);
  const bytes = new Uint8Array(buffer);
  const extension = imageExtension(contentType, bytes);
  if (!extension) return apiError('INVALID_IMAGE', 'PNG, JPEG, WebP 이미지만 업로드할 수 있습니다.', 422);

  const assetId = crypto.randomUUID().replace(/-/g, '');
  const key = `agent-assets/${assetId}.${extension}`;
  const expiresAt = Date.now() + ASSET_TTL_SECONDS * 1000;
  await env.INSTALLERS.put(key, buffer, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=3600' },
    customMetadata: { userId: device.userId, deviceId: device.id, expiresAt: String(expiresAt) },
  });
  const url = new URL(`/api/assets/${assetId}.${extension}`, request.url).toString();
  return NextResponse.json({ success: true, data: { url, expiresAt: new Date(expiresAt).toISOString() } }, { headers: { 'cache-control': 'no-store' } });
}

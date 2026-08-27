import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount } from '@/lib/account';
import { apiError } from '@/lib/http';
import {
  WINDOWS_INSTALLER_CONTENT_TYPE,
  WINDOWS_INSTALLER_FILENAME,
  WINDOWS_INSTALLER_KEY,
} from '@/lib/installer';
import { readWindowsRelease } from '@/lib/update-release';

export const dynamic = 'force-dynamic';

async function authorizeDownload() {
  const identity = await getChatGPTUser();
  if (!identity) return apiError('AUTH_REQUIRED', 'ChatGPT 로그인이 필요합니다.', 401);
  await ensureAccount(identity);
  return null;
}

function downloadHeaders(object: R2Object, filename: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', WINDOWS_INSTALLER_CONTENT_TYPE);
  headers.set('content-length', String(object.size));
  headers.set('content-disposition', `attachment; filename="${filename}"`);
  headers.set('cache-control', 'private, no-store');
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', object.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return headers;
}

export async function HEAD() {
  const unauthorized = await authorizeDownload();
  if (unauthorized) return unauthorized;
  const release = await readWindowsRelease(env.INSTALLERS);
  const key = release?.installerKey || WINDOWS_INSTALLER_KEY;
  const filename = release?.installerName || WINDOWS_INSTALLER_FILENAME;
  const object = await env.INSTALLERS.head(key);
  if (!object) return apiError('INSTALLER_NOT_READY', '설치 파일을 준비 중입니다.', 404);
  return new Response(null, { status: 200, headers: downloadHeaders(object, filename) });
}

export async function GET() {
  const unauthorized = await authorizeDownload();
  if (unauthorized) return unauthorized;
  const release = await readWindowsRelease(env.INSTALLERS);
  const key = release?.installerKey || WINDOWS_INSTALLER_KEY;
  const filename = release?.installerName || WINDOWS_INSTALLER_FILENAME;
  const object = await env.INSTALLERS.get(key);
  if (!object) return apiError('INSTALLER_NOT_READY', '설치 파일을 준비 중입니다.', 404);
  return new Response(object.body, { status: 200, headers: downloadHeaders(object, filename) });
}

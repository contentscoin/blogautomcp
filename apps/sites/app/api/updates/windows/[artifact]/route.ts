import { env } from 'cloudflare:workers';
import { authenticateDevice } from '@/lib/device';
import { apiError } from '@/lib/http';
import {
  WINDOWS_UPDATE_MANIFEST_KEY,
  updateArtifactKey,
  validUpdateArtifactName,
} from '@/lib/update-release';

export const dynamic = 'force-dynamic';

type ByteRange = { offset: number; length: number };

function artifactKey(artifact: string): string | null {
  if (artifact === 'latest.yml') return WINDOWS_UPDATE_MANIFEST_KEY;
  return validUpdateArtifactName(artifact) ? updateArtifactKey(artifact) : null;
}

function parseRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null;
  if (!value.startsWith('bytes=') || value.includes(',')) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return 'invalid';
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return 'invalid';
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return 'invalid';
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

function responseHeaders(object: R2Object, artifact: string, range: ByteRange | null): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', artifact === 'latest.yml' ? 'application/yaml; charset=utf-8' : 'application/octet-stream');
  headers.set('content-length', String(range?.length || object.size));
  headers.set('cache-control', 'private, no-store');
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', object.httpEtag);
  headers.set('last-modified', object.uploaded.toUTCString());
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  return headers;
}

async function authorize(request: Request) {
  const device = await authenticateDevice(request);
  return device ? null : apiError('DEVICE_UNAUTHORIZED', '승인된 활성 PC만 업데이트를 받을 수 있습니다.', 401);
}

export async function HEAD(request: Request, context: { params: Promise<{ artifact: string }> }) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const { artifact } = await context.params;
  const key = artifactKey(artifact);
  if (!key) return apiError('INVALID_ARTIFACT', '업데이트 파일명을 확인하세요.', 404);
  const object = await env.INSTALLERS.head(key);
  if (!object) return apiError('UPDATE_NOT_READY', '아직 배포된 업데이트가 없습니다.', 404);
  return new Response(null, { status: 200, headers: responseHeaders(object, artifact, null) });
}

export async function GET(request: Request, context: { params: Promise<{ artifact: string }> }) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const { artifact } = await context.params;
  const key = artifactKey(artifact);
  if (!key) return apiError('INVALID_ARTIFACT', '업데이트 파일명을 확인하세요.', 404);
  const metadata = await env.INSTALLERS.head(key);
  if (!metadata) return apiError('UPDATE_NOT_READY', '아직 배포된 업데이트가 없습니다.', 404);
  const range = parseRange(request.headers.get('range'), metadata.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${metadata.size}`, 'cache-control': 'private, no-store' } });
  }
  const object = await env.INSTALLERS.get(key, range ? { range } : undefined);
  if (!object || !('body' in object)) return apiError('UPDATE_READ_FAILED', '업데이트 파일을 읽지 못했습니다.', 502);
  return new Response(object.body, { status: range ? 206 : 200, headers: responseHeaders(object, artifact, range) });
}

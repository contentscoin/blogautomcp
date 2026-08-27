import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { apiError, readObject } from '@/lib/http';
import {
  MAX_INSTALLER_BYTES,
  MAX_UPLOAD_PART_BYTES,
  WINDOWS_INSTALLER_CONTENT_TYPE,
  WINDOWS_INSTALLER_FILENAME,
  WINDOWS_INSTALLER_KEY,
  WINDOWS_INSTALLER_VERSION,
  installerUploadKey,
  safeSecretEqual,
  validUploadId,
} from '@/lib/installer';

export const dynamic = 'force-dynamic';

function authorizeUpload(request: Request) {
  const expected = env.INSTALLER_UPLOAD_KEY?.trim() || installerUploadKey();
  const provided = request.headers.get('x-installer-upload-key')?.trim() || '';
  if (!expected) return apiError('UPLOAD_NOT_CONFIGURED', '설치 파일 업로드가 설정되지 않았습니다.', 503);
  if (!safeSecretEqual(provided, expected)) return apiError('UNAUTHORIZED', '업로드 인증에 실패했습니다.', 401);
  return null;
}

function uploadIdFrom(url: string): string {
  return new URL(url).searchParams.get('uploadId')?.trim() || '';
}

export async function GET(request: Request) {
  const unauthorized = authorizeUpload(request);
  if (unauthorized) return unauthorized;
  const object = await env.INSTALLERS.head(WINDOWS_INSTALLER_KEY);
  if (!object) return apiError('INSTALLER_NOT_READY', '설치 파일이 없습니다.', 404);
  return NextResponse.json({
    success: true,
    data: {
      key: WINDOWS_INSTALLER_KEY,
      size: object.size,
      etag: object.etag,
      version: object.customMetadata?.version || WINDOWS_INSTALLER_VERSION,
      sha256: object.customMetadata?.sha256 || null,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const unauthorized = authorizeUpload(request);
  if (unauthorized) return unauthorized;
  const body = await readObject(request, 256 * 1024);
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'begin') {
    const size = typeof body?.size === 'number' ? body.size : Number.NaN;
    const sha256 = typeof body?.sha256 === 'string' ? body.sha256.toLowerCase() : '';
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_INSTALLER_BYTES) {
      return apiError('INVALID_SIZE', '설치 파일 크기가 허용 범위를 벗어났습니다.', 422);
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) return apiError('INVALID_SHA256', 'SHA-256 값을 확인하세요.', 422);
    const upload = await env.INSTALLERS.createMultipartUpload(WINDOWS_INSTALLER_KEY, {
      httpMetadata: {
        contentType: WINDOWS_INSTALLER_CONTENT_TYPE,
        contentDisposition: `attachment; filename="${WINDOWS_INSTALLER_FILENAME}"`,
      },
      customMetadata: { version: WINDOWS_INSTALLER_VERSION, sha256, size: String(size) },
    });
    return NextResponse.json({ success: true, data: { key: upload.key, uploadId: upload.uploadId } });
  }

  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId.trim() : '';
  if (!validUploadId(uploadId)) return apiError('INVALID_UPLOAD_ID', '업로드 ID를 확인하세요.', 422);
  const upload = env.INSTALLERS.resumeMultipartUpload(WINDOWS_INSTALLER_KEY, uploadId);

  if (action === 'complete') {
    const rawParts = Array.isArray(body?.parts) ? body.parts : [];
    const parts = rawParts.map((part) => {
      const value = part && typeof part === 'object' ? part as Record<string, unknown> : {};
      return { partNumber: Number(value.partNumber), etag: typeof value.etag === 'string' ? value.etag : '' };
    });
    if (
      parts.length < 1 || parts.length > 10_000 ||
      parts.some((part, index) => !Number.isInteger(part.partNumber) || part.partNumber !== index + 1 || part.etag.length < 1 || part.etag.length > 256)
    ) return apiError('INVALID_PARTS', '업로드 조각 목록을 확인하세요.', 422);
    const object = await upload.complete(parts);
    return NextResponse.json({ success: true, data: { key: object.key, size: object.size, etag: object.etag } });
  }

  if (action === 'abort') {
    await upload.abort();
    return NextResponse.json({ success: true, data: { aborted: true } });
  }

  return apiError('INVALID_ACTION', '지원하지 않는 업로드 작업입니다.', 400);
}

export async function PUT(request: Request) {
  const unauthorized = authorizeUpload(request);
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  const uploadId = uploadIdFrom(request.url);
  const partNumber = Number(url.searchParams.get('partNumber'));
  const rawLength = request.headers.get('content-length');
  const contentLength = rawLength ? Number(rawLength) : Number.NaN;
  if (!validUploadId(uploadId)) return apiError('INVALID_UPLOAD_ID', '업로드 ID를 확인하세요.', 422);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return apiError('INVALID_PART', '업로드 조각 번호를 확인하세요.', 422);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_UPLOAD_PART_BYTES) return apiError('INVALID_PART_SIZE', '업로드 조각 크기를 확인하세요.', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== contentLength) return apiError('PART_SIZE_MISMATCH', '업로드 조각 크기가 일치하지 않습니다.', 400);
  const upload = env.INSTALLERS.resumeMultipartUpload(WINDOWS_INSTALLER_KEY, uploadId);
  const part = await upload.uploadPart(partNumber, bytes);
  return NextResponse.json({ success: true, data: part });
}

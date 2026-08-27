import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, isAdmin } from '@/lib/account';
import { apiError, readObject } from '@/lib/http';
import {
  MAX_INSTALLER_BYTES,
  MAX_UPLOAD_PART_BYTES,
  WINDOWS_INSTALLER_CONTENT_TYPE,
  installerUploadKey,
  safeSecretEqual,
  validUploadId,
} from '@/lib/installer';
import {
  MAX_BLOCKMAP_BYTES,
  WINDOWS_RELEASE_POINTER_KEY,
  WINDOWS_UPDATE_MANIFEST_KEY,
  compareStableVersions,
  installerVersionFromName,
  parseUpdateManifest,
  readWindowsRelease,
  updateArtifactKey,
  validUpdateArtifactName,
  type WindowsReleasePointer,
} from '@/lib/update-release';

export const dynamic = 'force-dynamic';

async function authorizeUpdateAdmin(request: Request) {
  const identity = await getChatGPTUser();
  if (identity) {
    const account = await ensureAccount(identity);
    if (isAdmin(account)) return null;
  }
  const expected = env.INSTALLER_UPLOAD_KEY?.trim() || installerUploadKey();
  const provided = request.headers.get('x-installer-upload-key')?.trim() || '';
  if (expected && safeSecretEqual(provided, expected)) return null;
  return apiError('UNAUTHORIZED', '관리자 업데이트 권한이 필요합니다.', 401);
}

function artifactFrom(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return validUpdateArtifactName(name) ? name : null;
}

function uploadIdFrom(url: string): string {
  return new URL(url).searchParams.get('uploadId')?.trim() || '';
}

function artifactContentType(name: string): string {
  return name.endsWith('.exe') ? WINDOWS_INSTALLER_CONTENT_TYPE : 'application/octet-stream';
}

export async function GET(request: Request) {
  const unauthorized = await authorizeUpdateAdmin(request);
  if (unauthorized) return unauthorized;
  const release = await readWindowsRelease(env.INSTALLERS);
  return NextResponse.json({ success: true, data: { release } }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const unauthorized = await authorizeUpdateAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await readObject(request, 256 * 1024);
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'begin') {
    const artifactName = artifactFrom(body?.artifactName);
    if (!artifactName) return apiError('INVALID_ARTIFACT', '업데이트 파일명을 확인하세요.', 422);
    const size = typeof body?.size === 'number' ? body.size : Number.NaN;
    const maximum = artifactName.endsWith('.blockmap') ? MAX_BLOCKMAP_BYTES : MAX_INSTALLER_BYTES;
    if (!Number.isSafeInteger(size) || size < 1 || size > maximum) return apiError('INVALID_SIZE', '업데이트 파일 크기가 허용 범위를 벗어났습니다.', 422);
    const sha256 = typeof body?.sha256 === 'string' ? body.sha256.toLowerCase() : '';
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) return apiError('INVALID_SHA256', 'SHA-256 값을 확인하세요.', 422);
    const sha512 = typeof body?.sha512 === 'string' ? body.sha512 : '';
    if (artifactName.endsWith('.exe') && !/^[A-Za-z0-9+/]{86}==$/.test(sha512)) return apiError('INVALID_SHA512', 'latest.yml의 SHA-512 값을 확인하세요.', 422);
    const version = installerVersionFromName(artifactName.replace(/\.blockmap$/, ''));
    if (!version) return apiError('INVALID_VERSION', '업데이트 버전을 확인하세요.', 422);
    const upload = await env.INSTALLERS.createMultipartUpload(updateArtifactKey(artifactName), {
      httpMetadata: {
        contentType: artifactContentType(artifactName),
        contentDisposition: `attachment; filename="${artifactName}"`,
      },
      customMetadata: {
        version,
        size: String(size),
        ...(sha256 ? { sha256 } : {}),
        ...(sha512 ? { sha512 } : {}),
      },
    });
    return NextResponse.json({ success: true, data: { key: upload.key, uploadId: upload.uploadId } });
  }

  if (action === 'publish') {
    const manifest = typeof body?.manifest === 'string' ? body.manifest : '';
    let parsed;
    try { parsed = parseUpdateManifest(manifest); } catch (error) {
      return apiError('INVALID_MANIFEST', error instanceof Error ? error.message : 'latest.yml을 확인하세요.', 422);
    }
    const installerKey = updateArtifactKey(parsed.installerName);
    const blockmapName = `${parsed.installerName}.blockmap`;
    const blockmapKey = updateArtifactKey(blockmapName);
    const [installer, blockmap, current] = await Promise.all([
      env.INSTALLERS.head(installerKey),
      env.INSTALLERS.head(blockmapKey),
      readWindowsRelease(env.INSTALLERS),
    ]);
    if (!installer || !blockmap) return apiError('ARTIFACT_NOT_READY', '설치 파일과 blockmap을 모두 먼저 업로드하세요.', 409);
    if (installer.size !== parsed.installerSize || installer.customMetadata?.sha512 !== parsed.installerSha512) {
      return apiError('ARTIFACT_MISMATCH', '설치 파일과 latest.yml의 크기 또는 SHA-512가 일치하지 않습니다.', 409);
    }
    if (current && compareStableVersions(parsed.version, current.version) <= 0) {
      return apiError('VERSION_NOT_NEWER', `현재 ${current.version}보다 높은 버전만 배포할 수 있습니다.`, 409);
    }
    const now = new Date().toISOString();
    const release: WindowsReleasePointer = {
      version: parsed.version,
      installerName: parsed.installerName,
      installerKey,
      installerSize: installer.size,
      installerSha512: parsed.installerSha512,
      installerSha256: installer.customMetadata?.sha256 || null,
      blockmapName,
      blockmapKey,
      blockmapSize: blockmap.size,
      releaseDate: parsed.releaseDate,
      publishedAt: now,
    };
    await env.INSTALLERS.put(WINDOWS_UPDATE_MANIFEST_KEY, manifest, {
      httpMetadata: { contentType: 'application/yaml; charset=utf-8', cacheControl: 'no-store' },
      customMetadata: { version: release.version },
    });
    await env.INSTALLERS.put(WINDOWS_RELEASE_POINTER_KEY, JSON.stringify(release), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      customMetadata: { version: release.version },
    });
    return NextResponse.json({ success: true, data: { release }, message: `${release.version} 자동 업데이트가 활성화되었습니다.` });
  }

  const artifactName = artifactFrom(body?.artifactName);
  if (!artifactName) return apiError('INVALID_ARTIFACT', '업데이트 파일명을 확인하세요.', 422);
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId.trim() : '';
  if (!validUploadId(uploadId)) return apiError('INVALID_UPLOAD_ID', '업로드 ID를 확인하세요.', 422);
  const upload = env.INSTALLERS.resumeMultipartUpload(updateArtifactKey(artifactName), uploadId);

  if (action === 'complete') {
    const rawParts = Array.isArray(body?.parts) ? body.parts : [];
    const parts = rawParts.map((part) => {
      const value = part && typeof part === 'object' ? part as Record<string, unknown> : {};
      return { partNumber: Number(value.partNumber), etag: typeof value.etag === 'string' ? value.etag : '' };
    });
    if (parts.length < 1 || parts.length > 10_000 || parts.some((part, index) => !Number.isInteger(part.partNumber) || part.partNumber !== index + 1 || part.etag.length < 1 || part.etag.length > 256)) {
      return apiError('INVALID_PARTS', '업로드 조각 목록을 확인하세요.', 422);
    }
    const object = await upload.complete(parts);
    return NextResponse.json({ success: true, data: { key: object.key, size: object.size, etag: object.etag } });
  }
  if (action === 'abort') {
    await upload.abort();
    return NextResponse.json({ success: true, data: { aborted: true } });
  }
  return apiError('INVALID_ACTION', '지원하지 않는 업데이트 작업입니다.', 400);
}

export async function PUT(request: Request) {
  const unauthorized = await authorizeUpdateAdmin(request);
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  const artifactName = artifactFrom(url.searchParams.get('artifactName'));
  const uploadId = uploadIdFrom(request.url);
  const partNumber = Number(url.searchParams.get('partNumber'));
  if (!artifactName) return apiError('INVALID_ARTIFACT', '업데이트 파일명을 확인하세요.', 422);
  if (!validUploadId(uploadId)) return apiError('INVALID_UPLOAD_ID', '업로드 ID를 확인하세요.', 422);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return apiError('INVALID_PART', '업로드 조각 번호를 확인하세요.', 422);
  const rawLength = request.headers.get('content-length');
  const contentLength = rawLength ? Number(rawLength) : Number.NaN;
  if (rawLength && (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_UPLOAD_PART_BYTES)) return apiError('INVALID_PART_SIZE', '업로드 조각 크기를 확인하세요.', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_UPLOAD_PART_BYTES) return apiError('INVALID_PART_SIZE', '업로드 조각 크기를 확인하세요.', 413);
  if (rawLength && bytes.byteLength !== contentLength) return apiError('PART_SIZE_MISMATCH', '업로드 조각 크기가 일치하지 않습니다.', 400);
  const upload = env.INSTALLERS.resumeMultipartUpload(updateArtifactKey(artifactName), uploadId);
  const part = await upload.uploadPart(partNumber, bytes);
  return NextResponse.json({ success: true, data: part });
}

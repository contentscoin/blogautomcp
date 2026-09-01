import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const PART_SIZE = 20 * 1024 * 1024;
const [baseUrlInput, fileInput] = process.argv.slice(2);
const secret = process.env.INSTALLER_UPLOAD_KEY?.trim() || '';
if (!baseUrlInput || !fileInput) throw new Error('사용법: node publish-macos-installer.mjs <사이트 URL> <DMG 파일>');
if (!secret) throw new Error('INSTALLER_UPLOAD_KEY 환경변수가 필요합니다.');
const baseUrl = new URL(baseUrlInput);
if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname))) throw new Error('HTTPS 사이트 URL만 사용할 수 있습니다.');
const filePath = resolve(fileInput);
const installerName = basename(filePath);
const version = /^BrandConnect\.Automation-(\d+\.\d+\.\d+)-arm64\.dmg$/.exec(installerName)?.[1];
if (!version) throw new Error('macOS 설치 파일명이 올바르지 않습니다.');
const info = await stat(filePath);
if (!info.isFile() || info.size < 1 || info.size > 2 * 1024 * 1024 * 1024) throw new Error('macOS 설치 파일 크기를 확인하세요.');
const hash = createHash('sha256');
for await (const chunk of createReadStream(filePath)) hash.update(chunk);
const sha256 = hash.digest('hex');
const endpoint = new URL('/api/admin/installer/macos', baseUrl);
const headers = { 'x-installer-upload-key': secret };
const common = { version, installerName };
let uploadId = '';

async function readResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload.data;
}

try {
  const begin = await readResponse(await fetch(endpoint, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'begin', ...common, size: info.size, sha256 }),
  }));
  uploadId = begin.uploadId;
  const handle = await open(filePath, 'r');
  const parts = [];
  try {
    let offset = 0;
    let partNumber = 1;
    while (offset < info.size) {
      const length = Math.min(PART_SIZE, info.size - offset);
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, offset);
      if (bytesRead !== length) throw new Error('macOS 설치 파일을 끝까지 읽지 못했습니다.');
      const partUrl = new URL(endpoint);
      Object.entries({ ...common, uploadId, partNumber: String(partNumber) }).forEach(([key, value]) => partUrl.searchParams.set(key, value));
      parts.push(await readResponse(await fetch(partUrl, {
        method: 'PUT', headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(length) }, body: bytes,
      })));
      offset += length;
      console.log(`macOS 설치 파일 업로드 ${Math.round((offset / info.size) * 100)}%`);
      partNumber += 1;
    }
  } finally {
    await handle.close();
  }
  const completed = await readResponse(await fetch(endpoint, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'complete', ...common, uploadId, parts }),
  }));
  if (completed.release?.version !== version || completed.release?.installerSize !== info.size || completed.release?.installerSha256 !== sha256) throw new Error('macOS 설치 파일 게시 검증에 실패했습니다.');
  console.log(JSON.stringify({ success: true, release: completed.release }));
} catch (error) {
  if (uploadId) await fetch(endpoint, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'abort', ...common, uploadId }),
  }).catch(() => undefined);
  throw error;
}

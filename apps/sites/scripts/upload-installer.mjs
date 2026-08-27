import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const [baseUrlInput, fileInput] = process.argv.slice(2);
const secret = process.env.INSTALLER_UPLOAD_KEY?.trim() || '';
if (!baseUrlInput || !fileInput) throw new Error('사용법: npm run installer:upload -- <사이트 URL> <설치 파일 경로>');
if (!secret) throw new Error('INSTALLER_UPLOAD_KEY 환경변수가 필요합니다.');

const baseUrl = new URL(baseUrlInput);
if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname))) {
  throw new Error('HTTPS 사이트 URL만 사용할 수 있습니다.');
}
const filePath = resolve(fileInput);
const file = await stat(filePath);
if (!file.isFile() || file.size < 1) throw new Error('설치 파일을 찾지 못했습니다.');

const hash = createHash('sha256');
for await (const chunk of createReadStream(filePath)) hash.update(chunk);
const sha256 = hash.digest('hex');
const endpoint = new URL('/api/admin/installer', baseUrl);
const headers = { 'x-installer-upload-key': secret };
let uploadId = '';

async function readResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload.data;
}

try {
  const begin = await readResponse(await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'begin', size: file.size, sha256 }),
  }));
  uploadId = begin.uploadId;

  const handle = await open(filePath, 'r');
  const parts = [];
  const partSize = 20 * 1024 * 1024;
  try {
    let offset = 0;
    let partNumber = 1;
    while (offset < file.size) {
      const length = Math.min(partSize, file.size - offset);
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, offset);
      if (bytesRead !== length) throw new Error('설치 파일을 끝까지 읽지 못했습니다.');
      const partUrl = new URL(endpoint);
      partUrl.searchParams.set('uploadId', uploadId);
      partUrl.searchParams.set('partNumber', String(partNumber));
      const uploaded = await readResponse(await fetch(partUrl, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(length) },
        body: bytes,
      }));
      parts.push(uploaded);
      offset += length;
      console.log(`업로드 ${Math.round((offset / file.size) * 100)}%`);
      partNumber += 1;
    }
  } finally {
    await handle.close();
  }

  await readResponse(await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'complete', uploadId, parts }),
  }));
  const verified = await readResponse(await fetch(endpoint, { method: 'GET', headers }));
  if (verified.size !== file.size || verified.sha256 !== sha256) throw new Error('업로드 후 파일 메타데이터 검증에 실패했습니다.');
  console.log(JSON.stringify({ success: true, size: file.size, sha256 }));
} catch (error) {
  if (uploadId) {
    await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'abort', uploadId }),
    }).catch(() => undefined);
  }
  throw error;
}

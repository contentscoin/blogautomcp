import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const PART_SIZE = 20 * 1024 * 1024;
const MAX_INSTALLER_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_BLOCKMAP_SIZE = 128 * 1024 * 1024;
const INSTALLER_NAME = /^BrandConnect-Automation-Setup-(\d+\.\d+\.\d+)\.exe$/;

const inputs = process.argv.slice(2);
const verifyOnly = inputs[0] === '--verify-only';
const [baseUrlInput, outputDirectoryInput] = verifyOnly ? [null, inputs[1]] : inputs;
const secret = process.env.INSTALLER_UPLOAD_KEY?.trim() || '';
if (!outputDirectoryInput || (!verifyOnly && !baseUrlInput)) {
  throw new Error('사용법: npm run update:publish -- <사이트 URL> <출력 폴더> 또는 npm run update:verify -- <출력 폴더>');
}
if (!verifyOnly && !secret) throw new Error('INSTALLER_UPLOAD_KEY 환경변수가 필요합니다.');

const baseUrl = new URL(baseUrlInput || 'https://verify-only.invalid');
if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname))) {
  throw new Error('HTTPS 사이트 URL만 사용할 수 있습니다.');
}

const endpoint = new URL('/api/admin/updates/windows', baseUrl);
const headers = { 'x-installer-upload-key': secret };
const outputDirectory = resolve(outputDirectoryInput);
const manifestPath = resolve(outputDirectory, 'latest.yml');
const manifest = await readFile(manifestPath, 'utf8');

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  return trimmed;
}

function manifestValue(pattern, label) {
  const match = pattern.exec(manifest);
  if (!match?.[1]) throw new Error(`latest.yml의 ${label} 값을 찾지 못했습니다.`);
  return scalar(match[1]);
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseManifest() {
  if (Buffer.byteLength(manifest, 'utf8') > 32 * 1024) throw new Error('latest.yml 크기가 너무 큽니다.');
  const version = manifestValue(/^version:\s*(.+)$/m, 'version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('버전은 x.y.z 형식이어야 합니다.');
  const rawUrl = manifestValue(/^\s*-\s+url:\s*(.+)$/m, 'files.url');
  const installerName = decodeURIComponent(rawUrl);
  if (INSTALLER_NAME.exec(installerName)?.[1] !== version) throw new Error('설치 파일명과 버전이 일치하지 않습니다.');
  const sha512 = manifestValue(/^\s+sha512:\s*(.+)$/m, 'files.sha512');
  const size = Number(manifestValue(/^\s+size:\s*(\d+)\s*$/m, 'files.size'));
  const pathValue = manifestValue(/^path:\s*(.+)$/m, 'path');
  const releaseDate = manifestValue(/^releaseDate:\s*(.+)$/m, 'releaseDate');
  if (!/^[A-Za-z0-9+/]{86}==$/.test(sha512)) throw new Error('latest.yml의 SHA-512 값이 올바르지 않습니다.');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_INSTALLER_SIZE) throw new Error('latest.yml의 설치 파일 크기가 올바르지 않습니다.');
  if (pathValue !== rawUrl && pathValue !== installerName) throw new Error('latest.yml의 path와 files.url이 일치하지 않습니다.');
  if (!Number.isFinite(Date.parse(releaseDate))) throw new Error('latest.yml의 배포 일시가 올바르지 않습니다.');
  return { version, installerName, sha512, size };
}

async function readResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload.data;
}

async function hashFile(filePath, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest(encoding);
}

async function inspectArtifact(filePath, maximum) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1 || info.size > maximum) throw new Error(`업데이트 파일 크기를 확인하세요: ${filePath}`);
  return { size: info.size, sha256: await hashFile(filePath, 'sha256', 'hex') };
}

async function uploadArtifact({ artifactName, filePath, info, sha512 }) {
  let uploadId = '';
  try {
    const begin = await readResponse(await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'begin', artifactName, size: info.size, sha256: info.sha256, ...(sha512 ? { sha512 } : {}) }),
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
        if (bytesRead !== length) throw new Error(`${artifactName} 파일을 끝까지 읽지 못했습니다.`);
        const partUrl = new URL(endpoint);
        partUrl.searchParams.set('artifactName', artifactName);
        partUrl.searchParams.set('uploadId', uploadId);
        partUrl.searchParams.set('partNumber', String(partNumber));
        const uploaded = await readResponse(await fetch(partUrl, {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(length) },
          body: bytes,
        }));
        parts.push(uploaded);
        offset += length;
        console.log(`${artifactName}: ${Math.round((offset / info.size) * 100)}%`);
        partNumber += 1;
      }
    } finally {
      await handle.close();
    }
    const completed = await readResponse(await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'complete', artifactName, uploadId, parts }),
    }));
    if (completed.size !== info.size) throw new Error(`${artifactName} 업로드 크기 검증에 실패했습니다.`);
  } catch (error) {
    if (uploadId) {
      await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'abort', artifactName, uploadId }),
      }).catch(() => undefined);
    }
    throw error;
  }
}

const parsed = parseManifest();
const installerPath = resolve(outputDirectory, parsed.installerName);
const blockmapName = `${parsed.installerName}.blockmap`;
const blockmapPath = resolve(outputDirectory, blockmapName);
const [installerInfo, blockmapInfo] = await Promise.all([
  inspectArtifact(installerPath, MAX_INSTALLER_SIZE),
  inspectArtifact(blockmapPath, MAX_BLOCKMAP_SIZE),
]);
if (installerInfo.size !== parsed.size) throw new Error('설치 파일 크기가 latest.yml과 일치하지 않습니다.');
const actualSha512 = await hashFile(installerPath, 'sha512', 'base64');
if (actualSha512 !== parsed.sha512) throw new Error('설치 파일 SHA-512가 latest.yml과 일치하지 않습니다.');

if (verifyOnly) {
  console.log(JSON.stringify({
    success: true,
    version: parsed.version,
    installerName: parsed.installerName,
    installerSize: installerInfo.size,
    installerSha256: installerInfo.sha256,
    installerSha512: actualSha512,
    blockmapName,
    blockmapSize: blockmapInfo.size,
    blockmapSha256: blockmapInfo.sha256,
  }));
  process.exit(0);
}

const before = await readResponse(await fetch(endpoint, { headers }));
if (before.release && compareVersions(parsed.version, before.release.version) <= 0) {
  throw new Error(`현재 ${before.release.version}보다 높은 버전만 배포할 수 있습니다.`);
}

console.log(`${parsed.version} 업데이트 무결성 검증 완료. 중앙 업로드를 시작합니다.`);
await uploadArtifact({ artifactName: blockmapName, filePath: blockmapPath, info: blockmapInfo, sha512: null });
await uploadArtifact({ artifactName: parsed.installerName, filePath: installerPath, info: installerInfo, sha512: parsed.sha512 });
const published = await readResponse(await fetch(endpoint, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'publish', manifest }),
}));
const verified = await readResponse(await fetch(endpoint, { headers }));
if (verified.release?.version !== parsed.version || verified.release?.installerName !== parsed.installerName || verified.release?.installerSize !== parsed.size) {
  throw new Error('중앙 배포 후 릴리스 검증에 실패했습니다.');
}
console.log(JSON.stringify({ success: true, release: published.release }));

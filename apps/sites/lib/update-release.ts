export const WINDOWS_UPDATE_PREFIX = 'updates/windows';
export const WINDOWS_UPDATE_MANIFEST_KEY = `${WINDOWS_UPDATE_PREFIX}/latest.yml`;
export const WINDOWS_RELEASE_POINTER_KEY = `${WINDOWS_UPDATE_PREFIX}/release.json`;
export const MAX_UPDATE_MANIFEST_BYTES = 32 * 1024;
export const MAX_BLOCKMAP_BYTES = 128 * 1024 * 1024;

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const INSTALLER_NAME = /^BrandConnect-Automation-Setup-(\d+\.\d+\.\d+)\.exe$/;

export type WindowsReleasePointer = {
  version: string;
  installerName: string;
  installerKey: string;
  installerSize: number;
  installerSha512: string;
  installerSha256: string | null;
  blockmapName: string;
  blockmapKey: string;
  blockmapSize: number;
  releaseDate: string;
  publishedAt: string;
};

export type ParsedUpdateManifest = {
  version: string;
  installerName: string;
  installerSha512: string;
  installerSize: number;
  releaseDate: string;
};

export function updateArtifactKey(name: string): string {
  return `${WINDOWS_UPDATE_PREFIX}/${name}`;
}

export function installerVersionFromName(name: string): string | null {
  return INSTALLER_NAME.exec(name)?.[1] || null;
}

export function validUpdateArtifactName(name: string): boolean {
  const installerName = name.endsWith('.blockmap') ? name.slice(0, -'.blockmap'.length) : name;
  return INSTALLER_NAME.test(installerName);
}

export function compareStableVersions(left: string, right: string): number {
  const leftMatch = STABLE_VERSION.exec(left);
  const rightMatch = STABLE_VERSION.exec(right);
  if (!leftMatch || !rightMatch) throw new Error('안정 버전은 x.y.z 형식이어야 합니다.');
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (delta !== 0) return delta;
  }
  return 0;
}

function yamlScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { throw new Error('업데이트 메타데이터 문자열을 읽을 수 없습니다.'); }
  }
  return value;
}

function manifestValue(manifest: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(manifest);
  if (!match?.[1]) throw new Error(`latest.yml의 ${label} 값을 찾지 못했습니다.`);
  return yamlScalar(match[1]);
}

export function parseUpdateManifest(manifest: string): ParsedUpdateManifest {
  if (!manifest || new TextEncoder().encode(manifest).byteLength > MAX_UPDATE_MANIFEST_BYTES) {
    throw new Error('latest.yml 크기가 허용 범위를 벗어났습니다.');
  }
  const version = manifestValue(manifest, /^version:\s*(.+)$/m, 'version');
  if (!STABLE_VERSION.test(version)) throw new Error('업데이트 버전은 x.y.z 형식이어야 합니다.');

  const rawUrl = manifestValue(manifest, /^\s*-\s+url:\s*(.+)$/m, 'files.url');
  let installerName: string;
  try { installerName = decodeURIComponent(rawUrl); } catch { throw new Error('업데이트 설치 파일명이 올바르지 않습니다.'); }
  if (!validUpdateArtifactName(installerName) || installerName.endsWith('.blockmap')) {
    throw new Error('업데이트 설치 파일명이 허용된 형식이 아닙니다.');
  }
  if (installerVersionFromName(installerName) !== version) throw new Error('설치 파일명과 업데이트 버전이 일치하지 않습니다.');

  const installerSha512 = manifestValue(manifest, /^\s+sha512:\s*(.+)$/m, 'files.sha512');
  if (!/^[A-Za-z0-9+/]{86}==$/.test(installerSha512)) throw new Error('설치 파일 SHA-512 값이 올바르지 않습니다.');
  const installerSize = Number(manifestValue(manifest, /^\s+size:\s*(\d+)\s*$/m, 'files.size'));
  if (!Number.isSafeInteger(installerSize) || installerSize < 1) throw new Error('설치 파일 크기가 올바르지 않습니다.');

  const pathValue = manifestValue(manifest, /^path:\s*(.+)$/m, 'path');
  if (pathValue !== rawUrl && pathValue !== installerName) throw new Error('latest.yml의 path와 files.url이 일치하지 않습니다.');
  const releaseDate = manifestValue(manifest, /^releaseDate:\s*(.+)$/m, 'releaseDate');
  if (!Number.isFinite(Date.parse(releaseDate))) throw new Error('업데이트 배포 일시가 올바르지 않습니다.');

  return { version, installerName, installerSha512, installerSize, releaseDate };
}

export async function readWindowsRelease(bucket: R2Bucket): Promise<WindowsReleasePointer | null> {
  const object = await bucket.get(WINDOWS_RELEASE_POINTER_KEY);
  if (!object || object.size > 64 * 1024) return null;
  try {
    const value = JSON.parse(await object.text()) as WindowsReleasePointer;
    if (!STABLE_VERSION.test(value.version)) return null;
    if (!validUpdateArtifactName(value.installerName) || value.installerName.endsWith('.blockmap')) return null;
    if (installerVersionFromName(value.installerName) !== value.version) return null;
    if (value.installerKey !== updateArtifactKey(value.installerName)) return null;
    if (value.blockmapName !== `${value.installerName}.blockmap`) return null;
    if (value.blockmapKey !== updateArtifactKey(value.blockmapName)) return null;
    if (!Number.isSafeInteger(value.installerSize) || value.installerSize < 1) return null;
    if (!Number.isSafeInteger(value.blockmapSize) || value.blockmapSize < 1) return null;
    if (!/^[A-Za-z0-9+/]{86}==$/.test(value.installerSha512)) return null;
    if (value.installerSha256 !== null && !/^[a-f0-9]{64}$/.test(value.installerSha256)) return null;
    if (!Number.isFinite(Date.parse(value.releaseDate)) || !Number.isFinite(Date.parse(value.publishedAt))) return null;
    return value;
  } catch {
    return null;
  }
}

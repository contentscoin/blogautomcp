export const WINDOWS_INSTALLER_VERSION = '1.2.3';
export const WINDOWS_INSTALLER_KEY = `windows/BrandConnect-Automation-Setup-${WINDOWS_INSTALLER_VERSION}.exe`;
export const WINDOWS_INSTALLER_FILENAME = `BrandConnect-Automation-Setup-${WINDOWS_INSTALLER_VERSION}.exe`;
export const WINDOWS_INSTALLER_CONTENT_TYPE = 'application/vnd.microsoft.portable-executable';
export const MACOS_INSTALLER_CONTENT_TYPE = 'application/x-apple-diskimage';
export const MACOS_INSTALLER_PREFIX = 'installers/macos';
export const MACOS_RELEASE_POINTER_KEY = `${MACOS_INSTALLER_PREFIX}/release.json`;

export type MacosReleasePointer = {
  version: string;
  installerName: string;
  installerKey: string;
  installerSize: number;
  installerSha256: string;
  publishedAt: string;
};

export function macosInstallerFilename(version: string): string {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('macOS 설치 파일 버전이 올바르지 않습니다.');
  }
  return `BrandConnect.Automation-${version}-arm64.dmg`;
}

export function macosInstallerKey(version: string): string {
  return `${MACOS_INSTALLER_PREFIX}/${macosInstallerFilename(version)}`;
}

export async function readMacosRelease(bucket: R2Bucket): Promise<MacosReleasePointer | null> {
  const object = await bucket.get(MACOS_RELEASE_POINTER_KEY);
  if (!object || object.size > 64 * 1024) return null;
  try {
    const value = JSON.parse(await object.text()) as MacosReleasePointer;
    if (macosInstallerFilename(value.version) !== value.installerName) return null;
    if (macosInstallerKey(value.version) !== value.installerKey) return null;
    if (!Number.isSafeInteger(value.installerSize) || value.installerSize < 1) return null;
    if (!/^[a-f0-9]{64}$/.test(value.installerSha256)) return null;
    if (!Number.isFinite(Date.parse(value.publishedAt))) return null;
    return value;
  } catch {
    return null;
  }
}

export const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_UPLOAD_PART_BYTES = 50 * 1024 * 1024;

export function installerUploadKey(): string {
  const cloudflareEnv = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  return cloudflareEnv?.INSTALLER_UPLOAD_KEY?.trim() || '';
}

export function safeSecretEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function validUploadId(value: string): boolean {
  return value.length >= 8 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
}

export const WINDOWS_INSTALLER_VERSION = '1.2.2';
export const WINDOWS_INSTALLER_KEY = `windows/BrandConnect-Automation-Setup-${WINDOWS_INSTALLER_VERSION}.exe`;
export const WINDOWS_INSTALLER_FILENAME = `BrandConnect-Automation-Setup-${WINDOWS_INSTALLER_VERSION}.exe`;
export const WINDOWS_INSTALLER_CONTENT_TYPE = 'application/vnd.microsoft.portable-executable';

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

/** Shared by the desktop sender and Sites receiver. Limits count UTF-8 bytes. */
export const COMPLETION_RESULT_MAX_BYTES = 7 * 1024 * 1024;
export const COMPLETION_BODY_MAX_BYTES = 8 * 1024 * 1024;
export const COMPLETION_INLINE_MAX_BYTES = 900 * 1024;
export const COMPLETION_CHUNK_CHARS = 60_000;
export const COMPLETION_MAX_CHUNKS = 128;
export const COMPLETION_REFERENCE_VERSION = 'completion-chunks/v1';

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, normalize(child)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

export function sameCanonicalJson(left: string, right: string): boolean {
  try { return canonicalJson(JSON.parse(left)) === canonicalJson(JSON.parse(right)); } catch { return false; }
}

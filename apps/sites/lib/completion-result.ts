import type { getD1 } from '@/db';
import { COMPLETION_MAX_CHUNKS, COMPLETION_REFERENCE_VERSION, COMPLETION_RESULT_MAX_BYTES } from '@/lib/completion-contract';

export type CompletionReference = { version: typeof COMPLETION_REFERENCE_VERSION; sha256: string; chunks: number; bytes: number };
export function completionReference(value: unknown): CompletionReference | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as CompletionReference;
  return ref.version === COMPLETION_REFERENCE_VERSION && /^[a-f0-9]{64}$/.test(ref.sha256) &&
    Number.isInteger(ref.chunks) && ref.chunks > 0 && ref.chunks <= COMPLETION_MAX_CHUNKS &&
    Number.isInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= COMPLETION_RESULT_MAX_BYTES ? ref : null;
}
export async function sha256Text(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Authorization is enforced by the owning job query and again by user_id here. */
export async function readCompletionResult(d1: ReturnType<typeof getD1>, userId: string, jobId: string, stored: string | null): Promise<string | null> {
  if (!stored) return stored;
  let value: unknown;
  try { value = JSON.parse(stored); } catch { return stored; }
  const ref = completionReference((value as { completionReference?: unknown })?.completionReference);
  if (!ref) return stored;
  const rows = await d1.prepare('SELECT chunk_index AS chunkIndex,content FROM agent_job_result_chunks WHERE job_id=? AND user_id=? AND result_hash=? ORDER BY chunk_index')
    .bind(jobId, userId, ref.sha256).all<{ chunkIndex: number; content: string }>();
  if (rows.results?.length !== ref.chunks || rows.results.some((row, index) => row.chunkIndex !== index)) throw new Error('RESULT_CHUNKS_INCOMPLETE');
  const result = rows.results.map(row => row.content).join('');
  if (new TextEncoder().encode(result).byteLength !== ref.bytes || await sha256Text(result) !== ref.sha256) throw new Error('RESULT_INTEGRITY_FAILED');
  try { JSON.parse(result); } catch { throw new Error('RESULT_JSON_INVALID'); }
  return result;
}

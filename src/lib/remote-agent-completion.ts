import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export type PendingCompletion = {
  job: { id: string; type: string };
  body: Record<string, unknown>;
};
export const OUTBOX_MAX_BYTES = 8 * 1024 * 1024;
type OutboxRecord = PendingCompletion | { blocked: string };
const memoryPending = new Map<string, OutboxRecord>();

function checkedRecord(value: OutboxRecord): PendingCompletion {
  if ('blocked' in value) throw new Error('Completion outbox blocked: inspect local result before retrying');
  if (!value?.job || typeof value.job.id !== 'string' || !/^job_[A-Za-z0-9_-]{1,80}$/.test(value.job.id) || typeof value.job.type !== 'string' || value.job.type.length > 100 || !['SUCCEEDED', 'FAILED'].includes(String(value.body?.status))) throw new Error('Invalid completion outbox');
  return value;
}

/** Bound to the activation without persisting its credential. Never replay execution. */
export function completionOutbox(root: string, siteUrl: string, token: string) {
  const identity = createHash('sha256').update(`${siteUrl}\0${token}`).digest('hex');
  const file = path.join(root, 'remote-agent-completions', `${identity}.json`);
  return {
    read(): PendingCompletion | null {
      if (memoryPending.has(file)) return checkedRecord(memoryPending.get(file)!);
      try {
        if (fs.statSync(file).size > OUTBOX_MAX_BYTES) throw new Error('Completion outbox exceeds size limit');
        return checkedRecord(JSON.parse(fs.readFileSync(file, 'utf8')) as OutboxRecord);
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    save(value: PendingCompletion) {
      checkedRecord(value);
      const serialized = JSON.stringify(value);
      // Fail closed with a small marker, never truncate a result or persist a credential.
      const blocked = Buffer.byteLength(serialized, 'utf8') > OUTBOX_MAX_BYTES || (token.length > 0 && serialized.includes(token));
      const record = blocked ? { blocked: 'RESULT_REQUIRES_LOCAL_REVIEW' } : JSON.parse(serialized) as PendingCompletion;
      memoryPending.set(file, record);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temp, blocked ? JSON.stringify(record) : serialized, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temp, file);
      } finally {
        try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      if (blocked) throw new Error('Completion result requires local review; no execution replay allowed');
    },
    clear() {
      try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      memoryPending.delete(file);
    },
  };
}

export class CompletionDeliveryError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Retry only the identical completion body, never the operation that produced it. */
export async function deliverCompletion(send: () => Promise<void>, delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { await send(); return; }
    catch (error) {
      const permanent = error instanceof CompletionDeliveryError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      if (permanent || attempt === 2) throw error;
      await delay(500 * (attempt + 1));
    }
  }
}

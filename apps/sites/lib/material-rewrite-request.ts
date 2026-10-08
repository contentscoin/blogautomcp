/** Account-scoped browser recovery: a lost HTTP response keeps its original request and key. */
import type { RecoveryState } from '@/lib/material-recovery-guard';
export type SavedRewriteRequest = { version: 1; connectKind: 'all' | 'shopping' | 'travel'; idempotencyKey: string; rewriteJobId?: string; queryJobId?: string; readIdempotencyKey?: string; recoveryState?: RecoveryState; readRequestUnconfirmed?: boolean };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function storageKey(accountId: string) { return `blogautomcp:failed-material-rewrite:${encodeURIComponent(accountId)}`; }
export function readSavedRewrite(storage: Pick<Storage, 'getItem'>, accountId: string): SavedRewriteRequest | null {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(accountId)) || 'null') as SavedRewriteRequest | null;
    if (!saved || saved.version !== 1 || !['all', 'shopping', 'travel'].includes(saved.connectKind) || typeof saved.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(saved.idempotencyKey)) return null;
    if ([saved.rewriteJobId, saved.queryJobId].some(value => value !== undefined && (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)))) return null;
    if (saved.readIdempotencyKey !== undefined && (typeof saved.readIdempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(saved.readIdempotencyKey))) return null;
    if (saved.recoveryState !== undefined && !['pending', 'workflowPending', 'complete'].includes(saved.recoveryState)) return null;
    if (saved.readRequestUnconfirmed !== undefined && typeof saved.readRequestUnconfirmed !== 'boolean') return null;
    return saved;
  } catch { return null; }
}
export function saveRewrite(storage: StorageLike, accountId: string, request: SavedRewriteRequest) {
  storage.setItem(storageKey(accountId), JSON.stringify(request));
}

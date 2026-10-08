/** Account-scoped browser recovery: a lost HTTP response keeps its original request and key. */
import type { RecoveryState } from '@/lib/material-recovery-guard';
export type SavedRepairRequest = { version: 1; connectKind: 'all' | 'shopping' | 'travel'; idempotencyKey: string; productIds?: string[]; repairJobId?: string; queryJobId?: string; readIdempotencyKey?: string; readRequestJobId?: string; recoveryState?: RecoveryState; readRequestUnconfirmed?: boolean };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function storageKey(accountId: string) { return `blogautomcp:blocked-material-repair:${encodeURIComponent(accountId)}`; }
export function readSavedRepair(storage: Pick<Storage, 'getItem'>, accountId: string): SavedRepairRequest | null {
  const raw = storage.getItem(storageKey(accountId));
  if (raw === null) return null;
  // An unreadable pending request must not silently become a new request for all materials.
  const saved = JSON.parse(raw) as SavedRepairRequest | null;
  const invalid = () => { throw new Error('저장된 보완 요청을 확인하지 못했습니다. 원래 요청번호와 대상을 복구한 뒤 다시 확인하세요.'); };
  if (!saved || saved.version !== 1 || !['all', 'shopping', 'travel'].includes(saved.connectKind) || typeof saved.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(saved.idempotencyKey)) return invalid();
  if ([saved.repairJobId, saved.queryJobId, saved.readRequestJobId].some(value => value !== undefined && (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)))) return invalid();
  if (saved.readIdempotencyKey !== undefined && (typeof saved.readIdempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(saved.readIdempotencyKey))) return invalid();
  if (saved.productIds !== undefined && (!Array.isArray(saved.productIds) || saved.productIds.length < 1 || saved.productIds.length > 50 || new Set(saved.productIds).size !== saved.productIds.length || saved.productIds.some(value => typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)))) return invalid();
  if (saved.recoveryState !== undefined && !['pending', 'workflowPending', 'complete'].includes(saved.recoveryState)) return invalid();
  if (saved.readRequestUnconfirmed !== undefined && typeof saved.readRequestUnconfirmed !== 'boolean') return invalid();
  return saved;
}
export function saveRepair(storage: StorageLike, accountId: string, request: SavedRepairRequest) {
  storage.setItem(storageKey(accountId), JSON.stringify(request));
}

import { readSavedRepair } from '@/lib/material-repair-request';
import { readSavedRewrite } from '@/lib/material-rewrite-request';

export type RecoveryOperation = 'rewrite' | 'repair';
export type RecoveryState = 'pending' | 'workflowPending' | 'complete';
export const MATERIAL_RECOVERY_CHANGED = 'blogautomcp:material-recovery-changed';
type StorageLike = Pick<Storage, 'getItem'>;

/** Missing completion evidence (including pre-upgrade saved jobs) keeps both new actions locked. */
export function recoveryActivity(storage: StorageLike, accountId: string) {
  const rewrite = readSavedRewrite(storage, accountId);
  const repair = readSavedRepair(storage, accountId);
  const active = (saved: { recoveryState?: RecoveryState; readRequestUnconfirmed?: boolean } | null, jobId?: string) =>
    Boolean(saved && (!jobId || saved.readRequestUnconfirmed || saved.recoveryState !== 'complete'));
  // The old rewrite reader treats malformed JSON as empty; don't let that erase an unknown intent.
  const invalidRewrite = !rewrite && storage.getItem(`blogautomcp:failed-material-rewrite:${encodeURIComponent(accountId)}`) !== null;
  return { rewrite: invalidRewrite || active(rewrite, rewrite?.rewriteJobId), repair: active(repair, repair?.repairJobId) };
}

export function canStartNewRecovery(storage: StorageLike, accountId: string, operation: RecoveryOperation) {
  try {
    const activity = recoveryActivity(storage, accountId);
    return !activity[operation] && !activity[operation === 'rewrite' ? 'repair' : 'rewrite'];
  } catch { return false; }
}

export function browserRecoveryGuardSnapshot(accountId: string) {
  try { return JSON.stringify(recoveryActivity(localStorage, accountId)); }
  catch { return 'unavailable'; }
}

export function notifyMaterialRecovery() { window.dispatchEvent(new Event(MATERIAL_RECOVERY_CHANGED)); }
export function subscribeMaterialRecovery(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(MATERIAL_RECOVERY_CHANGED, onChange);
  return () => { window.removeEventListener('storage', onChange); window.removeEventListener(MATERIAL_RECOVERY_CHANGED, onChange); };
}

export function observedRecoveryState(status: unknown, workflowPending: unknown): RecoveryState {
  return ['QUEUED', 'RUNNING'].includes(String(status)) ? 'pending' : workflowPending !== false ? 'workflowPending' : 'complete';
}

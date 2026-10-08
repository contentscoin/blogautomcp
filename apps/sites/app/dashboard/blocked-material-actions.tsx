'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { compareVersions } from '@/lib/version';
import { browserRecoveryGuardSnapshot, canStartNewRecovery, notifyMaterialRecovery, observedRecoveryState, subscribeMaterialRecovery } from '@/lib/material-recovery-guard';
import { readSavedRepair, saveRepair, type SavedRepairRequest } from '@/lib/material-repair-request';
import { rejectRecoveryRead, requestMaterialRecoveryJson as requestJson, sameRecoveryRead } from '@/lib/material-recovery-client';

type JobState = {
  jobId: string; status: string; progress?: number; stageMessage?: string | null;
  errorCode?: string | null; errorMessage?: string | null; workflowPending?: boolean; workflowUncertain?: boolean; executionNotAdmitted?: boolean;
  workflowJobId?: string | null; readyCount?: number; failedCount?: number; interruptedCount?: number;
};
const ENDPOINT = '/api/materials/repair-blocked';
const MINIMUM_APP_VERSION = '1.3.99';
const RECOVERY_CHANGED = 'blogautomcp:blocked-material-repair-changed';
function subscribeRecovery(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(RECOVERY_CHANGED, onChange);
  return () => { window.removeEventListener('storage', onChange); window.removeEventListener(RECOVERY_CHANGED, onChange); };
}
function browserRecoverySnapshot(accountId: string) {
  try { return JSON.stringify(readSavedRepair(localStorage, accountId)); }
  catch { return 'unavailable'; }
}
function persistRecovery(accountId: string, request: SavedRepairRequest) {
  saveRepair(localStorage, accountId, request);
  window.dispatchEvent(new Event(RECOVERY_CHANGED));
  notifyMaterialRecovery();
}
function queuedJob(data: Record<string, unknown>): JobState {
  if (typeof data.jobId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(data.jobId) || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(data.status)))
    throw new Error('접수 응답의 작업번호를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요.');
  return data as JobState;
}

export function BlockedMaterialActions({ accountId, online, appVersion, hasConnection, activeWork }: { accountId: string; online: boolean; appVersion: string | null; hasConnection: boolean; activeWork: boolean }) {
  const [selectedKind, setSelectedKind] = useState<SavedRepairRequest['connectKind'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [observation, setObservation] = useState<JobState | null>(null);
  // A stable serialized snapshot restores browser state through React's external-store subscription.
  const recoverySnapshot = useSyncExternalStore(subscribeRecovery, () => browserRecoverySnapshot(accountId), () => 'server');
  const guardSnapshot = useSyncExternalStore(subscribeMaterialRecovery, () => browserRecoveryGuardSnapshot(accountId), () => 'server');
  const otherOperation = 'rewrite';
  const competingRecovery = guardSnapshot === 'unavailable' || (guardSnapshot !== 'server' && JSON.parse(guardSnapshot)[otherOperation] === true);
  const storageReady = !['server', 'unavailable'].includes(recoverySnapshot) && guardSnapshot !== 'unavailable';
  const saved = storageReady ? JSON.parse(recoverySnapshot) as SavedRepairRequest | null : null;
  const repairJobId = saved?.repairJobId || '';
  const queryJobId = saved?.queryJobId || repairJobId;
  const job: JobState | null = queryJobId
    ? observation?.jobId === queryJobId ? observation : { jobId: queryJobId, status: 'RESTORING' }
    : null;
  const unconfirmed = Boolean(saved && !saved.repairJobId);
  const pending = Boolean(job && ['RESTORING', 'QUEUED', 'RUNNING'].includes(job.status));
  const connectKind = (unconfirmed || pending ? saved?.connectKind : selectedKind || saved?.connectKind) || 'all';
  const observedJobId = job?.jobId;
  const versionReady = compareVersions(appVersion, MINIMUM_APP_VERSION) >= 0;
  const blocked = !hasConnection ? 'PC 앱 연결이 필요합니다.' : !online ? 'PC 앱을 켜고 연결 상태를 확인하세요.' : !versionReady ? `PC 앱 ${MINIMUM_APP_VERSION} 이상으로 업데이트하세요. 현재 ${appVersion || '버전 확인 중'}.` : activeWork ? '진행 중인 작업이 끝나면 사용할 수 있습니다.' : competingRecovery ? '다른 소재 복구 요청의 상태를 먼저 확인하세요.' : '';

  useEffect(() => {
    if (!observedJobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await requestJson(`${ENDPOINT}?jobId=${encodeURIComponent(observedJobId)}`);
        if (stopped) return;
        setObservation(next as JobState);
        setMessage('');
        if (['QUEUED', 'RUNNING'].includes(String(next.status))) timer = setTimeout(poll, 5000);
        else if (next.workflowPending === true) setMessage(next.workflowUncertain === true ? '원 소재 작업의 종료를 확인하지 못했습니다. 같은 작업의 최종 결과를 조회하세요.' : 'PC에서 보완·검증을 계속하고 있습니다. 아래 버튼으로 최종 소재 결과를 조회하세요.');
        {
          const current = readSavedRepair(localStorage, accountId);
          if (current && (current.queryJobId || current.repairJobId) === observedJobId)
            persistRecovery(accountId, { ...current, recoveryState: observedRecoveryState(next.status, next.workflowPending), ...(current.readIdempotencyKey && current.readRequestJobId === observedJobId && !current.readRequestUnconfirmed && !['QUEUED', 'RUNNING'].includes(String(next.status)) ? { readIdempotencyKey: undefined, readRequestJobId: undefined } : {}) });
        }
      } catch (error) {
        if (stopped) return;
        setMessage(`${error instanceof Error ? error.message : '조회하지 못했습니다.'} 기존 작업 상태를 다시 확인하고 있습니다.`);
        timer = setTimeout(poll, 10000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [observedJobId, accountId]);

  async function repair() {
    setBusy(true); setMessage('');
    try {
      const previous = readSavedRepair(localStorage, accountId);
      if ((!previous || previous.repairJobId) && !canStartNewRecovery(localStorage, accountId, 'repair'))
        throw new Error('기존 소재 복구 요청의 상태를 먼저 확인하세요. 새 요청은 만들지 않았습니다.');
      const request: SavedRepairRequest = previous && !previous.repairJobId ? previous
        : { version: 1, connectKind, idempotencyKey: `repair-${crypto.randomUUID()}` };
      persistRecovery(accountId, request);
      const data = await requestJson(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(request.connectKind !== 'all' ? { connectKind: request.connectKind } : {}), ...(request.productIds ? { productIds: request.productIds } : {}), idempotencyKey: request.idempotencyKey }) });
      const accepted = queuedJob(data);
      const latest = readSavedRepair(localStorage, accountId);
      if (!latest || latest.idempotencyKey !== request.idempotencyKey || (latest.repairJobId && latest.repairJobId !== accepted.jobId)) return;
      // Retain another tab's root completion and subsequent read intent rather
      // than replacing them with this older POST response.
      if (latest.repairJobId || latest.queryJobId || latest.readIdempotencyKey || latest.readRequestJobId || latest.readRequestUnconfirmed) return;
      persistRecovery(accountId, { ...latest, repairJobId: accepted.jobId, queryJobId: accepted.jobId, recoveryState: 'pending' });
      setObservation(accepted);
      setMessage('보완 필요 소재 보완·검증 요청을 접수했습니다. PC가 기존 원고·이미지를 보존하고 부족한 부분을 보완합니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '접수하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function readWorkflow() {
    setBusy(true); setMessage('');
    let attempted: SavedRepairRequest | null = null;
    try {
      const current = readSavedRepair(localStorage, accountId);
      if (!current?.repairJobId) throw new Error('저장된 보완 작업번호를 확인하지 못했습니다.');
      const request = { ...current, readRequestUnconfirmed: true, readIdempotencyKey: current.readIdempotencyKey || `repair-read-${crypto.randomUUID()}` };
      attempted = request;
      persistRecovery(accountId, request);
      const data = await requestJson(ENDPOINT, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repairJobId: request.repairJobId, idempotencyKey: request.readIdempotencyKey }) });
      const accepted = queuedJob(data);
      const latest = readSavedRepair(localStorage, accountId);
      if (!latest || !sameRecoveryRead(latest, request) || latest.repairJobId !== request.repairJobId) return;
      persistRecovery(accountId, { ...latest, queryJobId: accepted.jobId, readRequestJobId: accepted.jobId, readRequestUnconfirmed: false, recoveryState: observedRecoveryState(accepted.status, accepted.workflowPending) });
      setObservation(accepted);
      setMessage('같은 소재 작업의 최신 검증 결과를 조회하고 있습니다.');
    } catch (error) {
      try {
        if (attempted) {
          const resolved = rejectRecoveryRead(readSavedRepair(localStorage, accountId), attempted, error);
          if (resolved) persistRecovery(accountId, resolved);
        }
      } catch { /* Unreadable storage preserves the unknown intent and shared lock. */ }
      setMessage(error instanceof Error ? error.message : '조회하지 못했습니다.');
    }
    finally { setBusy(false); }
  }

  const completed = job?.status === 'SUCCEEDED' && job.workflowPending === false;
  return <section className="data-card failed-material-card">
    <div className="card-title"><div><span className="card-kicker">MATERIAL RECOVERY</span><h2>보완 필요 소재 일괄 보완</h2></div><span className="number-chip">부분 보완 → 검증 → 준비</span></div>
    <p>저장된 원고를 바탕으로 부족한 부분을 보강하고 정상 이미지를 보존합니다. 이미지·승인만 부족하면 원고는 유지하며, 품질·이미지·승인 검사를 모두 통과한 소재만 준비 완료로 저장됩니다.</p>
    <div className="material-recovery-controls">
      <label htmlFor="blocked-material-kind">대상 <select id="blocked-material-kind" value={connectKind} disabled={busy || unconfirmed || pending || saved?.readRequestUnconfirmed || job?.workflowPending === true} onChange={event => setSelectedKind(event.target.value as SavedRepairRequest['connectKind'])}><option value="all">쇼핑·여행 전체</option><option value="shopping">쇼핑커넥트</option><option value="travel">여행커넥트</option></select></label>
      <button className="button button-primary action-button" disabled={!storageReady || Boolean(blocked && !unconfirmed) || busy || pending || saved?.readRequestUnconfirmed || job?.workflowPending === true} onClick={repair}>{busy && !job ? '접수 중…' : pending ? 'PC 작업 진행 중…' : unconfirmed ? '같은 요청 접수 상태 확인' : '보완 필요 소재 전체 보완·검증'}</button>
    </div>
    {blocked && <p className="inline-message">{blocked} <button type="button" className="muted-button" disabled={busy} onClick={() => window.location.reload()}>연결 상태 새로고침</button></p>}
    {job && <div className="material-recovery-status" aria-live="polite">
      <strong>{pending ? `${job.stageMessage || 'PC에서 처리 중'} · ${job.progress || 0}%` : job.executionNotAdmitted ? 'PC에 전달되기 전에 취소됐습니다. 새 복구 작업을 시작할 수 있습니다.' : completed ? `검증 결과: 준비 완료 ${job.readyCount || 0}개 · 보완 필요 ${job.failedCount || 0}개 · 중단 ${job.interruptedCount || 0}개` : job.status === 'SUCCEEDED' ? '보완 접수 완료 · 최종 검증 결과 확인 필요' : `${job.status}: ${job.errorMessage || job.errorCode || '작업 상세를 확인하세요.'}`}</strong>
      {(job.workflowPending || saved?.readRequestUnconfirmed) && <button type="button" className="muted-button" disabled={busy || pending} onClick={readWorkflow}>{busy ? '조회 접수 중…' : '최종 소재 결과 조회'}</button>}
      <small>작업번호: {repairJobId}{job.workflowJobId ? ` · 소재 작업: ${job.workflowJobId}` : ''}</small>
    </div>}
    {(message || unconfirmed || recoverySnapshot === 'unavailable' || job?.status === 'RESTORING') && <p className="inline-message" role="status">{message || (unconfirmed ? '응답을 확인하지 못한 요청이 있습니다. 같은 대상·요청번호로 접수 상태를 확인하세요.' : recoverySnapshot === 'unavailable' ? '브라우저 저장소나 저장된 요청을 확인할 수 없습니다. 원래 요청번호와 대상을 확인한 뒤 다시 여세요.' : '저장된 보완 요청의 상태를 다시 확인하고 있습니다.')}</p>}
  </section>;
}

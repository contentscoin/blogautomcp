'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { compareVersions } from '@/lib/version';
import { readSavedRewrite, saveRewrite, type SavedRewriteRequest } from '@/lib/material-rewrite-request';

type JobState = {
  jobId: string; status: string; progress?: number; stageMessage?: string | null;
  errorCode?: string | null; errorMessage?: string | null; workflowPending?: boolean;
  workflowJobId?: string | null; readyCount?: number; failedCount?: number; interruptedCount?: number;
};
const ENDPOINT = '/api/materials/rewrite-failed';
const MINIMUM_APP_VERSION = '1.3.98';
const RECOVERY_CHANGED = 'blogautomcp:failed-material-rewrite-changed';
function subscribeRecovery(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(RECOVERY_CHANGED, onChange);
  return () => { window.removeEventListener('storage', onChange); window.removeEventListener(RECOVERY_CHANGED, onChange); };
}
function browserRecoverySnapshot(accountId: string) {
  try { return JSON.stringify(readSavedRewrite(localStorage, accountId)); }
  catch { return 'unavailable'; }
}
function persistRecovery(accountId: string, request: SavedRewriteRequest) {
  saveRewrite(localStorage, accountId, request);
  window.dispatchEvent(new Event(RECOVERY_CHANGED));
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const payload = record(await response.json());
  if (!response.ok || !payload.success) throw new Error(String(record(payload.error).message || '작업 응답을 확인하지 못했습니다.'));
  return record(payload.data);
}
function queuedJob(data: Record<string, unknown>): JobState {
  if (typeof data.jobId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(data.jobId) || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(data.status)))
    throw new Error('접수 응답의 작업번호를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요.');
  return data as JobState;
}

export function FailedMaterialActions({ accountId, online, appVersion, hasConnection, activeWork }: { accountId: string; online: boolean; appVersion: string | null; hasConnection: boolean; activeWork: boolean }) {
  const [selectedKind, setSelectedKind] = useState<SavedRewriteRequest['connectKind'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [observation, setObservation] = useState<JobState | null>(null);
  // A stable serialized snapshot restores browser state through React's external-store subscription.
  const recoverySnapshot = useSyncExternalStore(subscribeRecovery, () => browserRecoverySnapshot(accountId), () => 'server');
  const storageReady = !['server', 'unavailable'].includes(recoverySnapshot);
  const saved = storageReady ? JSON.parse(recoverySnapshot) as SavedRewriteRequest | null : null;
  const rewriteJobId = saved?.rewriteJobId || '';
  const queryJobId = saved?.queryJobId || rewriteJobId;
  const job: JobState | null = queryJobId
    ? observation?.jobId === queryJobId ? observation : { jobId: queryJobId, status: 'RESTORING' }
    : null;
  const unconfirmed = Boolean(saved && !saved.rewriteJobId);
  const pending = Boolean(job && ['RESTORING', 'QUEUED', 'RUNNING'].includes(job.status));
  const connectKind = (unconfirmed || pending ? saved?.connectKind : selectedKind || saved?.connectKind) || 'all';
  const observedJobId = job?.jobId;
  const versionReady = compareVersions(appVersion, MINIMUM_APP_VERSION) >= 0;
  const blocked = !hasConnection ? 'PC 앱 연결이 필요합니다.' : !online ? 'PC 앱을 켜고 연결 상태를 확인하세요.' : !versionReady ? `PC 앱 ${MINIMUM_APP_VERSION} 이상으로 업데이트하세요. 현재 ${appVersion || '버전 확인 중'}.` : activeWork ? '진행 중인 작업이 끝나면 사용할 수 있습니다.' : '';

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
        else if (next.workflowPending === true) setMessage('PC에서 재작성·검증을 계속하고 있습니다. 아래 버튼으로 최종 소재 결과를 조회하세요.');
        if (!['QUEUED', 'RUNNING'].includes(String(next.status))) {
          const current = readSavedRewrite(localStorage, accountId);
          if (current?.readIdempotencyKey && (current.queryJobId || current.rewriteJobId) === observedJobId)
            persistRecovery(accountId, { ...current, readIdempotencyKey: undefined });
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

  async function rewrite() {
    setBusy(true); setMessage('');
    try {
      const previous = readSavedRewrite(localStorage, accountId);
      const request: SavedRewriteRequest = previous && !previous.rewriteJobId ? previous
        : { version: 1, connectKind, idempotencyKey: `rewrite-${crypto.randomUUID()}` };
      persistRecovery(accountId, request);
      const data = await requestJson(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(request.connectKind !== 'all' ? { connectKind: request.connectKind } : {}), idempotencyKey: request.idempotencyKey }) });
      const accepted = queuedJob(data);
      persistRecovery(accountId, { ...request, rewriteJobId: accepted.jobId, queryJobId: accepted.jobId });
      setObservation(accepted);
      setMessage('실패 소재 재작성·검증 요청을 접수했습니다. PC가 현재 실패 소재를 확인해 처리합니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '접수하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function readWorkflow() {
    setBusy(true); setMessage('');
    try {
      const current = readSavedRewrite(localStorage, accountId);
      if (!current?.rewriteJobId) throw new Error('저장된 재작성 작업번호를 확인하지 못했습니다.');
      const request = { ...current, readIdempotencyKey: current.readIdempotencyKey || `rewrite-read-${crypto.randomUUID()}` };
      persistRecovery(accountId, request);
      const data = await requestJson(ENDPOINT, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rewriteJobId: request.rewriteJobId, idempotencyKey: request.readIdempotencyKey }) });
      const accepted = queuedJob(data);
      persistRecovery(accountId, { ...request, queryJobId: accepted.jobId });
      setObservation(accepted);
      setMessage('같은 소재 작업의 최신 검증 결과를 조회하고 있습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '조회하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  const completed = job?.status === 'SUCCEEDED' && job.workflowPending === false;
  return <section className="data-card failed-material-card">
    <div className="card-title"><div><span className="card-kicker">MATERIAL RECOVERY</span><h2>실패 소재 일괄 복구</h2></div><span className="number-chip">재작성 → 검증 → 준비</span></div>
    <p>작성에 실패한 소재 글을 다시 쓰고 원고·이미지를 검증합니다. 검증을 통과한 글만 준비 완료 목록에 저장됩니다.</p>
    <div className="material-recovery-controls">
      <label htmlFor="failed-material-kind">대상 <select id="failed-material-kind" value={connectKind} disabled={busy || unconfirmed || pending || job?.workflowPending === true} onChange={event => setSelectedKind(event.target.value as SavedRewriteRequest['connectKind'])}><option value="all">쇼핑·여행 전체</option><option value="shopping">쇼핑커넥트</option><option value="travel">여행커넥트</option></select></label>
      <button className="button button-primary action-button" disabled={!storageReady || Boolean(blocked && !unconfirmed) || busy || pending || job?.workflowPending === true} onClick={rewrite}>{busy && !job ? '접수 중…' : pending ? 'PC 작업 진행 중…' : unconfirmed ? '같은 요청 접수 상태 확인' : '실패 소재 전체 재작성·검증'}</button>
    </div>
    {blocked && <p className="inline-message">{blocked} <button type="button" className="muted-button" disabled={busy} onClick={() => window.location.reload()}>연결 상태 새로고침</button></p>}
    {job && <div className="material-recovery-status" aria-live="polite">
      <strong>{pending ? `${job.stageMessage || 'PC에서 처리 중'} · ${job.progress || 0}%` : completed ? `검증 결과: 준비 완료 ${job.readyCount || 0}개 · 실패 ${job.failedCount || 0}개 · 중단 ${job.interruptedCount || 0}개` : job.status === 'SUCCEEDED' ? '재작성 접수 완료 · 최종 검증 결과 확인 필요' : `${job.status}: ${job.errorMessage || job.errorCode || '작업 상세를 확인하세요.'}`}</strong>
      {job.workflowPending && <button type="button" className="muted-button" disabled={busy || pending} onClick={readWorkflow}>{busy ? '조회 접수 중…' : '최종 소재 결과 조회'}</button>}
      <small>작업번호: {rewriteJobId}{job.workflowJobId ? ` · 소재 작업: ${job.workflowJobId}` : ''}</small>
    </div>}
    {(message || unconfirmed || recoverySnapshot === 'unavailable' || job?.status === 'RESTORING') && <p className="inline-message" role="status">{message || (unconfirmed ? '응답을 확인하지 못한 요청이 있습니다. 같은 대상·요청번호로 접수 상태를 확인하세요.' : recoverySnapshot === 'unavailable' ? '브라우저 요청번호 저장소를 사용할 수 없습니다. 저장소 사용을 허용한 뒤 다시 여세요.' : '저장된 재작성 요청의 상태를 다시 확인하고 있습니다.')}</p>}
  </section>;
}

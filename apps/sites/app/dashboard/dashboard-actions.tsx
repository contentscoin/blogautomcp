'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BLOGAUTO_OAUTH_MCP_URL, resolvePublicPluginInstallUrl } from '@/lib/plugin-install';
import { CONNECTION_VERIFY_PROMPT, connectionTimestamp, defaultOnboardingStep, emptyConnectionStatus, parseConnectionStatus, type ConnectionStatusSnapshot, type OnboardingStep } from '@/lib/connection-onboarding';

type PairCode = { code: string; expiresAt: string; deepLink: string; siteUrl: string };
type DashboardActionsProps = {
  hasConnection: boolean; generation: number; publicPluginInstallUrl?: string | null;
  accountId: string; accountEmail: string; initialStatus: ConnectionStatusSnapshot;
};
const STEPS: { id: OnboardingStep; label: string }[] = [{ id: 'pc', label: 'PC 연결' }, { id: 'chatgpt', label: '내 ChatGPT 연결' }, { id: 'verify', label: '연결 확인' }];

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function readPairCode(data: Record<string, unknown>): PairCode | null {
  if (typeof data.code !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(data.code) || typeof data.deepLink !== 'string' || typeof data.expiresAt !== 'string' || typeof data.siteUrl !== 'string') return null;
  if (!Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) return null;
  try {
    const link = new URL(data.deepLink);
    const site = new URL(BLOGAUTO_OAUTH_MCP_URL).origin;
    if (data.siteUrl !== site || link.protocol !== 'blogautomcp:' || link.hostname !== 'pair' || link.pathname || link.username || link.password || link.port || link.hash) return null;
    if (link.searchParams.get('code') !== data.code || link.searchParams.get('site') !== site || Array.from(link.searchParams).length !== 2) return null;
    return { code: data.code, deepLink: data.deepLink, expiresAt: data.expiresAt, siteUrl: data.siteUrl };
  } catch { return null; }
}
function readError(payload: unknown, fallback: string): string {
  const error = asObject(asObject(payload).error);
  return typeof error.message === 'string' ? error.message : fallback;
}

export function DashboardActions({ hasConnection, generation, publicPluginInstallUrl = null, accountId, accountEmail, initialStatus }: DashboardActionsProps) {
  const router = useRouter();
  const seed = parseConnectionStatus(initialStatus) ?? emptyConnectionStatus(hasConnection, generation);
  const installUrl = resolvePublicPluginInstallUrl(publicPluginInstallUrl, true);
  const [ownerId] = useState(accountId);
  const [status, setStatus] = useState(seed);
  const [activeStep, setActiveStep] = useState<OnboardingStep>(defaultOnboardingStep(seed));
  const manualStep = useRef(false);
  const actionLock = useRef<'pair' | 'legacy' | 'status' | null>(null);
  const channelRef = useRef(seed.channel.exists);
  const generationRef = useRef(seed.channel.generation);
  const exposedSecrets = useRef({ pair: false, url: false });
  const mounted = useRef(true);
  const session = useRef({ blocked: false, epoch: 0 });
  const controllers = useRef(new Set<AbortController>());
  const readTimeouts = useRef(new Set<number>());
  const automaticRead = useRef<AbortController | null>(null);
  const lastReadStarted = useRef(0);
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [oauthMessage, setOAuthMessage] = useState('');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [connectionExists, setConnectionExists] = useState(seed.channel.exists);
  const [currentGeneration, setCurrentGeneration] = useState(seed.channel.generation);
  const [pairCode, setPairCode] = useState<PairCode | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairMessage, setPairMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const blocked = sessionBlocked || ownerId !== accountId;

  const isCurrent = useCallback((epoch: number) => mounted.current && !session.current.blocked && session.current.epoch === epoch && ownerId === accountId, [accountId, ownerId]);
  const invalidateSession = useCallback(() => {
    if (!mounted.current || session.current.blocked) return;
    session.current.blocked = true; session.current.epoch++;
    for (const controller of controllers.current) controller.abort();
    setPairCode(null); setUrl(''); exposedSecrets.current = { pair: false, url: false }; setStatus(emptyConnectionStatus());
    setConnectionExists(false); setCurrentGeneration(0); channelRef.current = false; generationRef.current = 0;
    setMessage(''); setOAuthMessage(''); setVerifyMessage(''); setPairMessage(''); setStatusMessage('');
    setBusy(false); setPairBusy(false); setStatusBusy(false); actionLock.current = null;
    setSessionBlocked(true);
    setSessionMessage('로그인이 만료되었거나 계정이 변경되었습니다. 현재 계정으로 다시 로그인하거나 화면을 새로고침하세요.');
    router.refresh();
  }, [router]);

  const readResponse = useCallback(async (response: Response, epoch: number, requireAccount = false) => {
    if (!isCurrent(epoch)) return null;
    if (response.status === 401 || response.status === 403) { invalidateSession(); return null; }
    const payload: unknown = await response.json();
    if (!isCurrent(epoch)) return null;
    const record = asObject(payload);
    if (asObject(record.error).code === 'ACCOUNT_CHANGED' || (typeof record.accountId === 'string' && record.accountId !== accountId)) {
      invalidateSession(); return null;
    }
    if (requireAccount && response.ok && record.success === true && record.accountId !== accountId) throw new Error('연결 상태 응답의 계정을 확인하지 못했습니다.');
    return record;
  }, [accountId, invalidateSession, isCurrent]);

  useEffect(() => {
    mounted.current = true;
    const pending = controllers.current;
    const currentSession = session.current;
    const pendingTimeouts = readTimeouts.current;
    return () => {
      mounted.current = false; currentSession.epoch++;
      for (const controller of pending) controller.abort();
      pending.clear();
      for (const timer of pendingTimeouts) window.clearTimeout(timer);
      pendingTimeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (!pairCode) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((Date.parse(pairCode.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) { setPairCode(null); exposedSecrets.current.pair = false; setPairMessage('코드가 만료되었습니다. PC 앱 연결을 눌러 새 코드를 받으세요.'); }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pairCode]);

  const refreshStatus = useCallback(async (automatic = false) => {
    if (actionLock.current || !isCurrent(session.current.epoch)) return;
    if (automatic && (document.visibilityState !== 'visible' || navigator.onLine === false || Date.now() - lastReadStarted.current < 15_000)) return;
    const epoch = session.current.epoch;
    const controller = new AbortController();
    controllers.current.add(controller);
    if (automatic) automaticRead.current = controller;
    actionLock.current = 'status'; lastReadStarted.current = Date.now();
    setStatusBusy(true); setStatusMessage('');
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    readTimeouts.current.add(timeout);
    try {
      const response = await fetch('/api/connection-status', { method: 'GET', cache: 'no-store', headers: { 'x-blogauto-account-id': accountId }, signal: controller.signal });
      const record = await readResponse(response, epoch, true);
      if (!record || !isCurrent(epoch) || controller.signal.aborted) return;
      if (!response.ok) throw new Error(readError(record, '연결 상태를 조회하지 못했습니다.'));
      const next = record.success === true ? parseConnectionStatus(record.data) : null;
      if (!next) throw new Error('연결 상태 응답을 확인하지 못했습니다. 이전 확인 결과를 유지합니다.');
      if (!next.channel.exists || next.channel.generation !== generationRef.current) {
        if (exposedSecrets.current.pair) setPairMessage('PC 연결 주소가 변경되어 이전 코드를 지웠습니다. 새 코드로 연결하세요.');
        if (exposedSecrets.current.url) setMessage('PC 연결 주소가 변경되어 이전 주소를 지웠습니다. 현재 상태를 확인하세요.');
        setPairCode(null); setUrl(''); exposedSecrets.current = { pair: false, url: false };
      }
      generationRef.current = next.channel.generation;
      setStatus(next); channelRef.current = next.channel.exists;
      setConnectionExists(next.channel.exists); setCurrentGeneration(next.channel.generation); setLastCheckedAt(Date.now());
      if (!manualStep.current) setActiveStep(defaultOnboardingStep(next));
      if (!automatic) router.refresh();
      setStatusMessage('연결 상태를 새로 확인했습니다.');
    } catch (error) {
      if (isCurrent(epoch) && !(automatic && controller.signal.aborted)) setStatusMessage(controller.signal.aborted ? '상태 확인 시간이 초과되었습니다. 다시 확인하세요.' : error instanceof Error ? error.message : '연결 상태를 조회하지 못했습니다.');
    } finally {
      window.clearTimeout(timeout); readTimeouts.current.delete(timeout); controllers.current.delete(controller);
      if (automaticRead.current === controller) automaticRead.current = null;
      if (isCurrent(epoch)) { actionLock.current = null; setStatusBusy(false); }
    }
  }, [accountId, isCurrent, readResponse, router]);

  useEffect(() => {
    const onReturn = () => { void refreshStatus(true); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onReturn();
      else automaticRead.current?.abort();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshStatus]);

  async function issue() {
    const epoch = session.current.epoch;
    if (actionLock.current || !isCurrent(epoch)) return;
    actionLock.current = 'legacy'; setBusy(true); setMessage('');
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      if (channelRef.current && !window.confirm('PC 연결 주소를 재발급하면 기존 PC 인증이 폐기되고 대기·실행 작업이 취소됩니다. 재발급할까요?')) return;
      const response = await fetch('/api/mcp-connections', { method: 'POST', headers: { 'content-type': 'application/json', 'x-blogauto-account-id': accountId }, body: JSON.stringify({ action: channelRef.current ? 'rotate' : 'issue' }), signal: controller.signal });
      const record = await readResponse(response, epoch);
      if (!record || !isCurrent(epoch) || controller.signal.aborted) return;
      if (!response.ok) throw new Error(readError(record, 'PC 연결 주소를 발급하지 못했습니다.'));
      const data = asObject(record.data);
      if (record.success !== true || typeof data.mcpUrl !== 'string' || !isGeneration(data.generation) || data.generation === 0) throw new Error('발급 응답을 확인하지 못했습니다.');
      setUrl(data.mcpUrl); exposedSecrets.current = { pair: false, url: true }; channelRef.current = true; generationRef.current = data.generation; setConnectionExists(true); setPairCode(null); setCurrentGeneration(data.generation);
      setStatus(emptyConnectionStatus(true, data.generation));
    } catch (error) { if (isCurrent(epoch)) setMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { controllers.current.delete(controller); if (isCurrent(epoch)) { actionLock.current = null; setBusy(false); } }
  }

  async function copyValue(value: string, setFeedback: (text: string) => void, success: string) {
    const epoch = session.current.epoch;
    if (!isCurrent(epoch)) return;
    try { await navigator.clipboard.writeText(value); if (isCurrent(epoch)) setFeedback(success); }
    catch { if (isCurrent(epoch)) setFeedback('자동 복사가 차단되었습니다. 아래 내용을 선택해 직접 복사하세요.'); }
  }
  async function connectPc() {
    const epoch = session.current.epoch;
    if (actionLock.current || !isCurrent(epoch)) return;
    actionLock.current = 'pair'; setPairBusy(true); setPairMessage('');
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch('/api/device/pair-code', { method: 'POST', headers: { 'content-type': 'application/json', 'x-blogauto-account-id': accountId }, body: '{}', signal: controller.signal });
      const record = await readResponse(response, epoch);
      if (!record || !isCurrent(epoch) || controller.signal.aborted) return;
      if (!response.ok) throw new Error(readError(record, 'PC 연결 코드를 발급하지 못했습니다.'));
      const data = asObject(record.data);
      const next = readPairCode(data);
      if (record.success !== true || !next || !isGeneration(data.generation) || data.generation === 0) throw new Error('발급 응답을 확인하지 못했습니다.');
      setUrl(''); exposedSecrets.current.url = false;
      channelRef.current = true; generationRef.current = data.generation; exposedSecrets.current.pair = true; setConnectionExists(true); setCurrentGeneration(data.generation); setPairCode(next);
      setSecondsLeft(Math.max(0, Math.ceil((Date.parse(next.expiresAt) - Date.now()) / 1000)));
      setPairMessage('PC 앱에서 연결을 마친 뒤 연결 상태를 확인하세요. 코드 발급은 연결 완료가 아닙니다.');
      window.location.href = next.deepLink;
    } catch (error) { if (isCurrent(epoch)) setPairMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { controllers.current.delete(controller); if (isCurrent(epoch)) { actionLock.current = null; setPairBusy(false); } }
  }
  function checkPairCode() {
    if (!isCurrent(session.current.epoch)) return false;
    if (!pairCode || Date.parse(pairCode.expiresAt) <= Date.now()) {
      setPairCode(null); exposedSecrets.current.pair = false; setPairMessage('코드가 만료되었습니다. PC 앱 연결을 눌러 새 코드를 받으세요.'); return false;
    }
    return true;
  }
  function selectStep(step: OnboardingStep) { manualStep.current = true; setActiveStep(step); }
  const pending = busy || pairBusy || statusBusy;
  const usablePc = status.channel.exists && status.pc.paired;
  const completed = { pc: !blocked && usablePc, chatgpt: !blocked && status.mcp.authorized, verify: !blocked && status.ready };
  const manualGuide = <>
          <ol className="onboarding-instructions">
            <li>ChatGPT의 <b>Plugins → + → Add custom MCP server</b>를 선택하세요.</li>
            <li>이름과 서버 주소를 입력하고 인증 방식은 <b>OAuth</b>로 선택하세요.</li>
            <li>OAuth 승인 화면에서 본인의 계정을 확인하고 연결을 승인하세요.</li>
          </ol>
          <label className="onboarding-field"><span>연결 이름</span><input readOnly value="BlogAutoMCP" /></label>
          <label className="onboarding-field"><span>MCP 서버 주소</span><input readOnly value={BLOGAUTO_OAUTH_MCP_URL} /></label>
          <button type="button" className="button" onClick={() => void copyValue(BLOGAUTO_OAUTH_MCP_URL, setOAuthMessage, 'MCP 주소를 복사했습니다. 인증 방식은 OAuth로 선택하세요.')}>주소 복사</button>
          {oauthMessage && <p className="onboarding-feedback" role="status">{oauthMessage}</p>}
          <details className="onboarding-help"><summary>맞춤 MCP 메뉴가 보이지 않나요?</summary><p>이 메뉴는 ChatGPT 계정·요금제·워크스페이스 정책에 따라 제공되지 않을 수 있습니다. 사용할 수 없다면 관리자에게 맞춤 MCP 허용 여부를 확인하거나 공개 설치 링크가 준비될 때까지 기다리세요. 사이트가 공개되어 있어도 운영자의 비공개 플러그인이 모든 계정에 제공되는 것은 아닙니다.</p></details>
  </>;
  const pairingControls = <>
    {pairCode ? <div className="secret-reveal onboarding-pair-code"><div><span>{secondsLeft}초 안에 연결</span><code>{pairCode.code}</code></div>
      <button type="button" disabled={blocked} onClick={() => { if (checkPairCode() && pairCode) return copyValue(pairCode.code, setPairMessage, '코드를 복사했습니다. PC 앱의 코드로 연결에 입력하세요.'); }}>코드 복사</button>
      <a className="muted-button" href={pairCode.deepLink} onClick={event => { if (!checkPairCode()) event.preventDefault(); }}>앱 다시 열기</a></div>
      : <button type="button" className="button button-primary" disabled={pending || blocked} onClick={connectPc}>{pairBusy ? '코드 발급 중…' : 'PC 앱 연결'}</button>}
    {pairCode && <p>앱이 열리지 않으면 Windows 앱을 설치·실행하고 첫 화면의 <b>코드로 연결</b>에 위 코드를 입력하세요.</p>}
    {pairMessage && <p className="onboarding-feedback" role="status">{pairMessage}</p>}
  </>;

  return <section className="onboarding-shell" aria-label="내 계정 연결 안내">
    <div className="onboarding-account"><span>연결할 내 계정</span><strong>{accountEmail}</strong><p>사이트와 ChatGPT에서 이 계정을 사용하세요. 각 사용자는 본인의 PC와 계정으로 연결합니다.</p></div>
    <nav aria-label="연결 단계"><ol className="onboarding-progress">{STEPS.map((step, index) => <li key={step.id} data-current={activeStep === step.id}>
      <button type="button" className="onboarding-step-button" aria-current={activeStep === step.id ? 'step' : undefined} aria-controls={'onboarding-panel-' + step.id} onClick={() => selectStep(step.id)}>
        <span>{index + 1}</span><strong>{step.label}</strong><small>{completed[step.id] ? step.id === 'pc' ? 'PC 연결됨' : step.id === 'chatgpt' ? '계정 인증됨' : '응답 확인됨' : '확인 필요'}</small>
      </button></li>)}</ol></nav>
    {blocked ? <div className="onboarding-feedback" role="alert"><p>{sessionMessage || '연결할 계정이 변경되었습니다. 화면을 새로고침하세요.'}</p><button type="button" className="button button-primary" onClick={() => window.location.reload()}>현재 계정으로 화면 새로고침</button></div> : <>
      <article className="onboarding-panel" id={'onboarding-panel-' + activeStep} aria-labelledby={'onboarding-heading-' + activeStep}>
        {activeStep === 'pc' && <>
          <h2 className="onboarding-step-heading" id="onboarding-heading-pc">1. 내 Windows PC 연결</h2>
          <p>설치와 PC 연결은 사용할 Windows PC에서 진행하세요. 휴대폰에서 보고 있다면 PC에서 같은 계정으로 접속하세요.</p>
          <div className="onboarding-current-state"><strong>{status.pc.paired ? (status.pc.name || '연결된 PC') + ' · ' + (status.pc.online ? '온라인' : '오프라인') : '아직 연결된 PC가 없습니다'}</strong>
            <p>{status.pc.paired ? !status.channel.exists ? 'PC 작업 연결을 확인해야 합니다. 기존 연결이 정지되었다면 관리자에게 문의하세요.' : status.pc.online ? '기존 PC 연결을 그대로 사용할 수 있습니다.' : '연결된 PC에서 앱을 실행한 뒤 연결 상태를 다시 확인하세요. 다시 페어링할 필요는 없습니다.' : 'Windows 앱을 설치한 뒤 PC 앱 연결을 눌러 시작하세요.'}</p></div>
          <a className="button button-ghost" href="/api/download/windows" download>Windows 앱 다운로드</a>
          {usablePc ? <details className="onboarding-help"><summary>다른 PC로 연결하기</summary><p>새 PC에서 연결을 마치면 기존 PC 인증이 교체됩니다.</p>{pairingControls}</details> : pairingControls}
          <details className="onboarding-help"><summary>구버전 앱 연결 · 고급</summary>
            <p>PC 연결 주소는 구버전 앱에만 필요합니다. 재발급하면 기존 PC 인증이 폐기되고 대기·실행 작업이 취소됩니다. 현재 주소 버전: G{currentGeneration}.</p>
            {url ? <div className="secret-reveal"><div><span>ONE-TIME URL</span><code>{url}</code></div><button type="button" onClick={() => copyValue(url, setMessage, 'PC 연결 주소를 복사했습니다. 구버전 앱의 고급 MCP 주소 입력에 붙여넣으세요.')}>복사</button><button type="button" className="muted-button" onClick={() => { setUrl(''); exposedSecrets.current.url = false; }}>닫기</button></div>
              : <button type="button" className="button" disabled={pending} onClick={issue}>{busy ? '처리 중…' : connectionExists ? 'PC 연결 주소 재발급 · 기존 PC 폐기' : '구버전 PC 연결 주소 발급'}</button>}
            {message && <p className="onboarding-feedback" role="status">{message}</p>}
          </details>
          <button type="button" className="button onboarding-next-action" onClick={() => selectStep('chatgpt')}>다음: 내 ChatGPT 연결</button>
        </>}
        {activeStep === 'chatgpt' && <>
          <h2 className="onboarding-step-heading" id="onboarding-heading-chatgpt">2. 내 ChatGPT에 BlogAutoMCP 연결</h2>
          <div className="onboarding-current-state"><strong>{status.mcp.authorized ? 'OAuth 계정 인증이 확인되었습니다' : '내 ChatGPT 계정 인증이 필요합니다'}</strong><p>새 탭의 ChatGPT 로그인 계정과 OAuth 승인 화면의 계정이 <b>{accountEmail}</b>인지 확인하세요.</p></div>
          <a className="button button-primary plugin-connect-button" href={installUrl || 'https://chatgpt.com/plugins'} target="_blank" rel="noopener noreferrer">{status.mcp.authorized ? '내 ChatGPT 플러그인 열기' : installUrl ? 'BlogAutoMCP 설치·연결' : '내 ChatGPT에서 연결하기'} <span aria-hidden="true">↗</span></a>
          {installUrl ? <p>설치 화면에서 설치와 OAuth 인증을 마친 뒤 연결을 확인하세요.</p> : <p>공개 설치 링크가 준비되기 전에는 아래 맞춤 MCP 서버 방식으로 연결합니다. 이미 연결했다면 기존 BlogAutoMCP를 그대로 사용하세요.</p>}
          {installUrl || status.mcp.authorized ? <details className="onboarding-help"><summary>직접 연결 안내 · 연결 문제 해결</summary>{manualGuide}</details> : manualGuide}
          <p>PC 연결 주소나 다른 사람의 인증 정보를 입력하지 마세요.</p>
          <button type="button" className="button onboarding-next-action" onClick={() => selectStep('verify')}>다음: 연결 확인</button>
        </>}
        {activeStep === 'verify' && <>
          <h2 className="onboarding-step-heading" id="onboarding-heading-verify">3. 실제 연결 응답 확인</h2>
          <div className="onboarding-current-state"><strong>{status.ready ? 'MCP와 PC 응답이 확인되었습니다' : '읽기 조회로 연결을 확인하세요'}</strong><p>아래 요청을 복사해 내 ChatGPT에서 연결한 BlogAutoMCP에 보내세요. 기존 PC를 다시 연결할 필요는 없습니다.</p></div>
          {!usablePc || !status.pc.online ? <div className="onboarding-next-action"><p>{usablePc ? '연결된 PC가 오프라인입니다. 해당 PC에서 앱을 실행한 뒤 다시 확인하세요.' : '먼저 내 PC 연결을 확인하세요.'}</p><button type="button" className="button" onClick={() => selectStep('pc')}>PC 연결 단계로 이동</button></div>
            : !status.mcp.authorized ? <div className="onboarding-next-action"><p>내 ChatGPT의 OAuth 계정 인증을 먼저 마쳐야 합니다.</p><button type="button" className="button" onClick={() => selectStep('chatgpt')}>내 ChatGPT 연결 단계로 이동</button></div> : null}
          <label className="onboarding-field"><span>연결 확인 요청</span><textarea readOnly rows={5} value={CONNECTION_VERIFY_PROMPT} /></label>
          <button type="button" className="button button-primary" onClick={() => copyValue(CONNECTION_VERIFY_PROMPT, setVerifyMessage, '확인 요청을 복사했습니다. 내 ChatGPT에서 BlogAutoMCP에 보내세요.')}>확인 요청 복사</button>
          <a className="button button-ghost" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">내 ChatGPT 열기 ↗</a>
          {verifyMessage && <p className="onboarding-feedback" role="status">{verifyMessage}</p>}
          <ul className="onboarding-status-list">
            <li>PC: {status.pc.paired ? (status.pc.name || '연결된 PC') + ' · ' + (status.pc.online ? '온라인' : '오프라인') : '미연결'}</li>
            <li>MCP 읽기 호출: {status.mcp.readVerified ? '응답 확인됨' : status.mcp.authorized ? '계정 인증됨 · 호출 확인 필요' : '계정 인증 필요'}<br /><span className="onboarding-status-time">{connectionTimestamp(status.mcp.lastVerifiedAt)}</span></li>
            <li>내 PC 작업 응답: {status.pc.roundTripVerified ? '응답 확인됨' : '응답 확인 필요'}<br /><span className="onboarding-status-time">{connectionTimestamp(status.pc.lastVerifiedAt)}</span></li>
            <li>네이버 세션: {status.naver.sessionSaved === true ? 'PC에 저장됨 · 실제 로그인 유효 여부는 네이버 작업에서 확인' : status.naver.sessionSaved === false ? '저장된 세션 없음 · PC 앱에서 로그인하세요' : '현재 상태 확인 필요'}</li>
          </ul>
        </>}
      </article>
      <div className="onboarding-current-state"><p className="onboarding-status-time">최근 조회 기준: {lastCheckedAt === null ? '이 화면을 열었을 때' : connectionTimestamp(lastCheckedAt)}. 현재 상태가 달라졌다면 다시 확인하세요.</p>
        <button type="button" className="button" disabled={pending} onClick={() => refreshStatus()}>{statusBusy ? '상태 확인 중…' : '연결 상태 다시 확인'}</button>
        {statusMessage && <p className="onboarding-feedback" role="status">{statusMessage}</p>}
        <p>이 버튼은 연결 상태만 조회합니다. 코드를 받거나 설치 화면을 연 것만으로 완료되지 않습니다.</p>
      </div>
    </>}
  </section>;
}

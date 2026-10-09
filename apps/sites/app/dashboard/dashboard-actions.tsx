'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BLOGAUTO_OAUTH_MCP_URL, resolvePublicPluginInstallUrl } from '@/lib/plugin-install';

type PairCode = { code: string; expiresAt: string; deepLink: string; siteUrl: string };
type DashboardActionsProps = { hasConnection: boolean; generation: number; publicPluginInstallUrl?: string | null };

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
  } catch {
    return null;
  }
}

function readError(payload: unknown, fallback: string): string {
  const record = asObject(payload);
  const error = asObject(record.error);
  return typeof error.message === 'string' ? error.message : fallback;
}

export function DashboardActions({ hasConnection, generation, publicPluginInstallUrl = null }: DashboardActionsProps) {
  const router = useRouter();
  const installUrl = resolvePublicPluginInstallUrl(publicPluginInstallUrl, true);
  const actionLock = useRef<'pair' | 'legacy' | 'status' | null>(null);
  const channelRef = useRef(hasConnection);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [oauthMessage, setOAuthMessage] = useState('');
  const [connectionExists, setConnectionExists] = useState(hasConnection);
  const [currentGeneration, setCurrentGeneration] = useState(generation);
  const [pairCode, setPairCode] = useState<PairCode | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairMessage, setPairMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showLegacyUrl, setShowLegacyUrl] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (!pairCode) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((Date.parse(pairCode.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setPairCode(null);
        setPairMessage('코드가 만료되었습니다. PC 앱 연결을 눌러 새 코드를 받으세요.');
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pairCode]);

  async function issue() {
    if (actionLock.current) return;
    actionLock.current = 'legacy';
    setBusy(true); setMessage('');
    try {
      if (channelRef.current && !window.confirm('PC 연결 주소를 재발급하면 기존 PC 인증이 폐기되고 대기·실행 작업이 취소됩니다. 재발급할까요?')) return;
      const response = await fetch('/api/mcp-connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: channelRef.current ? 'rotate' : 'issue' }) });
      const payload: unknown = await response.json();
      const record = asObject(payload);
      const data = asObject(record.data);
      if (!response.ok) throw new Error(readError(payload, 'PC 연결 주소를 발급하지 못했습니다.'));
      if (record.success !== true || typeof data.mcpUrl !== 'string' || !isGeneration(data.generation) || data.generation === 0) throw new Error('발급 응답을 확인하지 못했습니다.');
      setUrl(data.mcpUrl);
      channelRef.current = true;
      setConnectionExists(true);
      setPairCode(null);
      setCurrentGeneration(data.generation);
    } catch (error) { setMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { actionLock.current = null; setBusy(false); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('PC 연결 주소를 복사했습니다. 앱 첫 화면의 "고급: MCP 주소 붙여넣기"에 입력하세요. (딥링크/코드 연결이 되는 PC 에서는 필요 없습니다.)');
    } catch {
      setMessage('자동 복사가 차단되었습니다. 주소를 선택해 직접 복사하세요.');
    }
  }

  async function copyOAuthUrl() {
    try {
      await navigator.clipboard.writeText(BLOGAUTO_OAUTH_MCP_URL);
      setOAuthMessage('ChatGPT용 MCP 주소를 복사했습니다. 연결할 때 이 사이트에 로그인한 ChatGPT 계정으로 인증하세요.');
    } catch {
      setOAuthMessage('자동 복사가 차단되었습니다. 주소를 선택해 직접 복사하세요.');
    }
  }

  async function connectPc() {
    if (actionLock.current) return;
    actionLock.current = 'pair';
    setPairBusy(true); setPairMessage('');
    try {
      const response = await fetch('/api/device/pair-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const payload: unknown = await response.json();
      const record = asObject(payload);
      const data = asObject(record.data);
      if (!response.ok) throw new Error(readError(payload, 'PC 연결 코드를 발급하지 못했습니다.'));
      const next = readPairCode(data);
      if (record.success !== true || !next || !isGeneration(data.generation) || data.generation === 0) throw new Error('발급 응답을 확인하지 못했습니다.');
      channelRef.current = true;
      setConnectionExists(true);
      setCurrentGeneration(data.generation);
      setPairCode(next);
      setSecondsLeft(Math.max(0, Math.ceil((Date.parse(next.expiresAt) - Date.now()) / 1000)));
      setPairMessage('연결 코드를 발급했습니다. PC 앱에서 연결을 마친 뒤 연결 상태를 확인하세요.');
      // 설치된 PC 앱이 있으면 딥링크로 바로 열린다. 없으면 아래 코드를 앱에 입력한다.
      window.location.href = next.deepLink;
    } catch (error) { setPairMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { actionLock.current = null; setPairBusy(false); }
  }

  function checkPairCode() {
    if (!pairCode || Date.parse(pairCode.expiresAt) <= Date.now()) {
      setPairCode(null);
      setPairMessage('코드가 만료되었습니다. PC 앱 연결을 눌러 새 코드를 받으세요.');
      return false;
    }
    return true;
  }

  async function copyCode() {
    if (!checkPairCode() || !pairCode) return;
    try { await navigator.clipboard.writeText(pairCode.code); setPairMessage('코드를 복사했습니다. PC 앱 첫 화면의 "코드로 연결"에 붙여넣으세요.'); }
    catch { setPairMessage('자동 복사가 차단되었습니다. 코드를 직접 입력하세요.'); }
  }

  async function refreshStatus() {
    if (actionLock.current) return;
    actionLock.current = 'status';
    setStatusBusy(true); setStatusMessage('');
    try {
      const response = await fetch('/api/connection-status', { method: 'GET', cache: 'no-store' });
      const payload: unknown = await response.json();
      const record = asObject(payload);
      const data = asObject(record.data);
      const channel = asObject(data.channel);
      if (!response.ok) throw new Error(readError(payload, '연결 상태를 조회하지 못했습니다.'));
      if (record.success !== true || typeof channel.exists !== 'boolean' || !isGeneration(channel.generation) || typeof data.ready !== 'boolean') throw new Error('연결 상태 응답을 확인하지 못했습니다.');
      channelRef.current = channel.exists;
      setConnectionExists(channel.exists);
      setCurrentGeneration(channel.generation);
      router.refresh();
      setStatusMessage('서버에서 연결 상태를 새로 확인했습니다. 대시보드의 확인 결과를 확인하세요.');
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : '연결 상태를 조회하지 못했습니다.'); }
    finally { actionLock.current = null; setStatusBusy(false); }
  }

  return (
    <section className="connection-grid">
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">1 · DESKTOP PAIRING</span><h2>PC 앱 연결</h2></div><span className="number-chip">{pairCode ? `${secondsLeft}s` : connectionExists ? `G${currentGeneration}` : 'NEW'}</span></div>
        <p>설치된 Windows PC 앱을 열어 이 계정에 연결합니다. 처음 사용해도 이 버튼에서 시작하세요. 코드 발급만으로 기존 PC 인증은 바뀌지 않으며, 새 PC에서 연결을 마치면 기존 PC 인증이 교체됩니다.</p>
        {pairCode ? (
          <div className="secret-reveal">
            <div><span>PAIR CODE · {secondsLeft}초 남음</span><code>{pairCode.code}</code></div>
            <button onClick={copyCode}>코드 복사</button>
            <a className="muted-button" href={pairCode.deepLink} onClick={event => { if (!checkPairCode()) event.preventDefault(); }}>앱 다시 열기</a>
          </div>
        ) : (
          <button className="button button-primary action-button" disabled={pairBusy || busy || statusBusy} onClick={connectPc}>{pairBusy ? '코드 발급 중…' : 'PC 앱 연결'}</button>
        )}
        {pairCode && <p className="inline-message">앱이 열리지 않으면 Windows 앱을 설치·실행한 뒤 첫 화면의 <b>코드로 연결</b>에 위 코드를 입력하세요.</p>}
        {pairMessage && <p className="inline-message" role="status">{pairMessage}</p>}
        <p className="inline-message">
          <button type="button" className="muted-button" onClick={() => setShowLegacyUrl((open) => !open)}>{showLegacyUrl ? '구버전 방식 닫기' : '구버전 앱: PC 연결 주소로 연결'}</button>
        </p>
        {showLegacyUrl && (
          <div>
            <p>구버전 앱에만 필요한 고급 기능입니다. 재발급하면 기존 주소와 PC 인증이 폐기되고 대기·실행 작업이 취소됩니다.</p>
            {url ? <div className="secret-reveal"><div><span>ONE-TIME URL</span><code>{url}</code></div><button onClick={copy}>복사</button><button className="muted-button" onClick={() => setUrl('')}>닫기</button></div> : <button className="button action-button" disabled={busy || pairBusy || statusBusy} onClick={issue}>{busy ? '처리 중…' : connectionExists ? 'PC 연결 주소 재발급 · 기존 PC 폐기' : '구버전 PC 연결 주소 발급'}</button>}
            {message && <p className="inline-message" role="status">{message}</p>}
          </div>
        )}
      </article>
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">2 · CHATGPT PLUGIN</span><h2>ChatGPT 연결</h2></div><span className="number-chip">2단계</span></div>
        {installUrl ? (
          <><p>공개 플러그인 설치 화면에서 설치와 OAuth 계정 인증을 진행하세요.</p><a className="button button-primary plugin-connect-button" href={installUrl} target="_blank" rel="noopener noreferrer">ChatGPT 플러그인 설치·연결 <span aria-hidden="true">↗</span></a></>
        ) : <p>현재 공개 설치 링크가 준비되지 않았습니다. 맞춤 MCP 서버 추가 메뉴를 사용할 수 있는 ChatGPT 계정에서 아래 방식으로 연결하세요.</p>}
        <div className="plugin-connect-help">
          <p>ChatGPT의 <b>Plugins → + → Add custom MCP server</b>에서 아래 서버 주소를 입력하고 인증 방식은 <b>OAuth</b>로 선택하세요. 해당 메뉴가 없으면 계정·워크스페이스의 맞춤 MCP 지원 여부를 확인해야 합니다.</p>
          <div className="secret-reveal oauth-reveal"><div><span>OAUTH MCP URL</span><code>{BLOGAUTO_OAUTH_MCP_URL}</code></div><button type="button" onClick={copyOAuthUrl}>주소 복사</button></div>
          <p className="plugin-connect-note">OAuth 승인 화면에서 이 사이트에 로그인한 본인의 계정인지 확인하세요. PC 연결 주소나 다른 사람의 인증 정보를 입력하지 않습니다.</p>
          {oauthMessage && <p className="inline-message" role="status">{oauthMessage}</p>}
        </div>
      </article>
      <article className="data-card steps-card">
        <span className="card-kicker">3 · CONNECTION CHECK</span><h2>연결 확인</h2>
        <p>ChatGPT에서 연결한 플러그인에 「연결 상태와 쇼핑 소재 목록을 확인해줘」라고 요청하세요. 실제 PC 조회 응답이 돌아와야 확인되며, 이 조회는 새 글을 생성하지 않습니다.</p>
        <details className="plugin-connect-help"><summary>연결 확인 요청 자세히 보기</summary><p>agent_get_status를 실행한 뒤 materials_list(connectKind: &apos;shopping&apos;)를 요청하고 같은 작업번호로 job_get을 조회해 성공을 확인합니다.</p></details>
        <button type="button" className="button action-button" disabled={statusBusy || pairBusy || busy} onClick={refreshStatus}>{statusBusy ? '상태 확인 중…' : '연결 상태 다시 확인'}</button>
        {statusMessage && <p className="inline-message" role="status">{statusMessage}</p>}
        <p>이 버튼은 저장된 연결 확인 결과를 조회합니다. 설치 링크를 열거나 PC 연결 코드를 받는 것만으로 연결 완료가 되지 않습니다. 네이버 로그인 상태는 별도로 확인하세요.</p>
      </article>
    </section>
  );
}

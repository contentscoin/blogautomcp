'use client';

import { useEffect, useState } from 'react';
import { BLOGAUTO_OAUTH_MCP_URL, BLOGAUTO_PLUGIN_INSTALL_URL } from '@/lib/plugin-install';

type PairCode = { code: string; expiresAt: string; deepLink: string; siteUrl: string };

function readError(payload: unknown, fallback: string): string {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
  return typeof error.message === 'string' ? error.message : fallback;
}

export function DashboardActions({ hasConnection, generation }: { hasConnection: boolean; generation: number }) {
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

  useEffect(() => {
    if (!pairCode) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(pairCode.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPairCode(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pairCode]);

  async function issue() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/mcp-connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: connectionExists ? 'rotate' : 'issue' }) });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
      if (!response.ok) throw new Error(readError(payload, 'PC 연결 주소를 발급하지 못했습니다.'));
      if (typeof data.mcpUrl !== 'string') throw new Error('발급 응답을 확인하지 못했습니다.');
      setUrl(data.mcpUrl);
      setConnectionExists(true);
      setPairCode(null);
      if (typeof data.generation === 'number' && Number.isInteger(data.generation)) setCurrentGeneration(data.generation);
    } catch (error) { setMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { setBusy(false); }
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
    setPairBusy(true); setPairMessage('');
    try {
      const response = await fetch('/api/device/pair-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
      if (!response.ok) throw new Error(readError(payload, 'PC 연결 코드를 발급하지 못했습니다.'));
      if (typeof data.code !== 'string' || typeof data.deepLink !== 'string' || typeof data.expiresAt !== 'string' || typeof data.siteUrl !== 'string') throw new Error('발급 응답을 확인하지 못했습니다.');
      const next: PairCode = { code: data.code, deepLink: data.deepLink, expiresAt: data.expiresAt, siteUrl: data.siteUrl };
      setPairCode(next);
      // 설치된 PC 앱이 있으면 딥링크로 바로 열린다. 없으면 아래 코드를 앱에 입력한다.
      window.location.href = next.deepLink;
    } catch (error) { setPairMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { setPairBusy(false); }
  }

  async function copyCode() {
    if (!pairCode) return;
    try { await navigator.clipboard.writeText(pairCode.code); setPairMessage('코드를 복사했습니다. PC 앱 첫 화면의 "코드로 연결"에 붙여넣으세요.'); }
    catch { setPairMessage('자동 복사가 차단되었습니다. 코드를 직접 입력하세요.'); }
  }

  return (
    <section className="connection-grid">
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">CHATGPT PLUGIN</span><h2>ChatGPT 플러그인 연결</h2></div><span className="number-chip">1단계</span></div>
        <p>BlogAutoMCP 설치 화면을 바로 엽니다. MCP 주소를 직접 입력하지 않고 ChatGPT에서 설치 확인과 계정 인증을 마무리하세요.</p>
        <a className="button button-primary plugin-connect-button" href={BLOGAUTO_PLUGIN_INSTALL_URL} target="_blank" rel="noopener noreferrer">ChatGPT 플러그인 설치·연결 <span aria-hidden="true">↗</span></a>
        <p className="plugin-connect-note">이미 설치했다면 같은 화면에서 플러그인을 열거나 연결을 확인하세요. 이 사이트에 로그인한 ChatGPT 계정으로 진행합니다.</p>
        <details className="plugin-connect-help">
          <summary>설치 화면이 열리지 않나요?</summary>
          <p>사이트 관리자에게 플러그인 사용 권한 또는 워크스페이스 연결을 확인하세요. 플러그인을 만든 계정은 ChatGPT의 <b>Plugins → Personal → Created by you</b>에서도 찾을 수 있습니다.</p>
        </details>
        <details className="plugin-connect-help">
          <summary>직접 MCP 주소로 연결하기</summary>
          <p>기존 MCP 연결 방식이 필요한 경우 아래 고정 주소를 사용하고, 이 사이트에 로그인한 ChatGPT 계정으로 OAuth 인증하세요.</p>
          <div className="secret-reveal oauth-reveal"><div><span>OAUTH MCP URL</span><code>{BLOGAUTO_OAUTH_MCP_URL}</code></div><button type="button" onClick={copyOAuthUrl}>주소 복사</button></div>
          {oauthMessage && <p className="inline-message" role="status">{oauthMessage}</p>}
        </details>
      </article>
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">DESKTOP PAIRING</span><h2>PC 앱 연결</h2></div><span className="number-chip">{pairCode ? `${secondsLeft}s` : connectionExists ? `G${currentGeneration}` : 'NEW'}</span></div>
        <p>버튼을 누르면 설치된 BrandConnect PC 앱이 열리며 이 계정에 자동 연결됩니다. 주소를 앱에 붙여넣을 필요가 없습니다. 새 PC 를 연결하면 기존 PC 인증은 폐기됩니다.</p>
        {pairCode ? (
          <div className="secret-reveal">
            <div><span>PAIR CODE · {secondsLeft}초 남음</span><code>{pairCode.code}</code></div>
            <button onClick={copyCode}>코드 복사</button>
            <a className="muted-button" href={pairCode.deepLink}>앱 다시 열기</a>
          </div>
        ) : (
          <button className="button button-primary action-button" disabled={pairBusy || !connectionExists} onClick={connectPc}>{pairBusy ? '코드 발급 중…' : connectionExists ? 'PC 앱 연결' : '먼저 아래에서 PC 연결 주소를 발급하세요'}</button>
        )}
        {pairCode && <p className="inline-message">앱이 자동으로 열리지 않으면 PC 앱 첫 화면의 <b>코드로 연결</b>에 위 코드를 입력하세요.</p>}
        {pairMessage && <p className="inline-message" role="status">{pairMessage}</p>}
        <p className="inline-message">
          <button type="button" className="muted-button" onClick={() => setShowLegacyUrl((open) => !open)}>{showLegacyUrl ? '구버전 방식 닫기' : '구버전 앱: PC 연결 주소로 연결'}</button>
        </p>
        {showLegacyUrl && (
          <div>
            <p>PC 연결 주소는 이 계정의 작업 채널 자격증명입니다. 처음 한 번은 발급해야 하며(PC 앱 연결 버튼이 이 채널을 사용합니다), 재발급하면 기존 주소와 PC 인증이 즉시 폐기됩니다.</p>
            {url ? <div className="secret-reveal"><div><span>ONE-TIME URL</span><code>{url}</code></div><button onClick={copy}>복사</button><button className="muted-button" onClick={() => setUrl('')}>닫기</button></div> : <button className="button action-button" disabled={busy} onClick={issue}>{busy ? '처리 중…' : connectionExists ? 'PC 연결 주소 재발급 · 기존 PC 폐기' : 'PC 연결 주소 처음 발급'}</button>}
            {message && <p className="inline-message" role="status">{message}</p>}
          </div>
        )}
        {!connectionExists && !showLegacyUrl && (
          <button className="button action-button" disabled={busy} onClick={issue}>{busy ? '처리 중…' : 'PC 연결 주소 처음 발급'}</button>
        )}
      </article>
      <article className="data-card steps-card">
        <span className="card-kicker">PAIRING GUIDE</span><h2>연결 순서</h2>
        <ol><li><b>1</b><span>「ChatGPT 플러그인 설치·연결」을 눌러 ChatGPT에서 설치 확인과 계정 인증을 마칩니다.</span></li><li><b>2</b><span>처음이면 PC 연결 주소를 한 번 발급한 뒤 「PC 앱 연결」을 눌러 PC 앱을 이 계정에 연결합니다.</span></li><li><b>3</b><span>PC 앱에서 네이버 로그인을 마치면 ChatGPT 에서 바로 요청할 수 있습니다.</span></li></ol>
      </article>
    </section>
  );
}

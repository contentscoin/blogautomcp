'use client';

import { useEffect, useState } from 'react';

const OAUTH_MCP_URL = 'https://blogautomcp.hiway350051.chatgpt.site/api/mcp';

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
      await navigator.clipboard.writeText(OAUTH_MCP_URL);
      setMessage('ChatGPT용 MCP 주소를 복사했습니다. 연결할 때 Site의 GPT 계정으로 인증하세요.');
    } catch {
      setMessage('자동 복사가 차단되었습니다. 주소를 선택해 직접 복사하세요.');
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
        <div className="card-title"><div><span className="card-kicker">CHATGPT OAUTH</span><h2>ChatGPT MCP 연결</h2></div><span className="number-chip">SECURE</span></div>
        <p>이 고정 주소를 ChatGPT 커넥터에 등록하면 Site에서 로그인한 GPT 계정으로 인증됩니다.</p>
        <div className="secret-reveal oauth-reveal"><div><span>OAUTH MCP URL</span><code>{OAUTH_MCP_URL}</code></div><button onClick={copyOAuthUrl}>복사</button></div>
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
        <ol><li><b>1</b><span>ChatGPT 커넥터에 OAuth MCP 주소를 등록하고 GPT 계정으로 인증합니다.</span></li><li><b>2</b><span>처음이면 PC 연결 주소를 한 번 발급한 뒤 「PC 앱 연결」을 눌러 PC 앱을 이 계정에 연결합니다.</span></li><li><b>3</b><span>PC 앱에서 네이버 로그인을 마치면 ChatGPT 에서 바로 요청할 수 있습니다.</span></li></ol>
      </article>
    </section>
  );
}

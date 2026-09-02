'use client';

import { useEffect, useState } from 'react';

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
      if (!response.ok) throw new Error(readError(payload, 'MCP 주소를 발급하지 못했습니다.'));
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
      setMessage('복사했습니다. ChatGPT 커넥터(MCP) 설정에 한 번만 붙여넣으세요. PC 앱에는 붙여넣을 필요가 없습니다.');
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
        <div className="card-title"><div><span className="card-kicker">PRIVATE ENDPOINT</span><h2>MCP 주소</h2></div><span className="number-chip">{connectionExists ? `G${currentGeneration}` : 'NEW'}</span></div>
        <p>ChatGPT 커넥터에 등록할 주소입니다. 발급 직후 한 번만 보이며, 추가 발행하면 기존 주소와 PC 인증이 즉시 폐기됩니다.</p>
        {url ? <div className="secret-reveal"><div><span>ONE-TIME URL</span><code>{url}</code></div><button onClick={copy}>복사</button><button className="muted-button" onClick={() => setUrl('')}>닫기</button></div> : <button className="button button-primary action-button" disabled={busy} onClick={issue}>{busy ? '처리 중…' : connectionExists ? '추가 발행 · 기존 연결 폐기' : 'MCP 주소 처음 발급'}</button>}
        {message && <p className="inline-message" role="status">{message}</p>}
      </article>
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">DESKTOP PAIRING</span><h2>PC 앱 연결</h2></div><span className="number-chip">{pairCode ? `${secondsLeft}s` : 'LINK'}</span></div>
        <p>버튼을 누르면 설치된 BrandConnect PC 앱이 열리며 이 계정에 자동 연결됩니다. MCP 주소를 앱에 붙여넣을 필요가 없습니다.</p>
        {pairCode ? (
          <div className="secret-reveal">
            <div><span>PAIR CODE · {secondsLeft}초 남음</span><code>{pairCode.code}</code></div>
            <button onClick={copyCode}>코드 복사</button>
            <a className="muted-button" href={pairCode.deepLink}>앱 다시 열기</a>
          </div>
        ) : (
          <button className="button button-primary action-button" disabled={pairBusy || !connectionExists} onClick={connectPc}>{pairBusy ? '코드 발급 중…' : connectionExists ? 'PC 앱 연결' : '먼저 MCP 주소를 발급하세요'}</button>
        )}
        {pairCode && <p className="inline-message">앱이 자동으로 열리지 않으면 PC 앱 첫 화면의 <b>코드로 연결</b>에 위 코드를 입력하세요.</p>}
        {pairMessage && <p className="inline-message" role="status">{pairMessage}</p>}
      </article>
      <article className="data-card steps-card">
        <span className="card-kicker">PAIRING GUIDE</span><h2>연결 순서</h2>
        <ol><li><b>1</b><span>MCP 주소를 발급해 ChatGPT 커넥터에 한 번 등록합니다.</span></li><li><b>2</b><span>「PC 앱 연결」을 눌러 PC 앱을 이 계정에 연결합니다.</span></li><li><b>3</b><span>PC 앱에서 네이버 로그인을 마치면 ChatGPT 에서 바로 요청할 수 있습니다.</span></li></ol>
      </article>
    </section>
  );
}

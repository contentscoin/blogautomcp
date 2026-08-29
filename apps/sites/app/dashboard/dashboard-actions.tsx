'use client';

import { useState } from 'react';

const OAUTH_MCP_URL = 'https://blogautomcp.hiway350051.chatgpt.site/api/mcp';

export function DashboardActions({ hasConnection, generation }: { hasConnection: boolean; generation: number }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [connectionExists, setConnectionExists] = useState(hasConnection);
  const [currentGeneration, setCurrentGeneration] = useState(generation);

  async function issue() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/mcp-connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: connectionExists ? 'rotate' : 'issue' }) });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
      const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof error.message === 'string' ? error.message : 'MCP 주소를 발급하지 못했습니다.');
      if (typeof data.mcpUrl !== 'string') throw new Error('발급 응답을 확인하지 못했습니다.');
      setUrl(data.mcpUrl);
      setConnectionExists(true);
      if (typeof data.generation === 'number' && Number.isInteger(data.generation)) setCurrentGeneration(data.generation);
    } catch (error) { setMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('PC 연결 주소를 복사했습니다. Windows 앱에 입력하세요.');
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

  return (
    <section className="connection-grid">
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">CHATGPT OAUTH</span><h2>ChatGPT MCP 연결</h2></div><span className="number-chip">SECURE</span></div>
        <p>이 고정 주소를 ChatGPT에 등록하면 Site에서 로그인한 GPT 계정으로 인증됩니다.</p>
        <div className="secret-reveal oauth-reveal"><div><span>OAUTH MCP URL</span><code>{OAUTH_MCP_URL}</code></div><button onClick={copyOAuthUrl}>복사</button></div>
      </article>
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">PC ACTIVATION</span><h2>PC 연결 주소</h2></div><span className="number-chip">{connectionExists ? `G${currentGeneration}` : 'NEW'}</span></div>
        <p>Windows 앱을 인증하는 일회성 주소입니다. 추가 발행하면 기존 주소와 PC 인증이 즉시 폐기됩니다.</p>
        {url ? <div className="secret-reveal"><div><span>ONE-TIME URL</span><code>{url}</code></div><button onClick={copy}>복사</button><button className="muted-button" onClick={() => setUrl('')}>닫기</button></div> : <button className="button button-primary action-button" disabled={busy} onClick={issue}>{busy ? '처리 중…' : connectionExists ? 'PC 연결 주소 재발급 · 기존 PC 폐기' : 'PC 연결 주소 처음 발급'}</button>}
        {message && <p className="inline-message" role="status">{message}</p>}
      </article>
      <article className="data-card steps-card">
        <span className="card-kicker">PAIRING GUIDE</span><h2>연결 순서</h2>
        <ol><li><b>1</b><span>ChatGPT MCP 주소를 등록하고 GPT 계정으로 인증합니다.</span></li><li><b>2</b><span>PC 연결 주소를 한 번 발급합니다.</span></li><li><b>3</b><span>Windows 앱에 입력해 이 PC를 연결합니다.</span></li></ol>
      </article>
    </section>
  );
}

'use client';

import { useState } from 'react';

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
      setMessage('복사했습니다. 로컬 앱과 ChatGPT MCP 설정에 각각 한 번씩 입력하세요.');
    } catch {
      setMessage('자동 복사가 차단되었습니다. 주소를 선택해 직접 복사하세요.');
    }
  }

  return (
    <section className="connection-grid">
      <article className="data-card connection-card">
        <div className="card-title"><div><span className="card-kicker">PRIVATE ENDPOINT</span><h2>MCP 주소</h2></div><span className="number-chip">{connectionExists ? `G${currentGeneration}` : 'NEW'}</span></div>
        <p>주소는 발급 직후 한 번만 보입니다. 추가 발행하면 기존 주소와 PC 인증이 즉시 폐기됩니다.</p>
        {url ? <div className="secret-reveal"><div><span>ONE-TIME URL</span><code>{url}</code></div><button onClick={copy}>복사</button><button className="muted-button" onClick={() => setUrl('')}>닫기</button></div> : <button className="button button-primary action-button" disabled={busy} onClick={issue}>{busy ? '처리 중…' : connectionExists ? '추가 발행 · 기존 연결 폐기' : 'MCP 주소 처음 발급'}</button>}
        {message && <p className="inline-message" role="status">{message}</p>}
      </article>
      <article className="data-card steps-card">
        <span className="card-kicker">PAIRING GUIDE</span><h2>연결 순서</h2>
        <ol><li><b>1</b><span>주소를 복사합니다.</span></li><li><b>2</b><span>Windows 앱 설정에서 이 PC를 연결합니다.</span></li><li><b>3</b><span>ChatGPT MCP 설정에도 같은 주소를 등록합니다.</span></li></ol>
      </article>
    </section>
  );
}

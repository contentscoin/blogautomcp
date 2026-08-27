'use client';

import { useState } from 'react';

type UserRow = { id: string; email: string; displayName: string | null; role: string; status: string; createdAt: number; updatedAt: number; deviceName: string | null; deviceLastSeenAt: number | null };

export function AdminUsers({ initialUsers }: { initialUsers: UserRow[] }) {
  const [items, setItems] = useState(initialUsers);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  async function changeStatus(id: string, status: string) {
    setBusy(id); setMessage('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof error.message === 'string' ? error.message : '변경하지 못했습니다.');
      setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
      setMessage('계정 상태를 변경했습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '변경하지 못했습니다.'); }
    finally { setBusy(''); }
  }
  return <section className="data-card admin-table-card"><div className="card-title"><div><span className="card-kicker">ACCOUNT REVIEW</span><h2>사용자 관리</h2></div>{message && <p className="inline-message" role="status">{message}</p>}</div><div className="admin-list">{items.map((user) => <div className="admin-row" key={user.id}><div className="user-avatar">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div><div className="user-main"><strong>{user.displayName || '이름 없음'}</strong><small>{user.email}</small></div><div className="user-meta"><span>{new Date(user.createdAt).toLocaleDateString('ko-KR')}</span><small>{user.deviceName || 'PC 미연결'}</small></div><span className={`status-pill status-${user.status.toLowerCase()}`}>{statusLabel(user.status)}</span><div className="admin-actions">{user.role === 'ADMIN' ? <span className="owner-lock">OWNER</span> : <><button disabled={busy === user.id || user.status === 'APPROVED'} onClick={() => changeStatus(user.id, 'APPROVED')}>승인</button><button disabled={busy === user.id || user.status === 'REJECTED'} onClick={() => changeStatus(user.id, 'REJECTED')}>거절</button><button disabled={busy === user.id || user.status === 'SUSPENDED'} onClick={() => changeStatus(user.id, 'SUSPENDED')}>정지</button></>}</div></div>)}</div></section>;
}
function statusLabel(status: string) { return ({ APPROVED: '승인됨', PENDING_APPROVAL: '대기', REJECTED: '거절', SUSPENDED: '정지' } as Record<string, string>)[status] || status; }

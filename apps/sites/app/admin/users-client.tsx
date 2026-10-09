'use client';

import { useRef, useState } from 'react';

type UserRow = { id: string; email: string; displayName: string | null; role: string; status: string; createdAt: number; updatedAt: number; deviceName: string | null; deviceLastSeenAt: number | null };

export function AdminUsers({ initialUsers }: { initialUsers: UserRow[] }) {
  const [items, setItems] = useState(initialUsers);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const currentUsers = useRef(new Map(initialUsers.map(user => [user.id, user])));
  const inFlight = useRef(new Map<string, symbol>());

  async function changeStatus(id: string, status: string) {
    const user = currentUsers.current.get(id);
    // Claim the row before React commits its disabled state. Other rows remain usable.
    if (!user || user.role === 'ADMIN' || user.status === status || inFlight.current.has(id)) return;
    const request = Symbol(id);
    inFlight.current.set(id, request);
    setBusy(current => new Set(current).add(id));
    setMessage('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
      if (!response.ok || record.success !== true) throw new Error(typeof error.message === 'string' ? error.message : '변경하지 못했습니다.');
      const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
      if (data.id !== id || data.status !== status) throw new Error('계정 상태 변경 응답을 확인하지 못했습니다. 새로고침해서 현재 상태를 확인하세요.');
      if (inFlight.current.get(id) !== request) return;
      currentUsers.current.set(id, { ...user, status });
      setItems(current => current.map(item => item.id === id ? { ...item, status } : item));
      setMessage('계정 상태를 변경했습니다.');
    } catch (error) {
      if (inFlight.current.get(id) === request) setMessage(error instanceof Error ? error.message : '변경하지 못했습니다.');
    } finally {
      if (inFlight.current.get(id) === request) {
        inFlight.current.delete(id);
        setBusy(current => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    }
  }
  return <section className="data-card admin-table-card"><div className="card-title"><div><span className="card-kicker">ACCOUNT REVIEW</span><h2>사용자 관리</h2></div>{message && <p className="inline-message" role="status">{message}</p>}</div><div className="admin-list">{items.map((user) => <div className="admin-row" key={user.id}><div className="user-avatar">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div><div className="user-main"><strong>{user.displayName || '이름 없음'}</strong><small>{user.email}</small></div><div className="user-meta"><span>{new Date(user.createdAt).toLocaleDateString('ko-KR')}</span><small>{user.deviceName || 'PC 미연결'}</small></div><span className={`status-pill status-${user.status.toLowerCase()}`}>{statusLabel(user.status)}</span><div className="admin-actions">{user.role === 'ADMIN' ? <span className="owner-lock">OWNER</span> : <><button disabled={busy.has(user.id) || user.status === 'APPROVED'} onClick={() => changeStatus(user.id, 'APPROVED')}>승인</button><button disabled={busy.has(user.id) || user.status === 'REJECTED'} onClick={() => changeStatus(user.id, 'REJECTED')}>거절</button><button disabled={busy.has(user.id) || user.status === 'SUSPENDED'} onClick={() => changeStatus(user.id, 'SUSPENDED')}>정지</button></>}</div></div>)}</div></section>;
}
function statusLabel(status: string) { return ({ APPROVED: '승인됨', PENDING_APPROVAL: '대기', REJECTED: '거절', SUSPENDED: '정지' } as Record<string, string>)[status] || status; }

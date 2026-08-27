"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
}

export function AdminUsers({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function changeStatus(id: string, status: "APPROVED" | "REJECTED" | "SUSPENDED") {
    const reason = status === "APPROVED" ? "관리자 승인" : window.prompt(status === "SUSPENDED" ? "정지 사유를 입력하세요." : "거절 사유를 입력하세요.") || "관리자 결정";
    setBusyId(id);
    setError("");
    const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, reason }),
    });
    const payload = await response.json();
    if (!response.ok) setError(payload.error?.message || "상태를 변경하지 못했습니다.");
    setBusyId(null);
    router.refresh();
  }

  if (!users.length) return <div className="empty">등록된 일반 사용자가 없습니다.</div>;
  return <><table className="table"><thead><tr><th>사용자</th><th>상태</th><th>신청일</th><th>조치</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><b>{user.displayName}</b><div className="tiny muted">{user.email}</div></td><td><span className={`status ${user.status === "PENDING_APPROVAL" ? "pending" : user.status === "APPROVED" ? "" : "blocked"}`}>{user.status}</span></td><td>{new Date(user.createdAt).toLocaleString("ko-KR")}</td><td><div className="actions" style={{ marginTop: 0 }}><button className="button small primary" disabled={busyId === user.id || user.status === "APPROVED"} onClick={() => changeStatus(user.id, "APPROVED")}>승인</button><button className="button small" disabled={busyId === user.id} onClick={() => changeStatus(user.id, "REJECTED")}>거절</button><button className="button small danger" disabled={busyId === user.id || user.status === "SUSPENDED"} onClick={() => changeStatus(user.id, "SUSPENDED")}>정지</button></div></td></tr>)}</tbody></table>{error ? <div className="notice error">{error}</div> : null}</>;
}

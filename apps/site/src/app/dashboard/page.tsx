import Link from "next/link";
import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { McpConnectionCard } from "@/components/mcp-connection-card";
import { requirePageUser, userCanUseMcp } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function statusLabel(status: string): string {
  return ({ PENDING_APPROVAL: "승인 대기", APPROVED: "사용 승인", REJECTED: "승인 거절", SUSPENDED: "이용 정지" } as Record<string, string>)[status] || status;
}

export default async function DashboardPage() {
  const user = await requirePageUser();
  const [connection, device, recentJobs] = await Promise.all([
    db.mcpConnection.findUnique({ where: { userId: user.id } }),
    db.device.findFirst({ where: { userId: user.id, status: "ACTIVE" }, orderBy: { pairedAt: "desc" } }),
    db.agentJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const canUse = userCanUseMcp(user);

  return <main className="dashboard"><div className="shell"><header className="topbar"><Brand /><nav className="nav">{user.role === "ADMIN" ? <Link className="button small" href="/admin">관리자</Link> : null}<LogoutButton /></nav></header><section className="dashboard-head"><div><div className="eyebrow">Control Center</div><h1>{user.displayName}님, 반갑습니다.</h1><p>{user.email} · 한 계정에 한 대의 PC만 연결됩니다.</p></div><span className={`status ${user.status === "PENDING_APPROVAL" ? "pending" : canUse ? "" : "blocked"}`}>{user.role === "ADMIN" ? "관리자" : statusLabel(user.status)}</span></section>
    {!canUse ? <section className="card"><h2>{statusLabel(user.status)}</h2><p>{user.status === "PENDING_APPROVAL" ? "가입 신청이 접수되었습니다. 관리자가 승인하면 MCP URL 발급과 로컬 PC 연결이 열립니다." : user.status === "SUSPENDED" ? "관리자가 이용을 정지했습니다. 기존 MCP와 PC 인증은 사용할 수 없습니다." : "현재 계정으로 서비스를 이용할 수 없습니다."}</p></section> : <div className="grid"><McpConnectionCard hasConnection={connection?.status === "ACTIVE"} generation={connection?.generation ?? null} deviceName={device?.name ?? null} lastSeenAt={device?.lastSeenAt?.toISOString() ?? null} />
      <section className="card span-4"><h2>지원 자동화</h2><p>연결된 로컬 PC에서 커넥트별 작업을 처리합니다.</p><div className="stack" style={{ marginTop: 20 }}><div className="row"><b>쇼핑커넥트</b><span className="status">지원</span></div><div className="row"><b>여행커넥트</b><span className="status pending">최초 계약 확인</span></div></div><div className="notice" style={{ marginTop: 22 }}>여행커넥트는 로그인된 로컬 PC에서 응답 계약을 한 번 캡처한 뒤 전용 어댑터 검증이 필요합니다. 로컬 프로그램이 꺼져 있으면 ChatGPT 명령은 오프라인 상태를 반환합니다.</div></section>
      <section className="card span-12"><div className="row"><div><h2>최근 작업</h2><p>ChatGPT에서 요청한 로컬 작업 진행 상태입니다.</p></div><span className="tiny muted">최근 {recentJobs.length}건</span></div>{recentJobs.length ? <table className="table"><thead><tr><th>작업</th><th>상태</th><th>진행률</th><th>요청 시각</th></tr></thead><tbody>{recentJobs.map((job) => <tr key={job.id}><td>{job.type}</td><td><span className={`status ${job.status === "FAILED" ? "blocked" : job.status === "QUEUED" ? "pending" : ""}`}>{job.status}</span></td><td>{job.progress}%</td><td>{job.createdAt.toLocaleString("ko-KR")}</td></tr>)}</tbody></table> : <div className="empty">아직 실행된 작업이 없습니다.</div>}</section></div>}
  </div></main>;
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { LogoutButton } from "@/components/logout-button";
import { AdminUsers } from "@/components/admin-users";
import { requirePageUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requirePageUser();
  if (admin.role !== "ADMIN") redirect("/dashboard");
  const [users, pending, approved, activeDevices] = await Promise.all([
    db.user.findMany({ where: { role: "USER" }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], select: { id: true, email: true, displayName: true, status: true, createdAt: true } }),
    db.user.count({ where: { role: "USER", status: "PENDING_APPROVAL" } }),
    db.user.count({ where: { role: "USER", status: "APPROVED" } }),
    db.device.count({ where: { status: "ACTIVE" } }),
  ]);
  return <main className="dashboard"><div className="shell"><header className="topbar"><Brand /><nav className="nav"><Link className="button small" href="/dashboard">내 대시보드</Link><LogoutButton /></nav></header><section className="dashboard-head"><div><div className="eyebrow">Owner Console</div><h1>관리자 승인함</h1><p>관리자 계정은 hiway@kakao.com 한 개만 허용됩니다.</p></div><span className="status">단일 관리자</span></section><div className="grid"><section className="card span-4"><h2>승인 대기</h2><div className="metric">{pending}</div></section><section className="card span-4"><h2>승인 사용자</h2><div className="metric">{approved}</div></section><section className="card span-4"><h2>활성 PC</h2><div className="metric">{activeDevices}</div></section><section className="card span-12"><div className="row"><div><h2>사용자 관리</h2><p>승인과 정지는 MCP 및 장치 접근에 즉시 반영됩니다.</p></div></div><AdminUsers users={users.map((user) => ({ ...user, createdAt: user.createdAt.toISOString() }))} /></section></div></div></main>;
}

import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { ensureAccount, isAdmin } from '@/lib/account';
import { getDb } from '@/db';
import { devices, users } from '@/db/schema';
import { AdminUsers } from './users-client';
import { UpdateReleaseManager } from './update-release-client';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const identity = await requireChatGPTUser('/admin');
  const account = await ensureAccount(identity);
  if (!isAdmin(account)) redirect('/dashboard');
  const db = getDb();
  const [userRows, deviceRows] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)),
    db.select().from(devices),
  ]);
  const activeByUser = new Map(deviceRows.filter((item) => item.status === 'ACTIVE').map((item) => [item.userId, item]));
  const data = userRows.map((user) => ({
    ...user,
    deviceName: activeByUser.get(user.id)?.name || null,
    deviceLastSeenAt: activeByUser.get(user.id)?.lastSeenAt || null,
  }));

  return (
    <main className="app-shell">
      <header className="app-nav shell">
        <Link className="brand" href="/"><span className="brand-mark">B</span><span>BlogAutoMCP</span></Link>
        <nav><Link href="/dashboard">내 대시보드</Link><Link href={chatGPTSignOutPath('/')}>로그아웃</Link></nav>
      </header>
      <div className="shell dashboard-wrap">
        <section className="dashboard-head">
          <div><p className="eyebrow">OWNER CONSOLE</p><h1>사용자 승인함</h1><p>관리자는 hiway@kakao.com 한 계정만 허용됩니다.</p></div>
          <span className="status-pill status-approved">단일 관리자</span>
        </section>
        <section className="metric-grid">
          <article><span>승인 대기</span><strong>{data.filter((item) => item.status === 'PENDING_APPROVAL').length}</strong><small>검토가 필요한 계정</small></article>
          <article><span>승인 사용자</span><strong>{data.filter((item) => item.status === 'APPROVED').length}</strong><small>관리자 포함</small></article>
          <article><span>활성 PC</span><strong>{deviceRows.filter((item) => item.status === 'ACTIVE').length}</strong><small>사용자당 최대 1대</small></article>
        </section>
        <UpdateReleaseManager />
        <AdminUsers initialUsers={data} />
      </div>
    </main>
  );
}

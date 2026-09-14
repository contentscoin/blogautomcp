import Link from 'next/link';
import { env } from 'cloudflare:workers';
import { and, desc, eq } from 'drizzle-orm';
import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { ensureAccount, isAdmin } from '@/lib/account';
import { getD1, getDb } from '@/db';
import { agentJobs, devices, mcpConnections } from '@/db/schema';
import { DashboardActions } from './dashboard-actions';
import { WINDOWS_INSTALLER_VERSION } from '@/lib/installer';
import { readWindowsRelease } from '@/lib/update-release';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const identity = await requireChatGPTUser('/dashboard');
  const account = await ensureAccount(identity);
  const db = getDb();
  const [[connection], [device], jobs, clock, release] = await Promise.all([
    db.select({ generation: mcpConnections.generation, createdAt: mcpConnections.createdAt }).from(mcpConnections).where(and(eq(mcpConnections.userId, account.id), eq(mcpConnections.status, 'ACTIVE'))).limit(1),
    db.select().from(devices).where(and(eq(devices.userId, account.id), eq(devices.status, 'ACTIVE'))).orderBy(desc(devices.pairedAt)).limit(1),
    db.select().from(agentJobs).where(eq(agentJobs.userId, account.id)).orderBy(desc(agentJobs.createdAt)).limit(8),
    getD1().prepare(`SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now`).first<{ now: number }>(),
    readWindowsRelease(env.INSTALLERS),
  ]);
  const approved = account.status === 'APPROVED';
  const online = Boolean(device?.lastSeenAt && Number(clock?.now || 0) - device.lastSeenAt < 90_000);

  return (
    <main className="app-shell">
      <header className="app-nav shell">
        <Link className="brand" href="/"><span className="brand-mark">B</span><span>BlogAutoMCP</span></Link>
        <nav><span className="account-email">{account.email}</span>{isAdmin(account) && <Link href="/admin">관리자 승인함</Link>}<Link href={chatGPTSignOutPath('/')}>로그아웃</Link></nav>
      </header>
      <div className="shell dashboard-wrap">
        <section className="dashboard-head">
          <div><p className="eyebrow">CONTROL CENTER</p><h1>{account.displayName || account.email}님의 연결</h1><p>ChatGPT 명령과 이 PC의 네이버 자동화를 연결합니다.</p></div>
          <span className={`status-pill status-${account.status.toLowerCase()}`}>{statusLabel(account.status)}</span>
        </section>

        <section className="download-card">
          <div className="download-copy">
            <span className="card-kicker">DESKTOP AGENT</span>
            <h2>데스크톱 프로그램 설치</h2>
            <p>운영체제에 맞는 프로그램을 설치한 뒤 PC 연결 주소로 이 기기를 인증하세요. ChatGPT MCP는 Site의 GPT 로그인 계정으로 별도 인증됩니다.</p>
          </div>
          <div className="download-actions">
            <div className="download-action">
              <span className="download-platform">WINDOWS 10/11 · 64-BIT</span>
              <a className="button button-primary download-button" href="/api/download/windows" download>
                <span aria-hidden="true">↓</span> Windows 다운로드
              </a>
              <small>버전 {release?.version || WINDOWS_INSTALLER_VERSION} · SmartScreen 안내가 표시될 수 있습니다.</small>
            </div>
            <div className="download-action">
              <span className="download-platform">macOS · APPLE SILICON</span>
              <a className="button button-ghost download-button" href="/api/download/macos" download>
                <span aria-hidden="true">↓</span> macOS 다운로드
              </a>
              <small>버전 {release?.version || WINDOWS_INSTALLER_VERSION} · Apple Silicon용 DMG</small>
            </div>
          </div>
        </section>

        {!approved ? (
          <section className="notice-card">
            <span className="notice-icon">⌛</span><div><h2>{account.status === 'PENDING_APPROVAL' ? '관리자 승인을 기다리고 있습니다' : '현재 사용할 수 없는 계정입니다'}</h2><p>관리자 hiway@kakao.com이 승인하면 MCP 주소 발급과 PC 연결 메뉴가 자동으로 열립니다.</p></div>
          </section>
        ) : (
          <>
            <section className="metric-grid">
              <article><span>ChatGPT MCP</span><strong>OAuth 인증</strong><small>GPT 로그인 계정과 연결</small></article>
              <article><span>로컬 PC</span><strong>{online ? '온라인' : device ? '오프라인' : '미연결'}</strong><small>{device?.name || 'MCP 주소를 앱에 입력하세요'}</small></article>
              <article><span>최근 작업</span><strong>{jobs.length}건</strong><small>대기 {jobs.filter((job) => job.status === 'QUEUED').length} · 실행 {jobs.filter((job) => job.status === 'RUNNING').length}</small></article>
            </section>
            <DashboardActions hasConnection={Boolean(connection)} generation={connection?.generation || 0} />
            <section className="data-card">
              <div className="card-title"><div><span className="card-kicker">JOB LEDGER</span><h2>최근 작업</h2></div><span className={`agent-dot ${online ? 'online' : ''}`}>{online ? 'PC ONLINE' : 'PC OFFLINE'}</span></div>
              {jobs.length ? <div className="job-list">{jobs.map((job) => <div className="job-row" key={job.id}><div><strong>{jobTitle(job.type)}</strong><small>{new Date(job.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</small><details><summary>작업 상세</summary><p>작업번호: {job.id}</p><p>단계: {job.stageMessage || job.stage || '대기'} · {job.progress}%</p>{materialJobId(job.resultJson) && <p>소재 작업번호: {materialJobId(job.resultJson)} · ChatGPT에서 이 번호의 소재 작업 결과를 조회할 수 있습니다.</p>}{job.errorCode && <p>원인: {job.errorCode} · {job.errorMessage}</p>}<p>이 기록은 MCP 하위 요청 상태입니다. 소재 준비·발행의 최종 결과는 같은 소재 작업번호로 확인하세요.</p></details></div><span>{job.connectKind || '—'}</span><b className={`job-status job-${job.status.toLowerCase()}`}>{job.status}</b></div>)}</div> : <p className="empty-copy">아직 전달된 작업이 없습니다. MCP 연결 후 ChatGPT에서 요청해보세요.</p>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function statusLabel(status: string) {
  return ({ APPROVED: '승인됨', PENDING_APPROVAL: '승인 대기', REJECTED: '승인 거절', SUSPENDED: '사용 정지' } as Record<string, string>)[status] || status;
}
function jobTitle(type: string) {
  return ({ BRANDCONNECT_LIST_PRODUCTS: '상품 목록 조회', BRANDCONNECT_SYNC_PRODUCTS: '상품 가져오기', POST_CREATE_DRAFT: '초안 근거 준비(구버전)', POST_PREPARE_DRAFT: '초안 근거 준비', POST_SUBMIT_DRAFT: 'ChatGPT 원고 제출', POST_PUBLISH: '즉시 발행', POST_SCHEDULE: '예약 소재 선택 안내', MATERIALS_LIST: '소재·진행 조회', MATERIALS_PREPARE: '소재 준비 접수', MATERIALS_PUBLISH: '선택 소재 발행 접수' } as Record<string, string>)[type] || type;
}

function materialJobId(resultJson: string | null): string | null {
  if (!resultJson) return null;
  try {
    const result = JSON.parse(resultJson);
    const id = result?.data?.workflowJobId || result?.data?.jobId || result?.workflowJobId;
    return typeof id === 'string' ? id : null;
  } catch { return null; }
}

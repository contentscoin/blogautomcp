import Link from "next/link";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <main>
      <div className="shell">
        <header className="topbar">
          <Brand />
          <nav className="nav">
            {user ? (
              <Link className="button small primary" href="/dashboard">대시보드</Link>
            ) : (
              <>
                <Link className="button small" href="/login">로그인</Link>
                <Link className="button small primary" href="/signup">가입 신청</Link>
              </>
            )}
          </nav>
        </header>

        <section className="hero">
          <div>
            <div className="eyebrow">ChatGPT × Local Automation</div>
            <h1>대화로 지시하고,<br />내 PC에서 실행합니다.</h1>
            <p>
              쇼핑커넥트와 여행커넥트 상품을 불러오고, 네이버 로그인 상태부터
              포스팅 진행 상황까지 ChatGPT에서 확인하세요. 실제 브라우저 작업은
              인증된 한 대의 로컬 PC에서만 안전하게 실행됩니다.
            </p>
            <div className="actions">
              <Link href="/signup" className="button primary">승인 요청하기</Link>
              <Link href="/login" className="button">이미 계정이 있어요</Link>
            </div>
          </div>

          <aside className="signal-card" aria-label="서비스 상태 예시">
            <div className="eyebrow">Live control plane</div>
            <div className="signal-row"><span><i className="dot" />로컬 에이전트</span><b>온라인</b></div>
            <div className="signal-row"><span><i className="dot" />쇼핑커넥트</span><b>연결됨</b></div>
            <div className="signal-row"><span><i className="dot" />여행커넥트</span><b>최초 계약 확인</b></div>
            <div className="signal-row"><span className="muted">활성 PC</span><span className="tiny">1대만 허용</span></div>
          </aside>
        </section>

        <section className="features">
          <article className="feature"><b>관리자 승인제</b><p>가입 즉시 승인 대기 상태가 되며, 지정 관리자만 이용 권한을 열 수 있습니다.</p></article>
          <article className="feature"><b>일회성 MCP 연결</b><p>연결 URL은 발급 직후 한 번만 표시되고, 재발급하면 기존 연결은 즉시 폐기됩니다.</p></article>
          <article className="feature"><b>한 계정 · 한 PC</b><p>다른 PC가 연결되면 기존 장치 토큰과 작업 연결이 자동으로 종료됩니다.</p></article>
        </section>
      </div>
    </main>
  );
}

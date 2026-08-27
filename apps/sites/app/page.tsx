import Link from 'next/link';
import { chatGPTSignInPath, getChatGPTUser } from './chatgpt-auth';

const capabilities = [
  ['01', '승인형 가입', 'ChatGPT로 로그인하면 관리자 승인함에 바로 등록됩니다. 이메일 인증은 없습니다.'],
  ['02', 'MCP 단일 연결', '승인된 계정마다 한 번만 보이는 MCP 주소를 발급하고 언제든 안전하게 교체합니다.'],
  ['03', 'PC 에이전트', '활성 PC 한 대가 쇼핑·여행커넥트 작업을 받아 네이버 브라우저에서 실행합니다.'],
] as const;

export default async function Home() {
  const user = await getChatGPTUser();
  const actionHref = user ? '/dashboard' : chatGPTSignInPath('/dashboard');

  return (
    <main className="landing-shell">
      <nav className="nav shell">
        <Link className="brand" href="/" aria-label="BlogAutoMCP 홈">
          <span className="brand-mark">B</span>
          <span>BlogAutoMCP</span>
        </Link>
        <div className="nav-actions">
          <span className="nav-note">Sites · D1 · ChatGPT</span>
          <Link className="button button-small button-ghost" href={actionHref}>
            {user ? '대시보드' : 'ChatGPT로 로그인'}
          </Link>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow">NAVER BRANDCONNECT OPERATIONS</p>
          <h1>대화로 지시하고,<br />내 PC에서 발행합니다.</h1>
          <p className="hero-lead">
            쇼핑커넥트와 여행커넥트 작업을 ChatGPT에서 만들고, 승인된 한 대의 PC가
            네이버 로그인 세션으로 안전하게 실행합니다.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href={actionHref}>
              {user ? '내 연결 관리하기' : 'ChatGPT로 시작하기'} <span aria-hidden="true">↗</span>
            </Link>
            <a className="text-link" href="#workflow">작동 방식 보기 ↓</a>
          </div>
          <p className="trust-line">이메일 확인 없음 · 관리자 승인 · 사용자당 PC 1대</p>
        </div>

        <div className="hero-panel" aria-label="서비스 연결 흐름">
          <div className="panel-top"><span>LIVE CONTROL PLANE</span><span className="live"><i /> READY</span></div>
          <div className="flow-card flow-chat"><span className="flow-icon">G</span><div><strong>ChatGPT</strong><small>게시 작업 생성</small></div><b>01</b></div>
          <div className="connector"><span>HTTPS MCP</span></div>
          <div className="flow-card flow-site"><span className="flow-icon">B</span><div><strong>BlogAutoMCP</strong><small>승인 · 큐 · 장치 제어</small></div><b>02</b></div>
          <div className="connector"><span>3초 보안 폴링</span></div>
          <div className="flow-card flow-pc"><span className="flow-icon">PC</span><div><strong>내 Windows PC</strong><small>네이버 웹 자동화</small></div><b>03</b></div>
        </div>
      </section>

      <section className="capability-band" id="workflow">
        <div className="shell capability-grid">
          {capabilities.map(([number, title, body]) => (
            <article key={number} className="capability-card"><span>{number}</span><h2>{title}</h2><p>{body}</p></article>
          ))}
        </div>
      </section>
    </main>
  );
}

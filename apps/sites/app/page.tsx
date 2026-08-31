import Link from 'next/link';
import { chatGPTSignInPath, getChatGPTUser } from './chatgpt-auth';
import LandingLiveCanvas from './landing-live-canvas';

const features = [
  ['✦', '대화로 포스팅 준비', '“여행상품 3번 초안 만들어줘”처럼 말하면 상품 분석부터 제목, 본문, 이미지 구성까지 준비합니다.'],
  ['◉', '상품에 맞는 전용 글', '쇼핑은 구매 판단 포인트와 확인된 사용 장면 중심으로, 여행은 일정·동선·관광 정보 중심으로 서로 다르게 작성합니다.'],
  ['▣', '이미지와 썸네일까지', '제품 원본은 변형하지 않고 연출 배경과 합성하며, 여행지는 실사형 이미지와 읽기 쉬운 카피로 구성합니다.'],
  ['↗', '초안부터 실제 발행', '네이버 에디터에 이미지·본문·브랜드커넥트 링크를 넣고, 올바른 상품이 연결됐는지 확인한 뒤 발행합니다.'],
] as const;

const shoppingPoints = [
  '브랜드커넥트 쇼핑상품 자동 동기화',
  '구매 포인트·사용 장면 중심 SEO 초안',
  '상품 원본을 보존하는 이미지 락인 합성',
  '상세페이지 이미지와 정확한 레퍼럴 링크 적용',
] as const;

const travelPoints = [
  '국가·도시·일정·혜택별 여행상품 탐색',
  '현지 동선·관광지·준비 팁이 담긴 정보형 여행 리뷰',
  '여행지 실사형 삽입 이미지와 썸네일 구성',
  '여행 전용 상품 검색과 레퍼럴 링크 검증',
] as const;

export default async function Home() {
  const user = await getChatGPTUser();
  const actionHref = user ? '/dashboard' : chatGPTSignInPath('/dashboard');
  const downloadHref = user
    ? '/api/download/windows'
    : chatGPTSignInPath('/api/download/windows');

  return (
    <main className="landing-shell product-landing">
      <nav className="nav shell">
        <Link className="brand" href="/" aria-label="BlogAutoMCP 홈"><span className="brand-mark">B</span><span>BlogAutoMCP</span></Link>
        <div className="nav-actions">
          <span className="nav-note">쇼핑·여행 포스팅 자동화</span>
          <a className="button button-small button-primary" href={downloadHref}>Windows 앱 다운로드</a>
          <Link className="button button-small button-ghost" href={actionHref}>{user ? '내 대시보드' : 'ChatGPT로 로그인'}</Link>
        </div>
      </nav>

      <section className="lp-hero shell">
        <LandingLiveCanvas />
        <div className="lp-hero-copy">
          <p className="eyebrow">NAVER BRANDCONNECT BLOG AUTOMATION</p>
          <h1>상품을 고르면,<br /><em>포스팅이 완성됩니다.</em></h1>
          <p className="lp-hero-lead">쇼핑커넥트와 여행커넥트 상품을 불러오고, ChatGPT와 대화해 고품질 초안·이미지·썸네일을 만든 뒤 내 네이버 블로그에 발행하세요.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href={actionHref}>{user ? '내 자동화 열기' : 'ChatGPT로 시작하기'} <span aria-hidden="true">↗</span></Link>
            <a className="button button-ghost" href={downloadHref}><span aria-hidden="true">↓</span> Windows 앱 다운로드</a>
            <a className="text-link" href="#possibilities">무엇을 할 수 있나요? ↓</a>
          </div>
          <div className="lp-trust"><span><i /> 네이버 로그인은 내 PC에만 저장</span><span><i /> 관리자 승인 사용자만 이용</span></div>
        </div>

        <div className="lp-product-preview" aria-label="BlogAutoMCP 포스팅 작업 예시">
          <div className="preview-window-bar"><span className="preview-logo">B</span><strong>새 포스팅 만들기</strong><span className="preview-status"><i /> PC 연결됨</span></div>
          <div className="preview-tabs" role="tablist" aria-label="커넥트 유형 예시"><span className="active" role="tab" aria-selected="true">여행커넥트</span><span role="tab" aria-selected="false">쇼핑커넥트</span></div>
          <div className="preview-post-card">
            <div className="preview-photo" aria-hidden="true"><div className="sun" /><div className="mountain mountain-back" /><div className="mountain mountain-front" /><span>TRAVEL REVIEW</span><strong>타이페이·단수이<br />4일 여행기</strong></div>
            <div className="preview-copy"><span className="preview-chip">초안 완성</span><h2>처음 가도 헤매지 않는<br />타이페이 3박 4일</h2><p>일정별 동선 · 현지 명소 · 교통 팁 · 추천 대상</p><div className="preview-progress"><span /></div><div className="preview-meta"><span>이미지 8장</span><span>여행 링크 검증</span><b>발행 준비</b></div></div>
          </div>
          <div className="preview-command"><span>“일정·동선·예약조건을 풍부하게 정리해줘”</span><b>→</b></div>
        </div>
      </section>

      <section className="lp-proof-strip" aria-label="주요 지원 기능"><div className="shell"><span>상품 동기화</span><i /><span>SEO 초안</span><i /><span>GPT 이미지</span><i /><span>레퍼럴 링크</span><i /><span>예약·바로 발행</span></div></section>

      <section className="lp-section shell" id="possibilities">
        <div className="lp-section-heading"><p className="eyebrow">ONE CONVERSATION, COMPLETE POST</p><h2>글쓰기보다 운영에 집중하세요</h2><p>상품을 찾고, 자료를 모으고, 이미지를 만들고, 에디터에 옮기는 반복 작업을 한 번에 이어갑니다.</p></div>
        <div className="lp-feature-grid">
          {features.map(([icon, title, body], index) => <article className="lp-feature-card" key={title}><div><span>{icon}</span><b>0{index + 1}</b></div><h3>{title}</h3><p>{body}</p></article>)}
        </div>
      </section>

      <section className="lp-connect-section"><div className="shell">
        <div className="lp-section-heading lp-section-heading-light"><p className="eyebrow">TWO CONNECTS, TWO WRITING STYLES</p><h2>상품 성격에 맞춰 완전히 다르게</h2><p>여행상품을 쇼핑상품처럼 쓰지 않습니다. 수집 경로부터 글의 흐름, 이미지, 링크 검증까지 각각의 전용 방식으로 처리합니다.</p></div>
        <div className="lp-connect-grid">
          <article className="lp-connect-card shopping"><div className="connect-card-head"><span>SHOPPING</span><b>쇼핑커넥트</b><i>01</i></div><h3>제품의 매력을<br />구매 이유로 바꾸는 글</h3><ul>{shoppingPoints.map((point) => <li key={point}><span>✓</span>{point}</li>)}</ul></article>
          <article className="lp-connect-card travel"><div className="connect-card-head"><span>TRAVEL</span><b>여행커넥트</b><i>02</i></div><h3>여행 전 궁금한 정보가<br />충분히 담긴 정보형 리뷰</h3><ul>{travelPoints.map((point) => <li key={point}><span>✓</span>{point}</li>)}</ul></article>
        </div>
      </div></section>

      <section className="lp-section shell lp-conversation-section">
        <div className="lp-conversation-copy"><p className="eyebrow">JUST ASK CHATGPT</p><h2>복잡한 메뉴 대신,<br />평소 말하듯 지시하세요</h2><p>상품 목록 확인부터 초안 수정, 썸네일 제작, 발행까지 ChatGPT 대화 안에서 이어집니다.</p></div>
        <div className="lp-chat" aria-label="ChatGPT 명령 예시">
          <div className="chat-message user">여행커넥트 인기상품 10개 불러와줘</div>
          <div className="chat-message assistant"><b>B</b><span>상품을 확인했어요. 일정과 혜택을 비교해 10개를 정리했습니다.</span></div>
          <div className="chat-message user">3번 상품, 정보가 풍부한 여행 리뷰 초안과 실사 썸네일까지 준비해줘</div>
          <div className="chat-message assistant success"><b>✓</b><span>초안과 이미지가 준비됐습니다. 연결된 여행상품도 확인했어요.</span></div>
        </div>
      </section>

      <section className="lp-steps-section"><div className="shell lp-steps-wrap">
        <div className="lp-section-heading"><p className="eyebrow">START IN THREE STEPS</p><h2>설치는 한 번, 포스팅은 계속</h2></div>
        <ol className="lp-steps">
          <li><b>1</b><div><strong>ChatGPT로 가입</strong><p>이메일 인증 없이 로그인하고 관리자 승인을 받습니다.</p></div></li>
          <li><b>2</b><div><strong>PC 프로그램 연결</strong><p>프로그램을 설치하고 네이버에 로그인하면 준비가 끝납니다.</p></div></li>
          <li><b>3</b><div><strong>대화로 포스팅</strong><p>ChatGPT에서 상품을 고르고 초안·이미지·발행을 요청합니다.</p></div></li>
        </ol>
        <div className="lp-final-cta"><div><span>READY TO PUBLISH?</span><h2>첫 포스팅을 시작해 보세요.</h2></div><Link className="button lp-cta-button" href={actionHref}>{user ? '대시보드 열기' : 'ChatGPT로 시작하기'} <span>↗</span></Link></div>
      </div></section>
    </main>
  );
}

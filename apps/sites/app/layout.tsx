import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BlogAutoMCP — 상품을 고르면 포스팅이 완성됩니다',
  description: '쇼핑·여행커넥트 상품 동기화부터 SEO 초안, GPT 이미지, 썸네일, 네이버 블로그 발행까지 대화로 완성하세요.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <div className="site-frame">
          {children}
          <footer className="contact-footer">
            <div className="shell contact-footer-inner">
              <div>
                <p className="contact-kicker">CONTACT &amp; CUSTOM DEVELOPMENT</p>
                <h2>기타 문의나 프로그램 개발이 필요하신가요?</h2>
                <p>BlogAutoMCP 사용 문의부터 업무 자동화·맞춤 프로그램 개발 상담까지 텔레그램으로 편하게 연락해 주세요.</p>
              </div>
              <a
                className="button contact-button"
                href="https://t.me/Jake_shin"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="텔레그램으로 문의하기 (새 창)"
              >
                텔레그램 문의 <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="shell contact-footer-bottom">
              <span>BlogAutoMCP</span>
              <span>기타 문의 · 프로그램 개발 문의</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

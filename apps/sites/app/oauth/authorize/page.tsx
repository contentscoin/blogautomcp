import Link from 'next/link';
import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ensureAccount, canUseMcp } from '@/lib/account';
import { parseAuthorizationRequest, trustedSiteOriginValue } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OAuthAuthorizePage({ searchParams }: Props) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const returnTo = `/oauth/authorize?${query.toString()}`;
  const identity = await requireChatGPTUser(returnTo);
  const account = await ensureAccount(identity);
  const origin = trustedSiteOriginValue(typeof raw.resource === 'string' ? raw.resource : '') || '';
  const parsed = origin ? parseAuthorizationRequest(query, origin) : { ok: false as const, error: 'MCP 연결 요청을 확인할 수 없습니다.' };

  return (
    <main className="oauth-shell">
      <section className="oauth-card">
        <Link className="brand oauth-brand" href="/"><span className="brand-mark">B</span><span>BlogAutoMCP</span></Link>
        <p className="eyebrow">SECURE MCP CONNECTION</p>
        <h1>ChatGPT 연결 승인</h1>
        {!parsed.ok ? (
          <div className="oauth-error"><strong>연결 요청을 처리할 수 없습니다.</strong><p>{parsed.error}</p></div>
        ) : !canUseMcp(account) ? (
          <div className="oauth-error"><strong>관리자 승인이 필요합니다.</strong><p>{account.email} 계정은 아직 MCP 사용 승인을 받지 않았습니다.</p></div>
        ) : (
          <>
            <p className="oauth-lead"><strong>{account.email}</strong> 계정으로 ChatGPT가 승인된 PC의 블로그 자동화 기능을 사용하도록 연결합니다.</p>
            <ul className="oauth-permissions">
              <li><span>✓</span> 쇼핑·여행 상품 및 작업 상태 조회</li>
              <li><span>✓</span> 포스팅 초안 생성과 예약 작업 요청</li>
              <li><span>✓</span> 명시적으로 확인한 글의 발행 요청</li>
            </ul>
            <form action="/api/oauth/authorize" method="post">
              {Array.from(query.entries()).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
              <button className="button button-primary oauth-button" type="submit">이 계정으로 연결</button>
            </form>
            <p className="oauth-note">연결을 해제하거나 계정 승인이 취소되면 MCP 접근도 중단됩니다.</p>
          </>
        )}
      </section>
    </main>
  );
}

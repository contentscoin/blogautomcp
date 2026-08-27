import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth";
import { validateAuthorizationRequest } from "@/lib/oauth-request";

export const dynamic = "force-dynamic";

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
  }
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  const validated = await validateAuthorizationRequest(params, user.id);
  if ("error" in validated) return <main className="auth-wrap"><section className="auth-card card"><Brand /><h1>연결할 수 없습니다.</h1><div className="notice error">{validated.error}</div><div className="auth-footer"><Link href="/dashboard">대시보드로 돌아가기</Link></div></section></main>;
  const request = validated.request;
  return <main className="auth-wrap"><section className="auth-card card"><Brand /><h1>ChatGPT 연결 허용</h1><p><b>{user.email}</b> 계정의 로컬 자동화 도구를 ChatGPT에서 사용할 수 있게 합니다.</p><div className="notice">허용 범위: 에이전트 상태 확인, 쇼핑커넥트·여행커넥트 상품 조회 및 포스팅 작업 요청. 실제 발행 도구는 별도 확인값을 요구합니다.</div><form className="form" action="/api/oauth/authorize" method="post"><input type="hidden" name="client_id" value={request.clientId} /><input type="hidden" name="redirect_uri" value={request.redirectUri} /><input type="hidden" name="state" value={request.state} /><input type="hidden" name="resource" value={request.resource} /><input type="hidden" name="scope" value={request.scope} /><input type="hidden" name="code_challenge" value={request.codeChallenge} /><input type="hidden" name="code_challenge_method" value="S256" /><input type="hidden" name="response_type" value="code" /><button className="button primary" type="submit">연결 허용</button><Link className="button" href="/dashboard" style={{ textAlign: "center" }}>취소</Link></form></section></main>;
}

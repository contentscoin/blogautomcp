# apps/site — 폐기(Deprecated)

이 디렉터리는 초기 SaaS 시안(Vercel + PostgreSQL + 자체 OAuth)이며 **더 이상 빌드·배포·유지보수하지 않는다.**

- 현재 운영 사이트와 MCP 서버는 `apps/sites` (OpenAI Sites, Cloudflare Workers + D1) 이다.
- 루트 `package.json` 의 workspaces 와 `site:*` 스크립트에서 제거되었다.
- 인증 모델도 다르다: `apps/sites` 는 Sign in with ChatGPT + MCP URL(자격증명) + PC 장치 토큰(딥링크/코드 페어링)을 쓰며 OAuth 서버를 두지 않는다.

참고용으로만 남겨 두었으며, 다음 정리 릴리스에서 삭제될 수 있다. 새 기능은 반드시 `apps/sites` 에 추가한다.

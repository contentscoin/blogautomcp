# BlogAutoMCP Site

가입·관리자 승인·MCP URL·OAuth·단일 PC·작업 큐를 제공하는 서버리스 Next.js 사이트다. 별도 상주 백엔드 서버는 필요 없지만, 운영용 관리형 PostgreSQL은 한 번 생성해야 한다.

## 환경변수

`apps/site/.env.example`을 기준으로 배포 플랫폼에 다음 값을 등록한다.

```env
DATABASE_URL="postgresql://..."
SITE_URL="https://your-domain.example"
SITE_AUTH_SECRET="32자 이상의 랜덤 문자열"
ADMIN_EMAIL="hiway@kakao.com"
ADMIN_BOOTSTRAP_CODE="16자 이상의 최초 관리자 등록 코드"
```

- `SITE_URL`은 사용자가 실제 접속하는 HTTPS origin과 정확히 같아야 한다.
- `ADMIN_EMAIL`은 다른 값으로 바꿀 수 없다.
- 환경변수 원문과 `.env` 파일은 Git에 커밋하지 않는다.

랜덤값 예시 생성:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## 로컬 개발

PostgreSQL을 준비한 뒤 저장소 루트에서 실행한다.

```powershell
npm install
npm run site:db:migrate
npm run site:dev
```

사이트는 기본 `http://localhost:3100`에서 실행된다. 로컬 HTTP 개발에서는 `SITE_URL=http://localhost:3100`을 사용한다.

## 배포

권장 구성은 Vercel + 관리형 PostgreSQL이다.

1. PostgreSQL 프로젝트/데이터베이스를 생성한다.
2. Vercel 프로젝트의 Root Directory를 `apps/site`로 지정한다.
3. 위 환경변수를 Production/Preview 환경에 등록한다.
4. 초기 DB에 `npm run site:db:migrate`를 적용한다.
5. 배포 후 `hiway@kakao.com`으로 가입하며 `ADMIN_BOOTSTRAP_CODE`를 입력한다.
6. 관리자 화면에서 일반 계정을 승인한다.

## 검증

```powershell
npm run site:typecheck
npm run site:test
npm run site:build
npm audit
```

실제 출시 전에는 ChatGPT OAuth/MCP 연결과 관리형 PostgreSQL 전체 흐름을 배포 URL에서 별도로 E2E 검증한다.

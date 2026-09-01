# BlogAutoMCP 구현 기준서

기준일: 2026-08-26
상태: 사이트·MCP·로컬 에이전트 세로 슬라이스 구현 완료, 외부 자격증명 기반 실연동 검증 대기

## 1. 제품 정의

BlogAutoMCP는 승인된 사용자만 자신의 Windows PC를 ChatGPT와 연결해 네이버 브랜드커넥트 자동화를 실행하는 서비스다.

- 공개 사이트: 가입, 관리자 승인, MCP URL 발급, 장치·작업 상태 확인
- 서버리스 API: OAuth, MCP, 장치 인증, PostgreSQL 작업 큐
- 로컬 Electron 앱: MCP 주소 기반 장치 활성화, 네이버 로그인 세션, Playwright 자동화 실행
- ChatGPT: MCP 도구를 통해 로컬 PC에 작업을 요청하고 결과를 조회

상시 운영하는 별도 백엔드 서버, Redis, WebSocket 서버는 두지 않는다. 사이트 배포 플랫폼의 Next.js 서버리스 함수와 관리형 PostgreSQL만 사용한다. 로컬 PC는 3초 간격 HTTPS 폴링으로 작업을 가져간다.

## 2. 확정된 가입·권한 정책

- 사이트 가입에 이메일 인증을 요구하지 않는다.
- 일반 가입자는 `PENDING_APPROVAL`로 생성된다.
- 유일한 관리자 이메일은 `hiway@kakao.com`으로 코드에도 고정되어 있다.
- 관리자 최초 가입에는 배포 환경의 `ADMIN_BOOTSTRAP_CODE`가 필요하다.
- 관리자는 일반 사용자를 승인, 거절, 정지할 수 있다.
- 승인되지 않았거나 정지된 계정은 MCP 발급·OAuth·장치·작업 접근이 차단된다.

일반 웹사이트가 사용할 수 있는 공개형 “Sign in with ChatGPT” 공급자는 현재 공식 OpenAI 문서에 제공되지 않는다. 따라서 사이트 로그인은 이메일/비밀번호로 구현하되 이메일 확인을 없앴다. 사용자가 ChatGPT에 MCP를 추가할 때는 OAuth 화면에서 이 사이트 로그인을 사용한다. ChatGPT 쿠키나 비공개 OpenAI OAuth 주소는 사이트 로그인에 재사용하지 않는다.

## 3. 현재 아키텍처

```text
ChatGPT
  │ OAuth 2.0 + PKCE / Streamable HTTP MCP
  ▼
Next.js 서버리스 사이트 (apps/site)
  │ 사용자·승인·MCP·장치·작업
  ▼
관리형 PostgreSQL
  ▲
  │ HTTPS claim/complete 폴링
  │
Windows Electron 로컬 앱
  └─ MCP 장치 토큰 + SQLite + Playwright + 네이버 로컬 세션
```

사이트와 MCP 게이트웨이는 같은 Next.js 앱이다. 로컬 자동화 데이터와 네이버 브라우저 세션은 PC에 남고, 클라우드에는 사용자·승인·장치 토큰 해시·작업 상태와 요약 결과만 저장한다. 로컬 앱은 ChatGPT에 로그인하지 않으며, ChatGPT 연결은 사용자가 같은 MCP 주소를 ChatGPT 개발자 모드에 별도로 등록해 성립한다.

Windows 설치본은 로그인 시 `--hidden`으로 자동 실행되고, 일반 창 닫기는 앱을 트레이로 숨겨 폴러와 로컬 서버를 유지한다. 사용자가 트레이 메뉴에서 `완전히 종료`하면 다음 Windows 로그인 또는 수동 실행 전에는 ChatGPT가 해당 PC를 원격으로 다시 깨울 수 없다.

## 4. MCP URL과 단일 PC 정책

- 승인된 사용자당 활성 MCP 연결은 최대 1개다.
- URL은 `https://사이트/api/mcp/{endpointId}.{secret}` 형식이다.
- URL 원문은 발급 응답에서 한 번만 표시하며 DB에는 secret 해시만 저장한다.
- “추가 발행” 시 endpoint와 secret을 교체하고 generation을 증가시킨다.
- 재발급 트랜잭션은 기존 refresh token, 활성 장치, 대기·실행 작업을 폐기한다.
- 새 PC가 동일 URL로 인증되면 기존 활성 PC는 `REPLACED`가 되고 기존 장치 토큰은 즉시 실패한다.
- 로컬 앱은 페어링 후 MCP URL 원문을 저장하지 않고 사이트 URL, 장치 ID, 장치 토큰만 사용자 데이터 폴더에 저장한다.
- 로컬 앱은 유효한 장치 인증이 없으면 활성화 화면 외의 UI와 자동화 API를 차단한다.
- 사이트가 장치 토큰을 401/403으로 거절하면 로컬 자격증명을 지우고 즉시 다시 잠근다.
- 네이버 로그인은 장치 활성화 후에만 가능하며, 로컬 ChatGPT 로그인 기능은 제공하지 않는다.

## 5. 구현된 OAuth·MCP 계약

OAuth:

- Authorization Code + PKCE S256
- 동적 클라이언트 등록(DCR)
- OpenAI/ChatGPT HTTPS redirect URI allowlist
- 5분 authorization code, 15분 access token, 30일 refresh token
- refresh token 1회 회전과 재사용 방지
- `mcp:tools` 단일 scope
- 계정 정지, MCP generation 변경 시 토큰 즉시 무효화

MCP 도구:

- `agent_get_status`
- `brandconnect_list_products`
- `brandconnect_sync_products`
- `post_create_draft`
- `post_publish`
- `post_schedule`
- `job_get`
- `job_cancel`

`brandconnect_list_products`는 `connectKind=shopping|travel`로 커넥트를 분리하고,
`writingStatus=unwritten|written|all`로 작성 여부를 서버에서 판정한다. 여기서 `written`은
완성된 초안(`drafted`)·예약(`scheduled`)·발행 완료(`published`)만 의미한다. 응답에는
`writingStatus`와 `writingStatusMeaning`이 포함되며, `READY`라도 저장된 초안 패키지가
있으면 `drafted`로 분류한다. `status`를 함께 사용하면 예약(`SCHEDULED`)·발행 완료
(`PUBLISHED`)·진행 중 상태까지 세밀하게 조회할 수 있다.

실제 발행과 예약 발행은 `confirmed=true`가 없으면 거절한다. 쓰기 작업은 `idempotencyKey`를 요구한다. 장시간 작업은 즉시 `jobId`를 반환하고 `job_get`으로 확인한다.

## 6. PostgreSQL 운영 방식

PostgreSQL 프로그램을 PC나 별도 서버에 직접 설치할 필요는 없다. 단, 사이트를 실제 운영하려면 관리형 PostgreSQL 데이터베이스를 한 번 생성해야 한다.

필수 작업:

1. Vercel Marketplace, Neon, Supabase 등에서 PostgreSQL 생성
2. 배포 환경에 `DATABASE_URL` 등록
3. `npm run site:db:migrate`로 초기 migration 적용
4. 이후 앱은 Prisma를 통해 서버리스 함수에서 DB를 사용

로컬 Electron 앱은 별도의 SQLite를 사용하며 최초 실행 때 DB 파일과 테이블을 자동 생성한다.

## 7. 쇼핑커넥트·여행커넥트 상태

### 쇼핑커넥트

- 상품 선택, 링크 발급, SQLite 저장, 초안, 즉시/예약 발행 경로가 기존 자동화와 연결되어 있다.
- MCP의 `connectKind=shopping` 요청이 이 경로를 사용한다.
- 실제 네이버 계정 세션이 없는 개발 환경에서는 라이브 E2E를 완료할 수 없다.

### 여행커넥트

- DB, UI, MCP, 작업 큐는 `connectKind=travel`을 구분한다.
- 로그인된 네이버 세션에서 여행커넥트 JSON 응답의 endpoint와 구조만 수집하는 `/api/brandlinks/travel-contract`가 구현되어 있다.
- 캡처 파일에는 응답 원문, 쿠키, 여행상품 개인 데이터가 저장되지 않는다.
- 현재 네이버의 실제 여행커넥트 목록·링크 발급·에디터 삽입 계약을 확인하지 못했으므로 자동 발행 어댑터는 fail-closed 상태다.
- 실제 사용 전 필요한 작업은 로컬 앱에서 네이버 로그인 → 여행커넥트 상품 찾기 URL 입력 → 계약 캡처 → 캡처 결과 기반 어댑터 구현·실발행 검증이다.

확인되지 않은 쇼핑 API/DOM을 여행커넥트에 그대로 재사용하지 않는다. 잘못된 제휴 링크 발급이나 포스팅을 막기 위한 출시 게이트다.

## 8. 보안 기준

- 비밀번호: scrypt + 사용자별 salt
- 세션: DB 저장 opaque token hash, HttpOnly/SameSite 쿠키, 운영 HTTPS에서 Secure
- CSRF: 쿠키 기반 변경 API의 운영 Origin을 `SITE_URL`과 정확히 비교
- 속도 제한: 가입, 로그인, 장치 페어링, OAuth DCR을 PostgreSQL에서 제한
- 토큰: DB에는 MCP secret, 장치 token, OAuth code/refresh token의 해시만 저장
- URL: MCP origin·길이·문자 집합을 엄격하게 검증
- 작업: 사용자·장치 소유권을 모든 claim/complete/get/cancel에서 재검증
- 응답: 입력 길이 제한, OAuth redirect allowlist, 보안 헤더 적용
- 공급망: 현재 `npm audit` 0건을 출시 기준으로 사용

네이버 브라우저 storage state와 로컬 장치 토큰은 클라우드로 업로드하지 않는다. 로컬 ChatGPT storage state는 생성하거나 저장하지 않는다. 설치본 코드서명과 장치 토큰의 Windows 자격증명 보관소 전환은 공개 배포 전 추가 하드닝 항목이다.

## 9. 배포 순서

1. `apps/site`를 Next.js 서버리스 프로젝트로 배포한다.
2. 관리형 PostgreSQL과 환경변수를 연결하고 migration을 적용한다.
3. `hiway@kakao.com`으로 관리자 최초 가입 후 일반 사용자를 승인한다.
4. 사용자가 MCP URL을 한 번 발급해 먼저 Windows 설치본을 활성화한다.
5. 같은 MCP URL을 ChatGPT 개발자 모드에 별도로 등록하고 Windows 설치본에서 네이버 로그인을 완료한다.
6. 쇼핑커넥트 실계정 조회 → 초안 → 테스트 블로그 예약 발행을 검증한다.
7. 여행커넥트 계약을 캡처하고 전용 어댑터 및 실발행을 검증한 뒤 해당 기능을 활성화한다.

## 10. 출시 판정

현재 코드로 검증 가능한 항목:

- 타입 검사, 단위 테스트, 두 Next.js 앱의 프로덕션 빌드
- OAuth/MCP 입력·토큰·rotation 코드 경로
- 로컬 SQLite 자동 초기화와 데스크톱 패키징
- 사이트와 로컬 설정 화면

외부 환경이 있어야 검증 가능한 항목:

- 관리형 PostgreSQL을 사용한 가입 → 승인 → MCP → 장치 → 작업 전체 E2E
- ChatGPT 실제 MCP 등록과 OAuth callback
- 네이버 실계정 쇼핑커넥트 조회·발행
- 여행커넥트 계약 캡처·링크 발급·에디터 삽입·발행

위 외부 E2E가 모두 통과하기 전에는 “쇼핑·여행 모두 운영 완료”로 판정하지 않는다.

## 11. 공식 참고

- ChatGPT 개발자 모드와 원격 MCP 연결: <https://developers.openai.com/api/docs/guides/developer-mode>
- Naver BrandConnect 고객센터: <https://help.naver.com/service/30027/category/6243?lang=ko>

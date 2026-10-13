# MCP 자동 갱신의 메타데이터와 명시적 동의 — 2026-10-13

## 변경

MCP `tools/list`의 모든 공개 도구가 기존 도구 권한(`mcp:read` 또는 `mcp:write`)과 `offline_access`를 함께 요청하도록 수정했습니다. 서버 메타데이터 revision은 `1.3.17`이며 Windows 앱 버전과는 별도입니다. 새로 고친 플러그인 정보로 연결을 승인하면 자동 갱신 동의가 요청 scope에 포함될 수 있습니다.

당시 승인 요청에 `offline_access`가 없는 경우 약 1시간 후 재연결이 필요하다는 안내만 추가했습니다. 아래 후속 검증에서 메타데이터만 바꾸어도 기존 연결의 재인증 요청에는 자동 갱신 범위가 포함되지 않는 경우를 확인해 명시적인 동의 옵션을 보강했습니다.

## 근거와 한계

[OpenAI 플러그인 인증 문서](https://developers.openai.com/plugins/build/auth)는 도구의 OAuth `securitySchemes.scopes`에 요청할 동의 권한을 포함하도록 설명합니다. 기존 설치에서 변경된 동의 정보를 확인하도록 플러그인 정보 새로고침·재연결 절차를 안내합니다.

기존 서버의 access token 3,600초, refresh token 30일, 명시적 `offline_access` 동의와 refresh 다운스코프 정책은 유지합니다. OAuth token 발급·회전 구현, 기존 연결·계정·PC 자격증명은 변경하지 않았습니다.

최초 메타데이터 변경 시에는 현장 오류 `oauth_refresh_token_missing`의 실제 발급 경로가 미확정이었습니다. 그 변경 자체는 기존 연결에 refresh token이 생겼다는 증거가 아닙니다.

## 검증

- 실제 `tools/list`의 모든 도구에 `offline_access` 포함 및 읽기·쓰기 권한 분리 회귀
- 승인 화면의 scope 유무에 따른 안내 표시와 숨김, 요청 scope 보존 회귀
- 기존 OAuth 발급·회전·다운스코프·Workers 회귀
- Sites TypeScript, lint, 전체 테스트, production build

실행 결과:

- `npx tsc --noEmit -p apps/sites/tsconfig.json` — 통과
- `npm run lint --prefix apps/sites` — 오류·경고 없이 통과
- `node --test apps/sites/tests/*.test.cjs` — 190개 통과, 실패 0개
- `npm run build --prefix apps/sites` — production build 통과

메타데이터 revision 변경으로 기존 소재 재작성·보완 discovery fixture 두 곳의 기대값만 `1.3.16`에서 `1.3.17`로 맞췄습니다. 실제 도구 동작이나 OAuth 발급 정책은 바꾸지 않았습니다. 새 연결의 실제 scope와 1시간 이후 자동 갱신 성공은 위 로컬 검증에 포함되지 않습니다.

## 후속 읽기 전용 발급 범위 검증

공식 Sites 도구로 DB overview를 먼저 확인하고 `oauth_authorization_codes` 14행과 `oauth_tokens` 304행의 마지막 페이지까지 조회했습니다. 원시 응답은 도구 세션의 private store에만 보관하고, token/hash/개인 식별자/이메일/자격증명은 보고서나 로그에 출력하지 않았습니다.

최근 같은 연결 경로의 재인증 3건은 승인 코드와 발급 토큰 모두 `mcp:read mcp:write`로 저장됐고 갱신 토큰 발급이 없었습니다. 최신 재인증 코드는 11:49:12 UTC에 생성돼 11:49:19에 소모됐으며, 대응 access token은 12:49:19 UTC에 만료돼 12:52의 현장 오류와 부합합니다. 다른 연결에서는 같은 ChatGPT CIMD 클라이언트의 갱신 토큰 회전과 새 발급 기록이 있어 서버 전체의 갱신 실패로 판단하지 않습니다. 실패한 갱신 요청의 유무는 별도 요청 로그가 없어 DB의 토큰 행만으로 확정할 수 없습니다.

## 명시적인 자동 갱신 동의 보강

원래 요청에 `offline_access`가 없으면 승인 화면에 기본 미선택인 ‘ChatGPT 연결 유지와 토큰 자동 갱신 허용’ 체크박스를 표시합니다. 선택하지 않으면 기존 요청 범위와 약 1시간의 access token 동작을 유지합니다. 이미 `offline_access`를 요청한 경우도 기존 승인 범위를 유지합니다.

사용자가 선택하면 서버는 검증된 원래 요청의 read/write 권한을 유지하고 `offline_access` 하나만 추가합니다. 조회·작성 권한을 서로 추가하지 않고, 클라이언트가 임의로 보내는 extra scope 값을 추가 권한으로 신뢰하지 않습니다. URL에 주입한 동의 필드는 hidden input으로 전달하지 않아 자동 동의가 될 수 없습니다. 동의 필드 중복과 잘못된 값은 거부합니다. 기존 origin/client/redirect/resource/state/PKCE와 계정 승인 검사, 코드 단일 사용, token TTL·회전·명시적 refresh 다운스코프 정책은 유지합니다.

[RFC 6749 §3.3](https://datatracker.ietf.org/doc/html/rfc6749#section-3.3)은 resource owner의 지시에 따라 서버가 허용 범위를 정하고 요청과 다른 실제 범위를 token 응답으로 알리는 계약을 정의합니다. [OpenID Connect의 offline access 규칙](https://openid.net/specs/openid-connect-core-1_0.html#OfflineAccess)은 갱신 토큰을 위한 동의를 요구합니다. 현재 공개 [ChatGPT CIMD 문서](https://chatgpt.com/oauth/client.json)는 authorization code와 refresh token grant 및 public `none` 인증 방법을 지원하며 별도의 scope 제한 필드를 선언하지 않습니다. 실제 native 클라이언트가 명시적으로 추가 동의한 갱신 토큰을 저장하고 사용한다는 최종 증거는 현장 확인이 필요합니다.

변경 파일은 Sites의 OAuth helper·승인 page·승인 POST route·연결 회귀·workerd 회귀뿐입니다. Windows 1.3.126의 source/runtime, DB·기존 연결·토큰은 변경하지 않았습니다.

후속 실행 결과:

- 실제 page → POST → SQLite 승인 코드 → token route → refresh route와 workerd 동의 helper 회귀: 47개 PASS.
- GET 동의 주입, 미선택, 이미 요청된 offline 범위, read-only에서 write 자동 추가 금지, nonce/state 보존, 중복/잘못된 값과 기존 승인 가드 반례: PASS.
- Sites typecheck·lint: PASS.
- Sites 전체 테스트: 205개 PASS, 실패 0개.
- Sites production build와 diff 검사: PASS.

배포 후 동의 1회에 대한 실제 grant scope·refresh 발급과 이후 자동 갱신은 별도 확인해야 합니다. 토큰 응답에 refresh가 발급됐더라도 클라이언트의 실제 보존과 사용까지 확인하기 전에는 안정화 완료로 표현하지 않습니다. 클라이언트가 명시적으로 offline을 제외해 갱신 범위를 줄이면 기존 정책대로 다음 refresh token을 발급하지 않습니다.

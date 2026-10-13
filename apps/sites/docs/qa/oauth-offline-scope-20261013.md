# MCP 자동 갱신 동의 광고 보완 — 2026-10-13

## 변경

MCP `tools/list`의 모든 공개 도구가 기존 도구 권한(`mcp:read` 또는 `mcp:write`)과 `offline_access`를 함께 요청하도록 수정했습니다. 서버 메타데이터 revision은 `1.3.17`이며 Windows 앱 버전과는 별도입니다. 새로 고친 플러그인 정보로 연결을 승인하면 자동 갱신 동의가 요청 scope에 포함될 수 있습니다.

승인 요청에 `offline_access`가 없는 경우에는 약 1시간 후 재연결이 필요하다는 안내와 플러그인 정보 새로고침·재연결 절차를 표시합니다. 안내만 추가하며 사용자가 요청하지 않은 scope를 승인 입력에 넣지 않습니다.

## 근거와 한계

[OpenAI 플러그인 인증 문서](https://developers.openai.com/plugins/build/auth)는 도구의 OAuth `securitySchemes.scopes`에 요청할 동의 권한을 포함하도록 설명합니다. 기존 설치에서 변경된 동의 정보를 확인하도록 플러그인 정보 새로고침·재연결 절차를 안내합니다.

기존 서버의 access token 3,600초, refresh token 30일, 명시적 `offline_access` 동의와 refresh 다운스코프 정책은 유지합니다. OAuth token 발급·회전 구현, 기존 연결·계정·PC 자격증명은 변경하지 않았습니다.

현장 오류 `oauth_refresh_token_missing`의 실제 연결에서 최초 승인 scope 누락, refresh 다운스코프, 클라이언트 저장 누락 중 어느 경로가 발생했는지는 미확정입니다. 소스와 테스트에서 해당 조건을 확인했을 뿐 실제 토큰·DB·연결 자격증명을 조회하지 않았습니다. 이 변경은 기존 연결에 refresh token이 생겼다는 증거가 아닙니다. 새 플러그인 정보로 재인증한 연결과 1시간 이후 갱신은 별도 현장 검증이 필요합니다.

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

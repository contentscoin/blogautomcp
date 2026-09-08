# 전체 코드 점검 리포트

**작성일** 2026-09-07 · **개정** 2026-09-08 (외부 리뷰 반영, §9.1) · **대상** `blogautomcp` (루트 v1.3.25, `apps/sites` v1.0.0)
**범위** 1차 18개 서브시스템 + 2차 보강 4개 영역(Codex 출하 작성 경로 / API 라우트 전수 / 이미지 부족 게이트 원인 재판정 / 고아 테스트·환경 토글), 검증 완료 **189건**, 모든 항목을 서로 독립된 적대적 검증자 2명이 교차 확인. 1차 157건 + 2차 32건을 병합하고 중복·오지목을 정리해 최종 등재 **181항목**(CRITICAL 5 / HIGH 56 / MEDIUM 76 / LOW 45).

> **2026-09-08 개정.** PR #14의 외부 리뷰가 지적한 3건을 재검증해 등급과 서술을 정정했다. 그중 하나는 이 문서의 **헤드라인 발견**이었다. 정정 내역과 근거는 §9.1에 있다.

---

## 0. 판정

이 저장소는 "동작하는 제품"이지만 **현재 상태로 배포하면 안 되는 코드**다. 기반은 나쁘지 않다. `npx tsc --noEmit`이 `tsconfig.json`과 `tsconfig.scripts.json` 양쪽에서 exit 0으로 클린 통과하고(직접 재확인), 커밋된 하드코딩 자격증명은 하나도 없으며, 토큰 비교는 `timingSafeEqual` + 길이 사전검사를 쓰고(직접 재확인), OAuth는 PKCE-S256에 회전 토큰을 쓴다. SaaS 쪽 테넌트 격리(모든 조회가 `user_id`로 묶이고 claim/complete/heartbeat가 `claimed_by_device_id`까지 단일 문장으로 원자 보호)와 bulk 발행 스크립트(`bulk-schedule-publish.ts`, `bulk-today-publish.ts` — 확인되지 않은 상태를 성공으로 취급하기를 명시적으로 거부하고 중단)는 이 저장소에서 가장 잘 쓰인 코드다.

문제는 그 규율이 균일하지 않다는 점이다. 배포를 막는 사유는 네 갈래다.

1. **서명 없는 자동 업데이트 + 오염 가능한 업데이트 출처.** 이 문서에서 가장 중요한 발견이며 §2 첫머리에 별도로 서술한다. `scripts/electron/auto-update.cjs`의 `updateOrigin()`은 `REMOTE_SITE_URL`을 프로토콜만 보고 그대로 쓰며 허용 목록이 없고, 앱은 서명되지 않은 채 배포되므로 서명 검사에 대조 기준 자체가 없다. 그 출처를 오염시키는 경로는 둘이다 — **즉시 성립하는** mcpUrl 페어링 분기의 허용 목록 미검사(C3), 그리고 **2회 쓰기 + 재시작이 필요한** 설정 API의 파서 차이(H2). *초판은 후자를 "1회 저장으로 즉시 성립"이라고 적었으나 이는 틀렸다 — §9.1 참조.*
2. **"성공했는데 실패로 기록"에서 오는 중복 발행.** 네이버에 이미 올라간 글을 URL 캡처 실패만으로 FAILED로 적고(`scripts/topic-agent.ts:2993`, `scripts/simple-agent.ts:10174`), UI와 bulk 스크립트는 FAILED를 재발행 대상으로 삼는다. 스케줄러의 catch는 자식 프로세스가 쓴 SUCCESS를 PENDING으로 덮어써 다음 크론에서 다시 발행한다(`src/services/scheduler.ts:197`). 네이버 중복 콘텐츠 제재로 직결된다.
3. **저장소 루트의 살아 있는 코드모드 4종.** `fix-topic-agent.js` 등이 현재 `scripts/topic-agent.ts`/`scripts/lib/chatgpt-browser.ts`의 앵커에 여전히 매치된다. 드라이런 결과 `fix-topic-agent.js`는 3062줄 중 **1914줄(63%)**을 삭제하고도 "Successfully replaced generateAdvancedContent"를 출력한다(직접 재확인). 백업도 git-clean 검사도 없다.
4. **로컬 변경 API의 동일 출처 검사 부재.** 41개 API 라우트 중 `requireTrustedLocalMutation`이 걸린 것은 4개뿐이고, 30개가 넘는 변경 핸들러가 무방비다. 기본 설치(`ADMIN_API_KEY` 미설정 — 설정 UI가 "일반 로컬 사용에는 비워 두세요"라고 안내하는 상태)에서 `requireAdminApiKey`는 no-op이므로, 사용자가 방문한 아무 웹페이지나 고정 포트 `127.0.0.1:43127`으로 실제 네이버 발행을 시킬 수 있다.

여기에 더해 **출하 기본 작성 경로가 1차 감사에서 통째로 빠져 있었다.** `scripts/lib/draft-runtime-policy.json`이 `AI_PROVIDER="codex"`로 고정돼 있고 `scripts/simple-agent.ts:4560`이 `runCodexDraft`로 분기하는데, 실제 원고를 만드는 `scripts/lib/codex-draft-provider.ts`와 폴백 체인은 2차에서야 점검됐다(§4의 H24-H26, §6의 관련 MEDIUM/LOW). 이 경로에서만 CONFIRMED 9건이 새로 나왔다.

기능 결함 쪽에서는 예약 발행 경로 전체가 사망 상태(`Post.contentHtml`을 아무도 쓰지 않는데 스케줄러가 요구), 준비 시점과 발행 시점의 게이트 입력이 달라 "준비 완료 100점" 문서가 발행 시점에 영구 차단되는 데드락, Windows 전용 경로 정규식 미매칭 등 정상 경로에서 재현되는 결함이 다수다. 반대로 순수 계산 모듈(`bulk-schedule-plan`, `kst`, `image-timeout-policy`, `chatgpt-direct-prompt`), 스냅샷/진행률 모듈, 원자적 매니페스트 기록기는 견고하다. 즉 **설계가 아니라 적용의 일관성이 문제**이며, §11 순서대로 처리하면 대부분 국소 수정으로 끝난다.

### 도구 체인 실태 (직접 재확인)

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` (`tsconfig.json`) | exit 0, 클린 |
| `npx tsc --noEmit -p tsconfig.scripts.json` | exit 0, 클린 |
| `npx eslint` (저장소 전체) | **exit 1 — 34 errors / 6 warnings.** 대부분 `.cjs` 파일의 `@typescript-eslint/no-require-imports`. `eslint.config.mjs`는 루트 `.js` 7개만 예외 처리하고 `.cjs`는 전혀 면제하지 않는다 |
| `.github/workflows/ci.yml` lint 스텝 | `src` + 명시된 파일 14개만 대상(14개 모두 존재 확인). 저장소 전체를 린트하지 않으므로 **로컬 `npm run lint`는 빨간불인데 CI는 초록불** |
| `tsx` | `dependencies`/`devDependencies` 어디에도 없고 클린 `npm install` 후 `node_modules/.bin`에도 없음. `test:mcp-contract`, `test:draft-ui`, `test:osaka-audit`, `test:fixed-draft-settings` 4개가 맨 `tsx`를 호출 → `npm run test:mcp-contract`는 `sh: 1: tsx: not found`로 실패(실행 확인) |

---

## 1. 심각도 순 이슈 표 (CRITICAL / HIGH)

동일 파일·동일 근본원인 항목은 한 행으로 합쳤다. MEDIUM/LOW는 §6·§7 압축 표에 있다.

| 심각도 | 영역 | 파일:라인 | 문제 | 영향 |
|---|---|---|---|---|
| CRITICAL (CONFIRMED) | auth-secrets / api-brandlinks | `src/app/api/brandlinks/bulk-today/route.ts:92` 외 30+ | 변경 라우트 30여 개에 `requireTrustedLocalMutation` 부재 | 방문한 웹페이지가 실제 네이버 발행·설정 변조 실행 |
| HIGH (CONFIRMED) | auth-secrets / api-rest | `src/app/api/settings/route.ts:56` | `.env` 직렬화가 개행을 이스케이프하지 않고, 읽는 파서가 dotenv와 줄 단위 파서로 갈림 | 2회 쓰기 + 재시작 후 `REMOTE_SITE_URL` 오염 → 업데이터·잡 폴링 출처 리다이렉트 (2026-09-08 강등) |
| CRITICAL (CONFIRMED) | build-config | `scripts/electron/auto-update.cjs:17`, `:187` | `updateOrigin()`이 https 여부만 보고 허용 목록 미적용 + 앱 미서명 | 임의 출처의 NSIS 설치 파일을 무확인 설치 |
| CRITICAL (CONFIRMED) | auth-secrets | `src/app/api/remote-agent/route.ts:46-52` | mcpUrl 페어링 분기가 원격 사이트 허용 목록을 검사하지 않음 | 임의 HTTPS 호스트가 데스크톱 에이전트의 지휘부가 됨 |
| CRITICAL (CONFIRMED) | agent-scripts | `scripts/topic-agent.ts:2993` | 발행 성공 후 URL 미확보를 FAILED로 기록 | 재발행 경로가 동일 글을 중복 게시 |
| CRITICAL (CONFIRMED) | legacy-dupes | `fix-topic-agent.js:4` | 구형 코드모드가 현재 소스에 매치, 1914줄 삭제 후 성공 출력 | 무경고 소스 파괴, 미커밋 작업 복구 불가 |
| HIGH (CONFIRMED) | auth-secrets | `src/lib/api-auth.ts:119` | `isDevelopmentLocalRequest`가 공격자 제어 Host 헤더를 신뢰 | 비프로덕션 실행에서 `ADMIN_API_KEY` 전면 우회 |
| HIGH (CONFIRMED) | api-rest / auth-secrets | `src/app/api/brandlinks/route.ts:62` 외 4곳 | GET 5개가 `request` 인자조차 없이 가드 미호출 | 키를 설정해도 DB 전량이 무인증 조회됨 |
| HIGH (CONFIRMED) | api-rest | `src/app/api/schedule/cron/route.ts:36` | CRON_SECRET 미설정 시 무인증 GET으로 스케줄러 실행 | `<img src>` 한 줄로 대기 글 대량 발행 + 작업 파일 삭제 |
| HIGH (CONFIRMED) | auth-secrets | `src/lib/remote-site.ts:39` | 허용 목록이 `*.chatgpt.site` 전체를 수용 | 동일 호스팅의 임의 테넌트가 페어링 탈취 |
| HIGH (CONFIRMED) | build-config | `scripts/electron/main.cjs:483` | 딥링크 `site` 무검증·무확인 재페어링 | 이미 연결된 PC가 조용히 공격자 계정으로 재연결 |
| HIGH (CONFIRMED) | pipeline-core / api-rest | `src/services/scheduler.ts:110`, `src/app/api/schedule/route.ts:111` | 아무도 쓰지 않는 `contentHtml`을 발행 전제로 요구 | 예약 경로 전체 사망, 오해 유발 오류로 3회 재시도 후 FAIL |
| HIGH (CONFIRMED) | pipeline-core | `src/services/scheduler.ts:197` | 성공 경로에는 `status === "RUNNING"` 가드가 있으나 catch에는 없음 | 타임아웃/후처리 실패마다 SUCCESS를 PENDING으로 덮어써 중복 발행 |
| HIGH (CONFIRMED) | agent-scripts | `scripts/topic-agent.ts:729` | 에디터 자동저장 POST를 예약 등록 근거로 인정 | 예약되지 않은 글이 SCHEDULED로 보고됨 |
| HIGH (CONFIRMED) | simple-agent-publish | `scripts/simple-agent.ts:10112`, `:10174` | 발행 성공 후 URL 확인 실패를 FAILED로 확정 | 라이브 글이 FAILED로 남아 재시도 시 중복 게시 |
| HIGH (CONFIRMED) | api-brandlinks | `src/app/api/brandlinks/[id]/auto-publish/route.ts:41` | 크래시 후 PUBLISHING 행이 복구되지 않아 전 제품 409 영구 고착 | 유일한 탈출구(`posting/stop`)가 중복 발행을 유발 |
| HIGH (CONFIRMED) | agent-scripts | `scripts/lib/scheduled-draft-workflow.ts:23` | 내부 HTTP 호출이 포트 43127을 하드코딩 | 문서화된 `npm run dev` 설정에서 자동 발행이 항상 실패 |
| HIGH (CONFIRMED) | simple-agent-flow/publish | `scripts/simple-agent.ts:6662` | "팝업이 안 보임"을 "커넥트 삽입 성공"으로 반환 | 제휴 고지만 있고 커넥트 카드 0개인 글 발행 |
| HIGH (CONFIRMED) | simple-agent-publish | `scripts/simple-agent.ts:5842` | 에디터가 아닌 페이지(로그인 리다이렉트)도 통과 | 로그인 폼에 본문 입력·반복 제출, 오분류된 실패 코드 |
| HIGH (CONFIRMED) | agent-scripts | `scripts/review-agent.ts:250` | 발행 버튼 미발견에도 "발행 완료" 출력 후 exit 0 | API가 `published: true`를 반환, 미발행을 성공으로 보고 |
| HIGH (CONFIRMED) | agent-scripts | `scripts/bulk-topic-schedule-publish.ts:253` | 알 수 없는/누락 상태를 성공으로 계수 | 아무것도 예약 안 된 배치가 "성공 N건"으로 종료 |
| HIGH (CONFIRMED) | agent-scripts | `scripts/brandconnect-seasonal-register.ts:1458` | 기존 여행 항목 갱신 시 `scheduledPublishAt` 미기록 | 보고된 예약일이 DB에 없어 영원히 예약되지 않음 |
| HIGH (CONFIRMED) | pipeline-core | `src/services/topic-task-pipeline.ts:460` | 사용자 주제를 이스케이프 없이 `RegExp`에 주입 | `C++` 등 메타문자 포함 주제는 준비 자체가 영구 실패 |
| HIGH (CONFIRMED) | pipeline-core | `src/services/topic-task-pipeline.ts:4627` | 정렬본 위치를 원본 배열 인덱스로 조회 | 심사하지 않은 최저점 후보가 승인 초안으로 발행 |
| HIGH (CONFIRMED) | lib-contracts | `src/lib/topic-task-content-readiness.ts:344` | 준비/발행 시 `sourceUrls` 유무가 달라 판정이 뒤집힘 | 100점 통과 문서가 발행 시 P0 차단, 복구 불가 데드락 |
| HIGH (CONFIRMED) | lib-contracts | `src/lib/topic-task-content-readiness.ts:630` | 본문에 자기 주제를 1회 언급하면 `broken-copy` | 정상 글이 "재준비 필요"로 영구 차단 |
| MEDIUM (CONFIRMED) | lib-contracts | `src/lib/post-composition-contract.ts:611-628` | 섹션 제거 후 위치로 이미지·플랜을 조회 — 제거 대상이 항상 마지막일 때만 안전 | 현재 호출자에서는 미발현. `isDisclosureSection` 과대 매칭으로 본문 섹션이 걸리면 즉시 발현 (2026-09-08 정정) |
| HIGH (CONFIRMED) | topic-workflow | `src/lib/topic-workflow.ts:477` | 조사 보정이 형용사 어미 -는/-은과 일반 명사를 재작성 | "맛있는"→"맛있은", "아이"→"아가" 등 한국어 훼손 |
| HIGH (CONFIRMED) | topic-workflow | `src/app/api/brandlinks/bulk-schedule/route.ts:153` | 우선순위 재정렬 후 0번 행을 최조기 예약으로 사용 | 기본 경로에서 예약 글이 수개월 뒤로 밀림 |
| HIGH (CONFIRMED) | codex-draft-path | `scripts/lib/codex-draft-provider.ts:117` | 복구 가능한 `error` 스트림 이벤트를 치명 오류로 처리 | 재연결 알림 한 번에 출하 기본 작성 경로가 사망 |
| HIGH (CONFIRMED) | codex-draft-path | `src/lib/codex-local.ts:128` | 방치된 `codex login` 잡이 만료되지 않고 영구 running | 프로세스 수명 내내 Codex 재연결 불가 |
| HIGH (CONFIRMED) | codex-draft-path | `scripts/simple-agent.ts:387` | `PRODUCT_POST_LOCAL_FALLBACK_ENABLED` 기본값 3중 불일치 | AI 호출 실패 시 로컬 템플릿 글이 실제 블로그에 발행 |
| MEDIUM (CONFIRMED) | lib-brandpost | `src/lib/run-script.ts:89-95` | 자식 stdout/stderr을 `setEncoding` 없이 청크 단위로 디코딩 | 한글이 U+FFFD로 조용히 손상. **발행 본문에는 도달하지 않고** API 응답·운영 로그·오류 메시지에 한정 (2026-09-08 강등) |
| HIGH (CONFIRMED) | lib-brandpost | `src/lib/brand-post-package.ts:370` | 승인 시 매니페스트를 비원자적으로 덮어씀 | 중단 시 초안 전체(원고·구성·스펙) 복구 불가 |
| HIGH (CONFIRMED) | lib-brandpost | `src/lib/brand-post-image-generation.ts:191` | 성공 경로에서 검증된 원본 사진 참조 소실 | 이후 모든 이미지 재생성이 영구 실패 |
| HIGH (CONFIRMED) | lib-brandpost | `src/lib/brand-post-package.ts:329` | `imageGeneration.status:"running"`에 하트비트/만료 없음 | 크래시 1회로 해당 초안의 모든 동작이 영구 잠김 |
| HIGH (CONFIRMED) | simple-agent-flow | `scripts/simple-agent.ts:4451`, `:4446` | 리다이렉트 무한 재귀 + 소켓 타임아웃 없음 | 이미지 URL 하나로 90분 이상 런 정지 |
| HIGH (CONFIRMED) | agent-scripts | `scripts/topic-agent.ts:2235` | hero 정규식이 POSIX 구분자만 매치 | 주 패키징 대상 Windows에서 대표 이미지 미삽입 |
| HIGH (CONFIRMED) | chatgpt-browser | `scripts/lib/chatgpt-browser.ts:646` | 청킹 정규식이 모든 개행을 삭제 | 브라우저 모드 모든 프롬프트가 한 줄로 붙어 전달 |
| HIGH (CONFIRMED) | chatgpt-browser | `scripts/lib/chatgpt-browser.ts:779` | 5분 대기 만료를 성공으로 간주해 부분 응답 반환 | 잘린 JSON이 초안으로 유입, 타임아웃이 보고되지 않음 |
| HIGH (CONFIRMED) | chatgpt-browser | `scripts/lib/chatgpt-profile-lock.ts:71` | 검사한 락 파일과 삭제 대상의 동일성 미확인 | 두 프로세스가 같은 프로필 점유, 락의 존재 이유 무력화 |
| HIGH (CONFIRMED) | post-spec-engine | `scripts/lib/post-spec/image-plan.ts:281` | 이미지 부족을 레이아웃 요구량이 아닌 풀 하한과 비교 | 본문 4~5장 SHOPPING 글이 검증 통과 후 발행 게이트에서 하드 예외 |
| HIGH (CONFIRMED) | post-spec-engine | `scripts/lib/post-spec/render.ts:60` | qa-3 라벨을 배열 짝수/홀수로만 재부여 | 답변 문장이 질문으로 뒤바뀐 채 발행 |
| HIGH (CONFIRMED) | images-thumbnails | `scripts/lib/product-thumbnail.ts:559` | PNG 인코딩 버퍼를 raw 알파로 인덱싱 | 모든 쇼핑 썸네일에 경계선·투명 밴드 아티팩트 |
| HIGH (CONFIRMED) | images-thumbnails | `scripts/lib/travel-image-quality.ts:26` | EXIF 회전 전 치수로 품질 게이트 판정 | 정상 가로 폰 사진이 본문에서 제외됨 |
| HIGH (CONFIRMED) | images-thumbnails | `scripts/lib/product-image-selection.ts:23` | `ads?`가 부분 문자열 "ad"에 매치 | `upload`/`download` 포함 정상 상품 이미지 폐기, 썸네일 없음 |
| HIGH (PLAUSIBLE) | images-thumbnails | `scripts/lib/image-dedup.ts:25` | 흑백 dHash가 색상 변형을 동일 이미지로 판정 | 색상별 상품 사진이 중복으로 제거됨 |
| HIGH (CONFIRMED) | legacy-dupes | `update-content.js:179`, `refactor-content.js:115`, `refactor-image.js:77` | 세 코드모드가 현재 앵커에 매치되어 라이브 소스 개변 | 타입체크 붕괴, 브라우저 자동화 안전장치 제거 |
| HIGH (CONFIRMED) | ui-components | `src/app/page.tsx:820` | 주제 발행 busy 플래그를 stale 데이터로 즉시 해제 | 네이버 자동화 2개 프로세스 동시 실행 |
| HIGH (CONFIRMED) | test-coverage / build-config | `package.json:27` (외 3개 스크립트) | `tsx`가 어떤 의존성에도 없음 | 4개 테스트가 클린 설치에서 exit 127, 영구 미실행 |
| HIGH (CONFIRMED) | test-coverage | `.github/workflows/ci.yml:48` | 56개 중 19개만 실행, 인증/CSRF 회귀 테스트 제외 | 인증 우회 회귀가 그린으로 머지됨 |
| HIGH (CONFIRMED) | test-coverage | `apps/sites/package.json:7`, `.github/workflows/ci.yml:95` | `apps/sites` 테스트 러너 자체가 없음(22개 테스트 미실행) | 버그리포트 비밀정보 마스킹 회귀를 아무도 못 잡음 |
| HIGH (CONFIRMED) | test-coverage | `scripts/verify-auto-publish-route.cjs:1` | 자동 발행 라우트 회귀 테스트가 고아 | 라우트의 인증·중복거절 가드가 CI 미보호 |
| HIGH (CONFIRMED) | test-coverage | `scripts/verify-scheduled-draft-workflow.ts:1` | 자동/예약 초안 워크플로 회귀 테스트가 고아 | 폴링 상한·단일 발행 호출 보장이 CI 미보호 |
| HIGH (CONFIRMED) | test-coverage | `scripts/verify-connect-routing-regression.ts:9` | 호스트 스푸핑 가드 테스트가 고아 | `brandconnect.naver.com.evil.test` 차단 회귀 미탐지 |

---

## 2. CRITICAL 상세 (5건)

> **2026-09-08 정정.** 이 절의 초판은 C1→C2→C3를 "설정 **1회** 저장으로 즉시 성립하는 RCE 연쇄"로 서술했다. 그 서술은 **틀렸다.** 외부 리뷰(PR #14, Codex P1)의 지적을 받아 재검증한 결과, `.env`를 읽는 파서가 **둘**이고 초판은 그중 라우트 자신의 줄 단위 파서만으로 연쇄를 이어 붙였다. 실제로 기동 시 `process.env`를 만드는 것은 dotenv이며, dotenv는 이 페이로드를 쪼개지 않는다. 아래는 재검증 후 서술이고, C2는 CRITICAL에서 HIGH로 강등해 §4(H2)로 옮겼다. 상세한 실측 근거는 §9.1에 있다.

### 이 문서에서 가장 중요한 것 — `REMOTE_SITE_URL` 오염으로 수렴하는 두 경로

업데이트 출처를 결정하는 `REMOTE_SITE_URL`을 공격자 값으로 바꿀 수 있으면, 서명 없는 설치 파일이 사용자 권한으로 실행된다(C2 = 구 C3). 그 값을 오염시키는 경로는 **두 개**이고 난이도가 크게 다르다.

```
[경로 A — 즉시·파서 무관]  C3 (mcpUrl 페어링 분기의 허용 목록 미검사)
   remote-agent/route.ts:46-52 의 mcpUrl 분기는 URL 파싱·경로 모양·https 만 보고
   isAllowedRemoteSiteOrigin 을 호출하지 않는다. 사용자가 공격자의 MCP URL 을
   한 번 붙여넣으면 saveRemoteActivation 이 REMOTE_SITE_URL 을 그 값으로
   process.env 와 .env 양쪽에 직접 심는다. 세탁도 재시작도 필요 없다.
        ↓
[경로 B — 파서 차이 세탁, 2회 쓰기 + 재시작 필요]  H2 (구 C2)
   ① settings POST 로 화이트리스트 키 값에 개행을 넣어
      REMOTE_SITE_URL=... 줄을 파일에 남긴다.
      ※ 이 시점에 dotenv 는 아직 이를 NAVER_BLOG_ID 한 개의 여러 줄 값으로 본다.
   ② 두 번째 env 쓰기(재저장 또는 saveRemoteActivation)가 줄 단위 파서로
      이를 분리해 REMOTE_SITE_URL 을 독립 줄로 재직렬화한다.
   ③ 앱 재시작 → main.cjs:97 dotenv.config 가 이제 이를 process.env 로 읽는다.
        ↓
[페이로드 — C2 (자동 업데이트)]
   auto-update.cjs updateOrigin()(17행)은 REMOTE_SITE_URL 을 읽어
   프로토콜이 https 인지만 확인하고 url.origin 을 그대로 반환한다. 허용 목록이 없다.
   NsisUpdater 가 <공격자 출처>/api/updates/windows/latest.yml 을 읽고
   설치 파일을 받아 quitAndInstall(true, true) 한다.
   앱은 서명돼 있지 않으므로(build.win 에 publisherName/certificateFile/
   forceCodeSigning 모두 없음) electron-updater 의 NSIS 서명 검사에는
   대조할 기준 자체가 없다. sha512 는 같은 호스트가 주므로 무의미하다.

   ※ 오염된 REMOTE_SITE_URL 은 업데이터뿐 아니라
     poll/route.ts:124-125 의 잡 수신 출처도 바꾼다 — 이쪽은 OS 무관이고
     디바이스 토큰이 공격자 서버로 전송된다.
```

**완화 순서는 페이로드부터다.** `auto-update.cjs`의 출처를 상수로 고정하면 A·B 어느 경로가 남아도 코드 실행으로는 이어지지 않는다. 그다음이 경로 A(허용 목록 한 줄), 마지막이 경로 B(개행 거절 + 직렬화/파서 일치)다.

---

### C1. 로컬 변경 API 전반의 동일 출처 검사 부재 — `src/app/api/brandlinks/bulk-today/route.ts:92` 외 30여 곳 (CONFIRMED)

**무엇이 잘못됐나.** `requireAdminApiKey`(`src/lib/api-auth.ts:115-136`)는 키가 비어 있으면 `null`(=허용)을 반환한다. **이 동작 자체는 의도된 것이며 `src/lib/api-auth.ts:113`에 그렇게 문서화돼 있다**(직접 재확인). 설정 UI도 `src/app/api/settings/route.ts:33`에서 "일반 로컬 사용에는 비워 두세요"라고 안내한다. 따라서 이 항목은 "인증이 없다"는 지적이 아니다.

정확한 결함은 다른 데 있다. `api-auth.ts:113`의 주석은 *"Origin/Referer/Sec-Fetch-Site 헤더는 API 키를 대체할 수 없다"*고 논증하는데, 이는 **인증(authentication)**에 대해서는 맞는 말이다. 그러나 그 헤더들은 애초에 인증 수단이 아니라 **CSRF 방어**의 정석이다. 이 둘을 한데 묶어 기각한 결과, "키를 대체할 수 없으니 헤더 검사도 필요 없다"는 결론이 되어 30개가 넘는 변경 라우트에 동일 출처 검사가 아예 없다. 저장소에는 정확히 그 용도의 `requireTrustedLocalMutation`(`src/lib/local-request-auth.ts:27-42`)이 이미 있고, 적용된 곳은 `/api/brandlinks/travel-contract`, `/api/remote-agent`, `/api/remote-agent/poll`, `/api/system/control` **4개 파일뿐이다**(grep 직접 재확인). `middleware.ts`도 CORS 설정도 없고 `request.json()`은 Content-Type과 무관하게 파싱한다. 전수 현황은 §3 매트릭스에 있다.

**전제 조건(공정하게 명시).** `requireAdminApiKey`와 `requireCronSecret`은 둘 다 내부적으로 `requireRemoteActivation`을 먼저 호출하므로, MCP 활성화가 안 된 PC는 428을 반환한다(직접 재확인). 즉 이 공격은 **이미 정상 페어링된 설치**를 전제로 한다. 그것이 이 제품의 정상 운영 상태이므로 가설적 조건이 아니다.

**실패 시나리오.** 데스크톱 앱이 도는 사용자가 `<form action="http://127.0.0.1:43127/api/brandlinks/bulk-today" method="POST" enctype="text/plain">`을 자동 제출하는 페이지를 연다. 단순 form POST이므로 preflight가 없다. `bulk-today`는 JSON 파싱 실패를 삼키고(103-107행) 기본값 `limit 10` / `connectKind "shopping"`으로 진행하며, `resolveConnectContract`가 shopping을 `captureRequired=false`로 처리하므로 501 게이트도 건너뛴다. 최대 10건의 실제 글이 피해자 블로그에 발행된다. 같은 한 장짜리 폼이 `/api/brandlinks/super-publish`(기본 collectCount 200 / todayCount 50), 본문을 아예 읽지 않는 `/api/topic-tasks/{id}/prepare`(유료 LLM+이미지 파이프라인 전체 기동), 그리고 실행 중 발행 프로세스를 죽이고 모든 DRAFTING/PUBLISHING 행을 READY로 되돌리는 `/api/posting/stop`에도 그대로 통한다.

**수정 방향.** 모든 POST/PATCH/DELETE 핸들러 첫머리에서 `requireTrustedLocalMutation(request)`를 `requireAdminApiKey(request)`보다 먼저 호출한다(`src/app/api/system/control/route.ts:50-54`가 템플릿). 개별 적용은 다시 어긋나므로 `withLocalMutationGuard` 같은 공용 래퍼로 감싸거나 Next 미들웨어로 `/api/*`의 비-GET 전체에 일괄 적용한다. 동시에 `api-auth.ts:113`의 주석을 "헤더는 인증이 아니라 CSRF 방어이며 둘 다 필요하다"로 정정해 같은 오해가 재발하지 않게 한다.

### H2(구 C2). `.env` 개행 주입으로 `EDITABLE_KEYS` 무력화 — `src/app/api/settings/route.ts:56` (CONFIRMED, 2026-09-08 CRITICAL→HIGH 강등)

**무엇이 잘못됐나.** `serializeEnv`(56-63행)는 `${k}="${String(v).replace(/"/g,'\\"')}"` 형태로 기록한다. **큰따옴표는 이스케이프하지만 개행은 하지 않는다.** POST 핸들러(134행)는 *키*만 화이트리스트(`EDITABLE_KEYS` = `OPENAI_API_KEY`, `UNSPLASH_ACCESS_KEY`, `NAVER_BLOG_ID`, `ADMIN_API_KEY`)로 걸러내고 값은 `value.trim()`만 거쳐 저장하므로 내부 개행은 살아남는다. 기록된 파일은 이 파일 자신의 `parseEnv`(39-53행)와 `scripts/lib/local-env-file.ts`의 `readLocalEnvFile`이 `/\r?\n/`로 잘라 줄마다 key=value로 다시 읽는다. 29행의 주석은 화이트리스트가 "임의 env 노출/주입"을 막는다고 주장하지만 막지 못한다.

**직접 재확인 — 파서가 둘이고, 결과가 다르다.** 화이트리스트에 있는 키 하나에만 아래 값을 넣어 제출했다.

```
myblog\nREMOTE_SITE_URL=https://evil.example\nADMIN_API_KEY=attacker-key\n#
```

기록된 `.env`를 **두 파서로 각각** 읽으면 결과가 갈린다.

| 파서 | 사용처 | 1회 저장 후 결과 |
|---|---|---|
| 라우트 자신의 `parseEnv`(39-53행), `local-env-file.ts:5-18` | `readEnvFile()`, `readLocalEnvFile()` | **키 3개로 분리** — 주입 성립 |
| **dotenv 17.3.1** | `main.cjs:97` — 기동 시 `process.env`를 만드는 주체 | `NAVER_BLOG_ID` **한 개의 여러 줄 값** — 주입 실패 |

dotenv 17은 큰따옴표 값이 리터럴 개행을 포함하는 것을 허용한다. 따옴표 탈출 변형 4가지(맨따옴표·이스케이프된 따옴표·따옴표+공백)도 모두 시험했으나 어느 것도 dotenv에서 키를 만들지 못했다. **따라서 "1회 저장으로 즉시 `process.env` 오염"은 성립하지 않는다.**

**그럼에도 결함이 남는 이유 — 파서 차이 세탁.** 쓰기(`serializeEnv`, 개행 미이스케이프)와 읽기(줄 단위 파서)가 어긋나 있으므로, **두 번째** env 파일 쓰기가 그 여러 줄 값을 분리해 `REMOTE_SITE_URL`을 독립 줄로 재직렬화한다. 그 2세대 파일은 dotenv도 정상 키로 읽는다(실행 확인). 두 번째 쓰기는 사용자의 설정 재저장이나 `saveRemoteActivation`(`local-env-file.ts:30`)이면 충분하다. 이후 **앱 재시작** 시 `main.cjs:97`이 오염 값을 `process.env.REMOTE_SITE_URL`로 로드하고, 그때 비로소 `auto-update.cjs:187`과 `poll/route.ts:124-125`가 이를 소비한다.

**전제 조건(공정하게 명시).** (a) 이 라우트도 `requireRemoteActivation`을 먼저 통과해야 하므로 **미활성 PC 공격은 428로 막힌다** — 이미 활성화된 피해자가 필요하다. (b) 두 파서 모두 마지막 줄이 이기므로, 이미 `REMOTE_SITE_URL`이 있는 파일에서는 위조 줄이 뒤에 오도록 순서를 강제해야 한다(빈 저장으로 키를 지운 뒤 재추가하면 가능 — 실행 확인). (c) **최소 2회의 env 쓰기와 앱 재시작**이 필요하다. 초판이 주장한 "사용자 상호작용 한 번"은 과장이었다.

**초판의 또 다른 오류.** 초판은 `ADMIN_API_KEY` 탈취가 "개행 주입으로 무조건 성립"한다고 적었으나, `ADMIN_API_KEY`는 애초에 `EDITABLE_KEYS`에 들어 있다(37행). 게이트만 지나면 개행 없이 정상 편집으로 설정된다 — 주입 결함과 무관한 별개 사안이며, 그 책임은 C1(동일 출처 검사 부재)에 있다.

**수정 방향.** 저장 전에 `\r` 또는 `\n`이 포함된 값을 400으로 거절하고, `serializeEnv`가 값을 `JSON.stringify`로 인코딩하도록 바꾼다(읽기 쪽 언이스케이프와 함께 — L14 참조). 그리고 이 POST에 `requireTrustedLocalMutation`을 붙인다. 근본 처방은 **쓰기·읽기 양쪽을 한 파서로 통일**하는 것이다 — 지금은 같은 파일을 세 곳이 서로 다르게 읽는다.

### C3. 자동 업데이트 채널을 통한 원격 코드 실행 — `scripts/electron/auto-update.cjs:17`, `:187` (CONFIRMED)

**무엇이 잘못됐나.** 두 겹이다.

1. **출처에 허용 목록이 없다.** `updateOrigin()`(17행)은 `process.env.REMOTE_SITE_URL`을 읽어 **프로토콜이 https인지만 확인하고 `url.origin`을 그대로 반환한다**(직접 재확인). `isAllowedRemoteSiteOrigin`을 호출하지 않는다. `ensureUpdater()`는 NsisUpdater를 `<그 출처>/api/updates/windows/`로 향하게 하고, `installWhenSafe()`는 사용자 확인 없이 `quitAndInstall(true, true)`를 호출한다.
2. **앱이 서명되지 않았다.** `package.json`의 `build.win`에는 `publisherName`도 `certificateFile`도 `forceCodeSigning`도 설정돼 있지 않고(직접 재확인), `.github/workflows/desktop-build.yml:66`은 `CSC_IDENTITY_AUTO_DISCOVERY: false`로 서명을 명시적으로 끈다. 여기서 정확한 표현은 "서명 검증이 꺼져 있다"가 아니라 **"서명이 존재하지 않으므로 electron-updater의 NSIS 서명 검사에 대조할 기준이 없다"**이다. `latest.yml`의 sha512는 설치 파일과 같은 호스트가 제공하므로 무결성 보증이 되지 못한다.

**실패 시나리오.** C3(mcpUrl 허용 목록 미검사)로 즉시, 또는 C1+H2(파서 차이 세탁 + 재시작)로 `.env`에 `REMOTE_SITE_URL=https://evil.example`이 심긴다(또는 H4·H5의 딥링크 경로로 같은 값이 저장된다). `AUTO_UPDATE_CHECK_INTERVAL_MS`(기본 2분) 안에 앱이 공격자의 `latest.yml`을 읽고 NSIS 설치 파일을 내려받아 실행한다. 사용자에게는 평소와 똑같은 업데이트 재시작으로 보인다. 별도 경로로, 문서화되지 않은 `AUTO_UPDATE_ALLOW_LOCAL_HTTP`가 테스트 모드 게이트 없이 적용되므로(L38) 패키징된 프로덕션 빌드가 `http://127.0.0.1:<port>` 피드까지 수용한다.

**수정 방향.** 업데이터 출처를 상수 `DEFAULT_REMOTE_SITE_URL`로 못 박거나, 최소한 `updateOrigin()` 안에서 `isAllowedRemoteSiteOrigin`을 통과할 때만 그 값을 쓰고 아니면 업데이트를 중단한다. Windows 빌드를 코드 서명하고 `build.win.publisherName`을 설정해 electron-updater가 실제로 대조할 대상을 갖게 한다(`resources/app-update.yml` 직접 수정은 무의미 — L34 참조). `AUTO_UPDATE_ALLOW_LOCAL_HTTP`와 `AUTO_UPDATE_FORCE`를 `AUTO_UPDATE_TEST_MODE` 게이트 안으로 옮긴다.

### C4. MCP-URL 페어링 경로의 허용 목록 부재 — `src/app/api/remote-agent/route.ts:46-52` (CONFIRMED)

**무엇이 잘못됐나.** `buildPairRequest`에는 두 분기가 있다. `pairCode` 분기(36-42행)는 `normalizeRemoteSiteOrigin` + `isAllowedRemoteSiteOrigin`을 거친다. `mcpUrl` 분기(46-52행)는 **URL 파싱 성공 여부, 경로가 `/api/mcp/<id>.<secret>` 형태인지, 스킴이 https인지 세 가지만 확인하고 `isAllowedRemoteSiteOrigin`을 한 번도 호출하지 않은 채** `siteUrl: parsed.origin`을 반환한다(직접 재확인). 이후 POST가 `${siteUrl}/api/device/pair`를 호출하고, 응답에 `deviceToken`/`deviceId`만 있으면 `saveRemoteActivation`이 그 출처를 `.env`에 `REMOTE_SITE_URL`로 영구 저장한다. `src/lib/remote-site.ts`의 주석은 "공급된 site 값을 신뢰해서는 안 되며 허용 목록이 그것을 막는다"고 명시하는데, 이 경로에는 그 보장이 없다.

**공격의 정확한 형태(과장하지 않기).** 이 POST는 `requireTrustedLocalMutation` + `requireAdminApiKey` 뒤에 있다(직접 재확인). 따라서 **드라이브바이가 아니다.** 성립하려면 사용자가 적대적 MCP URL을 직접 붙여넣어야 한다. 현실적 경로는 소셜 엔지니어링이다: 피싱 페이지나 안내 메일이 "PC 연결하려면 이 주소를 설정 화면에 붙여넣으세요"라며 `https://evil.example.com/api/mcp/aaaa….bbbb…`를 제시한다. 형태가 진짜 MCP URL과 구별되지 않고, 앱은 호스트를 전혀 검증하지 않으므로 그대로 페어링된다.

**그 다음.** `src/app/api/remote-agent/poll/route.ts`가 공격자의 `/api/agent/jobs/claim`을 폴링하며 `POST_PUBLISH`, `BLOG_PROFILE_APPLY`, `POST_PREPARE_DRAFT` 작업을 실행한다. 피해자 블로그에 임의 글이 올라가고 초안·상품 데이터가 공격자 서버로 반환된다. 저장된 `REMOTE_SITE_URL`은 C3의 업데이트 출처로도 그대로 쓰인다.

**수정 방향.** 반환 직전에 `pairCode` 분기와 동일한 게이트를 적용한다. `normalizeRemoteSiteOrigin(parsed.origin)`이 `isAllowedRemoteSiteOrigin`을 통과할 때만 `siteUrl`로 채택하고 아니면 422로 거절한다. 붙여넣기 경로인 만큼, 기존 활성화를 덮어쓰기 전에 대상 호스트명을 보여주는 확인 모달을 둔다.

### C5. 발행 성공을 FAILED로 기록해 중복 게시 유발 — `scripts/topic-agent.ts:2993` (CONFIRMED)

**무엇이 잘못됐나.** `publish()`가 true(발행 확인 버튼 클릭 및 네이버 수락)를 반환한 뒤 PostView URL을 15초만 폴링한다. 실패하면 2993행에서 예외를 던지고 3024행 catch가 무조건 task를 `status: "FAILED"`, post를 `"FAIL"`로 기록한다. 글은 이미 라이브 상태다. `bulk-schedule-publish.ts:409-434`가 쓰는 PUBLISHING/불확실 상태 구분이 없어 "발행 안 됨"과 "발행됐지만 미확인"이 구별되지 않는다. `TopicTaskPanel.tsx:1083`은 FAILED에 "재발행" 버튼을 렌더하고 `bulk-topic-schedule-publish.ts:142`는 FAILED를 재선택한다.

**실패 시나리오.** `--publish-mode=now` 실행에서 글은 정상 게시됐으나 네트워크 지연이나 인터스티셜 팝업으로 15초 안에 PostView로 전환되지 않는다. task는 FAILED가 되고 exit 1. 사용자 또는 다음 bulk 실행이 재발행하여 동일 글이 두 번 게시된다. 네이버 중복 콘텐츠 제재로 직결된다.

**수정 방향.** 확인 버튼 클릭 성공 여부를 별도로 추적하고 URL 캡처 실패를 별개의 종결 상태로 다룬다(예: `postUrl` null + 경고를 동반한 PUBLISHED, 또는 재발행 경로가 절대 다시 집지 않는 PUBLISHING/UNVERIFIED). 일반 FAILED 분기로 떨어뜨리지 않는다. H9(`simple-agent.ts`)와 같은 수술이므로 함께 처리한다.

### C6. 저장소 루트의 파괴적 코드모드 — `fix-topic-agent.js:4` (CONFIRMED)

**무엇이 잘못됐나.** 4행의 정규식 `/\/\/ =+[\s\S]*?async function generateAdvancedContent\([\s\S]*?\n\}/m`은 두 그룹이 모두 lazy라서, 매치가 `scripts/topic-agent.ts:70`의 첫 배너에서 시작해 함수 선언을 지나 뒤쪽 첫 `\n}`에서 끝난다.

**직접 재확인 — 드라이런 결과.** 이 정규식은 **오늘의 `scripts/topic-agent.ts`에 여전히 매치되며, 매치는 70행에서 시작해 전체 3062줄 중 1914줄(63%)을 삼킨다.** 1차 리포트의 추정치 1741줄보다 크다. 183행 `fs.writeFileSync`가 **조건 없이** 파일을 덮어쓰고 184행이 `"Successfully replaced generateAdvancedContent"`를 출력한다. 백업도 git-clean 검사도 없다.

**실패 시나리오.** 개발자(또는 자동화 에이전트)가 작은 수정 의도로 `node fix-topic-agent.js`를 실행한다. `scripts/topic-agent.ts`가 3062줄 → 1148줄이 되며 `getTemplate`, `parseArgs`, `buildStyleGuide` 등이 사라지지만 `main()`은 남아 이들을 계속 호출한다. 스크립트는 성공 메시지를 출력한다. 미커밋 작업이 있었다면 복구 불가이고, 이후 typecheck/build가 원인과 동떨어진 "Cannot find name" 오류 수십 개로 실패한다.

**수정 방향.** `fix-topic-agent.js`를 삭제한다(산출물은 이미 소스에 반영됐고 이후 재작성됐다). 이력 보존이 필요하면 루트에서 실행되지 않는 아카이브 디렉터리로 옮기고 `eslint.config.mjs`의 대응 예외 블록도 함께 제거한다. H42와 묶어 한 커밋으로 처리한다.

---

## 3. API 라우트 가드 매트릭스 (41개 전수)

1차 감사가 이름을 올린 라우트는 30개 미만이었고, 누락분에 인증·발행 라우트가 섞여 있었다. `src/app/api` 아래 `route.ts`는 **정확히 41개**이며(직접 재확인), 아래는 실제로 호출되는 가드 기준 전수 분류다. 가드 조합별로 묶었다.

### 3.1 그룹 A — `requireTrustedLocalMutation` + `requireAdminApiKey` (4개, 유일하게 올바른 형태)

| 라우트 | 메서드 |
|---|---|
| `brandlinks/travel-contract` | POST |
| `remote-agent` | POST / DELETE (GET은 admin만) |
| `remote-agent/poll` | POST |
| `system/control` | POST (GET은 admin만) |

### 3.2 그룹 B — `requireAdminApiKey`만 (29개, 동일 출처 검사 없음)

**이 그룹 전체가 기본 설치에서 사실상 무방비다.** 키가 비면 `requireAdminApiKey`는 no-op이고, 남는 것은 `requireRemoteActivation`(정상 페어링이면 통과)뿐이다. 굵게 표시한 것은 실제 네이버 발행이나 계정 상태를 바꾸는 라우트다.

| 라우트 | 메서드 | 비고 |
|---|---|---|
| **`brandlinks/[id]/auto-publish`** | GET + POST | 초안→이미지→실발행 전체를 202로 기동. 최신·최고위험 경로 (H10) |
| **`brandlinks/[id]/publish`** | POST | 실발행 |
| **`brandlinks/bulk-today`** | GET + POST | 기본 limit 10건 실발행 (C1 재현 대상) |
| **`brandlinks/bulk-schedule`** | GET + POST | 예약 일괄 재작성 (H23) |
| **`brandlinks/bulk-seasonal`** | POST | 시즌 일괄 등록·발행 |
| **`brandlinks/super-publish`** | POST | 기본 collectCount 200 / todayCount 50 |
| `brandlinks/[id]/draft` | GET / PATCH / POST | 초안 생성·수정 |
| `brandlinks/[id]/draft/images` | GET + POST | 이미지 배치 생성 |
| `brandlinks/[id]/scrape` | POST | |
| `brandlinks/[id]/thumbnail` | GET + POST | |
| `brandlinks/[id]/verify` | GET | |
| `brandlinks/[id]` | DELETE + PATCH | |
| `brandlinks` | POST | |
| `brandlinks/available` | GET | |
| `brandlinks/selection-options` | GET | |
| **`codex`** | GET + POST | POST가 사용자 데스크톱에 로그인 브라우저 창을 띄움 (M-codex-csrf) |
| **`posting/stop`** | POST | 실행 중 발행 프로세스 종료 + 전 DRAFTING/PUBLISHING을 READY로 |
| **`review`** | POST | |
| **`schedule`** | POST + DELETE | |
| **`session/login`** | GET + POST | 네이버 로그인 |
| **`settings`** | GET + POST | H2의 주입 대상 |
| `system/update-readiness` | GET | |
| **`topic`** | GET + POST | |
| `topic-candidates` | POST | |
| `topic-tasks` | POST | |
| `topic-tasks/[id]` | DELETE + PATCH | |
| **`topic-tasks/[id]/prepare`** | POST | 본문을 아예 읽지 않음 → 빈 폼 POST로 유료 파이프라인 전체 기동 |
| **`topic-tasks/[id]/publish`** | POST | 실발행 |
| **`topic-tasks/bulk-schedule`** | POST | |

### 3.3 그룹 C — `requireRemoteActivation`만 (6개, 가장 약함)

| 라우트 | 메서드 | 비고 |
|---|---|---|
| `keywords` | GET + POST | **변경 POST가 이 그룹에 있다** |
| `session` | GET + POST | **변경 POST가 이 그룹에 있다** |
| `place` | GET | |
| `history` | GET | |
| `blog/categories` | GET | |
| `brandlinks/[id]/progress` | GET | |

### 3.4 그룹 D — `requireCronSecret`(선택적 비밀값)만 (1개)

| 라우트 | 메서드 | 비고 |
|---|---|---|
| `schedule/cron` | GET | `CRON_SECRET`이 비면 통과. **상태를 바꾸는 GET** — `runScheduler()` 실발행 + `cleanTempImages()` 재귀 삭제. `<img src>` 한 줄로 도달 (H3) |

### 3.5 그룹 E — 가드 전무 (6개)

| 라우트 | 위치 | 상태 |
|---|---|---|
| `brandlinks` GET | `route.ts:62` | `request` 인자 자체가 없음 → 어떤 가드도 호출 불가 |
| `topic-tasks` GET | `route.ts:39` | 동일 |
| `brandlinks/[id]` GET | `route.ts:27` | 동일 |
| `topic-tasks/[id]` GET | `route.ts:32` | 동일 |
| `schedule` GET | `route.ts:20` | 동일 |
| `admin-session` | GET / POST / DELETE | POST만 자체 cross-site 검사, **DELETE는 아무 검사도 없음** |

앞의 다섯은 같은 파일의 형제 POST/PATCH/DELETE가 `requireAdminApiKey`를 호출한다. 즉 **읽기 경로가 바로 옆 쓰기 경로보다 엄격히 약하다.** 키를 설정한 사용자도 `curl http://host:3000/api/brandlinks` 한 줄로 brandLink 테이블 전량(출처 URL, 상품명, 생성된 초안 제목, 발행 URL, 오류 메시지)을 받는다. (H2)

### 3.6 이 매트릭스가 말하는 것

- 변경 작업을 하는 핸들러 **30개 이상**이 `requireTrustedLocalMutation` 없이 돈다. 같은 종류의 일을 하는 형제 4개는 갖고 있다. 즉 방어 수단이 없는 게 아니라 **적용이 누락됐다.**
- 상태를 바꾸는 **GET이 두 개** 있다: `schedule/cron`(스케줄러 실행 + 파일 삭제)과 `brandlinks/[id]/auto-publish` GET(잡 조회이지만 404가 MCP 측 하드 오류로 번역됨).
- 인증 관련 라우트인 `admin-session`의 DELETE에 아무 검사도 없다.
- 목록 유지가 사람 손에 달려 있는 한 다시 어긋난다. 공용 래퍼 또는 미들웨어가 유일하게 안정적인 해법이다.

---

## 4. HIGH 상세 (56건 / 동일 근본원인 병합 후 49항목)

### 4.1 인증·CSRF·페어링 (H1–H5)

#### H1. `isDevelopmentLocalRequest`가 공격자 제어 Host 헤더를 신뢰 — `src/lib/api-auth.ts:119` (CONFIRMED)

**무엇이 잘못됐나.** `requireAdminApiKey`는 `configuredAdminApiKey()`를 보기도 전에, `isDevelopmentLocalRequest(request)`가 true면 `null`(=허용)을 반환한다. 그 함수(33-70행)는 `NODE_ENV !== "production"`이고 `request.nextUrl.host` / `Host` 헤더 / `X-Forwarded-Host`가 `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` 중 하나로 해석되면 true다. 그런데 `NextRequest.nextUrl.host`는 **클라이언트가 완전히 통제하는 인바운드 Host 헤더에서 파생된다.** 한편 `scripts/dev-open.mjs:6`은 HOST 기본값을 `0.0.0.0`으로 두어 `npm run dev:open`이 모든 인터페이스에 바인딩하고, `scripts/electron/main.cjs:202`는 `dev: !app.isPackaged`로 Next를 띄우므로 언패키징 데스크톱 실행도 비프로덕션이다. `admin-session/route.ts:17`이 같은 우회를 그대로 반복하며 `required:false`를 보고해 대시보드가 키를 묻지도 않는다.

**실패 시나리오.** 개발자나 파워유저가 `ADMIN_API_KEY`를 설정한 채 `npm run dev:open`(README.md:248, GUIDE.md:317에 문서화됨)을 돌리며 API가 보호된다고 믿는다. 같은 Wi-Fi의 누구든 `curl -H 'Host: localhost:3000' -X POST http://192.168.1.42:3000/api/brandlinks/bulk-today -d '{}'`를 실행하면 `isDevelopmentLocalRequest`가 hostname을 "localhost"로 보고 true를 반환, 실제 글이 발행된다. 같은 헤더 트릭으로 `/api/settings`를 읽고 `ADMIN_API_KEY`를 덮어쓸 수 있다(→ H2).

**수정 방향.** Host 헤더에서 신뢰를 파생하지 않는다. `x-forwarded-for`도 마찬가지로 신뢰 불가이므로, 편의 우회를 남기려면 서버 자신의 소켓 피어 주소로 판정하고, 그게 어려우면 `NODE_ENV`와 무관하게 키가 설정돼 있으면 항상 요구하도록 우회 자체를 제거한다.

#### H2. 가드 없는 GET 5개가 DB 전량을 노출 — `src/app/api/brandlinks/route.ts:62` 외 (CONFIRMED)

**무엇이 잘못됐나.** `export async function GET()`에 `NextRequest` 파라미터가 없어 `requireAdminApiKey`도 `requireRemoteActivation`도 호출할 수 없는데, `prisma.brandLink.findMany()` 결과를 전 컬럼 + 준비된 초안 제목까지 반환한다. 동일 패턴이 `src/app/api/topic-tasks/route.ts:39`(전 주제 task + 이미지 메타데이터), `src/app/api/brandlinks/[id]/route.ts:27`, `src/app/api/topic-tasks/[id]/route.ts:32`, `src/app/api/schedule/route.ts:20`에 있다. 같은 파일의 형제 POST/PATCH/DELETE(`brandlinks/route.ts:103`, `topic-tasks/route.ts:90`, `brandlinks/[id]/route.ts:61`·`:113`, `schedule/route.ts:62`)는 모두 `requireAdminApiKey`를 부른다.

**실패 시나리오.** 사용자가 `ADMIN_API_KEY`를 설정하고 관리 API가 잠겼다고 믿은 상태에서 대시보드를 LAN에 노출한다(`dev-open`이 0.0.0.0에 바인딩하거나 리버스 프록시를 앞에 둔 경우). 무인증 클라이언트가 `curl http://host:3000/api/brandlinks`로 brandLink 테이블 전체 — 출처 URL, 상품명, 생성된 초안 제목, 발행 URL, 오류 메시지 — 를 받고, `curl http://host:3000/api/schedule`로 발행 캘린더를 받는다. 401은 나오지 않는다.

**수정 방향.** 다섯 곳을 `export async function GET(request: NextRequest)`로 바꾸고 같은 파일의 POST와 동일하게 `requireAdminApiKey(request)`를 첫 줄에 둔다. *1차에서는 MEDIUM(M22)이었으나, 형제 쓰기 경로보다 읽기 경로가 약하고 키 설정 사용자도 보호받지 못한다는 점이 2차에서 확인돼 HIGH로 상향했다.*

#### H3. 크론 엔드포인트가 무인증 GET으로 발행을 실행 — `src/app/api/schedule/cron/route.ts:36` (CONFIRMED)

**무엇이 잘못됐나.** GET 핸들러가 `runScheduler()`(43행 — 실제 발행, 최대 5건)와 `cleanTempImages()`(44행 — `process.cwd()/temp_images` 아래 24시간 이상 된 경로를 `fs.rmSync` 재귀 삭제)를 호출한다. 유일한 가드인 `requireCronSecret`(`src/lib/api-auth.ts:142-145`)은 `CRON_SECRET`이 비면 허용을 반환하고, `.env.example:228`은 `CRON_SECRET=""`로 배포된다. 게다가 `CRON_SECRET`은 설정 화이트리스트에 없고(`settings/route.ts:30-34`) `main.cjs`도 설정하지 않으므로 **모든 데스크톱 설치에서 비어 있다.** GET이므로 preflight도 폼도 필요 없다.

**실패 시나리오.** 페어링된 사용자가 `<img src="http://127.0.0.1:43127/api/schedule/cron">`이 있는 페이지를 연다. 사용자 상호작용 없이 GET이 나가고, 대기 중인 글이 실제 블로그에 약 30초 간격으로 최대 27분간 발행되며 작업 이미지가 삭제된다. 태그를 N번 넣으면 레이트리밋 없이 N번 호출되고, 두 실행이 같은 PENDING 행을 읽어 동일 글을 두 번 발행할 수 있다.

**수정 방향.** 작업을 POST로 옮기고 `requireTrustedLocalMutation`을 붙이며, `CRON_SECRET` 미설정을 비로컬 호출자에 대해 "거부"로 fail-closed 처리한다.

#### H4. 허용 목록의 `*.chatgpt.site` 와일드카드 — `src/lib/remote-site.ts:39` (CONFIRMED)

**무엇이 잘못됐나.** `isAllowedRemoteSiteOrigin`이 호스트명이 `.chatgpt.site`로 끝나는 모든 https 출처에 true를 반환한다(`host.endsWith(".chatgpt.site")` 직접 재확인). 프로덕션 사이트는 `https://blogautomcp.hiway350051.chatgpt.site`, 즉 누구나 서브도메인을 만들 수 있는 멀티테넌트 호스팅 도메인이다. 이 목록이 딥링크 페어링 경로의 유일한 방어선이며, 앱은 사이트를 인증하지 않고 사이트가 준 `deviceId`/`deviceToken`을 그대로 저장한다. 파일 주석의 가정("위조된 site로는 어차피 인증되지 않는다")은 성립하지 않는다.

**실패 시나리오.** 공격자가 `https://x.attackertenant.chatgpt.site`에 항상 성공을 반환하는 `/api/device/pair`를 올린다. 피해자를 `blogautomcp://pair?code=…&site=…`로 유도해 "열기"를 누르게 하면 앱의 호스트명·플랫폼·버전이 공격자에게 전송되고 활성화가 공격자 출처로 덮어써진다. 피해자에게는 "PC 연결 완료" 토스트만 보인다. 저장된 출처는 C3의 업데이트 채널로 그대로 이어진다.

**수정 방향.** 접미사 규칙을 제거하고 정확한 `DEFAULT_REMOTE_SITE_URL`과 `REMOTE_SITE_ALLOWLIST` 명시 항목만 허용한다. 스테이징용 접미사가 필요하면 테넌트 단위(`.hiway350051.chatgpt.site`)로 좁히고, 기존 활성화를 덮어쓰기 전에 사용자 확인을 요구한다. 같은 함수의 41행 문제(허용 목록 검사가 https 분기 **밖**에 있어 http 출처도 통과)는 M-remote-allowlist 참조.

#### H5. 딥링크 `site` 파라미터 무검증·무확인 재페어링 — `scripts/electron/main.cjs:483` (CONFIRMED)

**무엇이 잘못됐나.** `parsePairDeepLink`는 `code`는 정규식으로 검증하면서 `site`는 스킴·호스트·길이 검사 없이 그대로 반환한다. `handlePairDeepLink`는 그 값을 로컬 CSRF 게이트를 통과하는 `origin` 헤더와 함께 즉시 POST하며, "웹페이지가 이 PC의 연결을 바꾸려 합니다" 같은 확인 대화상자가 없다. 445행 주석은 로컬 API의 허용 목록을 방어선으로 전제하지만 그 목록이 H4처럼 넓다.

**실패 시나리오.** 이미 정상 사이트에 연결된 사용자가 메일이나 웹페이지의 `blogautomcp://pair?code=11111111&site=https://attacker.chatgpt.site`를 클릭한다. `saveRemoteActivation`이 `REMOTE_SITE_URL`/`REMOTE_DEVICE_ID`/`REMOTE_DEVICE_TOKEN`을 덮어쓰고, 45초 주기 워치독이 공격자 작업 큐를 폴링하기 시작한다. 사용자는 "PC 연결 완료" 토스트만 보고 자기 계정이 조용히 작업을 못 받게 된 것을 모른다.

**수정 방향.** `parsePairDeepLink` 안에서 `site`를 업데이터와 동일한 고정 출처(정확한 호스트, https 한정)로 검증하고 불일치 시 파라미터를 버린다. 이미 활성화된 PC의 연결을 바꾸는 딥링크는 사이트 이름을 표시하는 모달로 명시적 동의를 받은 뒤에만 진행한다.

### 4.2 발행 회계·중복 발행 (H6–H16)

#### H6. 예약 발행 경로 전체 사망 — `src/services/scheduler.ts:110`, `src/app/api/schedule/route.ts:111` (CONFIRMED)

**무엇이 잘못됐나.** `executeScheduledPost`는 `post.contentHtml`이 없으면 실행을 거부한다. 그런데 **`contentHtml`은 저장소 전체 grep 결과 정확히 세 곳에만 등장한다**(직접 재확인): 스키마 선언 `prisma/schema.prisma:31`, 이 가드 `src/services/scheduler.ts:110`, 읽기 `scripts/topic-agent.ts:1636`. **쓰는 곳이 하나도 없다.** 유일한 `prisma.post.create`인 `src/app/api/schedule/route.ts:111-125`는 `date`, `scheduledAt`, `status`, `topicSeed`, `category`만 기록한다. topic-agent는 애초에 `seed.draftId`/`seed.contentJson`으로 내용을 해석하므로 이 가드는 자신이 실행할 스크립트보다 엄격하다. 게다가 던지는 메시지("게시물을 찾을 수 없습니다")가 실제 원인을 감춘다.

**실패 시나리오.** `POST /api/schedule`가 200과 함께 PENDING 글을 만든다. 예약 시각에 크론이 돌면 RUNNING으로 바뀐 뒤 `contentHtml`이 null이라 예외, catch가 PENDING + retryCount 1로 되돌린다. 세 번째 시도에서 FAIL로 확정되며 운영자는 "게시물을 찾을 수 없습니다"라는 메시지를 받는다. **예약 발행 기능 전체가 아무것도 발행하지 못한다.**

**수정 방향.** 가드에서 `!post.contentHtml`을 제거하고(`!post || !post.topicSeed`만 유지) 내용 해석은 topic-agent에 맡긴다. 여기서도 내용 검사를 원한다면 topic-agent와 동일한 해석 순서(draftId → contentJson → contentHtml)를 재현하고, 빠진 필드를 지목하는 메시지로 바꾼다.

#### H7. 에러 핸들러만 종결 상태 가드가 없음 — `src/services/scheduler.ts:197` (PLAUSIBLE → 직접 재확인으로 CONFIRMED)

**무엇이 잘못됐나.** `scripts/topic-agent.ts:3011-3023`은 글이 올라간 직후 `Post.status = "SUCCESS"`와 `finalUrl`/`publishedAt`을 기록하고 그 다음에 남은 작업과 `finally { browser.close() }`를 수행한다. 그 이후 단계가 던지거나 `run-script.ts:84-87`이 300초 타임아웃으로 SIGTERM을 보내면 `runTsNodeScript`가 reject한다.

**직접 재확인 — 비대칭이 정확한 결함이다.** 이 파일의 **성공 경로는 `refreshedPost?.status === "RUNNING"`을 확인한 뒤에만 SUCCESS를 기록해 올바르게 방어한다.** 그런데 **catch 블록에는 그 가드가 전혀 없어 조건 없이 PENDING(또는 3회 초과 시 FAIL)을 쓴다.** 같은 파일 안에서 한쪽만 지켜지는 이 비대칭이 버그다. `getPendingPosts`는 PENDING + 지난 예약시각을 집으므로 다음 실행에서 같은 글이 재발행된다.

**실패 시나리오.** 로그인과 이미지 업로드가 겹쳐 발행이 5분을 넘긴다. t=4분50초에 글이 올라가고 SUCCESS가 기록되지만 t=5분에 자식이 강제 종료되어 "스크립트 실행 시간 초과"로 reject된다. 글은 PENDING으로 되돌아가고 다음 크론에서 두 번째로 발행된다. retryCount가 3이 될 때까지 반복된 뒤, `finalUrl`이 채워져 있는데도 FAIL로 표시된다.

**수정 방향.** catch에도 성공 경로와 동일한 가드를 넣는다. 가장 확실한 형태는 `updateMany({ where: { id, status: "RUNNING" }, ... })`로 바꿔 종결 상태를 구조적으로 덮어쓸 수 없게 하는 것이다.

#### H8. 자동저장 요청을 예약 등록 근거로 인정 — `scripts/topic-agent.ts:729` (CONFIRMED)

**무엇이 잘못됐나.** `createScheduleSubmissionTracker`가 경로에 `/write|publish|post|reserve|schedule|save|rabbit/i`가 매치되는 모든 naver.com POST에 대해 `hasAnySignal = true`를 세운다. 에디터의 자동저장이 여기에 해당한다. 트래커는 `publish()` 시작 시점(발행 패널을 열기도 전)에 설치되므로 예약 제출 시점에는 이미 신호가 참이다. `waitForScheduleSubmission`은 12초 루프를 흘려보낸 뒤 그 낡은 신호만으로 성공을 반환한다. 날짜 포함 여부를 확인하는 더 강한 `hasDateSignal()`은 계산되지만 판정에 쓰이지 않는다. `clickFinalPublishButton`이 클릭 실패를 삼키고도 true를 반환하는 문제(L17)가 겹친다.

**실패 시나리오.** bulk 실행에서 예약 버튼은 찾았지만 오버레이에 클릭이 가로채여 아무것도 제출되지 않는다. 클릭 함수는 true를 반환하고, 대기 함수는 자동저장 신호로 12초 뒤 성공을 반환하며, `main()`이 상태를 SCHEDULED로 쓴다. DB와 완료 알림은 예약됐다고 보고하지만 네이버에는 예약이 없고 글도 올라오지 않는다.

**수정 방향.** 성공 조건을 `hasDateSignal()`(POST 본문에 대상 날짜 존재) 또는 명시적 예약 완료 단서로 바꾸고, URL 패턴을 실제 예약 엔드포인트로 좁히며, 트래커를 `publish()` 시작이 아니라 최종 버튼 클릭 직전에 재무장한다.

#### H9. 라이브 글이 FAILED로 남아 재시도 시 중복 게시 — `scripts/simple-agent.ts:10112`, `:10174` (CONFIRMED)

**무엇이 잘못됐나.** `clickFinalPublishButton`(8926/9028/9045행)이 실제 제출 클릭을 수행하고 그 이후는 전부 검증이다. `verifyScheduleSubmission`이 던지거나 `waitForPublishedUrl(page, 25000)`이 null을 반환하면 10165행 catch가 무조건 `status: "FAILED"`를 쓰고 `postUrl`은 기록하지 않는다. "이미 발행됨"을 확인하는 화해 로직이 파일 전체에 없다. `isPublishedUrl`은 `PostView` 또는 `logNo=<숫자>`만 받아들이며 topic-agent에 있는 블로그 목록 폴백이 없다. `src/app/api/brandlinks/[id]/publish/route.ts`는 DRAFTING/PUBLISHING만 거절하므로 FAILED 링크는 즉시 재발행 가능하다. 90분 워치독도 같은 형태로 FAILED를 강제 기록한다.

**실패 시나리오.** 즉시 발행 모드에서 제출 클릭이 성공하고 네이버가 글을 등록했지만, 이미지가 10장 이상이거나 회선이 느려 25초 안에 PostView로 리다이렉트되지 않는다. 행은 "발행 완료 URL을 확인하지 못했습니다"와 함께 FAILED, `postUrl`은 null이 된다. 운영자가 재시도하면 동일 글이 두 번째로 발행되고 첫 글의 URL은 영영 유실된다.

**수정 방향.** catch와 워치독에서 FAILED를 쓰기 전에 현재 페이지/블로그를 조회해 글이 실제로 등록됐는지 확인하고, 확인되면 경고를 동반한 PUBLISHED/SCHEDULED로 URL과 함께 저장한다. `clickFinalPublishButton` 직전에 "제출 클릭됨" 마커를 행에 기록해 발행 라우트가 맹목적 재시도를 거부하고 수동 확인을 요구하게 한다. C5와 동일한 수술이다.

#### H10. 자동 발행 크래시가 전 제품을 영구 409로 만들고, 유일한 탈출구가 중복 발행을 만든다 — `src/app/api/brandlinks/[id]/auto-publish/route.ts:41` (CONFIRMED)

**무엇이 잘못됐나.** 이 라우트는 초안 → 이미지 보충 → **실발행**까지 한 번의 POST로 돌리고 202를 반환하는, 저장소에서 가장 위험한 경로다. 중복 방지 수단은 두 가지뿐이다. (a) `globalThis`에 붙은 인메모리 `jobs` Map(9-10행) — 재시작 시 소멸, (b) 41-44행의 **제품 단위가 아닌 전역** 검사 `prisma.brandLink.count({where:{status:{in:["PUBLISHING","DRAFTING"]}}})`. 워크플로 자체는 202 반환 뒤 떠 있는 프로미스(54행 `void runAutomaticDraftWorkflow(...)`)로 돈다. 그런데 기동 시 복구(`scripts/electron/main.cjs:151-157`)는 **`"DRAFTING"`만 FAILED로 되돌리고 `"PUBLISHING"`은 건드리지 않는다.**

**실패 시나리오.** 사용자가 `publishMode: "now"`로 자동 발행을 시작한다. 워크플로가 발행 단계에 진입해 brandLink A가 PUBLISHING이 된 상태에서 절전·정전·앱 종료가 일어난다. 재시작 후에도 A는 PUBLISHING이다. 이후 **모든 제품**에 대한 auto-publish / bulk-today(`route.ts:159-166`) / super-publish(`route.ts:159-168`)가 영구히 409 "진행 중이거나 이미 발행된 작업입니다"를 반환하며, UI에는 이유를 설명하는 표시가 없다. 문서화된 탈출구는 `POST /api/posting/stop`인데, 이는 `route.ts:100-103`에서 라이브 블로그를 조회하지 않고 모든 DRAFTING/PUBLISHING을 READY로 일괄 재작성한다. 중단된 실행이 이미 네이버에 글을 올렸다면 A는 READY가 되고 auto-publish가 다시 받아들여 **같은 글이 두 번 발행된다.**

**수정 방향.** `recoverInterruptedDrafts`에서 PUBLISHING도 복구하되 FAILED가 아닌 별도 종결 상태(예: `NEEDS_VERIFY`)로 옮긴다. 42행의 count를 `where: { id }`로 좁히고 전역 활동 검사는 타임스탬프 컷오프를 둔 별도 질의로 분리한다. 이전에 PUBLISHING이었던 행을 재발행하기 전에는 `brandlinks/[id]/verify` 프로브로 라이브 글 부재를 확인하도록 강제한다.

#### H11. 자동 발행의 내부 HTTP 호출이 포트 43127을 하드코딩 — `scripts/lib/scheduled-draft-workflow.ts:23` (CONFIRMED)

**무엇이 잘못됐나.** `localScheduleCall`이 출처를 `http://127.0.0.1:${Number(process.env.APP_PORT || 43127)}`로 조립한다. `APP_PORT`는 `desktop:dev` 스크립트(`package.json:10`)만 설정하고 `scripts/electron/main.cjs:16`만 읽는다. `scripts/dev-open.mjs:5`는 `PORT`(기본 3000)를 쓰며 `APP_PORT`를 설정하지 않고, `npm run dev`는 3000번의 맨 `next dev`다. 그런데 README.md:248-251과 GUIDE.md:317-323은 정확히 그 명령을 안내한다. 저장소가 자기 자신과 불일치한다 — `scripts/lib/chatbot-notifier.ts:85`는 `APP_PORT` 기본값을 `"3000"`으로 둔다.

**실패 시나리오.** 사용자가 README대로 `npm run dev`를 돌리고 localhost:3000을 열어 자동 발행을 누른다(`src/app/page.tsx:1337`이 `/api/brandlinks/{id}/auto-publish`로 POST). 라우트는 202를 반환하고, 첫 `localScheduleCall`이 127.0.0.1:43127로 접속해 ECONNREFUSED, 41행 `request.on("error", reject)`가 발동해 잡이 원시 연결 오류와 함께 실패한다. **문서화된 개발 설정에서 자동 발행이 절대 동작하지 않는다.** 더 나쁜 변형: 패키징된 데스크톱 앱이 43127에서 함께 돌고 있으면 개발 인스턴스의 자동 발행이 **다른 설치본의 DB와 네이버 세션을 조용히 조작한다.**

**수정 방향.** 요청을 처리 중인 서버 자신에서 출처를 파생한다(`src/app/api/remote-agent/poll/route.ts:272`가 이미 `localAppOrigin`으로 그렇게 한다). 최소한 `APP_PORT` 기본값을 일관되게 맞추고, 대상 포트가 자기 리스너가 아니면 명확한 메시지로 즉시 실패하게 한다.

#### H12. 쇼핑커넥트 삽입을 "팝업이 안 보임"으로 성공 판정 — `scripts/simple-agent.ts:6662` (CONFIRMED)

**무엇이 잘못됐나.** `waitForShoppingConnectInserted`는 아티팩트 수가 늘면 true를 반환하지만, 매 폴링에서 패널이 보이지 않으면 `panelWasClosed = true`를 래치하고(패널이 다시 나타나도 해제하지 않음) 타임아웃 시 `false` 대신 그 플래그를 반환한다. 이 값이 `confirmShoppingConnectAddition`, `clickShoppingConnectItemByProductName`, `chooseShoppingConnectResult`를 거쳐 `insertShoppingConnectLink:7125`의 마지막 안전장치까지 전파되므로, 삽입 실패를 중단시키기 위해 존재하는 유일한 검사가 같은 휴리스틱으로 무력화된다.

**실패 시나리오.** 상품명이 바뀌었거나 검색 목록 DOM이 셀렉터와 맞지 않아 커넥트 선택이 10회 시도 끝에 실패한다. 진단 덤프를 남긴 뒤 7125행의 1500ms 대기가 실행되는데, 그 시점에 팝업은 이미 닫혀 있으므로 첫 폴링에서 true가 반환된다. "쇼핑커넥트 링크 삽입 완료"가 로깅되고 `connectCardCount`가 증가해 `connectCardCount < 2` 가드를 통과, STEP7이 발행한다. **결과물은 "수수료를 제공받습니다" 고지가 있으면서 커넥트 카드가 0개인 글이며**, DB는 PUBLISHED로 기록돼 아무도 감지하지 못한다.

**수정 방향.** 6662행을 `return false`로 바꿔 아티팩트 증거만 성공으로 인정한다. "패널 닫힘"을 계속 신호로 쓰려면 `"inserted" | "panel-closed" | "timeout"` 같은 별개 값으로 반환하고, `insertShoppingConnectLink`는 아티팩트 수 증가를 확인한 뒤에만 성공을 보고하게 한다.

#### H13. 에디터가 아닌 페이지가 "새 글 에디터" 검증을 통과 — `scripts/simple-agent.ts:5842` (CONFIRMED)

**무엇이 잘못됐나.** `assertFreshPostEditor`는 플레이스홀더가 아닌 텍스트를 *발견했을 때만* 예외를 던진다. 셀렉터가 아무것도 못 찾으면 `readFirstMeaningfulEditorText`가 null을 반환하고 15초 가시성 대기는 `.catch(() => {})`로 삼켜지므로, 에디터가 전혀 없는 페이지(세션 만료 후 로그인 폼, 오류 페이지, `NAVER_BLOG_ID`가 빈 문자열일 때의 `//postwrite`)도 "새 에디터"로 판정된다. 발행 경로 어디에도 로그인 리다이렉트 검사가 없다. `scripts/lib/naver-editor-selectors.ts`가 `checkEditorReady`/`isLoginRedirect`를 정확히 이 용도로 내보내지만 `inspect-editor-selectors.ts`만 그것을 임포트한다.

**실패 시나리오.** 저장된 `naver-session.json`의 쿠키가 만료됐다. 로그인이 필요 없는 STEP1은 통과하고, `/postwrite`가 로그인 폼으로 302되며, 검증은 통과한다. 이후 `page.mouse.click(640, 130)` 같은 맹목 클릭과 `keyboard.type`으로 제목·본문과 수십 번의 Enter가 **로그인 폼에 입력된다**(반복 로그인 실패로 계정 잠금 위험). 약 10분 뒤 STEP7에서 "발행 버튼을 찾지 못했습니다"로 죽고, 실패 코드가 NAVER_SESSION_EXPIRED가 아닌 LOCAL_AUTOMATION_FAILED로 분류돼 운영자는 재로그인이 필요하다는 사실을 끝내 알지 못한다.

**수정 방향.** STEP4 이전에 긍정적 증거를 요구한다. `naver-editor-selectors.ts`의 `checkEditorReady`/`isLoginRedirect`를 임포트해 로그인 URL이거나 제목 앵커·이미지 툴바 앵커가 모두 보이지 않으면 세션 만료 오류를 던진다. `main()`에서 브라우저 실행 전에 `NAVER_BLOG_ID`가 비어 있지 않은지도 검증한다.

#### H14. 발행 실패를 성공으로 보고 — `scripts/review-agent.ts:250` (CONFIRMED)

**무엇이 잘못됐나.** `publish()`가 두 버튼을 `if (publishBtn)` / `if (confirmBtn)`로 감싸고 256행에서 무조건 "발행 완료"를 출력한다. 버튼이 없으면 아무것도 클릭되지 않고 오류도 없다. `main()`의 catch(321행)는 로그만 남기고 rethrow도 `process.exitCode` 설정도 하지 않아 프로세스가 0으로 끝난다. `src/app/api/review/route.ts:114`는 관측 결과가 아니라 요청 플래그를 그대로 `published`로 돌려준다.

**실패 시나리오.** 네이버 에디터 마크업이 바뀌거나 세션이 만료돼 에디터가 뜨지 않으면 `page.$('button:has-text("발행")')`이 null을 반환한다. 스크립트는 "발행 완료"를 출력하고 0으로 종료하며, API는 `{success: true, data: {published: true}}`를 응답한다. 사용자는 아무것도 게시되지 않았는데 게시됐다고 안내받는다.

**수정 방향.** `publish()`가 버튼 미발견 시 false를 반환하거나 예외를 던지게 하고, 이를 `main()`으로 전파해 실패 시 non-zero exit code를 설정하며, 라우트는 요청 플래그가 아닌 스크립트의 실제 결과를 보고한다.

#### H15. 알 수 없는 상태를 성공으로 계수 — `scripts/bulk-topic-schedule-publish.ts:253` (CONFIRMED)

**무엇이 잘못됐나.** 에이전트가 0으로 종료한 뒤 task를 다시 읽어 분류하는데, SCHEDULED만 성공, PUBLISHING/FAILED는 실패이고 마지막 `else`가 나머지 전부(행이 삭제된 `undefined`, PREPARED, DRAFT, PUBLISHED 포함)를 성공으로 센다. 동일 역할의 `bulk-schedule-publish.ts:420-431`은 "초안 저장과 예약 완료는 다릅니다"라는 주석과 함께 정반대로 처리한다.

**실패 시나리오.** topic-agent가 초안 모드로 해석되거나 UI의 동시 편집으로 task가 PREPARED로 되돌아간 상태에서 0으로 종료한다. `else` 분기가 성공을 증가시켜 실행이 "성공: N"으로 끝나지만 실제로 예약된 것은 없고, 상태가 PREPARED로 남아 운영자에게는 조치할 실패 기록조차 없다.

**수정 방향.** 기본값을 뒤집는다. SCHEDULED만 성공으로 인정하고 나머지 모든 상태(행 누락 포함)는 관측된 상태를 `errorMessage`에 담아 실패로 처리한다.

#### H16. 갱신 항목의 예약일이 DB에 기록되지 않음 — `scripts/brandconnect-seasonal-register.ts:1458` (CONFIRMED)

**무엇이 잘못됐나.** `registerTravelItemsFlow`에서 기존 항목이 매치되면 1458-1473행의 `update`가 `externalItemId`, `sourceUrl`, `productName` 등은 쓰지만 `scheduledPublishAt`은 쓰지 않는다. 그럼에도 결과에는 `scheduledDate`가 담기고 성공으로 계수돼 날짜 슬롯을 소비하며 완료 알림에 그 날짜가 보고된다. 같은 파일의 다른 쓰기 경로(1533행, 1583행)는 모두 이 필드를 설정하므로 누락은 의도된 것이 아니다.

**실패 시나리오.** `--connect-kind=travel --start-date=2026-09-10 --count=5`가 이미 등록된 상품 3건에 매치된다. 콘솔과 알림은 09-10, 09-11, 09-12로 예약됐다고 보고하지만 `scheduledPublishAt`은 변하지 않는다(과거 생성 행은 대개 null). `bulk-schedule-publish.ts:237`은 `scheduledPublishAt != null`인 행만 고르므로 이 3건은 영원히 예약되지 않고, 신규 2건은 낭비된 슬롯 때문에 09-13/09-14로 밀린다.

**수정 방향.** update 페이로드에 `scheduledPublishAt: new Date(\`${scheduledDate}T00:00:00.000Z\`)`를 추가하거나(1533/1583행과 동일) 해당 항목을 예약 슬롯 소비로 계수하지 않는다.

### 4.3 준비·게이트·영구 차단 (H17–H23)

#### H17. 사용자 주제를 이스케이프 없이 정규식에 주입 — `src/services/topic-task-pipeline.ts:460` (CONFIRMED)

**무엇이 잘못됐나.** `compactNarrativeAngle`이 원시 사용자 주제로 `new RegExp(topic, "gi")`를 만든다. **같은 파일의 다른 주제 기반 정규식 302, 486, 498, 508행은 모두 먼저 이스케이프한다**(직접 재확인). 460행만 예외다. 호출 경로는 정상 준비 경로에서 무조건 실행된다(`prepareTopicTask:4549` → `buildNarrativeAngleBriefs` → `buildPlayfulTitle:2074` → `compactNarrativeAngle:460`). 유효한 패턴이 되는 메타문자는 더 나쁘다 — `"[리뷰] 오사카"`는 문자 클래스로 컴파일돼 아무것도 제거하지 않으므로 이 함수의 존재 이유인 중복 제거가 조용히 멈춘다.

**직접 재확인 — 실행 결과.**

| 주제 | 결과 |
|---|---|
| `C++ 입문 가이드` | `SyntaxError: Invalid regular expression … Nothing to repeat` |
| `오사카 여행 (2박3일` | `SyntaxError: Invalid regular expression … Unterminated group` |

**실패 시나리오.** 사용자가 위와 같은 흔한 한국어 제목으로 task를 만든다. `buildNarrativeAngleBriefs` 안에서 SyntaxError가 발생하고 4754행 catch가 task를 FAILED로 표시하며 `errorMessage`에 정규식 오류가 남는다. 몇 번을 재시도해도 준비할 수 없다.

**수정 방향.** 302행과 동일하게 생성 전에 이스케이프한다: `new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")`. 더 낫게는 기존 이스케이프를 공용 헬퍼로 추출해 5개 지점 모두에 적용한다.

#### H18. 심사 결과 인덱스 불일치로 다른 후보가 선택됨 — `src/services/topic-task-pipeline.ts:4627` (CONFIRMED)

**무엇이 잘못됐나.** `decideSelectedCandidate`는 점수 내림차순 `sorted`로 호출되고 상위 2개로 프롬프트를 만들며 그 슬라이스 내 위치로 "후보 1"/"후보 2"를 라벨링한다. 스키마는 `selectedIndex`가 `[0, length-1]` 정수라고만 말하고 원본 인덱스를 써야 한다는 지시도, 원본 인덱스를 보여주는 부분도 없다. 그런데 4627행은 `scored.find(entry => entry.index === selection.selectedIndex)`로 *정렬되지 않은* 배열의 인덱스처럼 해석한다. 휴리스틱 경로(2795, 2831행)는 `top.index`를 올바르게 반환하므로 이 불일치는 모델 경로에만 존재한다.

**실패 시나리오.** 후보 [A,B,C,D]의 점수가 A=40, B=72, C=71, D=55다. 정렬본은 [B,C,D,A]이고 B-C 격차가 1이라 심사가 돌아 후보 1=B, 후보 2=C를 보여준다. 응답이 `selectedIndex=0`("보여준 것 중 첫 번째" = B)이면 4627행은 이를 원본 인덱스 0, 즉 A로 해석한다. **심사에 보이지도 않았던 최저점 후보 A가 다듬어져 APPROVED 초안으로 저장되고 발행된다.**

**수정 방향.** 프롬프트에 명시적 id(원본 인덱스)를 렌더하고 id로 역매핑하거나, 정렬 위치를 반환받아 `scoredCandidates[selectedIndex].index`로 변환한다. 반환된 인덱스가 실제로 보여준 후보 집합 안인지 검증하고 아니면 `top.index`로 폴백한다.

#### H19. 준비/발행 게이트 입력 불일치로 인한 발행 데드락 — `src/lib/topic-task-content-readiness.ts:344` (CONFIRMED)

**무엇이 잘못됐나.** `externalSourceCount`가 선택 입력 `input.sourceUrls`에서 파생되고 `validSourceRefIds`가 "1".."N" 위치 라벨로 구성된다. 호출자가 `sourceUrls`를 생략하면(모듈 주석이 허용한다고 명시) 유효 참조 집합이 비어 모든 `section.sourceRefIds`가 거부되고, `CRITICAL_FACT_PATTERN`에 걸리는 모든 섹션이 P0 차단 사유가 된다. 준비 단계(`topic-task-pipeline.ts:4681-4691`)는 `sourceUrls`를 넘기지만 **발행 측 게이트는 전부 생략한다**(`.../publish/route.ts:221-227`, `bulk-schedule/route.ts:84-90`, `src/app/page.tsx:364-370`, `TopicTaskPanel.tsx:895-901`). `CRITICAL_FACT_PATTERN`은 "2시간", "3개", "20만원" 같은 평범한 한국어 문구에 매치되므로 사실상 모든 실제 초안에서 발동한다.

**실패 시나리오.** ts-node로 재현: 동일한 `preparedContentJson`에 대해 `sourceUrls` 3건을 주면 `canPublish=true, code="ok", score=100`, 생략하면 `canPublish=false, code="unsupported-factual-claim", score=75`다. 발행 API는 409와 "가격·할인율·시간·거리 등 검증 가능한 수치에 출처가 연결되지 않았습니다."를 반환하고 UI 버튼은 영구 비활성화된다. 재준비해도 같은 형태가 생성돼 task는 절대 "재준비 필요" 상태를 벗어나지 못한다.

**수정 방향.** 준비 시점에 `preparedContentJson`과 함께 출처 URL(또는 해석된 유효 `sourceRefId` 집합)을 영속화하고 모든 발행 측 호출자가 이를 전달하게 한다. 또는 `sourceUrls`가 `undefined`일 때는 fail-open으로 처리해 "미제공"과 "제공됐으나 비어 있음"을 구분한다.

#### H20. 자기 주제를 한 번 언급하면 `broken-copy` — `src/lib/topic-task-content-readiness.ts:630` (CONFIRMED)

**무엇이 잘못됐나.** `brokenCopyDetected`의 마지막 술어가 `topic.length >= 12 && countNormalizedOccurrences(body, topic) >= 1`이다. 같은 블록의 다른 술어들은 실제로 망가진 텍스트를 탐지하는데, 이것만 주제 문자열의 *첫* 출현에서 차단한다. 즉 글이 자기 주제를 한 번 언급하는 정상적이고 바람직한 행위가 기계 생성 쓰레기로 취급된다. 반복 횟수를 세는 헬퍼를 쓰면서 임계값이 `>= 1`인 점으로 보아 반복 임계값(>=2 또는 >=3)이 의도였을 가능성이 높다. 12자 이상 한국어 주제는 흔하다("겨울 캠핑 난로 고르는 기준" = 15자).

**실패 시나리오.** 주제가 "겨울 캠핑 난로 고르는 기준"이고 섹션 1 본문이 "겨울 캠핑 난로 고르는 기준은 출력부터 봅니다. …"로 시작한다. ts-node 재현 결과 `canPublish=false, code="broken-copy"`이며 발행 라우트는 409, UI는 "재준비 필요"를 표시한다. 재준비해도 새 초안 역시 자기 주제를 언급하므로 영원히 발행 불가다.

**수정 방향.** 임계값을 실제 반복 횟수(예: `>= 3`, 또는 섹션당 `>= 2` + 문서 전체 밀도 검사)로 올리거나, 임의 위치의 출현이 아니라 문장 시작부 완전 중복에만 적용한다.

#### H21. 섹션 제거 시 위치 기반 인덱싱 — `src/lib/post-composition-contract.ts:611-628` (CONFIRMED, 2026-09-08 HIGH→MEDIUM 정정)

> **정정.** 초판은 이를 "고지 섹션 제거 시 현재 발현 중인 HIGH 결함"으로 적었다. 그 서술은 **틀렸다.** 외부 리뷰(PR #14, Codex P2)의 지적대로, 현재 호출자에서는 발현하지 않는다. 재검증 결과 진짜 결함은 **위치 결합 + `isDisclosureSection` 과대 매칭**이며 성격이 다르다.

**무엇이 잘못됐나.** 611-613행은 **어떤 위치의 섹션이든** 제거할 수 있는데, 615행의 `sectionPlan.length === contentSections.length` 가드와 620행 `sectionImagePaths[index]`, 628행 `plan[index]`는 원본 인덱스를 보존하지 않고 **제거 후 위치**로 조회한다. 이 결합은 **제거 대상이 항상 마지막일 때만** 안전하다.

**현재 발현하지 않는 이유(초판이 놓친 것).** `assemblePost`는 본문 섹션을 모두 만든 뒤 `scripts/lib/post-spec/assemble.ts:104`에서 고지를 **마지막에 append**하고, 같은 함수가 넘기는 `composition.sections`(:84)와 `sectionPlan`(:125)은 `spec.sections` 기반이라 **고지를 포함하지 않는다**(`types.ts:238` 주석이 이 계약을 명문화). 즉 `sections`는 N+1, 두 배열은 N이므로 마지막 원소가 빠지면 길이가 맞아떨어지고 본문 순서도 보존된다. 초판의 재현은 두 배열에 고지 항목을 직접 넣었는데, **실제 호출자는 그렇게 하지 않는다.**

**그럼에도 남는 진짜 위험 — `isDisclosureSection` 과대 매칭.** 434행은 `(쇼핑|여행) 커넥트` + `수수료` 동시 출현만 보고, 440행의 문장 정규식은 `이 글은|이 포스팅은|본 글은` 접두형만 잡는다. 그런데 여행 `closing` **본문** 섹션은 이미 `여행커넥트`를 담고 있고(`scripts/lib/post-spec/section-library.ts:532`), `취소 수수료`는 여행 상품에서 정상 어휘다. 본문 중간 섹션이 이 판정에 걸리는 순간 위 결합이 즉시 발현해 이미지가 다른 소제목에 붙고 스펙 플랜 전체가 폐기된다.

**수정 방향.** 두 가지를 함께 한다. (a) `contentSections`를 만들 때 살아남은 **원본 인덱스 매핑**을 유지하고 그 매핑으로 두 배열을 조회한다 — 그러면 어떤 위치가 제거돼도 안전하다. (b) `isDisclosureSection`을 위치(마지막) 또는 명시적 마커 기반으로 좁혀 본문 섹션이 걸리지 않게 한다. 현재는 (a) 없이 "고지는 늘 마지막"이라는 암묵적 전제에만 의존하고 있고, 그 전제는 코드가 강제하지 않는다.

#### H22. 조사 보정이 형용사 어미와 일반 명사를 훼손 — `src/lib/topic-workflow.ts:477` (CONFIRMED)

**무엇이 잘못됐나.** `repairKoreanParticles`의 세 정규식이 어말 이/가, 은/는, 을/를 음절 뒤에 공백·구두점·문자열 끝이 오는 *모든* 경우를 매치해 받침 규칙으로 재작성한다. 실제로 조사가 치환된 위치를 전혀 모르므로 **이로 끝나는 명사와 관형사형 어미 -는/-은이 함께 재작성된다.** `planSubtopics`가 만드는 모든 subtopic, reason, readerPromise, imageCue, whyNow가 이 경로를 통과하고, `subtopicLooksBroken`(542행)은 이 형태를 인식하지 못한다.

**직접 재확인 — 함수를 추출해 현실적인 한국어로 실행한 결과. 1차 리포트가 보고한 것보다 나쁘다.**

| 입력 (정상 문장) | 출력 (훼손) |
|---|---|
| `맛있는 고구마가 좋다` | `맛있은 고구마가 좋다` |
| `우리 아이 사진` | `우리 아가 사진` |
| `생선구이 맛집` | `생선구가 맛집` |
| `가을 나들이` | `가를 나들이` |

관형사형 어미 -는/-은이 뭉개지고, "아이", "구이", "나들이"처럼 **이로 끝나는 평범한 명사가 조사로 오인돼 통째로 바뀐다.** 1차는 "읽는 맛→읽은 맛" 수준으로 보고했으나 실제 파손 범위는 명사까지 미친다.

**실패 시나리오.** `src/services/topic-task-pipeline.ts:1959`가 이미 `/차가$|장면이 살아 있은|처음엔 별거/`를 블랙리스트로 두고 플래너 결과 전체를 폐기하므로, `TOPIC_EXPERIMENTAL_SUBTOPIC_PLANNER=true`에서 플래너는 사실상 아무 산출물도 내지 못한다. 그 가드가 완화되면 훼손된 한국어가 `TopicSubtopic` 행과 블로그 제목에 그대로 기록된다.

**수정 방향.** 렌더된 문장을 스캔하지 말고, 템플릿의 플레이스홀더 옆에 조사를 표시(예: `{keyword}<이/가>`)해 그 마커만 치환값 기준으로 해석한다. 또는 `formatSubtopicTemplate`에서 치환 오프셋을 기록해 그 위치에만 `hasBatchim`을 적용한다. 임시 조치로는 부정 후방탐색으로 명사·어미를 제외하고 `subtopicLooksBroken`을 확장한다. 파손 범위를 감안하면 **임시 조치보다 마커 방식으로 한 번에 바꾸는 편이 낫다.**

#### H23. 재정렬된 목록의 0번 행을 최조기 예약으로 사용 — `src/app/api/brandlinks/bulk-schedule/route.ts:153` (CONFIRMED)

**무엇이 잘못됐나.** 쿼리는 `scheduledPublishAt` 오름차순으로 정렬하지만 `preparedPostsFirst`(`src/lib/prepared-post-priority.ts:11`)가 준비된 패키지를 가진 링크를 앞으로 재배치한다. 153행은 재배치된 `pendingRows[0]`을 최조기 항목으로 보고 172행이 그 값에서 `inferredStartDate`를 만든다. 메인 UI(`src/app/page.tsx:1532`)는 `startDate`를 보내지 않으므로 이 추론값이 기본 경로이고, 항상 non-null이라 자식 스크립트가 `shouldReassignScheduleDates=true`로 모든 선택 링크의 날짜를 그 순서대로 순차 재작성한다.

**실패 시나리오.** READY 링크 3건의 예약일이 2026-09-10(패키지 없음), 2026-09-11(없음), 2026-12-01(준비된 초안 있음)이다. 재정렬 결과는 [12-01, 09-10, 09-11]이고 `inferredStartDate`가 2026-12-01이 되어, 9월 두 건이 조용히 2026-12-02, 2026-12-03으로 — 사용자가 저장한 날짜보다 약 3개월 뒤로 — 재예약된다.

**수정 방향.** 우선순위 분할 이전의 날짜 정렬 결과에서 `earliestPending`을 계산하고(원본 `findMany` 결과의 `rows[0]` 사용), `preparedPostsFirst`는 실행 순서/개수 제한에만 쓴다.

### 4.4 출하 기본 작성 경로 — Codex (H24–H26)

> **이 절은 1차 감사에 통째로 빠져 있던 영역이다.** `scripts/lib/draft-runtime-policy.json`이 `AI_PROVIDER: "codex"`, `CODEX_DRAFT_MODEL: "gpt-5.5"`로 고정돼 있고 `scripts/simple-agent.ts:4560`이 `runCodexDraft`로 분기하므로, **이것이 출하 기본 경로다.** 1차는 로그인·상태 조회만 하는 `src/lib/codex-local.ts`만 다뤘고, 실제 원고를 만드는 `scripts/lib/codex-draft-provider.ts`(133줄)와 `CODEX_BROWSER_FALLBACK` 체인(`simple-agent.ts:4573-4580`)은 한 건도 점검하지 않았다. 2차 점검에서 이 경로에서만 CONFIRMED 9건이 나왔다(HIGH 3, MEDIUM 2, LOW 4).

#### H24. 복구 가능한 Codex `error` 스트림 이벤트가 초안 실행 전체를 중단시킴 — `scripts/lib/codex-draft-provider.ts:117` (CONFIRMED)

**무엇이 잘못됐나.** 이벤트 루프가 `event.type === "error"`를 전부 치명 오류로 보고 118행에서 던진다. 그러나 Codex CLI는 **복구 가능한 전송 재시도**에도 같은 타입을 낸다. 번들된 CLI(`node_modules/@openai/codex-linux-x64/…/bin/codex`)를 이 provider가 만드는 argv 그대로 실행해 얻은 실제 스트림은 다음과 같다.

```
{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401 ..., url: wss://api.openai.com/v1/responses ...)"}
{"type":"item.completed","item":{"type":"error","message":"Falling back from WebSockets to HTTPS transport. ..."}}
{"type":"error","message":"Reconnecting... 1/5 (... https://api.openai.com/v1/responses ...)"}
```

CLI는 전송 방식마다 5회까지 재시도한 뒤 WebSocket → HTTPS로 폴백하며, **실제로 포기할 때는 `turn.failed`를 낸다** — 그리고 115-116행은 이미 그것을 올바르게 처리하고 있다. SDK 자신의 소비자(`node_modules/@openai/codex-sdk/dist/index.js:103-116`의 `Thread.run()`)도 `error` 이벤트를 의도적으로 무시한다. 이 provider만 치명으로 취급한다.

**실패 시나리오.** `wss://api.openai.com`을 막는 사내 프록시 뒤의 사용자가 평범한 초안을 만든다. Codex가 재연결 알림을 낸 뒤 HTTPS로 성공적으로 폴백해 원고를 만들어 냈을 상황인데, 118행이 첫 알림에서 던지고 `generateWithAI`가 `Codex 작성 실패: Reconnecting... 2/5 (unexpected status 401 …)`로 재던져 초안 라우트가 500 `CODEX_DRAFT_FAILED`를 반환한다. `CODEX_BROWSER_FALLBACK_ENABLED`는 기본 false이므로 폴백도 없다. **그 PC에서는 모든 초안이 영구히 실패하고, 오류 메시지는 프록시가 아니라 존재하지도 않는 401을 가리킨다.** 10분짜리 초안 도중의 일시적 429/네트워크 끊김에도 똑같이 발동한다.

**수정 방향.** `event.type === "error"`에서 던지지 않는다. `options.onProgress`로 보고하고(마지막 것을 보관해 이후 실패 메시지를 풍부하게 하는 정도), 종결 신호는 `turn.failed`와 SDK의 비정상 종료 예외에 맡긴다. SDK의 `Thread.run()`을 그대로 따르면 된다.

#### H25. 방치된 `codex login` 잡이 만료되지 않고 모든 후속 로그인을 영구 차단 — `src/lib/codex-local.ts:128` (CONFIRMED)

**무엇이 잘못됐나.** `startCodexLogin`은 `status === "running"`인 잡이 있으면 새 로그인을 시작하지 않고 그것을 반환한다. 142행에서 스폰한 자식에는 타임아웃이 없고 아무도 죽이지 않으며, `job.status`는 `error`(153행) 또는 `exit`(158행) 핸들러로만 running을 벗어난다. `codex login`은 브라우저 OAuth 콜백을 기다리며 블록하므로, 사용자가 탭을 닫거나 콜백이 오지 않으면 자식은 무기한 살아 있고 잡은 영원히 running이다. 이 모듈에도 `src/app/api/codex/route.ts`에도 기한·취소·정리가 없다(`loginJobs`도 무한히 커진다). 유일한 기한은 클라이언트 쪽 `src/components/SessionStatus.tsx:163`의 10분인데, 이는 UI가 포기하는 것일 뿐 서버로 아무것도 보내지 않는다.

**실패 시나리오.** 사용자가 "GPT 연결"을 누르고 브라우저가 열리지만 딴 일을 하다 탭을 닫는다. 10분 뒤 UI가 "GPT 로그인 확인 시간이 초과되었습니다"를 띄운다. 다시 "GPT 연결"을 누르면 → 미인증 → `startCodexLogin`이 128행에서 낡은 running 잡을 찾아 그대로 반환 → 라우트가 202로 그 잡 id를 응답 → UI는 "브라우저에서 GPT 로그인을 완료해 주세요"라고 하지만 **브라우저 창은 열리지 않고**, 10분 뒤 또 타임아웃. **앱 프로세스가 살아 있는 동안 Codex를 다시 연결할 방법이 없고**, 따라서 초안·발행 양쪽에서 `useCodex`가 false로 고정돼 출하 기본 작성 경로 자체에 도달할 수 없다. 그동안 고아가 된 270MB codex 자식이 누수된다.

**수정 방향.** 잡에 서버 측 기한을 준다. `startedAt`을 기록하고 (a) 약 10분 뒤 `child.kill()` 후 실패 표기하는 `setTimeout`을 걸거나 (b) 128행 조회에서 기한 초과 running 잡을 stale로 보고 자식을 죽인 뒤 새 로그인을 시작한다. 종결된 잡은 읽는 즉시 `loginJobs`에서 지우고, UI가 포기할 때 호출할 취소 경로(`DELETE /api/codex?jobId=`)를 만든다. *1차에서는 MEDIUM이었으나, 출하 기본 경로 전체를 프로세스 수명 동안 봉쇄한다는 점이 확인돼 HIGH로 상향했다.*

#### H26. `PRODUCT_POST_LOCAL_FALLBACK_ENABLED` 기본값이 세 곳에서 서로 다르다 — `scripts/simple-agent.ts:387` (CONFIRMED)

**무엇이 잘못됐나.** 같은 토글을 세 소스가 다르게 읽는다.

| 위치 | 코드 | 기본값 |
|---|---|---|
| `scripts/simple-agent.ts:386-387` | `(process.env.X \|\| "true").toLowerCase() !== "false"` | **true** |
| `src/app/api/brandlinks/[id]/draft/route.ts:392` | `(process.env.X \|\| "false").toLowerCase() === "true"` | **false** |
| `.env.example:31` | `PRODUCT_POST_LOCAL_FALLBACK_ENABLED="false"` | **false** |

그리고 발행 라우트(`src/app/api/brandlinks/[id]/publish/route.ts:296-310`)는 자식 env를 만들 때 **이 키를 아예 넣지 않으므로** 에이전트가 자기 기본값 `true`로 떨어진다. 값은 `scripts/lib/post-spec/index.ts:295`·`:300`에 `allowLocalFallback`으로 도달하는데 거기서도 `?? true`다. CI는 오히려 반대 의도를 강제한다 — `scripts/verify-brand-post-package.ts:32-36`이 초안 라우트가 `"true"`를 실어 보내면 안 된다고 단언하지만, 그 단언은 초안 라우트 소스만 들여다볼 뿐 발행 라우트와 에이전트 기본값에 대해서는 아무 말도 하지 않는다.

**실패 시나리오.** Codex에 로그인하지 않았지만 `OPENAI_API_KEY`는 설정한 데스크톱 사용자가 상품에서 발행을 누른다. `publish/route.ts:231-232`가 `useCodex=false` → `agentAiProvider="openai"`로 계산하고 이 키 없이 simple-agent를 스폰한다. 에이전트는 `allowLocalFallback=true`로 spec-first 파이프라인에 들어가고, OpenAI 구조화 호출이 실패하면(레이트리밋, 콘텐츠 필터, 네트워크) `post-spec/index.ts:295`가 오류를 삼키고 `buildLocalDraft()` — **템플릿 글** — 로 대체한다. 실행은 그대로 진행되어 **기계가 찍어낸 템플릿 기사가 브랜드 협찬 고지를 달고 사용자의 실제 블로그에 발행된다.** 문서화된 동작인 `CONTENT_BLOCKED`/`LLM_UNAVAILABLE` 중단이 일어나지 않는다.

**수정 방향.** 기본값을 하나로 통일한다. `scripts/simple-agent.ts:387`을 `(process.env.X || "false").toLowerCase() === "true"`로 바꿔 초안 라우트·`.env.example`과 맞추거나, 발행 라우트의 스폰 env(`publish/route.ts:299`)에 초안 라우트와 동일하게 명시적으로 실어 보낸다. `post-spec/index.ts:295`·`:300`의 `?? true`도 `?? false`로 바꾸고, `verify-brand-post-package.ts:32`가 발행 라우트와 에이전트 기본값까지 단언하도록 확장한다.

### 4.5 데이터 손실·자원 누수 (H27–H31)

#### H27. 자식 프로세스 stdout/stderr 청크 단위 디코딩 — `src/lib/run-script.ts:89-95` (CONFIRMED, 2026-09-08 HIGH→MEDIUM 강등)

> **정정.** 디코딩 결함 자체는 실측으로 확정된 진짜 버그다. 다만 초판은 "깨진 본문이 그대로 발행된다"고 적었는데 그 **영향 범위가 틀렸다.** 외부 리뷰(PR #14, Codex P2)의 지적대로 손상은 발행 글에 도달하지 않는다.

**무엇이 잘못됐나.** `setEncoding("utf8")`이나 `StringDecoder` 없이 `stdout += chunk.toString()` / `stderr += chunk.toString()`으로 청크를 개별 디코딩한다. 읽기 경계가 3바이트 한글 코드포인트 중간에 떨어지면 양쪽에 U+FFFD가 생기고 **오류는 전혀 나지 않는다.** 같은 저장소의 `src/lib/brand-post-image-generation.ts:372-373`은 이를 올바르게 처리하므로 의도적 선택이 아니다.

**직접 재확인.** 149,536바이트 출력에서 U+FFFD 8개 발생(`Buffer.concat`/`StringDecoder` 기준값은 0개), 손상된 JSON도 `JSON.parse`를 그대로 통과했다. 발생 조건은 초판이 적은 "총 stdout 64KiB 초과"가 **아니라** 단일 write가 `PIPE_BUF`(4096)를 넘고 읽기가 분할될 때이며, 스케줄링에 따라 비결정적이다(182KB 이상 매회 재현, 38~56KB 산발, 20KB 이하 미발생).

**영향 범위(정정).** `scripts/review-agent.ts:289`의 `--publish` 분기는 **상호 배타적**이다. `--publish` 없이 실행하면 :293-294가 "생성된 콘텐츠:" JSON을 출력한 뒤 :295에서 `return`하므로 **아무것도 발행하지 않는다.** `--publish`로 실행하면 메모리상의 `content`를 발행하고 그 JSON을 애초에 출력하지 않는다. 따라서 손상은 발행 본문이 아니라 아래에 남는다.

1. `--publish` 없이 호출된 `POST /api/review`가 반환하는 `data.content`(생성 원고 전문)가 조용히 오염된다 — 관리자 키로 게이트된 공개 계약이라 외부 연동 클라이언트는 깨진 한글을 그대로 받는다.
2. `src/services/scheduler.ts:154-157`이 남기는 `stdout.slice(-500)`은 하필 손상 확률이 가장 높은 꼬리 구간이라, 발행 실패 추적용 운영 로그가 깨질 수 있다.
3. 동일 결함이 `stderr`(93-95행)에도 있어 `review/route.ts:126`·`scrape/route.ts:52`가 500 응답에 싣는 한국어 오류 메시지가 깨진다.

**수정 방향.** spawn 직후 `child.stdout.setEncoding("utf8")`과 `child.stderr.setEncoding("utf8")`을 호출하거나, Buffer를 모아 close 시점에 `Buffer.concat(...).toString("utf8")`로 한 번에 디코딩한다. 한 줄짜리 수정이고 위험도 없으므로 등급과 무관하게 처리할 가치가 있다.

#### H28. 승인 시 매니페스트 비원자적 기록 — `src/lib/brand-post-package.ts:370` (CONFIRMED)

**무엇이 잘못됐나.** `fs.writeFileSync(manifestPath, JSON.stringify(approved, null, 2), "utf8")`가 라이브 매니페스트를 잘라내고 제자리에 다시 쓴다. 이 파일의 다른 모든 기록 경로는 임시 파일 + rename을 하는 `writeBrandPostPackageManifest`(477-491행)를 거친다. 매니페스트에는 `postSpec`, `specDraft`, `composition`, `sourceSnapshot`이 들어 있어 한 번의 write 시스템 콜을 일상적으로 초과한다. `readBrandPostPackage`(180행)는 try/catch도 폴백도 없이 `JSON.parse`하므로 잘린 매니페스트는 영구히 읽을 수 없고, 유일한 백업은 읽기 시점 마이그레이션 경로에서만 생성되며 승인 시에는 만들어지지 않는다.

**실패 시나리오.** 사용자가 승인을 누른 순간 앱이 종료된다(이 앱에는 의도적 종료 경로가 있다 — 종료 시 업데이트 설치, `src/app/api/system/control/route.ts:86-110`의 서버 재시작). 매니페스트가 잘린 상태로 남고, 이후 모든 `readBrandPostPackage`가 SyntaxError를 던지며 `GET /api/brandlinks/{id}/draft`가 500을 반환한다. 원고·구성·스펙·품질 판정을 포함한 준비 초안 전체가 복구 불가이고, 생성된 이미지는 디스크에 남지만 아무도 참조하지 않는다.

**수정 방향.** 직접 쓰기를 `writeBrandPostPackageManifest(approved)` 호출로 교체한다(mkdir + tmp + rename이 이미 구현돼 있다).

#### H29. 검증된 상품 원본 사진 참조 영구 유실 — `src/lib/brand-post-image-generation.ts:191` (CONFIRMED)

**무엇이 잘못됐나.** `existingShoppingSource`는 `provenance === "ORIGINAL"` 자산 또는 `${sourcePath}.source.json` 기록이 있는 `EDITORIAL_CARD` 자산으로만 검증된 원본 사진을 찾을 수 있다. 그런데 `applyGeneratedBrandPostImage`(`src/lib/brand-post-package.ts:628-636`)는 ORIGINAL 항목을 통째로 교체하고 대체물의 `sourcePath`를 방금 만든 합성 이미지로 설정한다. `.source.json`을 쓰는 것은 `createOriginalProductPhotoOnBackground`뿐이며, 성공 경로인 `createLockedProductThumbnailOnBackground`/`createLockedProductEditorialScene`은 일회성 작업 디렉터리에 `.lock.json`만 남긴다. 174행 주석("마지막 ORIGINAL 슬롯 교체가 검증된 원본을 버려서는 안 된다")은 위험을 알고 있었으나 대응이 실패 분기에만 적용됐다.

**실패 시나리오.** min=max=1인 섹션 하나에 ORIGINAL 상품 사진 한 장만 있는 SHOPPING 초안. `planSectionImageRequests`가 그 ORIGINAL을 `replaceAssetKey`로 지정하고, 잠금이 성공해 자산이 LOCKED_PRODUCT가 되며 `sourcePath`가 합성 이미지를 가리킨다. 매니페스트에 ORIGINAL이 0개, `.source.json`도 없다. 이후 어떤 재생성(이미지 탭 채우기, 두 번째 복구 실행, `post_apply_section_image`)도 "상품 원본 사진을 찾지 못했습니다…"로 영구 실패한다. 원본 파일은 패키지 images/ 디렉터리에 그대로 있는데도 그렇다. `scripts/recover-reviewed-product-images.ts`가 정확히 이 상태를 수습하려고 존재하며 운영자가 원본 경로를 직접 지정해야 한다.

**수정 방향.** `createLockedProductThumbnailOnBackground`/`createLockedProductEditorialScene`이 출력 옆에 동일한 `.source.json` 기록을 남기게 한다(이미 `lock.sourcePath`, `lock.sourceSha256`을 갖고 있다). 아울러 `applyGeneratedBrandPostImage`에서 교체 대상 자산의 원래 `sourcePath`를 합성 경로로 덮어쓰지 말고 승계한다.

#### H30. `imageGeneration.status:"running"`에 만료 개념이 없음 — `src/lib/brand-post-package.ts:329` (CONFIRMED)

**무엇이 잘못됐나.** `repairBrandPostImages`가 시작 전에 `"running"`을 매니페스트에 영속화하고 같은 인프로세스 실행의 마지막 `persist(false)`에서만 해제한다. `hasUnfinishedSectionImages`는 저장된 `"running"`을 `updatedAt` 노후 판단 없이 무조건 미완료로 보고, `approveBrandPostPackage`(340행)는 예외를 던진다. UI도 그대로 따라가 `draftImagesRunning`(`src/app/page.tsx:444`)이 승인·이미지 채우기·재검사·재생성을 조기 반환시키고 끝나지 않는 3초 폴링을 시작한다. 전용 복구 스크립트마저 `status !== "running"`일 때만 완료 상태를 쓰므로 이 값을 지우지 못한다.

**실패 시나리오.** 섹션 이미지 배치 생성이 detached로 디스패치된 상태에서 사용자가 앱을 종료하거나 업데이트 때문에 서버가 재시작된다. 매니페스트에 `"running"`이 남는다. 재시작 후 인메모리 `activeJobs`는 비어 실제로 도는 작업이 없는데도 초안은 영구 동결된다 — 승인은 예외, 모든 UI 버튼은 무동작, 미리보기는 "서버 작업 진행 중"을 무한 표시한다. 앱 내 복구 경로가 없고 직접 HTTP/MCP 호출이 필요하다.

**수정 방향.** 저장된 `"running"`을 `updatedAt`이 배치 예산(`imageBatchTimeoutMs`)보다 오래됐으면 stale로 간주하거나, pid/부팅 id를 함께 기록해 현재 프로세스와 불일치하면 무시한다.

#### H31. 이미지 다운로드의 무한 리다이렉트·타임아웃 부재 — `scripts/simple-agent.ts:4451`, `:4446` (CONFIRMED)

**무엇이 잘못됐나.** `downloadImage`가 301/302에서 `response.headers.location`으로 자기 자신을 재귀 호출하는데 리다이렉트 카운터도 방문 URL 집합도 없다. 요청 자체(`protocol.get(url, ...)`)에는 `timeout` 옵션도 소켓 유휴 가드도 `response.on('error')`도 없다. 따라서 반환 Promise가 영원히 settle되지 않는 경로가 둘이다. `materializeProductImages`(3827행)가 try/catch 안에서 await하지만 catch는 settle되지 않는 Promise를 구제하지 못한다. 부수적으로 상대 경로 `Location`(`/img/x.jpg`)은 `url.startsWith('https')` 판정 때문에 http 모듈을 골라 ERR_INVALID_URL로 조용히 이미지를 잃는다.

**실패 시나리오.** 저장된 상품 이미지 URL이 A→B→A로 302 순환하는 CDN(서명 URL/지역 리다이렉트에서 흔함)을 가리키거나, 호스트가 TCP 핸드셰이크만 끝내고 헤더를 보내지 않는다. `materializeProductImages`가 반환되지 않아 `main()`이 "STEP1 상품 정보/이미지 수집"에서 정지한다. 최소 150분에 달하는 `AGENT_MAX_RUNTIME_MS` 워치독이 뜰 때까지 headed Chrome과 PUBLISHING 상태 행이 묶여 있다.

**수정 방향.** 리다이렉트 예산(예: `maxRedirects = 5`)을 재귀 인자로 전달하고, `new URL(location, url)`로 상대 리다이렉트와 스킴 변경을 해석하며, `protocol.get(url, { timeout: 15000 }, ...)` + `req.on('timeout', () => req.destroy(new Error('image download timeout')))`를 추가하고 부분 파일을 정리한다.

### 4.6 정상 경로 오출력 (H32–H41)

#### H32. hero 이미지 정규식이 Windows 경로를 매치하지 못함 — `scripts/topic-agent.ts:2235` (CONFIRMED)

**무엇이 잘못됐나.** `/(^|\/)hero-\d+\.[a-z0-9]+$/i`는 파일명 앞에 `/`가 오거나 문자열 시작이어야 한다. 경로는 `TopicDraftImage.localPath`에서 오고 `path.join`으로 만들어지므로 Windows에서는 `...\hero-1.png`다. 정규식이 매치하지 않아 `heroImagePath`가 null이 되고 전용 대표 이미지 업로드 블록(2238-2249행)이 건너뛰어지며, hero 파일은 일반 섹션 이미지로 `inlineImagePaths`에 섞인다. `package.json`의 `build.win` 기준 Windows(nsis)가 주 패키징 대상이다.

**실패 시나리오.** Windows 설치본에서 `hero-1.png`, `section-1.png` 이미지를 가진 준비된 task를 발행하면 글 상단에 대표 이미지가 없고 hero 사진이 본문 중간에 들어간다. macOS/Linux에서는 정상 동작하므로 개발 환경에서는 보이지 않는다.

**수정 방향.** 두 구분자를 모두 매치하거나(`/(^|[\\/\\\\])hero-\d+\.[a-z0-9]+$/i`), `path.basename(imagePath)`를 `/^hero-\d+\./i`와 비교한다.

#### H33. 프롬프트 청킹이 모든 개행을 삭제 — `scripts/lib/chatgpt-browser.ts:646` (CONFIRMED)

**무엇이 잘못됐나.** `prompt.match(/.{1,1000}/g)`는 `s` 플래그가 없어 `.`이 줄바꿈을 매치하지 않는다. 결과적으로 개행 없는 구간만 남고 모든 `\n`이 사라진 채 조각들이 구분자 없이 연속 입력된다(646행과 702행 모두). 이 경로가 실제 사용 경로다 — `waitForChatGPTComposer`가 `#prompt-textarea`를 반환하므로 `composer.fill()` 분기는 절대 타지 않는다. 같은 저장소의 `scripts/simple-agent.ts:5486 pasteChatGPTPrompt`는 합성 붙여넣기/`keyboard.insertText`로 개행을 보존하고 입력 결과를 검증까지 하는데, 공용 라이브러리는 둘 다 하지 않는다.

**실패 시나리오.** `scripts/topic-agent.ts:1934`가 지시 항목 배열을 `\n`으로 join하고 JSON 스키마를 덧붙인 프롬프트를 보낸다. 실제로 전달되는 것은 항목들이 서로 붙고 빈 줄이 사라지고 스키마가 앞 문장에 융합된 한 줄짜리 텍스트다. 이미지 배치 스크립트와 파이프라인 폴백도 동일하며, `composeBudgetedChatGptPrompt`가 `"\n\n"`으로 정교하게 구성한 예산 배분이 입력 시점에 전부 무의미해진다.

**수정 방향.** `page.keyboard.insertText(prompt)`로 리터럴 개행을 삽입하거나, `prompt.match(/[\s\S]{1,1000}/g)`로 청킹하고 개행마다 Shift+Enter를 누른다. 이후 컴포저 내용을 되읽어 프로브 문자열이 포함됐는지 검증한다.

#### H34. 응답 대기 만료를 성공으로 반환 — `scripts/lib/chatgpt-browser.ts:779` (CONFIRMED)

**무엇이 잘못됐나.** 응답 루프가 `while (Date.now() - startWait < 300000)`으로 하드코딩된 5분이며(정책 기본값 10분을 무시), 벽시계 만료로 루프를 벗어나도 "텍스트 증가 중단" break와 구분 없이 779-791행으로 흘러 마지막 비어 있지 않은 턴을 반환한다. 호출자는 타임아웃과 정상 완료를 구별할 수 없다. 같은 파일의 `waitForChatGPTImageArtifacts`는 921행에 정반대 정책("타임아웃은 성공적 관측이 아니다")을 명시하고 0을 반환한다.

**실패 시나리오.** topic-agent가 4개 섹션 한국어 JSON 초안을 요청한다. 응답이 5분을 넘겨 스트리밍되면(웹 검색이 개입할 때 흔하며 756행 코드도 이를 인지한다) t=300초에 루프가 중간에서 종료되고 절반만 쓰인 메시지가 반환된다. topic-agent는 닫히지 않은 JSON을 파싱해 본문 스크랩 폴백으로 떨어지거나 섹션이 빠진 초안을 만들며, 대기가 만료됐다는 사실은 어디에도 보고되지 않는다.

**수정 방향.** 루프 종료 사유를 추적한다. `generating`이 여전히 true인 채 기한이 만료됐다면 부분 텍스트 대신 별도의 타임아웃 오류를 던지고, 예산은 리터럴 300000이 아니라 `getWritingTimeoutPolicy().responseMs`에서 가져온다.

#### H35. stale 락 탈취 경쟁으로 두 프로세스가 같은 프로필 점유 — `scripts/lib/chatgpt-profile-lock.ts:71` (CONFIRMED)

**무엇이 잘못됐나.** `clearStaleLock`은 payload를 읽고 PID 생존을 확인한 뒤 *경로*에 대해 `fs.rmSync`를 호출한다 — 방금 검사한 파일과 디스크의 파일이 동일한지(fd 보유, inode/ownerId 재확인, 원자적 rename) 전혀 확인하지 않는다. `acquireChatGptProfileLock`은 true 반환 시 즉시 재시도한다. 따라서 같은 stale payload를 관측한 두 대기자가 각각 삭제 후 `openSync(lockPath, "wx")`에 성공할 수 있고, 두 번째 삭제가 첫 번째의 살아 있는 락을 지운다.

**실패 시나리오.** 앱이 실행 중 강제 종료돼 죽은 PID가 적힌 락 파일이 남는다. 재실행 시 초안 에이전트와 이미지 배치 스크립트가 동시에 진입해 둘 다 stale로 판단하고 각자 삭제·생성한다. 둘 다 `chromium.launchPersistentContext(CHATGPT_USER_DATA_DIR)`를 호출하고, Chrome의 SingletonLock 때문에 두 번째 실행이 예외를 던지지만 `chatgpt-browser.ts:411-415`가 세션 파일이 있으면 그 예외를 삼키므로 조용히 일회성 브라우저로 폴백해 "ChatGPT 로그인이 필요합니다"라는 엉뚱한 원인을 보고한다. 락이 존재하는 이유인 바로 그 시나리오에서 락이 무력화된다.

**수정 방향.** 탈취를 원자적으로 만든다. 새 락을 임시 파일에 쓰고 stale 경로 위로 `fs.renameSync`하거나, rmSync 직전에 락을 다시 읽어 payload가 바이트 단위로 동일할 때만 진행한다. 더 낫게는 경로가 아니라 프로세스 수명 동안 열린 배타 fd로 락을 보유한다.

#### H36. 이미지 부족을 레이아웃 요구량이 아닌 풀 하한과 비교 — `scripts/lib/post-spec/image-plan.ts:281` (CONFIRMED)

> **1차 리포트 정정.** 1차는 이 사건을 `scripts/lib/post-spec/assemble.ts:71`(H30)으로 기록했다. 2차 중재 결과 **그 지목은 틀렸다.** 실제 결함은 한 단계 위인 `image-plan.ts:281`에 있다.

**무엇이 잘못됐나.** `assignImageSlots`가 `shortfall: Math.max(0, minBody - resolvedBody)`를 반환한다. 여기서 `minBody`는 섹션 레이아웃이 존재하기도 전에 `scripts/lib/post-spec/index.ts:162`에서 정해지는 상수다(SHOPPING 4, TRAVEL 5). 그러나 **레이아웃이 실제로 요구하는 장수는 이 함수가 이미 인자로 받고 있는 `sections`의 `imageCount[0]` 합계다.** SHOPPING의 허용 범위 하단에서 두 수가 갈린다.

섹션 수는 풀 크기에서 파생되고(`index.ts:177`: `resolved >= 7 ? 10 : resolved >= 5 ? 9 : 8`), `buildSectionTemplates`(`section-library.ts:592-600`)는 `proof`/`comparison`/`offer-check`만 떨어뜨리므로 축소해도 주로 이미지 0장짜리 섹션이 빠진다. 실제 선택 + 승격 + `assignImageSlots`를 그대로 시뮬레이션한 결과:

| `resolved` | 섹션 수 | `sum(imageCount[0])` | 배정 슬롯 | `shortfall` | 결과 |
|---|---|---|---|---|---|
| 4 | 8 | **5** | 4 | **0** | `fit-checklist` 비어 있음 |
| 5 | 9 | **6** | 5 | **0** | `fit-checklist` 비어 있음 |
| 6 | 9 | 6 | 6 | 0 | 정상 |
| 7 | 10 | 7 | 7 | 0 | 정상 |
| 8 | 10 | 8 | 8 | 0 | 정상 |

즉 **문서화된 최소치와 그 바로 위, 두 경우에서만** `shortfall`이 0을 보고하면서 계획은 실제로 부족하다.

**하류에서 벌어지는 일.** `validate.ts:220-222`가 `imageShort = spec.imagePlan.shortfall > 0` → false로 계산해 `images` 신호를 단순 "warn"으로 밀고 IMAGE_SHORTFALL을 올리지 않으며 리포트는 `canPublish: true`로 돌아온다. `buildCompositionSectionPlan`(`assemble.ts:66-72`)은 충실하게 `{ role: "fit-checklist", imagePaths: [], imageMin: 1, imageMax: 1 }`을 낸다. `simple-agent.ts:9882-9894`가 그 플랜을 `resolvePostDocument`에 넘기고, `buildPostQualityReport`가 그 섹션을 `missingSectionIds`에 넣으며, 프리셋 기본값이 PREMIUM이므로 BLOCKER로 등록되어 **`scripts/simple-agent.ts:9910`에서 `프리미엄 자동발행 품질 게이트 미통과: 이미지 최소 장수를 못 채운 파트가 있습니다: shopping-fit-checklist.`로 하드 예외가 난다.** 초안 생성과 최대 2회 수리 라운드 비용을 모두 지불한 뒤에 죽는다.

**1차에서 잘못 지목한 위치 — 아래 넷은 모두 올바른 코드다.**

1. **`assemble.ts:71`(`imageMin: Math.max(0, minCount)`) — 버그 아님.** 70행의 의도 주석("확보된 장수가 하한보다 적어도 플랜은 하한을 그대로 알려 준다")은 정확하고 기능적으로 필요하다. 빈 `imagePaths`와 함께 하한을 보고하는 것이 이 상태를 하류에 드러내는 유일한 신호다. `imagePaths.length`로 clamp하면 그 신호가 사라지고 **이미지 없는 섹션이 조용히 발행된다.**
2. **`validate.ts`의 IMAGE_SHORTFALL 발행 — 버그 아님.** `spec.imagePlan.shortfall > 0`이면 반드시 올린다. 발행 로직은 옳고, 다만 너무 낮은 값을 먹고 있을 뿐이다.
3. **`index.ts:199-202`의 `[0,1]`→`[1,1]` 승격 — 버그 아님이며 제거하면 오히려 나빠진다.** 이것은 `src/lib/post-composition-contract.ts:106-110`의 `sectionImageBounds()`(`min: max > 0 ? Math.max(1, min) : min`)를 의도적으로 미러링한다. `assemble.ts:72`가 `[0,1]` 섹션에도 `imageMax=1`을 주므로 승격이 없어도 하류 요구는 그대로 존재한다. 실제로 `resolved=6`에서 승격을 빼면 두 번째 그리디 패스가 여유 이미지 2장을 `product-reveal`/`benefit`에 몰아주고 `offer-check`와 `fit-checklist`가 **둘 다** 비어(0개 → 2개 결손) 상태가 악화된다. 승격은 수정이다.
4. **`repair.ts:10`의 IMAGE_SHORTFALL 수리 불가 — 결함 아니라 설계다.** `repairableTargets()`가 이를 걸러내므로 `index.ts:307-308`의 루프가 첫 회에 즉시 break한다(무한 대기 없음). 대상 자신의 지시문("재생성으로 해결되지 않음")이 사실이다 — 문장을 다시 써서 이미지를 만들어낼 수는 없다. **데이터 가용성 게이트가 수리 불가한 P0인 것은 올바른 형태이며, 문제는 그 게이트가 발동해야 할 두 경우에 발동하지 않는다는 것뿐이다.**

**수정 방향.** `shortfall`이 레이아웃의 실제 요구량을 재게 한다. `assignImageSlots`가 이미 받고 있는 `sections`(그 `imageCount`는 `index.ts:220`에서 넘어온 승격 후 값)를 쓰면 된다.

```ts
const requiredSlots = sections.reduce((sum, section) => sum + section.imageCount[0], 0);
// ...
shortfall: Math.max(0, Math.max(minBody, requiredSlots) - resolvedBody)
```

이러면 `validate.ts:222`가 생성 비용을 지불하기 **전에** 정확한 사유("본문 이미지 4장 (최소 5장)")로 IMAGE_SHORTFALL을 P0 BLOCKED로 올린다. `requiredSlots`를 `ImagePlan`에 노출해 어떤 섹션이 비었는지 이름을 대주면 더 낫다. `index.ts:177`의 섹션 수 임계값을 조여 `sum(min)`이 `resolved`를 넘지 못하게 하는 것은 **보완이지 대체가 아니다** — IMAGE_SHORTFALL 게이트 전체가 키로 삼는 값은 `image-plan.ts:281`이기 때문이다.

#### H37. Q/A 라벨을 배열 짝수/홀수로만 재부여 — `scripts/lib/post-spec/render.ts:60` (CONFIRMED)

**무엇이 잘못됐나.** `qa-3` shape에서 `normalizeLines`는 원본 줄을 `\n`으로 flatMap한 뒤, 기존 `Q./A./질문:/답변:` 표시를 제거하고 `index % 2`만으로 `Q.`/`A.`를 다시 붙인다. 모델 답변에 개행이 들어가는 일은 흔하며, 그 순간부터 뒤따르는 모든 줄의 역할이 뒤집힌다. 원래 표시는 이미 제거됐으므로 진짜 짝짓기는 복구 불가다. 검증기의 shape 검사는 줄 수를 세고 방금 붙인 접두사를 재확인할 뿐이라 뒤바뀜을 탐지할 수 없다.

**실패 시나리오.** 검증됨: `['Q. 옵션은 어떻게 고르나요?', 'A. 주문 화면의 옵션 표를 비교하세요.\n구성 차이가 가격 차이로 이어집니다.', 'Q. 배송 조건은요?', 'A. 판매 페이지 안내가 기준입니다.']`가 `['Q. 옵션은 …', 'A. 주문 화면의 …', 'Q. 구성 차이가 가격 차이로 이어집니다.', 'A. 배송 조건은요?', 'Q. 판매 페이지 안내가 기준입니다.']`가 된다. 서술형 답변이 질문으로, 질문이 답변으로 블로그에 발행된다. 평탄화 후 줄 수가 6이 되면 shape 검사까지 통과해 훼손된 FAQ가 그대로 나간다.

**수정 방향.** 위치가 아니라 내용으로 짝짓는다. 모델이 붙인 `Q./A.` 표시가 있으면 유지하고, qa-3에서는 `\n`으로 flatMap하는 대신 연속 줄을 앞 항목에 다시 이어 붙인다. 표시가 전혀 없을 때만 패리티 라벨링으로 폴백한다.

#### H38. 페이드 마스크가 PNG 버퍼인데 raw 알파로 읽힘 — `scripts/lib/product-thumbnail.ts:559` (CONFIRMED)

**무엇이 잘못됐나.** `sharp(mask).extractChannel("alpha").toBuffer()`를 출력 포맷 지정 없이 호출한다(`.raw()` 없음 — 직접 재확인). SVG는 쓸 수 없으므로 PNG로 폴백되어, 반환 버퍼는 width*height 개의 raw 알파 샘플이 아니라 압축된 PNG 파일이다. `buildHeroLayer`(658/671행)는 이를 `rgba[rgbaIndex + 3] = alpha[index] ?? 255`로 raw처럼 인덱싱한다. 실제 hero 크기(868x836 = 725,648픽셀)에서 버퍼는 7,187바이트뿐이라 718,461픽셀이 `?? 255`로 채워지고 앞쪽 7,187픽셀은 PNG 헤더/IDAT 바이트를 알파값으로 받는다. `PRODUCT_THUMBNAIL_CLEAN_CUTOUT_ENABLED`가 꺼진 기본 상태에서 모든 쇼핑 썸네일이 이 경로를 탄다.

**실패 시나리오.** 어떤 상품 사진으로 SHOPPING 썸네일을 만들어도 좌측 페이드가 렌더되지 않아 hero 사진이 어두운 텍스트 패널과 수직 경계선으로 맞닿고, hero 상단 약 8행이 무작위 반투명/투명 픽셀 밴드로 나온다. 로컬 합성된 모든 쇼핑 썸네일이 이 아티팩트를 안고 발행된다.

**수정 방향.** 파일이 아니라 픽셀을 요청한다: `return sharp(mask).extractChannel("alpha").raw().toBuffer();`(`buildCleanProductAlpha`는 이미 `.raw()`를 쓴다). 루프 전에 `alpha.length === width * height`를 단언해 이후 포맷 회귀 시 조용히 알파 255로 떨어지지 않고 즉시 실패하게 한다.

#### H39. EXIF 회전 전 치수로 품질 게이트 판정 — `scripts/lib/travel-image-quality.ts:26` (CONFIRMED)

**무엇이 잘못됐나.** `sharp(imagePath).rotate()` 후 `metadata()`를 읽는데, sharp의 metadata는 자동 방향 적용값이 아니라 *저장된* 치수를 보고한다(설치된 sharp 0.35.4에서 확인: 회전 결과가 1400x700인 파일에 대해 700x1400 반환, 방향 적용 크기는 `metadata.autoOrient`로만 노출). 27-36행의 해상도 게이트와 화면비 게이트가 잘못된 숫자에 적용된다.

**실패 시나리오.** EXIF 방향 6으로 700x1400로 저장된 1400x700 가로 여행 사진(폰 카메라에서 일상적). width=700이라 "해상도 부족", ratio=0.5라 "본문에 부적합한 화면비"가 붙어 점수가 54로 떨어지고 pass=false가 된다. `scripts/simple-agent.ts:828`이 "여행 이미지 QC 제외"를 로깅하며 멀쩡한 사진을 본문에서 제거한다.

**수정 방향.** 방향이 적용된 크기를 읽는다. `sharp(imagePath, { autoOrient: true })`로 생성하거나 `metadata.autoOrient.width/height`를 사용해 width/height/pixels/ratio를 계산한다.

#### H40. `ad` 부분 문자열 매칭으로 정상 상품 이미지 폐기 — `scripts/lib/product-image-selection.ts:23` (CONFIRMED)

**무엇이 잘못됐나.** 나쁜 이미지 키워드 정규식의 `...|event|ads?|detail|...` 대안에 단어 경계가 없어 "ad"가 URL 어디에서든 매치된다(직접 재확인). `keywordHaystack`은 `decodeURIComponent(rawUrl)`까지 덧붙여 노출을 두 배로 만든다. 재현: `.../upload_1705289012_1.jpg` → true, `.../17052890a1b2_download.jpg` → true, `.../1705289ad0123_MTIzNDU2/main.jpg` → true. 목록의 다른 모든 대안(icon, logo, banner, coupon …)은 온전한 단어이므로 "ad"도 단어로 의도된 것이 분명하다.

**실패 시나리오.** 경로에 `upload`/`download`가 들어간 판매자 업로드 CDN URL, 또는 해시 구간에 우연히 "ad" 두 글자가 있는 URL이 `containsBadImageKeyword`에서 true가 되어 후보에서 통째로 제거된다. 그것이 대표 상품 이미지였다면 `generateProductThumbnail`이 빈 `imagePaths`를 받아 null을 반환하고, 글이 썸네일 없이 발행된다.

**수정 방향.** 토큰을 고정한다(예: 대안 안에서 `(?:^|[^a-z])ads?(?![a-z])`). 또는 URL을 `[^a-z0-9]+`로 분할해 세그먼트 단위로 키워드 집합과 대조하고, 전체 URL에 대한 단일 부분 문자열 정규식은 폐기한다.

#### H41. 흑백 차분 해시가 색상 변형을 동일 이미지로 판정 — `scripts/lib/image-dedup.ts:25` (PLAUSIBLE)

**무엇이 잘못됐나.** `differenceHash`가 해싱 전에 `.greyscale()`을 적용하고 가로로 인접한 휘도 샘플만 비교한다. 형태와 배치가 같고 색상만 다른 두 이미지는, 색조 변경이 어떤 가로 휘도 계단의 부호도 뒤집지 않는 한 바이트 단위로 동일한 해시를 만든다. 재현: 동일한 흰 배경에 중앙 300x300 블록만 `#3355aa`/`#aa3355`로 다른 800x800 이미지 두 장의 해밍 거리가 0이며, 이는 `scripts/simple-agent.ts:904`가 넘기는 임계값 5 이하다.

**실패 시나리오.** 동일 스튜디오 배경에서 검정/네이비/빨강으로 찍은 상품 갤러리에서 `deduplicateImagePaths`가 첫 장만 남기고 나머지를 `reason: "perceptual", distance: 0`으로 보고한다. "동일·유사 이미지 2장 제외"가 로깅되고, 독자가 가장 보고 싶어 하는 색상 변형 컷을 버린 채 본문 이미지 수가 상한에 못 미치는 글이 발행된다.

**수정 방향.** 색상 정보도 해싱한다. 채널별 64비트 dHash를 계산해 모든 채널이 임계값 이내일 때만 중복으로 보거나(또는 색조/채도 축소본 사용), 지각적 중복 선언 전에 평균 RGB 거리 검사를 추가한다.

### 4.7 레거시 코드모드·UI (H42–H43)

#### H42. 루트 코드모드 3종이 현재 소스를 개변 — `update-content.js:179`, `refactor-content.js:115`, `refactor-image.js:77` (CONFIRMED)

**무엇이 잘못됐나.** 세 스크립트 모두 `scripts/topic-agent.ts`의 현재 앵커(`async function generateAdvancedContent(`, `async function openEditor(`, 이미지 파이프라인 배너와 콘솔 로그)에 여전히 매치되므로 가드 절이 발동하지 않고 파일을 제자리에서 덮어쓴다. `update-content.js`는 현재 저장소에 존재하지 않는 식별자를 참조하는 구세대 구현으로 122줄을 교체하고, `refactor-content.js`는 같은 122줄을 다른 프로토타입으로 되돌리면서 `ALLOW_CHATGPT_BROWSER_MODE` 가드를 진입점에서 제거하며, `refactor-image.js`는 72줄을 잘라내고 ts-node CommonJS 환경에서 해석되지 않는 `await import("./lib/chatgpt-browser.js")`를 주입한다(게다가 62-65행의 첫 `content.replace`는 가드 이전에 무조건 실행된다). 세 파일 모두 ESM 문법이지만 Node 22의 자동 모듈 감지로 `node <file>`이 그대로 실행된다.

**실패 시나리오.** 저장소 루트에서 `node update-content.js`(또는 나머지 둘)를 실행하면 초안 생성 함수가 존재하지 않는 식별자를 부르도록 바뀌어 CI의 Typecheck가 "Cannot find name" 오류로 실패하고, 브라우저 자동화를 옵트인으로 유지하던 안전장치가 조용히 사라지며, 이미지 생성 블록은 런타임 MODULE_NOT_FOUND로 실패해 이미지 없는 글이 발행된다.

**수정 방향.** 세 파일을 삭제한다(이미 적용 완료된 일회성 마이그레이션이다). C6의 `fix-topic-agent.js`, M56의 `add-image-downloader.js`, L30/L31의 나머지 죽은 파일들과 함께 한 커밋으로 정리하고 `eslint.config.mjs`의 예외 블록도 제거한다. **이 정리는 §0에서 확인한 lint 적자(34 errors)도 함께 줄인다.**

#### H43. 주제 발행 busy 플래그가 즉시 해제됨 — `src/app/page.tsx:820` (CONFIRMED)

**무엇이 잘못됐나.** 820-830행 효과가 해당 task의 상태가 정확히 `"PUBLISHING"`이 아닐 때마다 `topicPublishingId`를 지운다. `startTopicPublish`는 핸들러 첫머리에서 동기적으로 id를 설정한 뒤 POST를 await하는데, React는 네트워크 왕복보다 훨씬 먼저 이 효과를 flush한다. 그 시점의 `topicTasks`는 여전히 발행 전 스냅샷(`"PREPARED"`)이므로 효과가 곧바로 null로 되돌린다. 형제 효과인 브랜드링크 쪽(808-818행)은 종결 상태에서만 해제해 이를 올바르게 처리한다. 더 중요한 것은 `getBusyMessage()`가 주제 발행과 브랜드링크 bulk 흐름 사이의 **유일한** 직렬화 장치라는 점이다 — 두 주제 발행 라우트는 `topic-agent.ts`를 detached로 띄우면서 `beginAutomaticPublishing`을 호출하지 않으므로 서버 측 가드도 없다.

**실패 시나리오.** 사용자가 PREPARED task에서 즉시 발행을 누른다. 플래그가 같은 커밋에서 해제돼 "발행 중" 표시가 뜨지 않고 버튼이 다시 활성화된다. 사용자가 상품 리뷰 탭으로 옮겨 "바로발행"을 누르면 `getBusyMessage()`가 null이라 진행되고, 주제 실행이 활동 등록을 하지 않았으므로 `beginAutomaticPublishing`도 성공한다. **두 개의 detached 스크립트가 동일한 로그인 세션의 네이버 에디터를 동시에 조작해** 입력이 뒤섞인 글이 만들어지거나 양쪽 모두 포커스·내비게이션 상실로 실패한다.

**수정 방향.** 브랜드링크 효과를 그대로 따라 종결 상태에서만 해제한다(`["PUBLISHED","FAILED","SCHEDULED"].includes(current.status)`). 별개로 주제 발행 라우트에서 `beginAutomaticPublishing`을 등록해 이 가드가 클라이언트 상태에 의존하지 않게 한다(M-publish-mutex와 함께 처리).

### 4.8 테스트 하네스·CI (H44–H49)

#### H44. `tsx`가 어떤 의존성에도 없음 — `package.json:27`(외 19, 24, 56행) (CONFIRMED)

**무엇이 잘못됐나 (직접 재확인).** `test:draft-ui`, `test:osaka-audit`, `test:mcp-contract`, `test:fixed-draft-settings`가 맨 `tsx` 바이너리를 호출하는데, **`tsx`는 루트 `package.json`의 `dependencies`에도 `devDependencies`에도 없고, 클린 `npm install` 후 `node_modules/.bin`에도 없다.** 선언은 `apps/site/package.json:10`에만 있고 그 워크스페이스는 루트에서 설치되지 않는다. 실행 확인: `npm run test:mcp-contract` → `sh: 1: tsx: not found`.

**실패 시나리오.** 클린 클론 후 `npm ci`, 이어서 위 스크립트를 돌리면 exit 127이다. 결과적으로 발행 승인 차단 게이트 테스트(`src/app/draft-approval-ui.test.ts`)와 MCP 상품 목록 계약 테스트(`src/lib/brandlink-product-list.test.ts`)에는 실행 가능한 진입점이 아예 없고, `test:osaka-audit`은 첫 명령에서 중단돼 뒤따르는 두 스크립트도 실행되지 않는다. `test:fixed-draft-settings`는 하필 **Codex 고정 정책을 지키는 테스트**인데(H26·L39와 직결) 역시 실행 불가다. CI가 이 넷을 돌리지 않아 파손이 영구히 발견되지 않는다.

**수정 방향.** 루트 devDependencies에 `tsx`를 추가하거나(`apps/site`와 동일 버전), 네 스크립트를 나머지 47개처럼 `ts-node --project tsconfig.scripts.json`으로 바꾼다. 그리고 최소한 `test:draft-ui`, `test:mcp-contract`, `test:fixed-draft-settings`를 CI Unit checks에 넣어 러너가 다시 조용히 사라지지 못하게 한다.

#### H45. CI가 56개 중 19개만 실행하며 인증 회귀 테스트가 빠져 있음 — `.github/workflows/ci.yml:48` (CONFIRMED)

**무엇이 잘못됐나.** Unit checks 스텝이 19개의 `npm run test:*` 호출을 하드코딩한다. 선언된 테스트 스크립트 중 37개는 어떤 워크플로에서도 실행되지 않으며, 빠진 것 중에 보안 관련이 몰려 있다 — `test:api-auth`(Origin/Referer/Sec-Fetch-Site 헤더로 `ADMIN_API_KEY`를 우회할 수 없음, 외부 출처 세션 쿠키를 CSRF로 거절함, 패키징 앱의 실제 수신 Host 사용을 단언), `test:mcp-activation`, `test:mcp-delivery`, `test:post-composition`, `test:naver-schedule-submission`, `test:bulk-schedule-plan`, `test:image-timeouts`, `test:auto-update`, `test:fixed-draft-settings`. 로컬에서 `test:api-auth`와 `test:mcp-delivery`를 실행하면 둘 다 통과한다 — CI가 돌리지 않을 뿐 정상 동작하는 테스트다.

**같은 파일의 lint 스텝도 같은 병(직접 재확인).** lint는 `src` + 명시한 파일 14개만 대상으로 한다(14개 모두 존재). 저장소 전체가 아니므로 `.cjs` 파일들의 `no-require-imports` 위반 34건이 CI에 보이지 않는다. **로컬 `npm run lint`는 빨간불, CI는 초록불**이라는 상태가 상시화돼 있다.

**실패 시나리오.** `src/lib/api-auth.ts`나 `src/lib/local-request-auth.ts`에서 맨 `origin` 헤더를 동일 출처 증거로 다시 받아들이는 변경(`verify-api-auth.ts:38-41`이 고정하려던 바로 그 버그)이 typecheck·lint·19개 유닛 검사를 모두 통과하고 그린으로 머지된다. 그 결과 `/api/posting/stop`과 `/api/system/control`이 사용자가 방문한 임의 페이지에서 도달 가능해진다.

**수정 방향.** 하드코딩된 19줄 목록을 모든 `test:*` 스크립트를 순회하는 루프로 바꾸거나, 최소한 `test:api-auth`, `test:mcp-delivery`, `test:post-composition`, `test:naver-schedule-submission`, `test:bulk-schedule-plan`, `test:fixed-draft-settings`를 추가한다. lint 대상도 경로 목록이 아닌 저장소 전체로 바꾸고, `eslint.config.mjs`가 `.cjs`를 면제하도록 정리해 로컬과 CI가 같은 결과를 내게 한다. 이후 스크립트 제외는 "잊어버리는 것"이 아니라 "삭제하는 것"이어야 한다.

#### H46. `apps/sites` 테스트가 어디서도 실행되지 않음 — `apps/sites/package.json:7`, `.github/workflows/ci.yml:95` (CONFIRMED)

**무엇이 잘못됐나.** `apps/sites/package.json`의 scripts 블록(7-15행)에는 dev/build/start/lint/db:generate/installer:upload/update:publish/update:verify가 있고 **`test` 항목이 없다.** CI의 `sites` 잡(77-99행)은 `npm ci`, `npx tsc --noEmit`, `npm run lint` 세 가지만 한다. `apps/sites/tests/bug-reports.test.cjs`와 `apps/sites/tests/mcp-job-transport.test.cjs`를 가리키는 곳은 저장소 전체에서 루트 `package.json:18`의 `test:mcp-delivery` glob 하나뿐이고, 어떤 워크플로도 그것을 호출하지 않는다. 로컬 실행 결과 **22개 테스트가 4.4초에 통과한다 — 그리고 그중 어느 것도 CI에서 돌지 않는다.**

**무엇을 지키고 있었나.** `bug-reports.test.cjs:31-37`은 `redactReport()`의 유일한 가드로, `Authorization: Bearer`, `api_key`, `NID_AUT=` 네이버 세션 쿠키, 비공개 `https://host/api/mcp/<secret>` URL, 로컬 Windows 사용자명, 이메일, 전화번호가 저장 전에 제거되는지를 단언한다. `mcp-job-transport.test.cjs`는 `POST_PUBLISH: actual poll timeout and late heartbeat never replay execution`과 재시작 후 아웃박스 프라이버시 fail-closed를 단언한다.

**실패 시나리오.** 누군가 `apps/sites/lib/bug-reports.ts`를 수정하다 `NID_AUT=`나 `api_key` 마스킹 정규식이 더 이상 매치되지 않게 만든다. typecheck와 lint는 통과하고 `sites` 잡은 그린, `check` 잡은 apps/sites를 건드리지 않아 변경이 머지된다. 이후 사용자의 네이버 세션 쿠키와 MCP 자격증명 URL이 그대로 `bug_reports` 테이블에 저장되고 운영자에게 전달된다. 다른 변형: 잡 전송 리플레이 가드가 깨져 늦은 하트비트가 완료된 `POST_PUBLISH`를 재실행해 같은 글이 두 번 발행된다.

**수정 방향.** `apps/sites/package.json`에 `"test": "node --test tests/*.test.cjs"`를 추가하고 `sites` 잡의 Lint 스텝 뒤(ci.yml:98)에 Test 스텝을 넣는다. 아울러 루트 Unit checks에 `npm run test:mcp-delivery`를 추가해 `src/lib/remote-agent-completion.test.cjs`도 커버한다.

#### H47. 자동 발행 라우트 회귀 테스트가 고아 — `scripts/verify-auto-publish-route.cjs:1` (CONFIRMED)

**무엇이 잘못됐나.** 이 63줄 스크립트는 `src/app/api/brandlinks/[id]/auto-publish/route.ts`를 vm 샌드박스에서 트랜스파일해 **`requireAdminApiKey` 거절(403), 예약일 검증, 중복 잡 거절, 비동기 완료, `automaticPublishingCancellationCheck`를 통한 취소, 잡 미존재 처리**를 단언한다. `package.json` 어디에도 없고 `.github/workflows/*.yml` 어디에도 없다. 저장소 전체에서 유일한 언급은 QA 로그 한 줄(`docs/qa/2026-09-07-automatic-publishing.md:19`)이다. 직접 실행하면 오늘도 통과한다.

**실패 시나리오.** 누군가 이 라우트를 리팩터링하며 `requireAdminApiKey(req)` 조기 반환을 빠뜨리거나 `brandLink.count()` 중복 검사를 바꾼다. tsc·eslint·19개 CI 유닛 검사가 전부 통과하고 머지된다. `ADMIN_API_KEY`를 설정한 서버에서 무인증 호출자가 `POST /api/brandlinks/<id>/auto-publish`로 실제 네이버 발행을 시작할 수 있게 된다 — **이 파일이 단언하던 바로 그것**이며, CI는 한 번도 실행한 적이 없다. H10이 서술한 최고위험 라우트가 회귀 보호를 전혀 못 받고 있다는 뜻이다.

**수정 방향.** `"test:auto-publish-route": "node scripts/verify-auto-publish-route.cjs"`를 `package.json`에 추가하고 `.github/workflows/ci.yml:48-67`의 Unit checks 목록에 넣는다.

#### H48. 예약/자동 초안 워크플로 회귀 테스트가 고아 — `scripts/verify-scheduled-draft-workflow.ts:1` (CONFIRMED)

**무엇이 잘못됐나.** 이 106줄 스크립트는 `scripts/lib/scheduled-draft-workflow.ts`의 `runScheduledDraftWorkflow`/`runAutomaticDraftWorkflow`를 실행한다 — `scripts/bulk-today-publish.ts:117`과 `bulk-schedule-publish.ts`가 구동하는 바로 그 엔진이며, H47의 테스트는 이 부분을 목으로 대체한다. 단언 항목은 **즉시/예약 종결 상태, 120회 pending 폴링 상한, 정확히 한 번의 `/publish` 호출, 준비된 글 우선순위, 이미지 순서, 수리 횟수 상한, 취소·활동 가드**다. `package.json`과 워크플로 어디에도 없고 언급은 `docs/qa/2026-09-07-automatic-publishing.md:18` 한 줄뿐이다. 직접 실행하면 통과한다.

**실패 시나리오.** `scheduled-draft-workflow.ts` 변경이 폴링 상한이나 "정확히 한 번의 publish 호출" 보장을 제거한다. CI는 아무것도 눈치채지 못한다. 이후 bulk 실행이 종결되지 않는 잡을 영원히 폴링하며 멈추거나, 같은 brandLink에 `/publish`를 두 번 호출해 **사용자 블로그에 중복 글이 생긴다.**

**수정 방향.** `"test:scheduled-draft-workflow": "npx tsx scripts/verify-scheduled-draft-workflow.ts"`를 추가하고 CI Unit checks에 넣는다(H44의 `tsx` 문제를 먼저 해결하거나 `ts-node`로 배선한다).

#### H49. 호스트 스푸핑 가드 테스트가 고아 — `scripts/verify-connect-routing-regression.ts:9` (CONFIRMED)

**무엇이 잘못됐나.** 7-11행은 `assertConnectUrlKind`(`src/lib/brandconnect-kind.ts`)가 `https://brandconnect.naver.com.evil.test/123/affiliate`에 대해 `CONNECT_URL_INVALID`를, 쇼핑/여행 URL 교차에 대해 `CONNECT_KIND_URL_MISMATCH`를 던지는지, 그리고 `getConfiguredConnectUrl`로 읽을 때 `BRANDCONNECT_SHOPPING_CATEGORY_URL`이 검증되는지를 단언하는 **저장소 유일의 지점**이다. `package.json`과 모든 워크플로에 없다. 직접 실행하면 통과한다.

**실패 시나리오.** `src/lib/brandconnect-kind.ts` 리팩터링이 정확한 호스트 일치 검사를 `hostname.includes('brandconnect.naver.com')`로 바꾼다. tsc·eslint·배선된 CI 검사가 전부 통과한다. 이후 사용자(또는 `BRANDCONNECT_SHOPPING_CATEGORY_URL`로 공급된 값)가 Playwright 자동화를 로그인된 네이버 세션째로 `brandconnect.naver.com.evil.test`로 이동시킬 수 있게 되어 그 호스트에 세션 쿠키와 동작을 넘긴다.

**수정 방향.** `"test:connect-routing": "npx tsx scripts/verify-connect-routing-regression.ts"`를 추가하고 기존 `test:connect-detection`/`test:connect-store` 옆에 CI 배선한다.

---

## 5. MEDIUM 요약 (74건 / 71행)

2차에서 추가된 항목은 **[2차]**로 표시했다. 1차의 `src/app/api/brandlinks/route.ts:62`(무가드 GET)와 `src/lib/codex-local.ts:128`(로그인 잡 무기한)은 각각 H2·H25로 상향돼 이 표에서 빠졌다.

| 영역 | 파일:라인 | 문제 | 한 줄 수정 |
|---|---|---|---|
| pipeline-core | `src/services/scheduler.ts:103` | claim 없이 RUNNING 전환, 중첩 실행 시 중복 발행 (PLAUSIBLE) | `updateMany({where:{id,status:"PENDING"}})`로 원자적 claim 후 count 0이면 반환 |
| pipeline-core | `src/services/topic-task-pipeline.ts:3589` | 20분 prepare 락에 하트비트가 없어 실행 중인 준비에서 탈취됨 (`PREPARE_LOCK_STALE_MS = 20 * 60 * 1000`, 67행). prepare 라우트가 요청 안에서 인라인 await하므로 긴 실행이 정확히 이 창에 걸린다 [2차 보강] | 실행 중 1분 주기로 락 mtime 갱신, stale 탈취 전에 기록된 pid 생존 확인 |
| pipeline-core | `src/services/topic-task-pipeline.ts:3854` | `withTimeout`이 자식을 죽이지 않아 Chromium 프로필 락 고아 | `execFileAsync`에 `timeout`/`killSignal` 전달, curl에 `--max-time` |
| pipeline-core | `src/services/topic-task-pipeline.ts:2333` | 비 JSON 응답에 `JSON.parse`가 폴백 경로 전체를 건너뜀 | parse를 try/catch로 감싸고 기존 `valid.length === 0` 폴백으로 흘려보냄 |
| pipeline-core | `src/services/topic-task-pipeline.ts:1197` | `params.keyword` + 하드코딩 "를"로 비문 생성 | `withObjectParticle(keyword)`로 교체 |
| pipeline-core | `src/services/topic-task-pipeline.ts:2685` | stdin EPIPE 리스너 부재로 프로세스 전체 종료 (PLAUSIBLE) | `proc.stdin.on("error", …)` 부착, `CODEX_BIN` 기본값을 PATH 해석으로 |
| pipeline-core | `src/app/api/schedule/cron/route.ts:17` | 크론 정리가 파이프라인 이미지 루트를 재귀 삭제 | 파이프라인 루트를 스윕에서 제외하고 draft 단위로만 정리, `_locks` 보존 |
| api-brandlinks | `src/app/api/brandlinks/[id]/publish/route.ts:200` | 행 단위 상태가 유일한 발행 뮤텍스라 두 발행이 같은 네이버 계정을 동시 조작. `super-publish`는 `beginAutomaticPublishing`을 아예 호출하지 않음 [2차] | 모든 실발행(brandlinks/topic-task/super-publish)을 `beginAutomaticPublishing` 한 곳으로 통과시킴 |
| api-rest | `src/app/api/codex/route.ts:19` | POST가 CSRF 가드·호출자 제한 없이 로그인 서브프로세스를 스폰해 사용자 데스크톱에 브라우저 창을 띄움. 본문을 읽지 않아 빈 폼 POST로도 도달. `loginJobs`가 `globalThis`가 아닌 모듈 레벨이라 dev 리로드 시 자식 고아화 [2차] | POST에 `requireTrustedLocalMutation` 추가, `loginJobs`를 `globalThis`로 이전 |
| auth-secrets | `src/app/api/admin-session/route.ts:33` | 관리자 키 검증에 레이트리밋·잠금이 없고, `safeCompare`의 길이 사전검사로 길이가 관측됨. 성공 시 30일 세션 쿠키 (PLAUSIBLE) [2차] | 출처별 실패 카운터 + 지수 백오프·일시 잠금, 고정 길이 다이제스트 비교 |
| auth-secrets | `src/lib/remote-site.ts:41` | 미문서화 `REMOTE_SITE_ALLOWLIST` 검사가 `if (url.protocol === "https:")` 블록 **밖**에 있어 http 출처도 허용 [2차] | 검사를 https 분기 안으로 옮기거나 조건에 프로토콜 추가, `.env.example`에 문서화 |
| codex-draft-path | `scripts/simple-agent.ts:4574` | 브라우저 폴백이 다른 엔진으로 조용히 대체되는데 저장된 provenance는 `aiProvider: "codex"` 유지. 매니페스트에는 provider 필드 자체가 없음 [2차] | `generateWithAI`가 실제 사용 엔진을 반환하게 하고 매니페스트·`saveGeneratedPostPreview`·`packagePreview`에 기록 |
| codex-draft-path | `src/app/api/brandlinks/[id]/publish/route.ts:231` | 발행 라우트가 `CODEX_DRAFT_ENABLED`를 무시하고 `AI_PROVIDER`를 JSON 핀에서 그대로 전달. 핀 오타 시 `simple-agent.ts:208`이 조용히 `openai`로 좁혀 사용 불가 상태로 발행 시작(행은 이미 PUBLISHING) [2차] | `useCodex`를 `CODEX_DRAFT_ENABLED`로도 게이트, `AI_PROVIDER: useCodex ? "codex" : "openai"`로 명시, 핀 값을 로드 시 검증 |
| codex-draft-path | `src/lib/codex-local.ts:108` | 270MB 바이너리를 `spawnSync`로 실행해 Electron 메인 스레드를 블록. 로그인 중 2초 간격 폴링으로 최대 10분간 반복(최대 약 300회) [2차 보강] | `execFile` 비동기로 전환하고 수 초간 결과 캐시, `exit` 핸들러(159행) 안에서는 호출 금지 |
| topic-workflow | `src/lib/topic-workflow.ts:982` | URL 끝 `)`를 무조건 절단 | 괄호 균형을 확인해 불균형일 때만 트림 |
| topic-workflow | `src/lib/topic-workflow.ts:977` | 정규식 결과와 콤마 분할 결과 합집합으로 잘린 중복 URL 생성 | 정규식 매치가 있으면 그것만 사용 |
| topic-workflow | `src/lib/topic-workflow.ts:1377` | 404/오류 페이지·바이너리를 연구 근거로 저장 | `!response.ok`면 오류로 기록, content-type 검사와 본문 크기 상한 추가 |
| topic-workflow | `src/lib/topic-workflow.ts:1673` | lazy 중괄호 정규식이 중첩 객체를 잘못 반환 (PLAUSIBLE) | `TOPIC_OUTPUT_JSON_BLOCK_RE` 제거하고 균형 블록을 직접 파싱 |
| lib-contracts | `src/lib/connect-contract-store.ts:129` | 비원자적 쓰기로 동시 읽기가 "계약 미캡처"로 오판 | `.tmp` + `renameSync`로 교체 |
| lib-brandpost | `src/lib/brand-post-package.ts:559` | catch-all stat 실패를 파일 없음으로 보고 삭제를 영속화 | ENOENT/ENOTDIR만 없음으로 처리, 그 외는 재던지거나 저장 생략 |
| lib-brandpost | `src/lib/run-script.ts:86` | SIGTERM 1회 후 에스컬레이션·트리 종료·독립 정착 경로 없음 | SIGKILL(Windows는 `taskkill /T /F`) 타이머 추가, `detached` 스폰 후 그룹 종료 |
| lib-brandpost | `src/lib/run-script.ts:89` | stdout/stderr 무제한 누적으로 OOM 위험 (PLAUSIBLE) | 이미지 배치 러너처럼 상한 + 오버플로 플래그 적용 |
| lib-brandpost | `src/lib/travel-connect-adapter.ts:321` | content-length 없는 응답이 크기 가드를 우회 | 바이트 단위 상한으로 본문을 읽고 `fetchContractFeed`에도 동일 적용 |
| api-brandlinks | `src/app/api/brandlinks/[id]/publish/route.ts:104` | 과거 날짜 보정이 서버 로컬 TZ와 예약 TZ를 혼용 | `addDaysToYmd(todayKey, 1)`로 동일 TZ에서 계산 |
| api-brandlinks | `src/app/api/brandlinks/[id]/draft/route.ts:523` | 자식 프로세스를 타임아웃 없이 await, 종료 경로 없음 (PLAUSIBLE) | 타이머와 race시키고 만료 시 `child.kill` + 상태 복구 |
| api-brandlinks | `src/app/api/brandlinks/bulk-seasonal/route.ts:338` | `waitForCompletion` 대기에 타임아웃 없고 오류 시 자식 누수 (PLAUSIBLE) | 타임아웃 + kill 추가, `beginAutomaticPublishing` 뮤텍스 사용 |
| api-brandlinks | `src/app/api/brandlinks/[id]/draft/route.ts:514` | `contextSnapshot`을 크기·형식 검증 없이 디스크에 기록 (PLAUSIBLE) | 파싱 전 본문 크기 상한, 스냅샷 스키마 검증 후 저장 |
| api-rest | `src/app/api/topic-tasks/[id]/route.ts:193` | `YYYY-MM-DD`가 아니면 `scheduledPublishAt`을 조용히 null로 | `categoryNo`처럼 파싱 실패 시 400, 명시적 null/""일 때만 null 기록 |
| api-rest | `src/app/api/topic-candidates/route.ts:193` | codex 경로 기본값이 특정 개발자 macOS 홈 절대경로 | PATH에서 해석하고 `CODEX_BIN`을 override로, 미존재 시 비-200 반환 |
| api-rest | `src/app/api/remote-agent/poll/route.ts:1216` | 발행 대기 루프 2곳에 기한이 없어 잡 폴러가 영구 점유 | `PUBLISH_WAIT_MS` 기준 TIMEOUT으로 이탈해 `activeJob` 해제 |
| api-rest | `src/app/api/settings/route.ts:60` | .env 재작성이 주석 전량 삭제 + 다른 기록자와 이스케이프 규칙 불일치 | 공용 read/write 헬퍼 하나로 통일하고 변경 키만 제자리 갱신 |
| auth-secrets | `apps/sites/app/api/admin/updates/windows/route.ts:29`, `:61` | 세션 인증 관리자 API에 `hasTrustedBrowserOrigin` 검사 누락 | POST/PUT 첫머리에 origin 가드 추가(업로드 키 헤더 경로는 예외), JSON content-type 강제 |
| auth-secrets / agent-scripts | `scripts/lib/local-env-file.ts:21` | serialize가 이스케이프한 값을 parse가 되돌리지 않아 페어링마다 누적 훼손 | parse에서 `\\`/`\"` 언이스케이프, 주석·빈 줄 보존 |
| simple-agent-flow | `scripts/simple-agent.ts:2953` | `newContext` 실패 시 실행된 브라우저 누수 | 2940-2952를 자체 try/catch로 감싸 `browser.close()` 후 재던짐 |
| simple-agent-flow | `scripts/simple-agent.ts:10196` | `main()`에 `.catch()` 없고 시작 구문 2개가 try 밖 | 두 구문을 try 안으로, `main().catch(...)`로 오류 보고 경로 통일 |
| simple-agent-publish | `scripts/simple-agent.ts:5973` | 셀렉터별 카운트를 합계와 비교해 이미지당 약 18초 낭비 | 셀렉터별 기준값 배열을 만들어 `some((sel,i) => count > before[i])`로 판정 |
| simple-agent-publish | `scripts/simple-agent.ts:9157` | 즉시 발행 폴백이 고정 좌표 2회 클릭 후 성공 반환 | 좌표 폴백 제거, 발행 레이어 소멸/URL 전환을 관측한 뒤에만 true |
| agent-scripts | `scripts/lib/scheduled-draft-workflow.ts:75` | 기한 없는 폴링 루프 2개가 배치 전체를 정지 | 벽시계 기한 + 최대 폴링 횟수, 만료 시 설명적 타임아웃 오류 |
| agent-scripts | `scripts/lib/chatbot-notifier.ts:85` | 알림 링크가 포트 3000을 가리킴(실제 43127). H11과 정반대 방향의 같은 불일치 | 기본 포트를 43127로, `LOCAL_APP_ORIGIN` 폴백 추가 |
| agent-scripts | `scripts/bulk-schedule-publish.ts:249` | stale id 하나가 배치 전체를 시작 전에 중단 | 부적격 id는 skipped로 기록하고 나머지 계속 진행 |
| agent-scripts | `scripts/topic-agent.ts:1338` | `ensureScheduleDateTimeFuture`가 no-op이라 과거 날짜 예약 시도 | 미래 시각 보정을 구현하거나 스텁 제거 후 사전 필터 추가 |
| agent-scripts | `scripts/review-agent.ts:10` | `dotenv/config` 미로드로 문서화된 CLI 실행이 항상 실패 | 파일 상단에 `import "dotenv/config";` 추가(`scripts/login.ts`도 동일) |
| chatgpt-browser | `scripts/lib/chatgpt-profile-lock.ts:59` | PID 재사용 시 락이 영원히 만료되지 않음 | `acquiredAt` 기준 age 만료 추가, 부팅 id/시작 시각 병기 |
| chatgpt-browser | `scripts/lib/chatgpt-browser.ts:422` | `newContext` 실패 시 Chromium 누수 + 폴백 오류 무로그 | 실패 시 `browser.close()`, 삼켜지는 오류를 로깅 |
| chatgpt-browser | `scripts/lib/chatgpt-browser.ts:443` | `navigateToChatGpt` 미사용으로 보안 확인 화면이 일반 실패로 분류 | 맨 `goto` 대신 `navigateToChatGpt` 호출 |
| chatgpt-browser | `scripts/lib/chatgpt-browser.ts:987` | 실패 시 이미 저장된 파일과 오류 메시지를 모두 폐기 | catch에서 `savedPaths` 반환 + 오류 로깅, 파일별 try 분리 |
| post-spec-engine | `scripts/lib/post-spec/evidence-ledger.ts:146` | 전용 근거가 공용 목록으로 누출돼 프롬프트가 자기모순 | 공용으로 올릴 때 Pool에서 제거하고, 어떤 항목의 exclusive든 shared에서 제외 |
| post-spec-engine | `scripts/lib/post-spec/local-template.ts:122` | 로컬 폴백이 `mustUseEvidence`를 만족할 수 없고 수리 루프가 제외 (PLAUSIBLE) | 원장을 로컬 초안 생성에 주입하거나 로컬 출처에는 EVIDENCE_UNUSED 미적용 |
| post-spec-engine | `scripts/lib/post-spec/llm-client.ts:66` | 잘린 빈 응답이 truncation으로 분류되지 않아 재시도 미발동 | `finish_reason === "length"` 검사를 빈 텍스트 검사보다 앞으로 |
| post-spec-engine | `scripts/lib/post-spec/image-plan.ts:178` | hero가 본문 슬롯에도 주입돼 중복 계수·중복 노출 (PLAUSIBLE) | hero 경로를 본문 풀에서 제외하거나 검증 시 고유 경로만 계수 |
| images-thumbnails | `scripts/lib/thumbnail-gen/qc.ts:161` | 호출 실패를 전부 `pass:true`로 처리 (PLAUSIBLE) | "검사 불가"와 "검사 통과"를 구분해 fail-closed 또는 breakdown 0 처리 |
| images-thumbnails | `scripts/lib/thumbnail-gen/generate.ts:92` | QC 탈락 시도본이 삭제되지 않고 누적 | 루프 내 비선정 시도본 삭제 또는 정리 트래커에 등록 |
| images-thumbnails | `scripts/lib/thumbnail-layout-v2.ts:234` | 반환값이 버려지는 미리보기 JPEG 4장을 매번 생성 | 호출부에서 경로를 소비·정리하거나 프로덕션 경로에서 호출 제거 |
| images-thumbnails | `scripts/lib/product-thumbnail.ts:536` | 모든 후보를 점수화한 뒤 항상 배경을 hero로 반환 | 최고 점수 이미지를 hero로 선택하거나 점수 함수 제거 |
| saas-site | `apps/sites/lib/tool-schema.ts:87` | `__proto__`가 `additionalProperties:false`와 증거 게이트를 우회 | `hasOwnProperty` 조회 + `Object.create(null)` 결과 객체, 위험 키 거절 |
| saas-site | `apps/sites/db/init.ts:31` | 런타임 스키마 초기화가 `bug_reports`를 만들지 않음 (PLAUSIBLE) | init 문장 배열에 테이블·유니크 인덱스 추가 또는 배포에 마이그레이션 적용 단계 추가 |
| legacy-dupes | `add-image-downloader.js:66` | 이미 존재하는 함수를 다시 append해 중복 정의 | 파일 삭제 |
| legacy-dupes | `apps/site/README.md:55` | 배포 검증 명령이 전부 다른 앱을 대상으로 하거나 존재하지 않음 | `apps/site` 삭제하거나 전용 스크립트 접두사 + CI 잡 추가 |
| legacy-dupes | `apps/site/src/app/api/agent/jobs/[id]/complete/route.ts:13` | 64KB 본문 상한 뒤의 1MB 검사가 도달 불가, 잡이 RUNNING 고착 | `readObject`에 maxBytes 파라미터 도입(신 앱과 동일)하거나 앱 삭제 |
| legacy-dupes | `apps/site/package.json:9` | 빌드·린트·타입체크·테스트 어디에도 없는 중복 인증/OAuth/MCP 앱 | 삭제하거나 CI에 세 번째 잡으로 편입 |
| build-config | `.github/workflows/desktop-build.yml:52` | 릴리스 빌드가 lockfile을 삭제해 배포 의존성 미고정 | lockfile 유지 + `npm ci`, 플랫폼 바이너리는 `--no-save`로 개별 설치 |
| build-config | `package.json:152` | `prisma/**/*` glob이 개발자 로컬 SQLite DB를 설치본에 포함 | glob을 `prisma/schema.prisma`로 좁히거나 `!prisma/*.db` negation 추가 |
| ui-components | `src/app/page.tsx:1357` | finally가 무조건 `publishingId`를 해제해 최신 발행을 idle로 만듦 | `setPublishingId(prev => prev === id ? null : prev)` + 루프 기한 추가 |
| ui-components | `src/app/page.tsx:1272` | 늦게 도착한 응답이 다른 링크의 미리보기를 덮어씀 | 요청 시점 id를 캡처해 `current?.brandLinkId === id`일 때만 갱신 |
| ui-components | `src/components/ActivationGate.tsx:37` | 일시적 fetch 실패를 "미활성"으로 처리해 앱 전체 언마운트 | 서버가 실제 미설정을 보고할 때만 `configured:false`, 그 외는 이전 상태 유지 |
| test-coverage | `scripts/verify-brand-post-package.ts:38` | 45개 단언이 소스 문자열 grep이라 오탐·오탈 양쪽 발생 | 실제 모듈을 임포트해 반환값을 단언, 정책 검사는 별도 lint 규칙으로 분리 |
| test-coverage | `package.json:17` | verify 스크립트 11개 + 단위 테스트 1개가 어디서도 호출되지 않음 (전수 명단은 §7) | 각각 `test:*` 스크립트 추가 후 CI 편입, 미참조 테스트 파일을 감지하는 가드 추가 |
| test-coverage | `scripts/verify-auto-update-manager.mjs:12` | `environmentKeys` 목록에 `AUTO_UPDATE_DISABLED`가 빠져 있어 그 값이 설정된 머신에서 테스트가 존재하지 않는 버그를 보고하며 실패. 반대로 이 토글이 실제로 업데이터를 끄는지는 아무도 검증하지 않음 [2차] | 12-21행 배열에 `AUTO_UPDATE_DISABLED` 추가 + 98행에서 delete, `'1'`이면 state가 `disabled`인지 단언 |
| test-coverage | `src/lib/topic-workflow.ts:1` | 약 2,965줄 주제 발행 서브시스템 커버리지 0 | 순수 모듈 2개(readiness)부터 `verify-topic-task-readiness.ts` 추가 후 CI 편입 |
| build-config / docs | `.env.example:154` | 아무 코드도 읽지 않는 ChatGPT 토글 5개를 문서화(`CHATGPT_GPT_URL`, `CHATGPT_FORCE_NEW_CHAT`, `CHATGPT_GUIDED_MODE`, `CHATGPT_GUIDED_MAX_TURNS`, `CHATGPT_DEFAULT_SUBTITLE_COUNT`). 특히 142-143행이 보안 확인 대응책으로 `CHATGPT_FORCE_NEW_CHAT=true`를 **권장**하는데 no-op [2차] | 72, 146-147, 153-154, 156-157, 162-163행 삭제, 142-143행 권장 문구 정정 |
| build-config / docs | `scripts/simple-agent.ts:367` | 발행 결과를 바꾸는 토글 다수가 `.env.example`에 없음. 특히 `BRANDLINK_EXPERIENCE_MODE=VERIFIED_EXPERIENCE`는 협찬 글이 **직접 사용했다고 주장**하게 만듦 (PLAUSIBLE) [2차] (전수는 §8) | 코드 기본값과 한 줄 설명을 붙여 `.env.example`에 추가 |

---

## 6. LOW 요약 (45건 / 44행)

| 영역 | 파일:라인 | 문제 | 한 줄 수정 |
|---|---|---|---|
| pipeline-core | `src/services/topic-task-pipeline.ts:4762` | 실패 경로의 task 업데이트가 원래 오류를 가림 | `updateMany` 사용 또는 `.catch(() => {})` 부착 |
| topic-workflow | `src/lib/topic-workflow.ts:1122` | `TOPIC_AUTO_RESEARCH_MAX_SOURCES=0`이 4로 바뀜 | 먼저 파싱 후 유한성 검사, 0을 유효값으로 허용 |
| lib-contracts | `src/lib/kst.ts:18` | 임포터가 없어 이 파일이 고치려던 UTC 밀림 버그가 잔존 (PLAUSIBLE) | 스케줄 스크립트가 `kstWallClockToInstant`/`formatKstYmd`를 쓰도록 배선 |
| lib-brandpost | `src/lib/brand-post-package.ts:384` | 매니페스트 읽기마다 hero 이미지를 base64 인코딩 (PLAUSIBLE) | 슬롯 계산을 프리뷰 생성과 분리하거나 스킵 옵션 추가 |
| lib-brandpost | `src/lib/brand-post-image-generation.ts:637` | 호출마다 mkdtemp 작업 디렉터리를 만들고 삭제하지 않음 | 합성본 복사 후 finally에서 작업 디렉터리 제거 |
| api-brandlinks | `src/app/api/brandlinks/bulk-today/route.ts:150` | `targetDate`가 형식만 통과, 실재 날짜 검증 없음 | `Date.UTC` 왕복 검증 후 미일치 시 400 |
| api-brandlinks | `src/app/api/brandlinks/super-publish/route.ts:142` | 잘못된 `categoryUrl`이 내부 메시지와 함께 500으로 노출 | 호출을 자체 try/catch로 감싸 400 반환, 비예외형 검증기 도입 |
| api-brandlinks | `src/app/api/brandlinks/[id]/thumbnail/route.ts:153` | 잘못된 JSON 본문이 500으로 표면화 | 본문 파싱을 별도 try/catch로 400 반환, `payload.moods[0]` 가드 |
| api-rest | `src/app/api/topic-tasks/[id]/publish/route.ts:94` | 예약 TZ 기준 today와 서버 로컬 tomorrow를 혼용 | 보정 날짜도 `formatDateInputInTimeZone`으로 계산 |
| api-rest | `src/app/api/blog/categories/route.ts:161` | 세션 파일 경로를 직접 조립해 `NAVER_STORAGE_STATE_PATH` 무시 | `getNaverSessionFile()` 사용 |
| api-rest | `src/app/api/history/route.ts:13` | `parseInt`만 사용해 NaN/음수 skip 발생 | `/api/schedule`처럼 유한성 검사 + 상하한 clamp |
| api-rest | `src/app/api/topic/route.ts:391` | `categoryNo`를 숫자 검증 없이 저장 | `normalizeCategoryNo` 재사용 후 400 반환 |
| api-rest | `src/app/api/topic-tasks/bulk-schedule/route.ts:147` | 로그 경로에 `process.cwd()` 사용(설치 디렉터리) (PLAUSIBLE) | `getLogsDir()`로 교체(발행 라우트도 동일) |
| auth-secrets | `src/app/api/settings/route.ts:60` | 따옴표 이스케이프를 읽기 쪽이 되돌리지 않아 저장한 키가 변형 | 읽기 시 언이스케이프하고 인코딩 구현을 하나로 공유(H2 수정과 함께) |
| auth-secrets | `apps/sites/lib/pairing.ts:18` | 혼동 문자 보정이 알파벳에 없는 문자로 매핑돼 항상 실패 | 해당 replace 제거 또는 알파벳 방향으로 매핑 + 전용 오류 메시지 |
| simple-agent-flow | `scripts/simple-agent.ts:206` | 타임아웃 env를 맨 `Number()`로 파싱해 NaN 타이머 발생 | 네 값 모두 `parseBoundedInteger`(또는 정책 헬퍼)로 파싱 |
| simple-agent-publish | `scripts/simple-agent.ts:8926` | 최종 발행 클릭 실패를 삼키고 true 반환 | 클릭 결과를 확인해 실패 시 다음 셀렉터로, 상태 변화 관측 후에만 성공 |
| simple-agent-publish | `scripts/super-publish.ts:66` | 예약일을 UTC로 포맷해 보고서에 하루 이른 날짜 표시 | `formatYmdInTimeZone(date, NAVER_SCHEDULE_TIMEZONE)` 사용 |
| agent-scripts | `scripts/lib/retry.ts:66` | 타이머 미해제 + `maxRetries: 0`이면 fn 미호출 (PLAUSIBLE) | finally에서 `clearTimeout`, 첫 시도를 카운터 밖으로 또는 하한 검증 |
| agent-scripts | `scripts/lib/logger.ts:9` | 로그 경로가 `process.cwd()`라 패키징 설치 루트를 씀 | `getLogsDir()`로 교체 |
| agent-scripts | `scripts/chatgpt-generate-image-batch.ts:58` | 고아 `.recovery` 파일이 이후 모든 배치를 영구 차단 | `.recovery`도 stale 판정 대상으로 두고 EEXIST에 조치 가능한 메시지 부여 |
| chatgpt-browser | `scripts/lib/chatgpt-browser.ts:29` | 검증 없는 `Number(env)`로 오타가 즉시 하드 실패 유발 | 유한 양수 폴백을 갖는 헬퍼로 파싱 |
| post-spec-engine | `scripts/lib/post-spec/render.ts:66` | 줄 분할 후 maxLines 초과가 P2로 강등돼 영구 warn | 기대치 비교 전에 동일 정규화 적용 또는 58자 한계를 포맷 힌트에 명시 |
| post-spec-engine | `scripts/lib/post-spec/image-plan.ts:192` | 콜라주 재료가 이미 본문에 쓰인 이미지라 중복 노출 | 재료를 `spare`로 한정하고 불가피한 재사용은 품질 리포트에 기록 |
| images-thumbnails | `scripts/lib/product-detail-image.ts:41` | 회전 후 `extract`에 회전 전 치수를 사용해 예외 | 함수 내부에서 방향 적용 치수를 읽어 사용 |
| saas-site | `apps/sites/app/api/mcp/[credential]/route.ts:136` | 부작용이 있는 도구가 `readOnlyHint: true`라 `mcp:read`로 호출 가능 | jobType이 있는 도구는 `readOnlyHint: false`, 또는 명시적 `scope` 필드 도입 |
| saas-site | `apps/sites/lib/rate-limit.ts:29` | 레이트리밋 행이 정리되지 않고 IP 키가 클라이언트 제어 헤더 폴백 (PLAUSIBLE) | 오래된 행 주기적 삭제, `x-forwarded-for`는 신뢰하지 않거나 고정 버킷으로 해싱 |
| saas-site | `apps/sites/lib/account.ts:17` | upsert가 email 유니크 충돌을 처리하지 않아 인증 페이지 전면 500 | email 기준 조회를 선행하거나 email 충돌 분기 추가 |
| legacy-dupes | `fix-topic-agent.py:143` | 두 치환이 모두 실패해도 파일을 재작성하고 "성공" 출력 | 파일 삭제(해당 기능은 이미 반영됨) |
| legacy-dupes | `fix-openai.js:7` | 아무 동작도 하지 않는 스크래치 파일 6종이 lint 예외로 연명 | `fix-openai.js`, `fix-editor.js`, `update-main.js`, `update-topic-agent.js`, `print-env.js`, `list-models.ts` 삭제 후 lint 예외 블록 제거 |
| build-config | `prisma/migrations/20260826154500_add_brandlink_connect_kind/migration.sql:2` | 베이스라인 없는 마이그레이션 이력이 권위 있는 것처럼 보임 | 디렉터리 삭제 후 `db push`를 유일 경로로 문서화하거나 실제 베이스라인 생성 |
| build-config | `resources/app-update.yml:1` | 패킹 중 electron-builder가 덮어써 커밋된 내용이 반영되지 않음 | extraResources 항목 제거하고 `build.win.publisherName`/`build.publish`로 표현 |
| build-config | `package.json:143` | 파일 목록의 `!scripts/verify-saved-text-revalidation-offline.ts` negation이 존재하지 않는 파일을 가리킴 [2차] | 해당 줄 삭제 |
| ui-components | `src/components/PublishProgress.tsx:71` | 비메모 콜백 의존으로 SSE 재연결 루프 가능 (PLAUSIBLE) | 콜백을 ref로 보관하고 효과 의존성을 `[isPublishing, linkId]`로 축소 |
| ui-components | `src/components/TopicTaskPanel.tsx:1055` | UTC 자정 값을 로컬 게터로 렌더해 UTC 서쪽에서 하루 어긋남 | 기록 방식과 동일하게 UTC 기준으로 포맷 |
| test-coverage | `scripts/verify-brand-post-package.ts:8` | 세 verify 스크립트가 `process.cwd()` 기준으로 픽스처 해석 | `path.resolve(__dirname, "..")`/`path.join(__dirname, ...)`로 교체 |
| test-coverage | `package.json:18` | glob 확장에 의존해 Windows/Node 20에서 실패 | 두 파일을 명시적으로 나열하고 루트에 `engines` 추가, CI Node 메이저 통일 |
| test-coverage | `scripts/verify-image-source-thumbnail-regression.ts:18` | `path.resolve("temp/image-contract-qa/travel-overlay.png")`에 산출물을 남기는데 `.gitignore:20-22`는 `temp_images/`만 무시한다. **이번 감사 중 실제로 발생** — 작업 트리에 `temp/`가 untracked로 남아 수동 삭제했다(직접 재확인) | `mkdtempSync`(os.tmpdir) 사용 + finally 정리, `temp/`를 .gitignore에 추가 |
| test-coverage | `scripts/verify-codex-draft-provider.ts:15` | 출하 기본 경로의 지정 검증기가 소스 문자열 정규식만 맞춰볼 뿐 `runCodexDraft`를 한 번도 호출하지 않음. H24가 있어도 20여 개 단언이 전부 통과 [2차] | 이벤트 루프를 순수 함수로 추출해 기록된 이벤트 배열(재연결 error → item.completed 포함)로 동작 테스트 추가 |
| codex-draft-path | `src/lib/codex-local.ts:116` | `/logged in\|authenticated/i`가 `"Not logged in"`의 부분 문자열에 매치. 현재는 `status === 0` 덕에만 오탐을 면함 [2차] | 부정 패턴을 먼저 검사: `status === 0 && !/not logged in/i.test(output) && /logged in\|authenticated/i.test(output)` |
| codex-draft-path | `scripts/simple-agent.ts:209` | `CODEX_DRAFT_MODEL`을 JSON에서만 읽어, 이를 자식 env에 실어 보내는 세 호출부(`draft/route.ts:231`·`:542`, `publish/route.ts:301`)와 `main.cjs:104`가 전부 no-op [2차] | 이웃 상수와 동일하게 `process.env.CODEX_DRAFT_MODEL?.trim() \|\| draftRuntimePolicy.CODEX_DRAFT_MODEL` |
| codex-draft-path | `scripts/simple-agent.ts:4673` | spec-first 파이프라인이 `AI_PROVIDER === "openai"` 게이트라, codex 기본값에서는 모든 매니페스트의 `postSpec`이 null → **"부분 수정"이 영구 사용 불가**. 409 메시지는 엉뚱하게 "ChatGPT 제출 초안"을 탓하며 재생성을 지시(재생성해도 동일) [2차] | 409 메시지를 실제 원인으로 정정하거나 codex 경로에서도 PostSpec을 생성. `runRevision`의 무의미한 `AI_PROVIDER`/`CODEX_DRAFT_MODEL` env도 제거 |
| build-config | `scripts/electron/auto-update.cjs:21` | `AUTO_UPDATE_*` 토글 10종 전부 미문서화. `AUTO_UPDATE_ALLOW_LOCAL_HTTP`(21행)와 `AUTO_UPDATE_FORCE`(207행)가 `AUTO_UPDATE_TEST_MODE` 게이트 없이 프로덕션 빌드에도 적용 [2차] | 두 토글을 test mode 조건 안으로 넣고 `.env.example`에 test-only로 문서화 |
| build-config | `scripts/super-publish.ts:40` | `AI_PROVIDER` 기본값을 `"openai"`로 두고 178행에서 모든 자식에 강제 주입 — codex 고정 정책과 정면 충돌. 패키징 앱에서는 `main.cjs:104`가 가려주지만 CLI/`next dev`에서는 드러남 (PLAUSIBLE) [2차] | `process.env.AI_PROVIDER \|\| draftRuntimePolicy.AI_PROVIDER`로 변경, `test:fixed-draft-settings`를 CI에 편입 |

---

## 7. 고아 회귀 테스트 11종 전수

`scripts/verify-*`는 66개다. 55개는 `package.json`의 `test:*`로 도달 가능하다. **나머지 11개는 `package.json`에도 `.github/workflows/*.yml`에도 배선돼 있지 않다.** 실행 가능한 것을 모두 돌려 본 결과 **전부 오늘도 통과한다** — 즉 살아 있고 올바른 회귀 테스트인데 아무도 실행하지 않는 것이다. 1차 리포트(M66)는 "11개"라고만 적어 이름을 대지 않았고, 그 때문에 **자동 발행 라우트 회귀 테스트가 고아라는 사실이 드러나지 않았다.** 아래가 전수 명단이다.

| # | 파일 | 지키는 것 | 위험 |
|---|---|---|---|
| 1 | `scripts/verify-auto-publish-route.cjs` | `POST /api/brandlinks/[id]/auto-publish`의 인증(403)·날짜 검증·중복 잡 거절·비동기 완료·취소 | **최고** — 자동 발행 라우트의 관리자 키 검사와 중복 잡 거절에 대한 유일한 가드 (H47) |
| 2 | `scripts/verify-scheduled-draft-workflow.ts` | `scheduled-draft-workflow.ts`의 종결 상태·120회 폴링 상한·정확히 1회 publish 호출·준비 글 우선순위·이미지 순서·수리 상한·취소 가드 | **높음** — bulk-today/bulk-schedule의 엔진 (H48) |
| 3 | `scripts/verify-connect-routing-regression.ts` | `assertConnectUrlKind`가 `brandconnect.naver.com.evil.test`와 쇼핑/여행 URL 교차를 거절 | **높음** — 호스트 스푸핑 가드 (H49) |
| 4 | `scripts/verify-section-normalization.ts` | `simple-agent.ts`의 `normalizeSectionText` / 지시문 누출 거절 | 중간 — 프롬프트 지시문이 발행 본문에 새는 회귀 |
| 5 | `scripts/verify-product-name-identity.ts` | `chooseProductName`의 홍보 문구 거절 | 중간 — 발행 글에 잘못된 상품명 |
| 6 | `scripts/verify-image-batch-diagnostics.ts` | `keepFailedDiagnosticOpen` / `imageBatchSucceeded` | 중간 — 다운로드 0장 배치가 성공으로 보고됨 |
| 7 | `scripts/verify-original-photo-background.ts` | `createOriginalProductPhotoOnBackground`가 원본 사진을 변형하지 않음 | 중간 — 원본 이미지 손상 |
| 8 | `scripts/verify-packaging-target.cjs` | `check-packaging-target.cjs`(=`desktop:pack:win`이 실제로 호출)의 `PACKAGING_TARGET_IN_USE` 탐지 | 중간 — 패키징 대상 오검출 |
| 9 | `scripts/verify-image-source-thumbnail-regression.ts` | 여행 썸네일 카피/오버레이 | 낮음 |
| 10 | `scripts/verify-chatgpt-draft-handoff-ui.mjs` | Playwright e2e(라이브 서버 필요). `ci.yml:46`이 **린트만** 하고 실행은 하지 않음 | 낮음 |
| 11 | `scripts/verify-naver-top-post-ontology-packs.py` | 문서 온톨로지 팩 해시 | 낮음 |

**함께 확인된 것.**
- `package.json:143`이 파일 목록에서 `!scripts/verify-saved-text-revalidation-offline.ts`를 제외하는데, **그 파일은 존재하지 않는다**(L34).
- `package.json`에 선언된 `test:*` 56개 중 **37개가 CI의 Unit checks 블록(ci.yml:48-67)에 없다.** 눈에 띄는 것: `test:api-auth`(ADMIN_API_KEY/CRON_SECRET 인증 회귀), `test:fixed-draft-settings`(Codex 고정 정책 가드 — H26·L39가 정확히 이 정책의 위반), `test:auto-update`, `test:mcp-delivery`, `test:post-composition`.
- `apps/sites/tests/*.test.cjs` 22개는 루트 `test:mcp-delivery` glob으로만 도달 가능하며 어떤 워크플로도 호출하지 않는다(H46). 로컬 실행 시 4.4초에 전부 통과한다.

---

## 8. 템플릿 동작을 뒤집는 환경 토글 전수

문서화 상태를 코드 기준으로 대조한 결과다. 이 목록이 없으면 "이 글이 왜 이렇게 나왔는가"를 추적할 수 없다.

| 토글 | 위치 / 기본값 | 문서화 | 비고 |
|---|---|---|---|
| `AI_PROVIDER` | `simple-agent.ts:207`, 기본 = `draft-runtime-policy.json`의 `"codex"` | `.env.example:5` (앱 고정 정책) | `super-publish.ts:40`만 `"openai"`로 어긋남 (L39) |
| `CODEX_DRAFT_ENABLED` | `draft-runtime-policy.json` | — | 초안 라우트만 읽음. 발행 라우트는 무시 → 반쪽 킬 스위치 (M) |
| `CODEX_DRAFT_MODEL` | `simple-agent.ts:209`, `"gpt-5.5"` 고정 | — | env override 불가. 세 호출부의 주입이 전부 no-op (L37) |
| `CODEX_BROWSER_FALLBACK_ENABLED` | `simple-agent.ts:216`, 기본 false | **없음** | 켜면 `writing-timeout-policy.ts:18`이 작성 체인을 160분으로 늘림 |
| `POST_SPEC_PIPELINE_ENABLED` | `simple-agent.ts:390`, 기본 true | **없음** | 출하 codex 정책 아래에서는 사실상 사문 (spec-first가 openai 게이트) |
| `BROWSER_GPT_MODE` | `simple-agent.ts:246`, 기본 false | `.env.example:17` | `main.cjs:105`와 `settings/route.ts:163`이 `"false"`로 하드 강제 |
| `BRANDLINK_EXPERIENCE_MODE` | `simple-agent.ts:367`, 기본 `AI_ASSISTED_INFORMATION` | **없음** | `VERIFIED_EXPERIENCE`로 두면 협찬 글이 **직접 사용 경험을 주장**한다. 고지 문제로 직결 |
| `BRANDLINK_QUALITY_PRESET` | `simple-agent.ts:363`, 기본 `PREMIUM` | **없음** | `STANDARD`는 품질 게이트를 낮춘다(H36의 하드 예외도 이 프리셋에서 발생) |
| `PRODUCT_POST_LOCAL_FALLBACK_ENABLED` | `simple-agent.ts:387` true / `draft/route.ts:392` false | `.env.example:31` = false | 세 소스 불일치, 발행 라우트는 미전달 (H26) |
| `NAVER_EDITOR_QUOTATION_ENABLED` | `simple-agent.ts:393`, 기본 false | `docs/post-composition-harness.md:94`에만 | **"인용구는 항상 강등된다"는 서술은 이 토글 하나로 뒤집힌다** |
| `BRANDLINK_GENERATED_DRAFT_PATH` | `simple-agent.ts:377`, 기본 `""` | **없음** | 설정 시 생성을 건너뛰고 그 파일 내용을 그대로 발행 |
| `BRANDLINK_DRAFT_CONTEXT_OUTPUT` | `simple-agent.ts:376`, 기본 `""` | **없음** | 설정 시 컨텍스트만 덤프하고 실행 종료 |
| `BRANDLINK_FORCE_QUALITY_REPAIR` | `simple-agent.ts:348`, 기본 false | **없음** | |
| `BLOG_HUMANIZE_MOBILE_STYLE` | `simple-agent.ts:272`, 기본 true | **없음** | |
| `OPENAI_MODEL` | `simple-agent.ts:199`, 기본 `gpt-4o-mini` | `.env.example:5-7`은 다른 모델을 광고 | openai 경로의 실제 기본값이 문서와 불일치 |
| `TRAVEL_STOCK_IMAGES_ENABLED` | `post-spec/image-plan.ts:118` | **없음** | |
| `REMOTE_SITE_URL` | `src/lib/remote-activation.ts:12` | **없음** | **H2의 주입 대상이자 C2의 업데이트 출처** |
| `REMOTE_SITE_ALLOWLIST` | `src/lib/remote-site.ts:12` | **없음** | 검사가 https 분기 밖(41행) → http 허용 (M) |
| `AUTO_UPDATE_*` 10종 | `auto-update.cjs:21, 52-60, 207-208` | **전부 없음** | `ALLOW_LOCAL_HTTP`/`FORCE`가 test mode 게이트 밖 (L38) |
| `ADMIN_API_KEY` / `CRON_SECRET` | `.env.example:224` / `:228` | 문서화됨, 일관 | 다만 `CRON_SECRET`은 설정 화이트리스트에 없어 데스크톱에서 설정 불가 (H3) |
| 죽은 토글 5종 | `.env.example:72, 147, 154, 157, 163` | 문서만 있고 **읽는 코드 없음** | `CHATGPT_FORCE_NEW_CHAT`은 대응책으로 권장까지 됨 (M) |

---

## 9. 1차 리포트 정정 사항

병합 과정에서 1차의 다음 항목이 바뀌었다. 후속 작업자가 옛 번호를 참조하지 않도록 명시한다.

| 1차 | 변경 | 사유 |
|---|---|---|
| H30 `scripts/lib/post-spec/assemble.ts:71` | **폐기 → H36 `scripts/lib/post-spec/image-plan.ts:281`로 대체** | `assemble.ts:71`, `validate.ts`의 IMAGE_SHORTFALL 발행, `index.ts:199-202`의 `[0,1]`→`[1,1]` 승격은 **모두 올바른 코드였고 1차가 잘못 지목했다.** `repair.ts:10`의 수리 불가 지정도 설계이지 결함이 아니다. 상세는 §4.6 H36 |
| H1 (변경 API CSRF) | HIGH → **CRITICAL(C1)** | 기본 설치에서 `requireAdminApiKey`가 no-op이고, 30+ 라우트 전수 확인으로 도달 범위가 실발행까지임이 확정됨 |
| M22 (무가드 GET 5개) | MEDIUM → **HIGH(H2)** | 형제 쓰기 경로보다 읽기 경로가 약하고, 키를 설정한 사용자도 보호되지 않음 |
| M `src/lib/codex-local.ts:128` | MEDIUM → **HIGH(H25)** | 출하 기본 작성 경로 전체를 프로세스 수명 동안 봉쇄함이 확인됨 |
| H6 `scheduler.ts:197` | PLAUSIBLE → **CONFIRMED** | 성공 경로에만 `status === "RUNNING"` 가드가 있고 catch에는 없다는 비대칭을 직접 재확인 |
| C4 `fix-topic-agent.js` 삭제량 | 1741줄 → **1914줄(3062줄 중 63%)** | 드라이런 직접 실행 결과 |
| H19 `repairKoreanParticles` 피해 범위 | "어미 훼손" → **어미 + 이로 끝나는 일반 명사 훼손** | 실행 결과가 1차 보고보다 나쁨 (§4.3 H22) |
| H14 이스케이프 지점 행번호 | 302, 484, 497, 507 → **302, 486, 498, 508** | 현재 소스 기준 재확인 |
| 자동 업데이트 서명 서술 | "서명 검증이 꺼져 있다" → **"앱이 미서명이라 검증할 기준이 없다"** | `build.win`에 `publisherName`/`certificateFile`/`forceCodeSigning`이 모두 없음을 직접 확인 |
| C2 페어링 경로 위험도 서술 | "드라이브바이" → **"사용자가 적대적 MCP URL을 붙여넣어야 함"** | POST가 `requireTrustedLocalMutation` + `requireAdminApiKey` 뒤에 있음을 직접 확인 |
| H1 인증 서술 | "인증 없음" → **"인증 부재가 아니라 CSRF 방어 부재"** | 키 없을 때 허용은 의도된 동작이며 `api-auth.ts:113`에 문서화돼 있음 |

또한 1차의 "죽은 파일 정리" 목록에 **`skills/` 디렉터리가 빠져 있었다.** `skills/product-photo-thumbnail-copywriting/`(SKILL.md, references/, agents/)는 저장소 전체에서 코드 참조가 0건이다. 이것이 죽은 자산인지 외부에서 소비되는 자산인지는 이 감사가 판정하지 못했다 — 소유자가 결정해야 한다(§10 참조).

---

### 9.1 외부 리뷰 반영 정정 (2026-09-08)

PR #14에 붙은 자동 코드 리뷰가 이 문서의 서술 3건을 반박했다. 세 건 모두 코드로 재검증했고 **세 건 모두 지적이 옳았다.** 그중 하나는 이 문서의 헤드라인이었다. 아래가 정정 내역이다.

| 지적 | 초판 서술 | 재검증 결과 | 조치 |
|---|---|---|---|
| P1 | `.env` 개행 주입이 **1회 저장**으로 `process.env`를 오염시켜 즉시 업데이터 RCE로 연쇄 | **틀림.** 기동 시 `process.env`를 만드는 것은 dotenv 17.3.1(`main.cjs:97`)인데, dotenv는 큰따옴표 값이 리터럴 개행을 포함하는 것을 허용하므로 페이로드를 `NAVER_BLOG_ID` 한 개의 여러 줄 값으로 유지한다. 따옴표 탈출 4변형 모두 실패 | C2 → **H2**로 강등, §2 연쇄도 재작성 |
| P2 | 고지 섹션 제거로 이미지·플랜 인덱스가 **현재 밀리고 있다** (HIGH) | **틀림.** `assemble.ts:104`가 고지를 마지막에 append하고 `composition.sections`·`sectionPlan`은 고지를 포함하지 않으므로(`types.ts:238`) 현재 호출자에서는 발현하지 않는다 | H21 **MEDIUM**으로 정정, 진짜 위험은 `isDisclosureSection` 과대 매칭으로 재서술 |
| P3 | stdout 청크 디코딩 손상이 **발행 본문에 도달**한다 (HIGH) | **틀림.** `review-agent.ts:289`의 `--publish` 분기는 상호 배타적이라 발행 경로에서는 그 JSON을 출력조차 하지 않는다 | H27 **MEDIUM**으로 강등, 영향을 API 응답·운영 로그·오류 메시지로 한정 |

**왜 틀렸는가 — 재발 방지를 위해.** 세 건의 실패 원인이 같다. **검증에 쓴 경로가 제품이 실제로 쓰는 경로가 아니었다.**

- P1: 같은 `.env`를 읽는 파서가 셋(`settings/route.ts:39`, `local-env-file.ts:5`, dotenv)인데 앞의 둘로만 재현하고 "기동 시 주입된다"고 단정했다. 기동 시 파서는 dotenv다.
- P2: 재현 스크립트가 두 배열에 고지 항목을 직접 넣었는데, 실제 호출자는 그렇게 만들지 않는다. 호출자를 읽지 않고 함수만 읽었다.
- P3: 결함(디코딩)은 실측했으나 그 출력이 발행에 쓰이는지 확인하지 않고 영향 범위를 단정했다.

**세 건 모두 "결함이 존재하는가"에서는 맞고 "무엇에 도달하는가"에서 틀렸다.** 결함의 존재를 확인한 뒤 소비자 경로를 끝까지 따라가지 않으면 등급이 부풀려진다. 남은 CONFIRMED 항목 중 소비자 추적이 얕은 것이 더 있을 수 있으므로, 조치 착수 전 해당 항목의 소비자 경로를 한 번 더 확인할 것을 권한다.

**반대로, 반박이 지나쳤던 부분도 기록한다.** P1 지적은 "연쇄가 성립하지 않는다"까지 갔지만, 쓰기(`serializeEnv`)와 읽기(줄 단위 파서)의 불일치 때문에 **두 번째 env 쓰기가 주입 줄을 독립 줄로 세탁**하고 그 파일은 dotenv도 정상 키로 읽는다(실행 확인). 따라서 결함은 사라지지 않고 전제가 무거워질 뿐이며(2회 쓰기 + 재시작), 오염된 값은 업데이터와 잡 폴링 출처(`poll/route.ts:124-125`, OS 무관·디바이스 토큰 유출) 양쪽을 리다이렉트한다. HIGH로 강등하되 삭제하지 않은 이유다.

---

## 10. 이 리포트의 한계

정직하게, 다루지 **않은** 것을 밝힌다.

1. **런타임/E2E 실행 없음.** 실제 네이버 계정에 로그인해 발행 파이프라인을 끝까지 돌린 적이 없다. 발행 관련 결함은 코드 판독, 모듈 단위 실행, 샌드박스 시뮬레이션, 그리고 저장소 안의 verify 스크립트 실행 결과에 근거한다. Playwright 셀렉터가 오늘의 네이버 DOM과 실제로 맞는지는 확인하지 못했다 — H13·H14 같은 항목은 "코드가 실패를 성공으로 보고한다"는 사실이 요점이지 "셀렉터가 깨졌다"는 주장이 아니다.
2. **의존성 CVE 스캔 없음.** `npm audit`이나 SCA를 돌리지 않았다. 이 리포트의 보안 항목은 전부 이 저장소가 직접 쓴 코드에 관한 것이다. 패키지 취약점은 별도 점검이 필요하다.
3. **`apps/site`(구형 앱)는 얕게만 봤다.** 빌드·린트·타입체크·테스트 어디에도 포함되지 않아 표면적 검토에 그쳤다(M57-M59). 이미 신규 앱과의 드리프트가 현실화됐으므로(64KB/1MB 본문 상한 사례) 처분 결정 자체가 선행돼야 한다.
4. **`skills/` 자산의 성격을 판정하지 못했다.** 코드 참조 0건이지만 외부 소비 자산일 가능성이 있어 "삭제 대상"으로 분류하지 않았다.
5. **템플릿 계층 문서와의 교차 검증은 부분적이다.** H21(고지 섹션 제거)과 H36(이미지 부족 게이트)에 대해서는 템플릿 쪽 서술과 맞췄으나, 주제글 템플릿 체계(`topic-workflow.ts`의 `SUBTOPIC_HINT_TEMPLATES`/`SUBTOPIC_ROLE_TEMPLATES`)와 썸네일 카피 템플릿(`thumbnail-gen/prompt.ts`)의 전수 매핑은 이 코드 감사의 범위가 아니다.
6. **성능·부하는 측정하지 않았다.** M-codex-spawnSync처럼 명백한 블로킹은 지적했으나 프로파일링은 없다.
7. **판정의 성격.** CONFIRMED는 코드 판독 또는 실행으로 재현된 것, PLAUSIBLE은 두 검증자 중 하나만 동의했거나 도달 경로에 확인되지 않은 전제가 남은 것이다. PLAUSIBLE 항목을 고칠 때는 먼저 재현을 시도하기를 권한다.

---

## 11. 우선순위 조치 순서

1. **업데이트 경로를 페이로드부터 끊는다 (배포 차단 해제 조건).** `scripts/electron/auto-update.cjs:17`의 업데이트 출처를 상수로 고정한다 — 이 한 가지만으로 아래 오염 경로가 남아 있어도 코드 실행으로는 이어지지 않는다. 이어서 즉시 성립하는 경로부터: `src/app/api/remote-agent/route.ts:46-52`의 mcpUrl 분기에 허용 목록 적용 → `src/lib/remote-site.ts:39`의 와일드카드를 정확한 호스트로 교체하고 41행 검사를 https 분기 안으로 → `scripts/electron/main.cjs:483`의 딥링크 `site` 검증 + 재페어링 확인 모달 → 마지막으로 `src/app/api/settings/route.ts:56`에서 개행 포함 값 거절 + `serializeEnv`/읽기 파서 통일. (C2, C3, H2, H4, H5)
2. **Windows 릴리스를 코드 서명하고 `build.win.publisherName`을 설정한다.** 서명이 없으면 1번의 출처 고정만으로는 electron-updater가 대조할 기준이 여전히 없다. 같은 파이프라인에서 `resources/app-update.yml` extraResources 제거(L34), 릴리스 빌드의 lockfile 삭제 중단(M60), `prisma/**/*` glob 축소로 개발 DB 유출 차단(M61), `AUTO_UPDATE_ALLOW_LOCAL_HTTP`/`AUTO_UPDATE_FORCE`를 test mode 게이트 안으로(L38).
3. **로컬 API CSRF를 일괄 적용한다.** `requireTrustedLocalMutation`을 §3 그룹 B·C의 모든 비-GET 핸들러에 적용한다(공용 래퍼 또는 미들웨어 — 목록 관리는 반드시 다시 어긋난다) → `/api/schedule/cron`을 POST 전환 + fail-closed → 그룹 E의 무가드 GET 5개에 `request` 인자와 가드 추가 + `admin-session` DELETE 보강 → `isDevelopmentLocalRequest`의 Host 헤더 신뢰 제거 → `apps/sites` 관리자 업데이트 라우트 origin 가드 → MCP 인자 검증의 `__proto__` 우회 차단. (C1, H1, H2, H3, M22, M29, M54)
4. **루트 코드모드를 정리한다.** `fix-topic-agent.js`, `update-content.js`, `refactor-content.js`, `refactor-image.js`, `add-image-downloader.js`, `fix-topic-agent.py` 및 무동작 파일 6종 삭제 + `eslint.config.mjs` 예외 블록 제거. 커밋 하나로 끝나며 이후 모든 작업의 사고 위험을 없애고 lint 적자도 함께 줄인다. (C6, H42, M56, L30, L31)
5. **중복 발행 회계를 고친다.** `scripts/topic-agent.ts:2993`과 `scripts/simple-agent.ts:10174`에 "발행됨·미검증" 종결 상태 도입 → `src/services/scheduler.ts:197`의 catch에 성공 경로와 동일한 `status === "RUNNING"` 가드 적용 → `scripts/electron/main.cjs:151-157`의 기동 복구가 PUBLISHING도 처리(별도 `NEEDS_VERIFY` 상태로) + auto-publish의 전역 count를 제품 단위로 축소 → `scripts/topic-agent.ts:729`의 예약 확정 근거 강화 → `scripts/bulk-topic-schedule-publish.ts:253` 기본값 반전 → `src/services/scheduler.ts:103` 원자적 claim → 모든 실발행을 `beginAutomaticPublishing` 하나로 통과. **여기까지가 "네이버 계정 리스크"를 없애는 최소 집합이다.** (C5, H7, H8, H9, H10, H15, H43, M1, M-publish-mutex)
6. **출하 기본 작성 경로(Codex)를 살린다.** `codex-draft-provider.ts:117`에서 `error` 이벤트로 던지지 않기 → `codex-local.ts:128`에 서버 측 로그인 기한·취소 경로 → `PRODUCT_POST_LOCAL_FALLBACK_ENABLED` 기본값 통일(발행 라우트가 명시 전달) → 발행 라우트가 `CODEX_DRAFT_ENABLED`를 존중하고 `AI_PROVIDER`를 정규화 → `readCodexLocalStatus` 비동기화 + 캐시 → `verify-codex-draft-provider.ts`에 동작 테스트 추가. 이 여섯 개를 안 고치면 **제품의 기본 작성 경로가 특정 네트워크에서 영구 실패한다.** (H24, H25, H26, M-codex 3건, L35-L37)
7. **발행 판정의 "증거 없음 = 성공" 패턴을 제거한다.** `waitForShoppingConnectInserted` 반환값 정정, `assertFreshPostEditor`에 긍정 증거 요구(`naver-editor-selectors.ts` 사용), `review-agent` 결과 전파, 최종 클릭 실패 무시 제거, 좌표 클릭 폴백 제거. (H12, H13, H14, L17, M34)
8. **영구 차단·데드락을 해소한다.** 예약 경로의 `contentHtml` 전제 제거 → readiness의 `sourceUrls` 입력 통일 → `broken-copy` 임계값 상향 → `imageGeneration.status:"running"` 노후 판정 → 주제 정규식 이스케이프 → `scheduled-draft-workflow.ts`의 포트 하드코딩 제거. 사용자가 "아무리 해도 안 되는" 상태를 만드는 여섯 건이다. (H6, H11, H17, H19, H20, H30)
9. **데이터 손실 경로를 봉합한다.** 승인 시 원자적 매니페스트 기록 → 원본 상품 사진 provenance 승계 → stat catch-all 삭제 방지 → 자식 stdout 인코딩 지정 → 고지 섹션 제거 시 인덱스 재매핑. (H21, H27, H28, H29, M13)
10. **정상 경로 오출력을 고친다.** `image-plan.ts:281`의 `shortfall` 산정(**`assemble.ts`를 건드리지 말 것** — §4.6 참조), hero 정규식 Windows 대응, 페이드 마스크 raw 버퍼, EXIF 방향 적용 치수, `ad` 토큰 경계, qa-3 라벨링, 후보 인덱스 매핑, `preparedPostsFirst` 정렬 오용, 조사 보정(마커 방식으로 전면 교체 권장). (H18, H22, H23, H32, H36, H37, H38, H39, H40)
11. **ChatGPT 브라우저 계층 3건.** 개행 보존 입력, 타임아웃을 성공으로 반환하지 않기, 프로필 락 원자적 탈취 + age 만료. 이 셋은 초안 품질 저하의 상당 부분을 설명한다. (H33, H34, H35, M42)
12. **테스트 하네스를 복구한다.** `tsx` 의존성 추가(또는 ts-node 전환) → CI에서 전체 `test:*` 실행 + lint 대상을 저장소 전체로 → `apps/sites`에 `test` 스크립트와 CI 스텝 추가 → **§7의 고아 verify 스크립트 11개를 배선**(1·2·3번을 먼저). 이 단계 이후에야 앞선 수정들의 회귀를 CI가 지켜준다. (H44, H45, H46, H47, H48, H49, M66)
13. **환경 토글을 문서화한다.** §8 표에서 "**없음**"인 항목을 `.env.example`에 코드 기본값과 함께 추가하고, 죽은 토글 5종과 잘못된 권장 문구를 삭제한다. 특히 `BRANDLINK_EXPERIENCE_MODE`는 협찬 고지 문제로 직결되므로 경고 문구를 함께 단다. (M, L38)
14. **나머지 MEDIUM 일괄 처리.** 자원 누수(자식 프로세스 미종료, 브라우저 누수, 무한 폴링, 임시 파일), TZ 혼용, 입력 검증, UI 비동기 상태 소유권 순으로 묶어 처리한다.
15. **`apps/site` 처분을 결정한다.** 삭제하거나 CI 잡으로 편입한다. 방치 상태에서는 보안 수정이 한쪽에만 반영되는 드리프트가 계속 쌓인다. `skills/` 디렉터리의 성격도 같이 판정한다. (M57, M58, M59)
16. **LOW 정리 및 `src/lib/kst.ts` 배선.** 죽은 KST 헬퍼를 스케줄 스크립트에 실제로 연결해 UTC 호스트에서의 9시간 밀림을 제거하고, 나머지 LOW는 인접 작업을 건드릴 때 같이 처리한다.

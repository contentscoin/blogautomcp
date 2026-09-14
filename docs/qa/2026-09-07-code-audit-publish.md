# 예약·즉시 발행 코드 분석 (2026-09-07)

## 범위와 결론

화면·브라우저를 실행하지 않고 대시보드 이벤트 핸들러, Electron 호스트, 로컬 API, 발행 스크립트와 상태 저장 경로를 분석했다. 운영 DB 조회·변경, 실제 발행, 이미지 생성, 소스 수정은 하지 않았다. 아래 재현은 현재 작업 트리 코드 기준이다. 통합 분석 담당 에이전트는 설치된 1.3.25의 resources/app 주요 9개 소스 파일과 작업 트리의 SHA-256 일치를 별도로 확인했다. 설치된 `.next` 빌드 산출물까지 같다는 의미는 아니다.

**예약 버튼에는 Electron에서 예외를 발생시키는 확정 결함이 있다. 즉시 발행에는 클릭 실패를 성공으로 반환하는 결함, 완료 URL 판정 불일치, 실제 발행 여부가 불확실한 상태를 FAILED로 저장하는 결함이 있다.** 실제 사용자 실패 건별 비중은 운영 로그/원격 결과와 연결해야 확정할 수 있다.

## 실제 호출 경로

| 진입점 | 호출 경로 | 상태/결과 |
|---|---|---|
| 상품 즉시 발행 | `src/app/page.tsx:1363` → `startPublish:1330` → `POST /api/brandlinks/:id/auto-publish` | 메모리 Job 생성, 3초 GET 폴링 |
| 상품 예약 발행 | `page.tsx:1402` → `prompt:1419` → `startPublish:1440` | Electron에서는 prompt에서 중단 |
| 자동 검수 후 발행 | `src/app/api/brandlinks/[id]/auto-publish/route.ts:59` → `scripts/lib/scheduled-draft-workflow.ts:44` | draft GET/POST → 이미지 대기/보충 → recheck → approve → 필요시 revise 한 번 → publish |
| 실제 발행 프로세스 | `src/app/api/brandlinks/[id]/publish/route.ts:251` 상태 claim → `:271` simple-agent 선택 → `:295` spawn | DB `PUBLISHING`; 자식 프로세스 백그라운드 실행 |
| Naver 제출 | `scripts/simple-agent.ts:10002` editor → 제목/이미지/본문 → `:10029` step7_publish | 예약: 제출신호 확인 후 SCHEDULED. 즉시: URL 확인 후 PUBLISHED |
| 일괄 예약 | `page.tsx:1499` → `bulk-schedule/route.ts` → `scripts/bulk-schedule-publish.ts` → 동일 scheduled-draft-workflow | READY+예약일 존재 행을 최대 지정 건수 선택, 순차 실행 |
| MCP 상품 발행 | `src/app/api/remote-agent/poll/route.ts:1213` → 동일 auto-publish | 화면의 prompt를 거치지 않으므로 예약 버튼 결함과 MCP 실패 원인은 구분해야 함 |

`src/services/scheduler.ts`는 `Post`/`topicSeed`를 사용하는 별도 주제글 경로이며 `src/app/api/schedule/cron/route.ts`에서 호출된다. 상품 예약 버튼이 해당 스케줄러에 작업을 적재하는 구조가 아니다. 상품 예약은 즉시 Naver 에디터에 들어가 미래 예약을 등록한다. `scripts/review-agent.ts` 역시 상품 발행 주 경로가 아니며 `src/app/api/review/route.ts:94`에서 별도로 호출된다. 이 두 파일을 고치는 것만으로 상품 예약 버튼 문제가 해결되지 않는다.

## P1 — 예약 버튼은 Electron의 미지원 prompt를 직접 호출한다 (확정)

- `src/app/page.tsx:1419`: native `prompt()` 호출. 호출을 감싼 try/catch가 없다.
- 같은 파일 `:1424`의 `input === null` 처리는 취소만 처리한다. 예외는 처리하지 못한다.
- `:1440`의 API 호출까지 도달하지 못하고, `:3064`의 `void handleSchedulePublish(link)`에서 Promise rejection이 발생한다.
- 주제글 예약도 `page.tsx:2095`에 같은 호출이 있다.
- `scripts/electron/main.cjs:244-255`는 BrowserWindow에서 contextIsolation을 켜지만 prompt 대체 preload/IPC를 제공하지 않는다.
- 현재 `node_modules/electron/package.json:3`은 `44.0.0`이다. 동일 버전 [Electron 공식 소스](https://github.com/electron/electron/blob/v44.0.0/lib/renderer/window-setup.ts#L13-L17)는 window.prompt를 `throw new Error('prompt() is not supported.')`로 구현하며 isolated world에도 동일 override를 적용한다. 공식 소스만 조회했으며 Electron을 실행하지 않았다.

**오프라인 재현:** TypeScript AST에서 실제 `handleSchedulePublish` 함수만 추출해 VM 실행, Electron 공식 prompt 계약을 mock으로 주입했다. 결과는 unsupported 예외, `startPublish` 호출 0회, 대시보드 알림 0회였다. 따라서 사용자가 보기에 아무 일도 일어나지 않는 현상을 코드가 직접 설명한다.

**수정 방향:** React 날짜 선택 모달 또는 기존 폼의 `input type=date`로 교체하고 날짜 확정 시 API 호출. 상품/주제글 경로를 같은 컴포넌트로 통합. 예외 처리만 넣으면 오류 표시는 개선되지만 예약 기능은 여전히 작동하지 않는다.

**회귀:** 저장 예약일 기본값, 기본값 없음, 취소, 유효 날짜, 존재하지 않는 날짜, 즉시/예약 선택, API 409/500 안내를 native prompt 없이 검증.

## P1 — 최종 발행 클릭이 실패해도 성공을 반환한다 (확정)

`scripts/simple-agent.ts:8925-8927`, `:9031-9033`, `:9045-9047`에서 `click(...).catch(() => {})` 다음 `return true`가 실행된다. detach/disabled/timeout으로 클릭이 거부되어도 다른 후보를 확인하지 않고 클릭 성공으로 처리한다. 상단 버튼도 `:9095`에서 오류를 삼킨다.

그 뒤 `step7_publish`는 성공 로그를 남기고, 즉시발행은 25초 URL 타임아웃(`:10112`)에서야 일반 실패가 된다. 예약은 제출 검증에서 실패한다. 실제 근본 원인인 클릭 실패가 결과에 남지 않으므로 선택자 오류와 네트워크/발행 오류가 혼동된다.

**오프라인 재현:** 실제 `clickFinalPublishButton` 함수만 AST 추출했다. visible=true, click이 예외를 던지는 mock page를 주입했는데 반환값은 true였다. 브라우저를 사용하지 않았다.

**수정 방향:** 클릭 예외를 분류/기록하고, 클릭이 실제 성공한 경우에만 true 반환. 제출 요청이 관측된 후에는 다른 버튼을 다시 클릭하지 않도록 보호. 선택자는 최종 발행 레이어와 버튼 역할로 제한. 좌표 fallback(`:9158-9163`)은 제출 증거 없이 성공을 반환하지 않게 한다.

**회귀:** visible+disabled, click detach, 잘못된 레이어, 최종 버튼 없음, 클릭 후 요청 발생, 요청 이후 연결 손실. 실제 요청이 이미 발생한 상태의 재클릭 금지가 핵심이다.

## P1 — 즉시발행 URL 판정과 검증 API의 URL 계약이 다르다 (확정, 실제 발생 빈도 미확인)

`scripts/simple-agent.ts:9181-9182`의 `isPublishedUrl()`은 `PostView` 문자열 또는 `logNo=숫자`만 허용한다. `waitForPublishedUrl(:9185)`는 현재 page.url만 검사한다. 반면 검증 API `src/app/api/brandlinks/[id]/verify/route.ts:13-21`는 `https://blog.naver.com/<blogId>/<숫자>` 경로를 정식 글 주소로 변환한다.

**오프라인 재현:** 실제 함수에 `https://blog.naver.com/example/223123456789`를 주입하면 false, query 형식은 true, 전혀 다른 호스트의 `https://example.invalid/?logNo=1`도 true다. 내부 발행/검증 코드 사이 계약 불일치가 확인된다. 현재 Naver가 사용자 실패 시 어떤 URL로 전환했는지는 화면/운영 로그를 조사하지 않았으므로 미확정이다.

**수정 방향:** 호스트/blogId/logNo를 검증하는 URL parser를 공용화. 숫자 경로와 PostView query 경로 모두 처리. 실제 발행 POST 응답의 식별자도 수집하고 승인 초안/계정/발행 attempt에 연결해 검증한다. page.url 25초 제한만 늘려서는 판정 불일치가 해결되지 않는다.

## P1 — 제출 이후 불확실성을 FAILED/READY로 저장하여 중복 발행 위험을 만든다 (확정)

- `simple-agent.ts:10112-10114`: URL을 찾지 못한 경우 수동 확인 필요라는 예외 발생.
- `:10176`: 모든 예외를 구분 없이 DB FAILED로 저장. `:9530`의 전체 런타임 타임아웃도 동일하다.
- `:10128` 이후 DB에 PUBLISHED를 기록한 뒤 알림이나 browser.close가 실패해도 동일 catch가 PUBLISHED를 FAILED로 덮어쓸 수 있다.
- `auto-publish/route.ts:43`과 `page.tsx:3063`은 FAILED를 발행 가능한 상태로 취급한다.
- `src/app/api/posting/stop/route.ts:99-104`는 프로세스 종료 실패 여부나 제출 시점을 확인하지 않고 모든 PUBLISHING을 READY로 바꾼다.
- `scripts/bulk-today-publish.ts:269`, `bulk-schedule-publish.ts`에는 연결 손실+PUBLISHING이면 중단하는 보호가 있으나, 자식이 이미 FAILED로 바꾸면 그 보호를 통과하지 않는다.

**수정 방향:** attempt별 `PREPARING`, `SUBMITTING`, `VERIFYING`, `PUBLISHED`, `FAILED_BEFORE_SUBMIT`, `OUTCOME_UNKNOWN`을 영속 저장하고 제출 이후 오류는 unknown으로 분리. unknown은 재시도 후보에서 제외하고 결과 대조를 먼저 수행한다. 완료 이후 알림/cleanup 오류가 발행 결과를 덮어쓰지 않도록 try/catch 경계를 나눈다. STOP은 작업 취소와 외부 발행 결과를 별도 상태로 남긴다.

**회귀:** 제출 성공 직후 연결 끊김, URL 지연, DB write 실패, 발행 완료 후 cleanup 실패, STOP 중 kill 실패. 동일 초안/attempt로 외부 제출은 한 번만 수행되어야 한다.

## P1 — 시작일을 지정해도 예약일 없는 READY 상품은 일괄 예약에서 제외된다 (확정)

`src/app/api/remote-agent/poll/route.ts:1234-1239`는 MCP의 startDate를 bulk-schedule API에 전달한다. 하지만 `src/app/api/brandlinks/bulk-schedule/route.ts:142-145`는 예약일이 이미 존재하는 READY 행만 조회한다. 해당 행이 없으면 `:155-165`에서 HTTP 200, success=true, targetCount=0을 반환하고, startDate 적용은 그 이후 `:170`에 있다. 따라서 예약일이 없는 READY 상품 10개에 내일부터 예약하라는 요청을 해도 지정된 startDate가 대상 선택에 사용되지 않는다.

실행 스크립트 `scripts/bulk-schedule-publish.ts:236-237`도 같은 필터를 적용한다. API 조회만 수정하면 전달된 대상 ID를 자식 스크립트가 찾지 못하는 후속 실패가 생길 수 있으므로 두 경로를 함께 수정해야 한다. 대시보드 역시 `page.tsx:1511-1519`와 `:2866`에서 예약일이 있는 항목만 계수하므로 일괄 예약 진입 조건을 별도로 정리해야 한다.

**오프라인 재현:** 실제 bulk-schedule route를 transpile+VM 실행하고 Prisma/child_process/fs를 mock했다. `POST {limit:10,startDate:'2026-09-08'}`에 대해 `query.where.scheduledPublishAt.not === null`, HTTP 200, success=true, targetCount=0, spawn 0회를 확인했다. 실제 DB 또는 서버는 사용하지 않았다.

**수정 방향:** startDate 명시 시 READY 대상에 날짜 미지정 행을 포함하고 날짜를 배정한다. startDate 미지정 시 기존 예약일만 사용할지, 내일부터 자동 배정할지 명시적인 공용 계약으로 통일한다. 10건 요청에서 후보 부족/0건은 성공 완료와 구분하여 requestedCount/eligibleCount/skippedReason을 반환한다.

**회귀:** 예약일 전부 없음/일부 있음/전부 있음, startDate 지정/미지정, 이미 예약된 날짜 충돌, 10건 중 일부 품질 실패, API에서 고른 ID와 자식 스크립트 조회 대상 일치.

## P2 — 메모리 작업 기록 소실 및 고착 상태에 대한 복구가 불완전하다 (확정 구조, 장애 재현 미실행)

`auto-publish/route.ts:8-10`의 jobs는 global Map이다. 재시작 후 GET은 404(:18-21)를 반환한다. 예약 일괄 작업도 `bulk-schedule/route.ts:41-47` 메모리 Map이다. `scripts/electron/main.cjs:144-164`는 DRAFTING만 FAILED로 복구하고 PUBLISHING 복구는 하지 않는다.

`scheduled-draft-workflow.ts:75-83`은 PUBLISHING이 지속되는 한 무기한 대기하고, `:49-52` 이미지 running 대기도 무기한이다. `localScheduleCall(:22-42)`에는 요청 timeout/AbortSignal이 없다. 자식이 강제 종료되어 DB 상태 갱신이 누락되거나 API가 응답 없이 열린 채 남으면 job도 running으로 남는다. `auto-publish/route.ts:43-45`는 하나의 PUBLISHING/DRAFTING만 있어도 후속 발행 전체를 거부한다.

현재 작성용 타임아웃 정책의 기본 `agentMs`는 `scripts/lib/writing-timeout-policy.ts:12-23` 계산상 150분(4 × 30분 + 30분)이다. 승인 패키지로 발행만 하는 경우도 동일 타이머를 사용한다. 정상 장기 작업과 죽은 작업을 구분하지 못하므로 단순 시간 제한 확대는 복구책이 아니다.

**수정 방향:** DB 기반 job/attempt, PID+heartbeat+stage+마지막 제출 식별자 저장. GET에 서버 재시작/worker 소실 상태 반영. 단계별 deadline 이후에는 실패 확정 또는 unknown으로 수렴. HTTP timeout과 재시도는 read-only 조회/아직 제출하지 않은 단계에만 적용한다.

## P2 — 예약 제출 확인은 응답 본문을 검사하지 않는다 (확정 검사 누락, 실제 오판 사례 미확인)

`src/lib/naver-schedule-submission.ts:35,52`는 HTTP 200~399이고 요청에 예약 문자열과 날짜가 있으면 confirmed=true다. `simple-agent.ts:8267-8272`에는 응답 본문이 전달되지 않는다. `:8341-8343`은 이 confirmed 값만으로 등록 성공을 반환한다. 서버가 HTTP 200의 오류 JSON/로그인 HTML 또는 3xx를 돌려도 요청 형태만 맞으면 성공으로 기록할 수 있다. `:8331-8338`의 화면 텍스트 신호 역시 특정 예약 항목의 식별자와 연결되지 않는다(화면 자체는 분석하지 않음).

검증 API `brandlinks/[id]/verify/route.ts:72` 역시 예약 여부는 DB SCHEDULED만으로 판단하여 실제 예약 목록/등록 식별자를 검증하지 않는다. 현재 자동화의 예약 등록 확인과 독립적인 사후 검증이 없다.

**수정 방향:** 확인된 Naver 응답 계약의 성공 필드/등록 ID/예약시각을 검사하고 기록한다. HTTP 성공이 비즈니스 성공을 보장하지 않는 fixture 추가. 응답 계약을 확인하지 못하면 confirmed가 아닌 unknown으로 남긴다.

## 수행한 안전 검증과 한계

1. `node scripts/verify-auto-publish-route.cjs` — PASS. 의존성 전체 mock, 메모리 VM 기반. 인증/날짜/중복/완료/취소/작업 없음 검사.
2. `node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-naver-schedule-submission.ts` — PASS. 순수 함수 fixture. 현재 검사 범위는 예약 요청 문자열과 HTTP 코드다.
3. Node stdin + TypeScript AST 추출 VM — 예약 handler의 Electron prompt 예외/API 0회/알림 0회 재현 PASS.
4. 동일 AST VM — 숫자 경로 URL 거부/타 호스트 logNo 허용/실패 click의 true 반환 재현 PASS.
5. bulk-schedule API VM — startDate 지정에도 날짜 미지정 READY 제외 및 0건 success 반환 재현 PASS.

3~5번의 재실행 가능한 소스: `docs/qa/2026-09-07-publish-audit-repro.cjs`. 실행 명령 `node docs/qa/2026-09-07-publish-audit-repro.cjs` 최종 PASS. 현재 결함을 재현하는 audit assertions이므로 수정 후에는 기대값을 정상 동작 기준으로 바꿔야 한다.

`scripts/verify-scheduled-draft-workflow.ts`는 시작 부분에서 실제 HTTP 서버를 listen하므로 이번의 서버 시작 금지 범위에 맞춰 실행하지 않았다. 화면 QA, 실제 Naver 게시/예약, 운영 DB fixture, 설치 EXE 검증도 수행하지 않았다. 위 PASS는 코드 결함 재현과 기존 단위 검증을 뜻하며 실제 발행 성공 검증이 아니다.

## 우선순위

1. 예약 prompt 제거(직접 원인, 작은 수정 범위).
2. 제출 시점/결과 불확실 상태와 재발행 보호부터 구현.
3. 클릭 성공 판정/공용 URL parser/응답 기반 발행 결과 검증.
4. 영속 job과 재시작 복구, 단계별 시간 제한.
5. 다른 분석의 초안 QC/이미지 문제 수정 결과를 동일 자동 발행 workflow의 fixture에 연결해 10건 일부 실패·중단·재개 시나리오 검증.

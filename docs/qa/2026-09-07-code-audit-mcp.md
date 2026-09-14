# MCP 전달·실행·결과 보고 코드 분석 — 2026-09-07

분석 기준: 작업 트리 HEAD `10634b6`, package 1.3.25. 운영 코드는 수정하지 않았다. 웹 화면과 브라우저는 열지 않았고 외부 MCP 작업·포스팅·이미지 생성은 실행하지 않았다.

## 호출 구조

`apps/sites/app/api/mcp/[credential]/route.ts`의 도구 검증 → Sites D1 `agent_jobs(QUEUED)` → 데스크탑 `src/app/api/remote-agent/poll/route.ts`의 claim → 로컬 API → 실행 결과 outbox 저장 → Sites `/complete` → `job_get`/`job_result_read`.

이 구조에서는 MCP 요청 접수, 실제 실행, 외부 발행, 결과 보고가 서로 다른 사건이다. 하나가 성공했다고 나머지 성공이 보장되지 않는다. 활성화/인증과 queue 전달이 정상이어도 승인·이미지·발행 코드에서 실패할 수 있다.

## M1. 영구 완료 오류가 후속 작업 수신 전체를 막는다 — P1, 재현 확인

- `src/app/api/remote-agent/poll/route.ts:1394-1415`: outbox가 있으면 새 claim보다 우선 재전송한다.
- `:1408-1409`: 성공한 경우에만 outbox를 지운다.
- `:1412-1414`: 모든 전송 오류를 `COMPLETION_DELIVERY_UNCERTAIN` 503으로 반환하고 원본 outbox를 유지한다.
- `src/lib/remote-agent-completion.ts:66-70`: 409·413·401 등 영구 오류는 같은 호출 안에서 즉시 재시도를 종료한다. 그러나 다음 poll은 같은 outbox를 다시 보낸다.
- `apps/sites/app/api/agent/jobs/[id]/complete/route.ts:29-40`: 이미 lease sweep으로 FAILED가 된 job은 이전 완료 body와 다르므로 409 `JOB_NOT_ACTIVE`를 반환한다.
- 인증 폐기 정리는 poll `:1426`의 claim 오류 분기에만 있다. pending-completion 단계의 401은 그 분기에 도달하지 못한다.

따라서 일시적인 인터넷 끊김과 영구 거절을 동일하게 처리하면서, 재시작 후에도 보관함이 복구되어 같은 요청만 반복하는 경로가 생긴다. 발행을 다시 실행하지 않는 보호 자체는 필요하지만, 관련 없는 다음 작업까지 영구 차단하는 복구 설계는 불완전하다.

**재현:** 실제 poll 모듈을 VM에 로드하고 네트워크만 mock했다. 409/413/401 각각에 대해 POST를 세 번 호출했다. 매번 503, 완료 전송 3회, 새 claim 0회, 활성화 정리 0회, outbox 잔존을 확인했다.

**현재 사용자 상태와의 구분:** 조사 시 로컬 `remote-agent-completions`는 비어 있었다. 따라서 이 결함을 현재 모든 MCP 실패의 실발생 원인이라고 단정하지 않는다. 발생 가능한 고착 경로는 코드 실행으로 확인됐다.

**수정:** 전송 재시도와 실행 재시도를 계속 분리한다. 영구 거절은 `DELIVERY_REJECTED`로 영속 격리하고 중앙 job 상태와 대조한다. 발행 불확실성은 유지하되 독립적인 읽기 작업까지 막지 않는다. 인증 폐기는 재활성화로 안내하고 원 결과는 credential 없이 보존한다. outbox 파일을 무조건 삭제하는 방식은 결과 유실과 중복 발행 위험이 있으므로 적절하지 않다.

## M2. 결과 크기 제한이 양쪽에서 다르다 — P1, 재현 확인

- 데스크탑 `remote-agent-completion.ts:9`: outbox 8 MiB 허용.
- Sites complete `route.ts:12`: 전체 body 1 MiB, `:17`: result JSON 900 KiB 제한.
- 데스크탑 `poll/route.ts:488`: 원고 전문 유지. `:815-817`의 준비 컨텍스트도 작업 결과에 포함한다.
- Sites MCP `route.ts:625-635`의 결과 페이지 나누기는 **중앙 저장 후 조회**에만 적용된다. 업로드 크기 제한을 해결하지 못한다.

**재현:** 합성 한글 result JSON 930,015 bytes(전체 body 930,047 bytes)를 로컬 outbox에 저장한 뒤 실제 complete 라우트를 호출했다. outbox는 허용하고 서버는 413 `RESULT_TOO_LARGE`를 반환했다. 900 KiB를 넘지만 전체 body 1 MiB보다 작은 결과여서 별도 result 제한에 걸렸다. 더 큰 body는 400으로 먼저 거절될 수 있다. M1과 결합하면 대형 결과 한 번으로 queue 전체가 막힐 수 있다.

**수정:** completion envelope의 제한을 공용 계약으로 맞추고 큰 본문·근거·이미지 목록은 인증된 chunk/object 저장 후 참조로 전달한다. 원고를 잘라 저장하거나 성공을 실패로 바꿔 덮는 대신 업로드/완료 승인의 무결성을 보장한다.

## M3. 자동 발행 경로의 대기에는 실제 총 제한이 없다 — P1, 코드 확인

- `poll/route.ts:1216-1227` 단건, `:1244-1253` 일괄 발행은 `for (;;)`로 로컬 running을 기다린다.
- 과거 `PUBLISH_WAIT_MS`와 `waitForPublishOutcome(:617)`는 현재 발행 분기에서 호출되지 않는다. 25분 제한이 선언돼 있다는 이유로 보호되고 있다고 볼 수 없다.
- `scripts/lib/scheduled-draft-workflow.ts:22-42`: `http.request`에 총 deadline/abort/응답 크기 제한이 없다.
- 같은 파일 `:52-55` 이미지 running 대기, `:75-83` PUBLISHING 대기 역시 끝나는 시각이 없다.
- `poll/route.ts:1389-1390`의 activeJob은 새 작업을 거부하고, 심장박동은 그동안 계속 중앙 lease를 연장한다.
- Electron watchdog `scripts/electron/main.cjs:417`의 3시간 abort는 watchdog의 HTTP 요청을 종료할 뿐이다. 로컬 workflow를 취소시키는 신호가 연결돼 있지 않다.

서버는 job을 온라인 RUNNING으로 보면서 로컬은 죽은 이미지/발행 상태를 계속 기다릴 수 있다. 이전 타임아웃 정책 테스트만 통과해도 이 새 자동 발행 경로를 검증한 것이 아니다.

**수정:** job/attempt 단계별 deadline과 heartbeat를 영속화하고, 조회·생성·제출·완료 검증을 구분한다. 제출 이후 timeout은 실패 확정 대신 `OUTCOME_UNKNOWN`으로 수렴시키고, 재발행보다 실제 결과 확인을 먼저 수행한다. 긴 정상 이미지 작업을 무조건 짧게 끊는 방식은 피한다.

## M4. 같은 요청도 JSON 키 순서가 바뀌면 idempotency 충돌 — P2, 재현 확인

- `apps/sites/lib/tool-schema.ts:86-94`: 입력 객체의 삽입 순서를 그대로 보존한다.
- MCP route `:515,520`: `JSON.stringify(args)` 문자열 전체로 동등성을 비교한다.
- 동시 요청 충돌 처리 `:538`도 같은 비교를 한다.

**재현:** 실제 `post_publish` schema로 정규화한 동일 인자에서 키 순서만 바꿨다. 원 순서는 `reused:true`, 바뀐 순서는 `IDEMPOTENCY_CONFLICT`. 네트워크/DB는 mock이고 실제 검증기와 enqueue 함수는 그대로 실행했다.

**수정:** schema 정규화 후 재귀적으로 키 정렬한 canonical payload hash를 저장한다. 같은 key·다른 의미 요청 거절은 유지한다. 단순히 새 idempotencyKey를 발급하라는 안내로 해결하면 이미 실행된 발행을 중복 요청할 수 있다.

## M5. 부가 이미지 업로드가 핵심 작업의 완료 보고를 지연시킬 수 있다 — P2, 코드 확인

- `poll/route.ts:520-525`: 이미지 업로드 fetch에 명시적인 AbortSignal/deadline이 없다.
- `:557-560`: `Promise.all`로 모든 업로드 종료를 기다린다.
- 초안 생성/제출 `:785,861`은 업로드가 끝나야 job 결과를 반환한다.

원고 저장은 성공했는데 미리보기 업로드 하나가 늘어지면 MCP는 아직 완료되지 않는다. `.catch(() => null)`은 실제로 reject된 후에만 작동한다. 플랫폼 자체 timeout의 존재 여부와 무관하게 애플리케이션이 보장하는 최대 대기시간이 없다.

**수정:** 업로드 별 제한, 동시성 제한, 실패 목록을 반환하고 이미 저장된 초안의 완료와 미리보기 업로드 완료를 분리한다. 저장/재시도 비용을 줄이기 위해 content hash 캐시를 적용할 수 있다.

## 반복 확인 문제의 MCP 측 연결

현재 `post_publish`, `post_schedule`, `post_bulk_publish`는 최소 앱 1.3.24, 자동 검수·보강·승인 경로로 선언되어 있다(MCP route `:303-347`). `confirmed=true`는 필수이나, 사용자가 이미 명시적으로 지시했다면 그것을 전달할 수 있다. **코드가 반드시 건별로 사용자에게 되묻도록 만든다고 볼 수는 없다.**

다만 전역 instructions `:34`와 개별 초안 완료 nextAction(`poll/route.ts:788-791,868-870`)은 수동 승인/사용자 확인 흐름을 안내한다. 여기에 승인 불일치, freeform 자동 revise 미지원, 실제 이미지 부족이 합쳐지면 호출 에이전트가 수동 흐름으로 돌아갈 가능성이 있다. 정확한 대화 반복 원인은 해당 대화의 tool-call 흐름을 함께 봐야 확정된다.

단일 batch 승인 범위(종류·대상·개수·발행 방식·예약 정책)를 job에 남기고 하위 작업이 그 범위를 계승하게 해야 한다. 검수 실패는 낮은 점수 강제 통과나 무한 질문 대신 구체적인 보강 작업/보류 사유로 수렴해야 한다.

## 검증 기록

- `node --test src/lib/remote-agent-completion.test.cjs apps/sites/tests/mcp-job-transport.test.cjs`: 17/17 PASS.
- `node --test docs/qa/2026-09-07-mcp-audit-repro.cjs`: 5/5 결함 재현 PASS.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0, 진단 없음.

기존 테스트는 소유권, 결과 재전송, 페이지 조회, late heartbeat 등을 검증한다. 추가 재현은 기존 테스트가 덮지 않은 영구 오류 후 다음 claim, 업로드 제한 불일치, 키 순서 동등성을 검증한다. 재현 PASS는 문제가 고쳐졌다는 뜻이 아니다.

중앙 Sites 운영 D1/계정/배포 버전, 실 MCP 호출, 외부 발행 결과는 검증하지 않았다. 확인되지 않은 인증 또는 네트워크 장애를 임의로 원인으로 확정하지 않는다.

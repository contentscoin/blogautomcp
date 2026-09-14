# MCP/Sites 전달 및 소재 2단계 구현

2026-09-07, 현재 작업 트리 구현. 외부 생성·게시·예약·배포는 실행하지 않았다.

## 변경

- `materials_prepare(productIds)`와 `materials_publish(materials[{productId,revision}],publishMode,scheduledAt?,intervalDays?,confirmed)`를 분리했다. `materials_list(jobId? 또는 sourceJobId?)`가 소재/영속 작업 상태를 조회한다. 새 도구 최소 데스크탑 버전은 1.3.26이다.
- 이전 `post_publish/post_schedule/post_bulk_*` 실행 경로는 준비 소재 목록과 선택 필요 안내만 반환한다. 원고/이미지 생성과 발행을 합친 오래된 자동 루프는 제거했다. 실제 발행은 명시적으로 선택된 productId와 64자리 revision을 전달한다.
- 원격 job ID를 로컬 작업의 sourceJobId로 연결한다. 접수 응답이 유실되면 `submissionUncertain`, `workflowPending`, `materials_list(sourceJobId)`를 반환한다. 새 작업을 자동 제출하지 않는다. MCP 하위 요청 완료와 소재 workflow 완료를 분리한다.
- canonical JSON 비교로 키 순서만 다른 요청을 같은 idempotency 작업으로 재사용한다. 이전에 저장된 JSON도 정규화하여 비교한다. revision·대상 배열 순서 등이 달라지면 충돌은 유지한다.
- 완료 전송 한도를 공용 계약으로 정의했다: 전체 완료 body 8 MiB, result 7 MiB, 인라인 900 KiB. 대형 결과는 60,000 UTF-16 코드 단위의 immutable chunk로 저장한 뒤 SHA256/총 byte/개수 참조로 완료한다. 중앙 D1 job 행에는 작은 참조만 저장하고 chunk 행으로 분산한다. 원본 완료 body는 로컬 outbox에 유지한다.
- chunk endpoint는 인증 기기·사용자·job 소유권을 검사한다. 같은 chunk 재전송은 허용하고 다른 hash/본문 충돌을 거절한다. 완료 전에 모든 chunk 순서·개수·byte·해시·JSON 무결성을 검증한다. `job_result_read`와 초안 submit의 준비 근거 해석은 참조를 복원한다. 상태만 요청해도 완료 결과를 읽을 도구 인자를 반환한다.
- 완료 409/413 등 영구 거절은 원 결과를 credential 없이 `remote-agent-completions/rejected`에 격리한다. 실행을 재시도하지 않고 다음 독립 claim을 막지 않는다. 401/403이면 결과를 보존한 뒤 인증을 해제해 재연결을 요구한다. 일시 연결 실패는 동일 완료 body만 재전송한다.
- 미리보기 이미지 업로드는 개별 20초 deadline, 동시 3개, 전체 시작 예산 20초로 제한하고 미전송 개수를 warnings로 알린다. 이미 저장된 원고/이미지를 재생성하도록 안내하지 않는다. 소재 접수/조회 HTTP는 30초로 제한한다.
- Sites dashboard는 KST를 명시하고 job ID·단계·진행률·오류를 펼쳐볼 수 있게 했다. 기록이 MCP 하위 요청이라는 범위도 표시한다.

## 검증

- `node --test src/lib/remote-agent-completion.test.cjs apps/sites/tests/*.test.cjs`: **29/29 PASS**.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/sites/tsconfig.json`: **PASS**.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **PASS**.
- `git diff --check` (MCP 소유 파일): whitespace 오류 없음. Git CRLF 변환 안내만 출력.

추가 회귀는 실제 poll/handler 함수를 mock transport로 실행해 영구 거절 후 새 claim, 인증 해제, 실행 재호출 0회를 검증한다. 인메모리 SQLite에서 큰 한글·emoji JSON의 chunk 업로드→완료→읽기 원문 복원과 다른 기기/사용자 차단·손상 hash 거절을 검증했다. 소재 handler는 준비/발행 경로 분리, sourceJobId 전달, legacy 목록-only, 접수 응답 유실의 결과 불확실 반환을 검증한다. 실제 enqueue 함수로 canonical key 순서와 revision 변경 충돌도 확인했다.

## 통합 및 운영 확인 사항

- 로컬 `/api/materials`의 sourceJobId 저장·동일 요청 재사용은 루트 담당 구현과 연결했다. release에서 Sites chunk/schema 지원과 데스크탑 1.3.26을 함께 호환 검증해야 한다. 실제 배포된 커넥터/설치 앱은 이 변경으로 갱신되지 않았다.
- 공용 한도 초과 결과는 무제한 업로드하지 않는다. outbox 허용 범위 안의 결과는 격리해 보존한다. 기존 outbox 자체의 손상/credential 포함/물리적 저장 한도 오류는 계속 fail-closed이며 운영자의 저장소 확인이 필요하다.
- 격리 완료는 중앙 성공 결과를 강제 덮어쓰는 기능이 아니다. 로컬 원결과와 중앙 terminal 상태를 대조해야 하며 실제 발행은 반복하지 않는다.
- 화면 렌더링/실제 MCP 연결/외부 게시·예약은 여기서 실행하지 않았다. 소스/타입/오프라인 통합 검증 결과와 구분한다.

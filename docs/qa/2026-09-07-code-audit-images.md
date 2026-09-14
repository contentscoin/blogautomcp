# 2026-09-07 이미지 생성 코드 분석

분석 범위는 현재 작업 트리의 코드, 오프라인 fixture, 저장된 JSON 메타데이터다. 브라우저/화면 확인, 이미지 생성, 외부 API 호출, 운영 데이터 수정은 수행하지 않았다. 기존 코드 수정은 보존했다. 아래 결함의 존재와 사용자가 겪은 특정 실행의 원인은 구분한다.

## 핵심 결론

이미지 오류는 단순히 생성 모델의 속도 문제로 설명되지 않는다. 동일 섹션의 여러 이미지가 같은 재개 식별자로 합쳐지는 확정 결함, 10분 잠금 대기보다 긴 배치 단위 점유, 전송 후 실패의 수동 복구 의존, 상품 사진 사전 검증 누락이 있다. 실제 저장 로그에서도 성공 이미지 2건이 각각 약 166초와 179초 걸렸고, 그중 프롬프트 제출 함수가 약 87~89초를 차지했다.

## 공급자와 승인까지의 흐름

| 경로 | 코드와 동작 |
|---|---|
| 데스크톱 초안 생성 후 본문 이미지 | `src/app/api/brandlinks/[id]/draft/route.ts:148-192`가 분리된 Promise로 `repairBrandPostImages` 실행. 초안 HTTP 응답은 먼저 반환한다. |
| 이미지 보충 버튼/API | `src/app/api/brandlinks/[id]/draft/images/route.ts:234-253`가 보충 완료까지 HTTP 응답을 기다린다. 일부 성공이면 `success: true`와 오류 배열이 함께 반환될 수 있다. |
| 본문 이미지 공급자 | `src/lib/brand-post-image-generation.ts:521` → `chatgpt-generate-image-batch.ts` → ChatGPT 브라우저. 본문 경로는 `OPENAI_API_KEY`/이미지 API 공급자 선택을 사용하지 않는다. |
| 최초 썸네일 | `scripts/simple-agent.ts:1039-1065` → `thumbnail-gen` → OpenAI Images API + QC. API 사용 가능성에 따라 로컬 합성 등으로 폴백한다. 본문과 다른 경로다. |
| MCP 제출 원고 | `draft/route.ts:143-162`의 설명 및 skip 처리: MCP 제출은 본문 브라우저 자동 보충을 건너뛰고 외부 생성 이미지 적용을 요구한다. |
| 승인 보류 | `src/lib/brand-post-package.ts:329-330`는 `imageGeneration.status === running` 또는 슬롯 미충족이면 이미지 작업 미완료로 판정한다. |

## I1. [P1, 오프라인 재현] 같은 섹션의 두 요청이 하나의 결과로 합쳐진다

- `src/lib/brand-post-image-repair.ts:19-28`: 한 섹션에 부족한 이미지가 2장이면 서로 다른 requestId로 2개 요청을 만든다.
- `src/lib/brand-post-image-generation.ts:238-246`: raw identity에는 섹션, 역할, prompt, 교체 대상과 참조 해시가 들어가지만 섹션 내 슬롯 번호가 없다. 같은 섹션에 추가하는 두 요청의 outStem이 같다.
- `scripts/chatgpt-generate-image-batch.ts:319`, `342-344`: 동일 outStem의 journal을 재개하므로 둘째 요청은 첫째 요청의 성공 이미지를 반환한다.
- `src/lib/brand-post-image-generation.ts:420`: 여행 본문 이미지는 raw 파일을 그대로 반환한다.
- `src/lib/brand-post-package.ts:598-599`: 첫째 이미지 적용 후 둘째는 동일 SHA256 오류로 거부된다.
- 실제 지원 계약: `src/lib/post-composition-contract.ts:287`에는 최소 2장의 여행 핵심 방문지 섹션이 있다. 즉 이 문제는 지원되지 않는 인위적 입력에만 해당하지 않는다.

결과: 최소 2장이 필요한 빈 여행 섹션에 1장만 반영된다. 보충을 다시 요청해도 기존 raw/journal을 재사용해 같은 SHA를 반환하므로 승인이 계속 막힐 수 있다.

수정 방향: draft → section → image-slot의 안정적인 슬롯 ID를 먼저 만들고, prompt/identity/체크포인트/적용까지 전달한다. 무작위 requestId를 해시에 넣기만 하면 재개 기능을 잃으므로 재시도에도 같은 슬롯 ID를 유지해야 한다. 서로 다른 슬롯에는 다른 구도/대상 prompt도 부여한다.

회귀 시나리오: 최소 2장 여행 섹션 + 이미지 0장 → 서로 다른 이미지 2장 적용 → 재시도는 생성 없이 완료; 도중 첫째 성공/둘째 실패 → 둘째만 복구.

## I2. [P1, 코드로 확정되는 조건부 실패] 배치가 전역 프로필을 오래 점유해 다른 글의 이미지가 실패한다

- `scripts/lib/chatgpt-browser.ts:375`, `403-407`, `425-431`: 단일 프로필 잠금을 context 생성에서 얻고 close까지 보유한다.
- `scripts/chatgpt-generate-image-batch.ts:342-377`: context를 모든 이미지 작업에서 재사용하며 배치 종료 때만 close한다. 이미지들은 직렬 실행된다.
- `scripts/lib/chatgpt-profile-lock.ts:87-93`, `150`: 모든 작업은 같은 `chatgpt-profile.lock`을 기다리고 기본 600초 뒤 `CHATGPT_BROWSER_BUSY`를 던진다.
- `src/lib/brand-post-image-repair.ts:34-60`: 실행 제한은 글 ID별 Set이다. 서로 다른 글들은 각각 worker를 실행할 수 있어 전역 대기열 역할을 하지 못한다.

결과: 첫 글의 이미지 배치가 10분 넘게 걸리는 동안 다른 글들이 실행되면 후속 worker는 실제 이미지를 한 장도 만들기 전에 잠금 시간 초과로 실패한다. 10개 자동 요청을 병렬/빠른 연속으로 받으면 이 구조가 문제가 된다. 현재 저장 로그만으로 해당 잠금 실패가 실제 일어났다는 것까지 확인하지는 않았다.

수정 방향: 프로필별 durable queue에서 글/슬롯 순서와 대기 상태를 관리한다. 잠금 대기를 사용자 오류로 처리하지 말고 queued로 표시하며, API는 jobId를 반환한다. 다중 worker를 먼저 띄워 잠금에서 대기시키는 구조를 피한다. 단순히 timeout을 늘리는 것은 실행 시간을 늘릴 뿐 처리량을 개선하지 않는다.

회귀 시나리오: 글 10개 동시 제출 + 첫 배치 11분 → 후속 글이 busy 실패하지 않고 queued 유지; 재시작 후에도 중복 제출 없이 재개.

## I3. [P1, 코드 확인] 전송 후 실패는 자동 재개 불가이며 복구 연결 정보가 부족하다

- `scripts/chatgpt-generate-image-batch.ts:237-240`, `350`: 원격 전송 전에 attempted journal을 fsync한다. 중복 생성 방지 자체는 올바른 보호다.
- `:301`: 전송 후 모든 실패는 `retryable: false`가 된다.
- `:101-112`: 유효한 성공 파일이 없는 attempted/전송 후 실패를 읽으면 `IMAGE_RESUME_REQUIRED`를 반환한다. 다음 보충 요청도 같은 raw identity를 사용한다.
- `:288-295`: 실패 진단에는 단계/시간/분류만 남는다. conversation/remote job 식별자를 journal에 저장하지 않는다.
- `src/app/api/brandlinks/[id]/draft/images/route.ts:153-175`에는 외부 이미지 수동 적용 경로가 있으나, 기존 전송 작업을 찾아 다운로드만 재개하는 자동 경로는 조사 범위에서 확인되지 않았다.

결과: 생성은 끝났지만 다운로드가 실패한 경우도 매번 보충 버튼을 누르는 것으로 해결되지 않는다. 기존 결과 확인/수동 적용을 요구하므로 10개 자동 흐름이 사람에게 다시 묻게 된다. 중복 비용을 피하는 정책은 유지하되 복구 동작이 필요하다.

수정 방향: 전송 요청 ID, 대화/산출물 참조를 개인정보 보호 저장소에 보관하고 `submitted → artifact_ready → downloaded → applied` 상태를 분리한다. 불확실한 작업은 재전송 대신 기존 산출물 조회/다운로드를 재개한다. 재전송이 꼭 필요한 경우에만 기존 사용자 승인의 범위와 횟수 정책을 적용한다.

회귀 시나리오: 전송 성공 후 다운로드 실패, 저장 직전 프로세스 종료, 서버 성공/응답 유실 각각에 대해 추가 생성 없이 기존 결과 복구.

## I4. [P2, 코드 확인] 쇼핑 원본 사진이 없어도 배경 생성부터 수행한다

- `src/lib/brand-post-image-generation.ts:506-521`은 섹션/기존 asset 대상만 확인한 후 배치 실행한다.
- `:530`에서 배경 결과를 얻은 뒤 finishing을 시작한다.
- `:423-425`에서야 검증된 상품 사진을 조회하고 없으면 실패한다.

결과: 적용이 불가능한 쇼핑 초안도 각 슬롯마다 브라우저 이미지 생성 시간과 리소스를 쓴 뒤 실패한다. 동일 제품 사진 검색/검증도 각 이미지 finishing에서 반복된다. 실제 사용자의 실패 중 이 조건에 해당하는 비율은 미확인이다.

수정 방향: 쇼핑 원본을 배치 전 한 번 검증하고 선택한 파일과 해시를 generation context에 고정한다. 검증 실패면 생성 worker를 띄우지 않고 `PRODUCT_SOURCE_REQUIRED`처럼 직접 해결 가능한 이유를 반환한다.

회귀 시나리오: 원본 없음/상품 검증 실패에서 provider 호출 0회; 정상 원본은 N개 이미지 배치에 한 번 검증; 도중 원본 교체는 이전 해시로 일관성 유지 또는 안전한 중지.

## I5. [P2, 코드 확인] 작업 생존 상태는 메모리, 승인 차단 상태는 디스크에 저장된다

- `src/lib/brand-post-image-repair.ts:34-36`: activeJobs/controllers는 현재 Node 프로세스의 globalThis에만 존재한다.
- `:81-91`: manifest에는 running 상태가 저장된다.
- `src/lib/brand-post-package.ts:329`: running이면 슬롯이 채워져도 승인 보류 조건이다.
- `src/app/api/brandlinks/[id]/draft/route.ts:195-203`: 조회는 저장 패키지만 반환한다. 조사한 image repair 경로에 startup reconciliation/heartbeat/lease 복구는 없다.

결과: 앱/서버가 도중 종료되면 작업을 소유한 프로세스는 사라져도 running 표시가 남을 수 있다. 상태 복구 없이 승인 차단이 지속된다. 운영 데이터의 attempted-only 기록은 실행 중인 다른 작업일 수도 있어 크래시 증거로 단정하지 않는다.

수정 방향: durable job에 worker PID/lease/heartbeat를 두고 시작 시 살아 있는 소유자와 checkpoint를 대조한다. 소유자가 없는 running은 recoverable/incomplete로 전환하고 결과 저장은 재개한다.

## I6. [P2, 코드 확인] 손상된 마지막 journal 한 줄이 복구 가능한 이전 성공도 막는다

- 부모 `src/lib/brand-post-image-generation.ts:290-294`는 불완전한 마지막 JSONL을 무시한다.
- worker `scripts/chatgpt-generate-image-batch.ts:92`는 모든 non-empty line에 즉시 JSON.parse를 수행한다.
- 완성된 성공 기록 뒤의 부분 JSON 한 줄도 예외를 일으키며 전체 배치 catch로 이어진다(`:367-370`).

수정 방향: 완성된 JSONL prefix를 읽고 마지막 미완성 행은 손상 상태로 보존한다. 검증된 성공은 회수하되 마지막 attempted가 불확실한 슬롯은 재전송하지 않는다. 임의 기록 삭제는 해결책이 아니다.

## 시간 예산과 실제 저장 로그

기본 코드값(`scripts/lib/image-timeout-policy.ts:2-8`, `24-34`):

- 이미지 1장 예산 = 준비 300초 + 생성 hard 600초 + 다운로드 2×60초 + retry delay 2초 + 여유 30초 = **1,052초(17분 32초)**.
- 배치 부모 deadline = 잠금 600초 + startup 180초 + N×1,052초.
- 1장: **30분 32초**, 6장: **1시간 58분 12초**, 10장: **3시간 8분 20초**, 11장: **3시간 25분 52초**.
- 10개 글 × 글당 10장, 글별 배치를 직렬 처리한다고 가정하면 부모 예산 합은 **31시간 23분 20초**다. 이는 평균/예측치가 아니라 실패/최악 조건을 허용하는 계산이다. 병렬 제출은 I2 잠금 timeout으로 실패할 수 있어 이 시간을 그대로 병렬 완료 예측에 쓰면 안 된다.
- 부모 `complete()`는 timer를 지운 뒤 finishing/persistence deliveries를 기다린다(`brand-post-image-generation.ts:301-322`). 따라서 이 계산은 엄밀한 전체 API 응답 상한도 아니다. 로컬 후처리/저장이 멈추면 별도 제한이 필요하다.

읽기 전용 운영 메타데이터는 `%APPDATA%/brandconnect-automation/data/prepared-brand-posts/a38ba6af-1a78-410a-b557-86c8c8e65e71/image-generation-work/resume-v1/`에서 확인했다. 프롬프트, 계정, 이미지 내용은 출력하지 않았다.

| 저장 결과 | 전체 경과 | before-submit → after-submit | beforeSend → 결과 저장 |
|---|---:|---:|---:|
| job 0 | 165.600초 | 7.189 → 94.260초, 약 87.071초 | 약 72.394초 |
| job 1 | 179.497초 | 7.815 → 97.145초, 약 89.330초 | 약 84.654초 |

두 성공 결과 파일은 존재했다. 세 번째 슬롯에는 2026-09-07T04:10:09.476Z attempted 기록만 확인했다. 현재 진행 중일 가능성이 있으므로 실패로 분류하지 않았다. 실패 JSON은 이 표본에서 발견하지 못했다.

`scripts/lib/chatgpt-browser.ts:632-665`의 제출 함수에는 composer 대기, contenteditable 글자별 `keyboard.type(delay: 2)`, send-ready 대기가 있다. 저장된 prompt는 약 2천 자다. 약 87~89초 제출 구간은 관측됐지만 하위 단계별 시각이 없어 정확한 병목을 글자 타이핑 하나로 확정할 수는 없다. 추가 계측 지점은 composer-ready / input-start / input-end / send-ready / dispatch다. 입력 전략 변경은 입력 내용 일치와 단일 전송 보장을 함께 검증해야 한다.

## 썸네일 경로의 별도 위험

본문 batch와 다른 API 경로가 존재한다. `scripts/lib/thumbnail-gen/generate.ts:44-46`, `63-89`은 기본 최대 4회 생성/QC를 허용한다. `scripts/lib/openai-image.ts:30-33`의 API 제한은 요청당 기본 120초이며 모델 접근 오류 때 후보 모델로 추가 시도한다(`:111-134`). 생성 API 시간만 단순 합산하면 4회 × 후보 2개 × 120초 = 최대 960초이며 QC와 파일 처리는 별도다. 단, 생성 자체가 null이면 첫 실패에서 중단하므로 매 실행이 8회 호출되는 것은 아니다.

`scripts/lib/thumbnail-gen/qc.ts:105-117`, `158-161`은 QC 오류/검사 불가를 `checked:false, pass:true`로 처리한다. 이미지 생성 성공과 검증 성공을 분리해야 한다. 이 경로는 속도뿐 아니라 썸네일 품질 신뢰성에도 영향을 준다. 공급자 API의 현재 모델 유효성/계정 권한은 외부 호출을 하지 않았으므로 평가하지 않았다.

## 확인된 개선과 검증 범위

현재 코드에는 이미 부분 성공 즉시 저장, checkpoint polling, 하드 생성 deadline, 타임아웃 후 추가 슬롯 계속 처리, 모호한 전송의 중복 요청 방지, 로그인 명시 오류만 fail-fast 등의 개선이 있다. 따라서 '이미지 1장 실패하면 나머지를 항상 중단한다' 또는 '무제한 원격 재생성'을 현재 본문 batch의 원인으로 보고하지 않는다.

실행한 안전한 검증:

1. `node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-image-timeout-policy.ts` — 실제 wait/submit 함수를 fake page/clock으로 검증; 3 PASS 묶음.
2. `scripts/verify-image-batch-progress.ts` — 의존성/worker를 VM fake로 대체한 23개 검사 전부 PASS. temp fixture 삭제 직전에 절대 경로가 OS temp 하위이며 `verify-image-batch-` 이름인지 추가 검사했다.
3. 위 harness를 메모리에서만 변형한 오프라인 probe — 같은 section에 서로 다른 요청 2개를 넣고 서로 다른 transport ID이면서 동일 prompt/outStem임을 assert; **REPRODUCED**. 디스크의 테스트/운영 소스는 변경하지 않았다. 재실행 파일: `docs/qa/2026-09-07-image-audit-repro.cjs`. 명령 `node docs/qa/2026-09-07-image-audit-repro.cjs` 직접 실행 결과 exit 0, `PASS defect reproduced`. 여기서 PASS는 수정 성공이 아니라 결함 재현 성공을 뜻한다.

실행하지 않은 검증: 실제 브라우저, 실제 이미지 생성/비용 지출, 네이버 게시, 계정/세션 조작, 운영 checkpoint 수정. 이번 문서는 원인 분석 결과이며 코드 수정 완료 또는 운영 정상화를 주장하지 않는다.

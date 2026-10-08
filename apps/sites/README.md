# BlogAutoMCP Sites

ChatGPT와 한 대의 Windows 로컬 에이전트를 연결해 네이버 브랜드커넥트의 쇼핑커넥트·여행커넥트 작업을 지시하는 OpenAI Sites 애플리케이션입니다.

## 운영 구조

- Sites의 ChatGPT 로그인으로 계정을 식별합니다.
- `hiway@kakao.com` 계정만 관리자로 자동 지정됩니다.
- 일반 사용자는 D1에 승인 대기로 등록되고 관리자가 승인합니다.
- ChatGPT에는 고정 주소 `/api/mcp`를 등록하고, Site에서 로그인한 GPT 계정으로 OAuth 2.1 인증합니다.
- OAuth는 authorization code + PKCE(S256), 짧은 access token, 회전되는 refresh token을 사용합니다.
- API 키 없는 초안은 PC가 상품 사실·이미지·하네스를 준비하고 현재 ChatGPT가 원고 JSON을 만든 뒤, PC가 검증·이미지 배치·승인 대기 패키지를 만드는 2단계 MCP 흐름으로 처리합니다.
- ChatGPT OAuth는 OpenAI API 과금 자격 증명을 PC에 전달하지 않으며, 이 MCP 흐름은 PC의 `OPENAI_API_KEY`를 읽거나 호출하지 않습니다.
- Windows 앱은 별도의 일회성 PC 연결 주소로 인증합니다.
- PC 연결 주소를 다시 발급하면 기존 주소, PC 토큰, 대기·진행 작업이 폐기됩니다.
- 새 PC가 연결되면 기존 PC 인증과 기존 PC의 진행 작업이 폐기됩니다.
- 실제 즉시 발행과 예약 발행은 MCP 도구에 `confirmed=true`가 있어야 큐에 들어갑니다.
- 활성 PC는 중앙 업데이트 채널을 주기적으로 확인하고, 진행 중 작업이 끝난 뒤 새 버전을 자동 설치합니다.

## Windows 중앙 배포

관리자 페이지의 `자동 업데이트 배포`에서 electron-builder가 만든 아래 세 파일을 선택해 배포할 수 있습니다.

- `latest.yml`
- `BrandConnect-Automation-Setup-x.y.z.exe`
- `BrandConnect-Automation-Setup-x.y.z.exe.blockmap`

배포 전 브라우저가 설치 파일 SHA-512를 직접 확인합니다. 서버는 현재 버전보다 높은 안정 버전만 허용하며, 파일을 모두 R2에 저장한 뒤 `latest.yml`을 활성화합니다. 배포 API는 관리자 ChatGPT 계정 또는 `INSTALLER_UPLOAD_KEY`로만 접근할 수 있습니다.

빌드 서버에서는 같은 절차를 다음 명령으로 실행할 수 있습니다.

```powershell
$env:INSTALLER_UPLOAD_KEY = '배포 비밀값'
npm run update:verify -- ..\..\out
npm run update:publish -- https://blogautomcp.hiway350051.chatgpt.site ..\..\out
```

업데이트 API가 사이트에 한 번 배포된 뒤에는 새 PC 버전을 올릴 때마다 사이트 코드를 다시 배포할 필요가 없습니다.

## 로컬 개발

```powershell
npm install
npm run dev
```

로컬 Sites 로그인은 개발용 계정으로 동작합니다. 전체 품질 검증은 개발 서버가 실행 중이고 로컬 계정이 승인된 상태에서 실행합니다.

```powershell
pwsh -NoProfile -File scripts/verify-quality.ps1
npm run build
```

`verify-quality.ps1`은 TypeScript, ESLint, 운영 의존성 감사, MCP 초기화, 단일 PC 교체, 여행커넥트 작업 생명주기, API 키 없는 2단계 ChatGPT 초안 제출, 발행 확인 게이트, 멱등성, MCP 회전을 검증합니다.

OAuth 전용 검증은 개발 서버 주소에 맞춰 실행합니다.

```powershell
pwsh -NoProfile -File scripts/verify-oauth-e2e.ps1 -BaseUrl http://localhost:3000
```

## 데이터

D1 테이블 정의는 `db/schema.ts`, 런타임 안전 초기화는 `db/init.ts`, 배포 마이그레이션은 `drizzle/`에 있습니다. 별도의 PostgreSQL 서버는 필요하지 않습니다.

## MCP 도구 (서버 1.3.13 · 36개)

`bug_report_create`, `bug_report_get`, `agent_get_status`, `brandconnect_list_categories`, `brandconnect_list_products`, `brandconnect_sync_products`, `post_create_draft`, `post_prepare_draft`, `post_generate_draft_local`, `post_submit_draft`, `post_apply_section_image`, `post_get_draft`, `post_revise_draft`, `post_approve_draft`, `post_set_thumbnail`, `thumbnail_prepare`, `thumbnail_apply_generated`, `blog_profile_get`, `blog_profile_prepare_update`, `blog_profile_apply_update`, `blog_design_get`, `materials_list`, `materials_prepare`, `materials_rewrite_failed`, `materials_repair_blocked`, `materials_publish`, `post_publish`, `post_schedule`, `post_bulk_schedule`, `post_bulk_publish`, `post_verify_published`, `travel_capture_contract`, `settings_get`, `job_get`, `job_result_read`, `job_cancel`.

- ChatGPT 커넥터는 OAuth 고정 주소(`/api/mcp`)와 MCP URL(`/api/mcp/{credential}`) 두 경로로 연결할 수 있으며 같은 도구를 제공합니다.
- `materials_rewrite_failed`는 PC 앱 1.3.98 이상에서 실패한 소재 글을 일괄 재작성하고 현재 원고·이미지 품질검사를 통과한 항목만 준비 완료로 저장합니다. `productIds` 생략 시 현재 실패 소재 전체를 선정하며 `connectKind`로 쇼핑·여행을 제한합니다. 준비만 수행하므로 발행 확인이나 예약일을 받지 않습니다. 같은 요청에는 같은 `idempotencyKey`를 유지합니다.
- `materials_repair_blocked`는 PC 앱 1.3.99 이상에서 `materials_list`의 `repairCandidates` 중 보완 필요 소재를 처리합니다. 정상 원고·이미지를 보존하고 부족한 부분만 보완하며 전체 재작성·새 초안 생성은 하지 않습니다. 품질·이미지·승인 검사를 모두 통과한 항목만 준비 완료입니다. `productIds`는 선택적으로 1~50개를 지정하고 생략 시 PC의 현재 보완 대상 전체를 선정합니다. `connectKind`로 쇼핑·여행을 제한할 수 있습니다. 발행·예약 옵션은 받지 않습니다.
- `/dashboard`의 **보완 필요 소재 전체 보완·검증** 버튼은 쇼핑·여행·전체를 선택해 승인 계정의 온라인·유휴 PC로 동일한 작업을 전달합니다. API는 `POST /api/materials/repair-blocked`, 본인 작업 조회는 `GET ?jobId=...`, 최종 결과 재조회는 원 접수 `repairJobId`와 동일 요청 키를 `PATCH`로 전달합니다. PATCH는 원 보완 작업에 연결된 `MATERIALS_LIST` 읽기 작업만 접수하고 GET은 큐를 만들지 않습니다. 응답 유실·새로고침 시 원래 대상·상품 ID·멱등 키를 계정별 저장소에서 복원합니다. `workflowPending=true`는 PC에서 보완 중이라는 뜻이며 접수 성공과 실제 준비 완료를 구분합니다.
- `/dashboard`의 **실패 소재 전체 재작성·검증** 버튼은 로그인한 승인 계정의 온라인·유휴 PC에 동일한 큐 작업을 전달합니다. 웹 요청과 MCP 요청은 스키마·멱등성·최소 버전·활성 PC·연결 세대·진행 작업 검사를 공유합니다. 접수 직전 승인 취소, PC 교체, MCP 주소 회전, 동시 다른 작업이 발생하면 조건부 INSERT가 작업 접수를 막습니다.
- 웹 복구 요청번호와 대상은 계정별 브라우저 저장소에 보관됩니다. 응답을 확인하지 못했거나 페이지를 새로고침해도 같은 대상·키로 재확인하며, 이미 접수한 작업은 같은 작업번호로 조회를 이어갑니다. 브라우저 저장소를 사용할 수 없으면 복구 작업을 시작하지 않습니다.
- 재작성·보완 패널은 미확인 요청과 실제 PC 진행 상태를 공유합니다. 한쪽 요청이 미확인·진행 중이면 다른 쪽에서 새 요청을 만들지 않으며, 클릭 직전 저장 상태도 다시 검사합니다. 원래 미확인 요청은 같은 대상·키로 재확인할 수 있습니다. `job_get`의 접수 성공만으로 공유 잠금을 풀지 않고 최종 `workflowPending=false`를 확인합니다.
- 웹 API는 `POST /api/materials/rewrite-failed`로 접수하고 `GET ?jobId=...`로 본인 작업만 조회합니다. MCP 접수 작업이 성공해도 `workflowPending=true`이면 PC에서 재작성·검증이 계속 중입니다. **최종 소재 결과 조회**는 원래 재작성 작업번호를 기준으로 `PATCH`하여 `MATERIALS_LIST` 읽기 작업을 한 번 접수합니다. GET은 큐 작업을 생성하지 않으며 검증 결과의 준비·실패·중단 개수만 표시합니다. ChatGPT에서는 `workflowJobId`를 `materials_list(jobId)`로 전달해 최종 상태를 확인합니다.
- 초안은 ChatGPT 가 씁니다. `post_create_draft`(= `post_prepare_draft`, 큐 작업 `POST_PREPARE_DRAFT`)는 PC 에서 상품 사실·상세이미지·하네스·프롬프트만 준비하고, ChatGPT 가 쓴 원고를 `post_submit_draft` 로 제출하면 PC 는 품질검사·저장만 합니다(이미지 생성 없음). 섹션 이미지는 결과 `imageSlots[].imagePrompt` 로 ChatGPT 내장 이미지 생성을 실행해 `post_apply_section_image` 로 붙입니다. 제출은 `contextJobId`의 상품 스냅샷을 고정해 목록 재조회 중 상품명·URL이 바뀌어도 다른 상품 데이터와 섞이지 않습니다.
- `post_submit_draft` 는 준비 작업 결과에서 상품 스냅샷을 최상위(`snapshot`)와 1.3.10 형태(`context.snapshot`) 양쪽에서 찾고, PC 에는 검증에 필요한 슬림 컨텍스트만 전달합니다.
- `post_generate_draft_local`(큐 작업 `POST_CREATE_DRAFT`, PC 1.3.10 이상)은 OpenAI 키가 있는 PC 의 전량 생성 경로입니다. `post_apply_section_image`는 여행에 PC 1.3.10 이상, 쇼핑 자연사진에 PC 1.3.97 이상이 필요합니다. 쇼핑은 실제 상품 참조 이미지와 순서가 일치하는 `referenceHashes`를 사용하며 본문 텍스트·정보 카드·프레임·콜라주를 허용하지 않습니다. 구버전 PC의 초안 조회와 기존 승인은 유지하며, 지원 여부는 `agent_get_status.capabilities.shoppingReferenceScenes`로 확인합니다.

- 큐 작업은 claim 시 120초 임대를 받고, PC 가 30초마다 하트비트로 임대를 연장하며 진행 단계(`stage`)를 올립니다. 임대가 끊기면 `AGENT_LOST` 로 회수됩니다.
- PC 1.3.100은 인증된 읽기 전용 `GET /api/agent/jobs/claim`으로 `blogautomcp.claim/v2` 지원을 확인합니다. 지원 서버에서는 PC에 먼저 저장한 `claimRequestId`와 동일한 기기·요청의 작업 배정만 복구하므로 claim 응답이 유실되어도 다른 작업을 추가로 가져오지 않습니다. 배정과 빈 큐 결과는 변경 불가능한 요청 기록에 하나의 트랜잭션으로 저장하며, 빈 큐 응답 뒤 도착한 지연 요청도 나중에 추가된 상품 작업을 가져오지 않습니다. PC는 실행 시작 기록을 저장한 뒤 작업을 수행하며, 시작 기록만 남은 작업은 자동 재실행하지 않습니다. 취소·만료·완료된 배정도 실행 대상으로 돌려주지 않습니다. 구버전 Sites에서는 기존 claim 형식을 유지하되 응답 유실 시 새 claim을 중단하므로, 같은 요청의 자동 배정 복구에는 Sites 업데이트도 필요합니다.
- 결과는 `blogautomcp.job-result/v1` 봉투(`summary`, `data`, `readiness`, `warnings`)이며 PC 파일 경로를 포함하지 않습니다. 실패 코드는 `docs/mcp-saas-local-agent-product-plan.md` 상단 표를 참고하세요.
- 도구 인자는 선언한 JSON 스키마로 서버에서 검증하고, 새 도구는 데스크톱 최소 버전(`minAppVersion`, 1.3.0)을 요구합니다. 미달 PC 에는 `APP_UPDATE_REQUIRED` 를 돌려줍니다.
- 레이트리밋: MCP IP 600회/분, 호출 120회/분, 페어링 10회/분/IP, MCP URL 발급 5회/분/사용자.

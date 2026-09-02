# BlogAutoMCP Sites

ChatGPT와 한 대의 Windows 로컬 에이전트를 연결해 네이버 브랜드커넥트의 쇼핑커넥트·여행커넥트 작업을 지시하는 OpenAI Sites 애플리케이션입니다.

## 운영 구조

- Sites의 ChatGPT 로그인으로 계정을 식별합니다.
- `hiway@kakao.com` 계정만 관리자로 자동 지정됩니다.
- 일반 사용자는 D1에 승인 대기로 등록되고 관리자가 승인합니다.
- 승인된 사용자는 한 번만 표시되는 MCP URL 하나를 발급받습니다.
- MCP URL을 다시 발급하면 기존 URL, PC 토큰, 대기·진행 작업이 폐기됩니다.
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

`verify-quality.ps1`은 TypeScript, ESLint, 운영 의존성 감사, MCP 2025-11-25 초기화, 단일 PC 교체, 여행커넥트 작업 생명주기, 발행 확인 게이트, 멱등성, MCP 회전을 검증합니다.

## 데이터

D1 테이블 정의는 `db/schema.ts`, 런타임 안전 초기화는 `db/init.ts`, 배포 마이그레이션은 `drizzle/`에 있습니다. 별도의 PostgreSQL 서버는 필요하지 않습니다.

## MCP 도구 (서버 1.2.0, 17개)

`agent_get_status`, `brandconnect_list_categories`, `brandconnect_list_products`, `brandconnect_sync_products`, `post_create_draft`, `post_get_draft`, `post_revise_draft`, `post_approve_draft`, `post_set_thumbnail`, `post_publish`, `post_schedule`, `post_bulk_schedule`, `post_verify_published`, `travel_capture_contract`, `settings_get`, `job_get`, `job_cancel`.

- 큐 작업은 claim 시 120초 임대를 받고, PC 가 30초마다 하트비트로 임대를 연장하며 진행 단계(`stage`)를 올립니다. 임대가 끊기면 `AGENT_LOST` 로 회수됩니다.
- 결과는 `blogautomcp.job-result/v1` 봉투(`summary`, `data`, `readiness`, `warnings`)이며 PC 파일 경로를 포함하지 않습니다. 실패 코드는 `docs/mcp-saas-local-agent-product-plan.md` 상단 표를 참고하세요.
- 도구 인자는 선언한 JSON 스키마로 서버에서 검증하고, 새 도구는 데스크톱 최소 버전(`minAppVersion`)을 요구합니다. 미달 PC 에는 `APP_UPDATE_REQUIRED` 를 돌려줍니다.
- 레이트리밋: MCP IP 600회/분, 호출 120회/분, 페어링 10회/분/IP, MCP URL 발급 5회/분/사용자.

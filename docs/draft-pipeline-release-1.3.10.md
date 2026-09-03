# 1.3.10 — 초안 파이프라인 정체·품질 0점 수정

## 증상 (1.3.9)

- `POST_CREATE_DRAFT` 작업이 `progress=10, stage=drafting` 에서 17~19분 멈춘 뒤 본문 이미지 6장 전부 `ChatGPT 생성 이미지 다운로드 결과가 비어 있습니다.` 로 끝났다(`imageGeneration {requested:6, applied:0, remaining:6}`).
- 같은 초안의 품질 점수가 55점이고 `productEvidence 0/25`, `sceneLinkage 0/20` — 수집 데이터에 상품명·소재·용도·가격이 있는데도 검사기가 근거를 보지 못했다.
- 사이트 MCP 는 `post_create_draft`(PC 전량 생성)와 2단계 경로(`post_prepare_draft → post_submit_draft`)를 둘 다 노출했고, 안내문은 2단계를 예외 경로로 설명했다.

## 원인

1. 초안 라우트가 `autoRepairSectionImages` 를 `await` 해 숨은 Chrome 이 chatgpt.com 을 6번 순차 왕복했다(기본 켜짐, 설정 UI 에 없음, 브라우저 자동화 플래그 무시). 장당 1.5~3분, 배치 타임아웃 8분×장수, 로컬 HTTP 데드라인 3시간이라 아무것도 먼저 끊지 않았다.
2. 배치는 plain ChatGPT 에 커스텀 GPT 용 확인 핸드셰이크를 보냈고, 이미지 대기가 0 을 돌려줘도 다운로드를 시도해 빈 결과로 끝났다. 첫 실패 뒤에도 남은 작업을 전부 돌렸다.
3. 모든 섹션이 생성 이미지 1장을 요구하고 원본 사진은 생성 완료로 세지 않아 섹션 6개 = 생성 요청 6개였다.
4. 진행률은 작업 시작 시 한 번만 기록됐고 하트비트가 같은 값을 반복 전송했다.
5. 품질 검사기: 키워드 태그(`meta[name=keywords]`)만 있는 상품은 `verifiedSignals` 가 비는데 `requiredSignalCount` 를 1 로 강제해 0/25 가 확정됐고, 판단 문장을 신호에서만 세서 0/20 도 확정됐다. 가격·원가·쿠폰은 검사기 입력에 없었고, MCP `evidenceFacts` 는 로그만 남기고 버렸다.

## 변경

### 데스크톱 (1.3.10)

- `src/app/api/brandlinks/[id]/draft/route.ts`: 자동 섹션 이미지 보충을 `scheduleSectionImageRepair` 로 교체. 기본 꺼짐(`BRAND_POST_AUTO_SECTION_IMAGES=false`), 켜져 있어도 응답 뒤 분리 실행, `CHATGPT_BROWSER_AUTOMATION_ENABLED=false` 면 Chrome 을 열지 않음, MCP 제출(`submit_generated`·`origin:"mcp"`)은 항상 건너뜀. 응답에 `imageRepairScheduled`·`imageRepairRemaining` 추가. 단계별 `progress.json` 기록.
- `src/app/api/brandlinks/[id]/draft/images/route.ts`: `action:"apply_generated"`(패키지 디렉터리 안의 파일을 슬롯에 적용) 추가. 브라우저 배치 액션은 자동화가 켜진 경우에만.
- `src/lib/brand-post-image-generation.ts`: `runBrowserImageBatch` 자동화 게이트(spawn 전 거부), 배치 타임아웃 = 장수×`BRAND_POST_IMAGE_JOB_TIMEOUT_MS`(기본 3분)+60초(최대 30분), `applyExternalGeneratedBrandPostImage`(잠금 합성 → 적용 → 같은 원본은 `alreadyApplied`).
- `scripts/chatgpt-generate-image-batch.ts`: `BRAND_POST_IMAGE_BATCH_FAIL_FAST`(기본 true) — 첫 실패 뒤 남은 작업을 `fail-fast:` 사유로 기록하고 종료. 이미지 대기 0 은 실패.
- `src/lib/draft-progress.ts`(신규): 패키지 디렉터리의 `progress.json`. 초안 라우트·`simple-agent` 가 단계(facts 15 → images 25 → context 35 → generate 50 → qc 80 → save 90 → done 100)마다 기록하고, 데스크톱 실행기 하트비트가 읽어 사이트 작업 진행률로 전달(파일이 없으면 경과 분 폴백).
- `src/app/api/remote-agent/poll/route.ts`: `POST_PREPARE_DRAFT` 결과 최상위에 `verifiedFacts`·`sourceImages`·`harness`·`systemPrompt`·`userPrompt`·`imageIntents`·`contextJobId`(원본은 `context`). 로컬 호출 데드라인 `REMOTE_DRAFT_PREPARE_WAIT_MS`(10분)·`REMOTE_DRAFT_GENERATE_WAIT_MS`(30분). 봉투가 `contentQuality` 를 실제로 내보냄. `imageSlots` 는 경로 없이 `assets[].assetKey` 와 슬롯별 `imagePrompt`·`generationRole` 포함. 신규 `POST_APPLY_SECTION_IMAGE`(허용 호스트 다운로드 → `apply_generated`).
- 품질 검사(`scripts/lib/product-editorial-plan.ts`, `brandlink-content-readiness.ts`, `writing-prompt-contract.ts`, `simple-agent.ts`): 신호가 없으면 없는 신호를 요구하지 않고 상품명 토큰을 판단 앵커로 사용, `가격:`·`원가:`·`쿠폰/혜택:` 사실 줄과 스냅샷의 원가·쿠폰을 채점 입력에 포함, 원 단위 가격을 수치 근거로 인정, MCP `evidenceFacts` 중 스냅샷과 대조해 근거가 있는 항목만 이번 제출 채점에 반영(저장은 하지 않음).
- 설정: `BRAND_POST_AUTO_SECTION_IMAGES`(고급, 기본 꺼짐) 노출. `.env.example` 에 새 env 5개.

### 사이트 MCP (서버 1.3.10, 도구 27개)

- `post_create_draft` → `POST_PREPARE_DRAFT`(컨텍스트 준비 전용, `qualityPreset`·`experienceMode`·`experienceNotes` 입력). `post_prepare_draft` 는 같은 정의의 별칭.
- 신규 `post_generate_draft_local`(`POST_CREATE_DRAFT`, PC 1.3.10+), 신규 `post_apply_section_image`(`POST_APPLY_SECTION_IMAGE`, PC 1.3.10+).
- 안내문: 기본 흐름 = `post_create_draft` → ChatGPT 작성 → `post_submit_draft` → `post_get_draft`(imageSlots·imagePrompt) → ChatGPT 내장 이미지 생성 → `post_apply_section_image` → `post_approve_draft` → 발행. 이미지 부족은 재제출 사유가 아님.
- 썸네일 도구에 `minAppVersion 1.3.0`. 1.3.10 미만 PC 의 제출·준비 작업에는 업데이트 권고 `warning`.

## 배포 순서

1. 사이트(`apps/sites`) 먼저 배포. 1.3.9 PC 도 `post_create_draft` 가 `POST_PREPARE_DRAFT` 로 오면 기존 핸들러가 처리한다(최상위 `verifiedFacts` 등만 없고 `context`·`generation.*` 는 그대로). 새 도구 2개만 `APP_UPDATE_REQUIRED`.
2. 데스크톱 v1.3.10 태그·설치본 게시. 1.3.9 PC 의 `post_submit_draft` 는 여전히 동기 이미지 배치를 돌 수 있으므로(사이트가 `warning` 으로 안내) 업데이트를 권장한다.
3. 배포 전 발급한 `post_create_draft` idempotencyKey 를 재사용하면 작업 타입 불일치로 `IDEMPOTENCY_CONFLICT` 가 난다. 새 키를 쓰면 된다.

## 남은 주의점

- `AGENT_MAX_RUNTIME_MS`(기본 25분)를 늘린 PC 에서는 라우트 데드라인(30분)이 먼저 `/api/posting/stop` 으로 끊는다.
- 수동 "섹션별 이미지 자동 생성" 버튼은 `ChatGPT 웹 자동작성` 설정이 켜져 있을 때만 동작한다. 꺼져 있으면 `CHATGPT_BROWSER_AUTOMATION_DISABLED` 로 거부하고 Chrome 을 열지 않는다.

## 배포 전 추가 검증 및 수정 (2026-09-03)

- 심층 검증에서 자동 이미지 실행 메타데이터가 없는 초안은 생성 이미지 요건을 건너뛰고 승인될 수 있음을 재현했다. 승인 및 기존 승인 유지 여부는 실행 이력이 아니라 실제 섹션별 파일·생성 출처 충족 여부로 판정하도록 수정했다. 명시적 이미지 없는 섹션은 유지한다.
- 제출 근거의 토큰 대조가 `충전 2시간 / 사용 8시간`에서 충전 8시간을, `5000mAh 미지원`에서 지원을 인정하는 오류를 재현했다. 속성·값·부정·조건을 보존한 전체 근거 항목 대조로 제한하고 숫자 재조합·조건 생략 회귀 검사를 추가했다. 일반적인 의역의 사실성을 판단하는 기능은 아니며 불명확한 의역은 보수적으로 거부한다.
- Sites 실행 검증의 도구 수를 실제 27개로 수정하고, 확인 없는 발행 요청이 `confirmed: must equal true` 스키마 검증에서 차단되는 실제 계약을 검증한다. 큐에 발행 작업을 만들지 않는지도 검사한다.
- 스크립트 타입 검사는 실행 환경에서 사용하는 ES2022·DOM iterable 선언을 포함하도록 맞췄다. 오류 검사를 끄거나 타입 오류를 무시하지 않는다.
- 유료 생성과 추가 네이버 발행은 이 업데이트 검증에 포함하지 않는다. 실행·배포 완료 증거는 아래에 추가한다.

### 자동 검사 실행 환경

GitHub Actions `33714548525`의 `check`와 `sites`는 단계 실행 전에 중단됐다. 두 annotation의 원문은 `The job was not started because recent account payments have failed or your spending limit needs to be increased.`였다. 계정 결제 설정은 변경하지 않았다. 이 배포에서는 같은 타입·린트·회귀·빌드 검사를 로컬에서 실행하며 GitHub CI 통과로 표기하지 않는다.

### 발행 후 보관 이미지 손실 재현

실제 SAGA fixture를 읽기 전용으로 검사하자 보관 이미지 11장 중 9장이 없었다. 기존 `simple-agent.ts`는 승인 패키지 경로로 교체한 `product.imagePaths`를 발행 후 임시 파일로 간주해 삭제했다. 삭제된 9장의 `sourcePath` 사본이 모두 남아 있었고 manifest의 SHA-256과 일치했다. 없는 파일 9장만 원래 경로에 복사해 복구했으며 기존 2장, 본문, manifest, 공개 글은 덮어쓰지 않았다. 복구 후 11장 모두 저장된 SHA-256과 일치하고 실제 fixture는 원고 100점·구성 100점·10개 섹션·11장·차단 없음으로 통과했다.

정리 함수는 이번 실행에서 생성한 파일만 추적하고 임시 폴더 안의 소유권이 확인된 일반 파일만 삭제한다. 승인 이미지로 목록을 교체하기 전 다운로드 목록을 보존해 정리에 사용하며 승인 패키지·다른 실행·기존 임시 파일·경로 탈출·링크/정션 대상은 보존한다. 컨텍스트 준비·발행 완료·다운로드 실패의 정리 경로에 같은 소유권 검증을 적용했다. `test:publish-image-cleanup`으로 실제 임시 파일과 9개 보관 이미지 fixture를 검사하고 CI 목록에도 추가했다.

## 최종 검증 및 배포 상태 (2026-09-03)

- 배포 코드: `818601600f5e68ab6dd54ca1e063edb01f5aa643`. GitHub `v1.3.10` 릴리스에 설치 파일·blockmap·latest.yml을 게시했고 원격 asset digest와 로컬 SHA-256이 일치했다.
- 설치 파일: `BrandConnect-Automation-Setup-1.3.10.exe`, 325,467,145 bytes, SHA-256 `e806e0491e05aeeef104171696183de9ec91c72fdabfed35f9882588d0ffa61c`. `node apps/sites/scripts/publish-update.mjs --verify-only out/release-1.3.10`의 검증 결과는 success=true다.
- `npm run build`, 루트 및 scripts TypeScript 검사, 변경 파일 ESLint 통과. 전체 CI lint는 오류 0개이며 기존 ProductThumbnailStudio의 미사용 setter 경고 1개가 남는다.
- 회귀: writing-harness, section-images, package-qc-reconcile, image-batch-progress, brand-post-package, brand-post-quality, draft-snapshot, post-composition, api-auth, codex-draft-provider, auto-update, connect-detection, connect-store, title-rules, post-spec, thumbnail-gen, local-json-fetch, product-detail-image, repository-techniques, brandlink-product-list, chatgpt-browser-automation, mcp-contract, publish-image-cleanup 통과.
- Sites build/type/lint 및 로컬 MCP/OAuth E2E 통과: 도구 27개, 발행 확인 누락 차단, PKCE, 코드 재사용 차단, refresh 회전·폐기 검증. 공개 서버의 새 버전 반영을 증명하는 결과는 아니다.
- 최종 Windows 패키지의 `verify-packaged-auto-update.ps1` 통과: 버전 1.3.10, 격리된 업데이트 fixture 감지, HTTP 200, 인증된 메타데이터, 수동 확인, 재시작, 번들 Prisma 로딩 검증. 테스트용 1.3.11 업데이트는 실제 설치하지 않았다.
- 실제 기존 PC의 MCP 조회는 쇼핑 48건·여행 50건 모두 SUCCEEDED/100%였다. SAGA 원고는 11장, 원고 QC 100점, 차단 없음, 승인 시각 및 본문 SHA-256 유지 상태를 확인했다. 추가 생성·발행은 실행하지 않았다.

### 운영 적용 및 남은 주의점

- 사용자 권한 변경 후 새 Chrome 연결에서 파일 선택이 성공했다. 2026-09-03 18:03:13 KST에 관리자 화면이 중앙 1.3.10 배포 완료를 표시했다. 게시 파일은 위 SHA-256/SHA-512 검증을 통과한 동일 설치본이다.
- PC는 기존 앱의 정상 업데이트 경로로 1.3.10을 다운로드·설치·자동 재실행했다. 18:09 KST 이후 로컬 API와 실제 데스크톱 화면에 1.3.10/current/오류 없음, 네이버 로그인·GPT·MCP 연결을 확인했다. 새 버전에서 실제 MCP 쇼핑 48건·여행 50건 조회가 모두 SUCCEEDED/100%로 완료됐다. 기존 SAGA는 원고 100점·구성 100점·이미지 11장·승인 유지·차단 없음이다.
- 공개 Sites 서버는 후속 사용자 승인("사이트도 적용해줘")을 받은 뒤 1.3.10을 적용했다. 저장된 소스 `9afd398be831c28b88b791c75cee2f82f5361f41`의 배포가 2026-09-03 05:16:57 UTC에 succeeded로 완료됐다. 공개 홈페이지 및 OAuth 메타데이터 HTTP 200을 확인했다. 중앙 설치본 게시와 PC 설치는 이후 별도로 완료했다.
- GitHub Actions는 계정 결제/사용 한도 때문에 작업 시작 전에 차단됐다. 로컬 테스트 통과와 GitHub CI 통과를 구분한다.
- 설치본 생성 중 C드라이브 공간 부족을 재현했다. 실패한 이번 설치 파일만 제거하고 이번 빌드 스테이징을 NTFS 압축한 후 재생성에 성공했다. D드라이브는 Windows가 Full Repair Needed로 보고해 사용을 중단했고 복구·포맷은 실행하지 않았다. 빌드 임시 폴더 정리는 정책에 차단돼 남아 있으며, 사용자 원고와 기존 설치 앱은 삭제하지 않았다.

### 실제 다운로드에서 발견된 패키징 잔여 결함

기존 1.3.9와 새 1.3.10 설치 디렉터리에 `resources/app-update.yml`이 없다. 업데이트 감지는 성공하지만 실제 다운로드는 electron-updater의 `getOrCreateDownloadHelper()`에서 `configOnDisk.value.updaterCacheDirName`을 읽다 ENOENT로 중단된다. 기존 패키지 검사는 AUTO_UPDATE_DOWNLOAD=false로 실행했으므로 이 단계를 검증하지 못했다.

현재 사용자 PC에는 기존 package.json의 generic 배포 주소·latest 채널·단일 범위 설정과 `updaterCacheDirName: brandconnect-automation-updater`를 담은 누락 파일을 새로 만들어 복구했다. 기존 앱 재시작 후 정상 다운로드/설치가 완료됐으며, 설치 과정에서 누락 파일이 다시 사라져 1.3.10에도 동일 파일을 복구했다. 인증 토큰이나 비밀키는 이 파일에 넣지 않았다. 게시된 설치본 자체는 교체하지 않았으므로 다른 PC 및 신규 설치에도 이 누락 문제가 남는다. 다음 보완 릴리스에서는 prepackaged 단계의 업데이트 설정 파일 포함 및 실제 다운로드 단계 검증을 추가해야 한다. 현재 PC의 성공을 모든 PC의 무보정 자동 업데이트 성공으로 해석하지 않는다.

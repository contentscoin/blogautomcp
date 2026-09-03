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

## 1.3.11 정정 (2026-09-03)

위 "`POST_PREPARE_DRAFT` 결과 최상위에 … (원본은 `context`)" 변경은 회귀였다. 원본 `brand-draft-context/v2` 를
`context` 아래로 내리면서 최상위 `snapshot` 이 사라졌고, 사이트의 `post_submit_draft` 검증과 PC 의 스냅샷 무결성
검사가 모두 최상위 `snapshot` 을 읽기 때문에 1.3.10 PC 의 제출이 전부 `PRODUCT_SNAPSHOT_CHANGED` 로 막혔다.
1.3.11 에서 결과는 다시 v2 를 최상위에 펼치고(`context` 없음), 사이트는 두 형태를 모두 받아들인다.
자세한 내용은 `docs/draft-pipeline-release-1.3.11.md`.

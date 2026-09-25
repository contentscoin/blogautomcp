# 이미지 생성 워크플로우 (photoreal + Codex 로그인 gpt-image-2)

2026-09-24 기준. 본문 섹션 이미지와 대표 이미지 배경을 **API 키 없이** 만든다.

## 한눈에 보기

| 단계 | 담당 | 위치 |
|---|---|---|
| 1. 슬롯별 이미지 출처 결정 | 상품 유형 템플릿(`imageSource`: 원본·크롭·연출컷) | `scripts/lib/topic-templates/`, `src/lib/post-composition-contract.ts` |
| 2. 프롬프트 조립 | 기존 안전 규칙 + photoreal L1~L3 층 | `buildBrandPostImagePrompt` (`src/lib/brand-post-image-generation.ts`), `scripts/lib/photoreal/` |
| 3. 생성 | Codex CLI 내장 `image_generation` (ChatGPT 로그인, 서버 모델 gpt-image-2) | `src/lib/codex-image-generation.ts` |
| 4. 점검 | photoreal 생성 후 점검표로 비전 QC 1회 → 걸린 항목만 보강해 1회 재생성 | `scripts/lib/photoreal/checklist.ts` |
| 5. 마무리 | 쇼핑: 실제 상품 누끼 합성 / 여행: 편집 이미지로 채택 | `finishGeneratedImage`, `scripts/lib/product-image-lock.ts` |
| 대체 | Codex가 실패한 작업만 ChatGPT 웹 자동화로 | `runBrowserImageBatch` |

## photoreal 스킬 내재화

- 원본: https://github.com/contentscoin/skillsphotoreal `photoreal/` (커밋 92cca71). 원본 파일은 `skills/photoreal/`에 수정 없이 보관한다(`SOURCE.md`).
- TypeScript 이식: `scripts/lib/photoreal/`
  - `layers.ts`: L1 출처, L2 빛·화질 결함, L3 프레이밍·시선, L4 해부학·비대칭·손, L5 미의 상한선, 나이 고정, 그룹, 셀카 문장.
  - `scenes.ts`: 원본 장면 8개(인물 컷) + 블로그 장면 15개(사람 없는 컷).
    - 쇼핑: `bathroom-shelf`, `vanity`, `desk`, `kitchen`, `living`, `outdoor-gear`, `kids-room`
    - 여행: `street-day`, `harbor`, `beach`, `temple`, `market`, `night-city`, `hotel-room`, `transit`
  - `build.ts`: `buildPhotorealPrompt()`는 원본 `build()`와 같은 순서로 조립한다. 인물 컷 출력은 원본 스크립트와 글자 단위로 같다(`scripts/fixtures/photoreal-build-prompt-golden.json`으로 검증).
  - `checklist.ts`: 점검표 11항목. 사람 없는 컷은 글자·배경 인물·그림자 방향·폰 사진 결 4항목만 본다.
- 블로그 컷 규칙
  - 쇼핑 배경·여행 풍경은 사람이 주인공이 아니므로 **L1~L3만** 넣는다. 시선·해부학·얼굴 문장(L4·L5 얼굴)은 넣지 않는다.
  - 장면은 템플릿 연출 지시(`promptRecipe`) → 이미지 의도 → 섹션 제목 키워드 순으로 고른다. 예: "욕실 선반" → `bathroom-shelf`, "청수사 무대" → `temple`.
  - 슬롯 번호(섹션 순서 + 슬롯 순번)를 변형 번호로 써서, 같은 글의 이미지끼리 순간·조명·결함·프레이밍이 겹치지 않게 한다.
  - 카메라 스펙·"보케"는 쓰지 않는다(스킬 규칙). 기존 안전 규칙은 그대로다: 쇼핑은 배경만 생성하고 상품은 그리지 않는다, 글자·로고 금지, 여행 이미지는 방문 증거가 아니다.

## Codex 로그인 이미지 생성

- 엔진 선택: `scripts/lib/draft-runtime-policy.json`의 `BRAND_POST_IMAGE_ENGINE` (기본 `codex`). `BRAND_POST_IMAGE_ENGINE=browser`로 예전 ChatGPT 웹 경로만 쓸 수 있다.
- 모델: Codex 내장 이미지 도구는 서버에서 gpt-image-2로 고정된다. API 키(OPENAI_API_KEY)와 사용량 과금이 없다. gpt-image-2.5는 Images API 전용이라 쓰지 않는다.
- 작업마다 독립 Codex 스레드를 연다.
  - `sandboxMode: "workspace-write"`, 작업 전용 폴더(`raw-<작업해시>.codex-<시도>/`), `approvalPolicy: "never"`, 네트워크 명령 꺼짐, 웹 검색 꺼짐
  - 지시: "이미지 생성 도구로 1장 생성해 ./out.png 저장, 경로만 보고" + 조립된 프롬프트
  - 여행은 검증된 원본 사진이 있으면 최대 3장을 분위기 참고로 첨부한다. 쇼핑은 참고 이미지를 넣지 않는다.
- 결과 수집: 작업 폴더의 `out.png` → 없으면 `CODEX_HOME/generated_images/<threadId>/`의 최신 이미지. 찾은 파일은 브라우저 경로와 같은 `raw-<작업해시>.png`로 옮긴다.
  - 같은 작업해시 결과가 이미 있으면 다시 만들지 않는다(이어서 생성).
  - 브라우저 경로가 이미 요청을 보낸 작업(`.checkpoint.jsonl` 있음)은 중복 생성을 막기 위해 브라우저 경로에서 이어 받는다.
- 동시 3개(스킬 실측상 5개까지 안전), 작업당 시간은 `image-timeout-policy.ts`의 작업 예산을 쓴다.
- 실패 분류: 로그인 필요·CLI 버전·시간 초과를 `classifyCodexDraftFailure`로 분류해 `CODEX_IMAGE_FAILED(<코드>)`로 보고한다. 그 작업만 ChatGPT 웹 경로로 넘기고, 둘 다 실패하면 두 오류를 함께 보여준다.

## 생성 후 점검

- 생성마다 점검표 QC를 1회 한다(`runCodexDraft` + 이미지 첨부, gpt-6-luna low). 명확히 보이는 결함만 표시하도록 관대하게 지시한다.
- 걸린 항목이 있으면 **그 항목만 긍정문으로 덧붙여** 1회 다시 만든다. 원래 프롬프트는 그대로 둔다(스킬 규칙).
- 다시 만든 결과가 더 나쁘지 않으면 교체하고, 그래도 남은 항목은 경고로만 남긴 채 채택한다(검수 완화 방침). QC 호출이 실패하면 통과로 본다.
- `BRAND_POST_IMAGE_QC=false`로 끌 수 있다.

## 썸네일

- 앱의 대표 이미지는 위 흐름에서 hero 슬롯으로 만들어진다(배경 생성 → 실제 상품 누끼 + 한글 제목 합성).
- CLI(`simple-agent.ts`)의 썸네일 대체 경로도 같은 Codex 이미지 경로로 배경을 만든 뒤 `createLockedProductThumbnailOnBackground`로 합성한다. 예전처럼 요청 파일을 남기고 수동으로 경로를 넘기는 방식(`PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH`)도 계속 쓸 수 있다.
- API 키가 있는 사용자의 Images API 썸네일 경로(`scripts/lib/openai-image.ts`)는 바꾸지 않았다.

## 누끼 불가 상품의 정보 카드 (1.3.85)

- 검증된 판매자 사진은 있지만 분리 가능한 원본이 하나도 없으면, 연출컷 대신 로컬 정보 카드로 슬롯을 채운다(`scripts/lib/shopping-fact-card.ts`).
  - 크기는 1200x900이고 단색 배경을 쓴다.
  - 원본 사진 전체를 흰 액자에 넣고, 옆에 섹션 제목과 확인된 사실 2~4줄을 적는다.
  - 출처는 `EDITORIAL_CARD` + `local-composite`로 기록한다.
- 대표 슬롯은 `createOriginalProductPhotoThumbnail`을 쓴다. 두 경우 모두 생성 배경 합성은 여전히 하지 않는다.
- 글 하나에 최대 3장만 쓴다. 사실이 2개 미만이거나 `generated-required` 정책이면 기존 `PRODUCT_CUTOUT_REQUIRED`를 그대로 보고한다.

## 검증

- `npm run test:photoreal`: 원본 스크립트와의 출력 일치(골든 38건, python3가 있으면 실시간 비교도 함), 사람 없는 컷의 층 규칙, 변형, 장면 선택, 블로그 프롬프트 연결, 점검표.
- `npm run test:codex-image`: Codex SDK 목으로 스레드 격리, 결과 수집(out.png / generated_images), 이어서 생성, 동시 3개, 로그인 실패 분류, QC 1회 재생성, 브라우저 대체.
- 실제 생성 확인은 Codex 로그인이 된 PC에서 쇼핑 1건·여행 1건으로 한다(클라우드 테스트 환경에는 Codex 로그인이 없다).

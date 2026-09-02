# 글 구성 하네스 (Spec-first 콘텐츠 파이프라인)

기준일: 2026-09-02 · 코드: `scripts/lib/post-spec/` · 플래그: `POST_SPEC_PIPELINE_ENABLED` (기본 `true`)

## 왜 바꿨나

예전 파이프라인은 글을 **한 번에 JSON 으로 생성한 뒤** 12단계 이상의 사후 보정(상투문 패딩, 절삭,
정규식 치환, 2차 전체 재작성)으로 규격을 맞췄다. 이미지 개수는 글을 다 쓴 뒤 업로드 단계에서
4장으로 잘라내 "섹션 10개 vs 이미지 4장"이 됐고, SEO 긍정 신호는 프롬프트 권고문에만 있었으며,
GEO(요약·핵심 사실·FAQ·추천 대상·근거) 요소는 설계에 없었다.

새 파이프라인은 **글을 쓰기 전에 결정할 수 있는 것을 전부 스펙으로 고정**하고, 모델은 스펙을 채우기만 한다.

```
A. 이미지 풀 준비(보강) → 섹션 수 파생 → PostSpec 확정      (LLM 없음)
B. 구조화 생성 (OpenAI json_schema strict, 고정 키 s00…)      (또는 로컬 템플릿)
C. 검증: 모든 신호 계산 → RepairTarget[] → 섹션 단위 수리 ≤ 2회
D. 조립: 섹션 문자열 + 에디터 입력 계약(composition) + 업로드 순서
```

| 단계 | 파일 | 핵심 |
|---|---|---|
| A′ 이미지 | `image-plan.ts` | 후보 점검(치수·파일명) → 부족 시 여행=Unsplash API 스톡, 쇼핑=상세 크롭 콜라주 → 슬롯 배정(최소치 먼저, 남으면 최대치) |
| A 스펙 | `index.ts#buildPostSpec` | 확보 이미지 수에서 섹션 수 파생(쇼핑 8~10, 여행 10~12), SEO/GEO 목표, 분할 생성 계획 |
| 구성표 | `section-library.ts` | 역할·헤더·형식·이미지 의도·근거 규칙·폴백 문장 |
| B 생성 | `generate.ts`, `schema.ts`, `llm-client.ts` | 제목은 스펙 고정, 섹션별 지시(형식·분량·근거·앞 이미지), 여행은 2챕터 분할 |
| C 검증 | `validate.ts` | 기존 readiness 13신호 재사용 + 제목/키워드/형식/중복/AI티/밀도/이미지 → `ValidationReport` |
| C′ 수리 | `repair.ts` | 타깃 섹션만 단일 섹션 스키마로 재생성, 제목은 제목만 |
| D 조립 | `assemble.ts` | composition(헤더 형식·이미지·구분선), 해시태그(필수→모델→금지어 제외), 고지, 근거 라인 |

## 구성표

### 쇼핑커넥트 (8~10 섹션 + 고지)

| # | role | 헤더 | 형식 | 이미지 |
|---|---|---|---|---|
| 0 | `summary-glance` "{키워드} 한눈에 보기" — GEO 3줄 요약 | 인용구* | 3줄 | hero 앞 |
| 1 | `hook-problem` 구매 전에 먼저 볼 기준 | 소제목 | 문단 | – |
| 2 | `product-reveal` 상품 구성과 핵심 특징 | 소제목 | 문단 | 1~2 |
| 3 | `key-facts` 핵심 정보 정리 — GEO 사실 목록 `• 항목: 값` | 소제목 | 목록 | 1 |
| 4 | `benefit` 기능이 주는 실제 이점 | 소제목 | 문단 | 1~2 |
| 5 | `use-case` 어떤 상황에 잘 맞는지 | 소제목 | 문단 | 1~2 |
| 6 | `proof`(리뷰·평점 있을 때) / `comparison` | 소제목 | 문단 | 0~1 |
| 7 | `offer-check` 가격과 혜택 확인 포인트 | 소제목 | 목록 | 0~1 |
| 8 | `faq` 자주 묻는 질문 — GEO Q/A 3쌍 | 소제목 | Q/A | – |
| 9 | `fit-checklist` 이런 분께 잘 맞아요 + 근거 라인 | 소제목 | 체크 | 0~1 |

### 여행커넥트 (10~12 섹션 + 고지) — 참고: `docs/naver-blog-drafts/2026-09-02-travel-reference-taiwan-modetour.md`

| # | role | 형식 | 이미지 |
|---|---|---|---|
| 0 | `summary-glance` "{목적지} {기간} 여행, 결론부터" | 3줄 | hero 앞 |
| 1 | `key-facts` 상품 한눈에 보기 (여행사·기간·항공·숙박·조건·가격 변동 안내) | 목록 | – |
| 2 | `itinerary-overview` 전체 일정 흐름 | 문단 | 카드 1 |
| 3~5 | `day-course` 코스 포인트 N · {방문지} + 현지 팁(조사형) | 문단 | 각 1~2 |
| … | `inclusions` 가격, 포함과 불포함 | 목록 | 1 |
| … | `reasons-3` 이 상품을 고르는 이유 3가지 | 체크 | – |
| … | `booking-check` 예약 전 체크리스트 (입국 서류·날씨·환전·취소 규정) | 체크 | – |
| … | `faq` 자주 묻는 질문 | Q/A | – |
| … | `fit-checklist` 이런 분께 잘 맞아요 | 체크 | – |
| 마지막 | `closing` 마무리 (한 줄 정리 + 아래 링크 안내 + 댓글 유도) | 문단 | 0~1 |

\* 인용구 헤더는 `NAVER_EDITOR_QUOTATION_ENABLED=true` 일 때만 실제 인용구 컴포넌트로 입력되고,
기본값에서는 소제목으로 강등된다(에디터 셀렉터 실측 후 켠다).

## 문체 원칙 (프롬프트에 그대로 들어감)

- 부드러운 ~요체, 개인 검토 소감(~더라고요, 찾아보니 ~라고 해요)은 허용
- 실제 구매·사용·방문은 단정하지 않음 (readiness 의 허위 체험 정규식이 검증에 그대로 사용됨)
- 인사말 없이 상황으로 시작, 한 문장 25~45자, 문장마다 줄바꿈
- 제목: 25~35자, 핵심 키워드 앞배치, 이모지·낚시성 문구 금지
- 해시태그: 필수 태그 우선, 일반 태그(추천/후기/일상…) 금지, 부족하면 부족한 채로

## "이미지 개수 충족"이 구조적으로 참인 이유

1. 섹션 수가 확보된 이미지 수에서 파생된다 (이미지를 못 채우는 섹션을 만들지 않음)
2. 슬롯은 생성 전에 파일 경로까지 확정된다
3. 부족분은 생성 전에 스톡/콜라주로 보강하고, 그래도 최소치 미만이면 `BLOCKED` 로 발행하지 않는다
4. 업로드 단계는 슬롯 목록을 그대로 쓴다 (`BLOG_BODY_IMAGE_MAX` 로 잘라내지 않음)

## 산출물과 재사용

- 초안 패키지 `manifest.json` `version: "brand-post-package/v2"` — `sections[]`, `composition`, `spec`, `draft`, `readiness`
- 승인 후 발행은 v2 의 `sections` 와 `composition` 을 그대로 사용 (STEP2 재생성 없음)
- 부분 수정: `PATCH /api/brandlinks/{id}/draft { action: "revise", instructions, sectionIndexes? }`
  → `BRANDLINK_REVISE_REQUEST` 로 simple-agent 가 저장된 스펙/초안에서 지정 섹션만 다시 씀
- 실패 원인: 패키지 디렉터리의 `result.json { ok, code, message, readiness }`

## 환경 변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `POST_SPEC_PIPELINE_ENABLED` | `true` | false 면 예전 단발 생성 + 사후 보정 경로 |
| `NAVER_EDITOR_QUOTATION_ENABLED` | `false` | 인용구 헤더 실제 입력 |
| `TRAVEL_STOCK_IMAGES_ENABLED` | `true` | `UNSPLASH_ACCESS_KEY` 가 있을 때 여행 스톡 보강 |
| `OPENAI_MAX_OUTPUT_TOKENS` | `8192` | 구조화 생성 출력 상한 |
| `BRANDLINK_DRAFT_MEMO` | – | 초안 생성 시 요청 메모 (MCP memo) |

## 검증

`npm run test:post-spec` — 이미지 플랜/섹션 파생/구성표/검증 타깃/조립/콜라주/부족 시 BLOCKED.

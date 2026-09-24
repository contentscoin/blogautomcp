# 쇼핑커넥트·여행커넥트 주제별 템플릿화 — 수정 계획

## 구현 현황 (2026-09-24)

| 단계 | 내용 | 상태 | 주요 파일 | 테스트 |
| --- | --- | --- | --- | --- |
| 1 | 모델 gpt-6-luna, reasoning low | 완료 | `scripts/lib/draft-runtime-policy.json`, `text-model-policy.ts` | `test:text-model-policy`, `test:codex-draft-provider` |
| 2 | 검수 기준 완화(62점, 필수 카테고리는 근거 1개, 재작성 1회) | 완료 | `brandlink-content-readiness.ts`, `post-spec/validate.ts` | `test:editorial-calibration` |
| 3 | 상품 유형 템플릿(쇼핑 8+1, 여행 4+1), 여행 꿀팁 | 완료 | `scripts/lib/topic-templates/*`, `post-composition-contract.ts` | `test:topic-templates` |
| 3-1 | 포스팅 각도(전체 리뷰 + 주제 글), 형제 글 겹침 재작성, 예약 간격 2일, UI | 완료 | `topic-templates/angles.ts`, `api/brandlinks/[id]/angles`, `PostAnglePanel.tsx` | `test:post-angles` |
| 4 | 섹션별 이미지 출처(원본/크롭/연출컷)와 연출 레시피 | 완료 | `brand-post-image-evidence.ts`, `brand-post-image-generation.ts` | `test:topic-templates` |
| 5 | 상세 이미지 비전 판독, 자동완성 검색 수요, 웹 리서치 범위 | 완료 | `detail-vision-reader.ts`, `search-demand.ts`, `codex-draft-provider.ts` | `test:detail-vision` |
| 6 | SEO 제목 기획(후보·필수 규칙 교체) | 완료 | `topic-templates/title-planner.ts` | `test:title-planner` |
| 7 | 체험 메모(상품 단위 저장·주제 글 상속·근거 경고), UI | 완료 | `experience-notes.ts`, `ExperienceNotesPanel.tsx` | `test:experience-notes` |

### 남은 과제
- 형제 글 "함께 보면 좋은 글" 링크 삽입: 네이버 에디터 링크 컴포넌트 삽입과 실측 검증이 필요해 이번 범위에서 제외.
- 인용구(한눈에 보기·꿀팁 박스) 기본 활성화: 실제 네이버 에디터 실측(`verify-naver-editorial-style.ts`) 후 켤 것.
- 체험 사진 업로드: 체험 메모는 텍스트만 지원.
- spec-first 경로(section-library)는 섹션 구성이 고정되어 있어 템플릿 요약·각도 메모만 반영.
- 끄기 스위치: `DETAIL_VISION_READ_ENABLED`, `SEARCH_DEMAND_ENABLED`, `SHOPPING_WEB_RESEARCH_ENABLED` (기본 true).

---

## Context
지금 원고는 커넥트 종류별로 템플릿 6개(쇼핑 3개: 문제·비교·상세, 여행 3개: 일정·풍경·조건)를 쓴다. 템플릿 선택은 정규식 몇 개로 정한다(`scripts/lib/editorial-templates.ts`의 `matchedSelection`). 섹션 구성은 커넥트 종류 하나에 한 벌뿐이다(`scripts/lib/post-spec/section-library.ts`). 그래서 상품 종류(가전·뷰티·식품…, 패키지·호텔·티켓…)가 달라도 글 구조, 이미지 배치, 이미지 프롬프트가 거의 같다.

요청 사항은 여섯 가지다.
1. 상품 유형별로 템플릿을 미리 고정한다. 템플릿에는 네이버 블로그 디자인과 AI 인용 구조를 넣는다.
2. 이미지를 두 종류로 나눈다: 상세페이지 원본과, 상품 이미지를 기준으로 만든 연출컷. 섹션마다 어느 쪽을 쓸지 템플릿에서 정한다.
3. 이미지로만 된 상세페이지도 제대로 읽고, 리서치를 보강한다.
4. SEO 제목을 기획한다.
5. 텍스트 모델을 gpt-6 luna(low)로 바꾼다.
6. 검수 기준을 적절히 완화하고, 여행은 "꿀팁" 컨셉으로 쓴다. "직접 체험한 리뷰"라는 점도 분명히 한다.
7. **한 상품으로 여러 편을 쓴다**: 전체 리뷰 1편과 특정 주제 글 여러 편. 쇼핑과 여행 모두 해당한다(0번).

**설계 원칙:** 기존 코드를 대체하지 않고 그 위에 올린다. `editorial-templates.ts`(발행 서식·배치 작성), `section-library.ts`(섹션 모양·GEO 블록), `adaptive-editorial-harness.ts`(상위 노출 글 분석 수치), `NAVER_AI_CITATION_POLICY`, 체험 모드(`VERIFIED_EXPERIENCE`)는 이미 있다. 여기에 **"상품 유형 템플릿" 레이어를 하나 추가**해 네 가지(섹션 순서, 이미지 슬롯, 이미지 프롬프트, 제목 공식)를 한 곳에서 정한다.

---

**생성 경로는 둘이다. 두 경로 모두에 같은 템플릿을 넣는다.**
- (A) **기본 경로 = Codex**(`AI_PROVIDER=codex`): `simple-agent.ts`의 `step2_generatePost`(:4780)가 기존 프롬프트(system :5058, user :5135)와 `SHOPPING_POST_CONTRACT_V1`/`TRAVEL_POST_CONTRACT_V1`을 쓴다.
- (B) OpenAI API 키가 있을 때의 spec-first 경로(`runSpecFirstPipeline` :4871, `post-spec/*`).
- 실제 운영은 (A)가 기본이다. 따라서 **composition contract가 템플릿의 실체**가 되고, spec 경로의 section-library는 같은 정의를 참조하도록 맞춘다.

## 0. 한 상품으로 여러 포스팅 쓰기 (포스팅 각도)
상품 하나로 "전체 리뷰" 1편과 "특정 주제" 글 여러 편을 쓴다. 글의 구조는 **상품 유형 템플릿(1번) × 포스팅 각도** 조합으로 정해진다.

**데이터 구조: 각도마다 BrandLink 행을 하나씩 만든다**
- 지금은 BrandLink 1행이 곧 포스팅 1편이다. 상태·`postUrl`·예약이 BrandLink 행에 있고, 원고 패키지(`prepared-brand-posts/<brandLinkId>`, `brand-post-package.ts:205`)와 발행·예약·재검수 전부가 `brandLinkId`를 키로 쓴다.
- 그래서 `BrandLink`에 `parentBrandLinkId String?`, `postAngle String?`(기본 `full-review`) 두 필드만 추가한다. 주제 글은 원본을 복제한 **자식 BrandLink 행**으로 만든다. 같은 커넥트 URL과 스크랩 정보를 복사한다.
  - 원고 작성, 패키지, 이미지, 검수, 발행, 예약 코드는 **수정 없이** 그대로 동작한다.
  - 원본 행은 `full-review` 각도가 된다. 기존 데이터는 마이그레이션 없이 호환된다(null = full-review).
  - Prisma 마이그레이션 1개와 `@@index([parentBrandLinkId])`를 추가한다.
- 스크랩과 상세 읽기(OCR·비전) 결과는 부모 것을 재사용하고 다시 긁지 않는다. 상품 정보를 새로 고치면 자식 행에도 반영한다.

**각도 카탈로그** (신규 `scripts/lib/topic-templates/angles.ts`)
- 쇼핑
  - `full-review`: 전체 리뷰. 유형 템플릿 전체를 쓴다.
  - `how-to`: 사용법·루틴·설치.
  - `problem-solve`: 특정 고민 하나를 해결하는 글. 예: "원룸 좁은 욕실 수납".
  - `deep-dive`: 성분·스펙·소재 하나를 깊게 다루는 글.
  - `compare`: 옵션·구성 비교, 또는 대안과의 선택 기준.
  - `situation-gift`: 선물·시즌·대상별 글. 예: "부모님 선물", "여름 캠핑".
  - `care-longterm`: 관리·보관·장기 사용. 체험 메모가 있을 때만 쓴다.
- 여행
  - `full-review`: 전체 일정 리뷰.
  - `day-highlight`: 특정 일차나 장소 하나에 집중하는 글.
  - `prep-tips`: 준비 꿀팁 체크리스트(환전·유심·짐·입국).
  - `who-fits`: 부모님·아이 동반·커플 등 동반자별 적합도, 포함·불포함 조건.
  - `food-spot`: 맛집·쇼핑·야경 스폿 꿀팁.
  - `season`: 시기별 여행(날씨, 옷차림, 성수기 팁).
- 각도마다 정하는 것: 필요한 근거 조건, 섹션 골격(짧은 5~7섹션), 대표 키워드 공식, 제목 공식, 이미지 우선순위.
  - 근거 조건 예: `compare`는 옵션 2개 이상이 확인돼야 하고, `day-highlight`는 해당 일차 일정이 있어야 한다. `deep-dive`는 성분·스펙 줄이 3개 이상이어야 한다.
  - **근거가 부족한 각도는 목록에 보이지 않는다.** 없는 내용을 지어내지 않기 위해서다.

**각도 추천** (`suggestPostAngles(brandLink, evidence)`)
- 근거 충족 여부와 자동완성 수요(`seo.ts`)로 점수를 매겨, 쓸 수 있는 각도와 추천 순서를 돌려준다. 결정론적 로직이고, 모델 호출은 제목 후보를 만들 때만 한다.
- 기본 추천은 쇼핑 "전체 리뷰 + 주제 글 2편", 여행 "전체 리뷰 + 꿀팁·스폿 2편"이다.

**유사문서 방지**: 네이버 유사문서 판정을 피하는 게 핵심이다.
- 각도마다 대표 키워드를 서로 다르게 잡는다. 전체 리뷰는 "상품명 후기", how-to는 "상품명 사용법", 여행 prep-tips는 "여행지 준비물" 식이다.
- 섹션 골격도 다르게 둔다. 전체 리뷰에서 쓴 구성 문장 틀을 재사용하지 않는다.
- 이미지는 형제 글끼리 겹치지 않게 우선 배정한다. 연출컷은 각도별 장면으로 새로 만든다. 기존 `image-dedup.ts`로 확인한다.
- 원고 검수 때 **형제 글과 비교**한다. 기존 `draft-quality-signals.ts`의 `tokenSimilarity`와 `assessRepetition`을 재사용한다.
  - 문장 유사도가 높으면 해당 섹션만 1회 재작성한다.
  - 재작성 후에도 높으면 경고만 남긴다. 6번 완화 방침에 따라 차단하지 않는다.
  - 제목이 형제 글 제목과 너무 비슷하면 제목 후보에서 뺀다.
- 형제 글끼리는 예약 간격을 둔다. 기본값은 최소 2일이다. `bulk-schedule-plan.ts`에 "같은 부모 상품끼리 간격" 규칙을 추가한다.

**형제 글 연결**
- 먼저 발행된 형제 글이 있으면 마무리에 "함께 보면 좋은 글" 한 줄 링크를 넣는다. 전체 리뷰에서 주제 글로, 주제 글에서 전체 리뷰로 잇는다.
- 네이버 블로그 글 URL은 본문 링크 검사(`link-in-body`)의 예외로 허용한다. 커넥트 링크는 계속 금지한다.
- 광고 고지와 커넥트 카드는 모든 글에 그대로 넣는다.

**UI** (`src/app/page.tsx` 상품 카드)
- 상품 카드에 "포스팅 주제" 영역을 추가한다. 추천 각도 칩을 보여주고, 선택하면 자식 행을 만든 뒤 바로 원고 작성으로 이어진다.
- 각도별 상태를 표시한다: 작성 전, 초안, 예약, 발행됨.
- 목록에서는 자식 행을 부모 아래에 묶어서 보여준다. 대량 작성·예약(`bulk-*`)에는 "상품당 주제 N편" 옵션을 준다.
- 체험 메모(7번)는 상품 단위로 한 번만 입력하고 모든 각도가 공유한다. 각도별로 추가 메모를 넣을 수도 있다.

**프롬프트**
- `formatTopicTemplate(typeTemplate, angle)`는 각도 목적, 섹션 골격, 대표 키워드, 형제 글 요약(이미 다룬 내용과 제목)을 넣고 "형제 글과 겹치지 않게"라고 지시한다.
- 두 생성 경로(A·B)에 같은 블록을 넣는다.

## 1. 공통: 상품 유형 템플릿 레지스트리 (신규)
- 분류기는 새로 만들지 않고 **기존 것을 재사용한다.** `opencrab-seo-brief.ts:159` `CATEGORY_KEYWORDS`(8개 카테고리, 한글 라벨)를 템플릿 선택 1차 신호로 승격한다. `product-editorial-plan.ts:320` `detectCategory`(fan, cooler-bag 등 세부 분석)는 템플릿 안의 세부 분석으로 유지한다.
**신규 파일** `scripts/lib/topic-templates/`
- `types.ts`: `TopicTemplate` 타입을 정의한다. 필드는 다음과 같다.
  - `id`, `kind: "SHOPPING"|"TRAVEL"`, `label`
  - `match`: 카테고리 키워드, 상품명·OCR 신호
  - `editorialTemplateId`: 기존 6개 중 하나. 서식과 색상은 기존 것을 재사용한다.
  - `sections[]`: 순서, `role`(기존 `SectionRole` 재사용), 제목 패턴, `shape`(prose/lines-3/facts-list/qa-3/checklist), `experienceSlot`(체험 문장이 들어갈 자리인지)
  - `imageSlots[]`: 섹션 ID, `source: "seller-original" | "staged-ai" | "seller-crop" | "none"`, `promptRecipe`
  - `titleFormulas[]`, `researchQueries[]`, `faqSeeds[]`
- `shopping.ts`: 쇼핑 8종을 정의한다. 기존 `ProductReviewCategory`(`product-editorial-plan.ts:18`)와 opencrab 분류 체계를 맞춘다.
  - **digital_it · home_appliance**: 스펙형. 한눈에 보기 → 개봉·구성 → 핵심 스펙 표(facts-list) → 설치·사용 순서 → 실사용 장면 → 아쉬운 점 → 추천 대상 → FAQ
  - **beauty_body**: 성분·제형형. 고민 → 제형·향(연출 클로즈업) → 성분 근거(상세 원본 크롭) → 사용 루틴 → 사용 후 느낌 → 주의(피부 타입) → FAQ
  - **food_supplement**: 섭취형. 원재료·함량(상세 원본) → 먹는 방법 → 맛·식감 → 보관 → 섭취 주의. 효능 단정은 금지한다.
  - **living_health**: 생활 고민 해결형
  - **fashion_goods**: 핏·소재형. 사이즈 표는 상세 원본을 쓴다.
  - **baby_pet**: 안전·소재 우선형
  - **sports_leisure**: 사용 환경형
  - **generic**: 기본값
- `travel.ts`: 여행 5종을 정의한다.
  - **package_tour**: 일정형. 한눈에 보기 → 일차별 코스와 꿀팁 → 포함·불포함 → 추천 이유 3 → 예약 전 체크 → FAQ
  - **hotel_resort**: 숙소형. 위치·동선 → 객실 → 부대시설 → 조식 → 주변 꿀팁 → 체크인 팁
  - **activity_ticket**: 티켓형. 이용 방법 → 소요 시간 → 줄 안 서는 꿀팁 → 가격 조건
  - **airtel_freetour**: 자유여행형. 추천 동선 → 교통 → 맛집·스폿 꿀팁 → 준비물
  - **cruise_special**: 기타
- 현재 여행은 전부 패키지로 취급된다(`travel-content.ts:184` `productType: "package-tour"` 하드코딩). 여행 유형 판별은 URL(`pkgtour`), 목록 필터(`travel-selection-options.ts`의 `productType`, `extra.tourTicket`), `__NEXT_DATA__`의 `schedules` 유무, 상품명 키워드(호텔·리조트·입장권·투어·에어텔)로 한다. `TravelReviewAnalysis.productType`을 유니온 타입으로 확장한다.
- `select.ts`: `selectTopicTemplate(kind, {categoryPath, name, description, features, ocrLines})`는 결정론적으로 선택하고 선택 이유를 반환한다. 기존 `createEditorialSelection`은 이 결과의 `editorialTemplateId`를 받도록 연결한다. 이 연결은 기존 정규식 선택보다 우선한다.
- 선택 결과(`topicTemplateId`, `reason`)는 draft context snapshot에 보존한다(`src/lib/draft-context-snapshot.ts`). UI에는 "적용 템플릿"으로 표시하고, 수동 변경 드롭다운을 둔다.

**네이버 블로그 디자인 차용**
- 현재 인용구는 꺼져 있다(`NAVER_EDITOR_QUOTATION_ENABLED` 기본값 false, `simple-agent.ts:428`). 표와 스티커는 미구현이다.
- 템플릿마다 `decorations`를 정한다: 인용구 스타일 1종, 구분선, 굵게 핵심 한 줄. 인용구는 "한눈에 보기 요약"과 "꿀팁 박스" 두 곳에만 쓴다. 섹션 제목은 기존 sectionTitle을 유지하고, 색상과 폰트는 기존 `editorialEditorPolicy`를 쓴다.
- 인용구 입력은 이미 코드가 있다(quotation 노드, `renderResolvedPostDocument` :7615). 템플릿이 지정한 섹션에서만 켠다. 네이버 에디터에서 실측 검증(`verify-naver-editorial-style.ts`)을 통과한 뒤 기본값을 켠다. 표는 AI가 표 이미지를 읽지 못하므로 계속 쓰지 않고, facts-list 세로 목록으로 대체한다.

**연결 지점**
- `scripts/lib/post-spec/section-library.ts`: `shoppingTemplates` / 여행 템플릿이 `TopicTemplate.sections` 순서와 제목 패턴을 따르게 한다. 기존 shape 규칙과 fallbackLines는 재사용한다.
- `scripts/lib/post-spec/generate.ts`
  - `renderSystemPrompt`와 `renderSectionInstruction`에 템플릿 섹션 목적과 이미지 출처 설명을 주입한다.
  - `renderTitleRules`는 4번 항목(제목 플래너)으로 교체한다.
- `src/lib/post-composition-contract.ts`: `TRAVEL_POST_CONTRACT_V1`(280–432)과 쇼핑 계약을 템플릿별 계약으로 바꾼다. 방식은 `getPostCompositionContract(kind, topicTemplateId?)`에 선택 인자를 추가하는 것이다. 호출부 14곳(draft route, `brand-post-package.ts`, readiness 2종, `simple-agent.ts`)에는 snapshot의 `topicTemplateId`를 전달한다. 기존 V1은 `generic`·`package_tour` 기본값으로 남긴다. 렌더와 검수 계약이 템플릿과 어긋나지 않게 하는 것이 목적이다.
- `scripts/simple-agent.ts`의 여행 섹션 계획(5071–5095)과 쇼핑 섹션 계획을 템플릿에서 받도록 바꾼다.
- `scripts/lib/writing-prompt-contract.ts`, `scripts/simple-agent.ts`(Codex 경로 `runCodexDraft` 호출부 ~4754): 같은 템플릿 블록을 `formatTopicTemplate()`로 주입한다.

## 2. 이미지 슬롯 배정: 상세 원본 vs 연출컷
- `scripts/lib/post-spec/image-plan.ts`의 `assignImageSlots`는 템플릿의 `imageSlots[].source`를 우선 따른다.
  - `seller-original` / `seller-crop`: 스펙, 성분, 사이즈 표, 구성품, 일정표 같은 "사실 증빙" 섹션에 쓴다. 크롭에는 기존 `product-detail-image.ts`의 `createProductDetailImageSegments`와 `product-photo-region.ts`를 재사용한다.
  - `staged-ai`: 사용 장면, 분위기, 루틴 섹션에 쓴다. 기존 locked-product 경로(`product-image-lock.ts`, `brand-post-image-generation.ts`)를 쓴다. 배경을 생성하고 실제 상품 누끼를 합성한다.
- 슬롯 `source`는 기존 provenance 체계에 1:1로 대응한다.
  - `seller-original`/`seller-crop` → `ORIGINAL`
  - `staged-ai` → `LOCKED_PRODUCT`(쇼핑) / `GENERATED_BACKGROUND`(여행)
  - 카드 → `EDITORIAL_CARD`
  - 검증 규칙은 `src/lib/brand-post-image-evidence.ts`를 재사용한다.
- 계약 스키마(`PostSectionContractV1.image = {min,max,intent,placement}`)에 `source`와 `promptRecipe`를 추가한다. 선택 필드로 두고, 없으면 기존 동작을 유지한다. 기존 `LEGACY_SHOPPING_FEATURE_IMAGE_INTENTS`의 매핑(패키지 = 원본, 사용 장면 = 연출)을 일반화한다.
- 쇼핑 연출컷은 지금처럼 **배경만 생성**하고, 실제 상품 누끼를 합성한다(`buildBrandPostImagePrompt` :179 → `createLockedProductEditorialScene` `product-image-lock.ts:198`). 레시피는 배경 프롬프트(장면, 조명, 소품, 상품이 놓일 자리와 크기)에만 들어가며, 상품 형태가 바뀌지 않는 구조를 유지한다.
- `promptRecipe`를 카테고리별로 둔다. 예: beauty = "욕실 선반 자연광 클로즈업, 손등 텍스처", appliance = "거실 실사용, 제품 전면 로고 유지". 형식은 "장면·구도·조명·소품·금지 요소(로고 변형, 가짜 텍스트)"로 통일한다.
- 여행 이미지는 **유지**한다.
  - "리얼포토" 스킬은 저장소에 없다(사용자 로컬 Codex 스킬로 추정). 저장소 안에서 이에 해당하는 것은 `src/lib/brand-post-image-generation.ts`의 `buildBrandPostImagePrompt` 여행 분기(206–226, photorealistic travel editorial)와 `travel-thumbnail.ts`다.
  - 여기에는 손대지 않고 두 가지만 추가한다. (a) 템플릿 슬롯 의도(장소, 시간대, 구도, 동선 중 한 장면)를 섹션 컨텍스트로 넘긴다. (b) 일정표·포함사항 섹션은 상세 원본(`seller-crop`)으로, 풍경·장소 섹션은 생성 컷으로 나눈다.
- 섹션 ID와 이미지의 연결은 기존 검증(`verify-section-image-repair`, `product-section-image-review`)을 그대로 통과해야 한다.

## 3. 상세페이지 이미지 읽기와 리서치
- 현재 흐름: 상세 이미지 → `product-detail-image.ts`로 세로 분할 → `product-source-ocr.ts`(tesseract, `confidentOcrLines`) → `product-source-facts.ts`
- 현재 OCR은 근거가 부족할 때만 실행되고(`enrichShoppingSourceFeatures` :675), 최대 8장, 신뢰도 ≥65, 결과는 최대 16줄이다. 비전은 이미지와 섹션 매칭에만 쓰인다(`product-photo-review.ts:64`, `runCodexDraft` 16장 배치). 이 배치 호출 방식을 그대로 재사용한다.
- **추가**: OCR 신뢰 줄이 적거나(예: < 15줄), 분할 조각이 "텍스트 이미지"로 판정되면 **비전 읽기 패스**를 실행한다. 조각 묶음(최대 N장)을 `runCodexDraft({imagePaths, preserveImageOrder})`에 넣고 구조화 JSON을 받는다: `{스펙[], 구성[], 성분·소재[], 사용법[], 주의[], 인증·수치[]}`. 결과는 evidence ledger(`post-spec/evidence-ledger.ts`)에 `source: "detail-vision"`으로 넣는다. OCR 결과와 겹치면 병합하고, 수치는 OCR과 비전 결과가 일치할 때만 확정한다.
- **여행 상세 이미지도 읽는다.** 지금은 `__NEXT_DATA__` 텍스트만 쓰고, 이미지 32장(`simple-agent.ts:4597`)은 화질 검사(`travel-image-quality.ts`)만 거친다. 화질 검사를 통과한 이미지 중 텍스트형 이미지(일정표, 포함·불포함, 호텔 안내)에 같은 비전 읽기 패스를 적용한다. 결과는 `TravelPageResearch`에 병합하되 `__NEXT_DATA__` 일정 순서가 우선이다.
- 연결 지점: 쇼핑 OCR 호출부 `simple-agent.ts:682`, 상세 텍스트와 사실을 대조하는 지시 `simple-agent.ts:5166`(현재 쇼핑 전용이며 여행으로 확장). 기존 `scripts/lib/image-content.ts:90` `analyzeImage`는 재사용을 검토한다.
- 리서치
  - **쇼핑**: 네이버 자동완성·연관어(`seo.ts`의 `getNaverAutocomplete`)와 opencrab SEO brief(`opencrab-seo-brief.ts`)로 "구매자 질문" 3~5개를 뽑아 FAQ와 질문형 소제목에 쓴다.
  - **여행**: 지금은 프롬프트로 "웹 검색 도구가 있으면 사용"만 지시한다(`simple-agent.ts:5198–5210`). 여기에 `travel-content.ts`의 `TravelPageResearch`와 `post-spec/travel-knowledge.ts`에 여행 준비 리서치 블록을 추가한다. 내용은 시즌·날씨, 공항↔시내 교통, 환전·결제, 유심·eSIM, 입국 서류, 동선 팁이다. 목적지 사전은 확장하고, 확인된 것만 쓴다.

## 4. SEO 제목 기획
- **신규** `scripts/lib/topic-templates/title-planner.ts`: 템플릿의 `titleFormulas`와 키워드(자동완성)로 후보 5개를 만든다. 모델 호출 1회로 끝나는 짧은 출력이다.
- 점수 기준: 핵심 키워드가 앞 15자 안에 있는가, 25~40자인가, 상품명이나 여행지·일정을 포함하는가, 금지어·이모지가 없는가, 최근 발행 제목과 겹치지 않는가.
- 공식 예시
  - 쇼핑: `[카테고리 키워드] [상품명] [체험 포인트] 후기 | [선택 기준]`
  - 여행: `[여행지] [기간] [상품유형] 꿀팁 | [일정·포함 포인트]`
- "꿀팁" 금지를 **여행에서만 허용**으로 바꾼다. 수정 위치는 `post-spec/generate.ts:69`, `simple-agent.ts:5157`(Codex 경로 제목 규칙), `blog-writing-style.ts:121–128` `stripClickbaitFromTitle`이다. `핵꿀팁`, `꿀팁 Zip`, 완벽·총정리·1위·최저가 같은 과장 문구는 계속 금지한다.
- 제목 규칙은 Codex 경로(`simple-agent.ts:5152–5158`)와 spec 경로(`post-spec/index.ts:252`, `repair.ts:29–39`) 두 곳에 있다. 플래너 결과를 두 경로에 똑같이 주입한다.
- `resolveWritingDraftTitle` 앞 단계에서 최고점 제목을 기본으로 쓰고, 나머지 후보는 UI에 대안으로 보여준다.

## 5. 모델: gpt-6 luna (low)
- (완료, 1단계) 단일 소스 `scripts/lib/draft-runtime-policy.json`에서 `CODEX_DRAFT_MODEL`을 `"gpt-6-luna"`로 바꾸고, `CODEX_DRAFT_REASONING_EFFORT: "low"`를 추가했다. Codex 0.156.1 카탈로그에서 ID와 지원 effort(low~max, none 없음)를 확인했다.
  - 정확한 모델 ID는 구현 시 `codex` CLI와 SDK 버전으로 확인한다. 테스트에 `gpt-6-astra` 명명 예가 있다. SDK나 CLI 버전이 낮으면 `@openai/codex`, `@openai/codex-sdk`를 올린다(`CODEX_MODEL_INCOMPATIBLE` 경로가 이미 있다).
- `scripts/lib/text-model-policy.ts`
  - `resolveTextReasoningEffort`의 기본값을 정책의 `low`로 바꾼다.
  - `textCompletionParameters`는 짧은 출력은 `none`/`low`, 긴 출력은 `low`로 유지한다. gpt-6에서 허용하는 effort 목록은 구현 시 확인한다.
  - GPT-5.5 주석과 URL을 갱신한다.
- `scripts/simple-agent.ts:245`: env 기본값 `"medium"`을 없애고 정책 값을 쓴다.
- 문구와 테스트를 갱신한다: `src/app/settings/page.tsx:276`, `.env.example`, `README.md`, `docs/fixed-draft-settings.md`, `docs/text-model-policy.md`, `scripts/verify-text-model-policy.ts`, `verify-codex-model-default.cjs`, `verify-codex-draft-provider.ts:72`, `verify-chatgpt-browser-mode-ui.mjs:37`.

## 6. 검수 기준 완화 (적정선)
현재는 `BRANDLINK_QUALITY_PASS_SCORE = 70`이고, **"품질 카테고리 하나 fail = 전체 불통과"** 규칙이 있다(`brandlink-content-readiness.ts`, `docs/draft-quality-gate-v2.md`). 그래서 재작성 루프가 반복된다.
- **하드 차단 유지(안전)**: 링크 본문 노출, 고지 누락, 수수료율 노출, 내부 지침 노출, 카테고리 혼입, 체험 모드가 아닐 때의 허위 체험.
- **구조 차단 완화**: 섹션 수와 분량은 템플릿 범위의 80%까지 허용한다. 해시태그 부족은 경고로 낮춘다.
- **품질**
  - 통과 점수를 70에서 **62**로 낮춘다.
  - 카테고리 fail은 "총점 ≥ 62이고 productEvidence가 fail이 아니면 **경고**"로 바꾼다. 즉 필수 fail 카테고리는 productEvidence 하나만 남긴다.
  - `repetitive-content`는 근사 중복 임계를 한 단계 완화한다.
- spec-first 검증기(`post-spec/validate.ts`): `NEAR_DUPLICATE_THRESHOLD` 0.72 → 0.8. READY 판정을 게이트 기준과 같게 맞춘다. P0는 안전 항목만 남긴다.
- **자동 보수 루프**: 지금은 Codex 경로 3회(`simple-agent.ts:5582`), spec 경로 2회(:4902)다. 이를 최대 1회 재작성으로 끝낸다. 그래도 경고만 남으면 `REVIEW`가 아니라 `APPROVED(경고 표시)`로 넘긴다(`quality-convergence.ts`, `quality-repair-policy.ts`).
- 기존 `verify-editorial-gate-calibration.ts`와 `verify-quality-repair-policy.ts`의 기대값을 갱신하고, "경고만 있는 초안은 통과" 케이스를 추가한다.

## 7. "직접 체험한 리뷰" 명확화
- 백엔드에는 이미 `VERIFIED_EXPERIENCE` 모드와 `experienceNotes`가 있다(`src/app/api/brandlinks/[id]/draft/route.ts:577`, `simple-agent.ts:402`). 하지만 **UI가 항상 `ai_assisted_information`만 보낸다**(`src/app/page.tsx:1036`).
- 근거: 상위 노출 쇼핑 글의 72%가 1인칭이다(`docs/naver-top-post-ontology-2026-08-30/shopping/analysis.md`). 따라서 체험 모드를 **기본 흐름**으로 올린다.
- **UI**: 원고 작성 전에 "체험 메모" 입력을 받는다. 항목은 구조화 폼으로 둔다: 사용 기간·횟수, 좋았던 점, 아쉬운 점, 사용 환경, 본인 사진 업로드(선택). 여행은 방문 시기, 동행, 실제 동선, 현장 꿀팁이다. 메모가 있으면 `verified_experience`로 전송한다.
- **프롬프트**
  - 체험 모드에서는 1인칭 체험 문장("써보니", "가보니")을 템플릿의 `experienceSlot` 섹션에 메모를 근거로 풀어 쓴다.
  - AI 티 나는 표현은 기존 `humanize-korean.ts`와 `rewriteSectionsForHumanTone`로 제거한다.
  - "AI가 작성" 류 문장이나 메타 문구가 새지 않게 막는다. 기존 `internal-guidance-leak`, `meta-writing-contamination` 검사를 유지한다.
- 체험 모드 게이트: 지금은 체험 모드이면 허위 체험 검사 전체가 0건 처리된다(`brandlink-content-readiness.ts:630–635`). 여기에 가벼운 **경고**만 추가한다. 체험 문장(패턴 173–182)의 핵심 토큰이 메모와 전혀 겹치지 않으면 "메모에 없는 체험"으로 표시한다. 차단이 아니라 경고여서 6번의 완화 방침과 충돌하지 않는다.
- 제목: 체험 모드에서만 `실사용`, `직접 써본`, `후기` 같은 제목 토큰을 허용한다. 현재 `UNSUPPORTED_EXPERIENCE_TITLE_PATTERN`(182)과 제목 규칙(`simple-agent.ts:5152–5158`)은 이미 모드에 따라 분기한다.
- **메모가 없으면**: 기존처럼 정보형으로 쓰고 허위 체험 차단을 유지한다. 실제로 쓰지 않은 제품을 체험했다고 쓰면 공정위 추천·보증 심사지침 위반과 계정 제재 위험이 있다. 그래서 체험 문장은 **사용자가 준 체험 메모 범위 안에서만** 생성한다.
- 여행 체험 메모가 있으면 `generate.ts:renderSectionInstruction`의 "조사형으로 쓰세요"(day-course) 지시를 체험형으로 바꾼다.

## 8. 여행 "꿀팁" 컨셉
- 여행 템플릿 전 유형에 `tips` 섹션을 넣는다. 형식은 checklist, "▸ 꿀팁: …" 3~5줄이다. 일차별 코스 섹션에는 한 줄 "💡 현지 꿀팁"을 붙인다(prose 끝줄). 이모지는 이 한 가지만 허용한다.
- 기존 자산을 재사용한다. `editorial-templates.ts`의 `travel-tips` 섹션, `travel-content.ts:682` lens 9, `travel-knowledge.ts`의 장소 유형별 팁 문장, `section-library.ts`의 `booking-check`, 게이트의 `practicalTipCount`(≥2)다. 새로 만들지 않고 "꿀팁" 표기와 위치를 템플릿에서 고정한다.
- 꿀팁의 근거 우선순위는 체험 메모 → 상품 상세(OCR·비전) → 여행 준비 리서치 블록이다. 근거가 없는 팁은 쓰지 않는다.
- 제목 공식과 FAQ에도 꿀팁 키워드를 반영한다(4번).

---

## 작업 순서 (PR 단위)
1. 모델 전환(5): 작고 독립적이다.
2. 검수 완화(6), 테스트 갱신.
3. 템플릿 레지스트리, 선택, section-library와 프롬프트 연결(1, 8).
3-1. 포스팅 각도: Prisma 필드, 자식 행 생성 API, 각도 카탈로그와 추천, 형제 글 유사도 검사, 예약 간격, UI(0).
4. 이미지 슬롯, 프롬프트 레시피(2).
5. 상세 비전 읽기, 리서치(3).
6. 제목 플래너(4).
7. 체험 메모 UI와 체험 모드 프롬프트(7).

## 검증
- `npm run typecheck`
- 기존 회귀 테스트: `test:text-model-policy`, `test:editorial-calibration`, `test:quality-repair`, `test:writing-structure`, `test:writing-harness`, `test:osaka-audit`, `test:experience-context`, `test:section-images`, `test:shopping-workflow`, `scripts/verify-editorial-templates.ts`
- 신규 테스트
  - `scripts/verify-topic-templates.ts`: 상품 샘플 13종(`docs/naver-blog-drafts/2026-07-02-*`의 8개 카테고리 + 여행 5종)의 선택 결과, 섹션 순서, 이미지 출처 배정
  - `verify-post-angles.ts`
    - 근거가 부족한 각도는 숨겨진다.
    - 자식 행은 부모 스크랩 정보를 물려받는다.
    - 형제 글끼리 대표 키워드와 제목이 다르다.
    - 유사한 섹션은 재작성 대상이 된다.
    - 예약 간격이 2일 이상이다.
    - 기존 단일 BrandLink(각도 null)는 full-review로 동작한다.
  - `verify-title-planner.ts`: 길이, 키워드 위치, 금지어, 여행 꿀팁 허용
  - `verify-detail-vision-merge.ts`: OCR과 비전 병합, 수치 불일치 시 미확정
  - 게이트: 경고만 있는 초안은 통과, 안전 위반은 차단
- 수동 E2E: 실제 쇼핑 상품 1건(이미지형 상세페이지)과 여행 패키지 1건으로 원고 생성 → 미리보기 → 네이버 임시저장까지 확인한다. 적용된 템플릿, 이미지 배치, 제목 후보, 체험 문장을 눈으로 검수한다.

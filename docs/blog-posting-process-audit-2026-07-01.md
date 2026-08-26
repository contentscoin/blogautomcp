# 네이버 블로그 포스팅 자동화 프로세스 감사

작성일: 2026-07-01  
대상 저장소: `naver-bc-automation`

## 1. 감사 범위

이번 정리는 현재 저장소에 구현된 블로그 포스팅 자동화 전체 흐름을 기준으로 한다.

- 브랜드커넥트/쇼핑커넥트 상품 수집, 선별, 링크 등록, 발행
- 상품 리뷰 글 생성, 사람형 모바일 윤문, 썸네일 생성, 네이버 에디터 입력
- 주제글 `TopicPostTask` 리서치, 후보 생성, 윤문, 이미지 매칭, 발행
- 예약/즉시/일괄/수퍼 퍼블리싱 실행 흐름
- 콘텐츠 품질, SEO, 이미지, 중복 제외, 실패 처리 규칙
- 오픈크랩 마케팅/SEO/블로그 관련 팩에서 얻은 운영 원칙

코드 근거의 핵심 파일은 아래와 같다.

- `src/app/page.tsx`
- `src/app/api/brandlinks/selection-options/route.ts`
- `src/app/api/brandlinks/bulk-seasonal/route.ts`
- `src/app/api/brandlinks/super-publish/route.ts`
- `scripts/brandconnect-seasonal-register.ts`
- `scripts/simple-agent.ts`
- `scripts/super-publish.ts`
- `scripts/bulk-today-publish.ts`
- `scripts/bulk-schedule-publish.ts`
- `scripts/lib/product-image-selection.ts`
- `scripts/lib/product-thumbnail.ts`
- `scripts/lib/blog-writing-style.ts`
- `ProductThumbnail.md`
- `src/services/topic-task-pipeline.ts`
- `src/lib/topic-task-content-readiness.ts`
- `src/lib/topic-task-publish-readiness.ts`
- `scripts/topic-agent.ts`
- `prisma/schema.prisma`

## 2. 오픈크랩 팩 로드 결과

감사용 별도 프로젝트를 만들고 마케팅, SEO, 블로그, 썸네일 품질 관련 팩을 묶었다.

- 프로젝트명: `naver-blog-automation-audit-20260701`
- 프로젝트 ID: `2542d760-1131-40e8-a974-1bb17b35987a`

로드한 팩:

| 팩 | ID | 용도 |
|---|---|---|
| 마케팅 | `95c2d607-afa7-4ae9-848f-506899c8a452` | 마케팅/전환 관점 |
| F드라이브 블로그글 전체 코퍼스 기반 네이버 블로그 작가 팩 | `cf6a3fa2-550f-4479-af4e-94ef76b2e19a` | 네이버 블로그 문체/구성 참조 |
| dev-web-seo-metadata-opencrab-pack.native-compat.upload-ready ontology pack | `ce51f2ed-f475-4803-8378-f3d33080ef0a` | SEO 메타/검색 이해도 |
| Kilo Dev Pack :: dev.web.seo-metadata | `21683656-7bfe-404e-b9c6-caec5f856b1c` | SEO 구조화 원칙 보강 |
| naver-blog-run-2026-06-25 | `384a6791-8f36-46c6-ac64-4b1bc9ddff40` | 네이버 블로그 실행/운영 로그 참조 |
| image-generation \| hermes-profile:changgojigi \| Naver blog thumbnail poster quality | `9f17ab55-1b2c-432c-ac2b-a1bbd4e64420` | 썸네일/포스터 이미지 품질 기준 |

팩에서 현재 자동화에 바로 반영할 만한 원칙은 다음으로 압축된다.

- 검색자는 정보 가치, 신뢰감, 모바일 가독성을 먼저 본다.
- SEO는 제목/본문 키워드뿐 아니라 카테고리, 메타 요약, 클릭 의도를 함께 맞춰야 한다.
- 네이버 블로그 글은 지나치게 광고처럼 보이면 이탈 가능성이 커진다.
- 모바일에서는 짧은 문장, 자연스러운 줄바꿈, 소제목 분리가 중요하다.
- 썸네일은 제품, 제품명, 후킹 문구가 20-25% 축소 상태에서도 읽혀야 한다.
- 생성 이미지에는 제품 왜곡, 한글 깨짐, 허위 혜택, 커미션/수수료 노출이 없어야 한다.

## 3. 전체 시스템 지도

현재 자동화는 두 개의 큰 발행 경로로 나뉜다.

1. 브랜드커넥트 상품 리뷰 경로

   브랜드커넥트 상품 목록을 실제 페이지/API에서 불러오고, 프로모션/카테고리 필터와 중복 제외를 거쳐 `BrandLink`를 만든다. 이후 `simple-agent.ts`가 상품 정보 수집, 글 생성, 썸네일 생성, 쇼핑커넥트 삽입, 네이버 발행까지 수행한다.

2. 주제글 `TopicPostTask` 경로

   주제/키워드를 기반으로 리서치, 후보 생성, 후보 선택, 구조화 윤문, 이미지 계획/확보, 준비 게이트를 통과한 뒤 `topic-agent.ts`가 네이버에 입력하고 발행한다.

운영 UI는 `src/app/page.tsx`가 담당한다. 여기서 상품 링크 관리, 일괄 등록, 수퍼 퍼블리싱, 주제글 준비/발행을 호출한다.

## 4. 데이터 모델

### 4-1. BrandLink

`BrandLink`는 브랜드커넥트 상품 리뷰 발행의 중심 테이블이다.

주요 필드:

- `url`: 브랜드커넥트/쇼핑커넥트 단축 URL
- `productName`, `productPrice`, `storeName`, `finalUrl`: 상품 스크랩 결과
- `imageUrls`: 상품 이미지 URL JSON 배열
- `status`: `READY`, `PUBLISHING`, `SCHEDULED`, `PUBLISHED`, `FAILED`
- `publishedAt`, `scheduledPublishAt`, `postUrl`, `errorMessage`
- `categoryNo`: 네이버 블로그 게시판 번호
- `useSectionHeading`: 본문 소제목 스타일 사용 여부
- `memo`: 선별/랭킹/운영 메모

### 4-2. TopicPostTask

`TopicPostTask`는 주제글 자동화의 중심 테이블이다.

주요 필드:

- `topic`, `keywords`, `type`, `topicCraftCategory`
- `campaignId`, `selectedDraftId`
- `pipelineStage`
- `preparedTitle`, `preparedContentJson`, `preparedContentHtml`, `preparedHashtags`
- `narrativeAngleBriefsJson`, `imagePlanJson`
- `contentReadinessReportJson`, `contentReadinessScore`, `contentReadinessPublishable`
- `status`, `publishedAt`, `scheduledPublishAt`, `postUrl`, `errorMessage`
- `categoryNo`

주제글 쪽은 상품글보다 준비 상태를 더 많이 저장한다. 이 구조는 앞으로 상품글에도 이식할 가치가 크다.

## 5. 브랜드커넥트 상품 옵션 로드

사용자는 대시보드에서 브랜드커넥트 카테고리 URL을 입력하고, 페이지에서 로드된 카테고리/프로모션 옵션을 선택한다.

프론트 흐름:

- `loadBrandConnectSelectionOptions()`가 `/api/brandlinks/selection-options`를 호출한다.
- 선택한 프로모션은 `promotionFilter` CSV로 묶인다.
- 선택한 카테고리는 `categoryFilter` CSV로 묶인다.
- 중복 제외 기간은 `duplicateWindowDays`로 전달된다. 기본값은 30일이다.

옵션 API 흐름:

- 기본 카테고리 URL은 `https://brandconnect.naver.com/916297527319296/affiliate/products/category/10031299`다.
- `NAVER_STORAGE_STATE_PATH` 또는 `playwright/storage/naver-session.json`에서 네이버 세션 쿠키를 읽는다.
- URL에서 `spaceId`와 `displayCategoryId`를 추출한다.
- 브랜드커넥트 API에서 기본 카테고리, 하위 카테고리, 상품 목록을 조회한다.
- 상품 객체에서 `badges`, `tags`, `labels`, `benefits`, `promotion`, `productBadges`, `displayBadges`, `marketingTags` 등 여러 필드를 뒤져 배지/프로모션 텍스트를 수집한다.
- 프로모션은 빈도순으로 정렬해 최대 60개를 반환한다.

현재 한계:

- 프로모션/이벤트 옵션은 브랜드커넥트 API 응답의 배지성 필드에 의존한다. 페이지에는 보이지만 API 필드에 안 잡히면 옵션 목록에 뜨지 않을 수 있다.
- 옵션 로드 카테고리 수와 상품 수는 환경변수 제한을 받는다. 기본은 카테고리 36개, 카테고리당 상품 60개다.
- 실제 페이지 UI에만 존재하는 이벤트 탭/필터가 있다면 현재 방식으로는 누락될 수 있다.

## 6. 상품 후보 수집과 선별

상품 수집은 `scripts/brandconnect-seasonal-register.ts`가 담당한다.

입력:

- `count`
- `startDate`
- `intervalDays`
- `dailyQuota`
- `categoryUrl`
- `selectionProfile`
- `promotionFilter`
- `categoryFilter`
- `duplicateWindowDays`
- `storageStatePath`
- `dryRun`

수집 방식:

- 브랜드커넥트 카테고리 페이지에 접속한다.
- 상품 목록 API 응답을 대기한다.
- 현재 카테고리 상품을 먼저 확보한다.
- 기본 카테고리와 하위 카테고리를 확장 수집한다.
- 계절, 가전, 디지털, 생활, 건강, 여행, 스포츠, 레저, 화장품, 미용, 식품, 출산, 육아 쪽 카테고리를 우선 스캔한다.
- `categoryFilter`가 있으면 카테고리 ID/이름에 매칭되는 카테고리만 사용한다.
- `promotionFilter`가 있으면 상품 배지 텍스트에 매칭되는 상품만 남긴다.

랭킹 방식:

- 현재 월 기준 계절 패턴을 반영한다.
- `selectionProfile`에 따라 계절/인기 가중치를 조정한다.
- 추천, 시즌, 히트, 핫딜, 베스트, 랭킹, 인기, 판매, 주문, 구매, 리뷰 신호를 점수화한다.
- 판매량, 주문수, 구매수, 리뷰수, 인기도 점수, 노출 순위, 할인율, 가격대를 반영한다.
- 현재 코드에는 `commissionRate` 수수료율 보너스도 남아 있다.

주의할 점:

- 사용자가 이전에 "수수료 지정은 필요 없다"고 했으므로, 수수료율은 앞으로 선별 점수와 메모에서 제거하거나 완전히 옵션화하는 것이 맞다.
- 현재 메모/로그에도 "수수료" 문구가 들어갈 수 있다. 외부 노출은 아니지만 운영 판단을 왜곡할 수 있다.

## 7. 중복 제외와 실패 이력 처리

중복 제외 규칙은 현재 요구사항과 거의 맞게 구현되어 있다.

현재 규칙:

- 상품명과 스토어명을 정규화해 strict key를 만든다.
- 용량/옵션 단위를 제거한 relaxed key도 만든다.
- 같은 배치 안에서도 중복 상품 ID, strict key, relaxed key를 막는다.
- DB의 기존 `BrandLink` 중 `FAILED` 상태는 중복 판단에서 제외한다.
- `duplicateWindowDays <= 0`이면 중복 기간 제한을 끈다.
- 기준일은 `publishedAt || scheduledPublishAt || updatedAt || createdAt` 순서로 사용한다.
- 최근 `duplicateWindowDays` 이내면 중복으로 막고, 그보다 오래된 기록은 무시한다.

운영 의미:

- 최근 30일 안에 발행/예약/갱신된 같은 상품은 다시 쓰지 않는다.
- 30일 이전에 작성한 상품은 다시 후보가 될 수 있다.
- 작성 실패한 상품은 다시 후보가 될 수 있다.

## 8. BrandLink 등록

상품 후보가 선택되면 다음 순서로 등록된다.

1. 상품별 브랜드커넥트/쇼핑커넥트 단축 URL을 발급한다.
2. 배치 내 중복 단축 URL을 막는다.
3. DB에 같은 URL이 있고 최근 중복 기간에 걸리면 건너뛴다.
4. 오래된 기존 링크는 중복 판단에서 무시한다.
5. 게시판은 상품명 키워드로 추론한다.
   - 여행 오빠
   - 맛집 오빠
   - 식품 오빠
   - 건강 오빠
   - 뷰티 오빠
   - 전자 오빠
   - 쇼핑 오빠
6. `BrandLink`를 `READY` 상태로 생성한다.
7. `scheduledPublishAt`에는 계획 날짜가 들어간다.

현재 `BrandLink` 생성 시 저장되는 정보:

- 단축 URL
- 상품명
- 스토어명
- 가격
- 게시판 번호
- 메모
- 예약 날짜
- `useSectionHeading: true`

아쉬운 점:

- 수집 단계에서 대표 이미지 URL을 안정적으로 저장하지 않는 경우가 있다. 실제 대표 이미지는 발행 시점에 다시 보강되지만, 후보 선별 단계에서 이미지 품질을 판단하기 어렵다.
- 상품 ID, 원본 브랜드커넥트 productId, 배지 원문, 카테고리 출처가 구조화 필드가 아니라 리포트/메모 중심이다.

## 9. 수퍼 퍼블리싱

`super-publish.ts`는 수집, 즉시 발행, 예약 발행을 한 번에 이어 실행한다.

단계:

1. `brandconnect-seasonal-register.ts`로 상품을 수집/등록한다.
2. 이번 실행 시점 이후 생성된 `BrandLink`를 조회한다.
3. 앞쪽 `todayCount`개는 `bulk-today-publish.ts`로 즉시 발행한다.
4. 나머지는 `bulk-schedule-publish.ts`로 예약 발행한다.
5. 결과를 모아 완료/오류 알림을 남긴다.

수퍼 퍼블리싱 실행 환경:

- `BROWSER_GPT_MODE=true`
- `ALLOW_CHATGPT_BROWSER_MODE=true`
- `CHATGPT_USE_CUSTOM_GPTS=false`
- `CHATGPT_DIRECT_ONLY=true`
- `CHATGPT_SKIP_POLISH=true`
- `HUMAN_MOBILE_POLISH_ENABLED=true`

즉, 수퍼 퍼블리싱은 Custom GPT 2차 윤문을 쓰지 않고 일반 ChatGPT direct 초안 + 로컬 사람형 모바일 윤문으로 마무리한다.

## 10. 상품 리뷰 발행 상세 흐름

상품 발행의 본체는 `scripts/simple-agent.ts`다.

### STEP 1. 상품 정보/이미지 확보

우선 DB에 저장된 `BrandLink` 정보를 사용한다.

- `url`
- `finalUrl`
- `productName`
- `productPrice`
- `storeName`
- `imageUrls`

DB 정보가 부족하면 상품 판매 페이지를 다시 열어 보강한다.

수집/정규화 항목:

- 상품명
- 가격
- 스토어명
- 최종 URL
- 설명
- 특징
- 쿠폰/할인/배송/리뷰/평점
- 이미지 후보

대표 이미지는 `scripts/lib/product-image-selection.ts`의 점수화 로직을 따른다.

우대:

- `shop-phinf.pstatic.net`
- `shopping-phinf.pstatic.net`
- 판매페이지 상품 이미지 도메인
- 갤러리 이미지
- `og:image`
- 상단 위치
- 정사각형에 가까운 상품 이미지
- `대표`, `main`, `product`, `goods`, `상품`, `gallery` 문맥

감점/제외:

- `checkout.phinf`
- `blogfiles`
- `postfiles`
- `cafefiles`
- `review`
- 후기/리뷰 이미지
- 상세/배너/쿠폰/아이콘/로고성 이미지
- 너무 작은 이미지

이 로직은 사용자가 지적한 "썸네일에 판매페이지 제품 이미지를 잘 가져와야 한다"는 기준과 맞다.

### STEP 2. SEO 글 생성

현재 기본값:

- Browser ChatGPT 모드는 환경변수로 켤 수 있다.
- Custom GPT는 기본 OFF다.
- Custom GPT OFF일 때는 ChatGPT 기본 화면 direct 방식으로 프롬프트를 넣는다.
- API 모드에서는 OpenAI/Gemini 계열 fallback도 남아 있다.

작성 규칙:

- 제목은 상품 카테고리와 상품명 키워드를 포함한다.
- 제목 길이는 25-35자 기준이다.
- 이모지는 금지한다.
- 본문은 섹션형 JSON으로 받는다.
- Browser GPT 모드 기본 섹션 수는 `CHATGPT_DEFAULT_SUBTITLE_COUNT=5`다.
- API 모드에서는 이미지 수를 고려해 8-10개 섹션을 목표로 한다.
- 각 섹션은 소제목과 4-6문장 본문으로 구성한다.
- 문장은 25-45자 안팎으로 짧게 끊는다.
- SEO 키워드를 제목, 첫 문장, 본문 중간에 자연스럽게 포함한다.
- 해시태그는 20개를 만든다.

필수 고지:

```text
이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.

자세한 상품 정보는 아래 쇼핑커넥트에서 확인해보세요.
```

중요한 현재 리스크:

- 프롬프트의 랜덤 인트로 힌트에는 "주문해봤어요", "써봤어요", "구매하게 됐어요" 같은 직접 체험 표현이 아직 들어 있다.
- 시스템/안전 규칙과 로컬 윤문이 허위 체험 단정을 줄이도록 되어 있지만, 애초 프롬프트 입력 힌트를 더 안전하게 바꾸는 편이 낫다.

### STEP 2 후처리. 사람형 모바일 윤문

`HUMAN_MOBILE_POLISH_ENABLED=true`가 기본값이다.

역할:

- 문장을 짧게 나눈다.
- 모바일 줄바꿈을 넣는다.
- 반복 표현을 줄인다.
- AI 티 나는 메타 문구를 제거한다.
- 근거 없는 체험/성능 단정을 누그러뜨린다.
- 고지문도 모바일 흐름에 맞게 다듬는다.

관련 파일:

- `scripts/lib/blog-writing-style.ts`
- `scripts/simple-agent.ts`
- `SKILL.md`

현재 방향은 사용자가 제안한 "GPT를 굳이 띄우기보다 작성된 글을 윤문 스킬로 다듬고 구성/배치"하는 방식과 맞다. 다만 초안 생성은 여전히 ChatGPT/browser 또는 API에 의존한다.

### STEP 2.5. 제품 썸네일 생성

`ProductThumbnail.md` 기준의 생성형 썸네일을 만든다.

기본 규칙:

- `THUMBNAIL_AUTOGEN_ENABLED=true`
- 판매페이지 대표 이미지인 `representativeImagePath`가 없으면 썸네일 생성은 건너뛴다.
- `scripts/lib/product-thumbnail.ts`가 상품명, 제목, 카테고리, 특징, 가격을 바탕으로 프롬프트를 만든다.
- OAuth/ChatGPT 이미지 생성이 가능하면 판매페이지 대표 이미지를 첨부해 생성한다.
- 실패하면 `PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED=true`일 때 Codex imagegen 결과 파일을 사용할 수 있다.
- `PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH`가 비어 있으면 `logs/codex-imagegen-requests/`에 요청 MD를 남긴다.
- `PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED=false`가 기본이다. 즉 sharp 후합성은 기본 경로가 아니다.

`ProductThumbnail.md` 핵심 기준:

- 실제 상품 이미지 기반
- 실제 제품명 유지
- 큰 한글 제목
- 상단 배지
- 하단 CTA
- 흰색 내부 테두리
- 제품이 크고 선명해야 함
- 스마트폰/노트북/쇼핑 화면 목업은 기본 필수 아님
- 수수료/커미션/내부 정산 정보 노출 금지
- 제품명 정확성, 제품 충실도, 한글 텍스트, 모바일 가독성, 포토리얼 장면 기준 95점 이상만 최종

현재 한계:

- 프롬프트와 fallback 경로는 갖춰졌지만, 생성된 이미지의 실제 95점 QC를 자동으로 판정하는 비전 게이트는 아직 없다.
- Codex imagegen fallback은 현재 경로 지정 방식이어서 완전한 무인 생성 루프라기보다 "요청 파일 생성 또는 지정 파일 복사"에 가깝다.
- 생성 결과의 제품 유사도, 한글 정확성, 제품명 포함 여부를 자동 판별하지 못하면 썸네일 품질 문제가 반복될 수 있다.

### STEP 3. 네이버 에디터 열기

네이버 세션 파일이 필요하다.

기본 세션 경로:

- `playwright/storage/naver-session.json`

에디터는 블로그 ID와 게시판 번호를 사용해 연다.

- `NAVER_BLOG_ID`
- `categoryNo`

### STEP 4. 제목 입력

생성된 제목을 네이버 에디터 제목 영역에 입력한다.

### STEP 5/6. 이미지와 본문 입력

본문 입력 흐름:

- 생성 썸네일이 있으면 첫 이미지로 올린다.
- 그 다음 상품 대표 이미지와 본문 이미지를 이어서 사용한다.
- 이미지와 텍스트 섹션을 번갈아 넣는다.
- 마지막 섹션은 고지/쇼핑커넥트 안내 흐름이다.
- 해시태그는 마지막에 한 줄로 넣는다.

소제목 스타일:

- `useSectionHeading=true`면 구분선과 네이버 제목 스타일을 사용한다.
- 마지막 고지 섹션은 제목 스타일을 끈다.

### 쇼핑커넥트 삽입

현재 구현은 단순 URL 붙여넣기가 아니다.

흐름:

1. 본문 포맷을 일반 텍스트로 맞춘다.
2. 줄을 하나 만든다.
3. 네이버 에디터 삽입 메뉴를 연다.
4. `쇼핑커넥트` 메뉴를 찾는다.
5. 메뉴 검색창이 있으면 `쇼핑커넥트`를 입력해 선택한다.
6. 패널이 열리면 먼저 상품명 또는 최종 URL의 `smartstoreProductId`로 표시된 상품을 직접 선택해 본다.
7. 직접 선택이 안 되면 브랜드커넥트 단축 URL을 입력하고 검색한다.
8. 검색 결과를 선택/추가/삽입/확인 버튼으로 확정한다.
9. 삽입 전후 에디터 내 쇼핑커넥트 artifact 수를 비교해 삽입을 확인한다.
10. 실패하면 `logs/manual/shopping-connect`에 스크린샷/HTML 진단을 저장한다.

관련 함수:

- `openShoppingConnectTool`
- `selectShoppingConnectToolFromMenu`
- `fillShoppingConnectUrl`
- `clickShoppingConnectItemByProductName`
- `chooseShoppingConnectResult`
- `insertShoppingConnectLink`

### STEP 7. 발행/예약

발행 모드:

- `now`
- `schedule`

예약 기본값:

- `NAVER_DEFAULT_SCHEDULE_HOUR`
- `NAVER_DEFAULT_SCHEDULE_MINUTE`
- 기본 표기: `09:00`
- `NAVER_SCHEDULE_TIMEZONE=Asia/Seoul`
- `NAVER_SCHEDULE_MIN_LEAD_MINUTES=120`

예약 날짜/시간이 현재 기준 너무 가깝거나 과거면 다음 가능한 날짜로 자동 조정한다.

성공 시 DB 업데이트:

- 즉시 발행 성공: `PUBLISHED`, `postUrl`, `publishedAt`
- 예약 발행 성공: `SCHEDULED`, `scheduledPublishAt`, `publishedAt=null`, `postUrl=null`
- 실패: `FAILED`, `errorMessage`

## 11. 일괄 발행

### 바로 일괄 발행

`scripts/bulk-today-publish.ts`

- `READY` 상태의 예약 대상 또는 오늘 대상 링크를 찾는다.
- 각 링크를 `PUBLISHING`으로 바꾼다.
- `simple-agent.ts --publish-mode=now`를 실행한다.
- 성공/실패를 수집한다.

### 예약 일괄 발행

`scripts/bulk-schedule-publish.ts`

- `READY` 상태의 예약 대상 링크를 찾는다.
- `startDate`, `intervalDays`, `createdAfter` 기준으로 날짜를 배정한다.
- 각 링크를 `PUBLISHING`으로 바꾼다.
- `simple-agent.ts --publish-mode=schedule --scheduled-date=YYYY-MM-DD`를 실행한다.
- 결과가 `SCHEDULED`가 아니면 실패 처리한다.

두 일괄 스크립트 모두 상품글 실행 환경은 Custom GPT OFF, direct, 로컬 모바일 윤문 ON이다.

## 12. 주제글 자동화 흐름

주제글 경로는 `src/services/topic-task-pipeline.ts`와 `scripts/topic-agent.ts`가 중심이다.

### 준비 단계

`prepareTopicTask(taskId)` 흐름:

1. 태스크를 조회한다.
2. 타입을 `travel`, `golf`, `knowledge` 계열로 정규화한다.
3. 키워드를 파싱한다.
4. 명시 출처 URL이 있으면 사용하고, 없으면 자동 리서치 소스를 탐색한다.
5. 리서치 시그널과 출처 요약을 만든다.
6. 네러티브 각도 후보를 만든다.
7. `TopicCampaign`을 생성/갱신한다.
8. TopicCraft 후보 생성을 요청한다.
9. 후보를 점수화하고 정렬한다.
10. 후보 Draft들을 DB에 저장한다.
11. 선택 후보를 결정한다.
12. 구조화 윤문을 수행한다.
13. Codex/editorial pass가 가능하면 추가 편집한다.
14. 이미지 계획을 만든다.
15. 이미지들을 확보한다.
16. 콘텐츠 readiness를 계산한다.
17. `TopicPostTask`를 `PREPARED`로 저장한다.

### 주제글 본문 구조

준비된 콘텐츠는 대체로 다음 구조다.

- `title`
- `lead`
- `highlights` 2-3개
- `sections` 4개
- `hashtags`
- `meta`

각 섹션은 다음 필드를 가질 수 있다.

- `heading`
- `summary`
- `body`
- `kind`: `hook`, `scene`, `mistake`, `comparison`, `proof`, `takeaway`
- `bullets`
- `stockQuery`
- `sourceRefIds`
- `imageSlotId`

### 이미지 확보

이미지 계획은 hero와 inline으로 나뉜다.

이미지 소스 우선순위는 전략에 따라 달라지지만, 현재 가능한 provider는 다음과 같다.

- source 이미지
- Pexels
- Unsplash
- Daedal
- ChatGPT OAuth image
- TopicCraft AI
- generic fallback: LoremFlickr, Picsum, DummyImage
- unresolved

운영 기본값에서는 generic fallback이 꺼져 있다.

### 발행 준비 게이트

주제글은 발행 전에 두 가지 readiness를 통과해야 한다.

콘텐츠 readiness:

- 준비된 JSON 존재 여부
- 도입부 존재 여부
- 하이라이트 2개 이상
- 섹션 3개 이상
- 키워드 반영률
- 글쓰기 메타 문구 오염
- 깨진 문장
- 반복 구조
- 모바일 호흡

이미지/발행 readiness:

- 이미 `PUBLISHING`인지 확인
- `selectedDraftId`와 준비 콘텐츠 존재 여부
- 실제 파일이 있는 이미지 존재 여부
- hero 이미지 존재 여부
- hero 또는 전체 이미지가 generic fallback인지 여부

이 게이트는 상품글 쪽에는 아직 동등하게 없다.

### 주제글 발행

`src/app/api/topic-tasks/[id]/publish/route.ts`가 발행 요청을 받는다.

- `publishMode`는 `now` 또는 `schedule`
- 예약 날짜는 `YYYY-MM-DD`
- 과거/오늘 날짜면 다음 날짜로 조정한다.
- 준비 콘텐츠와 이미지 게이트를 통과해야 한다.
- 통과 후 `topic-agent.ts --task-id=...`를 백그라운드로 실행한다.

`topic-agent.ts`는 준비된 콘텐츠가 있으면 그것을 우선 사용해 네이버 에디터에 입력한다.

- hero 이미지를 먼저 넣는다.
- lead/highlights를 먼저 넣는다.
- 섹션별 이미지 계획에 맞춰 inline 이미지를 배치한다.
- 섹션 본문을 입력한다.
- 해시태그를 마지막에 입력한다.
- 즉시/예약 발행을 처리한다.

## 13. 운영 로그와 진단 파일

주요 로그 위치:

- `logs/generated/`: 상품글 dry-run/디버그 생성 결과 JSON
- `logs/seasonal/`: 시즌/히트/인기 등록 로그
- `logs/super-publish/`: 수퍼 퍼블리싱 로그
- `logs/publish/`: 주제글 발행 로그
- `logs/manual/brandconnect/`: 브랜드커넥트 수집 리포트
- `logs/manual/shopping-connect/`: 쇼핑커넥트 삽입 실패 진단
- `logs/manual/product-thumbnail/`: 썸네일 생성 관련 진단
- `logs/codex-imagegen-requests/`: Codex imagegen fallback 요청 MD
- `temp_images/`: 발행 중 임시 이미지
- `temp_images/topic-pipeline/`: 주제글 이미지 파이프라인 결과

## 14. 중요한 환경변수

AI/ChatGPT:

- `AI_PROVIDER`
- `OPENAI_API_KEY`
- `BROWSER_GPT_MODE`
- `ALLOW_CHATGPT_BROWSER_MODE`
- `CHATGPT_USE_CUSTOM_GPTS`
- `CHATGPT_DIRECT_ONLY`
- `CHATGPT_SKIP_POLISH`
- `HUMAN_MOBILE_POLISH_ENABLED`
- `BLOG_HUMANIZE_MOBILE_STYLE`
- `CHATGPT_BASE_URL`
- `CHATGPT_GPT_URL_DRAFT`
- `CHATGPT_GPT_URL_POLISH`
- `CHATGPT_GPT_URL_TOPIC`
- `CHATGPT_FORCE_NEW_CHAT`
- `CHATGPT_GUIDED_MODE`
- `CHATGPT_DEFAULT_SUBTITLE_COUNT`

상품/브랜드커넥트:

- `BRANDCONNECT_SELECTION_PROFILE`
- `BRANDCONNECT_DUPLICATE_WINDOW_DAYS`
- `BRANDCONNECT_PRODUCT_LIST_LIMIT`
- `BRANDCONNECT_CATEGORY_SCAN_LIMIT`
- `BRANDCONNECT_OPTION_CATEGORY_LIMIT`
- `BRANDCONNECT_OPTION_PRODUCT_LIMIT`

썸네일:

- `THUMBNAIL_AUTOGEN_ENABLED`
- `PRODUCT_THUMBNAIL_CHATGPT_ENABLED`
- `PRODUCT_THUMBNAIL_COMPOSITE_FALLBACK_ENABLED`
- `PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED`
- `PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_PATH`
- `PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_REQUEST_DIR`
- `CHATGPT_GPT_URL_PRODUCT_THUMBNAIL`
- `PRODUCT_THUMBNAIL_IMAGE_WAIT_MS`

주제글:

- `TOPIC_AUTO_RESEARCH_ENABLED`
- `TOPIC_AUTO_RESEARCH_MAX_SOURCES`
- `NAVER_SEARCH_CLIENT_ID`
- `NAVER_SEARCH_CLIENT_SECRET`
- `PEXELS_API_KEY`
- `UNSPLASH_ACCESS_KEY`
- `TOPIC_PIPELINE_ALLOW_GENERIC_IMAGE_FALLBACK`
- `TOPIC_PIPELINE_DAEDAL_ENABLED`
- `TOPIC_PIPELINE_CODEX_FALLBACK`
- `TOPIC_PIPELINE_BROWSER_FALLBACK`

네이버/발행:

- `NAVER_BLOG_ID`
- `NAVER_STORAGE_STATE_PATH`
- `NAVER_DEFAULT_SCHEDULE_HOUR`
- `NAVER_DEFAULT_SCHEDULE_MINUTE`
- `NAVER_SCHEDULE_MIN_LEAD_MINUTES`
- `NAVER_SCHEDULE_TIMEZONE`

운영/보안:

- `ADMIN_API_KEY`
- `CRON_SECRET`
- `CHATBOT_NOTIFY_COMPLETION`
- `CHATBOT_NOTIFY_SINGLE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## 15. 현재 강점

- 상품 수집, 필터, 중복 제외, 예약 등록, 즉시/예약 발행까지 실제 운영 흐름이 연결되어 있다.
- 프로모션/카테고리 옵션을 하드코딩하지 않고 브랜드커넥트 페이지/API에서 로드한다.
- 최근 30일 중복 제외와 실패 상품 무시가 구현되어 있다.
- 쇼핑커넥트 삽입이 단순 URL 붙여넣기에서 메뉴/검색/선택 방식으로 개선되어 있다.
- 상품 이미지는 후기/상세 이미지보다 판매페이지 대표 이미지가 우선되도록 점수화되어 있다.
- Custom GPT 2차 윤문 의존을 줄이고 로컬 사람형 모바일 윤문을 기본값으로 둔다.
- 썸네일 지침이 `ProductThumbnail.md`로 분리되어 있고, 제품명/제품 이미지/목업 금지/후합성 금지 기준이 명확하다.
- 주제글은 콘텐츠/이미지 readiness 게이트가 있어 발행 전 품질 방어선이 있다.
- 실패 시 DB 상태와 로그/진단 파일을 남긴다.

## 16. 현재 리스크와 개선 필요점

1. 상품 후보 랭킹에 수수료율 보너스가 남아 있다.

   사용자 방향과 어긋난다. 선별 점수는 계절성, 인기, 리뷰, 가격대, 카테고리 적합성, 콘텐츠화 가능성 중심으로 바꾸는 편이 좋다.

2. 상품글에는 주제글 수준의 readiness 게이트가 없다.

   상품글도 발행 전 제목, 섹션 수, 키워드 반영, 허위 체험 단정, 메타 문구, 쇼핑커넥트 삽입 가능성, 이미지 품질을 점검하는 게이트가 필요하다.

3. 썸네일 자동 QC가 아직 약하다.

   프롬프트 지침은 강하지만 실제 생성 이미지에서 제품명/한글/제품 유사도/모바일 가독성을 자동 검증하지 않는다.

4. Codex imagegen fallback이 완전 자동이 아니다.

   지정 파일 복사 또는 요청 MD 생성에 가깝다. 무인 운영을 하려면 이미지 생성 호출과 결과 QC가 같은 프로세스 안에 들어와야 한다.

5. 상품 프롬프트에 직접 체험 힌트가 남아 있다.

   로컬 윤문이 줄여주지만, 애초에 "구매했다/써봤다"류 힌트를 "구매 전 확인해봤어요", "상세정보를 보니" 같은 관찰형 표현으로 바꾸는 것이 안전하다.

6. 프로모션/이벤트 옵션은 API 배지 의존도가 높다.

   브랜드커넥트 UI에는 보이나 API에서 안 잡히는 이벤트 필터가 있으면 누락될 수 있다.

7. 상품 수집 결과의 구조화 저장이 부족하다.

   productId, sourceCategoryIds, sourceCategoryNames, badgeTexts, rankingReasons, representativeImageUrl 등을 DB에 저장하면 재현성과 분석이 좋아진다.

8. 네이버/ChatGPT UI 자동화는 셀렉터 변경에 취약하다.

   현재 진단 저장은 있으나, 사전 health check와 셀렉터 실패율 리포트가 더 필요하다.

9. 성과 피드백 루프가 없다.

   어떤 카테고리/프로모션/제목/썸네일/섹션 구성이 실제 조회·클릭·전환에 좋은지 자동화가 학습하지 못한다.

10. 콘텐츠 캘린더 전략이 약하다.

   현재는 상품 후보 중심이다. 계절, 카테고리 분산, 블로그 게시판별 균형, 최근 발행 주제 피로도를 함께 계획하면 품질이 오른다.

## 17. 고도화 방향 제안

### A. 상품글도 TopicPostTask처럼 준비-검증-발행 상태로 분리

현재 상품글은 `BrandLink`에서 바로 `simple-agent.ts`가 생성/발행까지 간다.

추천 구조:

1. `COLLECTED`
2. `PRODUCT_READY`
3. `DRAFT_READY`
4. `THUMBNAIL_READY`
5. `SHOPPING_CONNECT_READY`
6. `PUBLISH_READY`
7. `PUBLISHING`
8. `PUBLISHED` 또는 `SCHEDULED`
9. `FAILED`

추가 저장 필드 후보:

- `productId`
- `sourceCategoryIds`
- `sourceCategoryNames`
- `badgeTextsJson`
- `rankingScore`
- `rankingReasonsJson`
- `representativeImageUrl`
- `representativeImagePath`
- `draftContentJson`
- `contentReadinessReportJson`
- `thumbnailQcReportJson`
- `shoppingConnectReadinessJson`

### B. 수수료 기반 선별 제거

랭킹에서 제거할 것:

- `commissionRate` 점수 보너스
- `수수료 n%` 랭킹 reason
- `인기/수수료 기반` fallback 문구
- 메모 내 수수료 노출

대체 점수:

- 계절성
- 판매/주문/구매/리뷰 신호
- 할인/가격대
- 카테고리와 블로그 게시판 적합도
- 제품명 SEO 명확성
- 대표 이미지 품질
- 콘텐츠화 가능성
- 중복 피로도

### C. 상품 근거 객체 만들기

상품글 생성 전에 `ProductEvidence` 객체를 만들면 허위 체험과 과장을 줄일 수 있다.

예시:

```json
{
  "observed": {
    "productName": "",
    "price": "",
    "storeName": "",
    "features": [],
    "reviewCount": "",
    "rating": "",
    "deliveryInfo": "",
    "couponInfo": "",
    "imageFacts": []
  },
  "allowedClaims": [],
  "softInferences": [],
  "forbiddenClaims": [
    "직접 구매했다",
    "직접 사용했다",
    "효과를 검증했다",
    "최저가다",
    "공식 인증이다"
  ]
}
```

글 생성 프롬프트는 이 객체만 근거로 쓰게 만들고, readiness gate가 금지 claim을 검사하게 한다.

### D. 썸네일 QC 자동화

현재 `ProductThumbnail.md` 기준을 코드 게이트로 옮기는 것이 핵심이다.

QC 항목:

- 제품명이 실제 `productName`과 일치하는가
- 한글이 깨지지 않았는가
- 제품이 reference와 같은 카테고리/형태/색감인가
- 제품이 너무 작거나 가려지지 않았는가
- 수수료/커미션/허위 혜택이 들어가지 않았는가
- 25% 축소에서도 제목/CTA가 읽히는가
- 불필요한 폰/노트북 목업이 들어갔는가

권장 흐름:

1. 판매페이지 대표 이미지 확정
2. 생성형 썸네일 1차 생성
3. 비전 QC
4. 실패 유형별 corrective prompt 생성
5. 최대 5회 재생성
6. 통과 시 `THUMBNAIL_READY`
7. 실패 시 상품은 발행 보류 또는 일반 대표 이미지로 downgrade

### E. 프로모션/이벤트 옵션 로드 강화

현재 API 배지 수집에 더해 다음을 추가할 수 있다.

- 페이지 DOM에서 이벤트/프로모션 탭 텍스트 직접 수집
- 상품 리스트 API raw 응답 샘플 저장
- 배지 필드 누락 시 fallback heuristic 확장
- 카테고리별 프로모션 수를 별도 표시
- 프로모션이 0개일 때 원인 리포트 표시

### F. 상품글 readiness gate 추가

주제글 readiness를 상품글에 맞게 만든다.

검사 항목:

- 상품명 제목/첫 문단 포함
- 섹션 수와 글자 수
- 해시태그 수
- 쇼핑커넥트 URL 직접 노출 금지
- 필수 고지 포함
- 허위 체험 단정 없음
- 과장/보장 표현 없음
- 수수료율/커미션율 노출 없음
- 모바일 문장 길이
- 대표 이미지 존재
- 썸네일 QC 통과 또는 fallback 정책 명확

### G. 쇼핑커넥트 삽입 안정화

현재 구현은 꽤 방어적이지만, UI 자동화라서 계속 깨질 수 있다.

추가하면 좋은 것:

- 쇼핑커넥트 health check API
- 실제 삽입된 카드에서 상품명/URL 검증
- 실패 유형 분류: 메뉴 없음, 패널 없음, 입력창 없음, 결과 없음, 삽입 버튼 없음
- 실패 시 자동 재시도 전에 페이지 새로고침/에디터 재진입
- 상품명 매칭 점수와 선택 결과 저장

### H. SEO/콘텐츠 전략 레이어

상품 단건 최적화에서 블로그 전체 운영 최적화로 확장한다.

추가 데이터:

- 최근 30/60/90일 발행 카테고리 분포
- 상품 카테고리별 성과
- 제목 패턴별 성과
- 썸네일 패턴별 성과
- 계절 이벤트 캘린더
- 게시판별 최적 발행 시간

결정 로직:

- 오늘은 어떤 게시판을 채울지
- 어떤 카테고리를 쉬게 할지
- 어떤 키워드 cluster를 이어갈지
- 상품글과 정보성 글 비율을 어떻게 조절할지

### I. 오픈크랩 팩을 운영 피드백 루프로 사용

팩은 한 번 읽고 끝내기보다, 발행 결과와 실패 로그를 다시 반영하는 쪽이 좋다.

추천:

- 발행 성공/실패/보류 리포트를 OpenCrab 프로젝트에 주기적으로 요약
- 썸네일 실패 유형을 별도 ontology로 축적
- 카테고리별 좋은 제목/본문/CTA 패턴을 팩화
- 네이버 UI 변경 대응 로그를 팩화
- 월별 "블로그 운영 전략 팩" 생성

## 18. 우선순위 제안

가장 먼저 할 일:

1. 상품 랭킹에서 수수료 점수/문구 제거
2. 상품글 readiness gate 추가
3. 썸네일 비전 QC 루프 추가
4. 상품 수집 결과 구조화 저장 확장
5. 프로모션/이벤트 옵션 DOM fallback 추가

그 다음:

1. 상품글 준비/발행 상태를 더 세분화
2. 쇼핑커넥트 삽입 health check 추가
3. 콘텐츠 캘린더와 카테고리 분산 로직 추가
4. 발행 성과 피드백 루프 추가
5. 오픈크랩 팩을 월별 운영 지식으로 갱신

## 19. 결론

현재 자동화는 이미 "수집 → 선별 → 글 생성 → 썸네일 → 쇼핑커넥트 → 발행/예약"까지 연결되어 있다. 특히 최근 수정으로 Custom GPT 2차 윤문 의존이 낮아졌고, 로컬 모바일 윤문과 쇼핑커넥트 메뉴 삽입 흐름이 들어가면서 운영 방향이 더 명확해졌다.

다음 고도화의 핵심은 더 많은 기능을 붙이는 것이 아니라, 상품글에도 주제글 수준의 준비/검증 게이트를 넣는 것이다. 상품 후보 선별, 근거 기반 글쓰기, 썸네일 QC, 쇼핑커넥트 삽입 검증을 각각 상태화하면, 자동화는 단순 실행 스크립트에서 운영 가능한 블로그 퍼블리싱 시스템으로 올라간다.

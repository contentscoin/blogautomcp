# 외부 저장소 기술 분석 및 blogautomcp 적용 보고서

기준일: 2026-08-27

## 분석 원칙

- 각 저장소는 아래 고정 커밋의 문서와 실제 구현을 함께 확인했다.
- 라이선스가 확인되지 않은 저장소의 코드는 복사하지 않고 구조와 검증 계약만 독립 구현했다.
- 검색 노출을 보장하는 표현, 고정 키워드 반복, 제공되지 않은 체험·가격·혜택은 적용 대상에서 제외했다.
- 현재 프로젝트에 이미 더 강한 구현이 있으면 외부 구현으로 되돌리지 않았다.

## 1. choigpt-ai/naver-blog-automation: 네이버 SEO

- 고정 커밋: [`d2f53182fa403e8f35335c8235c5210851851bc3`](https://github.com/choigpt-ai/naver-blog-automation/tree/d2f53182fa403e8f35335c8235c5210851851bc3)
- 라이선스: MIT
- 주요 근거: `core/golden_keywords.py`, `core/keyword_researcher.py`, `core/llm_generator.py`, `core/thread_expander.py`, `core/content_parser.py`

### 추출한 유효 기술

1. 키워드를 감으로 고르지 않고 `월간 검색량`, `블로그 문서 수`, `조회 상태`, `기준일`을 한 묶음의 근거로 관리한다.
2. 검색광고 연관 키워드는 최소 검색량과 시드 관련성으로 먼저 거른 뒤 경쟁 문서 수를 조회한다.
3. 원시 기회 점수는 대략 `검색량 / (문서 수 + 1)`이며, 후보 안에서 0~100으로 정규화한다.
4. API가 없거나 경쟁 문서 수를 받지 못할 때는 실패를 숨기지 않고 중간 검색량 선호 방식으로 폴백한다.
5. 제목·첫 문단·본문·태그에 키워드 역할을 나누되 문맥 관련성이 낮은 연관 키워드는 제외한다.

### 그대로 적용하지 않은 부분

- C-Rank/D.I.A를 만족한다고 단정하는 프롬프트: 외부에서 검증할 수 없는 주장이다.
- 키워드 5~8회 같은 고정 반복 규칙: 문서 길이와 검색 의도를 무시해 부자연스러운 글을 만들 수 있다.
- “제가 직접 구매/사용했다”는 체험 문장 생성: 실제 경험 근거가 없으면 허위 서술이다.
- 검색량 API가 실패했는데도 계산값을 실제 지표처럼 표시하는 방식: 근거 상태를 명시해야 한다.

### 현재 프로젝트 적용 판단

현재 `opencrab-seo-brief.ts`는 경쟁글 구조·이미지 수·근거 기준일과 폴백 상태를 이미 관리한다. 따라서 이번에는 별도 SearchAd 호출을 억지로 추가하지 않고, 향후 실 API를 붙일 때 다음 계약을 지키도록 설계 기준을 확정했다.

```text
keyword, monthlySearchVolume, blogDocumentCount, opportunityScore,
source, sourceDate, fetchStatus, fallbackReason
```

실 검색량을 운영 화면에 표시하려면 네이버 검색광고 API 자격 정보와 실제 응답 검증이 별도로 필요하다.

## 2. we-insub/codex_blog_write: MCP 적용 기술

- 고정 커밋: [`3ed30c68549409f5b1a4de3da19d460a4cdcdc86`](https://github.com/we-insub/codex_blog_write/tree/3ed30c68549409f5b1a4de3da19d460a4cdcdc86)
- 저장소에서 라이선스 파일을 확인하지 못함
- 주요 근거: `plugins/mato-blog-codex/scripts/history.py`, `upload.py`, `validate_posts.py`, `profile_connector.py`, `sanitize_images.py`

### MCP에 옮길 수 있는 실행 계약

| 원본 개념 | MCP/PC 앱 적용 | 현재 상태 |
|---|---|---|
| 자연어 요청을 구조화된 실행 요청으로 변환 | 도구별 JSON 스키마와 `connectKind`, 상품/초안 ID 분리 | 구현됨 |
| 계획과 실제 실행 분리 | 초안 생성 후 `confirmed=true`가 있어야 발행 | 구현됨 |
| RUN_ID와 계획 서명 | `idempotencyKey`로 같은 작업 재사용, 다른 입력 재사용 거절 | 이번에 충돌 검증 보강 |
| 프로필·블로그 대상 고정 | 단일 활성 PC, 상품 커넥트 종류와 DB 항목 일치 확인 | 구현됨 |
| 성공 항목 건너뛰기·재개 | 중복 작업 방지와 작업 상태 조회 | 부분 구현, PC 강제 종료 후 RUNNING 임대 회수는 미구현 |
| append-only 실행 이력 | 사이트 `AgentJob` 결과·오류 저장 | 구현됨, 상세 단계 이벤트는 제한적 |
| 이미지 메타데이터 제거·해시 manifest | 업로드 전 EXIF/GPS 제거와 변경 감사 | 유효하지만 이번 범위에서는 분석만 완료 |

### 발견한 실제 보강점

사이트는 같은 `idempotencyKey`가 있으면 기존 작업을 반환했지만, 기존 입력과 새 입력이 다른지 코드 수준에서 비교하지 않았다. 이번 변경은 작업 종류와 정렬된 JSON 입력이 모두 같을 때만 재사용하고, 다르면 `IDEMPOTENCY_CONFLICT`를 반환한다.

다음 단계 우선순위는 PC가 작업을 받은 뒤 종료되는 경우를 위한 `claim lease`, heartbeat, 만료 후 재큐잉이다. 자동 발행이 중복될 수 있으므로 단순 재시도보다 “결과 불확실” 상태와 네이버 게시물 확인 절차가 먼저 필요하다.

## 3. Daewooki/naver-bc-automation: 쇼핑커넥트 글쓰기와 이미지

- 고정 커밋: [`ea9a131658a35f938116557832d469fa0b5b4e28`](https://github.com/Daewooki/naver-bc-automation/tree/ea9a131658a35f938116557832d469fa0b5b4e28)
- 저장소에서 라이선스 파일을 확인하지 못함
- 주요 근거: `scripts/simple-agent.ts`

### 추출한 방식

1. 상품 페이지에서 상품명, 설명, 특징, 가격, 할인, 쿠폰, 배송, 리뷰 수, 평점과 상품 이미지를 수집한다.
2. 네이버 이미지 CDN 주소는 가능한 경우 큰 크기 변형을 요청하고 아이콘·로고·1x1 이미지를 제외한다.
3. 글 섹션 수와 이미지 수를 맞추고 `이미지 → 해당 설명` 순서로 교차 삽입한다.
4. 첫 이미지가 대표 역할을 하고, 본문 끝에는 해시태그와 쇼핑커넥트 고지를 둔다.

### 현재 프로젝트와 비교

현재 `blogautomcp`의 구현이 원본보다 강하다.

- 이미지 URL 도메인뿐 아니라 위치·클래스·비율·크기·파일 크기로 대표/본문/배너/리뷰 이미지를 구분한다.
- 작은 이미지와 과도하게 긴 상세 배너를 제외하고 필요한 경우 정사각 상세 크롭을 만든다.
- 생성형 썸네일을 첫 이미지로 확인하고, 나머지는 본문 섹션과 교차 배치한다.
- 링크를 본문 텍스트로 붙이지 않고 SmartEditor 쇼핑커넥트 컴포넌트를 삽입한 뒤 실제 카드 생성 여부를 센다.
- 실제 구매·택배 수령·사용 경험을 만들지 않으며, 수수료율과 내부 작성 지침의 본문 유출을 발행 전에 차단한다.

원본의 랜덤 인트로·마무리는 대부분 허위 구매·사용 경험을 전제로 하므로 적용하지 않았다. 교차 배치 방식만 유지하고, 이번 변경에서는 각 이미지에 `대표`, `구성`, `기능 근거`, `사용 장면`, `비교`, `옵션·주의` 역할을 부여하는 글 구성 계약을 추가했다.

## 4. contentscoin/sangsea: 글 흐름과 와디즈 상세페이지 기술

- 고정 커밋: [`93907e40cf01ea3e0bc7cca9d418dc2bbd8b0c91`](https://github.com/contentscoin/sangsea/tree/93907e40cf01ea3e0bc7cca9d418dc2bbd8b0c91)
- 주요 근거: Wadiz 상세페이지 production skill의 source attribution, fact map, copy flow, asset gate, publication gate

### 블로그 글에 맞게 변환한 흐름

상세페이지의 긴 컷 흐름을 그대로 복제하지 않고 4~9개 블로그 섹션으로 압축했다.

```text
문제·선택 기준
→ 상품 공개·구성
→ 기능이 주는 효익
→ 스펙·상세 정보로 증명
→ 맞는 사용 장면
→ 비교 기준
→ 가격·혜택 확인
→ FAQ·주의
→ 조건형 CTA
```

각 섹션은 `목적`, `사용 가능한 근거`, `금지 주장`, `이미지 역할`을 함께 가진다. 가격·할인·평점·정책은 확인된 값이 있을 때만 사용하고, 제품 기능과 독자 효익을 분리한다. 효익은 기능으로부터 합리적으로 이어질 때도 단정 대신 조건형으로 쓴다.

### 구현 위치

- `scripts/lib/product-editorial-plan.ts`: 근거 기반 섹션·이미지 역할 계획, 프롬프트 포맷, 흐름 커버리지 검사
- `scripts/simple-agent.ts`: API·브라우저 ChatGPT 양쪽 생성 경로와 저장되는 미리보기에 동일한 계획 적용
- `scripts/lib/brandlink-content-readiness.ts`: 문제-효익-근거-사용-주의 흐름을 발행 신호로 검사
- `apps/site/src/app/api/mcp/[credential]/route.ts`: idempotency key 입력 충돌 검증
- `scripts/verify-repository-techniques.ts`: 계획·금지 근거·발행 게이트 회귀 검증

## 검증 기준

1. TypeScript 전체 타입 검사
2. ESLint
3. PC 앱 production build
4. 사이트 typecheck와 MCP 테스트
5. 새 상품 글 흐름 회귀 테스트

실 검색광고 API 호출, 실제 네이버 SmartEditor 발행, 여행커넥트 카드 삽입은 자격 정보·운영 계정·확정되지 않은 여행 에디터 계약이 필요하므로 이 분석만으로 완료됐다고 간주하지 않는다.

# 커넥트 원고 품질 게이트 v2 — 하드 차단과 품질 점수의 분리

작성일: 2026-09-02

## 왜 바꿨나

기존 판정기(`scripts/lib/brandlink-content-readiness.ts`)는 다음 문제가 있었다.

- 점수는 `100 − 실패 신호 × 18 − 경고 × 5`로 계산되어 10점·28점까지 내려갔지만, 실제 통과 여부는 점수와 무관하게 "처음 걸린 실패 신호 하나"로 결정됐다. 점수를 봐도 왜 막혔는지, 얼마나 고쳐야 하는지 알 수 없었다.
- 허위 체험·URL 노출 같은 **치명적 실패**와, 근거 밀도·반복 같은 **품질 실패**가 같은 층위로 섞여 있었다.
- 반복 문장 검사는 정규화 후 **정확히 같은 문장**만 세서, 숫자·어미만 바꾼 문장(`판단 포인트 1은 …`, `판단 포인트 2는 …`)을 전부 통과시켰다.
- 여행 글에 쇼핑 문구가 섞여도 `missing-review-substance` 안에 묻혀 보였다.
- 편집(초안) 단계에서도 대표 이미지 미확정을 차단 사유로 냈다.

## 판정 구조

```
getBrandLinkContentReadiness()
 ├─ blockers[]  (하드 차단, 점수 무관)
 │    tier=safety   : link-in-body, missing-disclosure, unsupported-experience-claim,
 │                    commission-rate-exposed, internal-guidance-leak, category-mismatch
 │    tier=structure: non-generative-fallback, missing-product-name, too-few-sections,
 │                    too-short-content, too-few-hashtags, missing-representative-image(발행 모드만),
 │                    composition-quality(발행 모드만)
 └─ quality        (0~100, 카테고리 6개)
      productEvidence 25  상품/여행지 고유 근거
      sceneLinkage    20  기능→사용 장면 / 여행지 사실→현장 장면 연결
      specificity     15  정보의 구체성 (사용법 문장, 상세페이지 낭독 비율 / 배경·풍경·즐길거리·팁)
      diversity       15  문단 다양성·문장 반복 (근사 중복 포함)
      usefulness      15  구매/여행 판단 요소 (장점·제약·대상·결론, 모호한 말투, 필수 흐름)
      clarity         10  확인 안내·일반론 비율
```

- `verdict`: `blocked` (차단 1개 이상) / `quality` (차단 없음, 카테고리 fail 또는 점수 < 70) / `pass`
- `canPublish = verdict === "pass"`
- `score`는 항상 **품질 점수**다. 차단이 있어도 품질 점수는 그대로 보고하므로, "차단 3건 + 품질 82점"처럼 읽힌다.
- "한 항목 실패 = 전체 불통과"는 유지한다. 대신 어떤 실패가 치명적(차단)이고 어떤 실패가 품질(보강 대상)인지 `blockers`와 `quality.categories`로 구분한다.
- 대표 코드 우선순위: 안전 차단 → 구조 차단 → 반복(`repetitive-content`) → 일반론(`generic-guidance-heavy`) → 근거(`low-evidence-density`) → 판단 요소(`missing-review-substance`) → `quality-score-below-threshold`.

기존 필드(`canPublish`, `code`, `score`, `signals`, `summary`)는 그대로 유지되므로 매니페스트·MCP 응답을 읽는 쪽은 바꾸지 않아도 된다.

## 반복·일반론 검사 (`scripts/lib/draft-quality-signals.ts`)

- `assessRepetition(sections)`: 문장을 토큰(조사 제거, 4글자 이상 어간 3글자)으로 바꿔 자카드 유사도 ≥ 0.72면 근사 중복으로 센다. 정확 일치, 같은 문장으로 시작하는 문단 수도 함께 돌려준다. 쇼핑·여행 판정기와 spec-first 검증기가 모두 이 함수를 쓴다.
- `assessGenericLanguage(text, { evidenceTokens })`: 확인 안내 문장(`확인해보세요`, `살펴보는 게 좋아요`, `알기 어렵습니다` …)과 일반론 문장(`상황에 따라`, `개인차`, `달라질 수 있` …)을 센다. 일반론은 **문장에 수치·상품 토큰·근거 토큰이 하나도 없을 때만** 센다.
- `evidenceUsedIn(line, text)`: 근거 줄이 본문에 실제로 쓰였는지(수치 1개 + 설명 토큰 1개, 또는 설명 토큰 2개) 판정한다.

## 생성 측 — 섹션별 근거표 (`scripts/lib/post-spec/evidence-ledger.ts`)

`buildPostSpec()`이 섹션 구성표를 확정한 직후 근거표를 만든다.

- 본문(prose·qa-3·checklist) 섹션마다 **전용 근거**를 1개 이상 배정한다. 전용 근거는 한 섹션에만 속하고 다른 섹션은 재사용하지 못한다.
- 가격·상품명·기간·리뷰 수처럼 여러 섹션이 참조해야 하는 값은 **공용 근거**로 둔다.
- 쇼핑: 역할별로 필요한 종류를 먼저 준다 (`hook-problem`←잘 맞는 대상, `product-reveal`←분류·용도·구조, `benefit`←장점 카드+수치, `use-case`←장점 카드+설치·충전·관리 근거, `proof`←구매후기 원문+수치, `comparison`←비교 기준+제약, `faq`←제약+미확인 사실, `fit-checklist`←대상). 남는 상세 근거는 전용 근거가 적은 섹션부터 라운드로빈으로 나눠 준다(섹션당 최대 3개).
- 여행: 코스 포인트 섹션은 각자 다른 방문지를 전담하고, `reasons-3`·`booking-check`·`faq`가 상품 조건(출발확정·노쇼핑·시내숙박 …)을 나눠 갖는다.
- 프롬프트(`renderSectionInstruction`)에는 "이 섹션 전용 근거(최소 1개 그대로 사용)", "공용 근거", "다른 섹션 전용 근거(여기서는 쓰지 않기)"가 함께 들어가고, 시스템 규칙에 반복·일반론 제한이 추가됐다.
- 버그 수정: 섹션 라이브러리가 확인 사실 줄을 `특징:` 접두사로 찾았지만 실제 줄은 `상세 근거:`로 시작해 항상 `핵심 기능`·`구성` 같은 빈 문구로 대체되던 문제를 고쳤다.

## 생성 후 자기검수 (`scripts/lib/post-spec/validate.ts`)

새 수리 타깃:

| 코드 | 우선순위 | 조건 |
| --- | --- | --- |
| `EVIDENCE_UNUSED` | P1 | 전용 근거를 하나도 쓰지 않은 섹션 |
| `GENERIC_GUIDANCE` | P1 | 확인 안내·일반론 문장이 2개 이상이고 섹션 문장의 절반 이상 |
| `REPEATED_LINE` | P1 | 다른 섹션과 정확히 같거나 근사 중복인 줄 (사실 목록·체크리스트는 정확 일치만) |
| `CATEGORY_MISMATCH` | P0 | 쇼핑: 다른 상품군 용어, 여행: 배송·교환·구성품 같은 쇼핑 문구 |

점수·상태 통일:

- `score = 품질 점수 × 0.6 + 스펙 준수 점수 × 0.4`
- `BLOCKED`: P0 타깃 존재. `NEEDS_REVIEW`: P1 타깃, 품질 카테고리 fail, 품질 점수 < 70, 또는 경고 5개 이상. 그 외 `READY`.
- 보고서에 `quality { score, passScore, categories, blockers }`가 추가됐다.

기존 수리 루프(`runSpecFirstPipeline`)는 그대로 타깃 섹션만 다시 쓰며, 수리 프롬프트에 전용 근거·다른 섹션 첫 두 줄·"확인 안내 1개 이하" 규칙이 들어간다. 레거시 경로(`simple-agent.ts`의 `assessEditorialQuality` 수리)는 `quality-score-below-threshold`도 수리 대상으로 삼고, 프롬프트에 하드 차단·품질 카테고리 노트·반복 문장 예시를 함께 넘긴다.

## 검증

- `npm run test:brand-post-quality` — 차단/품질 분리, 숫자만 바뀐 반복 문장 차단, 여행 글 쇼핑 문구 차단, 편집 모드 이미지 미요구
- `npm run test:post-spec` — 근거표 유일성·전용 근거 보장, `EVIDENCE_UNUSED`/`GENERIC_GUIDANCE`/`REPEATED_LINE`/`CATEGORY_MISMATCH` 타깃
- `npm run test:repository-techniques`, `test:brand-post-package`, `test:post-composition`, `test:travel-editorial`, `test:travel-draft-resilience`, `test:codex-draft-provider`, `test:mcp-contract` — 회귀 없음

## 2026-09-24 보정 — 적정 기준

"품질 카테고리 하나 실패 = 전체 불통과" 규칙 때문에 점수가 높은 원고도 재작성 루프를 돌았다. 안전 차단은 그대로 두고 품질 기준만 낮췄다.

- 통과 점수: 70 → **62** (`BRANDLINK_QUALITY_PASS_SCORE`)
- 총점이 기준 이상이면 필수 카테고리는 `productEvidence`(상품·여행지 고유 근거) 하나만 남는다(`BRANDLINK_MANDATORY_QUALITY_CATEGORIES`). 나머지 카테고리 실패는 `warn`으로 낮추고 "총점 기준 충족으로 권고 사항으로 처리" 메모를 붙인다. 점수는 그대로 보고한다.
- 예외: 거의 같은 틀의 문장이 5회 이상 반복되면(`BRANDLINK_SEVERE_REPETITION_COUNT`) 유사문서 위험 때문에 계속 실패로 남긴다. 반복 허용 한도는 2 → 3이다.
- 구조: 섹션 최소치는 계약 최소치의 80%(최소 3개)까지 허용한다. 해시태그는 0개일 때만 차단하고 1~2개는 경고 신호로 남긴다.
- 안전 차단(링크 노출, 고지 누락, 허위 체험, 수수료율, 내부 지침, 카테고리 혼입)은 변경 없음.
- 재작성: Codex 경로 3회 → 1회, spec 경로 2회 → 1회. 경고만 남은 원고는 `canPublish=true`라서 승인 흐름으로 넘어간다.
- spec 검증기: 근사 중복 임계 0.72 → 0.8. 경고 5개 이상이라는 이유만으로는 `NEEDS_REVIEW`로 보내지 않는다.

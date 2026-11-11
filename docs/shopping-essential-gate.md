# 쇼핑커넥트 essential 게이트

쇼핑 원고는 잘못된 글만 발행을 막는다. 품질 채점은 남기되 권고와 1회 자동 보강에만 쓴다. 여행커넥트는 바뀌지 않는다.

설정: `SHOPPING_GATE_PROFILE` (`essential` 기본, `strict`로 이전 동작). 코드: `scripts/lib/brandlink-content-readiness.ts`의 `resolveBrandLinkGateProfile`.

## 발행을 막는 것

| 코드 | 내용 |
| --- | --- |
| `missing-product-name` | 제목·본문에 상품명이 없음 |
| `category-mismatch` | 다른 상품군 문구 혼입 |
| `missing-disclosure` | 커넥트 고지 누락 |
| `link-in-body` | 본문에 커넥트·상품 URL 노출 |
| `commission-rate-exposed` | 수수료율·정산 정보 노출 |
| `internal-guidance-leak` | 프롬프트·내부 지침 문구 유출 |
| `unsupported-experience-claim` | 근거 없는 구매·사용 체험 단정 |
| `unsupported-option-claim` | 출처에 없는 리필 구성 주장 |
| `unsupported-health-claim` | 질병 치료·예방, 부작용 없음 단정 (신규, strict에도 적용) |
| `non-generative-fallback` | AI 작성·승인 원고가 아님 |
| `too-few-sections` / `too-short-content` | 본문 섹션 3개 미만, 800자 미만 |
| `too-few-hashtags` | 해시태그 0개 |
| `missing-representative-image`, `composition-quality` | 대표 이미지·이미지 구성 (기준 변경 없음) |

## 권고로 바뀐 것

품질 점수 미달(62점), 근거 밀도, 일반론 비율, 반복 문장, 리뷰 구성 요소 누락. 결과의 `advisory { code, reason }`에 strict였다면 났을 판정이 담기고 `canPublish`는 `true`다. 저장되는 품질 리포트는 실패 카테고리를 `warn`으로, `passScore`를 0으로 기록해서 승인·재검증·화면이 같은 결론을 낸다.

PC 자동 작성은 권고가 있으면 보강을 한 번 시도하고, 더 나아졌을 때만 교체한다. ChatGPT 제출 원고는 다시 쓰지 않고 권고만 돌려준다.

## 검증

`npm run test:shopping-essential-gate`

## 상품 근거 수집 (P2)

쇼핑 상품 페이지에서는 화면 요소보다 먼저 페이지 내장 상태 JSON과 페이지가 받은 상품 JSON 응답을 읽는다(`scripts/lib/shopping-product-card.ts`). 상품명·가격·카테고리·이미지·상세 본문·속성·옵션을 얻고, 찾지 못하면 기존 화면 요소 수집으로 동작한다. 작성 로그의 `구조화 상태:` 줄에서 발견 여부를 확인할 수 있다.

essential 프로필에서는 텍스트 근거가 적어도(`sparse`) 작성을 중단하지 않는다. 상품명을 확인하지 못한 경우는 계속 중단한다. 근거가 적은 상품은 생활 장면·고민 해결·고르는 기준 중심으로 쓰고, 제공되지 않은 수치·규격·구성품을 만들지 않도록 지시한다. `strict`에서는 이전처럼 `SOURCE_EVIDENCE_REQUIRED`로 중단한다.

실제 페이지에서 무엇이 잡히는지 확인하려면 PC에서 `npm run capture:shopping-page -- <상품 URL>`을 실행한다. 결과는 앱 데이터 폴더의 `shopping-fixtures/`에 저장되며 계정·인증 관련 값은 지워진다.

## 이미지 (P3)

기본 계획은 그대로다: 썸네일 1장, 본문에 판매페이지 원본 1장과 AI 연출 사진 3장. 연출 사진은 먼저 만들어 보고 검수한다.

essential 프로필에서는 연출 사진을 끝내 채우지 못해도 글을 막지 않는다. 이미지 준비가 연출 사진의 생성·검수 실패로 끝나면 재계획 단계가 빈 연출 슬롯을 선택 사항으로 낮추고, 썸네일과 원본 1장(그리고 통과한 연출 사진)만으로 구성을 확정한다. 거절된 연출 파일은 구성에서 빠진다. 기록: `pipelineNotes`의 `IMAGE_SCENES_RELAXED`, `composition.sceneCoverage = "relaxed"`, `composition.imageFloor`. 완화 표시 없이 남은 하한은 인정하지 않는다.

완화된 글은 빈 연출 자리에 **서로 다른 판매자 실사진**을 더 쓴다(본문 원본 합계 최대 4장, 2026-11-10 사용자 결정으로 "원본 1장" 규칙 해제). 실사진은 기존 원본 검수를 통과한 것만 붙이고 같은 사진을 반복하지 않는다. 붙일 사진이 없으면 원본 1장으로 발행한다. 완화되지 않은 글은 이전처럼 원본 1장이다.

바뀌지 않는 것:
- 썸네일이나 판매페이지 원본이 없으면 완화하지 않는다(`REPLAN_ORIGINAL_PHOTO_REQUIRED`).
- 통과한 연출 사진의 검수 기준은 그대로다.
- 로그인 만료, 이미지 엔진 연결 실패, 사용자 취소, 다른 작업과의 경합은 완화하지 않고 실패로 알린다.
- `strict`에서는 이전처럼 `REPLAN_NATURAL_PHOTOS_REQUIRED`로 남는다.

코드: `src/lib/brand-post-image-replan.ts`의 `relaxUnfilledNaturalScenes`, `scripts/lib/scheduled-draft-workflow.ts`의 `isOptionalSceneImageFailure`. 검증: `npm run test:shopping-scene-relax`.

## 글 구성 (P4)

- **소제목 이모지**: 쇼핑 글 소제목 앞에 내용에 맞는 이모지 1개를 붙인다(가격 💰, 세척·보관 🧼, 추천 대상 🙋, 질문 ❓ 등). 모델 출력에 기대지 않고 정리 단계에서 일관되게 붙인다. 글 제목과 본문 문장, 여행 글에는 쓰지 않는다. 코드: `scripts/lib/shopping-heading-emoji.ts`.
- **설득 구조**: 상황 한 장면 → 누구에게 맞는지 한 줄 결론 → 사실마다 생활에서 달라지는 점 → 솔직한 한계 → 맞는 사람·아닌 사람 → 정리와 상품 카드 안내 한 문장. 긴급함을 꾸미는 말과 근거 없는 최상급은 금지한다. 코드: `SHOPPING_PERSUASION_STRUCTURE`(`scripts/lib/blog-writing-style.ts`).
- 검증: `npm run test:shopping-heading-emoji`.

## 목록 동기화 (P5)

- **결과 이유 표시**: 동기화가 끝나면 왜 그 개수인지 알려준다. 목록을 못 받음(로그인·권한), 검색어에 맞는 상품 없음, 전부 이미 등록됨, 링크 발급 실패, 일부만 가져옴을 구분한다. 플러그인과 화면 응답의 `diagnosis`에 담긴다. 코드: `scripts/lib/brandconnect-list-diagnosis.ts`.
- **브랜드 검색 범위 확장**: 브랜드·스토어 검색어에 맞는 상품이 요청 수보다 적으면 탐색 카테고리를 36개에서 최대 80개로 넓혀 한 번 더 확인한다.
- **목록 필드 보존**: 목록 응답에 대표 이미지나 상품 주소가 있으면 상품 등록 때 함께 저장한다.
- 한계: 브랜드커넥트의 상품 검색 API는 확인하지 못해 여전히 카테고리별 상위 상품 범위 안에서만 찾는다.
- 검증: `npm run test:list-diagnosis`.

## 플러그인 기본 흐름 (P6)

- 서버 안내문 맨 앞에 기본 흐름을 둔다: `agent_get_status` → `brandconnect_sync_products` / `brandconnect_list_products` → `materials_prepare` → `materials_list` → `materials_publish`(진행 확인은 `job_get`). 다른 도구는 사용자가 그 작업을 구체적으로 요청할 때만 쓴다.
- 도구 목록에서 이 도구들을 맨 앞에 둔다. 나머지 도구는 기존 대화 호환을 위해 그대로 제공한다.
- 안내문에 두 가지를 명시한다: 쇼핑 원고는 `canPublish=true`이면 권고(advisory)가 있어도 다시 쓰지 않는다. 연출 사진 없이 실사진만으로 준비된 소재는 실패가 아니다.
- 코드: `apps/sites/app/api/mcp/[credential]/route.ts`의 `CORE_TOOL_NAMES`.

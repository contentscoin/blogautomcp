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

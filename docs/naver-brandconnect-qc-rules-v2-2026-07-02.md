# Naver BrandConnect QC Rules v2

작성일: 2026-07-02
적용 대상: Naver BrandConnect SEO Posting Workflow v2

## 1. Evidence Gate

발행 초안은 아래 조건을 모두 만족해야 한다.

- exact anchor 포함: `ANCHOR|CRAB_MICRO_TOP3|pid=<product_id>|priority=1`
- `P`, `R1`, `R2`, `R3`, `D` 행을 근거로 사용
- `D|img=<n>`의 이미지 목표를 사진 계획에 반영
- Evidence Note에 document_id, source, source_url, required rows, extracted pattern, image target 기록
- legacy source를 사용한 경우 canonical evidence 미확보 사유를 명시

Fail 조건:

- product_id가 다른 evidence를 섞음
- natural-language answer만 믿고 evidence object를 확인하지 않음
- compact/category aggregate source를 canonical solo source처럼 사용
- 없는 스펙, 가격, 수치, 효능을 임의 생성

## 2. Required Sections

출력물은 반드시 아래 섹션을 포함한다.

1. `## 1. 제목 후보`
2. `## 2. 게시용 블로그 본문`
3. `## 3. 사진/썸네일 계획`
4. `## 4. 내부 SEO QC`
5. `## 5. Evidence Note`

본문에는 최소 아래 소제목을 포함한다.

- 구매 전 기준 문제 제기
- 제품명/키워드 확인
- 사용 장면 또는 사용 과정
- 장점
- 아쉬운 점/주의점
- 추천 대상
- 구매 전 체크리스트
- 마무리

## 3. Title QC

Pass 기준:

- 추천 제목 1개와 후보 7개
- 추천 제목에 제품명 또는 브랜드 포함
- 카테고리 핵심 키워드 포함
- `후기`, `추천`, `사용`, `비교`, `구매 전 체크` 중 2개 이상 포함
- 제목이 과장 보장형 문장으로 끝나지 않음

Fail 예:

- `무조건 만족하는 최고의 제품`
- `완벽 제거되는 청소기`
- `효과 보장 영양제`
- `절대 뒤집히지 않는 우산`

## 4. Body QC

Pass 기준:

- 첫 4문단 안에 제품명 1회 이상
- 첫 4문단 안에 핵심 키워드 묶음 1회
- 장점과 아쉬운 점이 모두 존재
- 추천 대상이 bullet 4개 이상
- 구매 전 체크리스트가 7개 이상
- 마무리에서 제목 키워드를 자연스럽게 반복

Fail 예:

- 장점만 있고 아쉬운 점이 없음
- 추천 대상만 있고 반대 조건이 없음
- 제품명만 반복하고 사용 장면이 없음
- evidence에 없는 가격/스펙/효능 추가

## 5. Image QC

Pass 기준:

- `D|img=<n>`과 동일한 컷 수를 계획
- 썸네일 방향이 제품 실물 + 사용 맥락 + 짧은 키워드로 구성
- 사진 흐름이 제품, 디테일, 사용 장면, 장점, 아쉬운 점, 체크리스트를 포함
- 이미지 목표가 경쟁글보다 낮아도 evidence 기준을 임의 변경하지 않음

Fail 예:

- evidence `D|img=35`인데 10컷만 계획
- 썸네일이 제품 없이 텍스트만 있음
- 사진 계획이 본문 구조와 연결되지 않음

## 6. Compliance QC

아래 패턴은 실제 주장형 문장에 나오면 fail이다.

### Health And Pet

- 치료됩니다
- 개선됩니다
- 효과 보장
- 완치
- 반드시 낫
- 즉시 효과
- 장건강을 해결

### Cleaning And Living

- 완벽 제거됩니다
- 완벽하게 제거됩니다
- 즉시 제거됩니다
- 반드시 제거됩니다
- 무조건 깨끗해집니다
- 새것처럼 됩니다

### Appliance And Beauty

- 완전 무소음입니다
- 무조건 조용합니다
- 저소음 보장
- 건조 시간 보장
- 풍량 수치 임의 단정

### Fashion

- 누구나 잘 맞습니다
- 핏 보장
- 사이즈 실패 없음
- 최저가 보장
- 가격 보장

### Sports And Outdoor

- 강풍에도 절대 안 뒤집힙니다
- 자외선 완벽 차단됩니다
- 자외선차단 보장
- 할인율 보장

Safe-context 예:

- `보장 문구는 넣지 않음`
- `단정 표현을 배제`
- `상세페이지 기준으로 확인`
- `환경에 따라 달라질 수 있음`

## 7. Internal SEO QC Table

초안 내부 QC 표는 아래 항목을 반드시 포함한다.

| 항목 | 기준 |
| --- | --- |
| 제목 키워드 | 제품명, 카테고리, 후기/추천/구매 전 체크 포함 |
| 오프닝 키워드 | 첫 구간에 문제 상황과 제품명 배치 |
| 소제목 | 사용후기, 장점, 아쉬운 점, 추천 대상, 구매 전 체크 반영 |
| 이미지 수 | evidence `D|img=<n>` 기준 |
| 썸네일 | 제품 실물 + 사용 맥락 + 짧은 키워드 |
| 문체 | evidence tone 기반 |
| 구매 유도 | 체크리스트와 추천 대상 섹션으로 처리 |
| 장단점 균형 | 장점과 아쉬운 점 분리 |
| 과장/효능 표현 | 카테고리별 금칙 단정 배제 |
| evidence 사용 | canonical v2 solo anchor 기준 |

## 8. Release Gate

발행용으로 넘기기 전 아래를 모두 통과해야 한다.

- required sections: pass
- exact anchor: pass
- image target: pass
- evidence note: pass
- forbidden claim scan: pass
- category style guide match: pass
- no invented facts: pass


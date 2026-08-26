# 튼튼한장우산 골프 장우산 v2.4.1 차이 분석

대상 기존 글:

`docs/naver-blog-drafts/2026-07-02-strong-golf-umbrella-sports-leisure.md`

신규 글:

`docs/naver-blog-drafts/2026-07-02-strong-golf-umbrella-sports-leisure-v2.4.1.md`

## 결론

기존 글은 SEO 구조와 본문 구성은 이미 괜찮았지만, OpenCrab 없이 작성된 초안에 가까워서 evidence 운영 기록이 약했다. v2.4.1 글은 글 자체의 문체를 크게 뒤집기보다, `RAW_CANONICAL_CHUNK`, exact pid guard, answer contract, section-density citation, release gate를 명시해 재현성과 QC 추적성을 강화했다.

## 주요 차이

| 항목 | 기존 글 | v2.4.1 글 |
| --- | --- | --- |
| source-lock | canonical anchor는 기록했지만 runner/answer drift 대응은 약함 | `RAW_CANONICAL_CHUNK` 기준으로 P/R1/R2/R3/D 확인 |
| OpenCrab 상태 | evidence object 우선이라는 설명 중심 | pack v1.0.104, workflow v2.4.0, workflow sync gate까지 기록 |
| guard | Evidence Note에 guard rule 없음 | `RULE_NO_SIMILAR_PID_SUBSTITUTION_V2_3_2`, `guard_status=pass` 포함 |
| answer contract | 자연어 답변 누락 가능성 설명만 있음 | evidence object가 자연어 요약보다 우선한다는 계약을 QC 항목화 |
| section-density | 없음 | 제목 공식, 이미지 룰, release gate, operating rule citation 포함 |
| 사진 계획 | 11컷 흐름 있음 | 11컷 흐름을 썸네일 금지 표현과 함께 더 명확히 정리 |
| compliance | 강풍/자외선 보장 회피는 있음 | 금지 표현을 QC table과 썸네일 rule에 중복 반영 |
| release readiness | 내부 QC 중심 | pack QA `A / 92`, `release_ready=true`와 연결 |
| 실패 처리 | 없음 | workflow runner HTTP 504를 명시하고 source-locked fallback으로 처리 |

## SEO 로직 관점 변화

기존 글은 사람이 읽기 좋은 구매 전 체크형 초안이다. 제목, 본문, 이미지, QC가 모두 들어 있어 블로그 글로 바로 다듬기 좋다.

v2.4.1 글은 운영용 초안에 가깝다. 상위노출 패턴을 사용하는 동시에, 왜 이 제목과 사진 수와 본문 구조가 나왔는지 근거를 추적할 수 있다. 특히 Naver BrandConnect 상품을 여러 개 반복 생산할 때는 v2.4.1 방식이 더 안전하다.

핵심 개선은 세 가지다.

1. exact pid mismatch 방지
2. 자연어 답변이 evidence를 생략해도 RAW_CANONICAL_CHUNK 우선
3. 제목/이미지/QC 규칙을 section-density citation으로 재조회 가능

## 남은 개선점

OpenCrab workflow runner가 긴 글 생성에서 HTTP 504를 냈기 때문에, 현재는 “workflow 로드 성공 + 장문 생성 실패 + source-locked local writer fallback” 상태다.

다음 고도화는 workflow를 한 번에 장문 생성하지 않고 아래처럼 쪼개는 방식이 좋다.

1. preflight only: exact anchor, P/R1/R2/R3/D, guard, section-density 확인
2. outline only: 제목 후보와 본문 골격만 생성
3. body only: 본문 생성
4. media/QC only: 사진 계획과 내부 QC 생성
5. final assembler: Evidence Note까지 합치기

이렇게 나누면 504 위험이 줄고, 각 단계별 누락 row를 더 쉽게 잡을 수 있다.

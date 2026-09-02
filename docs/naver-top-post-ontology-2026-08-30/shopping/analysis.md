# 네이버 쇼핑 상위노출 포스팅 관측 보고서

- 생성 시각: 2026-08-30T00:33:46+09:00
- 검색 기준: Naver blog-tab non-personalized server session, query rank 1-6 at collection time
- 검색어: 24개 (24개 성공)
- 유효 상위노출 포스트: 132건
- 품질 분석 표본: 132건
- 1위 품질 표본: 24건

> 이 결과는 현재 상위노출 글에서 함께 관찰된 패턴입니다. 특정 패턴이 순위를 만들었다는 인과 증거가 아닙니다.

## 분량과 이미지

| 지표 | P25 | 중앙값 | P75 |
| --- | ---: | ---: | ---: |
| 본문 글자수 | 1220.25 | 1842.5 | 2397.5 |
| 이미지 수 | 9.0 | 15.0 | 21.25 |
| 제목 길이 | 34.0 | 40.5 | 46.0 |
| 문장 길이 중앙값 | 18.0 | 23.0 | 35.62 |
| 문단 길이 중앙값 | 18.0 | 22.75 | 41.0 |

## 구성 패턴

| 패턴 | 건수 | 비율 |
| --- | ---: | ---: |
| spec_or_facts | 124 | 93.9% |
| strength | 122 | 92.4% |
| problem_or_motivation | 117 | 88.6% |
| use_scene | 116 | 87.9% |
| comparison | 96 | 72.7% |
| identity_or_summary | 90 | 68.2% |
| limitation | 83 | 62.9% |
| price_or_value | 76 | 57.6% |
| first_impression | 71 | 53.8% |
| conclusion | 67 | 50.8% |
| fit | 67 | 50.8% |
| checklist | 29 | 22.0% |
| affiliate_cta | 24 | 18.2% |
| affiliate_disclosure | 16 | 12.1% |

## 문체 패턴

| 패턴 | 건수 | 비율 |
| --- | ---: | ---: |
| hedged_judgement | 118 | 89.4% |
| comparison_tone | 110 | 83.3% |
| conversational | 108 | 81.8% |
| information_tone | 102 | 77.3% |
| first_person | 95 | 72.0% |
| sensory_scene | 86 | 65.2% |
| decisive_judgement | 73 | 55.3% |
| reader_address | 61 | 46.2% |
| experience_claim | 30 | 22.7% |

## 제목 패턴

| 패턴 | 건수 | 비율 |
| --- | ---: | ---: |
| review_word | 97 | 73.5% |
| recommendation_word | 76 | 57.6% |
| comparison_word | 17 | 12.9% |
| clickbait_word | 5 | 3.8% |
| number_word | 1 | 0.8% |

## 반복 관찰된 전개 순서

| 순서 | 건수 | 비율 |
| --- | ---: | ---: |
| problem_or_motivation > use_scene > strength > spec_or_facts > first_impression > price_or_value > comparison | 2 | 1.5% |
| use_scene > first_impression > identity_or_summary > spec_or_facts > strength > checklist > conclusion | 1 | 0.8% |
| price_or_value > comparison > limitation > problem_or_motivation > spec_or_facts > identity_or_summary > strength | 1 | 0.8% |
| limitation > problem_or_motivation > use_scene > identity_or_summary > spec_or_facts > strength > price_or_value | 1 | 0.8% |
| use_scene > strength > limitation > price_or_value > conclusion > spec_or_facts > problem_or_motivation | 1 | 0.8% |
| price_or_value > problem_or_motivation > use_scene > affiliate_cta > affiliate_disclosure > strength > fit | 1 | 0.8% |
| use_scene > limitation > strength > checklist > spec_or_facts > identity_or_summary > comparison | 1 | 0.8% |
| affiliate_disclosure > limitation > identity_or_summary > use_scene > spec_or_facts > price_or_value > first_impression | 1 | 0.8% |
| identity_or_summary > price_or_value > use_scene > problem_or_motivation > conclusion > strength > comparison | 1 | 0.8% |
| affiliate_disclosure > identity_or_summary > strength > use_scene > problem_or_motivation > spec_or_facts > conclusion | 1 | 0.8% |

## 해석 원칙

- 순위, 검색어, URL, 수집시각, Insane Search 판정을 `source-ledger.jsonl`에 보존합니다.
- 원문 전체를 저장하지 않습니다. 검색 스니펫과 짧은 소제목, 파생 지표만 남깁니다.
- 자동홍보형·반복형 글도 상위노출 관측에는 포함하되, 품질 기준 미달이면 권장 하네스 근거에서 제외합니다.
- 숫자는 글을 강제로 복제할 규칙이 아니라 AI가 독자 기대와 정보 밀도를 판단하는 참고 분포입니다.

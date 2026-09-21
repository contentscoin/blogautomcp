# 2026-09-21 이미지 근거 자동 복구 (1.3.72)

## 원인과 처리

일렉트로룩스 WQ61-1EDB의 저장 원고는 100점이었으나, 텍스트로 확인된 45분 사용시간에 기능 원본이미지를 필수로 요구했다. 저장20장에는 해당 표기가 없었다. 이 문단의 검증 기준을 일반 사진으로 대체하지 않고, 실제 검증 원본이 있는 다른 문단으로 이미지 필수 배치를 옮기는 복구를 추가했다.

- 준비 단계에서 이미지 실패를 분류한다. 명시된 근거 부족/원본 수집/누끼 실패만 자동 복구 대상으로 한다.
- 최대 재수집1회 → 원본 배정1회 → 대체 이미지 배치 재계획1회로 수렴한다. 재시도에서 유료/브라우저 이미지 생성을 반복하지 않는다.
- 재계획은 정상 출처·사진 적합성 검증을 통과한 원본이 있을 때만 적용한다. 원고와 출처 스냅샷, 이미지 의미, 전체 필수 이미지 수, 최소5장 정책은 보존한다. 생성 필수 정책에는 적용하지 않는다.
- 외부 인증/모델/통신 오류 및 알려지지 않은 실패는 중단한다. 부분 성공과 다른 실패가 섞인 응답도 전체 원인을 검사한다. 발행 경로에는 자동 복구를 넣지 않는다.
- image-recovery-history.json에 입력/출력 지문과 복구 이력을 기록하여 같은 입력으로 같은 조치를 반복하지 않는다. 인증 등 외부 문제는 해당 실행을 중단하되 이후 명시적인 재시도는 가능하다.
- image-source-diagnostics.json에 후보별 proposed/rejected/not-proposed/review-failed와 실제 섹션 연결을 원자적으로 기록한다. 검토 완료는 후보 적합성과 구분한다.
- 원고 동시변경, 패키지 잠금과 검증 결과가 바뀐 경우 이전 계획을 적용하지 않는다. 과거 실패는 별도 기록에 보존하고 현재 필수 누락만 활성 오류로 표시한다.

## 검증

- verify-material-image-recovery: HTTP422/200부분성공, 재수집성공, 재계획성공, 한도 소진, 인증·통신 중단, 혼합실패, 영속중복방지, 근거변경시 재검토.
- verify-image-coverage-replan: 직접 검증 대체/기존 optional 재사용, 근거 부족, 원고 동시변경, 생성필수 정책 보존, 일반 사진 거절, 과거 오류 보존, 부분성공+외부실패 중단.
- verify-product-section-image-review, verify-image-batch-progress(42개), verify-section-image-repair.
- verify-material-approval-semantics, verify-scheduled-draft-workflow.
- scripts 및 Next TypeScript 검사 통과.

## 실제 소재 검증

상품4fbafb36-2334-4bb6-ac74-657283e2b9fe의 공식 판매페이지를 재수집했다. 이후 새 replanShoppingImageCoverage를 실제 저장 패키지에 실행했다. 수정 전 manifest 백업을 생성했다.

- missing1 → 0, 본문 필수 수량4 → 4(대표 이미지 별도).
- shopping-section-d4443af7(45분 사용시간) 문단은 텍스트로 유지하고 필수 이미지 배치를 shopping-section-68ace68e(처음 쓸 때의 사용 흐름)로 이동했다.
- 배정 원본 SHA256: 2b3e511fff864f27acb13ae929d4b8e353e80806a3b76d17ea303f805b32852e.
- 정상 검토 결과: 핸디형으로 분리해 높은 위치를 청소하는 실제 장면이 사용 전환 흐름을 뒷받침한다.
- 원고100점, canPublish=true, 렌더 이미지6장, imageGeneration.remaining=0, active errors=[] 확인.
- 제목, 본문 전체, markdownSha256, sourceSnapshot이 복구 전과 동일함을 비교했다.
- 최종 이미지 진단: 후보21개×대체문단5개=105개 관계, proposed14/rejected91. 배정과 직접 근거 없는 추론을 구분했다.
- 새 유료 이미지 생성과 블로그 발행은 하지 않았다.

- 변경 파일 대상 ESLint: 오류0, 사용하지 않는 구조분해 변수 경고2.
- Next production build 성공. 패키지의 변경 런타임 파일6개와 작업 소스의 SHA256 일치 확인.

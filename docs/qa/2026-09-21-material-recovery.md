# 2026-09-21 소재 준비 복구

## 원인과 수정

- 샥즈: `무선 방식`/`기능: 무선`을 서로 다른 근거로 집계하여 빈약한 출처를 충분하다고 판단했다. 근거를 의미 단위로 중복 제거하고, 상품명에 명시된 오픈형/귀걸이형/공기전도만 사실로 추출한다. 기능 두 개를 한 문장에 넣는 것과 판단 두 개를 구분하도록 보강 지시를 수정했다.
- 원산지는 비식품 기능 근거에서 제외하되 꽃게 등 수산물에서는 산지 판단 근거로 유지한다.
- 캐치웰·꽃게: 검증된 실제 사용 장면 원본을 직접 배치할 수 있는 정책에서도 누끼 합성만 요구했다. 혼합 이미지 정책에서 검증된 장면 원본을 허용하고, 기능 파트는 직접 일치하는 근거와 서로 다른 원본 SHA를 계속 요구한다.
- 이미지 배정은 탐욕 배정 대신 최대 매칭으로 검토된 원본을 배정한다. 기존 생성 이미지의 정상 바인딩은 보존한다.
- 건조기: 종료된 이미지 작업을 복구하고, 판매페이지의 지연 로딩 사양표에서 정확한 모델과 21kg 용량을 확인했다. 확인된 CloudFront 호스트 하나만 다운로드 허용 목록에 추가했다. 다른 tenant, 접미사 위장, HTTP, 자격증명, 비표준 포트는 거부한다.
- 갤러리 20개 뒤에 있는 지연 로딩 상세 원본도 출처 스냅샷에 보존한다. 갤러리 순서는 유지하고 사양표는 선호 썸네일에서 제외한다.

## 실제 저장 소재 복구

변경 전 manifest 백업과 패키지 잠금을 사용했다. 판매자 원본은 다운로드 영수증과 SHA를 확인하고 이미지별 직접 검토 이유를 기록했다. 쿠폰/할인/리뷰 안내판은 기능 근거에서 제외했다.

| 상품 | ID | 현재 코드로 저장 원고 재평가 | 이미지 누락 |
|---|---|---|---|
| 샥즈 오픈핏 2 | 893dcd81-c3ca-4a0c-ac45-9ae96296c28e | 100, canApprove=true | 0 |
| 캐치웰 CX PRO | 098ea3f0-6f39-4c44-942c-1264b8c5e4eb | 100, canApprove=true | 0 |
| 삼성 DV21DG8600BW | 7bbf917f-77c5-418c-9145-a241fcf8f2e3 | 100, canApprove=true | 0 |
| 꽃게 1kg | fcaa5368-7e09-4480-973c-5798c9ea473c | 100, canApprove=true | 0 |

건조기 추가 원본: `https://d15zs6bxpcjiwz.cloudfront.net/Home/Dryers/DV21DG8600BW_spec.jpg`

SHA256: `b96455a2a22b64d325bc438c05ece0e5e349fa5551f70f3209d141a27edd3e37`

## 검증

- product-substance, product-source-evidence, brand-post-quality, quality-repair
- quality-convergence-regressions, content-readiness-failures, saved-text-revalidation
- image-batch-progress, product-section-image-review, section-image-repair, shopping-image-sources
- seller-detail-source-retention: 갤러리 20개 뒤 1×1 지연 로딩 사양표 유실 재현 및 썸네일 순서 보존
- Next production build와 TypeScript 검사
- 실제 네 저장 패키지의 원고 재평가 및 전체 이미지 readiness 검사

원격 Sites 배포나 Windows 업데이트 피드 게시, 블로그 발행, 신규 유료 이미지 생성은 수행하지 않았다.

## 데스크톱 산출물

- 최종 `npm run desktop:pack:win` 종료 코드 0.
- `out/BrandConnect-Automation-Setup-1.3.70.exe`
- SHA256 `CD86FDC5DA008B240D3A3EF317861FAF479436D36BB825ED7927629714E489C2`
- 패키지 안의 변경 런타임 파일 11개와 작업 소스 해시가 모두 일치한다.
- 설치 직전 기존 앱은 1.3.69, 활성 작업 0개, 업데이트 가능 상태였다.
- 자동 승인 검토가 설치 파일 실행을 `blocked by policy`로 거부했다. 설치는 실행되지 않았고 명시적 사용자 승인 대기 중이다.
- 따라서 설치된 1.3.70 앱의 재검사 및 새 소재 준비 작업 4/4 완료는 아직 확인하지 않았다. 앞의 통과 수치는 수정된 작업 소스로 실제 저장 패키지를 검사한 결과이다.

## 후속 배포 및 실제 앱 검증 완료

사용자의 배포 지시 후 다음을 확인했다. 위 설치 차단 기록은 앞선 시점의 이력이다.

- 소스 커밋: `14f6c4c4b00a9a0d9a344fc47c2f3264b7b53ebe`, 릴리스 `v1.3.70`.
- 중앙 배포 작업 `35580155468` 성공: https://github.com/contentscoin/blogautomcp/actions/runs/35580155468
- 활성 PC 인증으로 운영 업데이트 피드와 EXE/블록맵을 다시 다운로드했다. 모두 HTTP 200이며 로컬 산출물과 SHA256이 일치한다.
- 실행 앱 `/api/system/update-readiness`: currentVersion=1.3.70, status=current, activeCount=0.
- 앱의 재검사 API로 네 소재 모두 100점, canApprove=true, blockers=[], missing=[] 확인.
- 소재 준비 작업 `457fbc1d-45b9-433b-bbaf-37baf41f15cc`: completed, 네 항목 모두 ready, workflowPending=false. 완료 시각 2026-09-21 17:54:46 KST.
- 네 소재 모두 materialStatus=READY, ready=true, 원고 100점, 이미지 5장. 신규 생성이나 블로그 발행은 없었다. 이전 중단 작업 이력은 보존했다.
- 저장소 전체 CI는 기존 CJS 테스트 파일의 lint 오류로 실패했다. 직전 커밋 CI `35553980284`와 이번 CI `35580016558`의 오류 34개를 비교한 결과 차이 0개였다. 수정 범위의 회귀검사·TypeScript·로컬 프로덕션 빌드 및 배포 검증은 통과했다.

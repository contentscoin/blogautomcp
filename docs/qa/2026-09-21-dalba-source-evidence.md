# 2026-09-21 달바 상품정보 수집 복구 (1.3.71)

- 대상: 달바 비건 워터풀 퍼플 톤업 선크림 50mlX2개, 상품 cdfdca53-cc31-455d-920a-a57e2895fa3e.
- 실제 공식 판매페이지: https://brand.naver.com/dalba/products/9770696257
- 원인: 상품정보 행에서 사용부위, 종류, 자외선차단지수, 주요제품특징, 사용기간의 정규화 별칭이 빠져 수집한 텍스트가 버려졌다. 기존 2개 행(원산지, 피부타입)만으로는 기능 근거가 부족했다.
- 수정: 판매자가 명시한 화장품 행 5개를 보존한다. 상품명만으로 통과시키거나 근거/문장 품질 기준을 낮추지 않았다.
- OCR 보조 경로: 보존된 상세 이미지 8개까지 검사하되 기존 전체 35초/개별 8초 제한을 유지한다. 검사 성공 이미지 수와 근거 발견 이미지 수를 구분하고 전부 실행 실패하면 unavailable로 보고한다.

## 검증

- verify-product-source-evidence: 실제 달바 7개 행 보존, 기존 2개 근거 및 상품명만 있는 입력은 여전히 sparse, 안내/쿠폰값 거부.
- verify-product-ocr-coverage: 8번째 이미지에만 있는 근거, 무근거 성공, 전부 실행 실패, 공유 시간제한 검증.
- verify-product-substance-context 통과.
- npm run desktop:pack:win 통과(Next production build, TypeScript 포함).
- 패키지의 변경 런타임 3개 파일과 작업 소스 SHA 일치.
- publish-update --verify-only 통과. 설치 파일 SHA256 bb6d07646fd3715520bbc604ee12f9f5eb6b8a41b8d309ffe6f739bbc10d71a7.

## 실제 저장 소재

수정 코드로 공식 상품을 재수집하여 7개 사실과 불변 출처 스냅샷을 확보했다. 동일 스냅샷으로 작성한 원고는 100점, 원고 검사17/17을 통과했다. 판매자 원본 사진을 직접 검토하고 출처 영수증/SHA를 검증한 뒤 장면·구성·SPF·수분 파트에 서로 다른 4개 원본을 배정했다. 저장 manifest 백업과 잠금을 사용했다.

최종 수정 코드로 저장 원고를 다시 평가한 결과: score=100, canApprove=true, blockers=[], missing=[]. 이미지5장. 유료 이미지 생성이나 블로그 발행은 하지 않았다.

실행 중인 이전 1.3.70 앱의 소재 준비 작업14ebd803-269a-49f4-a24c-2a02e6a502a7은 이전 정규화 로직으로 96점을 산정하여 실패했다. 따라서 업데이트 적용 전 실제 앱 소재준비 완료로 주장하지 않는다.

## 배포 검증

- 소스 커밋 1d7a22513480321b37e31eadd939e2f8cbac1b6b, 릴리스 https://github.com/contentscoin/blogautomcp/releases/tag/v1.3.71.
- Windows 업데이트 게시 작업35582042734 성공: https://github.com/contentscoin/blogautomcp/actions/runs/35582042734.
- 활성 PC 인증으로 운영 최신 manifest/설치파일/블록맵을 다운로드하여 HTTP200과 로컬 SHA 일치 검증.
- 설치파일333922583 bytes, SHA256 bb6d07646fd3715520bbc604ee12f9f5eb6b8a41b8d309ffe6f739bbc10d71a7.
- 블록맵340211 bytes, SHA256 037715e8d429c882ff2f6339765e77af48b1a78dcf93dbf9e18c7200b71a47c6.
- 전체 CI35581975983은 기존 CJS lint 오류34개로 실패. 이전1.3.70 CI35580016558의 오류시그니처와 비교하여 차이0개 확인.
- 별도 Desktop Build35582025012는 npm의 @types/react19.2.10 대 @types/react-dom19.3.0 의존성 해결 실패. 이번에 실제 배포한 Windows 산출물은 앞서 로컬 잠금파일/설치환경에서 빌드와 검증을 통과한 파일이다. 원격 전체CI 통과로 주장하지 않는다.

## 설치된 앱 최종 검증 완료

- 앱의 기본 자동 업데이트가 설치와 재시작을 완료했다. API currentVersion=1.3.71, activeCount=0 확인.
- 새 실행 앱의 원고 재검사 API: score=100, canApprove=true, blockers=[], missing=[].
- 실제 소재 준비 작업 f682fbf0-a509-4cac-bb43-6f91839f41f9: completed, ready1/1, workflowPending=false.
- 완료시각2026-09-21 18:20:25 KST, materialStatus=READY, ready=true, approvedAt 기록됨, score100, imageCount5, blockers0.
- 위 이전1.3.70의 실패는 보존된 과거 작업 이력이다. 새 버전에서 새 소재 준비 작업을 실제 완료하여 검증했다.

# 소재 미리작성·선택 발행 구현 기록

기준: `2026-09-07-final-remediation-report.md`, 사용자가 제공한 `artifacts/ui-workflow-audit-2026-09-07` 및 추가 요청. 소스 버전은 **1.3.37**. 기존 사용자 원고·이미지·운영 DB를 일괄 변경하거나 삭제하지 않았다.

## 사용자 흐름

1. 쇼핑/여행 상품을 동기화한다.
2. **소재 보관함 → 소재 미리작성**에서 상품을 선택한다. 미준비 상품 10개 선택이 가능하다.
3. 원고·이미지 준비와 품질검사를 실행한다. 저장 근거를 사용한 원고 보강은 준비 단계에서 최대 1회 수행한다. 준비 결과와 실패 사유를 항목별로 저장한다.
4. 보관함에서 원고·이미지를 확인하고, **준비완료 소재**를 선택한다. 준비완료 10개 선택이 가능하다.
5. 바로 발행 또는 예약 발행을 실행한다. 예약일은 앱 내부 날짜 입력창에서 한국시간 기준으로 지정한다.

발행 단계는 원고 작성·이미지 생성·보강·승인을 호출하지 않는다. 선택 버전이 달라지면 재선택을 요구한다. 준비 실패를 발행 중 재작성으로 덮지 않는다. 과거의 자동발행·수퍼 퍼블리싱 경로에서도 임의 상품 선택과 생성 결합 실행을 제거했다.

## 문제별 변경

| 문제 | 구현 |
|---|---|
| 점수·보강요소·승인 불일치 | `evaluateBrandPostPackageReadiness`를 소재 선택·미리보기·승인의 공통 판정으로 사용. 현재 내용/구성/이미지, 실제 파일·해시를 확인한다. 오래된 specValidation READY가 현재 실패를 덮지 못한다. |
| 기존 MCP freeform 초안 보강 실패 | postSpec 없는 v2 초안의 근거 기반 문단 수정 지원. 저장 sourceSnapshot으로 평가 입력을 고정하고 섹션 ID·이미지 관계를 보존한다. |
| 예약 버튼 무반응 | Electron에서 지원되지 않는 `prompt()`를 제거하고 날짜 입력 모달 사용. 선택한 READY 소재에 기존 예약일이 없어도 지정 시작일로 일정을 만든다. |
| 즉시/예약 발행 결과 오류 | 클릭 예외 전파, 공유 Naver URL 파서, 예약 업무 응답·예약 식별자 검사. 제출 후 불확실성은 `OUTCOME_UNKNOWN`. 확인된 성공은 cleanup 오류로 FAILED 처리하지 않는다. |
| 발행 직전 소재 변경 경쟁 | 승인·이미지 변경에 DB CAS 적용. 발행 시도별 고정 원고·이미지 사본을 만들고 원본과 사본 해시를 제출 전에 재검사한다. |
| MCP 요청/대형 결과 실패 | 결과 크기 계약 통일, 큰 결과 chunk+SHA256 보존·분할 읽기. 영구 401/409/413 outbox 격리, 새 독립 작업의 대기열 정체 방지. canonical idempotency와 sourceJobId 복구 연결. |
| 이미지 중복·잘못된 연결·지연 | stable section/slot ID, 순번 자동 연결 제거, 검증된 원본 우선, 실제 provenance. 상품 원본 사전검사, 거절 조기 탐지, 부분 journal 및 기존 생성 결과 회수. |
| 10건 실행 중 반복 질문/중단 | 하나의 영속 배치에 항목별 준비·발행 상태를 저장한다. 독립된 거절 1건은 나머지 9건을 막지 않으며, 공통 인증 장애는 반복 호출을 중지한다. 불확실한 발행 이후 항목은 중지한다. |
| 화면 이동 후 상태 유실 | 파일 작업 이력과 전역 진행 배너. 새로고침·페이지 이동 후 동일 작업을 조회한다. 앱 이력은 준비/예약/실패/불확실성을 구분하고 Sites는 MCP 하위 요청과 소재 작업을 구분한다. |

## 주요 계약

- `GET /api/materials`: 소재 목록과 최근 작업. `jobId` 또는 `sourceJobId`로 원 작업을 조회한다.
- `POST /api/materials/prepare`: `{ productIds: [...] }`. 즉시 jobId 반환, 별도 준비 실행.
- `POST /api/materials/publish`: `{ materials: [{ productId, revision }], publishMode, scheduledAt?, intervalDays? }`. 명시 선택 필수. 예약 날짜는 `YYYY-MM-DD`, 한국시간 기준 내일 이후, 기본 간격 1일.
- MCP: `materials_list`, `materials_prepare`, `materials_publish`. 원격 요청 완료와 소재 작업 완료를 구분하며 같은 jobId로 결과를 조회한다. 신규 도구 최소 앱 버전 1.3.26.
- `sourceJobId`가 같은 동일 요청은 기존 작업 반환. 원고 버전/날짜/순서/방법이 달라지면 충돌. 다음 날 재조회에도 기존 예약 접수 결과를 반환한다.
- `data/material-jobs`: 항목별 상태, 오류, 단계 시각, 최종 결과. `data/publish-attempts`: 제출·확인 시각과 결과 증거, 시도별 고정 소재 사본.

## 검증 증거

운영 계정 대신 오프라인 fixture와 격리된 UI 서버를 사용했다. 실제 게시·예약 등록·유료 이미지 생성은 실행하지 않았다.

| 검사 | 결과 |
|---|---|
| `npm run test:materials` | PASS. 선택 10건, 발행 중 생성 0회, 준비와 발행 분리, 변경 버전 차단, 정상9+거절1, 인증 오류 중지, 결과 유실 중지, 파일 변경 감지, 작업 복원/잠금, 제한시간 |
| `node scripts/verify-material-api.cjs` | 9/9 PASS. 실제 API 함수로 선택·인증·날짜·상태·idempotency·sourceJobId 검증 |
| `node scripts/verify-material-image-integrity.cjs` | PASS. 의미 연결, 원본, 동일 QC 판정, 오래된 점수, 파일 변경/삭제, 이미지 변경 CAS/복구 |
| `npm run test:publish-safety` | PASS. URL, 예약 업무 응답, 클릭 예외, 고정 사본, 영속 제출 상태 |
| `node scripts/verify-publish-route.cjs` | PASS. 저장승인·revision·품질 게이트, unknown 재실행 차단, 생성 플래그 제거, receipt 복구, 승인 CAS |
| `npm run test:mcp-delivery` | 29/29 PASS. 대형 한글·emoji 결과 원문 복원, 소유권, 영구 전송 실패, 재실행 방지, 두 단계 소재 핸들러 |
| `npm run test:draft-ui` | 8/8 PASS. QC 표시와 읽기 전용 저장 소재 확인 |
| 실제 브라우저 UI fixture | 준비완료 10개 선택, 미완성 소재 선택 불가, 날짜 모달에서 2026-09-10 지정, 정확한 10개 revision 전송, 생성 endpoint 0회, 새로고침·이력 페이지에서 동일 10건 진행 확인 |

UI fixture: `scripts/qa-material-ui-server.cjs`. 모든 API는 시험용 응답이며 실제 API로 전달하지 않는다. 실제 Next 빌드의 화면을 사용했다. 요청 증거는 `output/playwright/materials-2026-09-07/schedule-requests.json` 및 `prepare-requests.json`, 화면 증거는 같은 폴더에 저장했다. 초기 fixture의 미구현 update-readiness 응답 404는 fixture 보완으로 제거했으며 운영 오류로 분류하지 않는다.

상세 담당 기록:

- `2026-09-07-mcp-implementation.md`
- `2026-09-07-publish-implementation.md`
- `2026-09-07-image-qc-remediation.md`

## 적용 범위와 남은 운영 확인

- 소스 검증 후 Sites 운영 서비스에 버전 33을 공개 배포했다. MCP 전달 수정과 result-chunk 저장소가 반영된 운영 URL은 `https://blogautomcp.hiway350051.chatgpt.site`이다.
- Windows 데스크톱 1.3.36 설치 파일과 blockmap을 생성하고 업데이트 피드에 업로드·활성화했다. 배포 시 SHA-512, 파일 크기, 버전 증가, 중앙 재조회 검증이 모두 통과했다.
- 설치 오류 보강 정정: 1.3.36의 cwd 변경이 로그인과 Codex 검색을 깨뜨렸다. 1.3.37에서 실행 리소스를 실제 unpacked 폴더로 통일하고 빈 DB 초기화와 로그인 런타임을 검증했다. asar 자체는 전체 설치의 원자성을 보장하지 않는다. 상세 내용은 `2026-09-07-desktop-runtime-path-fix.md` 참조.
- 실제 Naver 즉시/예약 성공률과 이미지 생성 시간 개선 수치는 아직 측정하지 않았다. 알 수 없는 예약 업무 응답을 HTTP 200만으로 성공 처리하지 않으며, 이 경우 결과 확인이 필요하다.
- 실행 주체가 확인되지 않는 오래된 이미지 running 기록은 자동 재생성하지 않는다. 기존 결과 확인이 필요한 상태를 명시한다. 확인된 종료 owner는 보존된 checkpoint를 이용해 복구한다.
- 공개된 게시물·이미지 생성 정책 거절·상품 원본 자료 부족을 임의로 승인하는 변경은 없다. 품질검사 미통과 항목은 소재 보관함에 사유를 남긴다.
- 시도별 사본과 영속 작업 이력의 자동 삭제는 도입하지 않았다. 자료 보존을 우선하며 장기 보관 정책은 별도 운영 결정이 필요하다.
- 단계·제출·확인 시각을 기록한다. 실제 공급자별 평균 시간·호출 비용과 성공률 목표는 운영 표본으로 검증해야 한다.

## 최종 빌드 체크포인트

2026-09-07 최종 소스 기준:

- `npm run build`: **PASS**. 1.3.36 패키지에 포함되는 Next 컴파일·TypeScript·29개 페이지 생성 경로를 확인했다. 신규 materials API 3개가 빌드 경로에 포함됨.
- `npm run site:build`: **PASS**. Sites 클라이언트/서버 빌드 및 신규 result-chunk 경로 포함. 배포 아님.
- 전체 TypeScript, Sites TypeScript, Electron/fixture 서버 구문검사: **PASS**.
- `verify-brand-post-package.ts` 전체 회귀: **PASS**. 새 원본 정책·명시적 생성 요구·안정된 섹션 연결을 검증하는 fixture로 갱신했으며 검사를 비활성화하지 않았다. 수정 중 필수 fixture 필드 부족으로 한 차례 빌드가 실패했으나 보완 후 최종 재빌드가 통과했다.
- 이미지 배치 **24개 PASS**, QC 표시 **6개 PASS**(담당 검사), API **9개 PASS**, MCP 전달 **29개 PASS**, UI 승인 **8개 PASS**. 그 외 스크립트별 PASS는 위 표와 담당 기록 참조.
- 최신 빌드의 브라우저 시험: 미준비 상품 선택 → prepare 1회, publish 호출 0회. 새로고침 후 전역 진행 배너 복원. 브라우저 console **오류 0, 경고 0**.
- 예약 브라우저 시험: 10개 정확한 소재 revision, 지정 날짜 전송, 생성 endpoint 0회. 미완성 소재 선택 불가, 새로고침·히스토리에서도 동일 10건 기록 확인.
- `git diff --check`: **PASS**. CRLF 변환 안내 외 공백 오류 없음.
- 시험용 브라우저와 43138/43139 서버를 종료했다. 운영 사이트와 Windows 업데이트 피드만 배포했으며, Naver 계정·게시물 데이터는 변경하지 않았다.

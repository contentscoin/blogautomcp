# 이미지·검수 구현 및 오프라인 검증

2026-09-07. 기존 분석 보고서의 당시 관찰과 구분되는 구현 기록이다. 외부 이미지 생성, 브라우저 조작, 실제 발행은 실행하지 않았다. 기존 운영 패키지도 일괄 수정하지 않았다.

## 구현

- `src/lib/post-composition-contract.ts`: 자유형 섹션 ID는 제목의 안정적인 키를 사용한다. 검토된 `sectionImageBindings` 또는 명시적 계획에 연결된 사진만 배치한다. 의미를 모르는 잔여 사진을 순번으로 배정하지 않는다. 이미 저장된 계획의 `sectionId`를 유지할 수 있다.
- `src/lib/brand-post-image-generation.ts`: 원시 결과 식별자에 `sectionId + slotId`를 포함한다. 같은 섹션 두 장이 서로 다른 결과 경로를 가지며, 두 번째 장이 먼저 완료되어도 첫 번째 빈 슬롯의 재시도 식별자는 유지된다. 명시적으로 중복된 슬롯 요청은 거부한다. 이전 v1 결과·체크포인트·잠금이 있으면 `IMAGE_RESUME_REQUIRED`로 멈춰 v2 전환이 중복 생성을 유발하지 않게 한다.
- 쇼핑 이미지 생성 전 원본 상품 사진을 검증한다. 원본이 없으면 `PRODUCT_SOURCE_REQUIRED`로 종료하며 생성 프로세스를 시작하지 않는다. 생성 배경과 원본을 합성한 결과, 원본, 로컬 편집 카드의 출처를 구분한다.
- `src/lib/brand-post-package.ts`: `evaluateBrandPostPackageReadiness`를 미리보기·승인·소재 선택의 단일 판정으로 제공한다. 실제 이미지 파일의 존재·크기·SHA-256, 섹션 연결, 본문 파일 존재, 저장된 본문 해시, 본문과 렌더 문서 일치를 확인한다. 원본 사진은 기본 이미지 수요를 충족하며, AI 생성 필수는 `imageRequirements.policy=generated-required`일 때만 적용한다. 로컬 카드·원본 잠금이라는 이름만으로 AI 생성으로 집계하지 않는다.
- 품질 점수는 `approval.contentScore`, 원고 통과는 `approval.contentPassed`, 최종 승인은 `approval.canApprove`로 제공한다. 높은 점수나 예전 `canPublish`만으로 실패한 필수 항목을 숨기지 않는다. `packagePreview.readiness`와 UI 승인 사유도 같은 결과를 사용한다.
- `scripts/chatgpt-generate-image-batch.ts`: 손상된 마지막 JSONL 행은 보존하고, 완료된 앞선 기록은 복구한다. 중간 기록 손상은 거부한다. 안전한 기존 대화 경로가 있으면 프롬프트를 보내지 않고 결과 다운로드만 재개한다. 경로가 없거나 구버전 식별자가 모호하면 자동 재생성하지 않는다.
- `scripts/lib/chatgpt-browser.ts`: 명시적 정책 거절을 조기에 식별한다. 이미지 프롬프트는 문자별 지연 입력 대신 일괄 입력하며 줄바꿈을 유지한다. 내비게이션·첨부·입력·전송·완료·실패 시점과 경과시간을 남긴다. 세부 입력 단계는 추가 DOM 검사 없이 시간만 기록한다.
- `src/lib/brand-post-image-repair.ts`: 실행 PID·소유 토큰·15초 하트비트를 저장한다. 종료가 입증된 소유자는 조회 시 미완료로 파생하며 파일을 쓰지 않는다. PID 권한 오류를 종료로 오인하지 않는다. 소유자가 없는 레거시 실행은 `owner-unknown`으로 남긴다.
- 이미지 POST API는 READY/FAILED 상태만 DB 비교 후 DRAFTING으로 획득하고, 완료·실패·조기 반환 모두 원래 상태로 복구한다. 종료가 입증된 이미지 소유자의 오래된 DRAFTING만 명시적 복구 요청에서 회수하고 더 새로운 작업은 보존한다. 일부 이미지가 성공했더라도 인증·잠금·복구·거절 오류 코드를 유지한다.

## 검증

모든 검사는 로컬 fixture, 실제 함수 또는 실제 HTTP 핸들러의 VM 로드, 가짜 프로세스/브라우저 인터페이스를 사용했다. DB·네트워크·유료 생성 호출은 없다.

- `node docs/qa/2026-09-07-image-audit-repro.cjs`: 서로 다른 두 슬롯, 부분 재시도, 명시 중복 거부, v1 모호한 기록의 신규 생성 방지 PASS. 이 파일의 PASS 의미는 과거 결함 재현에서 **수정 후 회귀 통과**로 바뀌었다.
- `node scripts/verify-material-image-integrity.cjs`: 의미 연결·재정렬, 기본 원본 정책, 명시적 생성 정책, 출처 집계, 단일 QC, 변조·삭제 파일, 종료/활성/불명 소유자, API 동시 실행/CAS/반환 상태/부분 성공 인증 코드 PASS.
- `verify-image-batch-progress.ts`: 24개 검사 PASS. 원본 누락 시 생성 0회, 부분 성공 저장, 늦은 결과, 12슬롯 순회, 인증 중단, 중복 전송 방지 포함.
- `verify-image-resume-speed.ts`: 마지막 행 손상 회복, 성공 결과 보존, 기존 대화 다운로드 재개 시 전송 0회, 중간 손상 거부, PID 잠금 검사 PASS.
- `verify-image-timeout-policy.ts`: 기존 제한시간·인증·대기 계약, 명시적 거절 즉시 종료, 줄바꿈 보존 및 모호한 전송의 두 번째 전송 방지 PASS.
- `verify-section-image-repair.ts`, `verify-post-composition-contract.ts`, `verify-brand-post-package.ts` 전체 PASS. 기존 생성 필수 회귀는 명시적 정책 fixture로 유지했다. 패키지 suite의 11개 결과 항목 모두 통과했다.
- `brand-post-quality-display.test.ts`: 6개 검사 PASS.
- 앱 및 scripts TypeScript `--noEmit` 검사 PASS. 최종 앱 빌드는 부모 작업에서 수행한다.

## 남는 실증 범위

- 실제 ChatGPT 계정의 최신 입력창·거절 표현·대화 URL 전환·다운로드는 오프라인 검사만으로 보증하지 않는다. 정확한 실서비스 지연 개선량도 아직 측정하지 않았다.
- 기존에 잘못 연결해 저장한 욕실/관광지 사진을 내용만 보고 자동 교정하지 않는다. 새 임의 배정을 차단하고 명시적 의미 연결을 요구한다. 픽셀 수준의 의미 검증은 별도 검토가 필요하다.
- 소유자 정보 없는 레거시 실행과 v1의 충돌한 기록은 자동 생성보다 기존 결과 확인을 요구한다. 무조건 대기하거나 중복 생성하는 방식으로 성공 처리하지 않는다.
- 기존 패키지에 본문 해시가 없으면 파일 존재 및 렌더 일관성만 검사한다. 신규 작성과 명시적 본문 수정은 실제 본문 해시를 저장하며, 선택 후 파일 변경은 소재 revision 검증도 차단한다.

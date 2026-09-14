# 발행 안정성 구현 기록 — 2026-09-07

## 구현된 경계

- `src/app/api/brandlinks/[id]/publish/route.ts`: 승인된 저장 소재만 발행한다. READY/FAILED 상태, 승인, 공통 품질·이미지 gate, 선택 revision을 확인하고 DB CAS로 PUBLISHING을 선점한다. 이전 제출 시도가 불확실하면 재발행하지 않는다. 직접 호출에서 materialRevision을 생략해도 승인·품질 검사는 동일하게 적용한다.
- `src/lib/publish-attempt.ts`: 제출 시도와 결과를 앱 데이터의 `publish-attempts`에 원자적으로 저장한다. PREPARING→SUBMITTING→CONFIRMED 또는 OUTCOME_UNKNOWN으로 전환한다. 확인된 결과는 timeout/cleanup/비정상 종료가 덮어쓰지 못한다. 실패가 제출 전임이 확인된 경우만 새 시도를 허용한다.
- 각 시도는 UUID별 snapshot 디렉터리에 원고와 모든 사용 이미지를 복사하고 composition/renderNodes/imageAssets 경로를 복사본으로 바꾼다. 복사 전후 원본 hash와 복사한 bytes를 확인한다. API는 복사 후 원본 selectedRevision을 다시 검사한다. 자식은 복사본만 읽고 시작·최종 제출 시 snapshotHash, 최종 제출 시 원본 hash도 확인한다. 다른 준비 작업이 원본을 바꾸면 게시 버튼 제출을 중단한다.
- `scripts/simple-agent.ts`: 발행 모드에서는 원고/이미지 생성·편집·라이브 상품 사실 재수집을 호출하지 않는다. 저장된 sourceSnapshot, composition과 이미지 배열을 소비한다. 마지막 버튼의 click 실패를 삼키거나 다른 선택자로 재제출하지 않는다. 제출 직전 receipt를 저장하고 실제 확인 후 CONFIRMED를 DB 업데이트보다 먼저 기록한다.
- `src/lib/naver-published-url.ts`: 공식 Naver 블로그 호스트와 계정을 확인하고 숫자 경로 및 PostView URL을 공통 canonical URL로 파싱한다. 편집 페이지, 외부 호스트, 다른 계정 URL은 성공 근거가 될 수 없다.
- `src/lib/naver-schedule-submission.ts`: 2xx와 요청 날짜만으로 예약 성공을 선언하지 않는다. 실제 응답의 명시적 성공과 예약/게시 식별자가 있어야 확인한다. 응답 계약이 인식되지 않으면 OUTCOME_UNKNOWN으로 남긴다.
- 발행 프로세스 종료 handler는 durable CONFIRMED receipt를 읽어 DB에 최종 결과를 복구할 수 있다. 중단 API와 Electron 재시작은 PUBLISHING을 READY/FAILED로 일괄 되돌리지 않고 OUTCOME_UNKNOWN으로 보존한다. 중단 API는 프로세스 종료가 확인된 경우에만 DRAFTING을 FAILED로 복구한다.
- verify API는 공통 URL parser와 예약 receipt 근거를 반환한다. 기존 SCHEDULED라는 상태 문자열만으로 외부 예약을 검증했다고 표현하지 않는다.

## 소재 준비와의 접점

`runAutomaticDraftWorkflow`의 발행 단계는 GET draft→POST publish(materialRevision)만 실행한다. GET draft와 publish의 manifest 읽기는 `migrate:false`이며 packagePreview는 읽기 전용이다. 읽기 과정에서 제목, 승인 시각, 생성 시각 또는 이미지 메타데이터를 저장하지 않는다. 따라서 목록 선택 revision이 단순 조회로 변경되지 않는다.

목록 materialRevision은 진행률 imageGeneration을 제외한 manifest 내용과 파일 bytes를 포함한다. 발행 시도 hash는 원본 manifest bytes까지 검사하므로 이보다 엄격하다. 발행 도중 진행 메타데이터까지 변경되는 예외적인 경우도 안전하게 제출을 중단한다. 복사본은 게시에 사용한 정확한 자산을 보존하지만 자동 삭제 정책은 이번 변경에 추가하지 않았다.

승인 PATCH는 상태 조회 이후 READY/FAILED→DRAFTING CAS를 확보한 뒤에만 approvedAt을 저장한다. 충돌하거나 이미 발행/확인 중이면 승인함수를 호출하지 않는다. 수정 전 조회도 migration하지 않는다. postSpec이 없는 freeform 수정은 저장된 sourceSnapshot 사실만 사용하여 지정한 기존 섹션 본문을 수정하며 섹션 ID/제목/순서/이미지 매핑을 유지한다. sourceSnapshot이 없거나 불일치하면 보강을 실행하지 않고 구체적인 차단 사유를 반환한다.

새 원고 및 명시적 본문 수정 시 markdownSha256을 실제 파일 bytes로 기록한다. 이미지·승인 metadata 저장에서 이 원고 hash를 새로 만들지 않는다. 이미지 provenance는 실제 생성 방식과 원격 생성 여부를 보존하고 여행 로컬 합성을 원격 생성으로 표시하지 않는다.

## 관측값

시도 ID, mode, source/snapshot hash, startedAt, submittedAt, confirmedAt, updatedAt, 실제 postUrl 또는 reservationId/예약일을 저장한다. startedAt→submittedAt은 발행 준비 시간, submittedAt→confirmedAt은 외부 제출 확인 시간으로 구분할 수 있다. 소재 생성·이미지 단계 시간은 부모 material-job 기록과 함께 해석한다. 기존 startedAt/updatedAt 두 값만으로는 중간 단계 시간을 복원할 수 없어 submittedAt/confirmedAt을 추가했다.

## 오프라인 검증

아래 검증은 모두 PASS. 프로덕션 DB, 브라우저, 서버, 유료 생성, 실제 게시를 실행하지 않았다.

```powershell
node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-publish-safety.ts
node scripts/verify-publish-route.cjs
node node_modules/ts-node/dist/bin.js --project tsconfig.scripts.json scripts/verify-naver-schedule-submission.ts
node --check scripts/electron/main.cjs
node node_modules/typescript/bin/tsc --project tsconfig.scripts.json --noEmit --pretty false
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

- safety: 공식 URL/계정, 실패 응답·HTML·식별자 없는 응답, 클릭 실패 단일 호출, 원본 변경 후 복사본 불변, receipt 전이와 중복 차단, 확인 결과 보존, 단계 시각 저장을 검증한다. receipt 파일은 OS 임시 디렉터리에 격리한다.
- route: 실제 API를 VM에서 실행하되 프로세스/파일/DB를 mock한다. 미승인·변경 revision·품질 미달·이전 불확실 시도는 spawn하지 않는다. 발행 자식에 복사본 경로와 생성 비활성 설정을 전달한다. CONFIRMED 이후 exit 1은 PUBLISHED로 복구하고 SUBMITTING 이후 exit 1은 OUTCOME_UNKNOWN으로 보존한다. 실제 승인 PATCH를 추출하여 CAS 충돌 시 승인 0회, 성공/예외의 상태 복구를 검증한다.
- 잘못된 초기 명령 `node -r ts-node/register/transpile-only scripts/verify-publish-safety.ts`는 기본 tsconfig의 모듈 설정 때문에 ERR_MODULE_NOT_FOUND로 실패했다. 명시적 scripts tsconfig를 사용하는 위 명령으로 교정 후 통과했다.

실제 Naver 응답 schema와 로그인/에디터 작동은 이 오프라인 검증으로 입증되지 않는다. 인식되지 않은 예약 응답은 자동 재시도하지 않는 보수적인 동작이다. 운영 실행에서 확정된 정상 응답 fixture를 확보한 뒤 parser 계약을 보강해야 한다. OUTCOME_UNKNOWN을 무조건 READY로 되돌리는 기능은 제공하지 않는다.

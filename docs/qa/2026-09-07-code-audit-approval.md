# 초안 품질·승인·일괄 실행 코드 감사 (2026-09-07)

분석 범위: 쇼핑/여행 점수와 보강 요소, 저장 초안 재검사, 자동 승인·보강, MCP 10건 자동 발행 계약. 화면이나 브라우저를 열지 않았고 실제 생성·예약·발행을 실행하지 않았다. 소스와 운영 데이터를 변경하지 않았다. 현재 `src/lib/brand-post-package.ts`에 있던 로컬 변경을 포함해 **현재 작업 트리**를 분석했다. 종합 검증에서 설치 앱 1.3.25와 핵심 소스 9개의 SHA256 일치를 확인했다. 컴파일된 앱 전체 및 배포된 MCP가 동일한지는 별도 확인 대상이다.

## 핵심 결론

1. **표시되는 readiness와 실제 승인 판정이 서로 다른 평가 결과를 사용한다.** 생성 시점 specValidation을 최신 내용/이미지 검사보다 먼저 선택한다. 동일 응답 안에서 READY 100점과 내용 차단 96점이 공존하는 경우를 메모리 fixture로 재현했다.
2. **자동 보강은 Spec-first만 지원하지만 자동 발행은 모든 저장 초안을 받는다.** MCP로 제출한 초안에 내용 실패가 있으면 승인→revise→INVALID_INPUT으로 끝날 수 있다. 현재 로컬에 저장된 여행 초안 1건도 postSpec이 없고 내용 실패가 있다.
3. **수정 직후와 재검사가 서로 다른 출처 데이터를 채점한다.** 수정은 현재 DB 상품 설명·특징을 쓰고, 재검사는 이전 sourceSnapshot을 쓴다. 변경된 상품에서는 같은 원고의 점수와 보강 대상이 달라지는 확정 가능한 코드 경로다. 현재 샘플에서 실제 DB와 snapshot 차이가 발생했는지는 확인하지 않았다.
4. **높은 총점이 곧 승인 가능이라는 규칙은 아니다.** 필수 카테고리가 하나라도 실패하면 70점 이상이어도 보류된다. 현재 여행 초안은 80점이지만 장소 근거 2/3, 장면 연결 2/3, 이미지도 미완료다. 이 숫자 자체는 현재 채점식과 일치한다.

## 현재 운영 데이터의 읽기 전용 관찰

`%APPDATA%/brandconnect-automation/data/prepared-brand-posts`의 manifest JSON을 `Get-Content`로만 읽었다. store의 `readBrandPostPackage()`는 읽을 때 migration을 기록할 수 있으므로 운영 데이터 조사에 호출하지 않았다.

| 익명 샘플 | 저장 상태 |
|---|---|
| 로컬 manifest 수 | 1건 |
| 유형 | TRAVEL |
| contentQuality | 80점, canPublish=false, code=composition-quality |
| 필수 내용 실패 | productEvidence 14/25: 핵심 방문지 2/3; sceneLinkage 11/20: 장면 연결 2/3 |
| 실패 signals | evidence-density, composition-quality |
| 구성 검사 | 56점, canAutoPublish=false |
| 이미지 메타데이터 | running, remaining=8; updatedAt=2026-09-07T04:08:34.559Z |
| 출처/편집 형식 | sourceSnapshot 있음; postSpec 없음; specValidation 없음 |
| 승인/재검사 | approvedAt 없음; textQualityRevalidation 없음 |

이 샘플에서는 stale specValidation 문제가 직접 관찰되지는 않았다(specValidation이 없기 때문). 대신 **내용과 이미지가 함께 실패한 초안 + 자동 revise가 지원하지 않는 형식**이 실제로 확인됐다. `running`은 저장된 값이며 프로세스가 실제 진행 중이라는 증거는 아니다. 장소 2/3 판정이 사람의 의미 해석과 맞는지는 원문·출처의 개별 문장 검토가 추가로 필요하다. 채점기 출력을 곧바로 원문의 사실로 단정하지 않는다.

## A1. [P1] readiness의 점수·보강요소와 승인 근거가 다름 — 재현 완료

- 생성 패키지가 서로 독립된 `contentQuality`, `specValidation`을 동시에 저장: `scripts/simple-agent.ts:6319-6324`.
- 미리보기는 `specValidation ?? contentQuality 요약 ?? composition 요약`: `src/lib/brand-post-package.ts:431-435`.
- 승인 함수는 generationSource와 이미지 슬롯을 검사하고 PREMIUM에서는 `composition.qualityReport.canAutoPublish`, `contentQuality.canPublish`를 검사: 같은 파일 `333-359`.
- 이미지 복구 후 reconcile은 composition/contentQuality/approvedAt만 갱신하고 기존 specValidation을 유지: 같은 파일 `558-571`.
- MCP도 `preview.readiness`를 우선해 응답 요약을 만든다: `src/app/api/remote-agent/poll/route.ts:484-486,566-576`.

인과관계: 생성 시점 스펙 검증 → 이후 이미지나 내용 판정 변화 → 새 판정을 반영하지 않은 specValidation이 응답 대표 점수·repairTargets로 노출 → 실제 approve는 다른 결과로 거절. 역으로 이미지 복구 후에도 오래된 BLOCKED/보강요소가 남을 수 있다.

오프라인 재현 결과: v2 객체에 specValidation={READY,100}, contentQuality={false,96}, composition={false,30}을 넣어 `packagePreview()` 호출. 결과가 `readiness=READY/100`, `contentQuality.canPublish=false/96`이었다. 파일 쓰기나 API 호출 없음. `revalidateSavedBrandPostText()`는 `specValidation:null`로 이 문제를 해소한다(`src/lib/brand-post-revalidation.ts:104-106`), 그러나 명시적 재검사 전에는 이 보장이 없다.

수정 방향: 전체 승인 결과를 하나의 현재 평가 객체로 계산하고 미리보기, MCP 요약, 승인 endpoint가 같은 객체를 소비하게 한다. specValidation은 생성 단계 참고 자료로 명명하고 현재 승인 readiness와 분리한다. 내용·이미지별 실패와 근거를 함께 제공한다.

회귀: spec READY+내용 FAIL; spec BLOCKED+이미지 복구 완료; 내용 PASS+이미지 FAIL; 총점 96+필수 요소 FAIL; 명시적 재검사 이후 stale spec 미노출.

## A2. [P1] MCP 제출 초안의 자동 보강 불가 — 코드 경로 확정, 현재 대상 확인

- 자동 workflow는 기존 초안을 재사용: `scripts/lib/scheduled-draft-workflow.ts:49-50`.
- 승인 실패가 CONTENT_BLOCKED이면 형식 구분 없이 PATCH revise를 1회 호출: `63-72`.
- revise API는 `postSpec` 없는 v2를 INVALID_INPUT/409로 거절: `src/app/api/brandlinks/[id]/draft/route.ts:314-317`.
- 실제 수정 실행도 spec과 draft를 모두 요구: `scripts/simple-agent.ts:9362-9364`.
- 자동 즉시·예약 발행 MCP 설명은 저장 초안 재사용과 자동 보강을 약속: `apps/sites/app/api/mcp/[credential]/route.ts:303-324`.

현재 로컬 여행 초안은 postSpec이 없고 내용 실패가 남아 있다. 이미지가 모두 끝나더라도 같은 텍스트 평가가 계속 실패하면 이 경로에서 자동 보강이 막힌다. 소스가 없는 원고를 함부로 통과시키는 문제가 아니라, 검증된 snapshot을 가진 freeform 초안을 수정할 실행 경로가 빠진 문제다.

오프라인 workflow 재현: deps.call을 mock하여 기존 초안→recheck 성공→approve CONTENT_BLOCKED→revise INVALID_INPUT을 반환. 실행 이벤트는 `GET draft, recheck, approve, revise`로 끝나고 publish는 0회였다. 실제 endpoint 또는 생성 엔진은 호출하지 않았다.

수정 방향: `editableFormat` 또는 repair capability를 workflow 입력/미리보기에 명시한다. snapshot 기반 freeform revision을 구현하거나 기존 본문·이미지를 보존하며 현재 편집 형식으로 변환하는 경로를 제공한다. 지원 불가 상태는 시작 전에 알려야 하며, 무조건 새 초안 작성이나 사용자 재승인을 요구하는 fallback으로 처리하지 않는다.

회귀: 저장된 ChatGPT 제출 초안의 텍스트 1개 결함을 자동 보강→재검사→승인→mock 발행; Spec-first 수정; 보강 후에도 실패하면 정확한 원인만 반환; 사용자 승인 의도와 idempotency 유지.

## A3. [P1] 수정 채점 출처와 저장 재검사 출처가 다름 — 코드 경로 확정

- 수정 생성은 이전 `prepared.spec`/`draft` 기반: `scripts/simple-agent.ts:9362-9374`.
- 수정 원고의 채점은 현재 DB `link.productDescription/productFeatures`; 쇼핑은 `buildProductScoringFeatures` 변환도 수행: `9401-9424`.
- 저장된 sourceSnapshot은 이전 snapshot이 있으면 그대로 유지: `9436-9441`.
- 재검사는 그 snapshot의 name/description/features를 직접 사용: `src/lib/brand-post-revalidation.ts:90-103`.

따라서 상품 재동기화로 DB 특징이 달라졌거나 쇼핑 scoring features가 snapshot features와 다르면, 원고를 바꾸지 않아도 수정 결과와 재검사 결과의 평가 입력이 달라진다. fingerprint가 있는 재검사와 달리 생성 시 contentQuality에는 동일한 출처 해시 연결이 없다.

수정 방향: draft 생성·수정·재검사·최종 발행이 동일한 frozen snapshot과 동일한 정규화 함수를 사용하게 한다. 출처 갱신은 명시적 새 snapshot 버전으로 저장하고 이전 점수를 무효화한다. 어떤 snapshotId/evaluatorVersion/textHash로 채점했는지 모든 판정에 기록한다.

회귀: DB 상품 설명만 바꿔도 동일 snapshot/원고의 재검사 결과가 유지됨; snapshot을 의도적으로 갱신하면 변경 근거와 점수 차이를 제공; 쇼핑 scoring features 전처리 일치; 여행 상품 외부 ID와 URL 변경 처리.

## A4. [P2] 내용 통과 표시가 categories/code를 무시 — 메모리 재현 완료

`src/lib/brand-post-quality-display.ts:5-12`는 canPublish=false일 때 실패 signals가 composition-quality뿐이면 내용 통과로 판단한다. quality.categories, passScore, code/reason은 입력 계약에 없다. 반면 reconcile은 categories 실패, 임계점 미달, 기존 code-only text failure도 보존한다(`src/lib/brand-post-package.ts:515-517`).

메모리 재현: canPublish=false, score=60, code=quality-score-below-threshold, usefulness category=fail, signals=[composition-quality fail]인 legacy 형태에서 내용 통과 true가 나왔다. 이 경우 내용은 여전히 승인 차단이지만 표시 측에서는 이미지 문제만 남은 것처럼 보일 수 있다. 현재 로컬 샘플은 evidence-density fail signal도 있으므로 이 구체적 형태는 관찰되지 않았다.

수정 방향: 내용 통과 판정도 공통 평가 결과에서 계산하고 fail category·안전 blocker·텍스트 code·점수 임계치를 함께 확인한다. 구조 실패 signals만 있다는 이유로 내용 통과를 추론하지 않는다.

회귀: composition signal만 남고 category fail; code-only legacy failure; 60점/70점 임계치; 현재 구조만 실패한 원고는 내용 통과를 정확히 표시.

## A5. [P2] 높은 점수 보류와 보강요소 의미가 사용 계약에 드러나지 않음

점수는 여섯 카테고리 합계이고, `usefulness` 요소 하나 누락이면 4점 감점이지만 category.status=fail이다(`scripts/lib/brandlink-content-readiness.ts:380-392`). 총점 임계치 검사보다 필수 카테고리 실패가 우선한다(`827-890`). 96점/기준70점이어도 승인이 안 되는 것은 이 규칙 자체로는 정상이다.

여행은 장소와 사실-장면 연결 각각 최대 3개 요구(`scripts/lib/travel-content.ts:636-673`), 현재 샘플은 각각 2/3이다. 실제 점수 80은 productEvidence 11점 감점, sceneLinkage 9점 감점과 일치한다. 다만 구조 blocker가 있으면 대표 code/reason은 먼저 구조 문제를 반환한다(`brandlink-content-readiness.ts:820-823`). 전체 필수 내용 실패는 qualityFailures에 남아도 단일 reason만 사용하는 보강 요청은 이를 빠뜨릴 수 있다.

수정 방향: 총점, 필수 내용 통과 여부, 이미지 통과 여부를 별도 필드로 제공한다. 보강 요청은 단일 error message 대신 categories/qualityFailures/대상 section ID/근거 문장으로 생성한다. 장소 매칭이 틀렸다는 주장은 실제 장소 aliases 및 원문과 source를 비교한 후 판단한다.

## A6. 반복 확인 요청과 10건 일괄 처리의 구분

현재 MCP 기본 설명은 `post_bulk_publish(limit=10)`을 지시하고 자동 승인한다고 설명한다(`apps/sites/app/api/mcp/[credential]/route.ts:29-31,339-348`). 실제 일괄 스크립트는 각 항목에서 runAutomaticDraftWorkflow를 호출한다(`scripts/bulk-today-publish.ts:116-118,185-203`). 이 코드 자체에 매 항목마다 사람에게 질문하는 루프는 없다.

하지만 수동 초안 결과는 `post_approve_draft`로 검토·승인을 요구하고(`src/app/api/remote-agent/poll/route.ts:788-791,865-870`), MCP 전역 지침은 실제 발행 전 명시적 확인을 다시 받으라는 표현을 유지한다(`apps/sites/app/api/mcp/[credential]/route.ts:34`). 기존 10건 발행 요청을 충분한 사용자 확인으로 인정하고 같은 batch 권한을 이어 쓴다는 명시적 계약은 없다. **LLM이 이 문구를 반복 질문으로 해석할 가능성은 있으나 대화 기록 없이 실제 원인으로 확정할 수 없다.**

수정 방향: 초안의 기계적 품질 승인과 사용자의 발행 요청 확인을 분리한다. 사용자가 10건 발행을 명시하면 요청 범위와 항목 수·모드를 batch authorization으로 유지하고, 각 항목 품질 보강 뒤 재확인을 요구하지 않는다. 수동 편집 안내도 이미 받은 batch 발행 요청을 덮어쓰지 않도록 응답 nextAction을 맞춘다. 불확실한 발행의 중복 실행 금지는 유지한다.

## 실행한 안전한 검증

| 검증 | 결과 |
|---|---|
| `tsx --test src/lib/brand-post-quality-display.test.ts src/app/draft-approval-ui.test.ts` | 12개 중 11 PASS, 1 FAIL |
| `ts-node --project tsconfig.scripts.json scripts/verify-content-readiness-failures.ts` | PASS: 정상/고점 필수 실패/안전·구조 차단 |
| `tsx scripts/verify-scheduled-draft-workflow.ts` | PASS: terminal 상태/이미지 순서/기존 원고 재사용/1회 보강; 임의 localhost mock server만 사용 |
| stdin으로 실행한 packagePreview/category-only fixture | PASS: A1/A4 불일치 재현 |
| stdin으로 실행한 workflow deps mock | PASS: freeform repair 실패 시 발행 0회 확인 |
| `node docs/qa/2026-09-07-approval-audit-fixtures.cjs` | PASS: A1/A4 실제 순수 함수 + A2 실제 workflow/mock 및 revise 소스 계약 재현. 파일·DB 쓰기와 외부 호출 없음 |

재실행 가능한 fixture 파일은 `docs/qa/2026-09-07-approval-audit-fixtures.cjs`이다. 이 테스트는 현재 결함의 존재를 재현하므로 PASS는 제품 정상 동작을 뜻하지 않는다. 실제 수정 후에는 기대값을 수정된 동작으로 바꿔야 한다. 운영 데이터 1건은 fixture 입력으로 사용하지 않았다.

실패한 1개 기존 테스트는 `src/app/draft-approval-ui.test.ts:53`의 저장 원고 버튼 문구 정규식이 현재 소스의 `저장 원고 보기`와 다르다는 assertion이다. 브라우저 UI를 검증한 결과가 아니며 그 실패만으로 버튼 오작동이라고 결론내리지 않는다. 최초 `tsx -e` fixture 명령은 Windows native argument quoting으로 문자열 따옴표가 제거되어 실행 전 transform 실패했고, stdin 실행으로 바꿔 정상 재현했다.

제한: 실제 게시물/이미지 생성, 원격 API/배포 검증, 사람의 의미 판단에 의한 모든 원고 오탐 검토는 이 감사에서 수행하지 않았다. 운영 데이터의 store API 호출·수정, 원고 재검사 저장 또는 재승인은 실행하지 않았다.

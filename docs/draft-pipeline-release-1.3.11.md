# 1.3.11 — 초안 제출 `PRODUCT_SNAPSHOT_CHANGED` 회귀 수정

## 증상

1.3.10 을 설치한 PC 에서 여행커넥트 상품(북해도·오사카)으로 원고를 써서 `post_submit_draft` 를 호출하면
매번 `PRODUCT_SNAPSHOT_CHANGED` 로 차단됐다. 상품 목록과 네이버 로그인은 정상이었고, 원고도 작성됐지만
제출 단계에서 막혀 발행된 글이 없었다. 1.3.9 PC 는 같은 흐름이 통과한다.

## 원인

1.3.10 에서 `POST_PREPARE_DRAFT` 작업 결과의 형태를 바꾼 것이 회귀였다.
`src/app/api/remote-agent/poll/route.ts` 의 `buildPreparedDraftView` 가 원본 `brand-draft-context/v2` 를
`context` 아래로 내리고 최상위에는 `productId·contextJobId·snapshotId·verifiedFacts…` 만 남겼다.

그런데 스냅샷을 검증하는 세 지점은 모두 최상위 `snapshot` 을 읽는다.

| 지점 | 읽는 값 |
|---|---|
| 사이트 `post_submit_draft` 검증 | `contextResult.data.snapshot.{productId,connectKind,snapshotId}`, `data.snapshotId` |
| PC 제출 라우트 | `body.contextSnapshot.snapshot` → `readProductSnapshot` (SHA-256 digest 재계산) |
| `simple-agent` | `mcp-submitted-context.json` 의 `context.snapshot` |

최상위 `snapshot` 이 사라졌으므로 1.3.10 PC 가 준비한 컨텍스트는 사이트에서 큐에 들어가기도 전에 거부된다.
e2e 픽스처가 `snapshot` 을 손으로 최상위에 넣고 있었고 계약 테스트는 소스 문자열만 검사해서 회귀가 가려졌다.

## 변경

### 사이트 (배포 즉시 해제)
- 신규 `apps/sites/lib/draft-context.ts` `resolvePreparedDraftContext(contextResult, expected)`: 스냅샷을
  최상위(`data.snapshot`)와 1.3.10 형태(`data.context.snapshot`) 양쪽에서 찾고, 기존 검사(상품 id 일치,
  connectKind 일치, 64-hex snapshotId, `data.snapshotId === snapshot.snapshotId`)를 그대로 수행한다.
- `post_submit_draft` 는 이 헬퍼를 쓰고, 큐에는 슬림 컨텍스트
  `{version, productId, connectKind, externalProductId, sourceUrl, generatedAt, snapshotId, snapshot, contextJobId}`
  만 전달한다. PC 는 `snapshot`·`snapshotId` 만 읽으므로(제출 컨텍스트 파일 850KB 상한) 안전하고,
  1.3.9·1.3.10·1.3.11 PC 가 모두 통과한다.
- `SERVER_INFO.version` 1.3.11. 안내문의 "`context.generation` 안의 값을 사용하세요" → "`generation`".

### 데스크톱 (1.3.11)
- `buildPreparedDraftView` 를 `src/lib/draft-context-view.ts` 로 분리하고 결과를 `{ ...data, productId,
  contextJobId, verifiedFacts, sourceImages, harness, systemPrompt, userPrompt, imageIntents }` 로 되돌렸다.
  `snapshot·snapshotId·version·product·generation·nextAction·externalProductId·sourceUrl·generatedAt` 이
  1.3.9 와 같이 최상위에 남고 `context` 중복은 없다. 850KB 예산 로직은 유지.
- ChatGPT 핸드오프 프롬프트의 `context.generation` 문구도 `generation` 으로.

### 테스트
- `scripts/verify-draft-snapshot-contract.ts` 가 실제 스냅샷으로 `buildPreparedDraftView` →
  `resolvePreparedDraftContext` → `readProductSnapshot` 왕복을 검증한다. 1.3.11 형태와 1.3.10 중첩 형태
  둘 다 통과하고, snapshotId 를 훼손하면 `PRODUCT_SNAPSHOT_CHANGED`, 전달 컨텍스트에 프롬프트·근거가
  없고, 900KB 프롬프트에서는 최상위만 비고 `generation` 원본은 남는지 확인한다.
- `tsconfig.scripts.json` 에 `ts-node.moduleTypes` 를 추가해 ESM 패키지인 `apps/sites` 의 순수 헬퍼를
  루트 CJS 테스트에서 import 할 수 있게 했다.
- `apps/sites/scripts/verify-local-e2e.ps1` 픽스처를 실제 1.3.11 결과 형태로 바꾸고, 전달된 컨텍스트에
  `systemPrompt`·`generation`·`context`·`harness`·`verifiedFacts` 가 없는지 검사한다.

## 배포 순서

1. 사이트(`apps/sites`) 배포. 이것만으로 1.3.10 PC 의 제출이 즉시 통과한다.
2. 데스크톱 1.3.11 패키징·게시. 준비 결과가 다시 1.3.9 형태로 돌아온다.

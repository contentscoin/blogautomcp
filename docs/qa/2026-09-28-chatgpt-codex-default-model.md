# 2026-09-28 ChatGPT 계정 Codex 기본 모델 전환 (1.3.92)

> 후속 정책으로 대체됨: Codex는 `gpt-6-luna`/`low`로 고정하고,
> ChatGPT 브라우저만 `default`를 사용한다. `gpt-6-astra`는 금지한다.
> 현재 정본은 `scripts/lib/draft-runtime-policy.json`과
> `scripts/lib/text-model-policy.ts`이다.

## 원인과 수정

원고 작성 경로는 ChatGPT 계정으로 인증된 Codex SDK를 사용하면서 `gpt-6-luna`를 강제로 전달했다. 해당 인증 경로가 이 모델 이름을 지원하지 않아 STEP2가 HTTP 400 `invalid_request_error`로 중단됐다. 인증 방식과 호환되지 않는 모델 고정이 직접 원인이었다.

- Codex SDK 정책은 `CODEX_DRAFT_MODEL=default`로 바꾸고 `startThread`의 `model` 필드를 생략한다. 로그인된 계정과 번들 Codex가 지원하는 기본 모델을 선택한다.
- API 모델, API 키 설정, 직접 API 호출, Images API와 Daedal 경로를 제거했다. 텍스트 작성·분석·이미지 의미 검수는 ChatGPT 계정으로 인증된 Codex만 사용한다.
- 이전 호출자가 임의 모델명을 Codex 옵션으로 넘기면 외부 호출 전에 거부한다.
- 원고 근거, 구조, 품질 점수, 이미지 의미 검증과 로컬 저품질 폴백 차단은 변경하지 않았다.
- Codex 이미지 생성과 최종 이미지 시각 검수도 같은 계정 기본 모델 정책을 사용해 동일 오류가 다른 단계에서 재발하지 않게 했다.

## 검증

- `npm run test:text-model-policy`: Codex SDK 모델 필드 생략, API 모델 경로 제거, 임의 모델 차단 통과.
- `npm run test:codex-draft-provider`: 실제 오류 문구 분류와 ChatGPT 인증 상태, 안전 설정, 재시도 경계 통과.
- 실제 로그인된 ChatGPT 계정으로 모델을 지정하지 않은 `codexText` 호출: `CODEX_ONLY_OK` 응답 성공.
- `npm run test:codex-image`, `npm run test:fixed-draft-settings`, `npm run test:post-spec`, `npm run test:thumbnail-gen`, `npm run test:shopping-workflow`, `npm run test:brand-post-package`, `npm run test:material-regression`, `npm run typecheck` 통과.
- 변경 파일 대상 ESLint: 오류 0건. 저장소 전체 ESLint는 기존 CJS 및 임시 스크립트의 `require()` 규칙 위반으로 실패하며 이번 변경과 무관하다.
- `npm ls openai --all`: 직접 OpenAI API SDK 의존성 없음.

## 배포

- `npm run desktop:pack:win`: Next.js 프로덕션 빌드, 타입 검사, ASAR 진입점 검사, Windows x64 Electron 패키징 통과.
- `npm run test:packaged-update`: 1.3.92 패키지 실행, 인증된 업데이트 메타데이터/설치 파일 다운로드, 격리 캐시, Prisma 엔진, 로컬 UI, 수동 업데이트 확인, 재실행 복구 통과.
- `npm run site:update:verify -- ../../out`: 중앙 업데이트 게시 전 파일명·크기·SHA-256·SHA-512·blockmap 검증 통과.
- 설치 파일: `BrandConnect-Automation-Setup-1.3.92.exe` (345,042,711 bytes)
- SHA-256: `AFE11645A9D7AAD533C43C3B84E29BF1873A3564206CA601BCC0CF97ED29025C`
- 패키지 내부 `draft-runtime-policy.json`, `simple-agent.ts`, `codex-text.ts`, 설정 API에서 API 모델·API 키·직접 API 모듈 문자열이 없음을 확인했다.

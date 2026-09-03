# 고정 원고 생성 설정

2026-09-03 사용자 요청: Codex, Codex 작성 true, gpt-5.5, 웹 자동작성 true, 섹션 이미지 자동생성 true를 기본 고정하고 선택 UI를 제거한다.

- 공통 정책: `scripts/lib/draft-runtime-policy.json`.
- Electron 시작 시 이전 사용자 설정보다 정책을 우선 적용한다. 설정 API도 오래된 UI의 비활성화 요청을 무시하고 고정값을 저장한다. API 키·블로그 ID 등 별도 사용자 값은 보존한다.
- 설정 화면의 공급자·Codex 활성화·모델·웹 자동작성·섹션 이미지 선택 필드 및 메인 화면의 웹 자동작성 스위치를 제거한다.
- 초안 생성·수정과 원고 없는 발행 경로에서 Codex 우선을 적용한다. 내부 `BROWSER_GPT_MODE`는 웹 기능 활성화와 다르며, Codex 실행을 웹 생성이 가로채지 않도록 라우터가 선택한다.
- PC 초안은 부족한 섹션 이미지를 백그라운드에서 보충한다. MCP 제출의 외부 이미지 적용 경로와 승인·품질 검사는 유지한다.

## 검증

- `npm run test:fixed-draft-settings`: 실제 설정 GET/POST, 이전 false 값, 비밀값 마스킹·보존, 알 수 없는 키 거부, Electron 초기화 함수 실행을 격리된 fixture에서 검증했다.
- `npm run test:codex-draft-provider`, `npm run test:chatgpt-browser-automation`, `npm run test:section-images`: 통과.
- `npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.scripts.json`: 통과.
- 변경 설정·UI·Electron·fixture 파일 대상 ESLint: 통과.
- 임시 개발 서버의 실제 `/settings` 화면에서 고정 안내 및 선택창 0개 확인. 검증용 서버와 탭 종료.
- 실행 중인 PC의 설정 API에 5개 값을 저장하고 작성 모드 codex, Codex 인증 true를 확인했다. 키·계정·원고는 변경하지 않았다.

## 범위

1.3.12 설치본 배포 대상으로 준비했다. 유료 원고·이미지 생성이나 공개 발행은 검증 과정에서 실행하지 않는다. 웹 응답 정지(`CHATGPT_RESPONSE_STALLED`) 자체의 진단·복구 로직은 이번 변경에 포함하지 않는다.

## 1.3.12 배포 검증 보완

- 패키지 smoke test에서 고정 설정 5개와 제거된 설정 필드가 최종 번들에도 반영됐는지 실제 API로 검사한다.
- 검증용 Electron 실행은 `blogautomcp://` 프로토콜을 등록하지 않아 기존 설치본의 연결을 덮어쓰지 않는다. 테스트 실행 0회 등록, 일반 실행 1회 등록을 실제 초기화 함수 기반 fixture로 검증했다.
- 최종 설치본 무결성·다운로드·중앙 배포 결과는 완료 후 아래에 기록한다.

## 최종 1.3.12 검증

- `npm run build`: 정상 완료(컴파일, TypeScript, 정적 페이지, 빌드 추적).
- `npm run test:fixed-draft-settings`, `test:codex-draft-provider`, `test:chatgpt-browser-automation`, `test:section-images`, `test:auto-update`: 통과. scripts TypeScript 및 변경 설정/UI/Electron 파일 ESLint 통과.
- `npx electron-builder --win --publish=never --config.directories.output=out/release-1.3.12`: 정상 완료.
- 패키지 검증: currentVersion 1.3.12, 1.3.13 fixture 인증 다운로드, 고정 설정 및 옵션 제거, 격리 캐시, fixture 설치 차단, 자체 Prisma 엔진, 로컬 UI HTTP 200, 앱 재시작, 토큰 마스킹 모두 통과.
- 설치본 325,480,922 bytes. SHA-256 `d60f64e0dc602bd68cd9b40a6954a3637b5efa16c2a5bcbb138ea35c46dd6cdd`. GitHub v1.3.12 설치본 및 blockmap 해시가 로컬 값과 일치한다.
- 소스 커밋 `c60468bf0c77ab51a20a9828344b7afb198eb230`. GitHub Actions는 계정 결제 실패 또는 spending limit 안내로 job 시작 전 차단됐으며, 원격 CI 통과를 주장하지 않는다.
- PC에서 진행 중인 `codex-draft` 작업을 확인했고 강제 재시작이나 중단하지 않았다. 위 실행 검증은 격리된 최종 패키지에 대한 결과이며 PC 설치 완료와 구분한다.
- 중앙 관리자 화면에서 v1.3.12 및 배포 완료 메시지를 확인했다(2026-09-03 21:55 KST). 연결된 PC는 정상 자동 업데이트 절차로 내려받고 작업 종료 후 적용한다. Sites 웹 코드 자체는 이번 변경 대상이 아니므로 동일 웹 버전을 불필요하게 재배포하지 않았다.

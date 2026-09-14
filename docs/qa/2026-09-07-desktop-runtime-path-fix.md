# 데스크톱 실행 경로 회귀 수정 — 1.3.37

1.3.36은 Electron의 cwd를 실행 파일 폴더로 바꾸면서 로그인 스크립트와 Codex의 `process.cwd()` 기반 검색을 깨뜨렸다. HTTP 200만으로 기능 복구를 판단한 이전 검증은 충분하지 않았다. Prisma 초기화 실패를 무시한 처리와 기존 DB를 복사한 테스트도 신규 설치 실패를 가렸다.

## 변경

- 실행 리소스를 `app.asar.unpacked`에 완전히 풀어 배포하고, Electron의 Next 루트·cwd·DESKTOP_PROJECT_ROOT를 이 실제 폴더로 통일했다.
- Codex 실행 파일, ts-node, 로그인 스크립트, tsconfig와 Prisma 스키마를 자식 프로세스가 실제 디스크 경로로 찾을 수 있다.
- Prisma 엔진을 사용자 폴더에 복사하던 우회와 DB 초기화/중단 작업 복구 오류를 무시하던 catch를 제거했다.
- 격리 테스트에서 기존 DB 복사를 제거했다. ChatGPT 로그인에 세션 변경 없이 브라우저 런타임만 검사하는 `--check-runtime`을 추가했다.
- asar 사용 자체가 전체 설치를 원자적으로 만들지는 않는다. 런타임 파일은 unpacked에 존재하며, 이전 문서의 원자 설치 보장 표현은 정정한다.

## 검증

`pwsh -NoProfile -File scripts/verify-packaged-auto-update.ps1 -AppPath 'out/release-1.3.37/win-unpacked/BrandConnect Automation.exe' -AppPort 43249 -UpdatePort 43250` 통과.

- 빈 사용자 데이터에서 DB 초기화, readiness와 로컬 HTTP 200
- `/api/codex`에서 bundled Codex 인식
- 실제 Electron Node 모드와 packaged ts-node로 네이버·ChatGPT 로그인 스크립트 `--check-runtime` 실행 성공
- 인증된 가짜 업데이트 1.3.38 다운로드, 설치 비활성 상태 확인
- 수동 업데이트 확인과 앱 재시작 성공
- 패키지 Prisma 엔진 사용, 개발 폴더 엔진 미사용

실제 계정 로그인 완료나 블로그 발행은 이 검사에서 실행하지 않았다. 설치 파일은 검증된 win-unpacked를 `--prepackaged`로 묶는다.

## 배포
1.3.37 설치 파일과 blockmap의 무결성 검증 및 중앙 업로드/활성화 성공 (2026-09-07T10:22:21Z). 설치 파일 SHA-256: e465311b034cc3abdd6e47b2d5d8dff1c76e8d531f6e16e176f00daa9dd0e8a5. 이 작업에서는 사용자의 기존 실행 앱을 종료하거나 설치 프로그램을 실행하지 않았다.

# 데스크톱 설치형 앱 빌드 (Windows / macOS)

이 프로젝트는 Electron으로 PC 설치형 앱을 만든다. 웹 대시보드와 동일한 코드를
in-process Next 서버(127.0.0.1)로 띄우고, 실제 발행/생성은 백그라운드 ts-node
스크립트가 수행한다.

설치형 앱의 기본 주소는 `http://127.0.0.1:43127`이다. 일반 개발 서버가 흔히 쓰는
3000 포트와 충돌하지 않도록 데스크톱 전용 포트를 사용한다.

## 사전 준비물

- **Node.js 18+**
- **Google Chrome** — 네이버 로그인과 포스팅 자동화는 시스템 Chrome을 사용한다.
  패키징 앱은 `BROWSER_CHANNEL=chrome`로 Playwright가 설치된 Chrome을 구동한다.
  (Chromium을 앱에 번들하지 않는다 — 용량·코드서명 문제 회피)
- macOS 빌드는 macOS에서, **Windows 빌드는 Windows에서** 수행해야 한다(아래 참고).

## 빌드 명령

```bash
# 공통 사전 단계(자동 포함): 빈 스키마 템플릿 DB 생성 + next build
npm run desktop:pack:mac     # macOS → out/*.dmg
npm run desktop:pack:win     # Windows → out/*.exe (NSIS 설치 프로그램)
npm run desktop:pack         # 현재 OS 기본 타깃
```

Windows 산출물은 `out/`에 생성된다(예: `BrandConnect-Automation-Setup-1.1.0.exe`,
동일 이름의 `.blockmap`, `latest.yml`).

## 중앙 자동업데이트

- Windows 설치본은 `electron-updater`의 NSIS 자동업데이트를 사용한다.
- MCP 주소로 활성화된 PC만 장치 토큰으로 업데이트 파일을 내려받을 수 있다.
- 앱은 중앙 채널을 2분마다 확인하고 새 버전을 자동 다운로드한다.
- 다운로드가 끝나면 새 포스팅·로그인·스크립트 작업을 막고, 진행 중인 작업이 0건인
  상태를 두 번 확인한 뒤 조용히 재시작하여 설치한다.
- 트레이 메뉴의 `업데이트 확인`으로 즉시 확인할 수도 있다.
- 자동업데이트 기능이 처음 포함된 1.1.0은 기존 설치 사용자가 한 번 직접 설치해야 한다.
  이후 1.1.1부터는 중앙 배포만으로 자동 반영된다.

패키지 네트워크·유휴 설치 검증은 다음 명령으로 재현할 수 있다.

```powershell
npm run test:auto-update
npm run test:packaged-update
```

## 동작 방식 (패키징 특이사항)

- **데이터베이스**: 설치 경로는 읽기 전용이므로, 첫 실행 시 빈 스키마 템플릿
  (`prisma/template.db`)을 사용자 쓰기 영역(`app.getPath('userData')/app.db`)으로
  복사하고 `DATABASE_URL`을 그 절대경로로 고정한다. (`scripts/electron/main.cjs`)
- **스크립트 실행**: 패키징 앱에는 `npx`가 없으므로, 발행/생성 스크립트를
  Electron 내장 node(`ELECTRON_RUN_AS_NODE`) + `ts-node/register/transpile-only`로
  실행한다. (`src/lib/run-script.ts`의 `buildTsScriptSpawn`, 발행 라우트 2종)
- **Prisma 엔진**: 멀티플랫폼 쿼리 엔진(`darwin`, `darwin-arm64`, `windows`)을
  `schema.prisma`의 `binaryTargets`로 생성하고, electron-builder가 가지치기하는
  생성물 `.prisma`는 `extraResources`로 앱 번들에 명시 복사한다.
- **브라우저**: `BROWSER_CHANNEL=chrome` → 시스템 Chrome 사용.
- **빌드 번들러**: `next build --webpack`를 사용한다. Next 16의 기본 Turbopack은
  `@prisma/client`를 해시 외부모듈로 잘못 묶어 패키징 런타임에서 "Cannot find module
  @prisma/client-<hash>"로 실패하므로(vercel/next.js#87737), webpack으로 빌드한다.
- **사용자 설정(.env)**: 번들에는 `.env`가 없다(보안). 패키징 앱은 첫 실행 시
  `userData/.env`가 있으면 로드한다. 사용자는 아래 경로에 `.env`를 넣어 API키·네이버
  설정을 적용한다.
  - macOS: `~/Library/Application Support/brandconnect-automation/.env`
  - Windows: `%APPDATA%/brandconnect-automation/.env`
  - DB(`app.db`)도 같은 폴더에 생성된다(템플릿 복사).

## 코드 서명 / 공증(notarization)

- macOS: keychain의 **Developer ID Application** 인증서가 있으면 자동 서명된다.
  (현재 "The H Club" 인증서로 서명 확인됨)
- **공증(notarization)은 미설정**이다. 외부 배포 시 Gatekeeper 통과를 위해
  Apple ID 앱 암호로 `notarize` 설정을 추가해야 한다. 미공증 앱은 최초 실행 시
  사용자가 우클릭→열기로 허용해야 한다.
- Windows: 코드서명 인증서(EV/OV)가 있으면 SmartScreen 경고를 줄일 수 있다(선택).

## Windows 빌드 참고

`win.nsis` 설정은 준비돼 있으나, **NSIS 설치 프로그램과 Windows용 Prisma 엔진은
Windows 환경에서 빌드**해야 신뢰성이 높다. macOS에서 `--win` 빌드는 wine 의존 등
제약이 있으므로, Windows 머신 또는 CI(GitHub Actions `windows-latest`)에서
`npm run desktop:pack:win`을 실행할 것을 권장한다.

## 첫 실행 후 할 일

1. 앱을 실행하면 MCP 활성화 화면만 표시된다. 사이트에서 발급받은 MCP 주소를 입력해
   이 PC를 활성 장치로 연결한다. 활성화 전에는 대시보드와 자동화 API를 사용할 수 없다.
2. 연결 후 설정 화면의 `네이버 로그인` 버튼으로 네이버 세션을 저장한다.
3. 같은 MCP 주소를 ChatGPT 개발자 모드에도 별도로 등록한다. 로컬 앱의 로그인과
   ChatGPT의 MCP 등록은 서로 자동 연동되지 않는다.
4. 필요한 경우 `userData/brandconnect-automation/.env`에 `OPENAI_API_KEY`,
   `NAVER_BLOG_ID`, `ADMIN_API_KEY` 등의 실행 설정을 넣는다.

MCP 주소가 재발급되거나, 관리자가 계정을 정지하거나, 다른 PC가 같은 주소로
인증하면 기존 장치 토큰은 폐기된다. 로컬 앱은 다음 폴링에서 인증 실패를 확인하고
즉시 활성화 화면으로 다시 잠긴다.

## 런타임 검증 상태 (2026-05, macOS arm64)

빌드한 .app을 깨끗한 환경(프로젝트 밖)에서 실행해 검증 완료:
- ✅ in-process Next 서버 부팅
- ✅ Prisma 클라이언트 로드 + 쿼리 성공(`/api/brandlinks` → `{"success":true,"data":[]}`)
- ✅ `userData/app.db` 자동 생성(템플릿 복사, 155KB)
- ✅ Developer ID 코드서명

미검증(설치 환경 권장): 실제 네이버 발행 엔드투엔드, Windows 빌드/실행, 공증.

## 알려진 후속 과제

- 공증(macOS)·코드서명(Windows) 자동화.
- 실제 설치→발행까지의 엔드투엔드 런타임 검증(설치 환경에서 1회 수행 권장).

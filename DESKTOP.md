# 데스크톱 설치형 앱 빌드 (Windows / macOS)

이 프로젝트는 Electron으로 PC 설치형 앱을 만든다. 웹 대시보드와 동일한 코드를
in-process Next 서버(127.0.0.1)로 띄우고, 실제 발행/생성은 백그라운드 ts-node
스크립트가 수행한다.

## 사전 준비물

- **Node.js 18+**
- **Google Chrome** — 자동화(네이버/ChatGPT 조작)는 시스템 Chrome을 사용한다.
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

산출물은 `out/`에 생성된다(예: `BrandConnect Automation-1.0.0-arm64.dmg`).

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

1. `userData/brandconnect-automation/.env`에 설정(`OPENAI_API_KEY`, `NAVER_BLOG_ID`,
   `ADMIN_API_KEY` 등)을 넣는다. (위 "사용자 설정" 경로 참고)
2. 앱 실행 → 웹 대시보드가 뜬다. DB는 userData에 자동 생성된다.
3. 네이버 로그인 세션이 필요하다. (현재는 개발 명령 `npm run login`으로 세션 저장 —
   패키징 앱 내 로그인 버튼 UX는 후속 작업)

## 런타임 검증 상태 (2026-05, macOS arm64)

빌드한 .app을 깨끗한 환경(프로젝트 밖)에서 실행해 검증 완료:
- ✅ in-process Next 서버 부팅
- ✅ Prisma 클라이언트 로드 + 쿼리 성공(`/api/brandlinks` → `{"success":true,"data":[]}`)
- ✅ `userData/app.db` 자동 생성(템플릿 복사, 155KB)
- ✅ Developer ID 코드서명

미검증(설치 환경 권장): 실제 네이버 발행 엔드투엔드, Windows 빌드/실행, 공증.

## 알려진 후속 과제

- 패키징 앱 내에서 네이버/ChatGPT 로그인을 트리거하는 UI(현재 CLI 의존).
- 공증(macOS)·코드서명(Windows) 자동화.
- 실제 설치→발행까지의 엔드투엔드 런타임 검증(설치 환경에서 1회 수행 권장).

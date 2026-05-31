# 브랜드커넥트 자동화 (Brandconnect Automation)

네이버 쇼핑 커넥트(브랜드커넥트) 상품 리뷰를 자동으로 블로그에 포스팅하는 도구입니다.

## ✨ 주요 기능

- 🔗 **상품 URL만 입력하면 끝!** - 브랜드커넥트 링크만 넣으면 자동으로 처리
- 🤖 **GPT 기반 글 작성** - SEO 최적화된 자연스러운 리뷰 글 자동 생성
- 🖼️ **이미지 자동 스크래핑** - 상품 이미지 자동 수집 및 업로드
- 📝 **해시태그 자동 생성** - 검색 노출을 위한 해시태그 자동 추가
- 🌐 **웹 대시보드** - 편리한 웹 UI로 링크 관리 및 발행

### 🆕 V7 신규 기능

- 🖥️ **PC 설치형 앱 (macOS/Windows)** - 개발 환경 설치 없이 설치 파일로 바로 실행. 앱 안에서 설정·네이버 로그인까지 완결 → [다운로드](#-다운로드-설치형-앱)
- ✍️ **글쓰기 자연스러움 고도화** - "AI 티"(번역투, "결론적으로/시사하는 바가 크다" 류 상투구, 첫째·둘째 기계적 구조, 문장 리듬 평탄화)를 자동으로 줄여 사람이 쓴 듯한 문장 생성 + 발행 전 자연스러움 점검
- ⚙️ **앱 내 설정/로그인 UI** (`/settings`) - API키·블로그 ID·AI 공급자 입력과 네이버 로그인을 앱 화면에서 처리 (`.env` 수동 편집 불필요)
- 🔒 **보안·신뢰성 개선** - 인증 fail-closed, 발행 동시성/중복 방지(원자적 클레임·reaper), KST 타임존 일원화, 세션 만료 즉시 감지

### V6 기능

- 📊 **실시간 발행 진행률** - SSE로 발행 단계별 실시간 상태 표시
- 📋 **발행 히스토리** - 발행 완료/실패 기록 조회 (`/history`)
- 🔍 **키워드 분석** - 트렌드 키워드, 조합 생성, 콘텐츠 품질 체크 (`/keywords`)
- 🧠 **주제글 자동 리서치** - 명시 출처가 없어도 주제/키워드로 참고 소스를 자동 탐색하고 SEO 키워드 반영을 발행 전 점검
- 🌙 **다크모드** - 시스템 설정 연동 또는 수동 전환
- 📝 **장소/제품 리뷰** - 장소명 검색 → 맛집/여행/육아 등 카테고리별 리뷰 생성

---

## 📥 다운로드 (설치형 앱)

개발 환경 설치 없이 바로 쓰려면 설치 파일을 받으세요. (최신 릴리스: **[Releases 페이지](https://github.com/contentscoin/naver-bc-automation/releases/latest)**)

| OS | 파일 | 상태 |
|----|------|------|
| **macOS (Apple Silicon)** | `BrandConnect Automation-1.0.0-arm64.dmg` | ✅ [v1.0.0 다운로드](https://github.com/contentscoin/naver-bc-automation/releases/tag/v1.0.0) |
| **Windows (x64)** | `*.exe` (NSIS) | ⏳ 준비 중 (아래 참고) |

**사전 준비물**: [Google Chrome](https://www.google.com/chrome/) 설치 — 자동화는 시스템 Chrome을 사용합니다.

**설치 & 첫 실행**
1. **macOS**: dmg 열기 → `Applications`로 드래그. 최초 실행 시 **우클릭 → 열기**(미공증이라 Gatekeeper 허용 1회)
2. 앱 우측 상단 **⚙️ 설정**에서 `OpenAI/Gemini API 키`, `네이버 블로그 ID`, `AI 공급자` 입력
3. 같은 화면의 **네이버 로그인** 버튼으로 세션 저장
4. 데이터(`app.db`)·설정(`.env`)·로그인 세션은 사용자 폴더(userData)에 자동 저장됩니다

> ⏳ **Windows 설치본은 아직 제공되지 않습니다.** 직접 빌드하려면 **Windows 환경**에서 `npm run desktop:pack:win`을 실행하세요. (자동 빌드 CI는 `.github/workflows/desktop-build.yml`에 구성돼 있으나 현재 빌드 환경 이슈로 보완 중) 빌드 상세는 [DESKTOP.md](DESKTOP.md) 참고.

---

## 💡 왜 이 도구인가?

| 기존 문제 | 이 도구의 해결책 |
|----------|----------------|
| 네이버 봇 감지로 차단됨 | ✅ Stealth Plugin으로 우회 |
| 글이 뻔하고 기계적임("AI 티") | ✅ AI-tell 룰셋으로 번역투·상투구·리듬 평탄화 자동 제거 |
| 할인/쿠폰 정보 누락 | ✅ 할인율, 리뷰 수, 평점까지 자동 수집 |
| 한 번 로그인하면 끝 | ✅ 세션 저장으로 7~30일간 유지 |
| 개발 환경 설치가 번거로움 | ✅ PC 설치형 앱(dmg/exe)으로 바로 실행 |

---

## 📋 사전 준비물

### 1. Node.js 설치 (v18 이상)

1. [Node.js 공식 사이트](https://nodejs.org/ko) 접속
2. **LTS** 버전 다운로드 (왼쪽 초록색 버튼)
3. 설치 파일 실행 후 "다음" 계속 클릭하여 설치 완료

설치 확인:
```bash
node --version
# v18.x.x 이상이 나오면 성공!
```

### 2. AI 설정

**OpenAI API 사용 시**
1. [OpenAI Platform](https://platform.openai.com/api-keys) 접속
2. 구글/마이크로소프트 계정으로 로그인
3. **"Create new secret key"** 클릭
4. 생성된 키 복사 (sk-xxx... 형태)

**ChatGPT 구독/로그인 세션 사용 시**
`BROWSER_GPT_MODE=true`로 설정하고 `npm run login:chatgpt`로 ChatGPT 로그인을 저장합니다.

> ⚠️ API 키는 한 번만 보여주므로 반드시 복사해서 안전한 곳에 저장하세요!

### 3. 네이버 블로그 ID 확인

내 블로그 주소가 `https://blog.naver.com/abc123` 이라면, 블로그 ID는 `abc123` 입니다.

---

## 🚀 설치 방법

### 1단계: 프로젝트 다운로드

> 💡 코드 수정/개발이 아니라 **그냥 쓰고 싶다면** 위 [📥 다운로드](#-다운로드-설치형-앱)에서 설치 파일을 받는 게 가장 쉽습니다. 아래는 개발/직접 빌드용입니다.

**방법 A: Git 사용 (권장)**
```bash
git clone https://github.com/contentscoin/naver-bc-automation.git
cd naver-bc-automation
```

**방법 B: ZIP 다운로드**
1. GitHub에서 "Code" → "Download ZIP" 클릭
2. 압축 해제 후 폴더로 이동

### 2단계: 패키지 설치

```bash
npm install
```

### 3단계: 브라우저 설치 (자동화용)

```bash
npx playwright install chromium
```

### 4단계: 데이터베이스 설정

```bash
npx prisma generate
npx prisma db push
```

---

## ⚙️ 설정 방법

### 1. 환경 변수 파일 생성

**Windows:**
```bash
copy .env.example .env
```

**Mac/Linux:**
```bash
cp .env.example .env
```

### 2. .env 파일 수정

메모장 또는 VS Code로 `.env` 파일을 열고 아래 내용을 입력:

```env
# AI 선택
AI_PROVIDER=openai

# OpenAI 사용 시 (AI_PROVIDER=openai)
OPENAI_API_KEY=sk-여기에_발급받은_키_붙여넣기

# Browser GPT 모드 사용 시 (OpenAI API 키 없이 ChatGPT 웹 로그인 세션 사용)
BROWSER_GPT_MODE=true

# 네이버 블로그 ID
NAVER_BLOG_ID=내_블로그_아이디

# 데이터베이스 (수정 불필요)
DATABASE_URL="file:./dev.db"
```

> 💡 주제글/이미지 발행 파이프라인은 GPT만 사용합니다.

### 3. 운영 보안 설정 (권장)

관리자 키를 설정하면 쓰기 API(발행/수정/삭제/리뷰생성/스케줄)가 보호됩니다.

```env
ADMIN_API_KEY="랜덤한_긴_문자열"
CRON_SECRET="랜덤한_긴_문자열"
```

- `ADMIN_API_KEY`: 대시보드 외부에서 API 호출할 때 `x-admin-api-key` 헤더 필요
- `CRON_SECRET`: `/api/schedule/cron` 호출 시 `x-cron-secret` 또는 `Authorization: Bearer ...` 필요
- 대시보드(동일 오리진)에서 발생하는 브라우저 요청은 정상 동작하도록 허용됨

예시:
```bash
curl -X POST http://localhost:3001/api/review \
  -H "x-admin-api-key: <ADMIN_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"placeName":"테스트","rawNotes":"테스트"}'

curl http://localhost:3001/api/schedule/cron \
  -H "x-cron-secret: <CRON_SECRET>"
```

---

## 📖 사용 방법

### Step 1: 네이버 로그인

```bash
npm run login
```

1. 브라우저가 자동으로 열립니다
2. 네이버에 로그인하세요 (2단계 인증 포함)
3. 로그인 완료 후 자동으로 세션이 저장됩니다

> 💡 세션은 보통 7~30일간 유지됩니다. 발행 실패 시 다시 로그인하세요.

### Step 1-2: ChatGPT 로그인 (Browser GPT 모드일 때만)

`BROWSER_GPT_MODE=true`로 사용하는 경우에만 필요합니다.

```bash
npm run login:chatgpt
```

- 브라우저에서 ChatGPT 로그인 후 `Enter`를 누르면 세션이 저장됩니다.
- 스크립트가 Draft/Polish Custom GPT URL 접근까지 검증합니다.
- 계정이 다르면 `This GPT is inaccessible or not found` 오류로 실패합니다.
- 발행 시 Custom GPT는 기본적으로 persistent 프로필 + 새 대화로 시작합니다 (`CHATGPT_RUN_ISOLATED_CONTEXT=false`, `CHATGPT_FORCE_NEW_CHAT=true`).
- temporary chat 모드가 필요하면 `CHATGPT_USE_TEMPORARY_CHAT=true`를 설정하세요.
- GPT 가이드 상호작용 모드(`CHATGPT_GUIDED_MODE=true`)에서는 GPT가 질문하면 자동으로 답변하고, 최종 구조화 응답이 올 때까지 대화를 이어갑니다.
- Draft GPT는 1~6단계 질문 흐름(제품정보→SEO키워드→버전→소제목개수→콘텐츠→말투)에 맞춰 응답하며, 기본값은 모바일(2번) + 소제목 5개 + 말투 4번(경험공유형)입니다.
- Draft/Polish GPT에 상품 이미지를 함께 첨부해 문맥을 강화합니다 (`CHATGPT_IMAGE_CONTEXT_MAX`, `CHATGPT_ATTACH_IMAGES_TO_DRAFT`, `CHATGPT_ATTACH_IMAGES_TO_POLISH`).
- 주제글 AI 이미지 생성은 기본적으로 ChatGPT 로그인/구독 세션을 사용합니다. API 방식이 필요할 때만 `TOPIC_PIPELINE_DAEDAL_ENABLED=true`와 `OPENAI_API_KEY`를 설정하면 `daedal` CLI(`gpt-image-2`)를 먼저 사용하고 실패 시 기존 ChatGPT/TopicCraft 경로로 폴백합니다.
- 주제글 prepare 단계는 `TOPIC_AUTO_RESEARCH_ENABLED=true`일 때 입력 주제/키워드로 참고 URL을 자동 탐색합니다. `NAVER_SEARCH_CLIENT_ID`/`NAVER_SEARCH_CLIENT_SECRET`이 있으면 네이버 검색 OpenAPI를 먼저 쓰고, 없으면 DuckDuckGo HTML 검색을 best-effort로 사용합니다.
- 준비된 주제글은 발행 전에 도입부, 하이라이트, 섹션 구조, 본문 자연스러움, 이미지 확보 상태와 함께 SEO 키워드 커버리지를 검사합니다. 명시 키워드가 본문/제목/태그에 거의 반영되지 않으면 재준비가 필요합니다.
- 필요할 때만 기본 ChatGPT로 폴백하세요 (`CHATGPT_FALLBACK_TO_BASE=true`, 기본값 false).
- GPT 응답 대기는 고정 시간이 아니라 진행 신호(생성중/텍스트 증가) 기반으로 유지됩니다.
  필요 시 `.env`의 `CHATGPT_RESPONSE_IDLE_TIMEOUT_MS`, `CHATGPT_RESPONSE_MAX_TIMEOUT_MS`로 조정하세요.

### Step 2: 웹 대시보드 실행

```bash
npm run dev
```

브라우저에서 **http://localhost:3000** 접속

### Step 2-2: 데스크톱 앱(권장, macOS/Windows 용)

```bash
npm run desktop
```

- 앱 실행 시 Next.js 서버를 자동으로 시작(또는 3000 포트 사용 중이면 기존 서버 재사용)
- macOS: `BrandConnect Automation.app` 실행
- Windows: 설치 후 `.exe` 실행

또는 더블클릭 실행:

- macOS: `scripts/desktop.command`
- Windows: `scripts/desktop.bat`

#### 데스크톱 앱 빌드

```bash
npm run desktop:pack:mac   # macOS dmg 생성 (macOS에서 실행)
npm run desktop:pack:win   # Windows 인스톨러 생성 (Windows에서 실행)
```

- 각 OS 설치본은 **해당 OS에서** 빌드해야 합니다(prisma 엔진·서명 등). `desktop:pack:*`은 내부적으로 `db:template`(빈 스키마 DB) → `npm run build`(Next webpack 빌드) → `electron-builder` 순으로 동작합니다.
- 자동화 브라우저는 **시스템 Chrome**(`BROWSER_CHANNEL=chrome`)을 사용합니다(Chromium 미번들).
- 설치된 앱은 DB·설정(`.env`)·로그인 세션을 **사용자 폴더(userData)** 에 저장하며, 앱 내 **⚙️ 설정** 화면에서 설정·네이버 로그인을 처리합니다.
- macOS 빌드/서명·런타임은 검증 완료. Windows 자동 빌드(CI)는 `.github/workflows/desktop-build.yml`에 구성돼 있습니다. 상세는 [DESKTOP.md](DESKTOP.md).

### Step 3: 링크 추가 & 발행

1. 브랜드커넥트에서 받은 링크 복사 (https://naver.me/xxx 형태)
2. 웹 대시보드에서 URL 입력 후 "추가" 클릭
   - 필요 시 게시판 번호(categoryNo) 지정
   - 필요 시 소제목 스타일 적용 ON/OFF 설정
3. 🔍 버튼으로 상품 정보 가져오기
4. 🚀 **발행** 버튼 클릭!

발행 버튼을 누르면:
- 브라우저가 자동으로 열림
- 상품 이미지 스크래핑
- GPT가 리뷰 글 작성
- 이미지 업로드 + 글 작성
- 자동 발행 완료!

---

## 🔧 명령어 모음

| 명령어 | 설명 |
|--------|------|
| `npm run login` | 네이버 로그인 (세션 저장) |
| `npm run login:chatgpt` | ChatGPT 로그인 (Browser GPT 모드용 세션 저장) |
| `npm run dev` | 웹 대시보드 실행 (localhost:3000) |
| `npm run desktop` | 데스크톱 앱 실행 (macOS/Windows) |
| `./scripts/desktop.command` | macOS 데스크톱 앱 실행기 |
| `./scripts/desktop.bat` | Windows 데스크톱 앱 실행기 |
| `npm run desktop:pack:mac` | macOS 설치본 생성 |
| `npm run desktop:pack:win` | Windows 설치본 생성 |
| `npm run build` | 프로덕션 빌드 |
| `npm run db:studio` | 데이터베이스 관리 UI |

생성 결과만 확인하고 싶을 때(발행 없이):
```bash
DRY_RUN_GENERATE_ONLY=true DEBUG_SAVE_GENERATED_POST=true npm run publish -- <linkId>
```
결과 파일은 `logs/generated/*.json`에 저장됩니다.

---

## ❓ FAQ / 문제 해결

### Q: "로그인이 안 돼요"
**A:** Playwright 브라우저를 재설치해보세요:
```bash
npx playwright install chromium --force
```

### Q: "발행이 실패해요"
**A:** 세션이 만료되었을 수 있습니다:
```bash
npm run login
```
다시 로그인 후 발행해보세요.

### Q: "ChatGPT 로그인했는데도 Custom GPT 접근 오류가 나요"
**A:** 현재 로그인 계정이 GPT 링크 소유/공유 계정과 다를 때 발생합니다.

```bash
npm run login:chatgpt
```

실행 후 같은 계정으로 로그인했는지 확인하세요. 필요하면 `.env`의 `CHATGPT_GPT_URL_DRAFT`, `CHATGPT_GPT_URL_POLISH` 링크 권한도 점검하세요.

### Q: "OpenAI API 오류가 나요"
**A:** 
- API 키가 올바른지 확인
- OpenAI 계정에 크레딧이 있는지 확인
- .env 파일에 키가 제대로 입력되었는지 확인

### Q: "이미지가 안 올라가요"
**A:** 네트워크 문제일 수 있습니다. 잠시 후 다시 시도하거나, 상품 페이지의 이미지가 정상인지 확인해보세요.

---

## ⚠️ 주의사항 / 면책조항

1. **네이버 이용약관**: 과도한 자동화 사용은 네이버 이용약관에 위배될 수 있습니다.
2. **계정 제재**: 단시간에 너무 많은 글을 발행하면 계정이 제재될 수 있습니다.
3. **본인 책임**: 이 도구의 사용으로 인한 모든 결과는 사용자 본인의 책임입니다.
4. **적절한 사용**: 하루 1~3개 정도의 적절한 발행을 권장합니다.

---

## 📄 라이선스

MIT License

---

## 🙋 문의

이슈나 문의사항은 GitHub Issues를 이용해주세요.

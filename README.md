# 브랜드커넥트 자동화 (Brandconnect Automation)

네이버 쇼핑 커넥트(브랜드커넥트) 상품 리뷰를 자동으로 블로그에 포스팅하는 도구입니다.

## 🌐 BlogAutoMCP 사이트·MCP 구조

이 저장소에는 기존 로컬 자동화와 함께 `apps/sites` 서버리스 사이트가 포함되어 있습니다. 사이트는 자체 `package-lock.json` 을 가진 별도 프로젝트이며 루트의 `site:*` 스크립트로 실행합니다.

- 이메일 확인 없는 가입 신청 → 관리자 `hiway@kakao.com` 승인
- 한 번만 표시되는 사용자별 MCP URL과 재발급 시 기존 연결 폐기
- 사용자당 활성 PC 한 대, 새 PC 인증 시 기존 PC 토큰 폐기
- ChatGPT OAuth + MCP 도구 → PostgreSQL 작업 큐 → 로컬 Electron 앱 실행
- 쇼핑커넥트 경로 연결, 여행커넥트 실계약 캡처와 fail-closed 출시 게이트
- Windows 로그인 시 숨김 자동실행, 창을 닫아도 트레이에 상주하는 로컬 에이전트

별도 상주 백엔드 서버는 운영하지 않습니다. 사이트의 Next.js 서버리스 함수와 관리형 PostgreSQL만 필요합니다. 구체적인 현재 구현·미검증 범위는 [구현 기준서](docs/mcp-saas-local-agent-product-plan.md), 사이트 배포는 [사이트 README](apps/sites/README.md)를 확인하세요.

## ✨ 주요 기능

- 🔗 **상품 URL만 입력하면 끝!** - 브랜드커넥트 링크만 넣으면 자동으로 처리
- 🤖 **GPT 기반 글 작성** - SEO 최적화된 자연스러운 리뷰 글 자동 생성
- 🖼️ **이미지 자동 스크래핑** - 상품 이미지 자동 수집 및 업로드
- 📝 **해시태그 자동 생성** - 검색 노출을 위한 해시태그 자동 추가
- 🌐 **웹 대시보드** - 편리한 웹 UI로 링크 관리 및 발행

### 🆕 V6 신규 기능

- 📊 **실시간 발행 진행률** - SSE로 발행 단계별 실시간 상태 표시
- 📋 **발행 히스토리** - 발행 완료/실패 기록 조회 (`/history`)
- 🔍 **키워드 분석** - 트렌드 키워드, 조합 생성, 콘텐츠 품질 체크 (`/keywords`)
- 🧠 **주제글 자동 리서치** - 명시 출처가 없어도 주제/키워드로 참고 소스를 자동 탐색하고 SEO 키워드 반영을 발행 전 점검
- 🌙 **다크모드** - 시스템 설정 연동 또는 수동 전환
- 📝 **장소/제품 리뷰** - 장소명 검색 → 맛집/여행/육아 등 카테고리별 리뷰 생성

---

## 💡 왜 이 도구인가?

| 기존 문제 | 이 도구의 해결책 |
|----------|----------------|
| 네이버 봇 감지로 차단됨 | ✅ Stealth Plugin으로 우회 |
| 글이 뻔하고 기계적임 | ✅ GPT가 매번 다른 자연스러운 글 생성 |
| 할인/쿠폰 정보 누락 | ✅ 할인율, 리뷰 수, 평점까지 자동 수집 |
| 한 번 로그인하면 끝 | ✅ 세션 저장으로 7~30일간 유지 |

---

## 📋 사전 준비물

### 1. Node.js 설치 (v20.9 이상)

1. [Node.js 공식 사이트](https://nodejs.org/ko) 접속
2. **LTS** 버전 다운로드 (왼쪽 초록색 버튼)
3. 설치 파일 실행 후 "다음" 계속 클릭하여 설치 완료

설치 확인:
```bash
node --version
# v20.9 이상이 나오면 성공!
```

### 2. AI 설정

**OpenAI API 사용 시**
1. [OpenAI Platform](https://platform.openai.com/api-keys) 접속
2. 구글/마이크로소프트 계정으로 로그인
3. **"Create new secret key"** 클릭
4. 생성된 키 복사 (sk-xxx... 형태)

**ChatGPT와 MCP로 연결할 때**
로컬 프로그램에서는 ChatGPT에 로그인하지 않습니다. 인증은 네 단계뿐입니다.

1. 사이트(BlogAutoMCP)에 ChatGPT 계정으로 로그인하고 관리자 승인을 받습니다.
2. 대시보드에서 MCP 주소를 발급해 **ChatGPT 커넥터에 한 번만** 등록합니다.
3. 대시보드의 **PC 앱 연결** 버튼을 누르면 설치된 PC 앱이 열리며 자동으로 연결됩니다.
   (앱이 열리지 않으면 화면에 표시된 8자 코드를 앱 첫 화면에 입력합니다. MCP 주소를 앱에 붙여넣을 필요는 없습니다.)
4. PC 앱에서 네이버 로그인을 합니다.

OpenAI API 키는 선택 사항이며 ChatGPT 구독과 별개입니다. 없으면 로컬 초안 모드로 동작하지만 글·썸네일 품질이 낮아집니다.

ChatGPT 커넥터는 OAuth 고정 주소(`/api/mcp`)로도 연결할 수 있습니다(대시보드 안내 참고). 두 방식 모두 같은 도구를 제공합니다.

초안은 기본적으로 PC 가 OpenAI API 키로 Spec-first 파이프라인(이미지 플랜 → 구조화 생성 → 검증·수리)을 돌려 만듭니다.
PC 에 API 키가 없으면 `post_prepare_draft → (ChatGPT 가 원고 작성) → post_submit_draft` 2단계 경로로 ChatGPT 대화가 원고를 쓰고 PC 가 검증·패키징합니다.

> ⚠️ API 키는 한 번만 보여주므로 반드시 복사해서 안전한 곳에 저장하세요!

### 3. 네이버 블로그 ID 확인

내 블로그 주소가 `https://blog.naver.com/abc123` 이라면, 블로그 ID는 `abc123` 입니다.

---

## 🚀 설치 방법

### 1단계: 프로젝트 다운로드

**방법 A: Git 사용 (권장)**
```bash
git clone https://github.com/contentscoin/blogautomcp.git
cd blogautomcp
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
# OpenAI API 키 (글 생성·썸네일 생성·QC 모두 OpenAI 사용)
OPENAI_API_KEY=sk-여기에_발급받은_키_붙여넣기

# 설치형 앱은 ChatGPT에 한 번 로그인한 뒤 평소 작업을 백그라운드에서 실행
CHATGPT_BROWSER_AUTOMATION_ENABLED=true
BROWSER_GPT_MODE=true
ALLOW_CHATGPT_BROWSER_MODE=true
CHATGPT_BROWSER_VISIBILITY=background
CHATGPT_USE_CUSTOM_GPTS=false
CHATGPT_DIRECT_ONLY=true
BLOG_HUMANIZE_MOBILE_STYLE=true
# 본문은 AI 생성 원고 또는 사용자가 승인한 준비 원고만 발행합니다.
# AI 실패 시 하네스 문장을 복사한 로컬 원고로 대체하지 않습니다.
PRODUCT_THUMBNAIL_CHATGPT_ENABLED=false
BRANDCONNECT_SELECTION_PROFILE=seasonal-hit-popular

# 일괄 작업 완료/오류 알림
CHATBOT_NOTIFY_COMPLETION=true
CHATBOT_NOTIFY_SINGLE=false
CHATBOT_MESSAGE_LINK_LIMIT=100
CHATBOT_COMPLETION_BASE_URL=http://127.0.0.1:3000
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# 네이버 블로그 ID
NAVER_BLOG_ID=내_블로그_아이디

# 데이터베이스 (수정 불필요)
DATABASE_URL="file:./dev.db"
```

> `TELEGRAM_CHAT_ID`를 비워두면 봇의 최근 대화에서 자동으로 찾습니다. 먼저 텔레그램에서 해당 봇에게 아무 메시지나 한 번 보내두세요.

> 💡 주제글/이미지 발행 파이프라인은 GPT만 사용합니다.

### 3. 운영 보안 설정 (권장)

관리자 키를 설정하면 쓰기 API(발행/수정/삭제/리뷰생성/스케줄)가 보호됩니다.

```env
ADMIN_API_KEY="랜덤한_긴_문자열"
CRON_SECRET="랜덤한_긴_문자열"
```

- `ADMIN_API_KEY`: 설정하면 모든 관리자 API(발행/설정/중지/썸네일 등)가 실제 자격 증명을 요구합니다. 외부 스크립트는 `x-admin-api-key` 헤더를 붙이고, 브라우저 대시보드는 첫 화면에서 키를 한 번 입력해 HttpOnly 세션 쿠키를 받습니다(데스크톱 앱은 자동으로 헤더를 붙입니다). `Origin`/`Referer` 같은 출처 헤더만으로는 통과하지 않습니다.
- `CRON_SECRET`: `/api/schedule/cron` 호출 시 `x-cron-secret` 또는 `Authorization: Bearer ...` 필요
- 키를 비워 두면(기본 로컬 사용) 종전처럼 인증 없이 동작합니다.

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

### Step 1: PC 앱 연결 (사이트 버튼 한 번)

앱을 설치·실행한 뒤 사이트 대시보드에서 **PC 앱 연결**을 누릅니다. 앱이 자동으로 열리며
이 PC가 계정에 연결됩니다. 연결되기 전에는 대시보드와 자동화 API가 잠겨 있습니다.
앱이 자동으로 열리지 않으면 사이트에 표시된 8자 코드를 앱 첫 화면의 "코드로 연결"에 입력합니다.
ChatGPT 쪽에는 MCP 주소를 커넥터 설정에 한 번만 등록하면 되고, 앱에는 붙여넣지 않습니다.

### Step 1-2: 네이버 로그인

활성화 후 설정 화면에서 **네이버 로그인**을 누릅니다. 개발 환경에서는 아래 명령도 사용할 수 있습니다.

```bash
npm run login
```

1. 브라우저가 자동으로 열립니다
2. 네이버에 로그인하세요 (2단계 인증 포함)
3. 로그인 완료 후 자동으로 세션이 저장됩니다

> 💡 세션은 보통 7~30일간 유지됩니다. 발행 실패 시 다시 로그인하세요.

### 로컬 AI 작성 설정

- 설치형 앱은 ChatGPT 브라우저 로그인과 Custom GPT 조작을 강제로 끕니다.
- OpenAI API가 실패하거나 키가 없으면 Spec-first 로컬 템플릿 초안으로 대체하고 검증 리포트에 NEEDS_REVIEW 로 표시합니다.
- ChatGPT MCP 2단계 초안은 `상품 근거 준비(post_prepare_draft) → ChatGPT 원고 생성 → PC 검증·패키징(post_submit_draft)` 순서로 처리하며 API 키가 필요하지 않습니다.
- 초안 미리보기의 `이미지` 탭에서 각 결과를 확인하고, 필수 슬롯 자동 보충·파트별 추가·개별 재생성을 실행할 수 있습니다. 쇼핑 이미지는 원본 상품을 다시 그리지 않고 잠금 합성하며, 안전한 분리가 불가능하면 수집 원본을 유지합니다.
- 이미지 수는 쇼핑 `최소 5/권장 8`, 여행 `최소 7/권장 10`으로 검사합니다. `품질검사` 탭은 확인 안내 반복·상품 고유 장단점 부족·허위 체험 표현을 별도로 검사하고 자동 보강 결과를 표시합니다.
- 사람형 모바일 문체는 기본으로 켜져 있습니다 (`BLOG_HUMANIZE_MOBILE_STYLE=true`).
- 문장은 짧게 끊고, AI처럼 보이는 반복 표현/과한 광고 문구/허위 체험 단정을 줄입니다.
- 상품 리뷰 글은 발행 전 상품명 반영, 본문 분량, 고지문, URL 직접 노출, 허위 체험 단정, 수수료율 노출, 판매페이지 대표 이미지 확보 여부를 검사합니다.
  필요 시 `BRANDLINK_CONTENT_READINESS_ENABLED=false`로 게이트를 끄거나 `BRANDLINK_REQUIRE_REPRESENTATIVE_IMAGE=false`로 대표 이미지 필수 조건만 완화할 수 있습니다.
- 주제글 AI 이미지 생성은 API 방식(`TOPIC_PIPELINE_DAEDAL_ENABLED=true`와 `OPENAI_API_KEY`)이나 준비된 이미지 자산을 사용합니다.
- 주제글 prepare 단계는 `TOPIC_AUTO_RESEARCH_ENABLED=true`일 때 입력 주제/키워드로 참고 URL을 자동 탐색합니다. `NAVER_SEARCH_CLIENT_ID`/`NAVER_SEARCH_CLIENT_SECRET`이 있으면 네이버 검색 OpenAPI를 먼저 쓰고, 없으면 DuckDuckGo HTML 검색을 best-effort로 사용합니다.
- 준비된 주제글은 발행 전에 도입부, 하이라이트, 섹션 구조, 본문 자연스러움, 이미지 확보 상태와 함께 SEO 키워드 커버리지를 검사합니다. 명시 키워드가 본문/제목/태그에 거의 반영되지 않으면 재준비가 필요합니다.

### Step 2: 웹 대시보드 실행

```bash
npm run dev
```

브라우저에서 **http://localhost:3000** 접속

### Step 2-2: 데스크톱 앱(권장, macOS/Windows 용)

```bash
npm run desktop
```

- 앱 실행 시 데스크톱 전용 로컬 포트 `43127`에서 Next.js 서버를 자동으로 시작
- macOS: `BrandConnect Automation.app` 실행
- Windows: 설치 후 `.exe` 실행

또는 더블클릭 실행:

- macOS: `scripts/desktop.command`
- Windows: `scripts/desktop.bat`

#### 데스크톱 앱 빌드

```bash
npm run desktop:pack:mac   # macOS dmg 생성 (mac)
npm run desktop:pack:win   # Windows 인스톨러 생성 (Windows)
npm run desktop:pack       # 현재 OS 패키지 모두 생성
```

※ `desktop:pack:mac`/`desktop:pack:win`은 각각 macOS/Windows 환경에서 실행할 때만 빌드됩니다.
※ 패키지 생성 전 `npm run build`가 먼저 실행되어야 하며, 빌드된 `.next`를 기반으로 동작합니다.

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
- 설정된 AI API 또는 로컬 생성기가 리뷰 글 작성
- 이미지 업로드 + 글 작성
- 자동 발행 완료!

---

## 🔧 명령어 모음

| 명령어 | 설명 |
|--------|------|
| `npm run login` | 네이버 로그인 (세션 저장) |
| `npm run dev` | 웹 대시보드 실행 (localhost:3000) |
| `npm run brandconnect:seasonal` | 시즌·히트·인기·판매 신호 우선 상품 자동 등록 |
| `npm run publish:bulk-schedule` | READY 브랜드커넥트 링크 예약발행 일괄 실행 |
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

### Q: "ChatGPT에 연결했는데 로컬 PC가 움직이지 않아요"
**A:** ChatGPT 로그인만으로는 로컬 프로그램이 연결되지 않습니다. 사이트 대시보드의 "로컬 PC"가
온라인인지 확인하세요. 미연결이면 대시보드에서 **PC 앱 연결**을 다시 누르고, 앱이 실행 중인지
확인합니다. MCP 주소를 재발급했다면 PC 인증도 함께 폐기되므로 PC 앱 연결을 다시 해야 합니다.

### Q: "OpenAI API 오류가 나요"
**A:** 
- ChatGPT MCP에서 초안을 요청했다면 별도 API 키가 필요하지 않습니다. 앱을 최신 버전으로 업데이트한 뒤 ChatGPT에서 다시 요청하세요.
- 데스크톱의 단독 초안 버튼을 사용한다면 API 키, API 계정 크레딧, `.env` 또는 설정 저장 상태를 확인하세요.

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

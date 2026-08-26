---
name: naver-bc-automation
description: "Executes an agentic 5-stage pipeline (Topic Agent V2: Research/Outline -> Focused Drafting -> Human Mobile Polishing -> Visual Matching -> Publishing) to automatically generate, optimize, and publish natural mobile-first SEO content with images to Naver Blog using the standard ChatGPT page or configured AI fallback. Use when the user asks to create a blog post, write on Naver Blog, or schedule a post by topic."
---

# Naver Blog Posting Automation (인간 지능 모방형 5단계 파이프라인 - Topic Agent V2)

## Overview
이 스킬은 단순한 API 호출을 넘어, **일반 ChatGPT direct 입력 흐름**과 **고품질 이미지 수급/생성**을 결합하여 실제 모바일 블로거가 글을 쓰는 과정을 모방한 5단계 파이프라인을 실행합니다.

## 에이전틱 5단계 파이프라인 (Topic Agent V2)

작업 수행 시, 내부적으로 다음 5단계의 고도화 파이프라인이 자동 실행됩니다.
1. **자료조사 및 기획 (Research & Outline)**: 주제/키워드/상품 정보를 바탕으로 검색 의도와 독자 관점을 정리하고, 서론-본론-결론으로 이어지는 상세한 목차와 단락별 핵심 내용을 기획합니다.
2. **단락별 집중 집필 (Focused Drafting)**: 한 번에 전체 글을 쓰지 않고, 목차별로 루프를 돌며 각 단락(서론, 본론1, 본론2...)을 500자 이상 깊이 있게 나누어 작성하여 퀄리티와 분량을 확보합니다.
3. **사람형 모바일 윤문 (Human Mobile Polishing)**: 분할 작성된 초안을 합친 뒤, 문장을 짧게 치고 잦은 줄바꿈을 넣어 모바일에서 편하게 읽히도록 다듬습니다. AI처럼 보이는 반복 표현, 과한 광고 문구, 허위 체험 단정은 제거합니다.
4. **고품질 시각 자료 수급 (Visual Matching)**: 단락별 문맥을 분석하여 감성적인 영어 검색어(예: `golf course aesthetic`)를 추출하고, Unsplash 등에서 전문 포토그래퍼의 고해상도 스탁 이미지를 다운로드합니다.
5. **최종 조립 및 발행 (Publishing)**: 네이버 블로그 에디터를 열고 완성된 텍스트와 이미지를 교차로 삽입한 뒤 해시태그를 달아 최종 발행(또는 예약)합니다.

상품 리뷰 발행 흐름에서는 Custom GPTs를 명시적으로 켠 경우가 아니면 ChatGPT의 별도 Polish GPT를 띄우지 않습니다. 초안 생성 이후에는 로컬 사람형 모바일 윤문 레이어(`HUMAN_MOBILE_POLISH_ENABLED=true`)가 문장 줄바꿈, 반복 표현 제거, 모바일 배치를 담당합니다.

## Instructions (실행 방법)

사용자가 블로그 포스팅을 요청하면 다음 단계에 따라 명령어를 실행하세요.

### 1. 파라미터 수집
사용자 요청에서 다음 정보를 파악하세요.
- `topic` (필수): 포스팅할 핵심 주제 (예: "다낭 골프 여행", "에어젯 울트라 드라이기")
- `type` (선택, 기본값 `travel`): 카테고리 (지원: `travel`, `golf`, `knowledge`)
- `keywords` (선택): SEO를 위한 추가 키워드 콤마 분리 (예: "다낭,골프,여행")
- `publishMode` (선택, 기본값 `now`): 발행 방식 (`now`, `schedule`, `save`)
- `scheduledDate` (선택): 예약 발행 시 날짜 및 시간 (형식: `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:MM`)

### 2. 명령어 실행
파악된 파라미터를 바탕으로 터미널에서 다음 npm 스크립트를 실행합니다.

**기본 실행 예시 (즉시 발행):**
```bash
npm run topic -- --type="golf" --topic="타이틀리스트 골프공" --keywords="타이틀리스트,골프공추천" --publishMode="now"
```

**예약 발행 예시:**
```bash
npm run topic -- --type="travel" --topic="다낭 골프 여행" --keywords="다낭,골프,가성비" --publishMode="schedule" --scheduledDate="2026-03-05"
```

### 3. 모니터링 및 완료 보고
1. 터미널에서 명령어 실행 후, 브라우저가 열리며 5단계 파이프라인(ChatGPT direct 입력 및 이미지 수급)이 진행되는 과정을 모니터링합니다. (작업 시간이 3~5분 정도 소요될 수 있습니다.)
2. 실행이 완료되면 사용자에게 성공 여부와 함께 기획된 제목, 생성된 단락 수, 해시태그 수, 삽입된 이미지 개수를 요약하여 보고합니다.

## Trouble Shooting (문제 해결)
- **ChatGPT 로그인 세션 만료**: 브라우저 창이 열렸을 때 ChatGPT 로그인이 풀려있다면 사용자가 수동으로 로그인해야 합니다. 기본 작성 흐름은 Custom GPTs가 아니라 일반 ChatGPT 페이지에 전체 프롬프트를 한 번에 넣는 방식입니다.
- **Unsplash 이미지 다운로드 실패**: API 키가 없어도 자동으로 웹 스크래핑(Fallback)을 시도하며, 이조차 실패하면 빈 이미지를 생성하여 포스팅 프로세스가 멈추지 않도록 안전하게 설계되어 있습니다.
- **브라우저 종료 에러**: 모델 응답 지연 등 문제일 수 있습니다. 터미널 출력을 확인하고 재실행을 안내하세요.

## Examples

**사용자 요청:** "내일 오전 10시로 제주도 한달 살기 관련해서 지식 카테고리에 예약 포스팅해줘. 키워드는 '제주도,한달살기,비용'으로 해줘. ChatGPT는 로그인 된 상태로 진행해."
**에이전트 실행:**
```bash
npm run topic -- --type="knowledge" --topic="제주도 한달 살기" --keywords="제주도,한달살기,비용" --publishMode="schedule" --scheduledDate="2026-02-23T10:00"
```

---
name: naver-bc-automation
description: "Executes an agentic 4-stage pipeline (Planning, Drafting, Editing/Mobile Optimization, Visual Directing) to automatically generate, optimize, and publish high-quality SEO content with AI images to Naver Blog. Use when the user asks to create a blog post, write on Naver Blog, or schedule a post by topic."
---

# Naver Blog Posting Automation (에이전틱 4단계 파이프라인)

## Overview
이 스킬은 주어진 주제와 키워드만으로 **네이버 블로그에 최적화된 고품질 콘텐츠를 생성하고, AI 이미지를 수집/생성하여 자동으로 포스팅(또는 예약 포스팅)**까지 진행하는 에이전틱 4단계 파이프라인을 실행합니다.

## 에이전틱 4단계 파이프라인

작업 수행 시, 내부적으로 다음 4단계의 고도화 파이프라인이 자동 실행됩니다.
1. **기획 (Planner)**: 주제와 키워드를 분석하여 독자의 이목을 끄는 블로그 포스팅 기획안(스토리라인, 소주제 구조)을 수립합니다.
2. **초안 작성 (Drafter)**: 기획안을 바탕으로 각 소주제에 해당하는 세부 본문 초안을 정보의 나열이 아닌 스토리텔링 방식으로 작성합니다.
3. **편집 및 모바일 최적화 (Editor)**: 모바일 가독성을 위해 문장을 짧게(50자 이내) 다듬고 잦은 줄바꿈을 적용하며, 친근한 어조와 적절한 이모지를 추가합니다. (물결표 금지 등 네이버 에디터 특성 반영)
4. **비주얼 디렉팅 (Visual Director)**: 각 단락 문맥에 맞는 전문적인 AI 이미지 프롬프트(`falai/flux-dev-lora` 등)를 기획하고 텍스트 없는 고품질/실사 이미지를 자동 생성하여 본문 사이사이에 적절히 배치합니다.

## Instructions (실행 방법)

사용자가 블로그 포스팅을 요청하면 다음 단계에 따라 명령어를 실행하세요.

### 1. 파라미터 수집
사용자 요청에서 다음 정보를 파악하세요.
- `topic` (필수): 포스팅할 핵심 주제 (예: "다낭 골프 여행", "에어젯 울트라 드라이기")
- `type` (선택, 기본값 `travel`): 카테고리 (지원: `travel`, `golf`, `knowledge`)
- `keywords` (선택): SEO를 위한 추가 키워드 콤마 분리 (예: "다낭,골프,여행")
- `publishMode` (선택, 기본값 `schedule`): 발행 방식 (`now`, `schedule`, `draft`)
- `scheduledDate` (선택): 예약 발행 시 날짜 및 시간 (형식: `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:MM`)

### 2. 명령어 실행
파악된 파라미터를 바탕으로 터미널에서 다음 npm 스크립트를 실행합니다.

**기본 실행 예시 (예약 발행):**
```bash
npm run topic -- --type="travel" --topic="다낭 골프 여행" --keywords="다낭,골프,가성비" --publishMode="schedule" --scheduledDate="2026-03-05"
```

**즉시 발행 예시:**
```bash
npm run topic -- --type="golf" --topic="파인밸리CC 라운딩 후기" --publishMode="now"
```

### 3. 모니터링 및 완료 보고
1. 터미널에서 명령어 실행 후, 4단계 파이프라인 진행 상태와 AI 이미지 수집/생성 과정, 그리고 Playwright 브라우저 자동화 완료 여부를 모니터링합니다.
2. 실행이 완료되면 사용자에게 성공 여부와 함께 기획된 제목, 생성된 단락 수, 해시태그 수, 삽입된 이미지 개수를 요약하여 보고합니다.

## Trouble Shooting (문제 해결)
- **이미지 생성 실패 (Authentication required)**: `infsh` 인증 만료 시 발생할 수 있습니다. 사용자에게 터미널에서 `infsh login`을 실행하도록 안내하세요. (단, 이 경우에도 Pollinations AI나 무료 스톡 이미지로 대체(Fallback) 수집되므로 포스팅 자체는 멈추지 않습니다.)
- **예약 날짜 오류**: `scheduledDate`가 과거이거나 형식이 맞지 않으면 발행에 실패할 수 있습니다. 올바른 형식(`YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:MM`)인지 확인하세요.
- **브라우저 종료 에러**: Playwright 세션이나 모델 응답 지연 등 문제일 수 있습니다. 재실행을 안내하세요.

## Examples

**사용자 요청:** "내일 오전 10시로 제주도 한달 살기 관련해서 지식 카테고리에 예약 포스팅해줘. 키워드는 '제주도,한달살기,비용'으로 해줘."
**에이전트 실행:**
```bash
npm run topic -- --type="knowledge" --topic="제주도 한달 살기" --keywords="제주도,한달살기,비용" --publishMode="schedule" --scheduledDate="2026-02-23T10:00"
```
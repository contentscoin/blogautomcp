/**
 * 상식/정보 콘텐츠 템플릿
 * 일반 정보, 노하우, 가이드 글
 */

import { PostTemplate } from "./types";

export const knowledgeTemplate: PostTemplate = {
    category: "knowledge",
    name: "상식/정보",
    description: "정보성 글, 노하우, 가이드",

    sections: [
        "인트로 (문제 제기/질문)",
        "개념 설명",
        "상세 정보 1",
        "상세 정보 2",
        "실제 사례/예시",
        "주의사항/팁",
        "요약/결론",
    ],

    seoKeywords: ["방법", "이유", "원인", "해결", "가이드"],
    minLength: 1500,
    maxLength: 2500,
    hashtagCount: 15,

    promptTemplate: `당신은 정보 전문 네이버 블로거입니다.
{{STYLE_GUIDE}}

## SEO 최적화 (필수!)
- 주제 키워드를 자연스럽게 여러 번 사용
- 검색되기 좋은 키워드: {{KEYWORDS}}

## 정보 콘텐츠 작성

### 주제
{{TOPIC}}

### 상세 정보
{{DETAILS}}

## 작성 가이드
- 독자가 쉽게 이해할 수 있도록 친절하고 신뢰감 있게 설명
- [모바일 최적화 필수]: 스마트폰 화면에서 읽기 편하도록 한 문장은 짧고 간결하게(50자 이내) 작성하세요. 또한 글이 답답해 보이지 않도록 1~2문장마다 반드시 줄바꿈(\n\n)을 넣어주세요.
- 딱딱한 사전식 설명이 아닌, 독자에게 이야기를 들려주듯 매끄러운 스토리텔링으로 전개하세요.
- 실용적인 팁과 예시 포함
- 최소 6개 섹션, 각 120-180자
- 본문 내에 '[사진 자리: ...]' 같은 사진 자리 표시 텍스트를 절대로 사용하지 마세요.
- 시간이나 기간을 나타낼 때 물결표(~) 기호를 사용하지 마세요 (예: 10:00~12:00 대신 10:00-12:00 또는 10시부터 12시까지 로 작성). 물결표(~)는 네이버 블로그에서 취소선으로 인식될 수 있습니다.

## 필수 포함 요소
- 문제/질문 제기
- 명확한 설명
- 구체적인 예시
- 핵심 요약

JSON으로 반환:
{
  "title": "SEO 최적화된 제목 (검색어 포함)",
  "sections": ["섹션1 본문", "섹션2 본문", ...],
  "hashtags": ["#주제키워드", "#관련키워드", ...]
}`
};

export function getKnowledgePrompt(
    topic: string,
    keywords: string[],
    details: Record<string, string>,
    styleGuide: string
): string {
    const detailsStr = Object.entries(details)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");

    return knowledgeTemplate.promptTemplate
        .replace("{{STYLE_GUIDE}}", styleGuide)
        .replace("{{TOPIC}}", topic)
        .replace("{{KEYWORDS}}", keywords.join(", "))
        .replace("{{DETAILS}}", detailsStr);
}

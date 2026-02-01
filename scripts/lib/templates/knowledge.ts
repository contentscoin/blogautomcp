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
- 독자가 쉽게 이해할 수 있도록 설명
- 신뢰할 수 있는 정보 제공
- 실용적인 팁과 예시 포함
- 최소 6개 섹션, 각 120-180자

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

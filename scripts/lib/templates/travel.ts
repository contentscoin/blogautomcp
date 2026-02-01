/**
 * 여행 콘텐츠 템플릿
 * 여행지 소개, 투어 패키지 리뷰, 여행 경험 공유
 */

import { PostTemplate } from "./types";

export const travelTemplate: PostTemplate = {
    category: "travel",
    name: "여행",
    description: "여행지 소개, 투어 패키지 리뷰",

    sections: [
        "인트로 (여행 계기/동기)",
        "여행지 소개",
        "일정/코스 소개",
        "숙소 리뷰",
        "맛집/음식",
        "관광지 1",
        "관광지 2",
        "여행 꿀팁",
        "비용 정보",
        "마무리 (총평/추천)",
    ],

    seoKeywords: ["여행", "투어", "코스", "맛집", "숙소", "추천"],
    minLength: 2500,
    maxLength: 4000,
    hashtagCount: 20,

    promptTemplate: `당신은 여행 전문 네이버 블로거입니다.
{{STYLE_GUIDE}}

## SEO 최적화 (필수!)
- 여행지명, 관광지명, 맛집명을 자연스럽게 여러 번 언급
- 검색되기 좋은 키워드: {{KEYWORDS}}

## 여행 콘텐츠 작성

### 주제
{{TOPIC}}

### 상세 정보
{{DETAILS}}

## 작성 가이드
- 독자가 여행을 계획할 수 있도록 실용적인 정보 제공
- 개인적인 경험과 느낌을 진솔하게 공유
- 사진이 들어갈 자리마다 관련 설명 작성
- 최소 8개 섹션, 각 150-250자

## 필수 포함 정보
- 위치/접근성
- 영업시간/가격
- 추천 코스
- 꿀팁

JSON으로 반환:
{
  "title": "SEO 최적화된 제목 (여행지명 포함)",
  "sections": ["섹션1 본문", "섹션2 본문", ...],
  "hashtags": ["#여행지명", "#여행지역", ...]
}`
};

export function getTravelPrompt(
    topic: string,
    keywords: string[],
    details: Record<string, string>,
    styleGuide: string
): string {
    const detailsStr = Object.entries(details)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");

    return travelTemplate.promptTemplate
        .replace("{{STYLE_GUIDE}}", styleGuide)
        .replace("{{TOPIC}}", topic)
        .replace("{{KEYWORDS}}", keywords.join(", "))
        .replace("{{DETAILS}}", detailsStr);
}

/**
 * 골프 콘텐츠 템플릿
 * 골프장 리뷰, 골프 투어, 장비 리뷰
 */

import { PostTemplate } from "./types";

export const golfTemplate: PostTemplate = {
    category: "golf",
    name: "골프",
    description: "골프장 리뷰, 골프 투어, 장비 소개",

    sections: [
        "인트로 (방문 계기)",
        "골프장/장소 소개",
        "코스 분석",
        "홀별 특징 (대표 홀)",
        "그린/페어웨이 상태",
        "부대시설",
        "식사/맛집",
        "예약/가격 정보",
        "마무리 (총평/추천)",
    ],

    seoKeywords: ["골프", "골프장", "그린피", "코스", "라운드"],
    minLength: 2000,
    maxLength: 3500,
    hashtagCount: 20,

    promptTemplate: `당신은 골프 전문 네이버 블로거입니다.
{{STYLE_GUIDE}}

## SEO 최적화 (필수!)
- 골프장명, 지역명을 자연스럽게 여러 번 언급
- 검색되기 좋은 키워드: {{KEYWORDS}}

## 골프 콘텐츠 작성

### 주제
{{TOPIC}}

### 상세 정보
{{DETAILS}}

## 작성 가이드
- 골퍼들이 참고할 수 있는 실용적인 정보 제공
- 코스 난이도, 그린 상태 등 전문적인 내용 포함
- 개인적인 플레이 경험 공유
- 최소 8개 섹션, 각 150-200자

## 필수 포함 정보
- 위치/접근성
- 그린피/예약 방법
- 코스 특징
- 부대시설
- 꿀팁

JSON으로 반환:
{
  "title": "SEO 최적화된 제목 (골프장명 포함)",
  "sections": ["섹션1 본문", "섹션2 본문", ...],
  "hashtags": ["#골프장명", "#지역골프", ...]
}`
};

export function getGolfPrompt(
    topic: string,
    keywords: string[],
    details: Record<string, string>,
    styleGuide: string
): string {
    const detailsStr = Object.entries(details)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");

    return golfTemplate.promptTemplate
        .replace("{{STYLE_GUIDE}}", styleGuide)
        .replace("{{TOPIC}}", topic)
        .replace("{{KEYWORDS}}", keywords.join(", "))
        .replace("{{DETAILS}}", detailsStr);
}

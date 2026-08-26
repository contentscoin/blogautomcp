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
- 단순한 정보 나열을 피하고, 라운드 당일의 흐름과 현장감이 담긴 하나의 매끄러운 '스토리'가 되도록 글을 전개해주세요.
- [모바일 최적화 필수]: 스마트폰 화면에서 읽기 편하도록 한 문장은 25-45자 안팎으로 짧게 작성하세요. 또한 글이 답답해 보이지 않도록 1-2문장마다 반드시 줄바꿈(\n\n)을 넣어주세요.
- 휴대폰으로 직접 작성한 블로그 글처럼 부드러운 ~요체로 작성하세요.
- "결론적으로", "종합적으로", "본 포스팅에서는"처럼 AI 글처럼 보이는 표현은 쓰지 마세요.
- 코스 난이도, 그린 상태 등 전문적인 내용 포함
- 개인적인 플레이 경험은 제공된 정보 안에서만 진솔하게 표현하고, 과한 이모지는 줄이세요.
- 최소 8개 섹션, 각 150-200자
- 본문 내에 '[사진 자리: ...]' 같은 사진 자리 표시 텍스트를 절대로 사용하지 마세요.
- 시간이나 기간을 나타낼 때 물결표(~) 기호를 사용하지 마세요 (예: 10:00~12:00 대신 10:00-12:00 또는 10시부터 12시까지 로 작성). 물결표(~)는 네이버 블로그에서 취소선으로 인식될 수 있습니다.

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

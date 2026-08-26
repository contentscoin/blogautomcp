/**
 * 상품 리뷰 템플릿 (현재 기본 동작)
 * 브랜드커넥트 상품 URL을 받아 리뷰 글을 작성합니다.
 */

import { PostTemplate } from "./types";

export const productReviewTemplate: PostTemplate = {
    category: "product",
    name: "상품 리뷰",
    description: "브랜드커넥트/스마트스토어 상품 리뷰",

    sections: [
        "인트로 (구매 계기)",
        "상품 소개",
        "가격/혜택 정보",
        "상세 리뷰 1 (외관/디자인)",
        "상세 리뷰 2 (기능/성능)",
        "상세 리뷰 3 (사용 경험)",
        "장단점",
        "마무리 (추천 의견)",
    ],

    seoKeywords: ["리뷰", "후기", "추천", "구매", "가성비"],
    minLength: 1500,
    maxLength: 3000,
    hashtagCount: 15,

    promptTemplate: `당신은 인기 네이버 블로거입니다.
{{STYLE_GUIDE}}

## SEO 최적화 가이드 (필수!)
- SEO를 위해 상품명, 관련 키워드를 자연스럽게 본문에 포함

다음 상품의 상세 블로그 리뷰를 작성해주세요.

## 상품 정보
{{PRODUCT_INFO}}

## 이번 글의 톤
- 시작 분위기: {{RANDOM_INTRO}}
- 마무리 분위기: {{RANDOM_ENDING}}

## 작성 형식
- 최소 {{SECTION_COUNT}}개 섹션으로 구성
- [모바일 최적화 필수]: 스마트폰 화면에서 읽기 편하도록 한 문장은 25-45자 안팎으로 짧게 작성하세요. 또한 글이 답답해 보이지 않도록 1-2문장마다 반드시 줄바꿈(\n\n)을 넣어주세요.
- 휴대폰으로 직접 작성한 블로그 글처럼 부드러운 ~요체로 작성하세요.
- "결론적으로", "종합적으로", "본 포스팅에서는"처럼 AI 글처럼 보이는 표현은 쓰지 마세요.
- 단순한 스펙 나열이 아닌, 구매를 고민하는 사람이 자연스럽게 읽을 수 있는 흐름으로 전개하세요.
- 제공되지 않은 실제 사용 경험, 효과, 배송 경험은 지어내지 말고 상황형 표현으로 작성하세요.
- 각 이미지에 맞는 본문을 작성
- 각 섹션은 충분히 길게 (100-200자)
- 마지막에 해시태그 15-20개
- 본문 내에 '[사진 자리: ...]' 같은 사진 자리 표시 텍스트를 절대로 사용하지 마세요.
- 시간이나 기간을 나타낼 때 물결표(~) 기호를 사용하지 마세요 (예: 10:00~12:00 대신 10:00-12:00 또는 10시부터 12시까지 로 작성). 물결표(~)는 네이버 블로그에서 취소선으로 인식될 수 있습니다.

JSON으로 반환:
{
  "title": "SEO 최적화된 제목 (상품명 포함)",
  "sections": ["섹션1 본문", "섹션2 본문", ...],
  "hashtags": ["#해시태그1", "#해시태그2", ...]
}`
};

export function getProductPrompt(
    productInfo: string,
    styleGuide: string,
    sectionCount: number,
    randomIntro: string,
    randomEnding: string
): string {
    return productReviewTemplate.promptTemplate
        .replace("{{STYLE_GUIDE}}", styleGuide)
        .replace("{{PRODUCT_INFO}}", productInfo)
        .replace("{{SECTION_COUNT}}", sectionCount.toString())
        .replace("{{RANDOM_INTRO}}", randomIntro)
        .replace("{{RANDOM_ENDING}}", randomEnding);
}

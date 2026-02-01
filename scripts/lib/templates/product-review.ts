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
- 각 이미지에 맞는 본문을 작성
- 각 섹션은 충분히 길게 (100-200자)
- 마지막에 해시태그 15-20개

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

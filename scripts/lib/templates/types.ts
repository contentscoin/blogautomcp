/**
 * 포스팅 템플릿 타입 정의
 * 각 카테고리별로 다른 프롬프트와 구조를 가집니다.
 */

export type PostCategory = "product" | "travel" | "golf" | "knowledge";

export interface PostTemplate {
    category: PostCategory;
    name: string;
    description: string;
    sections: string[];           // 필수 섹션 목록
    seoKeywords: string[];        // 카테고리 기본 키워드
    minLength: number;            // 최소 글 길이 (자)
    maxLength: number;            // 최대 글 길이 (자)
    hashtagCount: number;         // 권장 해시태그 수
    promptTemplate: string;       // 프롬프트 템플릿
}

export interface PostInput {
    category: PostCategory;
    // 상품 리뷰용
    productUrl?: string;
    // 여행/골프/상식용
    topic?: string;
    keywords?: string[];
    details?: Record<string, string>;
}

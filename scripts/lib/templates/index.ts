/**
 * 템플릿 모듈 인덱스
 * 모든 템플릿을 내보내고 카테고리별 선택 함수 제공
 */

export * from "./types";
export * from "./product-review";
export * from "./travel";
export * from "./golf";
export * from "./knowledge";

import { PostCategory, PostTemplate } from "./types";
import { productReviewTemplate, getProductPrompt } from "./product-review";
import { travelTemplate, getTravelPrompt } from "./travel";
import { golfTemplate, getGolfPrompt } from "./golf";
import { knowledgeTemplate, getKnowledgePrompt } from "./knowledge";

// 카테고리별 템플릿 맵
export const templates: Record<PostCategory, PostTemplate> = {
    product: productReviewTemplate,
    travel: travelTemplate,
    golf: golfTemplate,
    knowledge: knowledgeTemplate,
};

// 카테고리 이름 맵 (한글)
export const categoryNames: Record<PostCategory, string> = {
    product: "상품 리뷰",
    travel: "여행",
    golf: "골프",
    knowledge: "상식/정보",
};

/**
 * 카테고리에 맞는 템플릿 가져오기
 */
export function getTemplate(category: PostCategory): PostTemplate {
    return templates[category];
}

/**
 * 카테고리에 맞는 프롬프트 생성
 */
export function generatePrompt(
    category: PostCategory,
    options: {
        styleGuide: string;
        // 상품 리뷰용
        productInfo?: string;
        sectionCount?: number;
        randomIntro?: string;
        randomEnding?: string;
        // 여행/골프/상식용
        topic?: string;
        keywords?: string[];
        details?: Record<string, string>;
    }
): string {
    switch (category) {
        case "product":
            return getProductPrompt(
                options.productInfo || "",
                options.styleGuide,
                options.sectionCount || 8,
                options.randomIntro || "",
                options.randomEnding || ""
            );
        case "travel":
            return getTravelPrompt(
                options.topic || "",
                options.keywords || [],
                options.details || {},
                options.styleGuide
            );
        case "golf":
            return getGolfPrompt(
                options.topic || "",
                options.keywords || [],
                options.details || {},
                options.styleGuide
            );
        case "knowledge":
            return getKnowledgePrompt(
                options.topic || "",
                options.keywords || [],
                options.details || {},
                options.styleGuide
            );
        default:
            throw new Error(`Unknown category: ${category}`);
    }
}

/**
 * CLI에서 카테고리 타입 추출
 */
export function getTypeFromArgs(): PostCategory | undefined {
    const typeArg = process.argv.find(arg => arg.startsWith("--type="));
    if (!typeArg) return undefined;

    const type = typeArg.split("=")[1] as PostCategory;
    if (!templates[type]) {
        console.log(`⚠️ 알 수 없는 타입: ${type}`);
        console.log(`   가능한 타입: ${Object.keys(templates).join(", ")}`);
        return undefined;
    }

    return type;
}

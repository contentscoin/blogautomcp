/**
 * SEO 키워드 자동 추천
 * V4 Phase 8: 네이버 자동완성/연관검색어 기반
 */

import { createTaskLogger } from "./logger";
import { safeExecute } from "./retry";

const log = createTaskLogger("SEO");

interface KeywordSuggestion {
    keyword: string;
    source: "autocomplete" | "related" | "template" | "trend";
    score?: number;
}

/**
 * 네이버 자동완성 키워드 가져오기
 */
export async function getNaverAutocomplete(query: string): Promise<string[]> {
    return safeExecute(
        async () => {
            const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(query)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            try {
                const response = await fetch(url, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    signal: controller.signal,
                });
                const data: unknown = await response.json();
                const items =
                    typeof data === "object" && data !== null
                        ? (data as { items?: unknown }).items
                        : undefined;
                const suggestions = Array.isArray(items) && Array.isArray(items[0]) ? items[0] : [];

                log.info(`자동완성 ${suggestions.length}개 수집`, { query });
                return suggestions.flatMap((item: unknown) =>
                    Array.isArray(item) && typeof item[0] === "string" ? [item[0]] : []
                );
            } finally {
                clearTimeout(timeout);
            }
        },
        [],
        (error) => log.warn(`자동완성 실패`, { error: error.message })
    );
}

/**
 * 카테고리별 기본 SEO 키워드
 */
export function getDefaultKeywords(type: "travel" | "golf" | "knowledge"): string[] {
    const keywordMap = {
        travel: [
            "여행", "관광", "맛집", "숙소", "추천",
            "후기", "일정", "코스", "비용", "팁"
        ],
        golf: [
            "골프장", "라운딩", "그린피", "코스",
            "후기", "예약", "골프여행", "CC", "부킹"
        ],
        knowledge: [
            "방법", "하는법", "정리", "꿀팁", "비교",
            "추천", "순위", "가이드", "총정리"
        ]
    };

    return keywordMap[type];
}

/**
 * 키워드 조합 생성
 */
export function generateKeywordCombinations(
    topic: string,
    type: "travel" | "golf" | "knowledge"
): string[] {
    const baseKeywords = getDefaultKeywords(type);
    const combinations: string[] = [];

    // 주제 + 기본 키워드 조합
    for (const kw of baseKeywords.slice(0, 5)) {
        combinations.push(`${topic} ${kw}`);
    }

    // 연도 추가 (SEO에 효과적)
    const year = new Date().getFullYear();
    combinations.push(`${topic} ${year}`);
    combinations.push(`${year} ${topic} 추천`);

    return combinations;
}

/**
 * 전체 키워드 추천 생성
 */
export async function generateKeywordSuggestions(
    topic: string,
    type: "travel" | "golf" | "knowledge"
): Promise<KeywordSuggestion[]> {
    log.info(`키워드 추천 시작`, { topic, type });

    const suggestions: KeywordSuggestion[] = [];

    // 1. 템플릿 기본 키워드
    const defaults = getDefaultKeywords(type);
    defaults.forEach(kw => {
        suggestions.push({ keyword: kw, source: "template", score: 70 });
    });

    // 2. 자동완성 키워드
    const autocomplete = await getNaverAutocomplete(topic);
    autocomplete.forEach((kw, i) => {
        suggestions.push({ keyword: kw, source: "autocomplete", score: 100 - i * 5 });
    });

    // 3. 조합 키워드
    const combinations = generateKeywordCombinations(topic, type);
    combinations.forEach(kw => {
        suggestions.push({ keyword: kw, source: "related", score: 80 });
    });

    // 중복 제거 및 정렬
    const uniqueKeywords = [...new Map(
        suggestions.map(s => [s.keyword.toLowerCase(), s])
    ).values()];

    uniqueKeywords.sort((a, b) => (b.score || 0) - (a.score || 0));

    log.info(`키워드 추천 완료: ${uniqueKeywords.length}개`);

    return uniqueKeywords.slice(0, 20);
}

/**
 * 해시태그 생성
 */
export function generateHashtags(keywords: KeywordSuggestion[]): string[] {
    return keywords
        .slice(0, 15)
        .map(k => `#${k.keyword.replace(/\s+/g, "")}`)
        .filter((tag, i, arr) => arr.indexOf(tag) === i);
}

export type { KeywordSuggestion };

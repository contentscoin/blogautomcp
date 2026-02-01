import { NextRequest, NextResponse } from "next/server";

// 카테고리별 인기 키워드 (실제로는 네이버 API 연동 필요)
const TRENDING_KEYWORDS: Record<string, string[]> = {
    place: [
        "가볼만한곳", "데이트코스", "핫플레이스", "인생샷스팟", "주말나들이",
        "힐링여행", "숨은명소", "인스타감성", "포토존", "드라이브코스",
    ],
    food: [
        "맛집추천", "현지인맛집", "웨이팅맛집", "가성비맛집", "분위기좋은맛집",
        "브런치카페", "디저트맛집", "혼밥맛집", "데이트맛집", "파인다이닝",
    ],
    travel: [
        "국내여행", "당일치기여행", "근교여행", "휴양지추천", "호캉스",
        "여행코스", "뚜벅이여행", "자연경관", "펜션추천", "리조트추천",
    ],
    parenting: [
        "아이와가볼만한곳", "키즈카페", "체험학습", "놀이시설", "가족나들이",
        "유아동반", "어린이박물관", "실내놀이터", "자연체험", "교육프로그램",
    ],
    product: [
        "리뷰", "언박싱", "사용후기", "솔직리뷰", "꿀템추천",
        "가성비템", "인생템", "신상품", "할인정보", "쇼핑추천",
    ],
};

// 계절별 연관 키워드
const SEASONAL_KEYWORDS: Record<string, string[]> = {
    spring: ["봄나들이", "벚꽃명소", "봄꽃축제", "피크닉", "봄여행"],
    summer: ["여름휴가", "물놀이", "바다", "계곡", "피서지"],
    autumn: ["가을단풍", "단풍여행", "가을축제", "역사탐방", "산책로"],
    winter: ["겨울여행", "눈꽃축제", "스키장", "온천여행", "년말모임"],
};

// 현재 계절 판단
function getCurrentSeason(): string {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
}

// 키워드 조합 생성
function generateKeywordCombinations(
    category: string,
    location: string,
    baseKeyword: string
): string[] {
    const combinations: string[] = [];
    const categoryKeywords = TRENDING_KEYWORDS[category] || TRENDING_KEYWORDS.place;
    const season = getCurrentSeason();
    const seasonalKeywords = SEASONAL_KEYWORDS[season] || [];

    // 지역 + 키워드 조합
    if (location) {
        categoryKeywords.slice(0, 5).forEach((kw) => {
            combinations.push(`${location} ${kw}`);
        });
    }

    // 기본 키워드 + 트렌드 조합
    if (baseKeyword) {
        combinations.push(`${baseKeyword} ${categoryKeywords[0]}`);
        combinations.push(`${baseKeyword} 후기`);
        combinations.push(`${baseKeyword} 추천`);
    }

    // 계절 키워드 추가
    if (location) {
        seasonalKeywords.slice(0, 2).forEach((kw) => {
            combinations.push(`${location} ${kw}`);
        });
    }

    return combinations.slice(0, 10);
}

// 콘텐츠 품질 점수 계산
function calculateQualityScore(content: {
    title?: string;
    body?: string;
    imageCount?: number;
    hashtagCount?: number;
}): {
    score: number;
    feedback: { item: string; status: "pass" | "warn" | "fail"; message: string }[];
} {
    const feedback: { item: string; status: "pass" | "warn" | "fail"; message: string }[] = [];
    let score = 0;

    // 제목 길이 (25-40자)
    const titleLen = content.title?.length || 0;
    if (titleLen >= 25 && titleLen <= 40) {
        score += 20;
        feedback.push({ item: "제목 길이", status: "pass", message: `${titleLen}자 (적정)` });
    } else if (titleLen > 0) {
        score += 10;
        feedback.push({ item: "제목 길이", status: "warn", message: `${titleLen}자 (25-40자 권장)` });
    } else {
        feedback.push({ item: "제목 길이", status: "fail", message: "제목 없음" });
    }

    // 본문 길이 (2000자 이상)
    const bodyLen = content.body?.length || 0;
    if (bodyLen >= 2000) {
        score += 30;
        feedback.push({ item: "본문 길이", status: "pass", message: `${bodyLen}자 (충분)` });
    } else if (bodyLen >= 1000) {
        score += 15;
        feedback.push({ item: "본문 길이", status: "warn", message: `${bodyLen}자 (2000자 이상 권장)` });
    } else {
        feedback.push({ item: "본문 길이", status: "fail", message: `${bodyLen}자 (부족)` });
    }

    // 이미지 수 (5개 이상)
    const imgCount = content.imageCount || 0;
    if (imgCount >= 5) {
        score += 25;
        feedback.push({ item: "이미지 수", status: "pass", message: `${imgCount}개 (적정)` });
    } else if (imgCount >= 3) {
        score += 12;
        feedback.push({ item: "이미지 수", status: "warn", message: `${imgCount}개 (5개 이상 권장)` });
    } else {
        feedback.push({ item: "이미지 수", status: "fail", message: `${imgCount}개 (부족)` });
    }

    // 해시태그 수 (15-20개)
    const tagCount = content.hashtagCount || 0;
    if (tagCount >= 15 && tagCount <= 20) {
        score += 25;
        feedback.push({ item: "해시태그", status: "pass", message: `${tagCount}개 (적정)` });
    } else if (tagCount >= 10) {
        score += 12;
        feedback.push({ item: "해시태그", status: "warn", message: `${tagCount}개 (15-20개 권장)` });
    } else {
        feedback.push({ item: "해시태그", status: "fail", message: `${tagCount}개 (부족)` });
    }

    return { score, feedback };
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, category, location, baseKeyword, content } = body;

        if (action === "keywords") {
            // 키워드 추천
            const categoryKeywords = TRENDING_KEYWORDS[category] || [];
            const season = getCurrentSeason();
            const seasonalKeywords = SEASONAL_KEYWORDS[season] || [];
            const combinations = generateKeywordCombinations(category, location, baseKeyword);

            return NextResponse.json({
                success: true,
                data: {
                    trending: categoryKeywords,
                    seasonal: seasonalKeywords,
                    combinations,
                    tips: [
                        "지역명 + 키워드 조합이 검색 노출에 효과적",
                        "계절 키워드를 활용하면 시즌 트래픽 유입 가능",
                        "구체적인 키워드일수록 경쟁이 낮고 상위노출 쉬움",
                    ],
                },
            });
        }

        if (action === "quality") {
            // 콘텐츠 품질 분석
            const result = calculateQualityScore(content);

            return NextResponse.json({
                success: true,
                data: {
                    score: result.score,
                    grade: result.score >= 80 ? "A" : result.score >= 60 ? "B" : result.score >= 40 ? "C" : "D",
                    feedback: result.feedback,
                    tips: result.score < 80
                        ? ["품질 점수가 낮으면 상위노출 확률이 감소합니다", "위 피드백을 참고하여 콘텐츠를 개선하세요"]
                        : ["좋은 품질의 콘텐츠입니다!", "발행 후 조회수를 모니터링하세요"],
                },
            });
        }

        return NextResponse.json(
            { success: false, error: "지원하지 않는 액션입니다" },
            { status: 400 }
        );
    } catch (error) {
        console.error("키워드 분석 실패:", error);
        return NextResponse.json(
            { success: false, error: "키워드 분석 실패" },
            { status: 500 }
        );
    }
}

export async function GET() {
    // 전체 카테고리별 키워드 목록 반환
    return NextResponse.json({
        success: true,
        data: {
            categories: Object.keys(TRENDING_KEYWORDS),
            keywords: TRENDING_KEYWORDS,
            seasonal: SEASONAL_KEYWORDS,
            currentSeason: getCurrentSeason(),
        },
    });
}

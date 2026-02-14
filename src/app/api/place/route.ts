import { NextRequest, NextResponse } from "next/server";

interface NaverLocalSearchItem {
    title: string;
    address?: string;
    roadAddress?: string;
    telephone?: string;
    category?: string;
    mapx?: string;
    mapy?: string;
}

interface NaverLocalSearchResponse {
    total?: number;
    items?: NaverLocalSearchItem[];
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "알 수 없는 오류";
}

/**
 * 네이버 플레이스 검색 API
 * V5 Phase 13: 장소명으로 정보 자동 추출
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get("q");

        if (!query) {
            return NextResponse.json(
                { success: false, error: "검색어가 필요합니다" },
                { status: 400 }
            );
        }

        // 네이버 검색 API 호출 (Place Search)
        const clientId = process.env.NAVER_CLIENT_ID;
        const clientSecret = process.env.NAVER_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            // API 키가 없으면 기본 응답
            return NextResponse.json({
                success: true,
                data: {
                    query,
                    places: [],
                    message: "NAVER_CLIENT_ID/SECRET이 설정되지 않았습니다.",
                },
            });
        }

        // 네이버 지역 검색 API
        const response = await fetch(
            `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5`,
            {
                headers: {
                    "X-Naver-Client-Id": clientId,
                    "X-Naver-Client-Secret": clientSecret,
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Naver API error: ${response.status}`);
        }

        const data = (await response.json()) as NaverLocalSearchResponse;

        // 결과 변환
        const places = (data.items ?? []).map((item) => ({
            title: item.title.replace(/<[^>]*>/g, ""), // HTML 태그 제거
            address: item.address,
            roadAddress: item.roadAddress,
            telephone: item.telephone,
            category: item.category,
            mapx: item.mapx,
            mapy: item.mapy,
        }));

        return NextResponse.json({
            success: true,
            data: {
                query,
                total: data.total,
                places,
            },
        });

    } catch (error: unknown) {
        console.error("플레이스 검색 실패:", error);
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) },
            { status: 500 }
        );
    }
}

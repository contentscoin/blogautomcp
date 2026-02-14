import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);

        // 쿼리 파라미터
        const status = searchParams.get("status"); // SUCCESS, FAILED, ALL
        const page = parseInt(searchParams.get("page") || "1");
        const limit = parseInt(searchParams.get("limit") || "10");
        const skip = (page - 1) * limit;

        // 필터 조건
        const where: Record<string, unknown> = {};

        if (status && status !== "ALL") {
            where.status = status === "SUCCESS" ? "PUBLISHED" : "FAILED";
        } else {
            // 기본: 발행완료 + 실패만 (대기 제외)
            where.status = { in: ["PUBLISHED", "FAILED"] };
        }

        // 전체 개수
        const total = await prisma.brandLink.count({ where });

        // 데이터 조회
        const items = await prisma.brandLink.findMany({
            where,
            orderBy: { updatedAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                productName: true,
                storeName: true,
                status: true,
                postUrl: true,
                errorMessage: true,
                publishedAt: true,
                updatedAt: true,
                memo: true,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                items: items.map((item) => ({
                    id: item.id,
                    title: item.productName || item.storeName || "제목 없음",
                    status: item.status,
                    postUrl: item.postUrl,
                    errorMessage: item.errorMessage,
                    publishedAt: item.publishedAt,
                    updatedAt: item.updatedAt,
                    memo: item.memo,
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        console.error("히스토리 조회 실패:", error);
        return NextResponse.json(
            { success: false, error: "히스토리 조회 실패" },
            { status: 500 }
        );
    }
}

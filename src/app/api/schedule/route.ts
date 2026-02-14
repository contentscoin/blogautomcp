import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "알 수 없는 오류";
}

interface ScheduleRequestBody {
    type?: "travel" | "golf" | "knowledge";
    topic?: string;
    keywords?: string;
    style?: string;
    category?: string;
    scheduledAt?: string;
    images?: string;
}

// GET: 예약된 발행 목록 조회
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const status = searchParams.get("status");
        const limit = parseInt(searchParams.get("limit") || "20");

        const where = status ? { status } : {};

        const posts = await prisma.post.findMany({
            where,
            orderBy: { scheduledAt: "asc" },
            take: limit,
            select: {
                id: true,
                title: true,
                scheduledAt: true,
                status: true,
                topicSeed: true,
                category: true,
                createdAt: true,
                publishedAt: true,
                errorMessage: true,
            },
        });

        return NextResponse.json({ success: true, data: posts });

    } catch (error: unknown) {
        console.error("예약 목록 조회 실패:", error);
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) },
            { status: 500 }
        );
    }
}

// POST: 새 예약 발행 생성
export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as ScheduleRequestBody;

        const {
            type,
            topic,
            keywords,
            style,
            category,
            scheduledAt,
            images,
        } = body;

        // 필수값 검증
        if (!topic || !scheduledAt) {
            return NextResponse.json(
                { success: false, error: "topic과 scheduledAt은 필수입니다" },
                { status: 400 }
            );
        }

        // 예약 시간 검증 (현재 시간 이후여야 함)
        const scheduleDate = new Date(scheduledAt);
        if (scheduleDate < new Date()) {
            return NextResponse.json(
                { success: false, error: "예약 시간은 현재 시간 이후여야 합니다" },
                { status: 400 }
            );
        }

        // 예약 생성
        const post = await prisma.post.create({
            data: {
                date: scheduleDate,
                scheduledAt: scheduleDate,
                status: "PENDING",
                topicSeed: JSON.stringify({
                    type: type || "knowledge",
                    topic,
                    keywords: keywords?.split(",").map((k) => k.trim()) || [],
                    style,
                    images,
                }),
                category,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                id: post.id,
                scheduledAt: post.scheduledAt,
                status: post.status,
            },
        });

    } catch (error: unknown) {
        console.error("예약 생성 실패:", error);
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) },
            { status: 500 }
        );
    }
}

// DELETE: 예약 취소
export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { success: false, error: "id는 필수입니다" },
                { status: 400 }
            );
        }

        // PENDING 상태만 취소 가능
        const post = await prisma.post.findUnique({ where: { id } });

        if (!post) {
            return NextResponse.json(
                { success: false, error: "예약을 찾을 수 없습니다" },
                { status: 404 }
            );
        }

        if (post.status !== "PENDING") {
            return NextResponse.json(
                { success: false, error: "PENDING 상태만 취소할 수 있습니다" },
                { status: 400 }
            );
        }

        await prisma.post.update({
            where: { id },
            data: { status: "CANCELLED" },
        });

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        console.error("예약 취소 실패:", error);
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) },
            { status: 500 }
        );
    }
}

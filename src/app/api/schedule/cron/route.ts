import { NextResponse } from "next/server";
import { runScheduler } from "@/services/scheduler";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "알 수 없는 오류";
}

/**
 * 크론 잡 트리거 엔드포인트
 * Vercel Cron 또는 외부 스케줄러에서 호출
 * 
 * 설정 예시 (vercel.json):
 * "crons": [{ "path": "/api/schedule/cron", "schedule": "0 * * * *" }]
 */
export async function GET() {
    try {
        await runScheduler();

        return NextResponse.json({
            success: true,
            message: "Scheduler executed",
            timestamp: new Date().toISOString(),
        });

    } catch (error: unknown) {
        console.error("Cron 실행 실패:", error);
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) },
            { status: 500 }
        );
    }
}

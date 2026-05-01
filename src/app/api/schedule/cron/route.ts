import { NextRequest, NextResponse } from "next/server";
import { runScheduler } from "@/services/scheduler";
import { requireCronSecret } from "@/lib/api-auth";
import fs from "fs";
import path from "path";

function cleanTempImages(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const dir = path.join(process.cwd(), "temp_images");
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed++;
      }
    } catch { /* 삭제 실패 시 스킵 */ }
  }
  return removed;
}

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
export async function GET(request: NextRequest) {
    try {
        const authError = requireCronSecret(request);
        if (authError) {
            return authError;
        }

        await runScheduler();
        const cleanedFiles = cleanTempImages();

        return NextResponse.json({
            success: true,
            message: "Scheduler executed",
            timestamp: new Date().toISOString(),
            cleanedTempFiles: cleanedFiles,
        });

    } catch (error: unknown) {
        console.error("Cron 실행 실패:", error);
        return NextResponse.json(
            { success: false, error: getErrorMessage(error) },
            { status: 500 }
        );
    }
}

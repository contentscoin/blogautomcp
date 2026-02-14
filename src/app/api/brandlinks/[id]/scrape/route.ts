import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { execSync } from "child_process";
import path from "path";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

// POST: 상품 정보 스크래핑
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const link = await prisma.brandLink.findUnique({
      where: { id },
    });

    if (!link) {
      return NextResponse.json(
        { success: false, error: "링크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 스크래핑 스크립트 실행
    const scriptPath = path.join(process.cwd(), "scripts", "scrape-link.ts");

    try {
      execSync(`npx ts-node --project tsconfig.scripts.json "${scriptPath}" ${id}`, {
        cwd: process.cwd(),
        timeout: 60000, // 60초 타임아웃
        encoding: "utf-8",
      });
      
      // 업데이트된 링크 조회
      const updatedLink = await prisma.brandLink.findUnique({
        where: { id },
      });
      
      return NextResponse.json({ 
        success: true, 
        data: updatedLink,
      });
    } catch (execError: unknown) {
      console.error("스크래핑 스크립트 실행 실패:", execError);
      return NextResponse.json(
        { success: false, error: "상품 정보를 가져오는데 실패했습니다." },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error("스크래핑 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

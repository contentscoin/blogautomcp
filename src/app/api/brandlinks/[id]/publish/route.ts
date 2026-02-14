import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn } from "child_process";
import path from "path";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

// POST: 발행 시작
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

    // 상태를 발행중으로 변경
    await prisma.brandLink.update({
      where: { id },
      data: { 
        status: "PUBLISHING",
        errorMessage: null,
      },
    });

    // 발행 스크립트 실행 (백그라운드) - 단순 에이전트 사용
    const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");
    
    const child = spawn("npx", ["ts-node", "--project", "tsconfig.scripts.json", scriptPath, id], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      shell: true,
    });
    
    child.unref();

    return NextResponse.json({ 
      success: true, 
      message: "발행이 시작되었습니다.",
    });
  } catch (error: unknown) {
    console.error("발행 시작 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

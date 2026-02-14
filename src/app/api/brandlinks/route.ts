import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

interface CreateBrandLinkRequest {
  url?: string;
  memo?: string;
}

// GET: 전체 링크 조회
export async function GET() {
  try {
    noStore();
    const links = await prisma.brandLink.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: links });
  } catch (error: unknown) {
    console.error("링크 조회 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST: 링크 추가
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBrandLinkRequest;
    const { url, memo } = body;

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL이 필요합니다." },
        { status: 400 }
      );
    }

    // 중복 체크
    const existing = await prisma.brandLink.findFirst({
      where: { url },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "이미 등록된 URL입니다." },
        { status: 400 }
      );
    }

    const link = await prisma.brandLink.create({
      data: {
        url,
        memo: memo || null,
        status: "READY",
      },
    });

    return NextResponse.json({ success: true, data: link });
  } catch (error: unknown) {
    console.error("링크 추가 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

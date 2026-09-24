import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { normalizeExperienceNotesInput } from "@/lib/experience-notes";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

interface UpdateBrandLinkRequest {
  memo?: string | null;
  categoryNo?: string | null;
  useSectionHeading?: boolean;
  experienceNotes?: string | null;
}

function normalizeCategoryNo(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,6}$/.test(trimmed)) return undefined;
  return trimmed;
}

// GET: 단일 링크 조회
export async function GET(
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

    return NextResponse.json({ success: true, data: link });
  } catch (error: unknown) {
    console.error("링크 조회 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// DELETE: 링크 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const { id } = await params;

    const existing = await prisma.brandLink.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "링크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    if (existing.status === "DRAFTING" || existing.status === "PUBLISHING") {
      return NextResponse.json(
        { success: false, error: "초안 작성 또는 발행 중인 상품은 삭제할 수 없습니다." },
        { status: 409 },
      );
    }

    const deleted = await prisma.brandLink.deleteMany({
      where: { id, status: { notIn: ["DRAFTING", "PUBLISHING"] } },
    });
    if (deleted.count !== 1) {
      return NextResponse.json(
        { success: false, error: "상품 상태가 변경되어 삭제하지 못했습니다." },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("링크 삭제 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// PATCH: 링크 수정
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) {
      return authError;
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateBrandLinkRequest;

    const hasMemo = Object.prototype.hasOwnProperty.call(body, "memo");
    const hasCategoryNo = Object.prototype.hasOwnProperty.call(body, "categoryNo");
    const hasUseSectionHeading =
      Object.prototype.hasOwnProperty.call(body, "useSectionHeading");
    const hasExperienceNotes = Object.prototype.hasOwnProperty.call(body, "experienceNotes");

    if (!hasMemo && !hasCategoryNo && !hasUseSectionHeading && !hasExperienceNotes) {
      return NextResponse.json(
        { success: false, error: "수정할 필드(memo/categoryNo/useSectionHeading/experienceNotes)가 없습니다." },
        { status: 400 }
      );
    }

    const experienceNotes = hasExperienceNotes ? normalizeExperienceNotesInput(body.experienceNotes) : undefined;
    if (hasExperienceNotes && experienceNotes === undefined) {
      return NextResponse.json(
        { success: false, error: "experienceNotes는 문자열 또는 null이어야 합니다." },
        { status: 400 }
      );
    }

    const memo = hasMemo
      ? body.memo === null
        ? null
        : typeof body.memo === "string"
          ? body.memo.trim()
          : undefined
      : undefined;
    if (hasMemo && memo === undefined) {
      return NextResponse.json(
        { success: false, error: "memo는 문자열 또는 null이어야 합니다." },
        { status: 400 }
      );
    }

    const categoryNo = hasCategoryNo ? normalizeCategoryNo(body.categoryNo) : undefined;
    if (hasCategoryNo && categoryNo === undefined) {
      return NextResponse.json(
        { success: false, error: "categoryNo는 숫자 문자열 또는 null이어야 합니다." },
        { status: 400 }
      );
    }

    const parsedUseSectionHeading = hasUseSectionHeading ? body.useSectionHeading : undefined;
    if (
      hasUseSectionHeading &&
      typeof parsedUseSectionHeading !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, error: "useSectionHeading은 boolean이어야 합니다." },
        { status: 400 }
      );
    }

    const existing = await prisma.brandLink.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "링크를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const link = await prisma.brandLink.update({
      where: { id },
      data: {
        ...(hasMemo ? { memo } : {}),
        ...(hasCategoryNo ? { categoryNo } : {}),
        ...(hasUseSectionHeading
          ? { useSectionHeading: parsedUseSectionHeading }
          : {}),
        ...(hasExperienceNotes ? { experienceNotes } : {}),
      },
    });

    return NextResponse.json({ success: true, data: link });
  } catch (error: unknown) {
    console.error("링크 수정 실패:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

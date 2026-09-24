import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import {
  buildPostAngleFamilyView,
  loadPostAngleFamily,
  storedConnectKind,
  validateNewAngle,
} from "@/lib/post-angle-family";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

// GET: 이 상품의 포스팅 주제(전체 리뷰 + 주제 글)와 추천 주제
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const family = await loadPostAngleFamily(prisma, id);
    if (!family) {
      return NextResponse.json({ success: false, error: "링크를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: buildPostAngleFamilyView(family) });
  } catch (error: unknown) {
    console.error("포스팅 주제 조회 실패:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

// POST: 선택한 주제로 주제 글 행을 만든다. 원본 상품 정보를 복사하고 원고 파이프라인은 그대로 쓴다.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authError = requireAdminApiKey(request);
    if (authError) return authError;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { angle?: unknown };
    const family = await loadPostAngleFamily(prisma, id);
    if (!family) {
      return NextResponse.json({ success: false, error: "링크를 찾을 수 없습니다." }, { status: 404 });
    }
    const view = buildPostAngleFamilyView(family);
    const kind = storedConnectKind(family.root.connectKind);
    const checked = validateNewAngle(kind, body.angle, view);
    if (!checked.ok) {
      const existing = view.members.find((member) => member.angle === body.angle);
      return NextResponse.json(
        { success: false, error: checked.error, ...(existing ? { data: { id: existing.id } } : {}) },
        { status: checked.status },
      );
    }

    const root = await prisma.brandLink.findUnique({ where: { id: family.root.id } });
    if (!root) {
      return NextResponse.json({ success: false, error: "원본 상품을 찾을 수 없습니다." }, { status: 404 });
    }
    const created = await prisma.brandLink.create({
      data: {
        url: root.url,
        connectKind: root.connectKind,
        externalItemId: root.externalItemId,
        sourceUrl: root.sourceUrl,
        productName: root.productName,
        productPrice: root.productPrice,
        storeName: root.storeName,
        finalUrl: root.finalUrl,
        productDescription: root.productDescription,
        productFeatures: root.productFeatures,
        travelResearchJson: root.travelResearchJson,
        imageUrls: root.imageUrls,
        categoryNo: root.categoryNo,
        useSectionHeading: root.useSectionHeading,
        status: "READY",
        parentBrandLinkId: root.id,
        postAngle: checked.angle,
      },
    });
    return NextResponse.json({ success: true, data: { id: created.id, angle: checked.angle } }, { status: 201 });
  } catch (error: unknown) {
    console.error("포스팅 주제 생성 실패:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
export async function POST(request: NextRequest) {
  const auth = requireAdminApiKey(request); if (auth) return auth;
  return NextResponse.json({ success: false, code: "MATERIAL_SELECTION_REQUIRED", error: "상품 동기화 후 소재 미리작성으로 원고와 이미지를 준비하세요. 준비된 소재를 선택하여 별도로 발행해야 합니다.", next: { prepare: "/api/materials/prepare", list: "/api/materials", publish: "/api/materials/publish" } }, { status: 409 });
}

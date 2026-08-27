import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { apiError, hasValidBrowserOrigin } from "@/lib/http";

export async function POST(request: NextRequest) {
  if (!hasValidBrowserOrigin(request)) return apiError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  await destroySession();
  return NextResponse.json({ data: { signedOut: true } });
}

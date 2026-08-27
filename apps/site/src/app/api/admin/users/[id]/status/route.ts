import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, getRequestId, hasValidBrowserOrigin, readObject } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const ALLOWED = new Set(["APPROVED", "REJECTED", "SUSPENDED"]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!hasValidBrowserOrigin(request)) return apiError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  const admin = await getCurrentUser();
  if (!admin) return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  if (admin.role !== "ADMIN" || admin.email !== "hiway@kakao.com") return apiError("FORBIDDEN", "관리자 권한이 필요합니다.", 403);
  const body = await readObject(request);
  const status = typeof body?.status === "string" ? body.status : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!ALLOWED.has(status)) return apiError("INVALID_STATUS", "지원하지 않는 상태입니다.", 422);
  const { id } = await context.params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role === "ADMIN") return apiError("USER_NOT_FOUND", "대상 사용자를 찾을 수 없습니다.", 404);
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status: status as "APPROVED" | "REJECTED" | "SUSPENDED", approvedAt: status === "APPROVED" ? now : target.approvedAt, approvedById: status === "APPROVED" ? admin.id : target.approvedById } });
    await tx.approvalEvent.create({ data: { userId: id, actorId: admin.id, action: status, reason: reason || null } });
    if (status !== "APPROVED") {
      await tx.oAuthRefreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.device.updateMany({ where: { userId: id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
      await tx.agentJob.updateMany({ where: { userId: id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: now, errorCode: "ACCOUNT_DISABLED", errorMessage: "관리자에 의해 계정 이용이 중지되었습니다." } });
    }
  });
  await writeAudit({ actorUserId: admin.id, actorType: "ADMIN", action: `USER_${status}`, resourceType: "User", resourceId: id, result: "SUCCESS", requestId: getRequestId(request), metadata: { targetEmail: target.email } });
  return NextResponse.json({ data: { id, status } });
}

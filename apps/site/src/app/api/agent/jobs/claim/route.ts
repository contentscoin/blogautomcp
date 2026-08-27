import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { userCanUseMcp } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("DEVICE_REVOKED", "PC 인증이 유효하지 않습니다.", 401);
  if (!userCanUseMcp(device.user)) return apiError("ACCOUNT_DISABLED", "계정 이용이 중지되었습니다.", 403);
  const now = new Date();
  const job = await db.$transaction(async (tx) => {
    await tx.device.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    const next = await tx.agentJob.findFirst({ where: { userId: device.userId, status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (!next) return null;
    const claimed = await tx.agentJob.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", deviceId: device.id, startedAt: now, progress: 1 } });
    if (claimed.count !== 1) return null;
    return tx.agentJob.findUnique({ where: { id: next.id } });
  });
  return NextResponse.json({ data: job ? { id: job.id, type: job.type, input: job.inputJson, createdAt: job.createdAt.toISOString() } : null });
}

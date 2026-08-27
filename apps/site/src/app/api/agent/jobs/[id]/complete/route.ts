import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { db } from "@/lib/db";
import { apiError, readObject } from "@/lib/http";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("DEVICE_REVOKED", "PC 인증이 유효하지 않습니다.", 401);
  const body = await readObject(request);
  const status = body?.status === "SUCCEEDED" ? "SUCCEEDED" : body?.status === "FAILED" ? "FAILED" : null;
  if (!status) return apiError("INVALID_STATUS", "status는 SUCCEEDED 또는 FAILED여야 합니다.", 422);
  const serializedResult = body?.result === undefined ? "" : JSON.stringify(body.result);
  if (serializedResult.length > 1_000_000) return apiError("RESULT_TOO_LARGE", "작업 결과는 1MB 이하여야 합니다.", 413);
  const { id } = await context.params;
  const updated = await db.agentJob.updateMany({
    where: { id, userId: device.userId, deviceId: device.id, status: "RUNNING" },
    data: {
      status,
      progress: 100,
      resultJson: body?.result === undefined ? undefined : (body.result as object),
      errorCode: status === "FAILED" && typeof body?.errorCode === "string" ? body.errorCode.slice(0, 80) : null,
      errorMessage: status === "FAILED" && typeof body?.errorMessage === "string" ? body.errorMessage.slice(0, 2000) : null,
      finishedAt: new Date(),
    },
  });
  if (updated.count !== 1) return apiError("JOB_NOT_ACTIVE", "완료할 수 있는 실행 중 작업이 아닙니다.", 409);
  await db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return NextResponse.json({ data: { id, status } });
}

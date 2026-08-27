import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { apiError, getRequestId, readObject } from "@/lib/http";
import { parseMcpUrl, resolveMcpConnection } from "@/lib/mcp-connection";
import { userCanUseMcp } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { consumeRateLimit, getClientAddress, rateLimitError } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const body = await readObject(request);
  const mcpUrl = typeof body?.mcpUrl === "string" ? body.mcpUrl.trim() : "";
  const name = typeof body?.deviceName === "string" ? body.deviceName.trim().slice(0, 80) : "";
  const platform = typeof body?.platform === "string" ? body.platform.trim().slice(0, 80) : null;
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.trim().slice(0, 40) : null;
  if (!name) return apiError("DEVICE_NAME_REQUIRED", "PC 이름을 입력하세요.", 422);
  const parsed = parseMcpUrl(mcpUrl);
  if (!parsed) return apiError("INVALID_MCP_URL", "MCP URL 형식을 확인하세요.", 422);
  const rate = await consumeRateLimit({ action: "DEVICE_PAIR", identifier: getClientAddress(request), limit: 20, windowMs: 10 * 60 * 1000 });
  if (!rate.allowed) return rateLimitError(rate.retryAfterSeconds);
  const connection = await resolveMcpConnection(parsed.endpointId, parsed.secret);
  if (!connection) return apiError("INVALID_MCP_URL", "MCP URL이 유효하지 않거나 폐기되었습니다.", 401);
  if (!userCanUseMcp(connection.user)) return apiError("ACCOUNT_NOT_APPROVED", "승인된 계정만 PC를 연결할 수 있습니다.", 403);

  const token = randomToken(32);
  const now = new Date();
  const paired = await db.$transaction(async (tx) => {
    const priorDevices = await tx.device.findMany({ where: { userId: connection.userId, status: "ACTIVE" }, select: { id: true } });
    await tx.device.updateMany({ where: { userId: connection.userId, status: "ACTIVE" }, data: { status: "REPLACED", revokedAt: now } });
    const created = await tx.device.create({ data: { userId: connection.userId, tokenHash: hashToken(token), name, platform, appVersion, status: "ACTIVE", lastSeenAt: now } });
    if (priorDevices.length) {
      const priorIds = priorDevices.map((item) => item.id);
      await tx.device.updateMany({ where: { id: { in: priorIds } }, data: { replacedById: created.id } });
      await tx.agentJob.updateMany({
        where: { userId: connection.userId, deviceId: { in: priorIds }, status: "RUNNING" },
        data: { status: "CANCELLED", finishedAt: now, errorCode: "DEVICE_REPLACED", errorMessage: "새 PC가 인증되어 기존 PC의 실행 작업이 취소되었습니다." },
      });
    }
    return { device: created, replacedExisting: priorDevices.length > 0 };
  });
  await writeAudit({ actorUserId: connection.userId, actorType: "DEVICE", action: "DEVICE_PAIR", resourceType: "Device", resourceId: paired.device.id, result: "SUCCESS", requestId: getRequestId(request), metadata: { name, platform, appVersion, replacedExisting: paired.replacedExisting } });
  return NextResponse.json({ data: { deviceId: paired.device.id, deviceToken: token, userId: connection.userId, pollIntervalMs: 3000 } }, { status: 201 });
}

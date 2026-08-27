import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, userCanUseMcp } from "@/lib/auth";
import { randomToken, hashToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getSiteUrl } from "@/lib/env";
import { apiError, getRequestId, hasValidBrowserOrigin } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  if (!hasValidBrowserOrigin(request)) return apiError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  const user = await getCurrentUser();
  if (!user) return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  if (!userCanUseMcp(user)) return apiError("ACCOUNT_NOT_APPROVED", "관리자 승인 후 발급할 수 있습니다.", 403);
  const current = await db.mcpConnection.findUnique({ where: { userId: user.id } });
  if (!current) return apiError("CONNECTION_NOT_FOUND", "먼저 MCP 연결을 발급하세요.", 404);

  const endpointId = randomToken(15);
  const secret = randomToken(32);
  const now = new Date();
  const connection = await db.$transaction(async (tx) => {
    await tx.oAuthRefreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.device.updateMany({ where: { userId: user.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
    await tx.agentJob.updateMany({ where: { userId: user.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", finishedAt: now, errorCode: "ENDPOINT_ROTATED", errorMessage: "MCP 연결이 재발급되어 작업이 취소되었습니다." } });
    return tx.mcpConnection.update({ where: { id: current.id }, data: { endpointId, secretHash: hashToken(secret), generation: { increment: 1 }, status: "ACTIVE", shownAt: now, rotatedAt: now, revokedAt: null } });
  });
  const mcpUrl = `${getSiteUrl()}/api/mcp/${endpointId}.${secret}`;
  await writeAudit({ actorUserId: user.id, actorType: user.role === "ADMIN" ? "ADMIN" : "USER", action: "MCP_CONNECTION_ROTATE", resourceType: "McpConnection", resourceId: connection.id, result: "SUCCESS", requestId: getRequestId(request), metadata: { generation: connection.generation, priorGeneration: current.generation } });
  return NextResponse.json({ data: { mcpUrl, generation: connection.generation, shownOnce: true } });
}

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
  const existing = await db.mcpConnection.findUnique({ where: { userId: user.id } });
  if (existing?.status === "ACTIVE") return apiError("CONNECTION_EXISTS", "이미 활성 MCP 연결이 있습니다. 추가 발행을 사용하세요.", 409);

  const endpointId = randomToken(15);
  const secret = randomToken(32);
  const connection = await db.mcpConnection.upsert({
    where: { userId: user.id },
    create: { userId: user.id, endpointId, secretHash: hashToken(secret), shownAt: new Date(), status: "ACTIVE" },
    update: { endpointId, secretHash: hashToken(secret), status: "ACTIVE", generation: { increment: 1 }, shownAt: new Date(), revokedAt: null },
  });
  const mcpUrl = `${getSiteUrl()}/api/mcp/${endpointId}.${secret}`;
  await writeAudit({ actorUserId: user.id, actorType: user.role === "ADMIN" ? "ADMIN" : "USER", action: "MCP_CONNECTION_ISSUE", resourceType: "McpConnection", resourceId: connection.id, result: "SUCCESS", requestId: getRequestId(request), metadata: { generation: connection.generation } });
  return NextResponse.json({ data: { mcpUrl, generation: connection.generation, shownOnce: true } }, { status: 201 });
}

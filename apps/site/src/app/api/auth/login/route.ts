import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { apiError, getRequestId, hasValidBrowserOrigin, readObject } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { consumeRateLimit, getClientAddress, rateLimitError } from "@/lib/rate-limit";

const DUMMY_PASSWORD_HASH = "scrypt-v1$YmxvZ2F1dG9tY3AtZHVtbXk$ouwuExZGaU6HXCKaAIKSR91cvnLfbMndEHh2QgiWWkoALVo-jtLxYzLpbqsJe0ExRXIZxPD4kYi41j_O3he7qg";

export async function POST(request: NextRequest) {
  if (!hasValidBrowserOrigin(request)) return apiError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  const body = await readObject(request);
  if (!body) return apiError("INVALID_JSON", "요청 형식이 올바르지 않습니다.", 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const clientAddress = getClientAddress(request);
  const broadRate = await consumeRateLimit({ action: "LOGIN_IP", identifier: clientAddress, limit: 60, windowMs: 15 * 60 * 1000 });
  if (!broadRate.allowed) return rateLimitError(broadRate.retryAfterSeconds);
  const rate = await consumeRateLimit({ action: "LOGIN", identifier: `${clientAddress}:${email}`, limit: 12, windowMs: 15 * 60 * 1000 });
  if (!rate.allowed) return rateLimitError(rate.retryAfterSeconds);

  if (email.length > 254 || password.length > 128) {
    return apiError("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    await writeAudit({ actorType: "SYSTEM", action: "LOGIN", resourceType: "User", result: "DENIED", requestId: getRequestId(request) });
    return apiError("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  await createSession(user.id);
  await writeAudit({ actorUserId: user.id, actorType: user.role === "ADMIN" ? "ADMIN" : "USER", action: "LOGIN", resourceType: "User", resourceId: user.id, result: "SUCCESS", requestId: getRequestId(request) });
  return NextResponse.json({ data: { id: user.id, role: user.role, status: user.status } });
}

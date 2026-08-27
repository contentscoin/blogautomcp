import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { hashPassword, safeEqualText } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getAdminBootstrapCode, getAdminEmail } from "@/lib/env";
import { apiError, getRequestId, hasValidBrowserOrigin, readObject } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { consumeRateLimit, getClientAddress, rateLimitError } from "@/lib/rate-limit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  if (!hasValidBrowserOrigin(request)) return apiError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  const rate = await consumeRateLimit({ action: "SIGNUP", identifier: getClientAddress(request), limit: 8, windowMs: 60 * 60 * 1000 });
  if (!rate.allowed) return rateLimitError(rate.retryAfterSeconds);
  const body = await readObject(request);
  if (!body) return apiError("INVALID_JSON", "요청 형식이 올바르지 않습니다.", 400);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const adminBootstrapCode = typeof body.adminBootstrapCode === "string" ? body.adminBootstrapCode.trim() : "";

  if (!EMAIL_PATTERN.test(email) || email.length > 254) return apiError("INVALID_EMAIL", "이메일 형식을 확인하세요.", 422);
  if (displayName.length < 2 || displayName.length > 40) return apiError("INVALID_NAME", "이름은 2~40자로 입력하세요.", 422);
  if (password.length < 10 || password.length > 128) return apiError("WEAK_PASSWORD", "비밀번호는 10~128자로 입력하세요.", 422);

  const isAdmin = email === getAdminEmail();
  if (isAdmin) {
    let expectedCode: string;
    try {
      expectedCode = getAdminBootstrapCode();
    } catch {
      return apiError("ADMIN_SETUP_DISABLED", "관리자 초기등록 코드가 서버에 설정되지 않았습니다.", 503);
    }
    if (!safeEqualText(adminBootstrapCode, expectedCode)) {
      await writeAudit({ actorType: "SYSTEM", action: "ADMIN_SIGNUP", resourceType: "User", result: "DENIED", requestId: getRequestId(request) });
      return apiError("INVALID_ADMIN_CODE", "관리자 초기등록 코드가 올바르지 않습니다.", 403);
    }
  }

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return apiError("EMAIL_ALREADY_USED", "이미 등록된 이메일입니다.", 409);

  const passwordHash = await hashPassword(password);
  try {
    const user = await db.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        role: isAdmin ? "ADMIN" : "USER",
        status: isAdmin ? "APPROVED" : "PENDING_APPROVAL",
        approvedAt: isAdmin ? new Date() : null,
      },
    });
    await createSession(user.id);
    await writeAudit({
      actorUserId: user.id,
      actorType: isAdmin ? "ADMIN" : "USER",
      action: "SIGNUP",
      resourceType: "User",
      resourceId: user.id,
      result: "SUCCESS",
      requestId: getRequestId(request),
      metadata: { role: user.role, status: user.status },
    });
    return NextResponse.json({ data: { id: user.id, role: user.role, status: user.status } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return apiError("EMAIL_ALREADY_USED", "이미 등록된 이메일입니다.", 409);
    throw error;
  }
}

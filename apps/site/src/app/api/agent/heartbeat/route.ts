import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { db } from "@/lib/db";
import { apiError, readObject } from "@/lib/http";
import { userCanUseMcp } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("DEVICE_REVOKED", "PC 인증이 유효하지 않습니다.", 401);
  if (!userCanUseMcp(device.user)) return apiError("ACCOUNT_DISABLED", "계정 이용이 중지되었습니다.", 403);
  const body = await readObject(request);
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.trim().slice(0, 40) : undefined;
  await db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...(appVersion ? { appVersion } : {}) } });
  return NextResponse.json({ data: { ok: true, serverTime: new Date().toISOString() } });
}

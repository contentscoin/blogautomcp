import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/crypto";

export async function authenticateDevice(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return db.device.findFirst({
    where: { tokenHash: hashToken(token), status: "ACTIVE" },
    include: { user: true },
  });
}

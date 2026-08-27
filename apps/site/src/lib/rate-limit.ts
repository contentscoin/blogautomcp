import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { keyedHash } from "@/lib/crypto";
import { getAuthSecret } from "@/lib/env";

interface RateLimitInput {
  action: string;
  identifier: string;
  limit: number;
  windowMs: number;
  blockMs?: number;
}

export function getClientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function consumeRateLimit(input: RateLimitInput): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = new Date();
  const keyHash = keyedHash(`${input.action}:${input.identifier}`, getAuthSecret());
  const blockMs = input.blockMs ?? input.windowMs;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const current = await tx.rateLimitBucket.findUnique({ where: { keyHash } });
        if (current?.blockedUntil && current.blockedUntil > now) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil.getTime() - now.getTime()) / 1000)) };
        }

        const windowExpired = !current || now.getTime() - current.windowStart.getTime() >= input.windowMs;
        const nextCount = windowExpired ? 1 : current.count + 1;
        const blockedUntil = nextCount > input.limit ? new Date(now.getTime() + blockMs) : null;

        await tx.rateLimitBucket.upsert({
          where: { keyHash },
          create: { keyHash, action: input.action, count: nextCount, windowStart: now, blockedUntil },
          update: {
            action: input.action,
            count: nextCount,
            windowStart: windowExpired ? now : current!.windowStart,
            blockedUntil,
          },
        });

        return blockedUntil
          ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(blockMs / 1000)) }
          : { allowed: true, retryAfterSeconds: 0 };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2034") || attempt === 2) throw error;
    }
  }

  throw new Error("Rate-limit transaction retry exhausted.");
}

export function rateLimitError(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." } },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

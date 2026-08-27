import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const LOCAL_ALIASES = new Set(["localhost", "127.0.0.1", "::1"]);

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sameOrigin(request: NextRequest, value: string | null): boolean {
  if (!value) return false;
  try {
    const supplied = new URL(value);
    if (supplied.origin === request.nextUrl.origin) return true;
    return (
      LOCAL_ALIASES.has(supplied.hostname.toLowerCase()) &&
      LOCAL_ALIASES.has(request.nextUrl.hostname.toLowerCase()) &&
      supplied.protocol === request.nextUrl.protocol &&
      supplied.port === request.nextUrl.port
    );
  } catch {
    return false;
  }
}

/**
 * Remote-agent mutations hold a reusable device credential. Only the local UI
 * (or an explicitly keyed local caller) may trigger them, even when the legacy
 * ADMIN_API_KEY setting is absent.
 */
export function requireTrustedLocalMutation(request: NextRequest): NextResponse | null {
  const configuredKey = process.env.ADMIN_API_KEY?.trim();
  const providedKey = request.headers.get("x-admin-api-key")?.trim();
  if (configuredKey && providedKey && safeEqual(providedKey, configuredKey)) return null;

  if (sameOrigin(request, request.headers.get("origin"))) return null;
  if (sameOrigin(request, request.headers.get("referer"))) return null;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return null;

  return NextResponse.json(
    { success: false, error: "로컬 앱에서 시작한 요청만 허용됩니다." },
    { status: 403 },
  );
}

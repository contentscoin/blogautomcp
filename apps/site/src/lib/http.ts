import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";

export function apiError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

export async function readObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  const maxBytes = 64 * 1024;
  if (!requestBodyWithinLimit(request, maxBytes)) return null;

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) return null;
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hasValidBrowserOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  try {
    const expected = new URL(getSiteUrl()).origin;
    const actual = new URL(origin).origin;
    return actual === expected || (process.env.NODE_ENV !== "production" && actual === request.nextUrl.origin);
  } catch {
    return false;
  }
}

export function requestBodyWithinLimit(request: NextRequest, maxBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return true;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length >= 0 && length <= maxBytes;
}

export function safeReturnTo(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function getRequestId(request: NextRequest): string | null {
  return request.headers.get("x-request-id") || request.headers.get("x-vercel-id");
}

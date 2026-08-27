import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { clearRemoteActivation, readRemoteActivation, saveRemoteActivation } from "@/lib/remote-activation";

function getConfig() {
  return readRemoteActivation();
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const config = getConfig();
  return NextResponse.json({ success: true, data: { configured: Boolean(config.siteUrl && config.deviceId && config.deviceToken), siteUrl: config.siteUrl || null, deviceId: config.deviceId || null } });
}

export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  let body: { mcpUrl?: string; deviceName?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "잘못된 요청 형식입니다." }, { status: 400 }); }
  const mcpUrl = body.mcpUrl?.trim() || "";
  const deviceName = body.deviceName?.trim() || os.hostname();
  let parsed: URL;
  try { parsed = new URL(mcpUrl); } catch { return NextResponse.json({ success: false, error: "MCP URL 형식을 확인하세요." }, { status: 422 }); }
  if (!/\/api\/mcp\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.pathname)) return NextResponse.json({ success: false, error: "BlogAutoMCP에서 발급한 MCP URL이 아닙니다." }, { status: 422 });
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) return NextResponse.json({ success: false, error: "HTTPS MCP URL만 연결할 수 있습니다." }, { status: 422 });

  const siteUrl = parsed.origin;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${siteUrl}/api/device/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mcpUrl, deviceName, platform: `${process.platform}-${process.arch}`, appVersion: process.env.DESKTOP_APP_VERSION || process.env.npm_package_version || "1.0.0" }), signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.deviceToken || !payload?.data?.deviceId) return NextResponse.json({ success: false, error: payload?.error?.message || "사이트에서 PC 인증을 완료하지 못했습니다." }, { status: response.status || 502 });
    saveRemoteActivation({ siteUrl, deviceId: payload.data.deviceId, deviceToken: payload.data.deviceToken });
    return NextResponse.json({ success: true, data: { configured: true, siteUrl, deviceId: payload.data.deviceId }, message: "이 PC가 활성 장치로 연결되었습니다. 기존 PC 인증이 있었다면 폐기되었습니다." });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "사이트 연결에 실패했습니다." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function DELETE(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  clearRemoteActivation();
  return NextResponse.json({ success: true, data: { configured: false } });
}

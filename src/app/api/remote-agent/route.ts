import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { clearRemoteActivation, readRemoteActivation, saveRemoteActivation } from "@/lib/remote-activation";
import { DEFAULT_REMOTE_SITE_URL, isAllowedRemoteSiteOrigin, normalizeRemoteSiteOrigin } from "@/lib/remote-site";
import { devicePairingProof } from "@/lib/remote-device-pairing";
import { getUserDataRoot } from "../../../../scripts/lib/app-paths";

function getConfig() {
  return readRemoteActivation();
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const config = getConfig();
  return NextResponse.json({
    success: true,
    data: {
      configured: Boolean(config.siteUrl && config.deviceId && config.deviceToken),
      siteUrl: config.siteUrl || null,
      deviceId: config.deviceId || null,
      defaultSiteUrl: DEFAULT_REMOTE_SITE_URL,
    },
  });
}

type PairRequest =
  | { kind: "pair-code"; siteUrl: string; body: Record<string, unknown> }
  | { kind: "mcp-url"; siteUrl: string; body: Record<string, unknown> };
let pairingActive = false;

function buildPairRequest(body: { mcpUrl?: unknown; pairCode?: unknown; siteUrl?: unknown; deviceName?: unknown }): PairRequest | NextResponse {
  const deviceName = (typeof body.deviceName === "string" && body.deviceName.trim()) || os.hostname();
  const common = { deviceName, platform: `${process.platform}-${process.arch}`, appVersion: process.env.DESKTOP_APP_VERSION || process.env.npm_package_version || "1.0.0" };

  const pairCode = typeof body.pairCode === "string" ? body.pairCode.trim() : "";
  if (pairCode) {
    const requested = typeof body.siteUrl === "string" && body.siteUrl.trim() ? body.siteUrl : DEFAULT_REMOTE_SITE_URL;
    const siteUrl = normalizeRemoteSiteOrigin(requested);
    if (!siteUrl) return NextResponse.json({ success: false, error: "사이트 주소 형식을 확인하세요." }, { status: 422 });
    if (!isAllowedRemoteSiteOrigin(siteUrl)) return NextResponse.json({ success: false, error: "허용되지 않은 사이트 주소입니다. BlogAutoMCP 사이트에서 발급한 연결 코드인지 확인하세요." }, { status: 422 });
    if (pairCode.replace(/[\s-]/g, "").length !== 8) return NextResponse.json({ success: false, error: "연결 코드는 8자입니다." }, { status: 422 });
    return { kind: "pair-code", siteUrl, body: { pairCode, ...common } };
  }

  const mcpUrl = typeof body.mcpUrl === "string" ? body.mcpUrl.trim() : "";
  let parsed: URL;
  try { parsed = new URL(mcpUrl); } catch { return NextResponse.json({ success: false, error: "연결 코드 또는 MCP URL 을 입력하세요." }, { status: 422 }); }
  if (!/\/api\/mcp\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.pathname)) return NextResponse.json({ success: false, error: "BlogAutoMCP에서 발급한 MCP URL이 아닙니다." }, { status: 422 });
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) return NextResponse.json({ success: false, error: "HTTPS MCP URL만 연결할 수 있습니다." }, { status: 422 });
  if (!isAllowedRemoteSiteOrigin(parsed.origin)) return NextResponse.json({ success: false, error: "허용되지 않은 MCP URL입니다. BlogAutoMCP 사이트에서 발급한 주소인지 확인하세요." }, { status: 422 });
  return { kind: "mcp-url", siteUrl: parsed.origin, body: { mcpUrl, ...common } };
}

/**
 * 이 PC 를 사이트의 활성 장치로 연결한다.
 * - { pairCode, siteUrl? }: 사이트 "PC 앱 연결" 버튼(딥링크) 또는 코드 수동 입력 — 기본 경로
 * - { mcpUrl }: MCP URL 붙여넣기 — 구버전 호환
 */
export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  let body: { mcpUrl?: unknown; pairCode?: unknown; siteUrl?: unknown; deviceName?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "잘못된 요청 형식입니다." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, error: "잘못된 요청 형식입니다." }, { status: 400 });
  const pairRequest = buildPairRequest(body);
  if (pairRequest instanceof NextResponse) return pairRequest;

  const { siteUrl } = pairRequest;
  if (pairingActive) return NextResponse.json({ success: false, code: "PAIRING_BUSY", error: "PC 연결 확인이 진행 중입니다. 같은 요청의 결과를 기다리세요." }, { status: 409 });
  pairingActive = true;
  const intent = pairRequest.kind === "pair-code" ? String(pairRequest.body.pairCode).toUpperCase().replace(/[\s-]/g, "") : String(pairRequest.body.mcpUrl);
  const proof = devicePairingProof(getUserDataRoot(), siteUrl, intent);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let token: string;
    try { token = proof.get(); }
    catch { return NextResponse.json({ success: false, code: "PAIRING_PROOF_UNWRITABLE", error: "PC 연결 확인 기록을 저장하지 못해 요청하지 않았습니다. 저장소를 확인하세요." }, { status: 503 }); }
    const completed = proof.completed(getConfig());
    if (completed && !completed.proofAccepted) {
      // An older server ignores the proof. A known saved local activation can
      // acknowledge a duplicate click without replacing that device again.
      return NextResponse.json({ success: true, data: { configured: true, siteUrl, deviceId: completed.deviceId, method: pairRequest.kind, defaultSiteUrl: DEFAULT_REMOTE_SITE_URL }, message: "이 PC의 연결 정보를 이미 저장했습니다." });
    }
    const wireBody = JSON.stringify({ ...pairRequest.body, deviceToken: token });
    let response: Response | undefined;
    let payload: { success?: boolean; data?: { deviceId?: string; deviceToken?: string }; error?: { code?: string; message?: string } } = {};
    // Legacy servers cannot replay an MCP URL proof. Never automatically repeat
    // that mutation after an unknown response; short codes are consumed once.
    const attempts = pairRequest.kind === "pair-code" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        response = await fetch(`${siteUrl}/api/device/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: wireBody, signal: controller.signal });
        payload = await response.json().catch(() => ({}));
        if (response.status < 500 && (response.ok ? payload.success === true && payload.data?.deviceId && payload.data?.deviceToken : true)) break;
      } catch (error) { if (attempt === attempts - 1 || controller.signal.aborted) throw error; }
    }
    if (!response) throw new Error("사이트 연결 응답을 확인하지 못했습니다.");
    if (!response.ok) {
      return NextResponse.json({ success: false, code: payload?.error?.code, error: payload?.error?.message || "사이트에서 PC 인증을 완료하지 못했습니다." }, { status: response.status || 502 });
    }
    if (payload.success !== true || typeof payload.data?.deviceId !== "string" || typeof payload.data?.deviceToken !== "string" || !/^device_[A-Za-z0-9_-]{16}$/.test(payload.data.deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(payload.data.deviceToken)) throw new Error("PC 인증 응답을 확인할 수 없습니다.");
    saveRemoteActivation({ siteUrl, deviceId: payload.data.deviceId, deviceToken: payload.data.deviceToken });
    // A lost local HTTP response or duplicate deep link uses the same receipt.
    // Activation is already durable; failed receipt updates retain its proof.
    try { proof.complete(payload.data.deviceId, payload.data.deviceToken); } catch { /* Preserve the pending proof. */ }
    return NextResponse.json({
      success: true,
      data: { configured: true, siteUrl, deviceId: payload.data.deviceId, method: pairRequest.kind, defaultSiteUrl: DEFAULT_REMOTE_SITE_URL },
      message: "이 PC가 활성 장치로 연결되었습니다. 기존 PC 인증이 있었다면 폐기되었습니다.",
    });
  } catch {
    return NextResponse.json({ success: false, code: "PAIRING_RESPONSE_UNCERTAIN", error: "PC 연결 응답을 확인하지 못했습니다. 같은 연결 코드로 다시 확인하세요. 연결 확인 기록은 보존했습니다." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
    pairingActive = false;
  }
}

export async function DELETE(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  if (pairingActive) return NextResponse.json({ success: false, code: "PAIRING_BUSY", error: "PC 연결 확인이 진행 중입니다. 결과를 확인한 뒤 연결을 해제하세요." }, { status: 409 });
  clearRemoteActivation();
  return NextResponse.json({ success: true, data: { configured: false } });
}

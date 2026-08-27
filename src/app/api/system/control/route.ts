import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/api-auth";
import { getDesktopReadiness } from "@/lib/desktop-readiness";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DesktopControlState {
  available: boolean;
  restarting: boolean;
  update: {
    status: string;
    version: string;
    progress: number;
    error: string;
  } | null;
}

interface DesktopControlBridge {
  restartServer(): Promise<void>;
  checkForUpdates(): Promise<DesktopControlState["update"]>;
  getState(): DesktopControlState;
}

declare global {
  // Electron and the embedded Next server share one Node.js process.
  var __brandconnectDesktopControl: DesktopControlBridge | undefined;
}

function getBridge(): DesktopControlBridge | null {
  return globalThis.__brandconnectDesktopControl ?? null;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  const bridge = getBridge();
  return NextResponse.json(
    {
      success: true,
      data: bridge?.getState() ?? { available: false, restarting: false, update: null },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const bridge = getBridge();
  if (!bridge) {
    return NextResponse.json(
      { success: false, error: "이 기능은 설치된 Electron 프로그램에서만 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  if (body.action === "check-updates") {
    try {
      const update = await bridge.checkForUpdates();
      return NextResponse.json({
        success: true,
        data: { update },
        message: update?.error ? "업데이트 서버 응답을 확인하세요." : "새 버전 확인을 완료했습니다.",
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "업데이트 확인에 실패했습니다." },
        { status: 503 },
      );
    }
  }

  if (body.action === "restart-server") {
    const readiness = await getDesktopReadiness();
    if (!readiness.ready) {
      return NextResponse.json(
        {
          success: false,
          code: "DESKTOP_BUSY",
          error: `현재 ${readiness.activeCount}개의 자동화 작업이 실행 중입니다. 작업이 끝난 뒤 다시 시작하세요.`,
          data: readiness,
        },
        { status: 409 },
      );
    }

    if (bridge.getState().restarting) {
      return NextResponse.json(
        { success: true, data: bridge.getState(), message: "로컬 서버가 이미 다시 시작 중입니다." },
        { status: 202 },
      );
    }

    setTimeout(() => {
      void bridge.restartServer().catch((error) => {
        console.error("로컬 서버 재시작 실패:", error);
      });
    }, 250);

    return NextResponse.json(
      { success: true, data: { restarting: true }, message: "로컬 서버를 다시 시작합니다." },
      { status: 202 },
    );
  }

  return NextResponse.json({ success: false, error: "지원하지 않는 제어 명령입니다." }, { status: 422 });
}

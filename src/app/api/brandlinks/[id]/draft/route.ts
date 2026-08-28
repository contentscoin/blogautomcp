import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import {
  approveBrandPostPackage,
  getBrandPostPackageDir,
  getBrandPostPackageManifestPath,
  packagePreview,
  readBrandPostPackage,
} from "@/lib/brand-post-package";

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  try {
    const manifest = readBrandPostPackage(id);
    return NextResponse.json({ success: true, data: manifest ? packagePreview(manifest) : null });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "초안 조회 실패" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "approve") {
    return NextResponse.json({ success: false, error: "지원하지 않는 초안 작업입니다." }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: packagePreview(approveBrandPostPackage(id)) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "초안 승인 실패" }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const updateError = requireNoPendingDesktopUpdate();
  if (updateError) return updateError;
  const { id } = await params;
  const link = await prisma.brandLink.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!link) return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
  if (link.status === "PUBLISHING") return NextResponse.json({ success: false, error: "현재 발행 중인 상품입니다." }, { status: 409 });

  const packageDir = getBrandPostPackageDir(id);
  fs.mkdirSync(packageDir, { recursive: true });
  const logPath = path.join(packageDir, "prepare.log");
  const logFd = fs.openSync(logPath, "a");
  const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath, id], {
        cwd: process.cwd(),
        stdio: ["ignore", logFd, logFd],
        shell: false,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          DRY_RUN_GENERATE_ONLY: "true",
          DEBUG_SAVE_GENERATED_POST: "true",
          BRANDLINK_PREPARE_OUTPUT_DIR: packageDir,
          BROWSER_GPT_MODE: "false",
          ALLOW_CHATGPT_BROWSER_MODE: "false",
          CHATGPT_SKIP_POLISH: "false",
          HUMAN_MOBILE_POLISH_ENABLED: "true",
          BLOG_HUMANIZE_REWRITE_ENABLED: "true",
          PRODUCT_POST_LOCAL_FALLBACK_ENABLED: "false",
          PRODUCT_THUMBNAIL_CHATGPT_ENABLED: "false",
          PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED: "false",
        },
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (exit.code !== 0) throw new Error(`초안 생성 프로세스가 종료되었습니다(code=${exit.code}, signal=${exit.signal ?? "none"}).`);
    const manifest = readBrandPostPackage(id);
    if (!manifest) throw new Error(`초안 매니페스트가 생성되지 않았습니다: ${getBrandPostPackageManifestPath(id)}`);
    return NextResponse.json({ success: true, data: packagePreview(manifest), logPath });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "고품질 초안 생성 실패", logPath }, { status: 500 });
  } finally {
    fs.closeSync(logFd);
  }
}

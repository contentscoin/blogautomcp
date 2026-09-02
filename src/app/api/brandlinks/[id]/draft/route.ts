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
  readBrandPostPackageResult,
} from "@/lib/brand-post-package";

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

function readPrepareFailure(logPath: string, brandLinkId?: string): string | null {
  // 1순위: 파이프라인이 남긴 result.json (코드+메시지). 2순위: 로그 꼬리의 오류 줄.
  if (brandLinkId) {
    const result = readBrandPostPackageResult(brandLinkId);
    if (result && !result.ok && result.message) return `${result.code ? `[${result.code}] ` : ""}${result.message}`;
  }
  try {
    const tail = fs.readFileSync(logPath, "utf8").slice(-12_000);
    const matches = Array.from(tail.matchAll(/❌\s*(?:오류|실행 실패):\s*(.+)/g));
    return matches.at(-1)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

type PrepareEnv = Record<string, string | undefined>;

async function runPrepareProcess(id: string, packageDir: string, logPath: string, extraEnv: PrepareEnv): Promise<void> {
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
          // 데스크톱은 GPT 로그인을 요구하지 않는다. API 키가 없는 PC에서도
          // 상품별 로컬 초안 생성기로 계속 진행해 매니페스트를 완성한다.
          PRODUCT_POST_LOCAL_FALLBACK_ENABLED: "true",
          PRODUCT_THUMBNAIL_CHATGPT_ENABLED: "false",
          PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED: "false",
          ...extraEnv,
        },
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (exit.code !== 0) {
      const failure = readPrepareFailure(logPath, id);
      throw new Error(failure || `초안 생성 프로세스가 종료되었습니다(code=${exit.code}, signal=${exit.signal ?? "none"}).`);
    }
  } finally {
    fs.closeSync(logFd);
  }
}

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
  const body = await request.json().catch(() => ({})) as { action?: string; instructions?: unknown; sectionIndexes?: unknown };
  if (body.action === "approve") {
    try {
      return NextResponse.json({ success: true, data: packagePreview(approveBrandPostPackage(id)) });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "초안 승인 실패" }, { status: 400 });
    }
  }
  if (body.action === "revise") {
    const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 2000) : "";
    if (!instructions) return NextResponse.json({ success: false, error: "수정 지시(instructions)가 필요합니다." }, { status: 400 });
    const sectionIndexes = Array.isArray(body.sectionIndexes)
      ? body.sectionIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < 40)
      : [];
    const updateError = requireNoPendingDesktopUpdate();
    if (updateError) return updateError;
    const existing = readBrandPostPackage(id);
    if (!existing) return NextResponse.json({ success: false, error: "수정할 초안이 없습니다. 먼저 초안을 생성하세요." }, { status: 404 });
    if (existing.version !== "brand-post-package/v2") {
      return NextResponse.json({ success: false, error: "이 초안은 예전 형식이라 부분 수정을 지원하지 않습니다. 초안을 다시 생성하세요." }, { status: 409 });
    }
    const packageDir = getBrandPostPackageDir(id);
    const requestPath = path.join(packageDir, "revise-request.json");
    fs.writeFileSync(requestPath, JSON.stringify({ instructions, sectionIndexes, requestedAt: new Date().toISOString() }, null, 2), "utf8");
    const logPath = path.join(packageDir, "prepare.log");
    try {
      await runPrepareProcess(id, packageDir, logPath, {
        BRANDLINK_PREPARED_POST_MANIFEST: getBrandPostPackageManifestPath(id),
        BRANDLINK_REVISE_REQUEST: requestPath,
      });
      const manifest = readBrandPostPackage(id);
      if (!manifest) throw new Error("수정된 초안 매니페스트를 찾지 못했습니다.");
      return NextResponse.json({ success: true, data: packagePreview(manifest), logPath });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "초안 수정 실패", logPath }, { status: 500 });
    }
  }
  return NextResponse.json({ success: false, error: "지원하지 않는 초안 작업입니다." }, { status: 400 });
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

  const requestBody = await request.json().catch(() => ({})) as { memo?: unknown };
  const memo = typeof requestBody.memo === "string" ? requestBody.memo.trim().slice(0, 1000) : "";
  const packageDir = getBrandPostPackageDir(id);
  fs.mkdirSync(packageDir, { recursive: true });
  const logPath = path.join(packageDir, "prepare.log");
  try {
    await runPrepareProcess(id, packageDir, logPath, memo ? { BRANDLINK_DRAFT_MEMO: memo } : {});
    const manifest = readBrandPostPackage(id);
    if (!manifest) {
      const failure = readPrepareFailure(logPath, id);
      throw new Error(
        failure || `초안 매니페스트가 생성되지 않았습니다: ${getBrandPostPackageManifestPath(id)}`
      );
    }
    return NextResponse.json({ success: true, data: packagePreview(manifest), logPath });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "고품질 초안 생성 실패", logPath }, { status: 500 });
  }
}

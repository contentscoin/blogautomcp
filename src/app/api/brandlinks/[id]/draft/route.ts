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

type DraftAction = "prepare_context" | "submit_generated";
type SubmittedDraft = {
  version: "mcp-generated-draft/v1";
  title: string;
  sections: string[];
  hashtags: string[];
};

function normalizeSubmittedDraft(
  value: unknown,
  connectKind: "SHOPPING" | "TRAVEL",
): SubmittedDraft {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const sections = Array.isArray(input.sections)
    ? input.sections
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\r/g, "").trim())
        .filter(Boolean)
    : [];
  const hashtags = Array.isArray(input.hashtags)
    ? Array.from(new Set(input.hashtags
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/^#+/, "").trim())
        .filter(Boolean)))
    : [];
  const requiredSections = connectKind === "TRAVEL" ? 10 : 9;
  const requiredCharacters = connectKind === "TRAVEL" ? 3200 : 1800;
  const totalCharacters = sections.reduce((sum, section) => sum + section.length, 0);

  if (title.length < 8 || title.length > 100) {
    throw new Error("ChatGPT 원고 제목은 8~100자여야 합니다.");
  }
  if (sections.length < requiredSections || sections.length > 12) {
    throw new Error(`${connectKind === "TRAVEL" ? "여행" : "쇼핑"} 원고는 ${requiredSections}~12개 섹션이어야 합니다.`);
  }
  if (sections.some((section) => section.length < 80 || section.length > 8000)) {
    throw new Error("각 본문 섹션은 소제목을 포함해 80~8000자여야 합니다.");
  }
  if (totalCharacters < requiredCharacters || totalCharacters > 48_000) {
    throw new Error(`본문은 ${requiredCharacters}자 이상 48000자 이하여야 합니다. 현재 ${totalCharacters}자입니다.`);
  }
  if (hashtags.length < 3 || hashtags.length > 10) {
    throw new Error("해시태그는 3~10개여야 합니다.");
  }

  return { version: "mcp-generated-draft/v1", title, sections, hashtags };
}

function readPrepareFailure(logPath: string): string | null {
  try {
    const tail = fs.readFileSync(logPath, "utf8").slice(-12_000);
    const matches = Array.from(tail.matchAll(/❌\s*(?:오류|실행 실패):\s*(.+)/g));
    return matches.at(-1)?.[1]?.trim() || null;
  } catch {
    return null;
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
  const body = await request.json().catch(() => ({})) as {
    action?: DraftAction;
    qualityPreset?: string;
    experienceMode?: string;
    experienceNotes?: string;
    memo?: string;
    draft?: unknown;
  };
  const action: DraftAction | null =
    body.action === "prepare_context" || body.action === "submit_generated"
      ? body.action
      : null;
  if (body.action !== undefined && action === null) {
    return NextResponse.json({ success: false, error: "지원하지 않는 초안 생성 작업입니다." }, { status: 400 });
  }
  const qualityPreset = body.qualityPreset === "standard" ? "STANDARD" : "PREMIUM";
  const experienceMode = body.experienceMode === "verified_experience"
    ? "VERIFIED_EXPERIENCE"
    : "AI_ASSISTED_INFORMATION";
  const experienceNotes = typeof body.experienceNotes === "string" ? body.experienceNotes.trim().slice(0, 4000) : "";
  if (experienceMode === "VERIFIED_EXPERIENCE" && experienceNotes.length < 20) {
    return NextResponse.json({ success: false, error: "실제 체험형 문체를 사용하려면 구체적인 체험 사실 메모가 필요합니다." }, { status: 400 });
  }
  const link = await prisma.brandLink.findUnique({
    where: { id },
    select: { id: true, status: true, connectKind: true },
  });
  if (!link) return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
  if (link.status === "PUBLISHING") return NextResponse.json({ success: false, error: "현재 발행 중인 상품입니다." }, { status: 409 });
  const connectKind = link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  let submittedDraft: SubmittedDraft | null = null;
  if (action === "submit_generated") {
    try {
      submittedDraft = normalizeSubmittedDraft(body.draft, connectKind);
    } catch (error) {
      return NextResponse.json({
        success: false,
        code: "INVALID_GENERATED_DRAFT",
        error: error instanceof Error ? error.message : "ChatGPT 원고 형식을 확인하세요.",
      }, { status: 422 });
    }
  }

  if (!action) {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
    const hasProviderKey = provider === "gemini"
      ? Boolean((process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim())
      : Boolean(process.env.OPENAI_API_KEY?.trim());
    if (!hasProviderKey) {
      return NextResponse.json({
        success: false,
        code: "CHATGPT_MCP_DRAFT_REQUIRED",
        error:
          "데스크톱 단독 AI 원고 생성에는 별도 API 키가 필요합니다. API 키 없이 사용하려면 ChatGPT에서 BlogAutoMCP를 열고 해당 상품의 초안을 요청하세요.",
      }, { status: 409 });
    }
  }

  const packageDir = getBrandPostPackageDir(id);
  fs.mkdirSync(packageDir, { recursive: true });
  const logPath = path.join(
    packageDir,
    action === "prepare_context" ? "draft-context.log" : "prepare.log",
  );
  const logFd = fs.openSync(logPath, "a");
  const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");
  const contextPath = path.join(packageDir, "mcp-draft-context.json");
  const submittedDraftPath = path.join(packageDir, "mcp-generated-draft.json");
  try {
    if (action === "prepare_context") {
      fs.rmSync(contextPath, { force: true });
    }
    if (action === "submit_generated") {
      if (!submittedDraft) throw new Error("검증된 ChatGPT 원고가 없습니다.");
      fs.writeFileSync(submittedDraftPath, JSON.stringify(submittedDraft, null, 2), "utf8");
      fs.rmSync(getBrandPostPackageManifestPath(id), { force: true });
    }

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath, id], {
        cwd: process.cwd(),
        stdio: ["ignore", logFd, logFd],
        shell: false,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          DRY_RUN_GENERATE_ONLY: action === "prepare_context" ? "false" : "true",
          DEBUG_SAVE_GENERATED_POST: action === "prepare_context" ? "false" : "true",
          BRANDLINK_PREPARE_OUTPUT_DIR: action === "prepare_context" ? "" : packageDir,
          BRANDLINK_DRAFT_CONTEXT_OUTPUT: action === "prepare_context" ? contextPath : "",
          BRANDLINK_GENERATED_DRAFT_PATH: action === "submit_generated" ? submittedDraftPath : "",
          BROWSER_GPT_MODE: "false",
          ALLOW_CHATGPT_BROWSER_MODE: "false",
          CHATGPT_SKIP_POLISH: "false",
          HUMAN_MOBILE_POLISH_ENABLED: "true",
          BLOG_HUMANIZE_REWRITE_ENABLED: action === "submit_generated" ? "false" : "true",
          PRODUCT_THUMBNAIL_CHATGPT_ENABLED: "false",
          PRODUCT_THUMBNAIL_IMAGE_API_ENABLED: action ? "false" : process.env.PRODUCT_THUMBNAIL_IMAGE_API_ENABLED,
          PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED: "false",
          BRANDLINK_QUALITY_PRESET: qualityPreset,
          BRANDLINK_EXPERIENCE_MODE: experienceMode,
          BRANDLINK_EXPERIENCE_NOTES: experienceNotes,
          // OAuth MCP 제출 모드에서는 PC가 OpenAI API를 절대 호출하지 않도록 강제로 비운다.
          ...(action ? { OPENAI_API_KEY: "" } : {}),
        },
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (exit.code !== 0) {
      const failure = readPrepareFailure(logPath);
      throw new Error(failure || `초안 생성 프로세스가 종료되었습니다(code=${exit.code}, signal=${exit.signal ?? "none"}).`);
    }
    if (action === "prepare_context") {
      if (!fs.existsSync(contextPath)) {
        const failure = readPrepareFailure(logPath);
        throw new Error(failure || `초안 컨텍스트가 생성되지 않았습니다: ${contextPath}`);
      }
      const contextData = JSON.parse(fs.readFileSync(contextPath, "utf8")) as Record<string, unknown>;
      if (contextData.version !== "brand-draft-context/v1") {
        throw new Error("초안 컨텍스트 형식이 올바르지 않습니다.");
      }
      return NextResponse.json({ success: true, data: contextData, logPath });
    }
    const manifest = readBrandPostPackage(id);
    if (!manifest) {
      const failure = readPrepareFailure(logPath);
      throw new Error(
        failure || `초안 매니페스트가 생성되지 않았습니다: ${getBrandPostPackageManifestPath(id)}`
      );
    }
    return NextResponse.json({ success: true, data: packagePreview(manifest), logPath });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "고품질 초안 생성 실패", logPath }, { status: 500 });
  } finally {
    fs.closeSync(logFd);
    if (action === "submit_generated") {
      fs.rmSync(submittedDraftPath, { force: true });
    }
  }
}

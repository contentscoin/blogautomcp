import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { buildChatGptDraftHandoff } from "@/lib/chatgpt-draft-handoff";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAuthenticationError,
  isChatGptBrowserAutomationEnabled,
  readChatGptBrowserSessionSummary,
} from "@/lib/chatgpt-browser-automation";
import { beginDesktopActivity } from "@/lib/desktop-activity";
import {
  approveBrandPostPackage,
  applyGeneratedBrandPostImage,
  getBrandPostPackageDir,
  getBrandPostPackageManifestPath,
  packagePreview,
  readBrandPostPackage,
} from "@/lib/brand-post-package";
import { generateBrandPostImages } from "@/lib/brand-post-image-generation";
import { getPostCompositionContract } from "@/lib/post-composition-contract";
import { readCodexLocalStatus } from "@/lib/codex-local";

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

type DraftAction = "prepare_context" | "submit_generated";
type SubmittedDraft = {
  version: "mcp-generated-draft/v1";
  title: string;
  evidenceFacts: string[];
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
  const evidenceFacts = Array.isArray(input.evidenceFacts)
    ? Array.from(new Set(input.evidenceFacts
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 220))
        .filter((item) => item.length >= 4)))
      .slice(0, 12)
    : [];
  const contract = getPostCompositionContract(connectKind);
  const requiredSections = contract.targetSections.min;
  const requiredCharacters = contract.targetCharacters.min;
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

  return { version: "mcp-generated-draft/v1", title, evidenceFacts, sections, hashtags };
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

async function autoRepairTravelImages(options: {
  brandLinkId: string;
  productName: string;
}) {
  if ((process.env.TRAVEL_AUTO_IMAGE_QC_REPAIR || "true").toLowerCase() === "false") {
    return { manifest: readBrandPostPackage(options.brandLinkId), warning: null as string | null };
  }
  let manifest = readBrandPostPackage(options.brandLinkId);
  if (!manifest || manifest.version !== "brand-post-package/v2" || manifest.connectKind !== "TRAVEL") {
    return { manifest, warning: null as string | null };
  }
  const preview = packagePreview(manifest);
  const requests = preview.imageSlots.flatMap((slot) =>
    Array.from({ length: slot.missing }, () => ({
      requestId: randomUUID(),
      sectionId: slot.sectionId,
    })),
  ).slice(0, 4);
  if (requests.length === 0) return { manifest, warning: null as string | null };

  try {
    const results = await generateBrandPostImages({
      manifest,
      productName: options.productName || manifest.title,
      requests,
    });
    const failures: string[] = [];
    for (const result of results) {
      if (!result.generatedPath) {
        failures.push(result.error || "GPT Image 결과가 비어 있습니다.");
        continue;
      }
      applyGeneratedBrandPostImage({
        brandLinkId: options.brandLinkId,
        generatedPath: result.generatedPath,
        sectionId: result.sectionId,
        replaceAssetKey: result.replaceAssetKey,
        provenance: result.provenance,
        imageIntent: result.imageIntent,
      });
    }
    manifest = readBrandPostPackage(options.brandLinkId);
    return {
      manifest,
      warning: failures.length > 0 ? `저품질 이미지 자동 대체 일부 실패: ${failures.join(" ")}` : null,
    };
  } catch (error) {
    return {
      manifest,
      warning: `저품질 이미지 GPT Image 자동 대체 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    };
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
    const manifest = approveBrandPostPackage(id);
    await prisma.brandLink.updateMany({
      where: { id, status: { in: ["READY", "FAILED"] } },
      data: { status: "READY", errorMessage: null },
    });
    return NextResponse.json({ success: true, data: packagePreview(manifest) });
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
    forceQualityRepair?: boolean;
    autoApprove?: boolean;
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
    select: { id: true, status: true, connectKind: true, productName: true, memo: true },
  });
  if (!link) return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
  if (link.status === "PUBLISHING") return NextResponse.json({ success: false, error: "현재 발행 중인 상품입니다." }, { status: 409 });
  if (link.status === "DRAFTING") return NextResponse.json({ success: false, error: "현재 초안을 작성 중인 상품입니다." }, { status: 409 });
  const connectKind = link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const hasProviderKey = provider === "gemini"
    ? Boolean((process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim())
    : provider === "openai"
      ? Boolean(process.env.OPENAI_API_KEY?.trim())
      : false;
  const browserAutomationEnabled = isChatGptBrowserAutomationEnabled();
  const codexEnabled = (process.env.CODEX_DRAFT_ENABLED || "true").trim().toLowerCase() === "true";
  const codexStatus = !action && codexEnabled ? readCodexLocalStatus() : null;
  const useCodex = !action && codexEnabled && Boolean(codexStatus?.authenticated);
  const useBrowserChatGpt = !action && !useCodex && !hasProviderKey && browserAutomationEnabled;
  const browserSession = browserAutomationEnabled ? readChatGptBrowserSessionSummary() : null;
  const handoff = () => buildChatGptDraftHandoff({
    productId: link.id,
    productName: link.productName,
    memo: link.memo,
    connectKind,
  });
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
    if (!useCodex && !hasProviderKey && !browserAutomationEnabled) {
      return NextResponse.json({
        success: false,
        code: codexEnabled ? "CODEX_LOGIN_REQUIRED" : "CHATGPT_MCP_DRAFT_REQUIRED",
        error: codexEnabled
          ? "Codex 로그인이 필요합니다. 로컬 프로그램 제어에서 Codex를 연결해 주세요."
          : "이 PC에는 데스크톱용 AI API 키가 없습니다. ChatGPT 연결로 이어서 만들 수 있습니다.",
        data: {
          handoff: handoff(),
          codex: codexStatus,
        },
      }, { status: 409 });
    }
    if (useBrowserChatGpt) {
      const session = browserSession || readChatGptBrowserSessionSummary();
      if (!session.isValid) {
        return NextResponse.json({
          success: false,
          code: "CHATGPT_BROWSER_LOGIN_REQUIRED",
          error: session.error || "ChatGPT 웹 자동작성을 사용하려면 로그인이 필요합니다.",
          data: { handoff: handoff(), session },
        }, { status: 409 });
      }
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
  const finishDraftActivity = beginDesktopActivity(
    action === "prepare_context"
      ? "mcp-draft-context"
      : action === "submit_generated"
        ? "mcp-draft-submit"
        : useCodex
          ? "codex-draft"
          : useBrowserChatGpt
          ? "chatgpt-browser-draft"
          : "api-draft",
  );
  const draftClaim = await prisma.brandLink.updateMany({
    where: { id, status: link.status },
    data: { status: "DRAFTING", errorMessage: null },
  });
  if (draftClaim.count !== 1) {
    finishDraftActivity();
    fs.closeSync(logFd);
    return NextResponse.json({
      success: false,
      error: "상품 상태가 변경되어 초안 작성을 시작하지 못했습니다. 목록을 새로고침해 주세요.",
    }, { status: 409 });
  }
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
          ...buildChatGptBrowserAutomationEnv(useBrowserChatGpt),
          AI_PROVIDER: useCodex ? "codex" : provider,
          CODEX_DRAFT_ENABLED: useCodex ? "true" : "false",
          CODEX_BROWSER_FALLBACK_ENABLED:
            useCodex && browserAutomationEnabled && browserSession?.isValid ? "true" : "false",
          ALLOW_CHATGPT_BROWSER_MODE:
            useCodex && browserAutomationEnabled && browserSession?.isValid
              ? "true"
              : useBrowserChatGpt
                ? "true"
                : "false",
          BROWSER_GPT_MODE: useBrowserChatGpt ? "true" : "false",
          HUMAN_MOBILE_POLISH_ENABLED: "true",
          BLOG_HUMANIZE_REWRITE_ENABLED: action === "submit_generated" ? "false" : "true",
          PRODUCT_THUMBNAIL_CHATGPT_ENABLED: "false",
          PRODUCT_THUMBNAIL_IMAGE_API_ENABLED: action ? "false" : process.env.PRODUCT_THUMBNAIL_IMAGE_API_ENABLED,
          PRODUCT_THUMBNAIL_CODEX_IMAGEGEN_FALLBACK_ENABLED: "false",
          BRANDLINK_QUALITY_PRESET: qualityPreset,
          BRANDLINK_EXPERIENCE_MODE: experienceMode,
          BRANDLINK_EXPERIENCE_NOTES: experienceNotes,
          BRANDLINK_FORCE_QUALITY_REPAIR: body.forceQualityRepair === true ? "true" : "false",
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
      await prisma.brandLink.update({
        where: { id },
        data: {
          status: link.status === "FAILED" ? "READY" : link.status,
          errorMessage: null,
        },
      });
      return NextResponse.json({ success: true, data: contextData, logPath });
    }
    const manifest = readBrandPostPackage(id);
    if (!manifest) {
      const failure = readPrepareFailure(logPath);
      throw new Error(
        failure || `초안 매니페스트가 생성되지 않았습니다: ${getBrandPostPackageManifestPath(id)}`
      );
    }
    const imageRepair = await autoRepairTravelImages({
      brandLinkId: id,
      productName: link.productName || manifest.title,
    });
    let finalizedManifest = imageRepair.manifest || manifest;
    let approvalWarning: string | null = null;
    if (body.autoApprove === true) {
      try {
        finalizedManifest = approveBrandPostPackage(id);
      } catch (error) {
        approvalWarning = error instanceof Error ? error.message : "자동 승인에 실패했습니다.";
      }
    }
    await prisma.brandLink.update({
      where: { id },
      data: { status: "READY", errorMessage: null },
    });
    return NextResponse.json({
      success: true,
      data: packagePreview(finalizedManifest),
      autoApproved: Boolean(finalizedManifest.approvedAt),
      approvalWarning,
      imageRepairWarning: imageRepair.warning,
      logPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "고품질 초안 생성 실패";
    await prisma.brandLink.update({
      where: { id },
      data: { status: "FAILED", errorMessage: message },
    }).catch(() => undefined);
    if (useBrowserChatGpt) {
      const authenticationRequired = isChatGptBrowserAuthenticationError(message);
      return NextResponse.json({
        success: false,
        code: authenticationRequired
          ? "CHATGPT_BROWSER_LOGIN_REQUIRED"
          : "CHATGPT_BROWSER_FALLBACK_REQUIRED",
        error: authenticationRequired
          ? `ChatGPT 로그인 또는 보안 확인이 필요합니다: ${message}`
          : `ChatGPT 웹 자동작성에 실패했습니다: ${message}`,
        data: {
          handoff: handoff(),
          browserError: message,
        },
        logPath,
      }, { status: 409 });
    }
    if (useCodex) {
      return NextResponse.json({
        success: false,
        code: "CODEX_DRAFT_FAILED",
        error: `GPT 원고 작성에 실패했습니다: ${message}`,
        data: { handoff: handoff(), codex: codexStatus },
        logPath,
      }, { status: 500 });
    }
    return NextResponse.json({ success: false, error: message, logPath }, { status: 500 });
  } finally {
    finishDraftActivity();
    fs.closeSync(logFd);
    if (action === "submit_generated") {
      fs.rmSync(submittedDraftPath, { force: true });
    }
  }
}

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
import { classifyLocalFailure } from "@/lib/local-automation-error";
import {
  approveBrandPostPackage,
  applyGeneratedBrandPostImage,
  getBrandPostPackageDir,
  getBrandPostPackageManifestPath,
  packagePreview,
  readBrandPostPackage,
  readBrandPostPackageResult,
} from "@/lib/brand-post-package";
import { generateBrandPostImages } from "@/lib/brand-post-image-generation";
import {
  getPostCompositionContract,
  stripAffiliateDisclosureFromTitle,
} from "@/lib/post-composition-contract";
import { readCodexLocalStatus } from "@/lib/codex-local";
import { readProductSnapshot } from "@/lib/draft-context-snapshot";

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");

type DraftAction = "prepare_context" | "submit_generated";
type SubmittedDraft = {
  version: "mcp-generated-draft/v1";
  title: string;
  evidenceFacts: string[];
  sections: string[];
  hashtags: string[];
};

interface PrepareFailure {
  code: string;
  message: string;
}

class PrepareProcessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeSubmittedDraft(
  value: unknown,
  connectKind: "SHOPPING" | "TRAVEL",
): SubmittedDraft {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const title = typeof input.title === "string"
    ? stripAffiliateDisclosureFromTitle(input.title)
    : "";
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

/** 1순위: 파이프라인이 남긴 result.json (코드+메시지). 2순위: 로그 꼬리의 오류 줄. */
function readPrepareFailure(logPath: string, brandLinkId?: string): PrepareFailure | null {
  if (brandLinkId) {
    const result = readBrandPostPackageResult(brandLinkId);
    if (result && !result.ok && result.message) return { code: result.code || "LOCAL_AUTOMATION_FAILED", message: result.message };
  }
  try {
    const tail = fs.readFileSync(logPath, "utf8").slice(-12_000);
    const matches = Array.from(tail.matchAll(/❌\s*(?:오류|실행 실패):\s*(.+)/g));
    const message = matches.at(-1)?.[1]?.trim();
    return message ? { code: classifyLocalFailure({ message }), message } : null;
  } catch {
    return null;
  }
}

function failureResponse(error: unknown, fallbackMessage: string, status: number, extra: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const code = error instanceof PrepareProcessError ? error.code : classifyLocalFailure({ message, status });
  return NextResponse.json({ success: false, code, error: message, ...extra }, { status });
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
  try {
    const failures: string[] = [];
    for (let batch = 0; batch < 4; batch += 1) {
      const preview = packagePreview(manifest);
      const beforeMissing = preview.imageSlots.reduce((sum, slot) => sum + slot.generationMissing, 0);
      const requests = preview.imageSlots.flatMap((slot) => {
        const replaceableOriginal = slot.assets.find((asset) => asset?.provenance === "ORIGINAL");
        return Array.from({ length: slot.generationMissing }, () => ({
          requestId: randomUUID(),
          sectionId: slot.sectionId,
          replaceAssetKey: slot.count >= slot.maximum ? replaceableOriginal?.assetKey : undefined,
        }));
      }).filter((request) => request.replaceAssetKey || preview.imageSlots.some(
        (slot) => slot.sectionId === request.sectionId && slot.count < slot.maximum,
      )).slice(0, 4);
      if (requests.length === 0) break;

      const results = await generateBrandPostImages({
        manifest,
        productName: options.productName || manifest.title,
        requests,
      });
      for (const result of results) {
        if (!result.generatedPath) {
          failures.push(result.error || "ChatGPT 이미지 결과가 비어 있습니다.");
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
      if (!manifest || manifest.version !== "brand-post-package/v2") break;
      const afterMissing = packagePreview(manifest).imageSlots.reduce(
        (sum, slot) => sum + slot.generationMissing,
        0,
      );
      if (afterMissing >= beforeMissing || failures.length > 0) break;
    }
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

/** 초안 부분 수정: simple-agent 를 수정 모드(BRANDLINK_REVISE_REQUEST)로 실행한다. 네이버 세션은 필요 없다. */
async function runRevision(id: string, packageDir: string, instructions: string, sectionIndexes: number[]): Promise<void> {
  const requestPath = path.join(packageDir, "revise-request.json");
  fs.writeFileSync(requestPath, JSON.stringify({ instructions, sectionIndexes, requestedAt: new Date().toISOString() }, null, 2), "utf8");
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
          BRANDLINK_PREPARED_POST_MANIFEST: getBrandPostPackageManifestPath(id),
          BRANDLINK_REVISE_REQUEST: requestPath,
          BROWSER_GPT_MODE: "false",
          ALLOW_CHATGPT_BROWSER_MODE: "false",
          AI_PROVIDER: "openai",
        },
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (exit.code !== 0) {
      const failure = readPrepareFailure(logPath, id);
      if (failure) throw new PrepareProcessError(failure.code, failure.message);
      throw new PrepareProcessError("LOCAL_AUTOMATION_FAILED", `초안 수정 프로세스가 종료되었습니다(code=${exit.code}, signal=${exit.signal ?? "none"}).`);
    }
  } finally {
    fs.closeSync(logFd);
    fs.rmSync(requestPath, { force: true });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string; instructions?: unknown; sectionIndexes?: unknown };
  if (body.action === "approve") {
    try {
      const manifest = approveBrandPostPackage(id);
      await prisma.brandLink.updateMany({
        where: { id, status: { in: ["READY", "FAILED"] } },
        data: { status: "READY", errorMessage: null },
      });
      return NextResponse.json({ success: true, data: packagePreview(manifest) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "초안 승인 실패";
      const code = /승인할 고품질 초안이 없/u.test(message) ? "DRAFT_NOT_FOUND" : /품질|게이트|검사/u.test(message) ? "CONTENT_BLOCKED" : classifyLocalFailure({ message, status: 400 });
      return NextResponse.json({ success: false, code, error: message }, { status: 400 });
    }
  }
  if (body.action === "revise") {
    const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 2000) : "";
    if (!instructions) return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "수정 지시(instructions)가 필요합니다." }, { status: 400 });
    const sectionIndexes = Array.isArray(body.sectionIndexes)
      ? body.sectionIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < 40)
      : [];
    const updateError = requireNoPendingDesktopUpdate();
    if (updateError) return updateError;
    const link = await prisma.brandLink.findUnique({ where: { id }, select: { id: true, status: true, productName: true } });
    if (!link) return NextResponse.json({ success: false, code: "PRODUCT_NOT_FOUND", error: "상품을 찾을 수 없습니다." }, { status: 404 });
    if (link.status === "PUBLISHING" || link.status === "DRAFTING") {
      return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "현재 발행 또는 초안 작성 중인 상품입니다." }, { status: 409 });
    }
    const existing = readBrandPostPackage(id);
    if (!existing) return NextResponse.json({ success: false, code: "DRAFT_NOT_FOUND", error: "수정할 초안이 없습니다. 먼저 초안을 생성하세요." }, { status: 404 });
    if (existing.version !== "brand-post-package/v2" || !existing.postSpec) {
      return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "이 초안은 Spec-first 스펙이 없어 부분 수정을 지원하지 않습니다(ChatGPT 제출 초안 등). 초안을 다시 생성하세요." }, { status: 409 });
    }
    const packageDir = getBrandPostPackageDir(id);
    const logPath = path.join(packageDir, "prepare.log");
    const finishActivity = beginDesktopActivity("draft-revise");
    const claim = await prisma.brandLink.updateMany({ where: { id, status: link.status }, data: { status: "DRAFTING", errorMessage: null } });
    if (claim.count !== 1) {
      finishActivity();
      return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "상품 상태가 변경되어 초안 수정을 시작하지 못했습니다." }, { status: 409 });
    }
    try {
      await runRevision(id, packageDir, instructions, sectionIndexes);
      const manifest = readBrandPostPackage(id);
      if (!manifest) throw new PrepareProcessError("LOCAL_AUTOMATION_FAILED", "수정된 초안 매니페스트를 찾지 못했습니다.");
      await prisma.brandLink.update({ where: { id }, data: { status: "READY", errorMessage: null } });
      return NextResponse.json({ success: true, data: packagePreview(manifest), logPath });
    } catch (error) {
      await prisma.brandLink.update({ where: { id }, data: { status: "READY" } }).catch(() => undefined);
      return failureResponse(error, "초안 수정 실패", 500, { logPath });
    } finally {
      finishActivity();
    }
  }
  return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "지원하지 않는 초안 작업입니다." }, { status: 400 });
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
    contextSnapshot?: unknown;
    forceQualityRepair?: boolean;
    autoApprove?: boolean;
  };
  const action: DraftAction | null =
    body.action === "prepare_context" || body.action === "submit_generated"
      ? body.action
      : null;
  if (body.action !== undefined && action === null) {
    return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "지원하지 않는 초안 생성 작업입니다." }, { status: 400 });
  }
  const qualityPreset = body.qualityPreset === "standard" ? "STANDARD" : "PREMIUM";
  const experienceMode = body.experienceMode === "verified_experience"
    ? "VERIFIED_EXPERIENCE"
    : "AI_ASSISTED_INFORMATION";
  const experienceNotes = typeof body.experienceNotes === "string" ? body.experienceNotes.trim().slice(0, 4000) : "";
  if (experienceMode === "VERIFIED_EXPERIENCE" && experienceNotes.length < 20) {
    return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "실제 체험형 문체를 사용하려면 구체적인 체험 사실 메모가 필요합니다." }, { status: 400 });
  }
  const requestMemo = typeof body.memo === "string" ? body.memo.trim().slice(0, 1000) : "";
  const link = await prisma.brandLink.findUnique({
    where: { id },
    select: { id: true, status: true, connectKind: true, productName: true, memo: true },
  });
  if (!link) return NextResponse.json({ success: false, code: "PRODUCT_NOT_FOUND", error: "상품을 찾을 수 없습니다." }, { status: 404 });
  if (link.status === "PUBLISHING") return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "현재 발행 중인 상품입니다." }, { status: 409 });
  if (link.status === "DRAFTING") return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "현재 초안을 작성 중인 상품입니다." }, { status: 409 });
  const connectKind = link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  // 기본 엔진은 OpenAI API 키(Spec-first). codex 는 설정에서 켠 경우에만, ChatGPT 웹 자동작성도 설정에서 켠 경우에만 쓴다.
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase() === "codex" ? "codex" : "openai";
  const hasProviderKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  const localFallbackEnabled = (process.env.PRODUCT_POST_LOCAL_FALLBACK_ENABLED || "false").toLowerCase() === "true";
  const browserAutomationEnabled = isChatGptBrowserAutomationEnabled();
  const codexEnabled = (process.env.CODEX_DRAFT_ENABLED || "false").trim().toLowerCase() === "true";
  const codexStatus = !action && codexEnabled ? readCodexLocalStatus() : null;
  const useCodex = !action && codexEnabled && Boolean(codexStatus?.authenticated);
  // 로그인된 일반 ChatGPT 자동작성이 켜져 있으면 저품질 로컬 템플릿보다 우선한다.
  // 글 작성은 일반 ChatGPT 경로만 사용한다.
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
    if (!useCodex && !hasProviderKey && !localFallbackEnabled && !browserAutomationEnabled) {
      // 데스크톱 UI 는 이 두 코드로 Codex 연결/ChatGPT 핸드오프 안내를 분기한다. MCP 경로는 LLM_UNAVAILABLE 로 분류한다.
      return NextResponse.json({
        success: false,
        code: codexEnabled ? "CODEX_LOGIN_REQUIRED" : "CHATGPT_MCP_DRAFT_REQUIRED",
        error: codexEnabled
          ? "Codex 로그인이 필요합니다. 로컬 프로그램 제어에서 Codex를 연결하거나 설정에 OpenAI API 키를 입력하세요."
          : "이 PC에는 OpenAI API 키가 없습니다. 설정에 키를 입력하거나 ChatGPT 2단계 초안(post_prepare_draft → post_submit_draft)으로 이어서 만들 수 있습니다.",
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
  const submittedContextPath = path.join(packageDir, "mcp-submitted-context.json");
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
      code: "ALREADY_PUBLISHING",
      error: "상품 상태가 변경되어 초안 작성을 시작하지 못했습니다. 목록을 새로고침해 주세요.",
    }, { status: 409 });
  }
  try {
    if (action === "prepare_context") {
      fs.rmSync(contextPath, { force: true });
    }
    if (action === "submit_generated") {
      if (!submittedDraft) throw new Error("검증된 ChatGPT 원고가 없습니다.");
      const suppliedContext = body.contextSnapshot && typeof body.contextSnapshot === "object" && !Array.isArray(body.contextSnapshot)
        ? body.contextSnapshot as Record<string, unknown>
        : fs.existsSync(contextPath)
          ? JSON.parse(fs.readFileSync(contextPath, "utf8")) as Record<string, unknown>
          : null;
      const submittedSnapshot = readProductSnapshot(suppliedContext?.snapshot, { productId: id, connectKind });
      if (!suppliedContext || !submittedSnapshot || suppliedContext.snapshotId !== submittedSnapshot.snapshotId) {
        throw new PrepareProcessError(
          "PRODUCT_SNAPSHOT_CHANGED",
          "초안 생성 시점의 상품 스냅샷이 없거나 무결성 검증에 실패했습니다. 같은 contextJobId로 다시 제출하세요.",
        );
      }
      fs.writeFileSync(submittedDraftPath, JSON.stringify(submittedDraft, null, 2), "utf8");
      fs.writeFileSync(submittedContextPath, JSON.stringify(suppliedContext, null, 2), "utf8");
      fs.rmSync(getBrandPostPackageManifestPath(id), { force: true });
    }
    if (!action) {
      // 새 초안: 이전 실행의 result.json 이 남아 실패 원인으로 오인되지 않게 지운다.
      fs.rmSync(path.join(packageDir, "result.json"), { force: true });
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
          BRANDLINK_SUBMITTED_CONTEXT_PATH: action === "submit_generated" ? submittedContextPath : "",
          BRANDLINK_DRAFT_MEMO: requestMemo,
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
          PRODUCT_POST_LOCAL_FALLBACK_ENABLED: localFallbackEnabled ? "true" : "false",
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
      const failure = readPrepareFailure(logPath, action ? undefined : id);
      if (failure) throw new PrepareProcessError(failure.code, failure.message);
      throw new PrepareProcessError("LOCAL_AUTOMATION_FAILED", `초안 생성 프로세스가 종료되었습니다(code=${exit.code}, signal=${exit.signal ?? "none"}).`);
    }
    if (action === "prepare_context") {
      if (!fs.existsSync(contextPath)) {
        const failure = readPrepareFailure(logPath);
        throw new PrepareProcessError(failure?.code || "LOCAL_AUTOMATION_FAILED", failure?.message || `초안 컨텍스트가 생성되지 않았습니다: ${contextPath}`);
      }
      const contextData = JSON.parse(fs.readFileSync(contextPath, "utf8")) as Record<string, unknown>;
      if (contextData.version !== "brand-draft-context/v1" && contextData.version !== "brand-draft-context/v2") {
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
      const failure = readPrepareFailure(logPath, id);
      throw new PrepareProcessError(failure?.code || "LOCAL_AUTOMATION_FAILED", failure?.message || `초안 매니페스트가 생성되지 않았습니다: ${getBrandPostPackageManifestPath(id)}`);
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
    return failureResponse(error, "고품질 초안 생성 실패", 500, { logPath });
  } finally {
    finishDraftActivity();
    fs.closeSync(logFd);
    if (action === "submit_generated") {
      fs.rmSync(submittedDraftPath, { force: true });
      fs.rmSync(submittedContextPath, { force: true });
    }
  }
}

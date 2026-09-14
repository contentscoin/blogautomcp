import fs from "node:fs";
import draftRuntimePolicy from "../../../../../../scripts/lib/draft-runtime-policy.json";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { buildChatGptDraftHandoff } from "@/lib/chatgpt-draft-handoff";
import {
  buildChatGptBrowserAutomationEnv,
  isChatGptBrowserAuthenticationError,
  isChatGptBrowserAutomationEnabled,
  isChatGptBrowserUnreachableError,
  readChatGptBrowserSessionSummary,
} from "@/lib/chatgpt-browser-automation";
import { beginDesktopActivity } from "@/lib/desktop-activity";
import { classifyLocalFailure } from "@/lib/local-automation-error";
import {
  approveBrandPostPackage,
  getBrandPostPackageDir,
  getBrandPostPackageManifestPath,
  packagePreview,
  readBrandPostPackage,
  readBrandPostPackageResult,
  reconcileBrandPostPackageQuality,
  writeBrandPostPackageManifest,
  type BrandPostPackageManifest,
} from "@/lib/brand-post-package";
import {
  isProductSnapshotEvidenceRicher,
  revalidateSavedBrandPostText,
  resolveSavedQcSource,
  SavedTextRevalidationError,
} from "@/lib/brand-post-revalidation";
import { isBrandPostImageRepairActive, repairBrandPostImages } from "@/lib/brand-post-image-repair";
import { getDraftProgressPath, writeDraftProgress } from "@/lib/draft-progress";
import {
  getPostCompositionContract,
  stripAffiliateDisclosureFromTitle,
} from "@/lib/post-composition-contract";
import { readCodexLocalStatus } from "@/lib/codex-local";
import { readProductSnapshot } from "@/lib/draft-context-snapshot";
import { planQualityConvergence } from "../../../../../../scripts/lib/quality-convergence";

const TS_NODE_BIN = path.join(process.cwd(), "node_modules", "ts-node", "dist", "bin.js");
const REVISION_PROCESS_TIMEOUT_MS = (() => {
  const requested = Number.parseInt(process.env.BRANDLINK_REVISION_MAX_RUNTIME_MS || "", 10);
  const fallback = 20 * 60 * 1000;
  if (!Number.isFinite(requested)) return fallback;
  return Math.max(5 * 60 * 1000, Math.min(requested, 24 * 60 * 1000));
})();

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

async function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid) {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, 5_000);
    timeout.unref();
    killer.once("error", () => {
      clearTimeout(timeout);
      child.kill("SIGKILL");
      finish();
    });
    killer.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) child.kill("SIGKILL");
      finish();
    });
  });
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

function isAutoSectionImagesEnabled(): boolean {
  return draftRuntimePolicy.BRAND_POST_AUTO_SECTION_IMAGES === "true";
}

type ApprovalProductIdentity = {
  productName: string | null;
  connectKind: string;
  externalItemId: string | null;
  finalUrl: string | null;
  sourceUrl: string | null;
  url: string;
};

/**
 * Approval is the final publication boundary, so it always reruns the current
 * evaluator against server-owned evidence. A historical pass stored by an old
 * evaluator is audit history only and can never authorize a new approval.
 */
function revalidatePackageForApproval(
  brandLinkId: string,
  link: ApprovalProductIdentity,
): BrandPostPackageManifest {
  const manifest = readBrandPostPackage(brandLinkId, { migrate: false });
  if (!manifest) {
    throw new SavedTextRevalidationError("승인할 고품질 초안이 없습니다.", "DRAFT_NOT_FOUND");
  }
  if (manifest.version !== "brand-post-package/v2") {
    throw new SavedTextRevalidationError(
      "이전 형식의 초안은 현재 품질 기준으로 승인할 수 없습니다. 소재 준비를 다시 실행하세요.",
      "DRAFT_RECHECK_REQUIRED",
    );
  }
  const contextPath = path.join(getBrandPostPackageDir(brandLinkId), "mcp-draft-context.json");
  const savedContext = !manifest.sourceSnapshot && fs.existsSync(contextPath)
    ? JSON.parse(fs.readFileSync(contextPath, "utf8"))
    : undefined;
  const identity = {
    productId: brandLinkId,
    connectKind: link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING",
    externalProductId: link.externalItemId || null,
    sourceUrl: link.finalUrl || link.sourceUrl || link.url || null,
    productName: link.productName || "",
    brandLink: link.url,
  } as const;
  const evaluated = revalidateSavedBrandPostText(
    reconcileBrandPostPackageQuality(manifest),
    identity,
    savedContext,
  );
  return writeBrandPostPackageManifest(reconcileBrandPostPackageQuality(evaluated));
}

/**
 * 비어 있는 섹션 이미지 보충은 초안 응답을 기다리게 하지 않는다. 1.3.9 까지는 여기서 ChatGPT 브라우저 배치를
 * await 해 초안 작업이 이미지 6장 × 최대 3분 동안 멈췄다. 이제 자동 보충은 고정이며 분리 실행한다.
 * MCP 제출 원고(submit_generated·origin:"mcp")는
 * ChatGPT 대화의 내장 이미지 생성 + post_apply_section_image 경로를 쓰므로 항상 건너뛴다.
 */
function scheduleSectionImageRepair(options: {
  brandLinkId: string;
  productName: string;
  skip: boolean;
}): { scheduled: boolean; remaining: number; warning: string | null } {
  const manifest = readBrandPostPackage(options.brandLinkId);
  if (!manifest || manifest.version !== "brand-post-package/v2") {
    return { scheduled: false, remaining: 0, warning: null };
  }
  const remaining = packagePreview(manifest).imageSlots
    .reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
  if (remaining === 0) return { scheduled: false, remaining, warning: null };
  const hint = "ChatGPT 대화에서 슬롯별 imagePrompt로 이미지를 만들어 post_apply_section_image 로 붙이거나, 이미지 탭에서 보충하세요.";
  if (options.skip) {
    return { scheduled: false, remaining, warning: `섹션 이미지 ${remaining}장이 비어 있습니다. ${hint}` };
  }
  if (!isAutoSectionImagesEnabled()) {
    return {
      scheduled: false,
      remaining,
      warning: `섹션 이미지 ${remaining}장이 비어 있습니다. 자동 생성은 꺼져 있습니다(설정 BRAND_POST_AUTO_SECTION_IMAGES). ${hint}`,
    };
  }
  if (!isChatGptBrowserAutomationEnabled()) {
    return {
      scheduled: false,
      remaining,
      warning: `섹션 이미지 ${remaining}장이 비어 있습니다. ChatGPT 웹 자동화가 꺼져 있어 PC에서 이미지를 생성하지 않습니다. ${hint}`,
    };
  }
  if (isBrandPostImageRepairActive(options.brandLinkId)) {
    return { scheduled: false, remaining, warning: "이 초안의 이미지 생성이 이미 진행 중입니다." };
  }
  const finishActivity = beginDesktopActivity("brand-post-image-generation");
  // Detached on purpose: the draft response returns now; imageGeneration.status="running" is persisted before the first await.
  void repairBrandPostImages({ brandLinkId: options.brandLinkId, productName: options.productName })
    .catch((error) => {
      console.error(`[draft] 섹션 이미지 자동 생성 실패(${options.brandLinkId}): ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(finishActivity);
  return {
    scheduled: true,
    remaining,
    warning: `섹션 이미지 ${remaining}장을 백그라운드에서 생성합니다. 완료 전까지 초안 승인은 보류됩니다.`,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  try {
    const manifest = readBrandPostPackage(id, { migrate: false });
    return NextResponse.json({ success: true, data: manifest ? packagePreview(manifest) : null });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "초안 조회 실패" }, { status: 500 });
  }
}

/** 초안 부분 수정: simple-agent 를 수정 모드(BRANDLINK_REVISE_REQUEST)로 실행한다. 네이버 세션은 필요 없다. */
async function runRevision(id: string, packageDir: string, instructions: string, sectionIndexes: number[], qualityConvergence = false): Promise<void> {
  const requestPath = path.join(packageDir, "revise-request.json");
  fs.writeFileSync(requestPath, JSON.stringify({ instructions, sectionIndexes, qualityConvergence, requestedAt: new Date().toISOString() }, null, 2), "utf8");
  const logPath = path.join(packageDir, "prepare.log");
  const logFd = fs.openSync(logPath, "a");
  const scriptPath = path.join(process.cwd(), "scripts", "simple-agent.ts");
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>((resolve, reject) => {
      const child = spawn(process.execPath, [TS_NODE_BIN, "--project", "tsconfig.scripts.json", scriptPath, id], {
        cwd: process.cwd(),
        stdio: ["ignore", logFd, logFd],
        shell: false,
        windowsHide: true,
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
          AI_PROVIDER: draftRuntimePolicy.AI_PROVIDER,
          CODEX_DRAFT_MODEL: draftRuntimePolicy.CODEX_DRAFT_MODEL,
        },
      });
      let settled = false;
      let deadlineExceeded = false;
      const finish = (result: { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(result);
      };
      const deadline = setTimeout(() => {
        deadlineExceeded = true;
        void terminateProcessTree(child).finally(() => finish({ code: null, signal: "SIGKILL", timedOut: true }));
      }, REVISION_PROCESS_TIMEOUT_MS);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(error);
      });
      child.once("exit", (code, signal) => finish({ code, signal, timedOut: deadlineExceeded }));
    });
    if (exit.timedOut) {
      throw new PrepareProcessError(
        "QUALITY_REPAIR_TIMEOUT",
        `초안 보강이 ${Math.round(REVISION_PROCESS_TIMEOUT_MS / 60_000)}분 제한시간을 초과해 하위 프로세스를 종료했습니다. 기존 원고는 보존했습니다.`,
      );
    }
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
  if (isBrandPostImageRepairActive(id)) {
    return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "섹션 이미지 생성 중입니다. 완료 후 원고를 수정하거나 승인하세요." }, { status: 409 });
  }
  const body = await request.json().catch(() => ({})) as {
    action?: string;
    instructions?: unknown;
    sectionIndexes?: unknown;
    qualityConvergence?: unknown;
    refreshSource?: unknown;
  };
  if (body.action === "recheck") {
    try {
      const link = await prisma.brandLink.findUnique({ where: { id }, select: {
        id: true, status: true, productName: true, connectKind: true, externalItemId: true,
        finalUrl: true, sourceUrl: true, url: true,
      } });
      if (!link) return NextResponse.json({ success: false, code: "PRODUCT_NOT_FOUND", error: "상품을 찾을 수 없습니다." }, { status: 404 });
      if (!["READY", "FAILED"].includes(link.status)) return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "작성·발행·예약 중인 초안은 재검사할 수 없습니다." }, { status: 409 });
      // Claim before the synchronous read/evaluate/write transaction. No GET migration
      // or generation pipeline may silently clear a text failure in this action.
      const claim = await prisma.brandLink.updateMany({ where: { id, status: link.status }, data: { status: "DRAFTING" } });
      if (claim.count !== 1) return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "상품 상태가 변경되었습니다." }, { status: 409 });
      try {
        const manifest = readBrandPostPackage(id, { migrate: false });
        if (!manifest || manifest.version !== "brand-post-package/v2") return NextResponse.json({ success: false, code: "DRAFT_NOT_FOUND", error: "재검사할 v2 초안이 없습니다." }, { status: 404 });
        const contextPath = path.join(getBrandPostPackageDir(id), "mcp-draft-context.json");
        const context = fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, "utf8")) : undefined;
        const identity = {
          productId: id, connectKind: link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING",
          externalProductId: link.externalItemId || null, sourceUrl: link.finalUrl || link.sourceUrl || link.url || null,
          productName: link.productName || "", brandLink: link.url,
        } as const;
        let sourceRefresh: {
          requested: boolean;
          applied: boolean;
          previousSnapshotId: string | null;
          candidateSnapshotId: string | null;
        } = { requested: body.refreshSource === true, applied: false, previousSnapshotId: null, candidateSnapshotId: null };
        let evaluationInput = reconcileBrandPostPackageQuality(manifest);
        if (body.refreshSource === true) {
          if (!context) {
            throw new SavedTextRevalidationError(
              "새 상품 컨텍스트가 없습니다. 상품 상세 정보를 다시 수집한 뒤 재검사하세요.",
              "SOURCE_EVIDENCE_REQUIRED",
            );
          }
          const current = resolveSavedQcSource(evaluationInput, identity);
          const candidate = resolveSavedQcSource({ ...evaluationInput, sourceSnapshot: undefined }, identity, context);
          sourceRefresh = {
            requested: true,
            applied: isProductSnapshotEvidenceRicher(candidate.snapshot, current.snapshot),
            previousSnapshotId: current.snapshot.snapshotId,
            candidateSnapshotId: candidate.snapshot.snapshotId,
          };
          if (sourceRefresh.applied) evaluationInput = { ...evaluationInput, sourceSnapshot: candidate.snapshot };
        }
        const evaluated = revalidateSavedBrandPostText(evaluationInput, identity, evaluationInput.sourceSnapshot ? undefined : context);
        const updated = reconcileBrandPostPackageQuality(evaluated);
        writeBrandPostPackageManifest(updated);
        const qualityConvergence = updated.contentQuality
          ? planQualityConvergence({ current: updated.contentQuality, attempt: 0, maximumAttempts: 1 })
          : null;
        return NextResponse.json({
          success: true,
          data: { ...packagePreview(updated), qualityConvergence },
          rechecked: true,
          sourceRefresh,
        });
      } finally {
        await prisma.brandLink.updateMany({ where: { id, status: "DRAFTING" }, data: { status: link.status } });
      }
    } catch (error) {
      return NextResponse.json({ success: false, code: error instanceof SavedTextRevalidationError ? error.code : "QC_RECHECK_FAILED", error: error instanceof Error ? error.message : "원고 재검사 실패" }, { status: 409 });
    }
  }
  if (body.action === "approve") {
    try {
      const link = await prisma.brandLink.findUnique({ where: { id }, select: {
        status: true, productName: true, connectKind: true, externalItemId: true,
        finalUrl: true, sourceUrl: true, url: true,
      } });
      if (!link || !["READY", "FAILED"].includes(link.status)) return NextResponse.json({ success: false, code: "NOT_READY", error: "작성·발행 중이거나 게시 여부 확인이 필요한 소재는 승인할 수 없습니다." }, { status: 409 });
      const claim = await prisma.brandLink.updateMany({ where: { id, status: link.status }, data: { status: "DRAFTING" } });
      if (claim.count !== 1) return NextResponse.json({ success: false, code: "NOT_READY", error: "소재 상태가 변경되어 승인하지 않았습니다." }, { status: 409 });
      let approved = false;
      try {
        revalidatePackageForApproval(id, link);
        const manifest = approveBrandPostPackage(id);
        const preview = packagePreview(manifest);
        approved = true;
        return NextResponse.json({ success: true, data: preview });
      } finally {
        await prisma.brandLink.updateMany({ where: { id, status: "DRAFTING" }, data: { status: approved ? "READY" : link.status, ...(approved ? { errorMessage: null } : {}) } });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "초안 승인 실패";
      const code = error instanceof SavedTextRevalidationError
        ? error.code
        : /승인할 고품질 초안이 없/u.test(message)
          ? "DRAFT_NOT_FOUND"
          : /품질|게이트|검사/u.test(message)
            ? "CONTENT_BLOCKED"
            : classifyLocalFailure({ message, status: 400 });
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
    if (!["READY", "FAILED"].includes(link.status)) {
      return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "현재 발행 또는 초안 작성 중인 상품입니다." }, { status: 409 });
    }
    const existing = readBrandPostPackage(id, { migrate: false });
    if (!existing) return NextResponse.json({ success: false, code: "DRAFT_NOT_FOUND", error: "수정할 초안이 없습니다. 먼저 초안을 생성하세요." }, { status: 404 });
    if (existing.version !== "brand-post-package/v2") {
      return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "이전 형식의 초안은 소재 준비에서 다시 저장하세요." }, { status: 409 });
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
      await runRevision(id, packageDir, instructions, sectionIndexes, body.qualityConvergence === true);
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
  if (isBrandPostImageRepairActive(id)) {
    return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "섹션 이미지 생성 중입니다. 기존 작업이 끝난 뒤 초안을 작성하세요." }, { status: 409 });
  }
  const body = await request.json().catch(() => ({})) as {
    action?: DraftAction;
    qualityPreset?: string;
    experienceMode?: string;
    experienceNotes?: string;
    memo?: string;
    draft?: unknown;
    contextSnapshot?: unknown;
    forceQualityRepair?: boolean;
    autoQualityRepair?: boolean;
    autoApprove?: boolean;
    autoSectionImages?: boolean;
    origin?: string;
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
  const mcpOrigin = body.origin === "mcp" || request.headers.get("x-blogautomcp-origin") === "mcp";
  const link = await prisma.brandLink.findUnique({
    where: { id },
    select: {
      id: true, status: true, connectKind: true, productName: true, memo: true,
      externalItemId: true, finalUrl: true, sourceUrl: true, url: true,
    },
  });
  if (!link) return NextResponse.json({ success: false, code: "PRODUCT_NOT_FOUND", error: "상품을 찾을 수 없습니다." }, { status: 404 });
  if (link.status === "OUTCOME_UNKNOWN" || link.status === "PUBLISHED" || link.status === "SCHEDULED") return NextResponse.json({ success: false, code: "NOT_READY", error: "게시됐거나 게시 여부를 확인 중인 소재는 다시 작성할 수 없습니다." }, { status: 409 });
  if (link.status === "PUBLISHING") return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "현재 발행 중인 상품입니다." }, { status: 409 });
  if (link.status === "DRAFTING") return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "현재 초안을 작성 중인 상품입니다." }, { status: 409 });
  const connectKind = link.connectKind === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  // 로그인된 Codex가 항상 우선한다. 사용할 수 없으면 기존 API/웹 복구 경로를 사용한다.
  const provider = "openai";
  const hasProviderKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  const localFallbackEnabled = (process.env.PRODUCT_POST_LOCAL_FALLBACK_ENABLED || "false").toLowerCase() === "true";
  const browserAutomationEnabled = isChatGptBrowserAutomationEnabled();
  const codexEnabled = draftRuntimePolicy.CODEX_DRAFT_ENABLED === "true";
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
  const progressPath = getDraftProgressPath(id);
  const previousManifest = action === "submit_generated" && fs.existsSync(getBrandPostPackageManifestPath(id))
    ? fs.readFileSync(getBrandPostPackageManifestPath(id), "utf8") : null;
  let submissionSaved = false;
  writeDraftProgress(id, {
    stage: "facts",
    progress: 10,
    message: action === "submit_generated" ? "제출 원고 검증 준비" : "상품 사실 수집 준비",
  });
  try {
    if (action === "prepare_context") {
      fs.rmSync(contextPath, { force: true });
    }
    if (action === "submit_generated") {
      if (!submittedDraft) throw new Error("검증된 ChatGPT 원고가 없습니다.");
      // The browser/MCP request can only name the prepared snapshot. Its facts
      // are not trusted request data: use the context written locally by the
      // preceding prepare_context job as the sole source of product evidence.
      const forwardedContext = body.contextSnapshot && typeof body.contextSnapshot === "object" && !Array.isArray(body.contextSnapshot)
        ? body.contextSnapshot as Record<string, unknown>
        : null;
      const localContextSize = fs.existsSync(contextPath) ? fs.statSync(contextPath).size : 0;
      if (!localContextSize || localContextSize > 850 * 1024) {
        throw new PrepareProcessError(
          "DRAFT_CONTEXT_REQUIRED",
          "이 PC에서 준비한 상품 컨텍스트가 없거나 크기 제한을 초과했습니다. 같은 PC에서 post_prepare_draft부터 다시 실행하세요.",
        );
      }
      const suppliedContext = JSON.parse(fs.readFileSync(contextPath, "utf8")) as Record<string, unknown>;
      const submittedSnapshot = readProductSnapshot(suppliedContext?.snapshot, { productId: id, connectKind });
      if (suppliedContext?.version === "brand-draft-context/v1") {
        throw new PrepareProcessError("DRAFT_CONTEXT_LEGACY", "구형 컨텍스트에는 검증 가능한 스냅샷이 없습니다. 원고를 보존한 채 post_prepare_draft로 새 근거를 준비하고 재검증하세요.");
      }
      if (!suppliedContext || !submittedSnapshot || suppliedContext.snapshotId !== submittedSnapshot.snapshotId) {
        throw new PrepareProcessError(
          "PRODUCT_SNAPSHOT_CHANGED",
          "초안 생성 시점의 상품 스냅샷이 없거나 무결성 검증에 실패했습니다. 같은 contextJobId로 다시 제출하세요.",
        );
      }
      const forwardedSnapshotId = typeof forwardedContext?.snapshotId === "string" ? forwardedContext.snapshotId : "";
      if (forwardedContext && forwardedSnapshotId !== submittedSnapshot.snapshotId) {
        throw new PrepareProcessError(
          "PRODUCT_SNAPSHOT_CHANGED",
          "제출 요청의 상품 스냅샷과 이 PC가 준비한 근거가 일치하지 않습니다. 같은 contextJobId로 다시 준비하세요.",
        );
      }
      if (submittedSnapshot.externalProductId !== (link.externalItemId || null)) {
        throw new PrepareProcessError("PRODUCT_SNAPSHOT_CHANGED", "준비한 상품 ID가 현재 상품과 일치하지 않습니다.");
      }
      fs.writeFileSync(submittedDraftPath, JSON.stringify(submittedDraft, null, 2), "utf8");
      fs.writeFileSync(submittedContextPath, JSON.stringify(suppliedContext, null, 2), "utf8");
      // Keep the last saved draft until a replacement has passed validation and
      // is persisted. A failed resubmission must not erase the user's manuscript.
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
        windowsHide: true,
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
          BRANDLINK_DRAFT_PROGRESS_PATH: progressPath,
          ...buildChatGptBrowserAutomationEnv(useBrowserChatGpt),
          AI_PROVIDER: useCodex ? "codex" : provider,
          CODEX_DRAFT_ENABLED: useCodex ? "true" : "false",
          CODEX_DRAFT_MODEL: draftRuntimePolicy.CODEX_DRAFT_MODEL,
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
          BRANDLINK_AUTO_QUALITY_REPAIR_ENABLED: body.autoQualityRepair === false ? "false" : "true",
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
      writeDraftProgress(id, { stage: "done", progress: 100, message: "초안 컨텍스트 준비 완료" });
      return NextResponse.json({ success: true, data: contextData, logPath });
    }
    const manifest = readBrandPostPackage(id);
    if (action === "submit_generated" && previousManifest !== null &&
        fs.existsSync(getBrandPostPackageManifestPath(id)) &&
        fs.readFileSync(getBrandPostPackageManifestPath(id), "utf8") === previousManifest) {
      throw new PrepareProcessError("DRAFT_REPLACEMENT_NOT_SAVED", "새 원고가 저장되지 않았습니다. 기존 초안은 보존했습니다.");
    }
    if (!manifest) {
      const failure = readPrepareFailure(logPath, id);
      throw new PrepareProcessError(failure?.code || "LOCAL_AUTOMATION_FAILED", failure?.message || `초안 매니페스트가 생성되지 않았습니다: ${getBrandPostPackageManifestPath(id)}`);
    }
    const imageRepair = scheduleSectionImageRepair({
      brandLinkId: id,
      productName: manifest.title,
      skip: action === "submit_generated" || mcpOrigin || body.autoSectionImages === false,
    });
    let finalizedManifest = readBrandPostPackage(id) || manifest;
    let approvalWarning: string | null = null;
    if (body.autoApprove === true) {
      try {
        revalidatePackageForApproval(id, link);
        finalizedManifest = approveBrandPostPackage(id);
      } catch (error) {
        approvalWarning = error instanceof Error ? error.message : "자동 승인에 실패했습니다.";
      }
    }
    await prisma.brandLink.update({
      where: { id },
      data: { status: "READY", errorMessage: null },
    });
    writeDraftProgress(id, { stage: "done", progress: 100, message: "초안 저장 완료" });
    submissionSaved = true;
    return NextResponse.json({
      success: true,
      data: packagePreview(finalizedManifest),
      autoApproved: Boolean(finalizedManifest.approvedAt),
      approvalWarning,
      imageRepairScheduled: imageRepair.scheduled,
      imageRepairRemaining: imageRepair.remaining,
      imageRepairWarning: imageRepair.warning,
      logPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "고품질 초안 생성 실패";
    if (action === "submit_generated" && previousManifest !== null && !submissionSaved) {
      // A rejected replacement is evaluated in the working package directory.
      // Restore the last committed manuscript byte-for-byte so a failed quality
      // candidate can never replace a previously reviewable draft.
      const previous = JSON.parse(previousManifest) as BrandPostPackageManifest;
      if (!previous || previous.brandLinkId !== id) {
        throw new PrepareProcessError("DRAFT_ROLLBACK_FAILED", "기존 초안의 상품 신원을 확인할 수 없어 안전하게 복구하지 못했습니다.");
      }
      writeBrandPostPackageManifest(previous);
    }
    writeDraftProgress(id, { stage: "failed", progress: 0, message });
    await prisma.brandLink.update({
      where: { id },
      data: {
        status: action === "submit_generated" && previousManifest !== null ? link.status : "FAILED",
        errorMessage: message,
      },
    }).catch(() => undefined);
    if (useBrowserChatGpt) {
      const authenticationRequired = isChatGptBrowserAuthenticationError(message);
      // 사이트에 도달하지 못한 실패는 로그인 창을 열어도 풀리지 않는다. 네트워크·프록시 확인과
      // MCP 요청문 경로를 안내한다.
      const unreachable = !authenticationRequired && isChatGptBrowserUnreachableError(message);
      return NextResponse.json({
        success: false,
        code: authenticationRequired
          ? "CHATGPT_BROWSER_LOGIN_REQUIRED"
          : unreachable
            ? "CHATGPT_BROWSER_UNREACHABLE"
            : "CHATGPT_BROWSER_FALLBACK_REQUIRED",
        error: authenticationRequired
          ? `ChatGPT 로그인 또는 보안 확인이 필요합니다: ${message}`
          : unreachable
            ? `ChatGPT 웹 페이지에 연결하지 못했습니다. 네트워크·프록시를 확인하거나 "웹 GPT 재로그인"으로 창을 열어 상태를 확인하세요. 상품별 요청문으로 ChatGPT에서 바로 이어서 작성할 수도 있습니다: ${message}`
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
    if (action === "submit_generated" && submissionSaved) {
      fs.rmSync(submittedDraftPath, { force: true });
      fs.rmSync(submittedContextPath, { force: true });
    }
  }
}

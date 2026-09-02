import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { clearRemoteActivation, readRemoteActivation } from "@/lib/remote-activation";
import { getNaverSessionFile } from "@/lib/naver-session";
import { hasStoredConnectContract } from "@/lib/connect-contract-store";
import { readBrandPostPackage } from "@/lib/brand-post-package";
import {
  LOCAL_AUTOMATION_ERROR_HINTS,
  LocalAutomationError,
  classifyLocalFailure,
  extractLocalApiError,
  toLocalAutomationError,
} from "@/lib/local-automation-error";
import { isGenerativeThumbnailAvailable } from "../../../../../scripts/lib/thumbnail-gen";

/**
 * 사이트 작업 큐 폴러(데스크톱 로컬 API).
 *
 * claim → executeJob → complete 한 사이클을 처리한다. 실행 중에는 하트비트로 임대를
 * 연장하고 진행 단계를 올리며, ChatGPT 의 취소 요청(cancelRequested)을 받으면 로컬
 * 발행 프로세스를 정지하고 USER_CANCELLED 로 마감한다. 결과는 PC 경로가 섞이지 않은
 * 표준 봉투(blogautomcp.job-result/v1)로 올리고, 실패는 분류된 코드로 올린다.
 */

type Job = { id: string; type: string; input: Record<string, unknown> };

type JobResultEnvelope = {
  schema: "blogautomcp.job-result/v1";
  jobType: string;
  kind: string;
  summary: string;
  data: Record<string, unknown>;
  readiness?: unknown;
  warnings: string[];
};

type JobContext = {
  request: NextRequest;
  job: Job;
  warnings: string[];
  cancelled: boolean;
  cancelReason: "USER_CANCELLED" | "LEASE_LOST" | null;
  setStage: (stage: string, message?: string, progress?: number) => void;
};

const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
const PUBLISH_WAIT_MS = parseBoundedInteger(process.env.REMOTE_PUBLISH_WAIT_MS, 25 * 60_000, 60_000, 3 * 60 * 60_000);
const PUBLISH_POLL_MS = 5_000;
const DRAFT_MARKDOWN_MAX_CHARS = 60_000;
const HERO_IMAGE_MAX_BYTES = 300 * 1024;
const PIPELINE_VERSION = "post-spec/v1";

/** 같은 프로세스에서 동시에 두 작업을 실행하지 않는다(렌더러 폴러 + 메인 워치독 중복 대비). */
let activeJob: { id: string; type: string; startedAt: number } | null = null;
/** claim 요청이 진행 중인 동안 다른 폴러가 또 claim 하지 못하게 한다(단일 스레드라 검사+설정이 원자적). */
let claiming = false;

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function config() {
  const activation = readRemoteActivation();
  return { siteUrl: activation.siteUrl, token: activation.deviceToken };
}

function appVersionString(): string {
  return process.env.DESKTOP_APP_VERSION || process.env.npm_package_version || "1.0.0";
}

/** 사이트 agent_get_status 가 그대로 노출하는 PC 상태 스냅샷(개인정보 없음). */
function buildStatusSnapshot(): Record<string, unknown> {
  let naverSessionSavedAt: string | null = null;
  try {
    naverSessionSavedAt = fs.statSync(getNaverSessionFile()).mtime.toISOString();
  } catch {
    naverSessionSavedAt = null;
  }
  return {
    naverSessionPresent: Boolean(naverSessionSavedAt),
    ...(naverSessionSavedAt ? { naverSessionSavedAt } : {}),
    naverBlogIdConfigured: Boolean(process.env.NAVER_BLOG_ID?.trim()),
    travelContractReady: hasStoredConnectContract("travel"),
    updatePending: process.env.DESKTOP_UPDATE_INSTALL_PENDING === "1",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    generativeThumbnail: isGenerativeThumbnailAvailable(),
    pipelineVersion: PIPELINE_VERSION,
    appVersion: appVersionString(),
    platform: process.platform,
    checkedAt: new Date().toISOString(),
  };
}

async function localApi(request: NextRequest, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  // 서버가 자기 자신을 호출하는 요청이라 브라우저가 붙여주는 Origin/sec-fetch-site가
  // 없다. ADMIN_API_KEY가 설정되지 않은 데스크톱에서는 requireTrustedLocalMutation이
  // 이 부재를 외부 요청으로 보고 403을 돌려줘 MCP 작업이 전부 실패했다.
  // 같은 오리진에서 시작한 요청임을 정확히 표시한다.
  headers.set("origin", request.nextUrl.origin);
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (adminKey) headers.set("x-admin-api-key", adminKey);
  const url = new URL(path, request.nextUrl.origin);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && payload?.success !== false) return payload || {};
    // 라우트 자체가 없는 404(HTML 응답)만 재시도한다. JSON 404 는 "대상 없음"이다.
    if (response.status === 404 && payload === null && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    if (response.status === 404 && payload === null) {
      throw new LocalAutomationError("LOCAL_API_MISSING", `로컬 API가 이 앱 버전에 없습니다: ${url.pathname} (404). 블로그오토 PC 앱을 최신 버전으로 업데이트한 뒤 다시 시도하세요.`, { httpStatus: 404 });
    }
    const extracted = extractLocalApiError(payload);
    const code = classifyLocalFailure({ status: response.status, code: extracted.code, message: extracted.message, path: url.pathname });
    const message = extracted.message || LOCAL_AUTOMATION_ERROR_HINTS[code] || `Local API ${response.status} (${url.pathname})`;
    throw new LocalAutomationError(code, message, { httpStatus: response.status, detail: extracted.code });
  }
  throw new LocalAutomationError("LOCAL_API_MISSING", `로컬 API가 이 앱 버전에 없습니다: ${url.pathname} (404).`, { httpStatus: 404 });
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(input: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function envelope(job: Job, kind: string, summary: string, data: Record<string, unknown>, ctx: JobContext, readiness?: unknown): JobResultEnvelope {
  return {
    schema: "blogautomcp.job-result/v1",
    jobType: job.type,
    kind,
    summary,
    data,
    ...(readiness !== undefined ? { readiness } : {}),
    warnings: Array.from(new Set(ctx.warnings)),
  };
}

function assertNotCancelled(ctx: JobContext): void {
  if (!ctx.cancelled) return;
  if (ctx.cancelReason === "LEASE_LOST") {
    throw new LocalAutomationError("TIMEOUT", "사이트가 이 작업의 임대를 회수했습니다(응답 지연). 다시 시도하세요.");
  }
  throw new LocalAutomationError("USER_CANCELLED", LOCAL_AUTOMATION_ERROR_HINTS.USER_CANCELLED);
}

async function requireProduct(productId: string, kind: "SHOPPING" | "TRAVEL") {
  if (!productId) throw new LocalAutomationError("INVALID_INPUT", "상품 ID(productId 또는 draftId)가 필요합니다.");
  const product = await prisma.brandLink.findUnique({ where: { id: productId } });
  if (!product) throw new LocalAutomationError("PRODUCT_NOT_FOUND", LOCAL_AUTOMATION_ERROR_HINTS.PRODUCT_NOT_FOUND);
  if (product.connectKind !== kind) {
    throw new LocalAutomationError("CONNECT_KIND_MISMATCH", `이 상품은 ${product.connectKind === "TRAVEL" ? "여행" : "쇼핑"}커넥트 상품입니다. connectKind 를 맞춰 다시 요청하세요.`);
  }
  return product;
}

type DraftPreview = Record<string, unknown> & {
  sectionOutline?: unknown;
  readiness?: unknown;
  markdown?: unknown;
  hashtags?: unknown;
  approvedAt?: unknown;
  createdAt?: unknown;
  title?: unknown;
  connectKind?: unknown;
  version?: unknown;
  pipeline?: unknown;
  imageCount?: unknown;
  heroImagePath?: unknown;
  bodyImagePaths?: unknown;
};

/** 초안 미리보기에서 PC 파일 경로를 제거하고 ChatGPT 가 검토할 정보만 남긴다. */
function draftView(draftId: string, preview: DraftPreview, includeMarkdown: boolean): Record<string, unknown> {
  const markdown = typeof preview.markdown === "string" ? preview.markdown : "";
  const truncated = markdown.length > DRAFT_MARKDOWN_MAX_CHARS;
  const bodyImageCount = Array.isArray(preview.bodyImagePaths) ? preview.bodyImagePaths.length : 0;
  return {
    draftId,
    version: preview.version ?? null,
    connectKind: typeof preview.connectKind === "string" ? preview.connectKind.toLowerCase() : null,
    title: preview.title ?? null,
    createdAt: preview.createdAt ?? null,
    approvedAt: preview.approvedAt ?? null,
    approved: Boolean(preview.approvedAt),
    hashtags: Array.isArray(preview.hashtags) ? preview.hashtags : [],
    imageCount: typeof preview.imageCount === "number" ? preview.imageCount : 1 + bodyImageCount,
    heroImageReady: typeof preview.heroImagePath === "string" && fs.existsSync(preview.heroImagePath),
    sectionOutline: preview.sectionOutline ?? null,
    pipeline: preview.pipeline ?? null,
    readiness: preview.readiness ?? null,
    ...(includeMarkdown ? { markdown: truncated ? `${markdown.slice(0, DRAFT_MARKDOWN_MAX_CHARS)}\n\n…(본문이 길어 일부만 표시)` : markdown, markdownTruncated: truncated } : {}),
  };
}

async function heroImagePayload(heroImagePath: unknown): Promise<{ base64: string; mimeType: string } | null> {
  if (typeof heroImagePath !== "string" || !heroImagePath || !fs.existsSync(heroImagePath)) return null;
  try {
    let quality = 80;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const buffer = await sharp(heroImagePath).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (buffer.byteLength <= HERO_IMAGE_MAX_BYTES) return { base64: buffer.toString("base64"), mimeType: "image/webp" };
      quality = Math.max(35, quality - 20);
    }
    return null;
  } catch {
    return null;
  }
}

function readinessSummary(readiness: unknown): string {
  if (!readiness || typeof readiness !== "object") return "검증 정보 없음";
  const record = readiness as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : "UNKNOWN";
  const score = typeof record.score === "number" ? ` ${record.score}점` : "";
  const summary = typeof record.summary === "string" && record.summary ? ` — ${record.summary}` : "";
  return `${status}${score}${summary}`;
}

async function waitForPublishOutcome(ctx: JobContext, id: string): Promise<{ status: string; postUrl: string | null; publishedAt: string | null; scheduledPublishAt: string | null; errorMessage: string | null; timedOut: boolean }> {
  const startedAt = Date.now();
  let lastStage = "";
  while (Date.now() - startedAt < PUBLISH_WAIT_MS) {
    assertNotCancelled(ctx);
    const link = await prisma.brandLink.findUnique({ where: { id }, select: { status: true, postUrl: true, publishedAt: true, scheduledPublishAt: true, errorMessage: true } });
    if (!link) throw new LocalAutomationError("PRODUCT_NOT_FOUND", "발행 중 상품 레코드가 사라졌습니다.");
    if (link.status !== "PUBLISHING") {
      return {
        status: link.status,
        postUrl: link.postUrl,
        publishedAt: link.publishedAt ? link.publishedAt.toISOString() : null,
        scheduledPublishAt: link.scheduledPublishAt ? link.scheduledPublishAt.toISOString() : null,
        errorMessage: link.errorMessage,
        timedOut: false,
      };
    }
    const elapsedMin = Math.floor((Date.now() - startedAt) / 60_000);
    const stage = `publishing:${elapsedMin}m`;
    if (stage !== lastStage) {
      lastStage = stage;
      ctx.setStage("publishing", `네이버 에디터 자동화 진행 중 (${elapsedMin}분 경과)`, Math.min(90, 20 + elapsedMin * 5));
    }
    await new Promise((resolve) => setTimeout(resolve, PUBLISH_POLL_MS));
  }
  const link = await prisma.brandLink.findUnique({ where: { id }, select: { status: true, postUrl: true, publishedAt: true, scheduledPublishAt: true, errorMessage: true } });
  return {
    status: link?.status || "UNKNOWN",
    postUrl: link?.postUrl ?? null,
    publishedAt: link?.publishedAt ? link.publishedAt.toISOString() : null,
    scheduledPublishAt: link?.scheduledPublishAt ? link.scheduledPublishAt.toISOString() : null,
    errorMessage: link?.errorMessage ?? null,
    timedOut: true,
  };
}

async function executeJob(ctx: JobContext): Promise<JobResultEnvelope> {
  const { request, job } = ctx;
  const input = job.input || {};
  const kind = input.connectKind === "travel" ? "TRAVEL" : "SHOPPING";
  const kindLabel = kind === "TRAVEL" ? "여행커넥트" : "쇼핑커넥트";

  if (job.type === "BRANDCONNECT_LIST_PRODUCTS") {
    ctx.setStage("listing", "상품 목록 조회", 20);
    const status = readString(input, "status").toUpperCase() || "ALL";
    const keyword = readString(input, "keyword").slice(0, 80);
    const limit = readInteger(input, "limit", 50, 1, 200);
    const sort = readString(input, "sort") || "newest";
    const links = await prisma.brandLink.findMany({
      where: {
        connectKind: kind,
        ...(status !== "ALL" ? { status } : {}),
        ...(keyword ? { OR: [{ productName: { contains: keyword } }, { storeName: { contains: keyword } }] } : {}),
      },
      orderBy: sort === "name" ? { productName: "asc" } : { createdAt: sort === "oldest" ? "asc" : "desc" },
      take: limit,
    });
    const products = links.map((item) => ({
      id: item.id,
      productName: item.productName,
      storeName: item.storeName,
      price: item.productPrice,
      status: item.status,
      url: item.url,
      postUrl: item.postUrl,
      scheduledPublishAt: item.scheduledPublishAt ? item.scheduledPublishAt.toISOString() : null,
      draft: (() => {
        try {
          const manifest = readBrandPostPackage(item.id);
          return manifest ? { exists: true, approved: Boolean(manifest.approvedAt), readiness: manifest.readiness?.status ?? null } : { exists: false, approved: false, readiness: null };
        } catch {
          return { exists: false, approved: false, readiness: null };
        }
      })(),
      createdAt: item.createdAt.toISOString(),
    }));
    return envelope(job, "product-list", `${kindLabel} 상품 ${products.length}건 (필터: ${status.toLowerCase()}${keyword ? `, "${keyword}"` : ""})`, { connectKind: kind.toLowerCase(), count: products.length, products }, ctx);
  }

  if (job.type === "BRANDCONNECT_LIST_CATEGORIES") {
    ctx.setStage("categories", "카테고리·프로모션 조회", 20);
    const payload = await localApi(request, `/api/brandlinks/selection-options?connectKind=${kind.toLowerCase()}`);
    const data = (payload.data || {}) as Record<string, unknown>;
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const promotions = Array.isArray(data.promotions) ? data.promotions : [];
    if (data.truncated === true) ctx.warnings.push("시간 예산 안에 모든 카테고리를 읽지 못해 일부만 반환했습니다.");
    return envelope(job, "category-list", `${kindLabel} 카테고리 ${categories.length}개, 프로모션 ${promotions.length}개`, {
      connectKind: kind.toLowerCase(),
      categories,
      promotions,
      itemCount: data.itemCount ?? null,
      registrationAvailable: data.registrationAvailable ?? null,
    }, ctx);
  }

  if (job.type === "BRANDCONNECT_SYNC_PRODUCTS") {
    ctx.setStage("sync", "브랜드커넥트 상품 동기화", 15);
    const count = readInteger(input, "count", 10, 1, 50);
    const categoryFilter = readString(input, "categoryFilter").slice(0, 120);
    const promotionFilter = readString(input, "promotionFilter").slice(0, 60);
    const payload = await localApi(request, "/api/brandlinks/bulk-seasonal", {
      method: "POST",
      body: JSON.stringify({
        connectKind: kind.toLowerCase(),
        count,
        waitForCompletion: true,
        ...(categoryFilter ? { categoryFilter } : {}),
        ...(promotionFilter ? { promotionFilter } : {}),
      }),
    });
    const data = (payload.data || {}) as Record<string, unknown>;
    const { logFile: _logFile, logPath: _logPath, ...rest } = data;
    void _logFile;
    void _logPath;
    return envelope(job, "sync-result", typeof payload.message === "string" ? payload.message : `${kindLabel} 상품 동기화 완료`, { connectKind: kind.toLowerCase(), requestedCount: count, ...rest }, ctx);
  }

  if (job.type === "POST_CREATE_DRAFT") {
    const productId = readString(input, "productId");
    const product = await requireProduct(productId, kind);
    const memo = readString(input, "memo").slice(0, 1000);
    ctx.setStage("drafting", `초안 생성: ${product.productName || productId}`, 10);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/draft`, { method: "POST", body: JSON.stringify(memo ? { memo } : {}) });
    const preview = (payload.data || {}) as DraftPreview;
    const view = draftView(productId, preview, true);
    const readiness = preview.readiness ?? null;
    return envelope(job, "draft", `초안 생성 완료 — ${readinessSummary(readiness)}. 검토 후 post_approve_draft 로 승인하세요.`, view, ctx, readiness);
  }

  if (job.type === "POST_GET_DRAFT") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    ctx.setStage("reading", "초안 읽기", 30);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`);
    const preview = payload.data as DraftPreview | null;
    if (!preview) throw new LocalAutomationError("DRAFT_NOT_FOUND", LOCAL_AUTOMATION_ERROR_HINTS.DRAFT_NOT_FOUND);
    const view = draftView(draftId, preview, true);
    if (readString(input, "includeImages") === "thumbnail") {
      const hero = await heroImagePayload(preview.heroImagePath);
      if (hero) view.heroImage = hero;
      else ctx.warnings.push("대표 이미지를 첨부하지 못했습니다(파일 없음 또는 크기 초과).");
    }
    return envelope(job, "draft", `초안 ${view.approved ? "(승인됨)" : "(미승인)"} — ${readinessSummary(preview.readiness)}`, view, ctx, preview.readiness ?? null);
  }

  if (job.type === "POST_REVISE_DRAFT") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    const instructions = readString(input, "instructions").slice(0, 2000);
    if (instructions.length < 2) throw new LocalAutomationError("INVALID_INPUT", "수정 지시(instructions)가 필요합니다.");
    const sectionIndexes = Array.isArray(input.sectionIndexes) ? input.sectionIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < 40).slice(0, 20) : [];
    ctx.setStage("revising", sectionIndexes.length ? `섹션 ${sectionIndexes.join(",")} 수정` : "초안 전체 수정", 15);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`, { method: "PATCH", body: JSON.stringify({ action: "revise", instructions, sectionIndexes }) });
    const preview = (payload.data || {}) as DraftPreview;
    const view = draftView(draftId, preview, true);
    return envelope(job, "draft", `초안 수정 완료 — ${readinessSummary(preview.readiness)}. 승인은 다시 필요합니다.`, view, ctx, preview.readiness ?? null);
  }

  if (job.type === "POST_APPROVE_DRAFT") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    ctx.setStage("approving", "초안 승인", 40);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
    const preview = (payload.data || {}) as DraftPreview;
    const readiness = preview.readiness as { status?: string } | null | undefined;
    if (readiness?.status === "BLOCKED") ctx.warnings.push("검증 상태가 BLOCKED 인 초안입니다. 발행 시 게이트에서 막힐 수 있습니다.");
    const view = draftView(draftId, preview, false);
    return envelope(job, "draft", "초안을 승인했습니다. post_publish 또는 post_schedule 로 발행할 수 있습니다.", view, ctx, preview.readiness ?? null);
  }

  if (job.type === "POST_SET_THUMBNAIL") {
    const draftId = readString(input, "draftId");
    const product = await requireProduct(draftId, kind);
    ctx.setStage("thumbnail", "썸네일 생성(gpt-image + QC)", 10);
    const meta = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/thumbnail`);
    const metaData = (meta.data || {}) as Record<string, unknown>;
    const imageUrls = Array.isArray(metaData.imageUrls) ? metaData.imageUrls.filter((value): value is string => typeof value === "string") : [];
    if (imageUrls.length === 0) throw new LocalAutomationError("IMAGE_SHORTFALL", "썸네일 원본으로 쓸 제품 사진이 없습니다. 상품을 먼저 동기화하세요.");
    const suggested = (metaData.suggestedCopy || {}) as Record<string, unknown>;
    const headline = readString(input, "headline") || (typeof suggested.headline === "string" ? suggested.headline : product.productName || "");
    const subline = readString(input, "subline") || (typeof suggested.subline === "string" ? suggested.subline : "");
    const mood = readString(input, "mood");
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/thumbnail`, {
      method: "POST",
      body: JSON.stringify({ sourceImageUrl: imageUrls[0], copy: { headline, subline }, ...(mood ? { mood } : {}), save: true }),
    });
    const data = (payload.data || {}) as Record<string, unknown>;
    const engine = typeof data.engine === "string" ? data.engine : "unknown";
    const qc = data.qc as { score?: number; passed?: boolean } | null | undefined;
    if (engine === "local") ctx.warnings.push("gpt-image 결과가 QC 를 통과하지 못해 로컬 합성 썸네일로 저장했습니다.");
    const previewDataUrl = typeof data.previewDataUrl === "string" ? data.previewDataUrl : "";
    const heroImage = previewDataUrl.startsWith("data:image/")
      ? { base64: previewDataUrl.slice(previewDataUrl.indexOf(",") + 1), mimeType: previewDataUrl.slice(5, previewDataUrl.indexOf(";")) }
      : null;
    const heroSmall = heroImage && heroImage.base64.length <= HERO_IMAGE_MAX_BYTES * 1.37 ? heroImage : typeof data.outputPath === "string" ? await heroImagePayload(data.outputPath) : null;
    return envelope(job, "thumbnail", `썸네일 저장 완료 (${engine}${typeof qc?.score === "number" ? `, QC ${qc.score}점` : ""}, ${data.attempts ?? 0}회 시도). 다음 초안 생성/발행부터 이 썸네일을 사용합니다.`, {
      draftId,
      engine,
      mood: data.mood ?? mood ?? null,
      copy: data.copy ?? { headline, subline },
      qc: qc ?? null,
      attempts: data.attempts ?? null,
      ...(heroSmall ? { heroImage: heroSmall } : {}),
    }, ctx);
  }

  if (job.type === "POST_PUBLISH" || job.type === "POST_SCHEDULE") {
    const draftId = readString(input, "draftId");
    if (!draftId || input.confirmed !== true) throw new LocalAutomationError("INVALID_INPUT", "발행 대상과 confirmed=true 확인이 필요합니다.");
    const product = await requireProduct(draftId, kind);
    const schedule = job.type === "POST_SCHEDULE";
    const scheduledDate = readString(input, "scheduledDate");
    if (schedule && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw new LocalAutomationError("INVALID_INPUT", "scheduledDate는 YYYY-MM-DD 형식이어야 합니다.");
    // 자동 승인은 하지 않는다. ChatGPT 가 post_get_draft 로 검토하고 post_approve_draft 로 승인한 초안만 발행한다.
    const manifest = readBrandPostPackage(draftId);
    if (!manifest) throw new LocalAutomationError("DRAFT_NOT_FOUND", LOCAL_AUTOMATION_ERROR_HINTS.DRAFT_NOT_FOUND);
    if (!manifest.approvedAt) throw new LocalAutomationError("DRAFT_NOT_APPROVED", LOCAL_AUTOMATION_ERROR_HINTS.DRAFT_NOT_APPROVED);
    if (manifest.readiness?.status === "BLOCKED") throw new LocalAutomationError("CONTENT_BLOCKED", `초안 검증이 BLOCKED 상태입니다: ${manifest.readiness.summary}`);
    ctx.setStage("publish:start", schedule ? `예약 발행 시작 (${scheduledDate})` : "즉시 발행 시작", 10);
    const started = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/publish`, {
      method: "POST",
      body: JSON.stringify(schedule ? { publishMode: "schedule", scheduledDate } : { publishMode: "now" }),
    });
    const startedData = (started.data || {}) as Record<string, unknown>;
    const outcome = await waitForPublishOutcome(ctx, draftId);
    if (outcome.status === "FAILED") {
      throw new LocalAutomationError(classifyLocalFailure({ message: outcome.errorMessage || "" }) === "LOCAL_AUTOMATION_FAILED" ? "EDITOR_FAILED" : classifyLocalFailure({ message: outcome.errorMessage || "" }), outcome.errorMessage || "발행 프로세스가 실패했습니다.");
    }
    if (outcome.timedOut) ctx.warnings.push("발행이 아직 진행 중입니다. post_verify_published 로 결과를 확인하세요.");
    const summary = outcome.timedOut
      ? `발행 진행 중 (${Math.round(PUBLISH_WAIT_MS / 60_000)}분 대기 초과). 잠시 후 post_verify_published 로 확인하세요.`
      : schedule
        ? `예약 발행 등록 완료 (${(startedData.effectiveScheduledDate as string) || scheduledDate})${outcome.postUrl ? ` — ${outcome.postUrl}` : ""}`
        : `발행 완료${outcome.postUrl ? ` — ${outcome.postUrl}` : ""}`;
    return envelope(job, "publish-result", summary, {
      draftId,
      productName: product.productName,
      publishMode: schedule ? "schedule" : "now",
      status: outcome.status,
      postUrl: outcome.postUrl,
      publishedAt: outcome.publishedAt,
      scheduledPublishAt: outcome.scheduledPublishAt,
      requestedScheduledDate: startedData.requestedScheduledDate ?? (schedule ? scheduledDate : null),
      effectiveScheduledDate: startedData.effectiveScheduledDate ?? null,
      adjustedFromPast: startedData.adjustedFromPast ?? false,
      inProgress: outcome.timedOut,
    }, ctx, manifest.readiness ?? null);
  }

  if (job.type === "POST_BULK_SCHEDULE") {
    if (input.confirmed !== true) throw new LocalAutomationError("INVALID_INPUT", "confirmed=true 확인이 필요합니다.");
    const limit = readInteger(input, "limit", 5, 1, 50);
    const intervalDays = readInteger(input, "intervalDays", 1, 1, 30);
    const startDate = readString(input, "startDate");
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new LocalAutomationError("INVALID_INPUT", "startDate는 YYYY-MM-DD 형식이어야 합니다.");
    ctx.setStage("bulk-schedule", `예약발행 일괄 실행 (최대 ${limit}건)`, 20);
    const payload = await localApi(request, "/api/brandlinks/bulk-schedule", {
      method: "POST",
      body: JSON.stringify({ connectKind: kind.toLowerCase(), limit, intervalDays, ...(startDate ? { startDate } : {}) }),
    });
    const data = (payload.data || {}) as Record<string, unknown>;
    const { logFile: _logFile, ...rest } = data;
    void _logFile;
    return envelope(job, "bulk-schedule", typeof payload.message === "string" ? payload.message : "예약발행 일괄 실행을 시작했습니다.", { connectKind: kind.toLowerCase(), ...rest, note: "백그라운드로 진행됩니다. brandconnect_list_products(status=published) 로 결과를 확인하세요." }, ctx);
  }

  if (job.type === "POST_VERIFY_PUBLISHED") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    ctx.setStage("verifying", "발행 결과 검증", 40);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/verify`);
    const data = (payload.data || {}) as Record<string, unknown>;
    const summary = data.published === true
      ? `발행 확인됨 — ${data.postUrl}`
      : data.scheduled === true
        ? `예약 상태 (${data.scheduledPublishAt || "일시 미상"})`
        : `발행 확인 실패 (상태 ${data.status}${data.errorMessage ? `: ${data.errorMessage}` : ""})`;
    return envelope(job, "verify-result", summary, data, ctx);
  }

  if (job.type === "TRAVEL_CAPTURE_CONTRACT") {
    if (input.confirmed !== true) throw new LocalAutomationError("INVALID_INPUT", "confirmed=true 확인이 필요합니다. 브라우저를 띄워 여행커넥트 목록을 탐색합니다.");
    const categoryUrl = readString(input, "categoryUrl").slice(0, 400);
    ctx.setStage("travel-contract", "여행커넥트 목록 계약 캡처(브라우저)", 15);
    const payload = await localApi(request, "/api/brandlinks/travel-contract", { method: "POST", body: JSON.stringify(categoryUrl ? { categoryUrl } : {}) });
    const data = (payload.data || {}) as Record<string, unknown>;
    return envelope(job, "travel-contract", typeof data.message === "string" ? data.message : "여행커넥트 목록 계약을 저장했습니다.", {
      contractReady: data.contractReady === true,
      itemCount: data.itemCount ?? null,
      responseProfiles: data.responseProfiles ?? null,
    }, ctx);
  }

  if (job.type === "SETTINGS_GET") {
    ctx.setStage("settings", "설정 확인", 40);
    const payload = await localApi(request, "/api/settings");
    const data = (payload.data || {}) as Record<string, unknown>;
    const fields = Array.isArray(data.fields) ? (data.fields as Array<Record<string, unknown>>) : [];
    const configured = (data.configured || {}) as Record<string, boolean>;
    const values = (data.values || {}) as Record<string, string>;
    const settings = fields.map((field) => {
      const key = String(field.key);
      return { key, label: field.label, secret: field.secret === true, configured: Boolean(configured[key]), ...(field.secret ? {} : { value: values[key] ?? "" }) };
    });
    return envelope(job, "settings", `설정 ${settings.length}개 (시크릿은 설정 여부만 표시)`, { settings, status: buildStatusSnapshot() }, ctx);
  }

  throw new LocalAutomationError("LOCAL_API_MISSING", `이 PC 앱 버전은 원격 작업 ${job.type} 을(를) 지원하지 않습니다. 앱을 업데이트하세요.`);
}

async function siteFetch(siteUrl: string, token: string, path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null }> {
  const response = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, payload };
}

/**
 * 작업 실행 중 PC 생존 신호 + 임대 연장 + 진행 단계 + 취소 감지.
 * 예전에는 claim 이 유일한 하트비트라 몇 분 걸리는 작업 동안 PC가 오프라인으로 판정됐다.
 */
function startJobHeartbeat(request: NextRequest, siteUrl: string, token: string, ctx: JobContext, stageRef: { stage: string; message: string; progress: number }): () => void {
  let stopping = false;
  let cancelHandled = false;
  const send = async () => {
    if (stopping) return;
    const { ok, payload } = await siteFetch(siteUrl, token, `/api/agent/jobs/${encodeURIComponent(ctx.job.id)}/heartbeat`, {
      appVersion: appVersionString(),
      progress: stageRef.progress,
      stage: stageRef.stage,
      message: stageRef.message,
      status: buildStatusSnapshot(),
    }).catch(() => ({ ok: false, status: 0, payload: null }));
    if (!ok || !payload) return;
    const data = (payload.data || {}) as Record<string, unknown>;
    if (data.active === false && !ctx.cancelled) {
      ctx.cancelled = true;
      ctx.cancelReason = "LEASE_LOST";
    }
    if (data.cancelRequested === true && !cancelHandled) {
      cancelHandled = true;
      ctx.cancelled = true;
      ctx.cancelReason = "USER_CANCELLED";
      // 발행/초안 프로세스를 실제로 멈춘다(simple-agent 등 우리 스크립트만 종료).
      await localApi(request, "/api/posting/stop", { method: "POST", body: "{}" }).catch(() => undefined);
    }
  };
  void send();
  const timer = setInterval(() => void send(), JOB_HEARTBEAT_INTERVAL_MS);
  // Node 타이머가 프로세스 종료를 막지 않도록 한다(데스크톱 in-process 서버).
  (timer as { unref?: () => void }).unref?.();
  return () => {
    stopping = true;
    clearInterval(timer);
  };
}

async function completeRemoteJob(siteUrl: string, token: string, jobId: string, body: Record<string, unknown>): Promise<void> {
  const { ok, status, payload } = await siteFetch(siteUrl, token, `/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, body);
  if (!ok) {
    const error = payload?.error as { message?: string } | undefined;
    throw new Error(error?.message || `원격 작업 완료 기록 실패 (${status})`);
  }
}

export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const remote = config();
  if (!remote.siteUrl || !remote.token) return NextResponse.json({ success: true, data: { configured: false, job: null } });
  if (process.env.DESKTOP_UPDATE_INSTALL_PENDING === "1") {
    return NextResponse.json({ success: true, data: { configured: true, job: null, updatePending: true } });
  }
  if (activeJob) {
    return NextResponse.json({ success: true, data: { configured: true, job: null, busy: { id: activeJob.id, type: activeJob.type, startedAt: new Date(activeJob.startedAt).toISOString() } } });
  }
  if (claiming) return NextResponse.json({ success: true, data: { configured: true, job: null, busy: null } });

  claiming = true;
  let claim: Awaited<ReturnType<typeof siteFetch>> | null;
  try {
    claim = await siteFetch(remote.siteUrl, remote.token, "/api/agent/jobs/claim", { appVersion: appVersionString(), status: buildStatusSnapshot() }).catch(() => null);
    const claimedJob = claim?.ok ? ((claim.payload?.data as Job | null) || null) : null;
    if (claimedJob) activeJob = { id: claimedJob.id, type: claimedJob.type, startedAt: Date.now() };
  } finally {
    claiming = false;
  }
  if (!claim) return NextResponse.json({ success: false, error: "사이트 작업 채널에 연결할 수 없습니다." }, { status: 502 });
  if (!claim.ok) {
    if (claim.status === 401 || claim.status === 403) clearRemoteActivation();
    const error = claim.payload?.error as { message?: string; code?: string } | undefined;
    return NextResponse.json({ success: false, error: error?.message || "PC 인증이 폐기되었습니다.", code: error?.code }, { status: claim.status });
  }
  const job = (claim.payload?.data as Job | null) || null;
  if (!job) return NextResponse.json({ success: true, data: { configured: true, job: null } });

  const stageRef = { stage: "claimed", message: "작업 시작", progress: 1 };
  const ctx: JobContext = {
    request,
    job,
    warnings: [],
    cancelled: false,
    cancelReason: null,
    setStage: (stage, message, progress) => {
      stageRef.stage = stage;
      if (message) stageRef.message = message;
      if (typeof progress === "number") stageRef.progress = Math.min(99, Math.max(1, Math.round(progress)));
    },
  };
  const stopHeartbeat = startJobHeartbeat(request, remote.siteUrl, remote.token, ctx, stageRef);
  try {
    let result: JobResultEnvelope;
    try {
      result = await executeJob(ctx);
      assertNotCancelled(ctx);
    } finally {
      stopHeartbeat();
    }
    await completeRemoteJob(remote.siteUrl, remote.token, job.id, { status: "SUCCEEDED", result });
    return NextResponse.json({ success: true, data: { configured: true, job: { id: job.id, type: job.type, status: "SUCCEEDED" } } });
  } catch (error) {
    const failure = ctx.cancelled
      ? new LocalAutomationError(ctx.cancelReason === "LEASE_LOST" ? "TIMEOUT" : "USER_CANCELLED", ctx.cancelReason === "LEASE_LOST" ? "사이트가 작업 임대를 회수했습니다." : LOCAL_AUTOMATION_ERROR_HINTS.USER_CANCELLED)
      : toLocalAutomationError(error);
    await completeRemoteJob(remote.siteUrl, remote.token, job.id, { status: "FAILED", errorCode: failure.code, errorMessage: failure.message }).catch(() => undefined);
    return NextResponse.json({ success: false, error: failure.message, code: failure.code, data: { job: { id: job.id, type: job.type, status: "FAILED" } } }, { status: 500 });
  } finally {
    activeJob = null;
  }
}

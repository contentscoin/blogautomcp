import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { localJsonFetch } from "@/lib/local-json-fetch";
import { clearRemoteActivation, readRemoteActivation } from "@/lib/remote-activation";
import { getNaverSessionFile } from "@/lib/naver-session";
import { hasStoredConnectContract } from "@/lib/connect-contract-store";
import { getBrandPostPackageDir, readBrandPostPackage } from "@/lib/brand-post-package";
import { buildBrandPostImagePrompt } from "@/lib/brand-post-image-generation";
import { readDraftProgress } from "@/lib/draft-progress";
import { buildPreparedDraftView } from "@/lib/draft-context-view";
import { collapseBrandLinkProducts, matchesWritingStatusFilter } from "@/lib/brandlink-product-list";
import {
  LOCAL_AUTOMATION_ERROR_HINTS,
  LocalAutomationError,
  classifyLocalFailure,
  extractLocalApiError,
  toLocalAutomationError,
} from "@/lib/local-automation-error";
import { buildProductThumbnailCopy } from "../../../../../scripts/lib/product-thumbnail";
import { buildTravelThumbnailCopy } from "../../../../../scripts/lib/travel-content";
import { getProductThumbnailStorageDir } from "../../../../../scripts/lib/app-paths";
import { createLockedProductThumbnailOnBackground } from "../../../../../scripts/lib/product-image-lock";
import { createTravelEditorialThumbnail } from "../../../../../scripts/lib/travel-thumbnail";
import { normalizeProductThumbnailCopy, productThumbnailSettingKey } from "../../../../../scripts/lib/product-thumbnail-settings";
import { isGenerativeThumbnailAvailable } from "../../../../../scripts/lib/thumbnail-gen";
import {
  applyNaverBlogProfile,
  inspectNaverBlogProfile,
  validateNaverBlogProfileChanges,
  type NaverBlogProfileChanges,
  type NaverBlogProfileSnapshot,
} from "../../../../../scripts/lib/naver-blog-profile";

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
  /** 초안 품질 검사 요약(canPublish·code·score·signals). readiness 와 별도로 그대로 노출한다. */
  contentQuality?: unknown;
  warnings: string[];
  /** 2단계 초안·썸네일 경로처럼 ChatGPT 가 다음에 해야 할 일 */
  nextAction?: string;
};

type DraftProgressWatch = {
  productId: string;
  startedAt: number;
  mode: "prepare" | "generate";
  baseMessage: string;
};

type JobContext = {
  request: NextRequest;
  job: Job;
  warnings: string[];
  cancelled: boolean;
  cancelReason: "USER_CANCELLED" | "LEASE_LOST" | null;
  setStage: (stage: string, message?: string, progress?: number) => void;
  /** 초안 작업 중이면 하트비트가 패키지의 progress.json 을 읽어 단계·진행률을 올린다. */
  draftProgress?: DraftProgressWatch | null;
};

type ProfilePlan = {
  version: 1;
  token: string;
  expiresAt: string;
  current: Pick<NaverBlogProfileSnapshot, "nickname" | "blogName" | "introduction">;
  desired: NaverBlogProfileChanges;
};

const PROFILE_PLAN_PREFIX = "naver.blog.profile.plan.";
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
const PUBLISH_WAIT_MS = parseBoundedInteger(process.env.REMOTE_PUBLISH_WAIT_MS, 25 * 60_000, 60_000, 3 * 60 * 60_000);
const PUBLISH_POLL_MS = 5_000;
/** 로컬 초안 호출 데드라인. 예전에는 localJsonFetch 기본 3시간이라 멈춘 이미지 배치를 아무도 끊지 않았다. */
const DRAFT_PREPARE_WAIT_MS = parseBoundedInteger(process.env.REMOTE_DRAFT_PREPARE_WAIT_MS, 10 * 60_000, 60_000, 60 * 60_000);
const DRAFT_GENERATE_WAIT_MS = parseBoundedInteger(process.env.REMOTE_DRAFT_GENERATE_WAIT_MS, 30 * 60_000, 60_000, 3 * 60 * 60_000);
const SECTION_IMAGE_APPLY_WAIT_MS = 5 * 60_000;
const SECTION_IMAGE_NEXT_ACTION =
  "post_get_draft 결과의 imageSlots 에서 generationMissing 이 0보다 큰 파트마다 imagePrompt 로 이 ChatGPT 의 내장 이미지 생성을 실행하고, " +
  "완성된 이미지의 HTTPS 주소를 post_apply_section_image(sectionId, generatedImageUrl) 로 보내세요. " +
  "쇼핑은 제품이 없는 배경만 생성합니다(PC 가 원본 상품을 잠금 합성). 이미지 부족만으로는 원고를 다시 작성하거나 재제출하지 마세요. " +
  "모든 파트가 채워지면 post_approve_draft 로 승인합니다.";
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

function isAllowedGeneratedImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === "openai.com" || host.endsWith(".openai.com") || host.endsWith(".oaiusercontent.com") || host.endsWith(".chatgpt.com") || host.endsWith(".blob.core.windows.net");
  } catch {
    return false;
  }
}

function isAllowedNaverImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "pstatic.net" || host.endsWith(".pstatic.net") || host.endsWith(".naver.net"));
  } catch {
    return false;
  }
}

async function downloadBoundedImage(rawUrl: string, destination: string, kind: "generated" | "naver"): Promise<void> {
  if (kind === "generated" ? !isAllowedGeneratedImageUrl(rawUrl) : !isAllowedNaverImageUrl(rawUrl)) {
    throw new LocalAutomationError("INVALID_INPUT", kind === "generated" ? "ChatGPT가 제공한 안전한 이미지 주소만 적용할 수 있습니다." : "허용되지 않은 네이버 이미지 주소입니다.");
  }
  const response = await fetch(rawUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`이미지 다운로드 실패 (${response.status})`);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("다운로드 결과가 이미지가 아닙니다.");
  const length = Number(response.headers.get("content-length") || "0");
  if (length > MAX_REMOTE_IMAGE_BYTES) throw new Error("이미지가 허용 크기를 초과했습니다.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_REMOTE_IMAGE_BYTES) throw new Error("이미지 크기를 확인할 수 없습니다.");
  await fs.promises.writeFile(destination, bytes);
}

function parseImageUrls(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((item): item is string => {
      if (typeof item !== "string") return false;
      try {
        const url = new URL(item);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    }))).slice(0, 6);
  } catch {
    return [];
  }
}

function buildChatGptThumbnailPrompt(kind: "SHOPPING" | "TRAVEL", productName: string) {
  if (kind === "TRAVEL") {
    const copy = buildTravelThumbnailCopy(productName);
    return {
      copy,
      generationRole: "complete-travel-photo-background",
      prompt: [
        "Create one premium photorealistic square travel editorial thumbnail background for a Korean Naver Blog.",
        `Travel product or destination: ${productName}`,
        "Use the supplied real travel image as the primary factual visual reference.",
        "Show useful destination context a traveler would want to preview: place, atmosphere, season, realistic light, and human-scale depth.",
        "Natural travel photography, subtle film grain, believable weather and shadows, not a glossy stock advertisement.",
        "Leave a clean dark-to-transparent text-safe area on the left and preserve the main landmark on the right.",
        "Do not add any text, logo, watermark, price, itinerary fact, landmark, or activity that is not supported by the supplied image and product name.",
        "Output one finished 1:1 square image only, 1536x1536 or the closest supported square size.",
      ].join("\n"),
      sourcePolicy: "TRAVEL_EDITORIAL",
      canvas: { width: 1080, height: 1080, aspect: "1:1" },
      localLayoutCandidates: ["travel-cinematic", "travel-emotional-record", "travel-route"],
    };
  }
  const copy = buildProductThumbnailCopy(`${productName} 구매 전 확인`, productName, "SHOPPING");
  return {
    copy,
    generationRole: "background-only-product-lock",
    prompt: [
      "Create one premium photorealistic square lifestyle BACKGROUND ONLY for a Korean Naver Blog product thumbnail.",
      `Product context: ${productName}`,
      "The real product will be composited later from a locked original PNG, so DO NOT draw, recreate, alter, imitate, silhouette, or include the product itself.",
      "Create a believable real-life environment suitable for this product, with natural daylight, one consistent shadow direction, subtle photographic grain, and a clean editorial composition.",
      "Reserve a clear placement area on the right for the locked product PNG and a clean text-safe area on the left.",
      "No text, logo, watermark, package, mock product, floating object, fake UI, phone screen, or shopping card.",
      "Output one finished 1:1 square background only, 1536x1536 or the closest supported square size.",
    ].join("\n"),
    sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL",
    canvas: { width: 1080, height: 1080, aspect: "1:1" },
    localLayoutCandidates: ["shopping-clean-editorial", "shopping-color-block", "shopping-soft-lifestyle"],
  };
}

function localAppOrigin(request: NextRequest): string {
  const configured = process.env.LOCAL_APP_ORIGIN?.trim();
  if (!configured) return request.nextUrl.origin;
  try {
    const url = new URL(configured);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (url.protocol !== "http:" || !localHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.pathname !== "/") {
      return request.nextUrl.origin;
    }
    return url.origin;
  } catch {
    return request.nextUrl.origin;
  }
}

async function localApi(
  request: NextRequest,
  apiPath: string,
  init?: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const origin = localAppOrigin(request);
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  // 서버가 자기 자신을 호출하는 요청이라 브라우저가 붙여주는 Origin/sec-fetch-site가
  // 없다. ADMIN_API_KEY가 설정되지 않은 데스크톱에서는 requireTrustedLocalMutation이
  // 이 부재를 외부 요청으로 보고 403을 돌려줘 MCP 작업이 전부 실패했다.
  // 같은 오리진에서 시작한 요청임을 정확히 표시한다.
  headers.set("origin", origin);
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (adminKey) headers.set("x-admin-api-key", adminKey);
  const url = new URL(apiPath, origin);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = options.timeoutMs
        ? await localJsonFetch(url, { ...init, headers, cache: "no-store" }, options.timeoutMs)
        : await localJsonFetch(url, { ...init, headers, cache: "no-store" });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError" && options.timeoutMs) {
        throw new LocalAutomationError(
          "TIMEOUT",
          `로컬 작업이 ${Math.round(options.timeoutMs / 60_000)}분 안에 끝나지 않았습니다(${url.pathname}). PC 앱의 진행 로그를 확인하고 다시 시도하세요.`,
        );
      }
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
      throw new LocalAutomationError("LOCAL_AUTOMATION_FAILED", `로컬 API 호출에 실패했습니다: ${url.origin}${url.pathname}${cause}`);
    }
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
    throw new LocalAutomationError(code, message, { httpStatus: response.status, detail: payload?.data ?? extracted.code });
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

function envelope(job: Job, kind: string, summary: string, data: Record<string, unknown>, ctx: JobContext, extra: { readiness?: unknown; nextAction?: string; contentQuality?: unknown } = {}): JobResultEnvelope {
  return {
    schema: "blogautomcp.job-result/v1",
    jobType: job.type,
    kind,
    summary,
    data,
    ...(extra.readiness !== undefined ? { readiness: extra.readiness } : {}),
    ...(extra.contentQuality !== undefined ? { contentQuality: extra.contentQuality } : {}),
    ...(extra.nextAction ? { nextAction: extra.nextAction } : {}),
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
  contentQuality?: unknown;
  markdown?: unknown;
  hashtags?: unknown;
  approvedAt?: unknown;
  createdAt?: unknown;
  title?: unknown;
  connectKind?: unknown;
  version?: unknown;
  imageCount?: unknown;
  heroImagePath?: unknown;
  bodyImagePaths?: unknown;
  imageSlots?: unknown;
  qualityRepair?: unknown;
  imageGeneration?: unknown;
  generationSource?: unknown;
};

function stripPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPaths);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (/path|Path$/u.test(key) && typeof item === "string") continue;
    if (key === "assets" || key === "previewUrl") continue;
    output[key] = stripPaths(item);
  }
  return output;
}

type DraftManifest = ReturnType<typeof readBrandPostPackage>;

function readDraftManifestSafe(id: string): DraftManifest {
  try {
    return readBrandPostPackage(id);
  } catch {
    return null;
  }
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * imageSlots 안전 투영. 예전 stripPaths 는 assets 를 통째로 지워 ChatGPT 가 assetKey 를 볼 수 없었다.
 * 경로·previewUrl 은 빼고, 슬롯마다 ChatGPT 내장 이미지 생성에 바로 쓸 imagePrompt(PC 배치와 같은 문구)를 붙인다.
 */
function safeImageSlots(preview: DraftPreview, manifest: DraftManifest): Array<Record<string, unknown>> | null {
  if (!Array.isArray(preview.imageSlots)) return null;
  const v2 = manifest && manifest.version === "brand-post-package/v2" ? manifest : null;
  const connectKind: "SHOPPING" | "TRAVEL" = (v2?.connectKind || manifest?.connectKind || preview.connectKind) === "TRAVEL" ? "TRAVEL" : "SHOPPING";
  const productName = v2?.title || (typeof preview.title === "string" ? preview.title : "");
  return preview.imageSlots.map((slot) => {
    const record = slot && typeof slot === "object" && !Array.isArray(slot) ? slot as Record<string, unknown> : {};
    const sectionId = typeof record.sectionId === "string" ? record.sectionId : "";
    const title = typeof record.title === "string" ? record.title : "";
    const intent = typeof record.intent === "string" ? record.intent : "";
    const section = v2?.composition.sections.find((candidate) => candidate.id === sectionId) || null;
    const assets = Array.isArray(record.assets)
      ? record.assets
          .filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object" && !Array.isArray(asset))
          .map((asset) => ({
            assetKey: typeof asset.assetKey === "string" ? asset.assetKey : typeof asset.sha256 === "string" ? asset.sha256 : null,
            role: asset.role ?? null,
            provenance: asset.provenance ?? "ORIGINAL",
            imageIntent: asset.imageIntent ?? null,
          }))
      : [];
    return {
      sectionId,
      title,
      intent,
      minimum: numberField(record, "minimum"),
      recommended: numberField(record, "recommended"),
      maximum: numberField(record, "maximum"),
      count: numberField(record, "count"),
      missing: numberField(record, "missing"),
      originalCount: numberField(record, "originalCount"),
      generatedCount: numberField(record, "generatedCount"),
      generationMissing: numberField(record, "generationMissing"),
      assets,
      generationRole: connectKind === "SHOPPING" ? "background-only-product-lock" : "travel-editorial-scene",
      imagePrompt: productName && (title || intent)
        ? buildBrandPostImagePrompt({
            connectKind,
            productName,
            sectionTitle: title,
            imageIntent: intent,
            bodyExcerpt: section ? section.body.join(" ").slice(0, 480) : "",
            role: "body",
          })
        : null,
    };
  });
}

function remainingGenerationMissing(slots: Array<Record<string, unknown>> | null): number {
  return (slots || []).reduce((sum, slot) => sum + numberField(slot, "generationMissing"), 0);
}

/** 초안 미리보기에서 PC 파일 경로를 제거하고 ChatGPT 가 검토할 정보만 남긴다. */
function draftView(draftId: string, preview: DraftPreview, includeMarkdown: boolean, manifest: DraftManifest = null): Record<string, unknown> {
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
    generationSource: preview.generationSource ?? null,
    hashtags: Array.isArray(preview.hashtags) ? preview.hashtags : [],
    imageCount: typeof preview.imageCount === "number" ? preview.imageCount : 1 + bodyImageCount,
    heroImageReady: typeof preview.heroImagePath === "string" && fs.existsSync(preview.heroImagePath),
    sectionOutline: preview.sectionOutline ?? null,
    imageSlots: safeImageSlots(preview, manifest),
    readiness: preview.readiness ?? null,
    contentQuality: preview.contentQuality ?? null,
    qualityRepair: preview.qualityRepair ?? null,
    imageGeneration: stripPaths(preview.imageGeneration ?? null),
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

async function uploadRemoteImageAsset(imagePath: string): Promise<string | null> {
  if (!fs.existsSync(imagePath)) return null;
  const remote = config();
  if (!remote.siteUrl || !remote.token) return null;
  const image = fs.readFileSync(imagePath);
  const contentType = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
    ? "image/jpeg"
    : image.subarray(0, 4).toString("ascii") === "RIFF" && image.subarray(8, 12).toString("ascii") === "WEBP"
      ? "image/webp"
      : image[0] === 0x89 && image.subarray(1, 4).toString("ascii") === "PNG"
        ? "image/png"
        : null;
  if (!contentType) return null;
  const response = await fetch(`${remote.siteUrl}/api/agent/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${remote.token}`, "content-type": contentType },
    body: image,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { data?: { url?: unknown } } | null;
  const url = payload?.data?.url;
  return response.ok && typeof url === "string" && url.startsWith("https://") ? url : null;
}

async function uploadDraftImageAssets(preview: DraftPreview): Promise<Array<{ role: "hero" | "body"; sectionIndex: number | null; url: string }>> {
  const heroPath = typeof preview.heroImagePath === "string" ? preview.heroImagePath : null;
  const bodyPaths = Array.isArray(preview.bodyImagePaths)
    ? preview.bodyImagePaths.filter((value): value is string => typeof value === "string")
    : [];
  const sectionByPath = new Map<string, number>();
  if (Array.isArray(preview.imageSlots)) {
    preview.imageSlots.forEach((slot, sectionIndex) => {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) return;
      const assets = (slot as Record<string, unknown>).assets;
      if (!Array.isArray(assets)) return;
      for (const asset of assets) {
        if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
        const imagePath = (asset as Record<string, unknown>).path;
        if (typeof imagePath === "string") sectionByPath.set(path.resolve(imagePath), sectionIndex);
      }
    });
  }
  const candidates = [
    ...(heroPath ? [{ role: "hero" as const, sectionIndex: null, path: heroPath }] : []),
    ...bodyPaths.map((imagePath) => ({
      role: "body" as const,
      sectionIndex: sectionByPath.get(path.resolve(imagePath)) ?? null,
      path: imagePath,
    })),
  ];
  const uploaded = await Promise.all(candidates.map(async (candidate) => ({
    ...candidate,
    url: await uploadRemoteImageAsset(candidate.path).catch(() => null),
  })));
  return uploaded
    .filter((item): item is typeof item & { url: string } => typeof item.url === "string")
    .map(({ role, sectionIndex, url }) => ({ role, sectionIndex, url }));
}

function readinessSummary(readiness: unknown): string {
  if (!readiness || typeof readiness !== "object") return "검증 정보 없음";
  const record = readiness as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : typeof record.canPublish === "boolean" ? (record.canPublish ? "READY" : "BLOCKED") : "UNKNOWN";
  const score = typeof record.score === "number" ? ` ${record.score}점` : "";
  const summary = typeof record.summary === "string" && record.summary ? ` — ${record.summary}` : "";
  return `${status}${score}${summary}`;
}

function draftReadiness(preview: DraftPreview): unknown {
  return preview.readiness ?? preview.contentQuality ?? null;
}

function draftContentQuality(preview: DraftPreview): unknown {
  const quality = preview.contentQuality;
  if (!quality || typeof quality !== "object" || Array.isArray(quality)) return null;
  const record = quality as Record<string, unknown>;
  return {
    canPublish: record.canPublish ?? null,
    code: record.code ?? null,
    score: record.score ?? null,
    reason: record.reason ?? null,
    summary: record.summary ?? null,
    signals: Array.isArray(record.signals)
      ? record.signals.map((signal) => {
          const item = signal && typeof signal === "object" && !Array.isArray(signal) ? signal as Record<string, unknown> : {};
          return { key: item.key ?? null, label: item.label ?? null, status: item.status ?? null, detail: item.detail ?? null };
        })
      : [],
  };
}

function sniffImageExtension(filePath: string): ".png" | ".jpg" | ".webp" | null {
  try {
    const handle = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(12);
      const read = fs.readSync(handle, header, 0, 12, 0);
      if (read < 12) return null;
      if (header[0] === 0x89 && header.subarray(1, 4).toString("ascii") === "PNG") return ".png";
      if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return ".jpg";
      if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
      return null;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
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
    const writingStatus = readString(input, "writingStatus").toLowerCase() || "all";
    const keyword = readString(input, "keyword").slice(0, 80);
    const limit = readInteger(input, "limit", 50, 1, 200);
    const sort = readString(input, "sort") || "newest";
    const matchesWritingStatus = (item: { writingStatus: Parameters<typeof matchesWritingStatusFilter>[0] }) =>
      matchesWritingStatusFilter(item.writingStatus, writingStatus === "written" || writingStatus === "unwritten" ? writingStatus : "all");
    if (kind === "TRAVEL") {
      // 여행커넥트는 DB에 이미 등록된 링크만 조회하면 추천 피드의 대부분이
      // 사라진다. 로그인 세션의 전체 여행 피드를 읽어 AVAILABLE/등록 상태로
      // 합쳐 반환해 ChatGPT가 실제 후보 수를 볼 수 있게 한다.
      const payload = await localApi(request, `/api/brandlinks/available?status=${encodeURIComponent(status)}&writingStatus=${encodeURIComponent(writingStatus)}`);
      const data = (payload.data || {}) as Record<string, unknown>;
      let products = Array.isArray(data.products) ? (data.products as Array<Record<string, unknown>>) : [];
      if (keyword) products = products.filter((item) => `${item.productName ?? ""} ${item.storeName ?? ""}`.includes(keyword));
      products = products.slice(0, limit);
      return envelope(job, "product-list", `${kindLabel} 상품 ${products.length}건 (필터: ${status.toLowerCase()}${keyword ? `, "${keyword}"` : ""})`, { ...data, connectKind: "travel", count: products.length, products }, ctx);
    }
    const links = await prisma.brandLink.findMany({
      where: {
        connectKind: kind,
        ...(status !== "ALL" ? { status } : {}),
        ...(keyword ? { OR: [{ productName: { contains: keyword } }, { storeName: { contains: keyword } }] } : {}),
      },
      orderBy: sort === "name" ? { productName: "asc" } : sort === "oldest" ? { createdAt: "asc" } : { updatedAt: "desc" },
      take: 200,
    });
    const products = collapseBrandLinkProducts(links.map((link) => ({
      ...link,
      draftPrepared: (() => {
        try { return Boolean(readBrandPostPackage(link.id)); } catch { return false; }
      })(),
    }))).filter(matchesWritingStatus).slice(0, limit);
    const view = products.map((item) => ({
      id: item.id,
      productName: item.productName,
      storeName: item.storeName,
      price: item.productPrice,
      status: item.status,
      statusMeaning: item.statusMeaning,
      canCreateDraft: item.canCreateDraft,
      lastError: item.status === "FAILED" ? item.errorMessage : null,
      duplicateCount: item.duplicateCount,
      url: item.url,
      postUrl: item.postUrl,
      scheduledPublishAt: item.scheduledPublishAt ? new Date(item.scheduledPublishAt).toISOString() : null,
      draft: (() => {
        try {
          const manifest = readBrandPostPackage(item.id);
          return manifest ? { exists: true, approved: Boolean(manifest.approvedAt), canPublish: manifest.contentQuality?.canPublish ?? null } : { exists: false, approved: false, canPublish: null };
        } catch {
          return { exists: false, approved: false, canPublish: null };
        }
      })(),
    }));
    return envelope(job, "product-list", `${kindLabel} 상품 ${view.length}건 (필터: ${status.toLowerCase()}${keyword ? `, "${keyword}"` : ""})`, {
      connectKind: kind.toLowerCase(),
      count: view.length,
      rawCount: links.length,
      collapsedDuplicateCount: links.length - products.length,
      products: view,
    }, ctx);
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
    // post_generate_draft_local: PC 의 OpenAI 키로 전량 생성. 이미지 배치는 돌지 않는다(origin:"mcp").
    const productId = readString(input, "productId");
    const product = await requireProduct(productId, kind);
    const memo = readString(input, "memo").slice(0, 1000);
    const baseMessage = `초안 생성: ${product.productName || productId}`;
    ctx.setStage("drafting", baseMessage, 10);
    ctx.draftProgress = { productId, startedAt: Date.now(), mode: "generate", baseMessage };
    const payload = await localApi(
      request,
      `/api/brandlinks/${encodeURIComponent(productId)}/draft`,
      { method: "POST", body: JSON.stringify({ ...(memo ? { memo } : {}), origin: "mcp" }) },
      { timeoutMs: DRAFT_GENERATE_WAIT_MS },
    );
    ctx.draftProgress = null;
    const preview = (payload.data || {}) as DraftPreview;
    if (typeof payload.imageRepairWarning === "string") ctx.warnings.push(payload.imageRepairWarning);
    const manifest = readDraftManifestSafe(productId);
    const view = draftView(productId, preview, true, manifest);
    const remaining = remainingGenerationMissing(view.imageSlots as Array<Record<string, unknown>> | null);
    const imageAssets = await uploadDraftImageAssets(preview);
    if (imageAssets.length === 0) ctx.warnings.push("초안 이미지를 HTTPS 미리보기 주소로 업로드하지 못했습니다.");
    const readiness = draftReadiness(preview);
    return envelope(job, "draft", `초안 생성 완료 — ${readinessSummary(readiness)}.${remaining > 0 ? ` 섹션 이미지 ${remaining}장이 비어 있습니다.` : ""} 검토 후 post_approve_draft 로 승인하세요.`, { ...view, imageAssets, remainingMissing: remaining }, ctx, {
      readiness,
      contentQuality: draftContentQuality(preview),
      nextAction: remaining > 0 ? SECTION_IMAGE_NEXT_ACTION : "post_get_draft 로 초안을 검토하고 post_approve_draft 로 승인하세요.",
    });
  }

  if (job.type === "POST_PREPARE_DRAFT") {
    // post_create_draft / post_prepare_draft: 컨텍스트 준비 전용. 원고는 ChatGPT 가 쓴다.
    const productId = readString(input, "productId");
    const product = await requireProduct(productId, kind);
    const baseMessage = `초안 근거 준비: ${product.productName || productId}`;
    ctx.setStage("draft-context", baseMessage, 10);
    ctx.draftProgress = { productId, startedAt: Date.now(), mode: "prepare", baseMessage };
    const response = await localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/draft`, {
      method: "POST",
      body: JSON.stringify({
        action: "prepare_context",
        qualityPreset: input.qualityPreset,
        experienceMode: input.experienceMode,
        experienceNotes: input.experienceNotes,
        memo: input.memo,
        origin: "mcp",
      }),
    }, { timeoutMs: DRAFT_PREPARE_WAIT_MS });
    ctx.draftProgress = null;
    const data = (response.data || response) as Record<string, unknown>;
    const prepared = buildPreparedDraftView(data, productId, job.id, ctx.warnings);
    return envelope(job, "draft-context", `초안 근거 준비 완료 (${product.productName || productId}). 이 ChatGPT 가 systemPrompt·userPrompt 로 원고 JSON 을 작성해 post_submit_draft(contextJobId=${job.id}) 로 제출하세요.`, prepared, ctx, {
      nextAction: `verifiedFacts·sourceImages 만 근거로 systemPrompt 와 userPrompt 에 따라 원고 JSON(title, evidenceFacts, sections, hashtags)을 작성하고 harness.qualityChecklist 로 자체 검수한 뒤 post_submit_draft(contextJobId=${job.id}) 를 호출하세요. PC 는 원고를 쓰지 않습니다.`,
    });
  }

  if (job.type === "POST_SUBMIT_DRAFT") {
    // 품질검사 + 초안 저장만. 이미지 생성은 호출하지 않는다(ChatGPT 내장 이미지 생성 + post_apply_section_image).
    const productId = readString(input, "productId");
    await requireProduct(productId, kind);
    const baseMessage = "ChatGPT 원고 검증·패키징";
    ctx.setStage("draft-submit", baseMessage, 15);
    ctx.draftProgress = { productId, startedAt: Date.now(), mode: "generate", baseMessage };
    const response = await localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/draft`, {
      method: "POST",
      body: JSON.stringify({
        action: "submit_generated",
        qualityPreset: input.qualityPreset,
        experienceMode: input.experienceMode,
        experienceNotes: input.experienceNotes,
        draft: input.draft,
        contextSnapshot: input.contextSnapshot,
        origin: "mcp",
      }),
    }, { timeoutMs: DRAFT_GENERATE_WAIT_MS });
    ctx.draftProgress = null;
    const preview = (response.data || {}) as DraftPreview;
    if (typeof response.imageRepairWarning === "string") ctx.warnings.push(response.imageRepairWarning);
    const submittedManifest = readDraftManifestSafe(productId);
    const contentQuality = preview.contentQuality as {
      canPublish?: boolean;
      code?: string;
      score?: number;
      reason?: string | null;
      summary?: string;
      signals?: unknown;
    } | null | undefined;
    const requiresRepair = Boolean(contentQuality && contentQuality.canPublish === false);
    const failedSignals = Array.isArray(contentQuality?.signals)
      ? contentQuality.signals.filter((signal: Record<string, unknown>) => signal.status === "fail")
      : [];
    const imageOnlyRepair = requiresRepair && failedSignals.length > 0 && failedSignals.every(
      (signal: Record<string, unknown>) => signal.key === "composition-quality",
    );
    const view = draftView(productId, preview, false, submittedManifest);
    const remaining = remainingGenerationMissing(view.imageSlots as Array<Record<string, unknown>> | null);
    const imageAssets = await uploadDraftImageAssets(preview);
    if (imageAssets.length === 0) ctx.warnings.push("초안 이미지를 HTTPS 미리보기 주소로 업로드하지 못했습니다.");
    return envelope(job, "draft", requiresRepair
      ? imageOnlyRepair ? `원고 내용은 통과했습니다. 섹션 이미지 ${remaining}장을 ChatGPT 내장 이미지 생성으로 만들어 post_apply_section_image 로 붙이세요. 이미지 부족 때문에 본문을 다시 작성하지 마세요.` : `원고는 저장됐지만 품질 보강이 필요합니다: ${contentQuality?.reason || contentQuality?.summary || "근거 밀도 미달"}`
      : `ChatGPT 원고를 PC에서 검증하고 승인 대기 초안 패키지로 저장했습니다.${remaining > 0 ? ` 섹션 이미지 ${remaining}장은 post_apply_section_image 로 채우세요.` : ""}`, { ...view, requiresRepair, imageAssets, remainingMissing: remaining }, ctx, {
      readiness: draftReadiness(preview),
      contentQuality: draftContentQuality(preview),
      nextAction: requiresRepair
        ? imageOnlyRepair ? SECTION_IMAGE_NEXT_ACTION : "contentQuality.reason과 실패 signals를 반영해 같은 컨텍스트로 원고를 고친 뒤 새 idempotencyKey로 post_submit_draft를 다시 호출하세요. 이미지 부족은 재제출 사유가 아닙니다."
        : remaining > 0 ? SECTION_IMAGE_NEXT_ACTION : "post_get_draft 로 초안을 확인하고 post_approve_draft 로 승인한 뒤, 실제 발행은 사용자 확인 후 진행하세요.",
    });
  }

  if (job.type === "POST_GET_DRAFT") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    ctx.setStage("reading", "초안 읽기", 30);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`);
    const preview = payload.data as DraftPreview | null;
    if (!preview) throw new LocalAutomationError("DRAFT_NOT_FOUND", LOCAL_AUTOMATION_ERROR_HINTS.DRAFT_NOT_FOUND);
    const view = draftView(draftId, preview, true, readDraftManifestSafe(draftId));
    if (readString(input, "includeImages") === "thumbnail") {
      const hero = await heroImagePayload(preview.heroImagePath);
      if (hero) view.heroImage = hero;
      else ctx.warnings.push("대표 이미지를 첨부하지 못했습니다(파일 없음 또는 크기 초과).");
    }
    const remaining = remainingGenerationMissing(view.imageSlots as Array<Record<string, unknown>> | null);
    view.remainingMissing = remaining;
    const readiness = draftReadiness(preview);
    return envelope(job, "draft", `초안 ${view.approved ? "(승인됨)" : "(미승인)"} — ${readinessSummary(readiness)}${remaining > 0 ? ` · 섹션 이미지 ${remaining}장 미완료` : ""}`, view, ctx, {
      readiness,
      contentQuality: draftContentQuality(preview),
      ...(remaining > 0 && !view.approved ? { nextAction: SECTION_IMAGE_NEXT_ACTION } : {}),
    });
  }

  if (job.type === "POST_APPLY_SECTION_IMAGE") {
    // ChatGPT 내장 이미지 생성 결과를 섹션 슬롯에 붙인다. PC 는 다운로드·잠금 합성·패키지 반영만 한다.
    const productId = readString(input, "productId") || readString(input, "draftId");
    const sectionId = readString(input, "sectionId").slice(0, 120);
    const replaceAssetKey = readString(input, "replaceAssetKey");
    const generatedImageUrl = readString(input, "generatedImageUrl");
    if (!productId || !generatedImageUrl || (!sectionId && !replaceAssetKey)) {
      throw new LocalAutomationError("INVALID_INPUT", "상품(productId), 대상 파트(sectionId 또는 replaceAssetKey), 생성 이미지 주소(generatedImageUrl)가 필요합니다.");
    }
    if (replaceAssetKey && !/^[a-f0-9]{64}$/u.test(replaceAssetKey)) {
      throw new LocalAutomationError("INVALID_INPUT", "replaceAssetKey 는 post_get_draft 의 imageSlots.assets[].assetKey 값이어야 합니다.");
    }
    const product = await requireProduct(productId, kind);
    const manifest = readDraftManifestSafe(productId);
    if (!manifest || manifest.version !== "brand-post-package/v2") {
      throw new LocalAutomationError("DRAFT_NOT_FOUND", "이미지를 붙일 v2 초안 패키지가 없습니다. 먼저 post_create_draft → post_submit_draft 로 초안을 만드세요.");
    }
    ctx.setStage("section-image", `섹션 이미지 다운로드: ${sectionId || replaceAssetKey}`, 20);
    const workDir = path.join(getBrandPostPackageDir(productId), "image-generation-work", "external-downloads");
    await fs.promises.mkdir(workDir, { recursive: true });
    const downloadBase = path.join(workDir, randomUUID());
    let downloadPath = `${downloadBase}.bin`;
    try {
      await downloadBoundedImage(generatedImageUrl, downloadPath, "generated");
      const extension = sniffImageExtension(downloadPath);
      if (!extension) throw new LocalAutomationError("INVALID_INPUT", "다운로드한 파일이 PNG/JPEG/WebP 이미지가 아닙니다.");
      const typedPath = `${downloadBase}${extension}`;
      await fs.promises.rename(downloadPath, typedPath);
      downloadPath = typedPath;
      assertNotCancelled(ctx);
      ctx.setStage("section-image", kind === "SHOPPING" ? "원본 상품 잠금 합성·패키지 반영" : "패키지 반영", 60);
      const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/draft/images`, {
        method: "POST",
        body: JSON.stringify({
          action: "apply_generated",
          ...(sectionId ? { sectionId } : {}),
          ...(replaceAssetKey ? { replaceAssetKey } : {}),
          generatedPath: downloadPath,
        }),
      }, { timeoutMs: SECTION_IMAGE_APPLY_WAIT_MS });
      const preview = (payload.data || {}) as DraftPreview;
      const slots = safeImageSlots(preview, readDraftManifestSafe(productId));
      const remaining = typeof payload.remainingMissing === "number" ? payload.remainingMissing : remainingGenerationMissing(slots);
      const alreadyApplied = payload.alreadyApplied === true;
      return envelope(job, "section-image", alreadyApplied
        ? `같은 이미지가 이미 반영되어 있습니다. 남은 파트 ${remaining}개.`
        : `섹션 이미지를 반영했습니다. 남은 파트 ${remaining}개.`, {
        draftId: productId,
        productName: product.productName,
        connectKind: kind.toLowerCase(),
        sectionId: typeof payload.sectionId === "string" ? payload.sectionId : sectionId || null,
        assetKey: typeof payload.assetKey === "string" ? payload.assetKey : null,
        provenance: payload.provenance ?? null,
        alreadyApplied,
        remainingMissing: remaining,
        approved: Boolean(preview.approvedAt),
        imageSlots: slots,
        imageGeneration: stripPaths(preview.imageGeneration ?? null),
      }, ctx, {
        nextAction: remaining > 0
          ? SECTION_IMAGE_NEXT_ACTION
          : "모든 파트에 이미지가 채워졌습니다. post_get_draft 로 확인하고 post_approve_draft 로 승인하세요.",
      });
    } finally {
      await fs.promises.unlink(downloadPath).catch(() => undefined);
    }
  }

  if (job.type === "POST_REVISE_DRAFT") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    const instructions = readString(input, "instructions").slice(0, 2000);
    if (instructions.length < 2) throw new LocalAutomationError("INVALID_INPUT", "수정 지시(instructions)가 필요합니다.");
    const sectionIndexes = Array.isArray(input.sectionIndexes) ? input.sectionIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < 40).slice(0, 20) : [];
    ctx.setStage("revising", sectionIndexes.length ? `섹션 ${sectionIndexes.join(",")} 수정` : "초안 전체 수정", 15);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`, { method: "PATCH", body: JSON.stringify({ action: "revise", instructions, sectionIndexes }) }, { timeoutMs: DRAFT_GENERATE_WAIT_MS });
    const preview = (payload.data || {}) as DraftPreview;
    const view = draftView(draftId, preview, true, readDraftManifestSafe(draftId));
    const readiness = draftReadiness(preview);
    return envelope(job, "draft", `초안 수정 완료 — ${readinessSummary(readiness)}. 승인은 다시 필요합니다.`, view, ctx, { readiness });
  }

  if (job.type === "POST_APPROVE_DRAFT") {
    const draftId = readString(input, "draftId");
    await requireProduct(draftId, kind);
    ctx.setStage("approving", "초안 승인", 40);
    const payload = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
    const preview = (payload.data || {}) as DraftPreview;
    const view = draftView(draftId, preview, false, readDraftManifestSafe(draftId));
    return envelope(job, "draft", "초안을 승인했습니다. post_publish 또는 post_schedule 로 발행할 수 있습니다.", view, ctx, { readiness: draftReadiness(preview) });
  }

  if (job.type === "POST_SET_THUMBNAIL") {
    const draftId = readString(input, "draftId");
    const product = await requireProduct(draftId, kind);
    ctx.setStage("thumbnail", "썸네일 생성(gpt-image + QC)", 10);
    const meta = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/thumbnail`);
    const metaData = (meta.data || {}) as Record<string, unknown>;
    const imageUrls = Array.isArray(metaData.imageUrls) ? metaData.imageUrls.filter((value): value is string => typeof value === "string") : [];
    if (imageUrls.length === 0) throw new LocalAutomationError("IMAGE_SHORTFALL", "썸네일 원본으로 쓸 제품 사진이 없습니다. 상품을 먼저 동기화하세요.");
    if (metaData.engine === "local") ctx.warnings.push("이 PC 에는 OpenAI 키가 없어 로컬 합성 썸네일만 만들 수 있습니다. ChatGPT 이미지 생성이 필요하면 thumbnail_prepare 를 사용하세요.");
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
    if (engine === "local" && metaData.engine !== "local") ctx.warnings.push("gpt-image 결과가 QC 를 통과하지 못해 로컬 합성 썸네일로 저장했습니다.");
    const heroSmall = typeof data.outputPath === "string" ? await heroImagePayload(data.outputPath) : null;
    const heroImageUrl = typeof data.outputPath === "string" ? await uploadRemoteImageAsset(data.outputPath).catch(() => null) : null;
    if (!heroImageUrl) ctx.warnings.push("썸네일 HTTPS 미리보기 업로드에 실패해 인라인 이미지만 반환했습니다.");
    return envelope(job, "thumbnail", `썸네일 저장 완료 (${engine}${typeof qc?.score === "number" ? `, QC ${qc.score}점` : ""}, ${data.attempts ?? 0}회 시도). 다음 초안 생성/발행부터 이 썸네일을 사용합니다.`, {
      draftId,
      engine,
      mood: data.mood ?? mood ?? null,
      copy: data.copy ?? { headline, subline },
      qc: qc ?? null,
      attempts: data.attempts ?? null,
      ...(heroImageUrl ? { heroImageUrl } : {}),
      ...(heroSmall ? { heroImage: heroSmall } : {}),
    }, ctx);
  }

  if (job.type === "THUMBNAIL_PREPARE") {
    const productId = readString(input, "productId");
    const product = await requireProduct(productId, kind);
    ctx.setStage("thumbnail-prepare", "GPT 썸네일 지침 준비", 30);
    const imageUrls = parseImageUrls(product.imageUrls);
    if (imageUrls.length === 0) throw new LocalAutomationError("IMAGE_SHORTFALL", "GPT 썸네일에 사용할 실제 이미지가 없습니다. 상품 정보를 먼저 동기화하세요.");
    const brief = buildChatGptThumbnailPrompt(kind, product.productName || (kind === "TRAVEL" ? "여행 상품" : "추천 상품"));
    const requestedLayout = readString(input, "layout") || "auto";
    const candidateCount = readInteger(input, "candidateCount", 3, 1, 3);
    const layoutCandidates = requestedLayout === "auto"
      ? brief.localLayoutCandidates.slice(0, candidateCount)
      : [requestedLayout];
    return envelope(job, "thumbnail-brief", `썸네일 생성 지침 준비 완료 (${product.productName})`, {
      productId: product.id,
      connectKind: kind.toLowerCase(),
      productName: product.productName,
      productPrice: product.productPrice,
      storeName: product.storeName,
      referralUrl: product.url,
      referenceImageUrls: imageUrls,
      preferredReferenceImageUrl: imageUrls[0],
      ...brief,
      layoutCandidates,
    }, ctx, {
      nextAction: kind === "SHOPPING"
        ? "ChatGPT 내장 이미지 생성으로 prompt의 배경만 생성하세요. 원본 상품은 생성 이미지에 넣지 마세요. 생성 후 사용자 확인을 받고 thumbnail_apply_generated 를 호출하세요."
        : "ChatGPT 내장 이미지 생성으로 prompt의 여행 실사 배경을 생성하세요. 생성 전 사용자에게 참고 이미지와 방향을 보여주고, 생성 후 thumbnail_apply_generated 를 호출하세요.",
    });
  }

  if (job.type === "THUMBNAIL_APPLY_GENERATED") {
    const productId = readString(input, "productId");
    const generatedImageUrl = readString(input, "generatedImageUrl");
    if (!productId || !generatedImageUrl || input.confirmed !== true) throw new LocalAutomationError("INVALID_INPUT", "상품, 생성 이미지 주소, confirmed=true가 필요합니다.");
    const product = await requireProduct(productId, kind);
    ctx.setStage("thumbnail-apply", "생성 배경 + 원본 합성", 20);
    const imageUrls = parseImageUrls(product.imageUrls);
    const sourceImageUrl = imageUrls[0];
    if (!sourceImageUrl) throw new LocalAutomationError("IMAGE_SHORTFALL", "원본 상품·여행 이미지가 없습니다. 상품 정보를 먼저 동기화하세요.");
    const suggested = kind === "TRAVEL"
      ? buildTravelThumbnailCopy(product.productName || "여행 상품")
      : buildProductThumbnailCopy(`${product.productName || "상품"} 구매 전 확인`, product.productName || "추천 상품", "SHOPPING");
    const copy = normalizeProductThumbnailCopy({
      productNameLabel: readString(input, "productNameLabel") || suggested.productNameLabel,
      headline: readString(input, "headline") || suggested.headline,
      subline: readString(input, "subline") || suggested.subline,
      badge: readString(input, "badge") || suggested.badge,
      cta: readString(input, "cta") || suggested.cta,
    }, product.productName || "추천 상품");
    const outputDir = getProductThumbnailStorageDir();
    await fs.promises.mkdir(outputDir, { recursive: true });
    const runId = randomUUID();
    const sourcePath = path.join(outputDir, `${productId}-${runId}.source`);
    const backgroundPath = path.join(outputDir, `${productId}-${runId}.gpt-background`);
    try {
      await Promise.all([
        downloadBoundedImage(sourceImageUrl, sourcePath, "naver"),
        downloadBoundedImage(generatedImageUrl, backgroundPath, "generated"),
      ]);
      const layoutId = readString(input, "layoutId");
      const shoppingStyle = layoutId === "shopping-clean-editorial"
        ? "shopping-clean-editorial"
        : layoutId === "shopping-soft-lifestyle"
          ? "shopping-soft-lifestyle"
          : "shopping-color-block";
      const travelStyle = layoutId === "travel-emotional-record"
        ? "travel-postcard"
        : layoutId === "travel-route"
          ? "travel-route"
          : "travel-editorial";
      const result = kind === "SHOPPING"
        ? await createLockedProductThumbnailOnBackground({ sourcePath, backgroundPath, outputDir, productName: product.productName || "추천 상품", headline: copy.headline, subline: copy.subline, style: shoppingStyle })
        : await createTravelEditorialThumbnail({ sourcePath: backgroundPath, outputDir, destination: product.productName || "여행 상품", headline: copy.headline, subline: copy.subline, badge: copy.badge, style: travelStyle });
      const updatedAt = new Date().toISOString();
      const settingValue = JSON.stringify({ version: 1, sourceImageUrl, generatedPath: result.outputPath, copy, style: kind === "SHOPPING" ? "gpt-background-lock" : "gpt-travel-editorial", updatedAt });
      await prisma.setting.upsert({
        where: { key: productThumbnailSettingKey(productId) },
        update: { value: settingValue },
        create: { key: productThumbnailSettingKey(productId), value: settingValue },
      });
      const heroSmall = await heroImagePayload(result.outputPath);
      const heroImageUrl = await uploadRemoteImageAsset(result.outputPath).catch(() => null);
      if (!heroImageUrl) ctx.warnings.push("썸네일 HTTPS 미리보기 업로드에 실패해 인라인 이미지만 반환했습니다.");
      return envelope(job, "thumbnail", "ChatGPT 생성 배경과 원본을 합성해 썸네일로 저장했습니다.", {
        applied: true,
        productId,
        connectKind: kind.toLowerCase(),
        sourceImageUrl,
        generatedImageUrl,
        copy,
        layoutId: layoutId || (kind === "SHOPPING" ? "shopping-color-block" : "travel-cinematic"),
        candidateId: readString(input, "candidateId") || null,
        updatedAt,
        ...(heroImageUrl ? { heroImageUrl } : {}),
        ...(heroSmall ? { heroImage: heroSmall } : {}),
      }, ctx);
    } finally {
      await Promise.all([fs.promises.unlink(sourcePath).catch(() => undefined), fs.promises.unlink(backgroundPath).catch(() => undefined)]);
    }
  }

  if (job.type === "BLOG_PROFILE_GET" || job.type === "BLOG_DESIGN_GET") {
    ctx.setStage("blog-profile", "네이버 블로그 관리 화면 읽기", 30);
    const snapshot = await inspectNaverBlogProfile();
    if (job.type === "BLOG_DESIGN_GET") {
      return envelope(job, "blog-design", "블로그 디자인 설정 경로를 확인했습니다.", {
        skinUrl: snapshot.skinUrl,
        layoutUrl: snapshot.layoutUrl,
        detailDesignUrl: snapshot.detailDesignUrl,
        capturedAt: snapshot.capturedAt,
        backupScreenshotSaved: Boolean(snapshot.screenshotPath),
        supportedAutomaticChanges: [],
        manualReviewRequired: ["skin", "layout", "widget", "title background", "post style"],
      }, ctx);
    }
    const { screenshotPath: _screenshotPath, ...rest } = snapshot as NaverBlogProfileSnapshot & { screenshotPath?: string | null };
    return envelope(job, "blog-profile", `블로그 프로필: ${snapshot.nickname} / ${snapshot.blogName}`, { ...rest, backupScreenshotSaved: Boolean(_screenshotPath) }, ctx);
  }

  if (job.type === "BLOG_PROFILE_PREPARE") {
    ctx.setStage("blog-profile", "프로필 변경 미리보기", 30);
    const desired = validateNaverBlogProfileChanges({
      ...(typeof input.nickname === "string" ? { nickname: input.nickname } : {}),
      ...(typeof input.blogName === "string" ? { blogName: input.blogName } : {}),
      ...(typeof input.introduction === "string" ? { introduction: input.introduction } : {}),
    });
    const snapshot = await inspectNaverBlogProfile();
    const planId = randomUUID();
    const token = randomUUID();
    const plan: ProfilePlan = {
      version: 1,
      token,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      current: { nickname: snapshot.nickname, blogName: snapshot.blogName, introduction: snapshot.introduction },
      desired,
    };
    await prisma.setting.create({ data: { key: `${PROFILE_PLAN_PREFIX}${planId}`, value: JSON.stringify(plan) } });
    return envelope(job, "blog-profile-plan", "아직 네이버에는 저장하지 않았습니다. 변경 내용을 사용자에게 보여주고 명시적 승인을 받은 뒤 적용하세요.", {
      planId,
      confirmationToken: token,
      expiresAt: plan.expiresAt,
      current: plan.current,
      desired,
      backupScreenshotSaved: Boolean(snapshot.screenshotPath),
    }, ctx, { nextAction: "사용자 승인 후 blog_profile_apply_update(planId, confirmationToken, confirmed=true) 를 호출하세요." });
  }

  if (job.type === "BLOG_PROFILE_APPLY") {
    const planId = readString(input, "planId");
    const token = readString(input, "confirmationToken");
    if (!planId || !token || input.confirmed !== true) throw new LocalAutomationError("INVALID_INPUT", "프로필 적용 계획, 확인 토큰, confirmed=true가 필요합니다.");
    ctx.setStage("blog-profile", "프로필 변경 적용", 30);
    const key = `${PROFILE_PLAN_PREFIX}${planId}`;
    const stored = await prisma.setting.findUnique({ where: { key } });
    if (!stored) throw new LocalAutomationError("INVALID_INPUT", "프로필 변경 계획을 찾을 수 없습니다. 미리보기를 다시 생성하세요.");
    let plan: ProfilePlan;
    try { plan = JSON.parse(stored.value) as ProfilePlan; } catch { throw new LocalAutomationError("INVALID_INPUT", "프로필 변경 계획이 손상되었습니다."); }
    if (plan.version !== 1 || plan.token !== token) throw new LocalAutomationError("INVALID_INPUT", "프로필 변경 확인 토큰이 일치하지 않습니다.");
    if (Date.parse(plan.expiresAt) <= Date.now()) {
      await prisma.setting.delete({ where: { key } }).catch(() => undefined);
      throw new LocalAutomationError("TIMEOUT", "프로필 변경 확인 시간이 만료되었습니다. 미리보기를 다시 생성하세요.");
    }
    const result = await applyNaverBlogProfile(plan.desired, plan.current);
    await prisma.setting.delete({ where: { key } }).catch(() => undefined);
    return envelope(job, "blog-profile-applied", "네이버 블로그 프로필을 저장하고 다시 읽어 확인했습니다.", {
      applied: true,
      before: { nickname: result.before.nickname, blogName: result.before.blogName, introduction: result.before.introduction },
      after: { nickname: result.after.nickname, blogName: result.after.blogName, introduction: result.after.introduction },
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
    if (manifest.contentQuality && manifest.contentQuality.canPublish === false) {
      throw new LocalAutomationError("CONTENT_BLOCKED", `초안 품질검사가 발행 보류 상태입니다: ${manifest.contentQuality.reason || manifest.contentQuality.summary}`);
    }
    ctx.setStage("publish:start", schedule ? `예약 발행 시작 (${scheduledDate})` : "즉시 발행 시작", 10);
    const started = await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/publish`, {
      method: "POST",
      body: JSON.stringify(schedule ? { publishMode: "schedule", scheduledDate } : { publishMode: "now" }),
    });
    const startedData = (started.data || {}) as Record<string, unknown>;
    const outcome = await waitForPublishOutcome(ctx, draftId);
    if (outcome.status === "FAILED") {
      const classified = classifyLocalFailure({ message: outcome.errorMessage || "" });
      throw new LocalAutomationError(classified === "LOCAL_AUTOMATION_FAILED" ? "EDITOR_FAILED" : classified, outcome.errorMessage || "발행 프로세스가 실패했습니다.");
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
    }, ctx, { readiness: manifest.specValidation ?? manifest.contentQuality ?? null });
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
    return envelope(job, "settings", `설정 ${settings.length}개 (시크릿은 설정 여부만 표시)`, { settings, draftCreationMode: data.draftCreationMode ?? null, status: buildStatusSnapshot() }, ctx);
  }

  throw new LocalAutomationError("LOCAL_API_MISSING", `이 PC 앱 버전은 원격 작업 ${job.type} 을(를) 지원하지 않습니다. 앱을 업데이트하세요.`);
}

async function siteFetch(siteUrl: string, token: string, apiPath: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null }> {
  const response = await fetch(`${siteUrl}${apiPath}`, {
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
  const refreshDraftProgress = () => {
    const watch = ctx.draftProgress;
    if (!watch) return;
    // 초안 라우트·simple-agent 가 단계마다 쓰는 progress.json. 작업 시작 이전 기록은 무시한다.
    const progress = readDraftProgress(watch.productId, { since: watch.startedAt - 1_000 });
    if (progress && progress.stage !== "failed") {
      ctx.setStage(`draft:${progress.stage}`, progress.message || watch.baseMessage, progress.progress);
      return;
    }
    const elapsedMin = Math.floor((Date.now() - watch.startedAt) / 60_000);
    if (elapsedMin <= 0) return;
    ctx.setStage(
      stageRef.stage,
      `${watch.baseMessage} (${elapsedMin}분 경과)`,
      watch.mode === "prepare" ? Math.min(60, 10 + elapsedMin * 5) : Math.min(85, 15 + elapsedMin * 3),
    );
  };
  const send = async () => {
    if (stopping) return;
    refreshDraftProgress();
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
    draftProgress: null,
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

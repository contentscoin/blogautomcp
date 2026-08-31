import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireTrustedLocalMutation } from "@/lib/local-request-auth";
import { clearRemoteActivation, readRemoteActivation } from "@/lib/remote-activation";
import { buildProductThumbnailCopy } from "../../../../../scripts/lib/product-thumbnail";
import { buildTravelThumbnailCopy } from "../../../../../scripts/lib/travel-content";
import { getProductThumbnailStorageDir } from "../../../../../scripts/lib/app-paths";
import { createLockedProductThumbnailOnBackground } from "../../../../../scripts/lib/product-image-lock";
import { createTravelEditorialThumbnail } from "../../../../../scripts/lib/travel-thumbnail";
import { normalizeProductThumbnailCopy, productThumbnailSettingKey } from "../../../../../scripts/lib/product-thumbnail-settings";
import { collapseBrandLinkProducts } from "@/lib/brandlink-product-list";
import {
  applyNaverBlogProfile,
  inspectNaverBlogProfile,
  validateNaverBlogProfileChanges,
  type NaverBlogProfileChanges,
  type NaverBlogProfileSnapshot,
} from "../../../../../scripts/lib/naver-blog-profile";

type Job = { id: string; type: string; input: Record<string, unknown> };
type ProfilePlan = {
  version: 1;
  token: string;
  expiresAt: string;
  current: Pick<NaverBlogProfileSnapshot, "nickname" | "blogName" | "introduction">;
  desired: NaverBlogProfileChanges;
};

const PROFILE_PLAN_PREFIX = "naver.blog.profile.plan.";
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;

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
    throw new Error(kind === "generated" ? "ChatGPT가 제공한 안전한 이미지 주소만 적용할 수 있습니다." : "허용되지 않은 네이버 이미지 주소입니다.");
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

function config() {
  const activation = readRemoteActivation();
  return { siteUrl: activation.siteUrl, token: activation.deviceToken };
}

async function localApi(request: NextRequest, path: string, init?: RequestInit) {
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
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success !== false) return payload;
    if (response.status === 404 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    if (response.status === 404) {
      throw new Error(
        `로컬 API가 이 앱 버전에 없습니다: ${path} (404). 블로그오토 PC 앱을 최신 버전으로 업데이트한 뒤 다시 시도하세요.`
      );
    }
    const detail = typeof payload?.error === "string"
      ? payload.error
      : JSON.stringify(payload?.error || `Local API ${response.status} (${url.pathname})`);
    throw new Error(detail);
  }
  throw new Error(`로컬 API가 이 앱 버전에 없습니다: ${path} (404). 블로그오토 PC 앱을 최신 버전으로 업데이트한 뒤 다시 시도하세요.`);
}

async function executeJob(request: NextRequest, job: Job): Promise<unknown> {
  const input = job.input || {};
  const kind = input.connectKind === "travel" ? "TRAVEL" : "SHOPPING";
  if (job.type === "BRANDCONNECT_LIST_PRODUCTS") {
    const status = typeof input.status === "string" ? input.status.toUpperCase() : "ALL";
    if (kind === "TRAVEL") {
      // 여행커넥트는 DB에 이미 등록된 링크만 조회하면 추천 피드의 대부분이
      // 사라진다. 로그인 세션의 전체 여행 피드를 읽어 AVAILABLE/등록 상태로
      // 합쳐 반환해 ChatGPT가 실제 후보 수를 볼 수 있게 한다.
      return localApi(request, `/api/brandlinks/available?status=${encodeURIComponent(status)}`);
    }
    const links = await prisma.brandLink.findMany({
      where: { connectKind: kind, ...(status !== "ALL" ? { status } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    const products = collapseBrandLinkProducts(links);
    return {
      connectKind: kind.toLowerCase(),
      count: products.length,
      rawCount: links.length,
      collapsedDuplicateCount: links.length - products.length,
      products: products.map((item) => ({
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
      })),
    };
  }
  if (job.type === "BRANDCONNECT_SYNC_PRODUCTS") {
    const count = typeof input.count === "number" && Number.isInteger(input.count)
      ? Math.min(50, Math.max(1, input.count))
      : 10;
    return localApi(request, "/api/brandlinks/bulk-seasonal", {
      method: "POST",
      body: JSON.stringify({ connectKind: kind.toLowerCase(), count, waitForCompletion: true }),
    });
  }
  if (job.type === "POST_CREATE_DRAFT" || job.type === "POST_PREPARE_DRAFT") {
    const productId = typeof input.productId === "string" ? input.productId : "";
    if (!productId) throw new Error("productId가 필요합니다.");
    const product = await prisma.brandLink.findUnique({ where: { id: productId }, select: { connectKind: true } });
    if (!product) throw new Error("선택한 상품을 찾을 수 없습니다.");
    if (product.connectKind !== kind) throw new Error("상품의 커넥트 종류가 요청과 일치하지 않습니다.");
    const response = await localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/draft`, {
      method: "POST",
      body: JSON.stringify({
        action: "prepare_context",
        qualityPreset: input.qualityPreset,
        experienceMode: input.experienceMode,
        experienceNotes: input.experienceNotes,
        memo: input.memo,
      }),
    });
    return {
      ...(response?.data || response),
      nextAction:
        "이 컨텍스트의 systemPrompt와 userPrompt로 원고 JSON을 작성하고 qualityChecklist를 내부 검수한 뒤 post_submit_draft를 호출하세요.",
    };
  }
  if (job.type === "POST_SUBMIT_DRAFT") {
    const productId = typeof input.productId === "string" ? input.productId : "";
    if (!productId) throw new Error("productId가 필요합니다.");
    const product = await prisma.brandLink.findUnique({ where: { id: productId }, select: { connectKind: true } });
    if (!product) throw new Error("선택한 상품을 찾을 수 없습니다.");
    if (product.connectKind !== kind) throw new Error("상품의 커넥트 종류가 요청과 일치하지 않습니다.");
    const response = await localApi(request, `/api/brandlinks/${encodeURIComponent(productId)}/draft`, {
      method: "POST",
      body: JSON.stringify({
        action: "submit_generated",
        qualityPreset: input.qualityPreset,
        experienceMode: input.experienceMode,
        experienceNotes: input.experienceNotes,
        draft: input.draft,
      }),
    });
    const result = response?.data || response;
    const contentQuality = result?.contentQuality;
    const requiresRepair = Boolean(contentQuality && contentQuality.canPublish === false);
    return {
      ...result,
      draftId: productId,
      connectKind: kind.toLowerCase(),
      requiresRepair,
      message: requiresRepair
        ? `원고는 저장됐지만 품질 보강이 필요합니다: ${contentQuality.reason || contentQuality.summary || "근거 밀도 미달"}`
        : "ChatGPT 원고를 PC에서 검증하고 승인 대기 초안 패키지로 저장했습니다.",
      nextAction: requiresRepair
        ? "contentQuality.reason과 실패 signals를 반영해 같은 컨텍스트로 원고를 고친 뒤 새 idempotencyKey로 post_submit_draft를 다시 호출하세요."
        : "초안 미리보기를 확인하고 실제 발행은 사용자 확인 뒤 별도로 진행하세요.",
    };
  }
  if (job.type === "THUMBNAIL_PREPARE") {
    const productId = typeof input.productId === "string" ? input.productId : "";
    if (!productId) throw new Error("productId가 필요합니다.");
    const product = await prisma.brandLink.findUnique({
      where: { id: productId },
      select: { id: true, connectKind: true, productName: true, productPrice: true, storeName: true, imageUrls: true, url: true },
    });
    if (!product) throw new Error("선택한 상품을 찾을 수 없습니다.");
    if (product.connectKind !== kind) throw new Error("상품의 커넥트 종류가 요청과 일치하지 않습니다.");
    const imageUrls = parseImageUrls(product.imageUrls);
    if (imageUrls.length === 0) throw new Error("GPT 썸네일에 사용할 실제 이미지가 없습니다. 상품 정보를 먼저 동기화하세요.");
    const brief = buildChatGptThumbnailPrompt(kind, product.productName || (kind === "TRAVEL" ? "여행 상품" : "추천 상품"));
    const requestedLayout = typeof input.layout === "string" ? input.layout : "auto";
    const candidateCount = typeof input.candidateCount === "number" && Number.isInteger(input.candidateCount)
      ? Math.max(1, Math.min(3, input.candidateCount))
      : 3;
    const layoutCandidates = requestedLayout === "auto"
      ? brief.localLayoutCandidates.slice(0, candidateCount)
      : [requestedLayout];
    return {
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
      nextAction: kind === "SHOPPING"
        ? "ChatGPT 내장 GPT Image/imagegen으로 prompt의 배경만 생성하세요. 원본 상품은 생성 이미지에 넣지 마세요."
        : "ChatGPT 내장 GPT Image/imagegen으로 prompt의 여행 실사 배경을 생성하세요. 생성 전 사용자에게 참고 이미지와 방향을 보여주세요.",
    };
  }
  if (job.type === "THUMBNAIL_APPLY_GENERATED") {
    const productId = typeof input.productId === "string" ? input.productId : "";
    const generatedImageUrl = typeof input.generatedImageUrl === "string" ? input.generatedImageUrl : "";
    if (!productId || !generatedImageUrl || input.confirmed !== true) throw new Error("상품, 생성 이미지 주소, confirmed=true가 필요합니다.");
    const product = await prisma.brandLink.findUnique({ where: { id: productId } });
    if (!product) throw new Error("선택한 상품을 찾을 수 없습니다.");
    if (product.connectKind !== kind) throw new Error("상품의 커넥트 종류가 요청과 일치하지 않습니다.");
    const imageUrls = parseImageUrls(product.imageUrls);
    const sourceImageUrl = imageUrls[0];
    if (!sourceImageUrl) throw new Error("원본 상품·여행 이미지가 없습니다. 상품 정보를 먼저 동기화하세요.");
    const suggested = kind === "TRAVEL"
      ? buildTravelThumbnailCopy(product.productName || "여행 상품")
      : buildProductThumbnailCopy(`${product.productName || "상품"} 구매 전 확인`, product.productName || "추천 상품", "SHOPPING");
    const copy = normalizeProductThumbnailCopy({
      productNameLabel: typeof input.productNameLabel === "string" ? input.productNameLabel : suggested.productNameLabel,
      headline: typeof input.headline === "string" ? input.headline : suggested.headline,
      subline: typeof input.subline === "string" ? input.subline : suggested.subline,
      badge: typeof input.badge === "string" ? input.badge : suggested.badge,
      cta: typeof input.cta === "string" ? input.cta : suggested.cta,
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
      const layoutId = typeof input.layoutId === "string" ? input.layoutId : "";
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
      await prisma.setting.upsert({
        where: { key: productThumbnailSettingKey(productId) },
        update: { value: JSON.stringify({ version: 1, sourceImageUrl, generatedPath: result.outputPath, copy, style: kind === "SHOPPING" ? "gpt-background-lock" : "gpt-travel-editorial", updatedAt }) },
        create: { key: productThumbnailSettingKey(productId), value: JSON.stringify({ version: 1, sourceImageUrl, generatedPath: result.outputPath, copy, style: kind === "SHOPPING" ? "gpt-background-lock" : "gpt-travel-editorial", updatedAt }) },
      });
      return { applied: true, productId, connectKind: kind.toLowerCase(), outputPath: result.outputPath, sourceImageUrl, generatedImageUrl, copy, layoutId: layoutId || (kind === "SHOPPING" ? "shopping-color-block" : "travel-cinematic"), candidateId: typeof input.candidateId === "string" ? input.candidateId : null, updatedAt };
    } finally {
      await Promise.all([fs.promises.unlink(sourcePath).catch(() => undefined), fs.promises.unlink(backgroundPath).catch(() => undefined)]);
    }
  }
  if (job.type === "BLOG_PROFILE_GET" || job.type === "BLOG_DESIGN_GET") {
    const snapshot = await inspectNaverBlogProfile();
    if (job.type === "BLOG_DESIGN_GET") {
      return {
        skinUrl: snapshot.skinUrl,
        layoutUrl: snapshot.layoutUrl,
        detailDesignUrl: snapshot.detailDesignUrl,
        capturedAt: snapshot.capturedAt,
        backupScreenshotPath: snapshot.screenshotPath,
        supportedAutomaticChanges: [],
        manualReviewRequired: ["skin", "layout", "widget", "title background", "post style"],
      };
    }
    return snapshot;
  }
  if (job.type === "BLOG_PROFILE_PREPARE") {
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
    return {
      planId,
      confirmationToken: token,
      expiresAt: plan.expiresAt,
      current: plan.current,
      desired,
      backupScreenshotPath: snapshot.screenshotPath,
      message: "아직 네이버에는 저장하지 않았습니다. 변경 내용을 사용자에게 보여주고 명시적 승인을 받은 뒤 적용하세요.",
    };
  }
  if (job.type === "BLOG_PROFILE_APPLY") {
    const planId = typeof input.planId === "string" ? input.planId : "";
    const token = typeof input.confirmationToken === "string" ? input.confirmationToken : "";
    if (!planId || !token || input.confirmed !== true) throw new Error("프로필 적용 계획, 확인 토큰, confirmed=true가 필요합니다.");
    const key = `${PROFILE_PLAN_PREFIX}${planId}`;
    const stored = await prisma.setting.findUnique({ where: { key } });
    if (!stored) throw new Error("프로필 변경 계획을 찾을 수 없습니다. 미리보기를 다시 생성하세요.");
    let plan: ProfilePlan;
    try { plan = JSON.parse(stored.value) as ProfilePlan; } catch { throw new Error("프로필 변경 계획이 손상되었습니다."); }
    if (plan.version !== 1 || plan.token !== token) throw new Error("프로필 변경 확인 토큰이 일치하지 않습니다.");
    if (Date.parse(plan.expiresAt) <= Date.now()) {
      await prisma.setting.delete({ where: { key } }).catch(() => undefined);
      throw new Error("프로필 변경 확인 시간이 만료되었습니다. 미리보기를 다시 생성하세요.");
    }
    const result = await applyNaverBlogProfile(plan.desired, plan.current);
    await prisma.setting.delete({ where: { key } }).catch(() => undefined);
    return {
      applied: true,
      before: { nickname: result.before.nickname, blogName: result.before.blogName, introduction: result.before.introduction },
      after: { nickname: result.after.nickname, blogName: result.after.blogName, introduction: result.after.introduction },
      beforeScreenshotPath: result.before.screenshotPath,
      afterScreenshotPath: result.after.screenshotPath,
    };
  }
  if (job.type === "POST_PUBLISH" || job.type === "POST_SCHEDULE") {
    const draftId = typeof input.draftId === "string" ? input.draftId : "";
    if (!draftId || input.confirmed !== true) throw new Error("발행 대상과 confirmed=true 확인이 필요합니다.");
    const schedule = job.type === "POST_SCHEDULE";
    const scheduledDate = typeof input.scheduledDate === "string" ? input.scheduledDate : "";
    if (schedule && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw new Error("scheduledDate는 YYYY-MM-DD 형식이어야 합니다.");
    await localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/draft`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    });
    return localApi(request, `/api/brandlinks/${encodeURIComponent(draftId)}/publish`, { method: "POST", body: JSON.stringify(schedule ? { publishMode: "schedule", scheduledDate } : { publishMode: "now" }) });
  }
  throw new Error(`지원하지 않는 원격 작업입니다: ${job.type}`);
}

async function completeRemoteJob(
  siteUrl: string,
  token: string,
  jobId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${siteUrl}/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `원격 작업 완료 기록 실패 (${response.status})`);
  }
}

export async function POST(request: NextRequest) {
  const untrusted = requireTrustedLocalMutation(request);
  if (untrusted) return untrusted;
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const remote = config();
  if (!remote.siteUrl || !remote.token) return NextResponse.json({ success: true, data: { configured: false, job: null } });
  if (process.env.DESKTOP_UPDATE_INSTALL_PENDING === '1') {
    return NextResponse.json({ success: true, data: { configured: true, job: null, updatePending: true } });
  }
  const auth = { authorization: `Bearer ${remote.token}`, "content-type": "application/json" };
  const appVersion = process.env.DESKTOP_APP_VERSION || process.env.npm_package_version || "1.0.0";
  const claimResponse = await fetch(`${remote.siteUrl}/api/agent/jobs/claim`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ appVersion }),
    cache: "no-store",
  }).catch(() => null);
  if (!claimResponse) return NextResponse.json({ success: false, error: "사이트 작업 채널에 연결할 수 없습니다." }, { status: 502 });
  const claimed = await claimResponse.json().catch(() => null);
  if (!claimResponse.ok) {
    if (claimResponse.status === 401 || claimResponse.status === 403) clearRemoteActivation();
    return NextResponse.json({ success: false, error: claimed?.error?.message || "PC 인증이 폐기되었습니다.", code: claimed?.error?.code }, { status: claimResponse.status });
  }
  const job = claimed?.data as Job | null;
  if (!job) return NextResponse.json({ success: true, data: { configured: true, job: null } });
  try {
    const result = await executeJob(request, job);
    await completeRemoteJob(remote.siteUrl, remote.token, job.id, { status: "SUCCEEDED", result });
    return NextResponse.json({ success: true, data: { configured: true, job: { id: job.id, status: "SUCCEEDED" } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "로컬 작업 실행 실패";
    await completeRemoteJob(remote.siteUrl, remote.token, job.id, { status: "FAILED", errorCode: "LOCAL_AUTOMATION_FAILED", errorMessage: message }).catch(() => undefined);
    return NextResponse.json({ success: false, error: message, data: { job: { id: job.id, status: "FAILED" } } }, { status: 500 });
  }
}

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { beginDesktopActivity } from "@/lib/desktop-activity";
import {
  getBrandPostPackageDir,
  getBrandPostImageGenerationState,
  normalizePackageImageAssets,
  packagePreview,
  readBrandPostPackage,
} from "@/lib/brand-post-package";
import {
  applyExternalGeneratedBrandPostImage,
  BROWSER_IMAGE_AUTOMATION_DISABLED_MESSAGE,
  type BrandPostImageGenerationRequest,
} from "@/lib/brand-post-image-generation";
import { isBrandPostImageRepairActive, planSectionImageRequests, repairBrandPostImages } from "@/lib/brand-post-image-repair";
import { isChatGptBrowserAutomationEnabled } from "@/lib/chatgpt-browser-automation";

const IMAGE_ACTIONS = ["generate_missing", "generate_section", "regenerate", "apply_generated"] as const;
type ImageAction = (typeof IMAGE_ACTIONS)[number];

function imageFailureCode(errors: string[]): string | undefined {
  const text = errors.join("\n");
  return ["CHATGPT_BROWSER_AUTH_REQUIRED", "CHATGPT_BROWSER_BUSY", "IMAGE_RESUME_REQUIRED", "IMAGE_PROVIDER_REFUSED", "PRODUCT_SOURCE_REQUIRED", "PRODUCT_SOURCE_DOWNLOAD_FAILED"]
    .find(code => text.includes(code));
}

function imageContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function isInsidePackage(brandLinkId: string, filePath: string): boolean {
  const packageDir = path.resolve(getBrandPostPackageDir(brandLinkId));
  const resolved = path.resolve(filePath);
  const relative = path.relative(packageDir, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const assetKey = request.nextUrl.searchParams.get("asset")?.trim() || "";
  if (!/^[a-f0-9]{64}$/u.test(assetKey)) {
    return NextResponse.json({ success: false, error: "이미지 항목 키가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const manifest = readBrandPostPackage(id, { migrate: false });
    if (!manifest) {
      return NextResponse.json({ success: false, error: "초안 패키지가 없습니다." }, { status: 404 });
    }
    const asset = normalizePackageImageAssets(manifest).find((candidate) => candidate.sha256 === assetKey);
    if (!asset || !isInsidePackage(id, asset.path) || !fs.existsSync(asset.path)) {
      return NextResponse.json({ success: false, error: "미리볼 이미지를 찾을 수 없습니다." }, { status: 404 });
    }
    const stat = fs.statSync(asset.path);
    if (!stat.isFile() || stat.size < 1 || stat.size > 24 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "이미지 파일 크기가 허용 범위를 벗어났습니다." }, { status: 422 });
    }
    const bytes = fs.readFileSync(asset.path);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": imageContentType(asset.path),
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "이미지 미리보기 실패" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) return unauthorized;
  const updateError = requireNoPendingDesktopUpdate();
  if (updateError) return updateError;
  const { id } = await params;
  if (isBrandPostImageRepairActive(id)) {
    return NextResponse.json(
      { success: false, error: "이 초안의 이미지 생성이 이미 진행 중입니다." },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => ({})) as {
    action?: ImageAction;
    sectionId?: string;
    assetKey?: string;
    replaceAssetKey?: string;
    generatedPath?: string;
    batchSize?: number;
  };
  if (!body.action || !IMAGE_ACTIONS.includes(body.action)) {
    return NextResponse.json({ success: false, error: "지원하지 않는 이미지 작업입니다." }, { status: 400 });
  }

  const link = await prisma.brandLink.findUnique({
    where: { id },
    select: { productName: true, imageUrls: true, status: true, updatedAt: true },
  });
  if (!link) {
    return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
  }
  const sourceImageUrls: string[] = (() => {
    try {
      const parsed = JSON.parse(link.imageUrls || "[]");
      return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string") : [];
    } catch { return []; }
  })();
  // Explicit mutation recovery only. Reclaim a stale DB claim solely when its
  // timestamp predates the proven-dead image owner; never steal a newer edit.
  if (link.status === "DRAFTING" && link.updatedAt) {
    const interrupted = readBrandPostPackage(id, { migrate: false });
    const state = interrupted && getBrandPostImageGenerationState(interrupted);
    const heartbeatAt = interrupted?.imageGeneration?.heartbeatAt;
    if (state?.recoveryState === "owner-exited" && heartbeatAt && link.updatedAt.getTime() < Date.parse(heartbeatAt)) {
      const recovery = await prisma.brandLink.updateMany({ where: { id, status: "DRAFTING", updatedAt: link.updatedAt }, data: { status: "READY" } });
      if (recovery.count === 1) link.status = "READY";
    }
  }
  if (!["READY", "FAILED"].includes(link.status)) {
    return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "작성·발행·예약 중인 소재의 이미지는 변경할 수 없습니다." }, { status: 409 });
  }
  const claim = await prisma.brandLink.updateMany({ where: { id, status: link.status }, data: { status: "DRAFTING" } });
  if (claim.count !== 1) return NextResponse.json({ success: false, code: "ALREADY_PUBLISHING", error: "상품 상태가 변경되었습니다." }, { status: 409 });
  try {
  const manifest = readBrandPostPackage(id, { migrate: false });
  if (!manifest || manifest.version !== "brand-post-package/v2") {
    return NextResponse.json({ success: false, error: "이미지를 편집할 v2 초안 패키지가 없습니다. 초안을 다시 만들어 주세요." }, { status: 404 });
  }

  const preview = packagePreview(manifest);
  if (body.action === "apply_generated") {
    // ChatGPT 대화(내장 이미지 생성)에서 받은 파일을 슬롯에 붙인다. PC 브라우저를 열지 않는다.
    const generatedPath = typeof body.generatedPath === "string" ? body.generatedPath.trim() : "";
    if (!generatedPath || !isInsidePackage(id, generatedPath) || !fs.existsSync(generatedPath)) {
      return NextResponse.json(
        { success: false, code: "INVALID_INPUT", error: "적용할 생성 이미지 파일이 초안 패키지 디렉터리 안에 있어야 합니다." },
        { status: 400 },
      );
    }
    const sectionId = typeof body.sectionId === "string" ? body.sectionId.trim() : "";
    const replaceAssetKey = typeof body.replaceAssetKey === "string" ? body.replaceAssetKey.trim() : "";
    if (replaceAssetKey && (!/^[a-f0-9]{64}$/u.test(replaceAssetKey) || !preview.imageAssets.some((asset) => asset.assetKey === replaceAssetKey))) {
      return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "교체할 이미지 항목을 찾을 수 없습니다." }, { status: 404 });
    }
    if (!replaceAssetKey) {
      const slot = preview.imageSlots.find((candidate) => candidate.sectionId === sectionId);
      if (!slot) {
        return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "이미지를 추가할 파트를 찾을 수 없습니다." }, { status: 404 });
      }
      if (slot.maximum === 0 || slot.count >= slot.maximum) {
        return NextResponse.json({
          success: false,
          code: "INVALID_INPUT",
          error: "이 파트는 최대 이미지 수에 도달했습니다. 교체하려면 replaceAssetKey 로 기존 이미지를 지정하세요.",
        }, { status: 422 });
      }
    }
    const finishApply = beginDesktopActivity("brand-post-image-apply");
    try {
      const applied = await applyExternalGeneratedBrandPostImage({
        brandLinkId: id,
        manifest,
        productName: link.productName || manifest.title,
        sourceImageUrls,
        sectionId: sectionId || undefined,
        replaceAssetKey: replaceAssetKey || undefined,
        rawPath: generatedPath,
      });
      const updatedPreview = packagePreview(applied.manifest);
      const remainingMissing = updatedPreview.imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
      return NextResponse.json({
        success: true,
        data: updatedPreview,
        generatedCount: applied.alreadyApplied ? 0 : 1,
        alreadyApplied: applied.alreadyApplied,
        assetKey: applied.assetKey,
        sectionId: applied.sectionId,
        provenance: applied.provenance,
        remainingMissing,
        errors: [],
        message: applied.alreadyApplied
          ? "같은 이미지가 이미 이 파트에 반영되어 있습니다."
          : `${applied.sectionId ? "본문 파트" : "이미지 항목"}에 생성 이미지를 반영했습니다.`,
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        code: imageFailureCode([error instanceof Error ? error.message : String(error)]) || "IMAGE_APPLY_FAILED",
        error: error instanceof Error ? error.message : "생성 이미지를 반영하지 못했습니다.",
      }, { status: 422 });
    } finally {
      finishApply();
    }
  }
  if (!isChatGptBrowserAutomationEnabled()) {
    // The browser batch is the only PC-side generator. Refuse before planning so no Chrome starts.
    return NextResponse.json({
      success: false,
      code: "CHATGPT_BROWSER_AUTOMATION_DISABLED",
      error: BROWSER_IMAGE_AUTOMATION_DISABLED_MESSAGE,
      data: preview,
      remainingMissing: preview.imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0),
    }, { status: 409 });
  }
  const generationRequests: BrandPostImageGenerationRequest[] = [];
  if (body.action === "generate_missing") {
    generationRequests.push(...planSectionImageRequests(preview.imageSlots));
  } else if (body.action === "generate_section") {
    const sectionId = body.sectionId?.trim() || "";
    const slot = preview.imageSlots.find((candidate) => candidate.sectionId === sectionId);
    if (!slot) {
      return NextResponse.json({ success: false, error: "이미지를 추가할 파트를 찾을 수 없습니다." }, { status: 404 });
    }
    const replaceableOriginal = slot.assets.find((asset) => asset?.provenance === "ORIGINAL");
    if (slot.maximum === 0 || (slot.count >= slot.maximum && !replaceableOriginal)) {
      return NextResponse.json({ success: false, error: "이 파트는 최대 이미지 수에 도달했습니다." }, { status: 422 });
    }
    generationRequests.push({
      requestId: randomUUID(),
      sectionId,
      replaceAssetKey: slot.count >= slot.maximum ? replaceableOriginal?.assetKey : undefined,
    });
  } else {
    const assetKey = body.assetKey?.trim() || "";
    if (!/^[a-f0-9]{64}$/u.test(assetKey) || !preview.imageAssets.some((asset) => asset.assetKey === assetKey)) {
      return NextResponse.json({ success: false, error: "다시 만들 이미지 항목을 찾을 수 없습니다." }, { status: 404 });
    }
    generationRequests.push({ requestId: randomUUID(), replaceAssetKey: assetKey });
  }

  if (generationRequests.length === 0) {
    return NextResponse.json({
      success: true,
      data: preview,
      generatedCount: 0,
      remainingMissing: preview.imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0),
      errors: [],
      message: "이미지가 필요한 모든 파트에 생성 이미지가 연결되어 있습니다.",
    });
  }

  const finishActivity = beginDesktopActivity("brand-post-image-generation");
  try {
    const repaired = await repairBrandPostImages({
      brandLinkId: id,
      productName: link.productName || manifest.title,
      sourceImageUrls,
      requests: generationRequests,
    });
    const { errors, generatedCount, manifest: updated } = repaired;
    const updatedPreview = packagePreview(updated);
    const remainingMissing = updatedPreview.imageSlots.reduce((sum, slot) => sum + Math.max(slot.missing, slot.generationMissing), 0);
    return NextResponse.json({
      success: generatedCount > 0 || errors.length === 0,
      code: imageFailureCode(errors),
      data: updatedPreview,
      generatedCount,
      remainingMissing,
      errors,
      message: generatedCount > 0
        ? `${generatedCount}장의 이미지를 반영했습니다.`
        : "새로 반영된 이미지가 없습니다.",
    }, { status: generatedCount === 0 && errors.length > 0 ? 422 : 200 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: imageFailureCode([error instanceof Error ? error.message : String(error)]),
      error: error instanceof Error ? error.message : "이미지 생성에 실패했습니다.",
    }, { status: 500 });
  } finally {
    finishActivity();
  }
  } finally {
    await prisma.brandLink.updateMany({ where: { id, status: "DRAFTING" }, data: { status: link.status } });
  }
}

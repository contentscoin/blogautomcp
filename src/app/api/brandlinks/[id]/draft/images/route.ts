import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { requireNoPendingDesktopUpdate } from "@/lib/update-guard";
import { beginDesktopActivity } from "@/lib/desktop-activity";
import {
  applyGeneratedBrandPostImage,
  getBrandPostPackageDir,
  normalizePackageImageAssets,
  packagePreview,
  readBrandPostPackage,
} from "@/lib/brand-post-package";
import {
  generateBrandPostImages,
  type BrandPostImageGenerationRequest,
} from "@/lib/brand-post-image-generation";

const activeImageJobs = new Set<string>();

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
    const manifest = readBrandPostPackage(id);
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
  if (activeImageJobs.has(id)) {
    return NextResponse.json(
      { success: false, error: "이 초안의 이미지 생성이 이미 진행 중입니다." },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => ({})) as {
    action?: "generate_missing" | "generate_section" | "regenerate";
    sectionId?: string;
    assetKey?: string;
    batchSize?: number;
  };
  if (!body.action || !["generate_missing", "generate_section", "regenerate"].includes(body.action)) {
    return NextResponse.json({ success: false, error: "지원하지 않는 이미지 작업입니다." }, { status: 400 });
  }

  const manifest = readBrandPostPackage(id);
  if (!manifest || manifest.version !== "brand-post-package/v2") {
    return NextResponse.json(
      { success: false, error: "이미지를 편집할 v2 초안 패키지가 없습니다. 초안을 다시 만들어 주세요." },
      { status: 404 },
    );
  }
  const link = await prisma.brandLink.findUnique({
    where: { id },
    select: { productName: true },
  });
  if (!link) {
    return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
  }

  const preview = packagePreview(manifest);
  const batchSize = Math.max(1, Math.min(4, Number(body.batchSize) || 4));
  const generationRequests: BrandPostImageGenerationRequest[] = [];
  if (body.action === "generate_missing") {
    for (const slot of preview.imageSlots) {
      for (let index = 0; index < slot.generationMissing && generationRequests.length < batchSize; index += 1) {
        const replaceableOriginal = slot.assets.find((asset) => asset?.provenance === "ORIGINAL");
        if (slot.count >= slot.maximum && !replaceableOriginal) continue;
        generationRequests.push({
          requestId: randomUUID(),
          sectionId: slot.sectionId,
          replaceAssetKey: slot.count >= slot.maximum ? replaceableOriginal?.assetKey : undefined,
        });
      }
      if (generationRequests.length >= batchSize) break;
    }
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
      remainingMissing: preview.imageSlots.reduce((sum, slot) => sum + slot.generationMissing, 0),
      errors: [],
      message: "이미지가 필요한 모든 파트에 생성 이미지가 연결되어 있습니다.",
    });
  }

  activeImageJobs.add(id);
  const finishActivity = beginDesktopActivity("brand-post-image-generation");
  try {
    const results = await generateBrandPostImages({
      manifest,
      productName: link.productName || manifest.title,
      requests: generationRequests,
    });
    const errors: string[] = [];
    let generatedCount = 0;
    for (const result of results) {
      if (!result.generatedPath) {
        errors.push(result.error || "이미지 생성 결과가 비어 있습니다.");
        continue;
      }
      try {
        applyGeneratedBrandPostImage({
          brandLinkId: id,
          generatedPath: result.generatedPath,
          sectionId: result.sectionId,
          replaceAssetKey: result.replaceAssetKey,
          provenance: result.provenance,
          imageIntent: result.imageIntent,
        });
        generatedCount += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "생성 이미지를 초안에 반영하지 못했습니다.");
      }
    }
    const updated = readBrandPostPackage(id);
    if (!updated) throw new Error("이미지 작업 후 초안 패키지를 읽지 못했습니다.");
    const updatedPreview = packagePreview(updated);
    const remainingMissing = updatedPreview.imageSlots.reduce((sum, slot) => sum + slot.generationMissing, 0);
    return NextResponse.json({
      success: generatedCount > 0 || errors.length === 0,
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
      error: error instanceof Error ? error.message : "이미지 생성에 실패했습니다.",
    }, { status: 500 });
  } finally {
    finishActivity();
    activeImageJobs.delete(id);
  }
}

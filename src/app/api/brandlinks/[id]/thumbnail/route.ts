import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiKey } from "@/lib/api-auth";
import { buildProductThumbnailCopy } from "../../../../../../scripts/lib/product-thumbnail";
import { buildTravelThumbnailCopy } from "../../../../../../scripts/lib/travel-content";
import { getProductThumbnailStorageDir } from "../../../../../../scripts/lib/app-paths";
import { normalizeCandidateImageUrl } from "../../../../../../scripts/lib/product-image-selection";
import { createLockedProductThumbnail, createOriginalProductPhotoThumbnail } from "../../../../../../scripts/lib/product-image-lock";
import { createTravelEditorialThumbnail } from "../../../../../../scripts/lib/travel-thumbnail";
import {
  generateThumbnail,
  isGenerativeThumbnailAvailable,
  listThumbnailMoods,
  maxThumbnailAttempts,
  qcMinScore,
  type ThumbnailQcReport,
} from "../../../../../../scripts/lib/thumbnail-gen";
import {
  normalizeProductThumbnailCopy,
  parseProductThumbnailSettings,
  productThumbnailSettingKey,
} from "../../../../../../scripts/lib/product-thumbnail-settings";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "썸네일 생성 중 오류가 발생했습니다.";
}

function parseImageUrls(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(
      parsed
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map(normalizeCandidateImageUrl)
        .filter(Boolean),
    )).slice(0, 12);
  } catch {
    return [];
  }
}

function isAllowedProductImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "pstatic.net" || host.endsWith(".pstatic.net") || host.endsWith(".naver.net");
  } catch {
    return false;
  }
}

async function downloadProductImage(rawUrl: string, destination: string): Promise<void> {
  if (!isAllowedProductImageUrl(rawUrl)) throw new Error("허용되지 않은 제품 이미지 주소입니다.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let response = await fetch(rawUrl, { signal: controller.signal, cache: "no-store" });
    if (response.status === 404 && /\?type=/i.test(rawUrl)) {
      response = await fetch(rawUrl.replace(/\?type=.*/i, ""), { signal: controller.signal, cache: "no-store" });
    }
    if (!response.ok) throw new Error(`제품 이미지 다운로드 실패 (${response.status})`);
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_SOURCE_BYTES) throw new Error("제품 이미지가 너무 큽니다.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_SOURCE_BYTES) throw new Error("제품 이미지 크기를 확인할 수 없습니다.");
    await fs.promises.writeFile(destination, bytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function previewDataUrlFor(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) return null;
  const bytes = await fs.promises.readFile(filePath);
  const mime = path.extname(filePath).toLowerCase() === ".png" ? "png" : "jpeg";
  return `data:image/${mime};base64,${bytes.toString("base64")}`;
}

async function getPayload(id: string) {
  const link = await prisma.brandLink.findUnique({ where: { id } });
  if (!link) return null;
  const imageUrls = parseImageUrls(link.imageUrls);
  const setting = await prisma.setting.findUnique({ where: { key: productThumbnailSettingKey(id) } });
  const saved = parseProductThumbnailSettings(setting?.value);
  const isTravel = link.connectKind === "TRAVEL";
  const connectKind = isTravel ? ("TRAVEL" as const) : ("SHOPPING" as const);
  const suggestedCopy = isTravel
    ? buildTravelThumbnailCopy(link.productName || "여행 상품")
    : buildProductThumbnailCopy(
        `${link.productName || "상품"} 구매 전 확인`,
        link.productName || "추천 상품",
      );
  return {
    id: link.id,
    productName: link.productName || "추천 상품",
    connectKind,
    imageUrls,
    suggestedCopy,
    saved,
    previewDataUrl: await previewDataUrlFor(saved?.generatedPath),
    engine: isGenerativeThumbnailAvailable() ? ("gpt-image" as const) : ("local" as const),
    moods: listThumbnailMoods(connectKind),
    qcMinScore: qcMinScore(),
    maxAttempts: maxThumbnailAttempts(),
    description: link.productName || "",
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const payload = await getPayload(id);
  if (!payload) return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ success: true, data: payload });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const payload = await getPayload(id);
    if (!payload) return NextResponse.json({ success: false, error: "상품을 찾을 수 없습니다." }, { status: 404 });
    if (payload.imageUrls.length === 0) {
      return NextResponse.json({ success: false, error: "실제 제품 사진이 없습니다. 상품 정보를 먼저 동기화하세요." }, { status: 422 });
    }

    const body = await request.json() as {
      sourceImageUrl?: unknown;
      copy?: Record<string, unknown>;
      save?: unknown;
      mood?: unknown;
      style?: unknown;
      engine?: unknown;
    };
    const sourceImageUrl = typeof body.sourceImageUrl === "string" ? body.sourceImageUrl.trim() : "";
    if (!payload.imageUrls.includes(sourceImageUrl)) {
      return NextResponse.json({ success: false, error: "이 상품에서 수집된 제품 사진을 선택하세요." }, { status: 422 });
    }
    const copy = normalizeProductThumbnailCopy(body.copy || {}, payload.productName);
    const requestedMood = typeof body.mood === "string" ? body.mood : typeof body.style === "string" ? body.style : "";
    const mood = payload.moods.some((item) => item.id === requestedMood) ? requestedMood : payload.moods[0].id;
    const wantLocal = body.engine === "local";
    const storageDir = getProductThumbnailStorageDir();
    await fs.promises.mkdir(storageDir, { recursive: true });
    const runId = randomUUID();
    const sourcePath = path.join(storageDir, `${id}-${runId}.source`);
    await downloadProductImage(sourceImageUrl, sourcePath);

    let outputPath: string | null = null;
    let engine: "gpt-image" | "local" = "local";
    let qc: ThumbnailQcReport | null = null;
    let attempts = 0;
    const logs: string[] = [];
    try {
      if (!wantLocal && isGenerativeThumbnailAvailable()) {
        const generated = await generateThumbnail({
          kind: payload.connectKind,
          productName: payload.productName,
          description: payload.description,
          copy,
          moodId: mood,
          referenceImagePath: sourcePath,
          outputDir: storageDir,
          onLog: (line) => logs.push(line),
        });
        if (generated) {
          outputPath = generated.path;
          engine = "gpt-image";
          qc = generated.qc;
          attempts = generated.attempts;
        } else {
          logs.push("gpt-image 결과가 QC 를 통과하지 못해 로컬 합성으로 강등합니다.");
        }
      }
      if (!outputPath) {
        if (payload.connectKind === "SHOPPING") {
          const result = await createLockedProductThumbnail({ sourcePath, outputDir: storageDir, productName: payload.productName, headline: copy.headline, subline: copy.subline, style: "shopping-clean" })
            .catch(() => createOriginalProductPhotoThumbnail({ sourcePath, outputDir: storageDir, productName: payload.productName, headline: copy.headline, subline: copy.subline, style: "shopping-clean" }));
          outputPath = result.outputPath;
        } else {
          const result = await createTravelEditorialThumbnail({ sourcePath, outputDir: storageDir, destination: payload.productName, headline: copy.headline, subline: copy.subline, badge: copy.badge, style: "travel-editorial" });
          outputPath = result.outputPath;
        }
        engine = "local";
      }
    } finally {
      await fs.promises.unlink(sourcePath).catch(() => undefined);
    }
    if (!outputPath || !fs.existsSync(outputPath)) throw new Error("완성 썸네일 파일을 만들지 못했습니다.");

    const updatedAt = new Date().toISOString();
    if (body.save === true) {
      const value = JSON.stringify({ version: 1, sourceImageUrl, generatedPath: outputPath, copy, style: mood, updatedAt });
      await prisma.setting.upsert({
        where: { key: productThumbnailSettingKey(id) },
        update: { value },
        create: { key: productThumbnailSettingKey(id), value },
      });
    }
    return NextResponse.json({
      success: true,
      data: {
        saved: body.save === true,
        sourceImageUrl,
        copy,
        mood,
        engine,
        qc,
        attempts,
        logs,
        outputPath,
        previewDataUrl: await previewDataUrlFor(outputPath),
        updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

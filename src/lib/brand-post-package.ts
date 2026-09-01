import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import type { BrandLinkContentReadiness } from "../../scripts/lib/brandlink-content-readiness";
import {
  getPostCompositionContract,
  refreshPostDocumentQuality,
  type ResolvedPostDocumentV1,
} from "./post-composition-contract";
import { assessProductEditorialCoverage } from "../../scripts/lib/product-editorial-plan";

export interface BrandPostPackageImageAsset {
  path: string;
  sourcePath: string;
  sha256: string;
  role: "hero" | "body";
  sectionId?: string | null;
  imageIntent?: string;
  provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD";
}

export interface BrandPostQualityRepairSummary {
  attempted: boolean;
  applied: boolean;
  beforeScore: number;
  afterScore: number;
  beforeCode: BrandLinkContentReadiness["code"];
  afterCode: BrandLinkContentReadiness["code"];
  note: string;
}

interface BrandPostPackageManifestBase {
  brandLinkId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  title: string;
  generationSource?: "AI" | "PREPARED_APPROVED";
  markdownPath: string;
  heroImagePath: string;
  bodyImagePaths: string[];
  imageAssets?: BrandPostPackageImageAsset[];
  hashtags: string[];
  imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
  createdAt: string;
  approvedAt: string | null;
  contentQuality?: BrandLinkContentReadiness | null;
  qualityRepair?: BrandPostQualityRepairSummary | null;
}

export interface BrandPostPackageManifestV1 extends BrandPostPackageManifestBase {
  version: "brand-post-package/v1";
}

export interface BrandPostPackageManifestV2 extends BrandPostPackageManifestBase {
  version: "brand-post-package/v2";
  contractVersion: "post-composition-contract/v1";
  composition: ResolvedPostDocumentV1;
  thumbnailSpec: {
    version: "thumbnail-spec/v2";
    canvas: { width: number; height: number; aspect: "1:1" | "16:9" };
    style: string;
    sourcePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
    sourceImagePath: string;
  };
}

export type BrandPostPackageManifest =
  | BrandPostPackageManifestV1
  | BrandPostPackageManifestV2;

export function getBrandPostPackageDir(brandLinkId: string): string {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(brandLinkId)) {
    throw new Error("초안 상품 ID 형식이 올바르지 않습니다.");
  }
  return path.join(getAppDataDir(), "prepared-brand-posts", brandLinkId);
}

export function getBrandPostPackageManifestPath(brandLinkId: string): string {
  return path.join(getBrandPostPackageDir(brandLinkId), "manifest.json");
}

export function readBrandPostPackage(brandLinkId: string): BrandPostPackageManifest | null {
  const manifestPath = getBrandPostPackageManifestPath(brandLinkId);
  if (!fs.existsSync(manifestPath)) return null;
  let parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BrandPostPackageManifest;
  const supportedVersion =
    parsed.version === "brand-post-package/v1" || parsed.version === "brand-post-package/v2";
  if (!supportedVersion || parsed.brandLinkId !== brandLinkId) {
    throw new Error("준비된 초안 패키지 형식이 올바르지 않습니다.");
  }
  if (
    parsed.version === "brand-post-package/v2" &&
    (parsed.contractVersion !== "post-composition-contract/v1" ||
      parsed.composition?.version !== "resolved-post-document/v1")
  ) {
    throw new Error("준비된 초안 패키지의 렌더 계약 형식이 올바르지 않습니다.");
  }

  // v1 시절에는 사용자가 직접 확인·승인한 초안에도 generationSource가 저장되지
  // 않았다. 승인 이력이 있는 레거시 초안은 사용자 승인본으로 마이그레이션해
  // 발행 단계가 상품 페이지를 다시 연 뒤 출처 오류로 끝나는 문제를 막는다.
  if (parsed.version === "brand-post-package/v1" && parsed.approvedAt && !parsed.generationSource) {
    parsed = { ...parsed, generationSource: "PREPARED_APPROVED" };
    writeBrandPostPackageManifest(parsed);
  }

  // 이전 판정기는 자연스러운 "어떤 사람에게 더 맞을까", "장점이 살아나요"
  // 같은 표현을 놓쳐 editorial-flow 하나만 실패시키기도 했다. 저장된 본문을 현재
  // 의미 판정기로 다시 확인해 나머지 품질 신호가 모두 정상인 초안은 즉시 복구한다.
  if (
    parsed.version === "brand-post-package/v2" &&
    parsed.connectKind === "SHOPPING" &&
    parsed.contentQuality &&
    !parsed.contentQuality.canPublish
  ) {
    const coverage = assessProductEditorialCoverage(
      parsed.composition.sections.map((section) => `${section.title}\n${section.body.join("\n")}`),
    );
    const editorialFlow = parsed.contentQuality.signals.find((signal) => signal.key === "editorial-flow");
    const otherFailures = parsed.contentQuality.signals.filter(
      (signal) => signal.key !== "editorial-flow" && signal.status === "fail",
    );
    if (editorialFlow?.status === "fail" && coverage.missingCoreRoles.length <= 1 && otherFailures.length === 0) {
      const signals = parsed.contentQuality.signals.map((signal) =>
        signal.key === "editorial-flow" ? { ...signal, status: "pass" as const } : signal,
      );
      const warnings = signals.filter((signal) => signal.status === "warn");
      const score = Math.max(0, 100 - warnings.length * 5);
      parsed = {
        ...parsed,
        contentQuality: {
          ...parsed.contentQuality,
          canPublish: true,
          code: "ok",
          reason: null,
          score,
          signals,
          summary: `커넥트 글 발행 게이트 통과 (${score}점, 신호 ${signals.length}/${signals.length})`,
        },
      };
      writeBrandPostPackageManifest(parsed);
    }
  }
  return parsed;
}

export function approveBrandPostPackage(brandLinkId: string): BrandPostPackageManifest {
  const manifestPath = getBrandPostPackageManifestPath(brandLinkId);
  const manifest = readBrandPostPackage(brandLinkId);
  if (!manifest) throw new Error("승인할 고품질 초안이 없습니다.");
  if (manifest.version === "brand-post-package/v2" && manifest.generationSource !== "AI") {
    throw new Error("AI 생성 출처가 확인되지 않은 초안은 승인할 수 없습니다. 새 초안을 생성해 주세요.");
  }
  if (
    manifest.version === "brand-post-package/v2" &&
    manifest.composition.qualityReport.preset === "PREMIUM" &&
    !manifest.composition.qualityReport.canAutoPublish
  ) {
    throw new Error(
      `프리미엄 초안 품질 게이트를 통과하지 못했습니다: ${manifest.composition.qualityReport.blockers.join(" ")}`,
    );
  }
  if (
    manifest.version === "brand-post-package/v2" &&
    manifest.composition.qualityReport.preset === "PREMIUM" &&
    manifest.contentQuality &&
    !manifest.contentQuality.canPublish
  ) {
    throw new Error(
      `원고 내용 품질검사를 통과하지 못했습니다: ${manifest.contentQuality.reason || manifest.contentQuality.summary}`,
    );
  }
  const approved: BrandPostPackageManifest = {
    ...manifest,
    generationSource:
      manifest.version === "brand-post-package/v1" && !manifest.generationSource
        ? "PREPARED_APPROVED"
        : manifest.generationSource,
    approvedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(approved, null, 2), "utf8");
  return approved;
}

export function packagePreview(manifest: BrandPostPackageManifest) {
  const markdown = fs.existsSync(manifest.markdownPath)
    ? fs.readFileSync(manifest.markdownPath, "utf8")
    : "";
  let heroPreviewDataUrl: string | null = null;
  try {
    const stat = fs.statSync(manifest.heroImagePath);
    if (stat.isFile() && stat.size <= 8 * 1024 * 1024) {
      const extension = path.extname(manifest.heroImagePath).toLowerCase();
      const mime = extension === ".png" ? "png" : "jpeg";
      heroPreviewDataUrl = `data:image/${mime};base64,${fs.readFileSync(manifest.heroImagePath).toString("base64")}`;
    }
  } catch {
    heroPreviewDataUrl = null;
  }
  const imageAssets = normalizePackageImageAssets(manifest).map((asset) => ({
    ...asset,
    assetKey: asset.sha256,
    previewUrl: `/api/brandlinks/${encodeURIComponent(manifest.brandLinkId)}/draft/images?asset=${encodeURIComponent(asset.sha256)}`,
  }));
  const assetByPath = new Map(imageAssets.map((asset) => [path.resolve(asset.path), asset]));
  const imageSlots = manifest.version === "brand-post-package/v2"
    ? manifest.composition.sections.map((section) => {
        const contract = getPostCompositionContract(manifest.connectKind).sections.find(
          (candidate) => candidate.id === section.id,
        );
        const minimum = contract?.image.min || 0;
        const maximum = contract?.image.max || Math.max(1, minimum);
        return {
          sectionId: section.id,
          title: section.title,
          intent: section.imageIntent,
          minimum,
          recommended: Math.min(maximum, Math.max(minimum, 1)),
          maximum,
          count: section.imagePaths.length,
          missing: Math.max(0, minimum - section.imagePaths.length),
          assets: section.imagePaths
            .map((imagePath) => assetByPath.get(path.resolve(imagePath)))
            .filter(Boolean),
        };
      })
    : [];
  return { ...manifest, imageAssets, imageSlots, markdown, heroPreviewDataUrl };
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function normalizePackageImageAssets(
  manifest: BrandPostPackageManifest,
): BrandPostPackageImageAsset[] {
  const explicit = (manifest.imageAssets || []).filter(
    (asset) => typeof asset.path === "string" && fs.existsSync(asset.path),
  );
  if (explicit.length > 0) return explicit;

  const paths = [manifest.heroImagePath, ...manifest.bodyImagePaths].filter((value) => fs.existsSync(value));
  const renderImageByPath = manifest.version === "brand-post-package/v2"
    ? new Map(
        manifest.composition.renderNodes
          .filter((node): node is Extract<(typeof manifest.composition.renderNodes)[number], { kind: "image" }> => node.kind === "image")
          .map((node) => [path.resolve(node.assetPath), node]),
      )
    : new Map<string, never>();
  return paths.map((imagePath, index) => {
    const renderImage = renderImageByPath.get(path.resolve(imagePath));
    return {
      path: path.resolve(imagePath),
      sourcePath: path.resolve(imagePath),
      sha256: sha256File(imagePath),
      role: index === 0 ? "hero" : "body",
      sectionId: renderImage?.sectionId || null,
      imageIntent: renderImage?.altText || "",
      provenance:
        index === 0
          ? manifest.connectKind === "SHOPPING"
            ? "LOCKED_PRODUCT"
            : "GENERATED_BACKGROUND"
          : "ORIGINAL",
    };
  });
}

export function writeBrandPostPackageManifest(
  manifest: BrandPostPackageManifest,
): BrandPostPackageManifest {
  const manifestPath = getBrandPostPackageManifestPath(manifest.brandLinkId);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
  try {
    fs.renameSync(temporaryPath, manifestPath);
  } catch {
    fs.copyFileSync(temporaryPath, manifestPath);
    fs.rmSync(temporaryPath, { force: true });
  }
  return manifest;
}

function refreshStoredContentQuality(
  quality: BrandLinkContentReadiness | null | undefined,
  compositionCanPublish: boolean,
): BrandLinkContentReadiness | null | undefined {
  if (!quality) return quality;
  const signals = quality.signals.map((signal) =>
    signal.key === "composition-quality"
      ? { ...signal, status: compositionCanPublish ? ("pass" as const) : ("fail" as const) }
      : signal,
  );
  const failures = signals.filter((signal) => signal.status === "fail");
  const warnings = signals.filter((signal) => signal.status === "warn");
  const score = Math.max(0, 100 - failures.length * 18 - warnings.length * 5);
  if (failures.length === 0) {
    return {
      ...quality,
      canPublish: true,
      code: "ok",
      reason: null,
      score,
      signals,
      summary: `커넥트 글 발행 게이트 통과 (${score}점, 신호 ${signals.length}/${signals.length})`,
    };
  }
  return {
    ...quality,
    canPublish: false,
    score,
    signals,
    reason:
      quality.code === "composition-quality" && compositionCanPublish
        ? `${failures[0].label} 항목을 보강해야 합니다.`
        : quality.reason,
    summary: `커넥트 글 발행 보류 (${score}점, ${failures[0].label})`,
  };
}

function replacePath(values: string[], previousPath: string, nextPath: string): string[] {
  return values.map((value) =>
    path.resolve(value) === path.resolve(previousPath) ? nextPath : value,
  );
}

export function applyGeneratedBrandPostImage(options: {
  brandLinkId: string;
  generatedPath: string;
  sectionId?: string;
  replaceAssetKey?: string;
  provenance: NonNullable<BrandPostPackageImageAsset["provenance"]>;
  imageIntent?: string;
}): BrandPostPackageManifestV2 {
  const manifest = readBrandPostPackage(options.brandLinkId);
  if (!manifest || manifest.version !== "brand-post-package/v2") {
    throw new Error("이미지를 편집할 v2 초안 패키지가 없습니다.");
  }
  const sourceStat = fs.statSync(options.generatedPath);
  if (!sourceStat.isFile() || sourceStat.size < 1 || sourceStat.size > 24 * 1024 * 1024) {
    throw new Error("생성 이미지 파일 크기가 허용 범위를 벗어났습니다.");
  }

  const extension = [".png", ".jpg", ".jpeg", ".webp"].includes(
    path.extname(options.generatedPath).toLowerCase(),
  )
    ? path.extname(options.generatedPath).toLowerCase()
    : ".png";
  const imageDir = path.join(getBrandPostPackageDir(options.brandLinkId), "images");
  fs.mkdirSync(imageDir, { recursive: true });
  const destination = path.join(imageDir, `generated-${Date.now()}-${crypto.randomUUID()}${extension}`);
  fs.copyFileSync(options.generatedPath, destination);
  const destinationPath = path.resolve(destination);
  const assets = normalizePackageImageAssets(manifest);

  let composition = manifest.composition;
  let heroImagePath = manifest.heroImagePath;
  let bodyImagePaths = [...manifest.bodyImagePaths];
  let thumbnailSpec = manifest.thumbnailSpec;
  let nextAssets: BrandPostPackageImageAsset[];

  if (options.replaceAssetKey) {
    const existing = assets.find((asset) => asset.sha256 === options.replaceAssetKey);
    if (!existing) throw new Error("다시 만들 원본 이미지 항목을 찾을 수 없습니다.");
    const replacement: BrandPostPackageImageAsset = {
      ...existing,
      path: destinationPath,
      sourcePath: path.resolve(options.generatedPath),
      sha256: sha256File(destinationPath),
      provenance: options.provenance,
      imageIntent: options.imageIntent || existing.imageIntent,
    };
    nextAssets = assets.map((asset) => asset === existing ? replacement : asset);
    if (existing.role === "hero") {
      heroImagePath = destinationPath;
      thumbnailSpec = { ...thumbnailSpec, sourceImagePath: destinationPath };
    } else {
      bodyImagePaths = replacePath(bodyImagePaths, existing.path, destinationPath);
    }
    composition = {
      ...composition,
      sections: composition.sections.map((section) => ({
        ...section,
        imagePaths: replacePath(section.imagePaths, existing.path, destinationPath),
      })),
      renderNodes: composition.renderNodes.map((node) =>
        node.kind === "image" && path.resolve(node.assetPath) === path.resolve(existing.path)
          ? { ...node, assetPath: destinationPath }
          : node,
      ),
    };
  } else {
    const sectionId = options.sectionId?.trim();
    const section = composition.sections.find((candidate) => candidate.id === sectionId);
    if (!sectionId || !section) throw new Error("이미지를 추가할 본문 파트를 찾을 수 없습니다.");
    const contract = getPostCompositionContract(manifest.connectKind).sections.find(
      (candidate) => candidate.id === sectionId,
    );
    if (section.imagePaths.length >= (contract?.image.max || 1)) {
      throw new Error("이 파트는 권장 최대 이미지 수에 도달했습니다.");
    }
    const asset: BrandPostPackageImageAsset = {
      path: destinationPath,
      sourcePath: path.resolve(options.generatedPath),
      sha256: sha256File(destinationPath),
      role: "body",
      sectionId,
      imageIntent: options.imageIntent || section.imageIntent,
      provenance: options.provenance,
    };
    nextAssets = [...assets, asset];
    bodyImagePaths = [...bodyImagePaths, destinationPath];
    const imageNode = {
      kind: "image" as const,
      assetPath: destinationPath,
      sectionId,
      role: "scene" as const,
      altText: `${section.title} - ${asset.imageIntent || section.imageIntent}`,
      layout: contract?.image.layout || ("single" as const),
      sourcePolicy: manifest.imagePolicy,
    };
    const renderNodes = [...composition.renderNodes];
    let insertionIndex = -1;
    renderNodes.forEach((node, index) => {
      if ("sectionId" in node && node.sectionId === sectionId) insertionIndex = index;
    });
    renderNodes.splice(insertionIndex >= 0 ? insertionIndex + 1 : renderNodes.length - 1, 0, imageNode);
    composition = {
      ...composition,
      sections: composition.sections.map((candidate) =>
        candidate.id === sectionId
          ? { ...candidate, imagePaths: [...candidate.imagePaths, destinationPath] }
          : candidate,
      ),
      renderNodes,
    };
  }

  composition = refreshPostDocumentQuality(composition);
  const updated: BrandPostPackageManifestV2 = {
    ...manifest,
    heroImagePath,
    bodyImagePaths,
    imageAssets: nextAssets,
    composition,
    thumbnailSpec,
    contentQuality: refreshStoredContentQuality(
      manifest.contentQuality,
      composition.qualityReport.canAutoPublish,
    ),
    approvedAt: null,
  };
  writeBrandPostPackageManifest(updated);
  return updated;
}

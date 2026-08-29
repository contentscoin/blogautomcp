import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import type { ResolvedPostDocumentV1 } from "./post-composition-contract";

export interface BrandPostPackageImageAsset {
  path: string;
  sourcePath: string;
  sha256: string;
  role: "hero" | "body";
  sectionId?: string | null;
  imageIntent?: string;
  provenance?: "ORIGINAL" | "LOCKED_PRODUCT" | "GENERATED_BACKGROUND" | "EDITORIAL_CARD";
}

interface BrandPostPackageManifestBase {
  brandLinkId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  title: string;
  markdownPath: string;
  heroImagePath: string;
  bodyImagePaths: string[];
  imageAssets?: BrandPostPackageImageAsset[];
  hashtags: string[];
  imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
  createdAt: string;
  approvedAt: string | null;
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
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BrandPostPackageManifest;
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
  return parsed;
}

export function approveBrandPostPackage(brandLinkId: string): BrandPostPackageManifest {
  const manifestPath = getBrandPostPackageManifestPath(brandLinkId);
  const manifest = readBrandPostPackage(brandLinkId);
  if (!manifest) throw new Error("승인할 고품질 초안이 없습니다.");
  if (
    manifest.version === "brand-post-package/v2" &&
    manifest.composition.qualityReport.preset === "PREMIUM" &&
    !manifest.composition.qualityReport.canAutoPublish
  ) {
    throw new Error(
      `프리미엄 초안 품질 게이트를 통과하지 못했습니다: ${manifest.composition.qualityReport.blockers.join(" ")}`,
    );
  }
  const approved = { ...manifest, approvedAt: new Date().toISOString() };
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
  return { ...manifest, markdown, heroPreviewDataUrl };
}

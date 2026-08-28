import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";

export interface BrandPostPackageManifest {
  version: "brand-post-package/v1";
  brandLinkId: string;
  connectKind: "SHOPPING" | "TRAVEL";
  title: string;
  markdownPath: string;
  heroImagePath: string;
  bodyImagePaths: string[];
  imageAssets?: Array<{ path: string; sourcePath: string; sha256: string; role: "hero" | "body" }>;
  hashtags: string[];
  imagePolicy: "LOCKED_PRODUCT_OR_ORIGINAL" | "TRAVEL_EDITORIAL";
  createdAt: string;
  approvedAt: string | null;
}

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
  if (parsed.version !== "brand-post-package/v1" || parsed.brandLinkId !== brandLinkId) {
    throw new Error("준비된 초안 패키지 형식이 올바르지 않습니다.");
  }
  return parsed;
}

export function approveBrandPostPackage(brandLinkId: string): BrandPostPackageManifest {
  const manifestPath = getBrandPostPackageManifestPath(brandLinkId);
  const manifest = readBrandPostPackage(brandLinkId);
  if (!manifest) throw new Error("승인할 고품질 초안이 없습니다.");
  const approved = { ...manifest, approvedAt: new Date().toISOString() };
  fs.writeFileSync(manifestPath, JSON.stringify(approved, null, 2), "utf8");
  return approved;
}

export function packagePreview(manifest: BrandPostPackageManifest) {
  const markdown = fs.existsSync(manifest.markdownPath)
    ? fs.readFileSync(manifest.markdownPath, "utf8")
    : "";
  return { ...manifest, markdown };
}

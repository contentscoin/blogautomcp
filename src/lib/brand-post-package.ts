import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";

export interface BrandPostPackageReadiness {
  status: "READY" | "NEEDS_REVIEW" | "BLOCKED";
  score: number;
  summary: string;
  signals: Array<{ key: string; label: string; status: "pass" | "warn" | "fail"; sectionIndex?: number; detail?: string }>;
  repairTargets: Array<{ sectionIndex: number | null; code: string; reason: string; priority: string; instruction: string }>;
  generationSource: string;
  attempts: number;
}

export interface BrandPostPackageManifest {
  /** v1 = 마크다운 기반, v2 = Spec-first 파이프라인(섹션 문자열·구성 계약·스펙·검증 포함) */
  version: "brand-post-package/v1" | "brand-post-package/v2";
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
  /** v2 전용 */
  sections?: string[];
  composition?: unknown;
  spec?: unknown;
  draft?: unknown;
  readiness?: BrandPostPackageReadiness | null;
  pipeline?: { version: string; model: string | null; notes: string[] } | null;
}

export interface BrandPostPackageResult {
  ok: boolean;
  code: string;
  message: string;
  readiness?: unknown;
  at?: string;
}

export function getBrandPostPackageResultPath(brandLinkId: string): string {
  return path.join(getBrandPostPackageDir(brandLinkId), "result.json");
}

export function readBrandPostPackageResult(brandLinkId: string): BrandPostPackageResult | null {
  const resultPath = getBrandPostPackageResultPath(brandLinkId);
  if (!fs.existsSync(resultPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8")) as BrandPostPackageResult;
  } catch {
    return null;
  }
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
  if (
    (parsed.version !== "brand-post-package/v1" && parsed.version !== "brand-post-package/v2") ||
    parsed.brandLinkId !== brandLinkId
  ) {
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
  // 스펙/초안 원본은 크고(MCP 결과 900KB 제한) 화면에 필요 없어 미리보기에서는 뺀다.
  const { spec: _spec, draft: _draft, ...rest } = manifest;
  void _spec;
  void _draft;
  const sectionOutline = Array.isArray(manifest.sections)
    ? manifest.sections.map((section, index) => ({ index, title: section.split("\n")[0]?.trim() || "", chars: section.replace(/\s+/g, "").length }))
    : null;
  return {
    ...rest,
    markdown,
    sectionOutline,
    imageCount: 1 + manifest.bodyImagePaths.length,
    readiness: manifest.readiness ?? null,
  };
}

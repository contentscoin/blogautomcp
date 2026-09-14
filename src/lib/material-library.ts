import fs from "node:fs";
import crypto from "node:crypto";
import { readBrandPostPackage, evaluateBrandPostPackageReadiness, type BrandPostPackageManifest } from "./brand-post-package";

// Content-addressed selection: changing a file in place also invalidates selection.
export function materialRevision(manifest: BrandPostPackageManifest): string {
  const hash = crypto.createHash("sha256");
  const { imageGeneration: _progress, ...content } = manifest;
  void _progress;
  hash.update(JSON.stringify(content));
  const files = new Set([manifest.markdownPath, manifest.heroImagePath, ...manifest.bodyImagePaths,
    ...(manifest.version === "brand-post-package/v2" ? manifest.composition.sections.flatMap(section => section.imagePaths) : [])]);
  for (const file of [...files].sort()) {
    hash.update(file || "missing-path");
    try { hash.update(fs.readFileSync(file)); } catch { hash.update("missing-file"); }
  }
  return hash.digest("hex");
}

export function getMaterial(productId: string) {
  const manifest = readBrandPostPackage(productId, { migrate: false });
  if (!manifest) return null;
  const quality = evaluateBrandPostPackageReadiness(manifest);
  const blockers = quality.blockers.map(item => item.reason);
  if (!manifest.approvedAt) blockers.push("소재 준비 단계에서 품질검사와 승인을 완료하세요.");
  const imageGeneration = quality.imageGeneration ? {
    status: quality.imageGeneration.status,
    requested: Math.max(0, Number(quality.imageGeneration.requested) || 0),
    applied: Math.max(0, Number(quality.imageGeneration.applied) || 0),
    remaining: Math.max(0, Number(quality.imageGeneration.remaining) || 0),
    updatedAt: quality.imageGeneration.updatedAt,
    ...(quality.imageGeneration.heartbeatAt ? { heartbeatAt: quality.imageGeneration.heartbeatAt } : {}),
    ...(quality.imageGeneration.recoveryState ? { recoveryState: quality.imageGeneration.recoveryState } : {}),
  } : null;
  return {
    productId, revision: materialRevision(manifest), title: manifest.title,
    connectKind: manifest.connectKind, createdAt: manifest.createdAt, approvedAt: manifest.approvedAt,
    ready: blockers.length === 0, blockers, score: quality.contentScore as number | null,
    imageCount: quality.composition?.renderNodes.filter(node => node.kind === "image").length ?? (1 + manifest.bodyImagePaths.length),
    ...(imageGeneration ? { imageGeneration } : {}),
  };
}

export function validateMaterialSelection(value: unknown): Array<{ productId: string; revision: string }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("준비된 소재를 1~50개 선택하세요.");
  }
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item.productId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(item.productId) ||
      typeof item.revision !== "string" || !/^[a-f0-9]{64}$/.test(item.revision) || seen.has(item.productId)) {
      throw new Error("소재 ID·버전이 없거나 중복된 선택입니다. 소재 목록에서 다시 선택하세요.");
    }
    seen.add(item.productId);
    return { productId: item.productId, revision: item.revision };
  });
}

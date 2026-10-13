import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { readBrandPostPackage, getBrandPostPackageDir, evaluateBrandPostPackageReadiness, type BrandPostPackageManifest } from "./brand-post-package";
import { hasCurrentBrandPostApprovalReceipt } from "./brand-post-approval-receipt";
import { materialPreparationDiagnostics } from "./material-preparation-diagnostics";

// Content-addressed selection: changing a file in place also invalidates selection.
export function materialRevision(manifest: BrandPostPackageManifest): string {
  const hash = crypto.createHash("sha256");
  const { imageGeneration: _progress, ...content } = manifest;
  void _progress;
  hash.update(JSON.stringify(content));
  const files = new Set([manifest.markdownPath, manifest.heroImagePath, ...manifest.bodyImagePaths,
    ...(manifest.imageAssets || []).flatMap(asset => asset.referenceScene?.referencePath ? [asset.referenceScene.referencePath] : []),
    ...(manifest.version === "brand-post-package/v2" ? manifest.composition.sections.flatMap(section => section.imagePaths) : [])]);
  for (const file of [...files].sort()) {
    hash.update(file || "missing-path");
    try { hash.update(fs.readFileSync(file)); } catch { hash.update("missing-file"); }
  }
  return hash.digest("hex");
}

function readMaterial(productId: string) {
  const manifest = readBrandPostPackage(productId, { migrate: false });
  if (!manifest) return null;
  const quality = evaluateBrandPostPackageReadiness(manifest);
  const blockers = quality.blockers.map(item => item.reason);
  if (!manifest.approvedAt) blockers.push("소재 준비 단계에서 품질검사와 승인을 완료하세요.");
  const approvalReceiptCurrent = Boolean(manifest.approvedAt && hasCurrentBrandPostApprovalReceipt(manifest, path.join(getBrandPostPackageDir(productId), "product-sources")));
  if (manifest.approvedAt && !approvalReceiptCurrent)
    blockers.push("현재 원고·사진·상품 근거의 최종 이미지 검사를 다시 완료하세요. 이전 승인만으로 준비완료로 표시하지 않습니다.");
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
    preparationDiagnostics: materialPreparationDiagnostics({ ready: blockers.length === 0, approved: Boolean(manifest.approvedAt), approvalReceiptCurrent,
      blockers: quality.blockers, contentPassed: quality.contentPassed, imageSlots: quality.imageSlots, imageGeneration: quality.imageGeneration,
      sourceKinds: manifest.version === "brand-post-package/v2" ? Object.fromEntries(manifest.composition.sections.flatMap(section =>
        section.imageSource === "seller-original" || section.imageSource === "staged-ai" ? [[section.id, section.imageSource]] : [])) : {},
    }),
    ...(imageGeneration ? { imageGeneration } : {}),
  };
}

/** Diagnostics are an additive response field. Existing callers and test
 * adapters may omit them; the production reader always supplies the field. */
export type MaterialLibraryRecord = Omit<NonNullable<ReturnType<typeof readMaterial>>, "preparationDiagnostics"> & {
  preparationDiagnostics?: ReturnType<typeof materialPreparationDiagnostics>;
};

export function getMaterial(productId: string): MaterialLibraryRecord | null {
  return readMaterial(productId);
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

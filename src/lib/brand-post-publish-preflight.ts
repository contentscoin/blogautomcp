import { buildSelectedProductImageAuditContext, assertPublishImagesSafe, PublishImageAuditError, type PublishImageAuditOptions, type PublishImageAuditResult } from "../../scripts/lib/publish-image-audit";
import { acquireBrandPostImageRepairLock } from "./brand-post-image-repair-lock";
import { getBrandPostPackageDir, readBrandPostPackage } from "./brand-post-package";
import path from "node:path";
import { materialRevision } from "./material-library";
import { normalizePublishedPostText } from "./post-composition-contract";
import { brandPostApprovalBinding, brandPostCompatibleApprovalBindings } from "./brand-post-approval-receipt";
import { imageAuditFailureSections } from "./publish-image-failure-diagnostics";

/** Same pixel audit as publication, before a saved shopping material is approved.
 * A DB mutation claim is additionally held by the HTTP caller. */
export async function validateBrandPostPublishImages(id: string, productName?: string,
  options: { review?: PublishImageAuditOptions["review"]; bindReadiness?: boolean } = {}) {
  const lock = acquireBrandPostImageRepairLock(id, { purpose: "publication-image-preflight" });
  try {
    const manifest = readBrandPostPackage(id, { migrate: false });
    if (!manifest || manifest.version !== "brand-post-package/v2")
      throw Object.assign(new Error("최종 이미지 검사를 진행할 저장 원고가 없습니다."), { code: "DRAFT_NOT_FOUND" });
    if (manifest.imageGeneration?.status === "running" || manifest.imageGeneration?.recoveryState === "owner-unknown")
      throw Object.assign(new Error("기존 이미지 작업의 완료 여부를 확인한 뒤 최종 이미지를 검사하세요."), { code: "IMAGE_RESUME_REQUIRED" });
    if (manifest.connectKind !== "SHOPPING") return { checked: 0, skipped: true };
    const revision = materialRevision(manifest);
    const sourceDirectory = path.join(getBrandPostPackageDir(id), "product-sources");
    const readinessBindingKey = brandPostApprovalBinding(manifest, sourceDirectory);
    const product = manifest.sourceSnapshot?.product || {};
    const name = String(product.name || productName || manifest.title);
    const composition = normalizePublishedPostText(manifest.composition);
    let audit: PublishImageAuditResult;
    try {
    audit = await assertPublishImagesSafe({ brandLinkId: id,
      compatibleReadinessBindingKeys: brandPostCompatibleApprovalBindings(manifest, sourceDirectory),
      ...(options.bindReadiness === true ? { readinessBindingKey } : {}), productName: name,
      selectedProduct: buildSelectedProductImageAuditContext(
        name,
        (Array.isArray(product.features) ? product.features : []).filter((value): value is string => typeof value === "string"),
        manifest.productUnderstanding,
      ),
      composition, imageAssets: manifest.imageAssets,
      sourceSnapshotId: manifest.sourceSnapshot?.snapshotId,
      ...(manifest.sourceSnapshot ? { selectedSourceSnapshot: manifest.sourceSnapshot, selectedSourceProductId: id,
        selectedSourceDirectory: sourceDirectory } : {}), ...(options.review ? { review: options.review } : {}) });
    } catch (error) {
      // Preserve the same error class/instance and policy receipt identity.
      // Section metadata is diagnostic; it never becomes a text-edit finding.
      if (error instanceof PublishImageAuditError) error.audit.failures = imageAuditFailureSections(composition, error.audit.failures);
      throw error;
    }
    lock.assertOwner();
    const current = readBrandPostPackage(id, { migrate: false });
    if (!current || materialRevision(current) !== revision || brandPostApprovalBinding(current, sourceDirectory) !== readinessBindingKey)
      throw Object.assign(new Error("이미지 검사 중 소재가 변경되었습니다. 현재 소재를 다시 검사하세요."), { code: "IMAGE_CHANGED" });
    return { checked: audit.checked, skipped: false };
  } finally { lock.release(); }
}

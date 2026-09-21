import { buildSelectedProductImageAuditContext, assertPublishImagesSafe, type PublishImageAuditOptions } from "../../scripts/lib/publish-image-audit";
import { acquireBrandPostImageRepairLock } from "./brand-post-image-repair-lock";
import { readBrandPostPackage } from "./brand-post-package";
import { materialRevision } from "./material-library";
import { normalizePublishedPostText } from "./post-composition-contract";

/** Same pixel audit as publication, before a saved shopping material is approved.
 * A DB mutation claim is additionally held by the HTTP caller. */
export async function validateBrandPostPublishImages(id: string, productName?: string,
  options: { review?: PublishImageAuditOptions["review"] } = {}) {
  const lock = acquireBrandPostImageRepairLock(id, { purpose: "publication-image-preflight" });
  try {
    const manifest = readBrandPostPackage(id, { migrate: false });
    if (!manifest || manifest.version !== "brand-post-package/v2")
      throw Object.assign(new Error("최종 이미지 검사를 진행할 저장 원고가 없습니다."), { code: "DRAFT_NOT_FOUND" });
    if (manifest.connectKind !== "SHOPPING") return { checked: 0, skipped: true };
    const revision = materialRevision(manifest);
    const product = manifest.sourceSnapshot?.product || {};
    const name = String(product.name || productName || manifest.title);
    const audit = await assertPublishImagesSafe({ brandLinkId: id, productName: name,
      selectedProduct: buildSelectedProductImageAuditContext(name, (Array.isArray(product.features) ? product.features : []).filter((value): value is string => typeof value === "string")),
      composition: normalizePublishedPostText(manifest.composition), ...options });
    lock.assertOwner();
    const current = readBrandPostPackage(id, { migrate: false });
    if (!current || materialRevision(current) !== revision)
      throw Object.assign(new Error("이미지 검사 중 소재가 변경되었습니다. 현재 소재를 다시 검사하세요."), { code: "IMAGE_CHANGED" });
    return { checked: audit.checked, skipped: false };
  } finally { lock.release(); }
}

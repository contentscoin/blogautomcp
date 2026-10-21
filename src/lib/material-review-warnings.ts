import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { BrandPostPackageManifest } from "./brand-post-package";
import { brandPostApprovalBinding } from "./brand-post-approval-receipt";
import { hasSignedImageAuditPrintWarnings, readSuccessfulImageAuditReadinessWarnings } from "../../scripts/lib/publish-image-audit-receipt";
import type { MaterialReviewWarning } from "./material-review-warning";

/** Read-only disclosure from an authentic CURRENT body/photo/policy HMAC.
 * No unsigned manifest flags or raw provider prose can become UI warnings. */
export function readCurrentMaterialReviewWarnings(manifest: BrandPostPackageManifest, sourceDirectory: string): MaterialReviewWarning[] {
  if (!manifest.approvedAt || manifest.connectKind !== "SHOPPING" || manifest.version !== "brand-post-package/v2" || !hasSignedImageAuditPrintWarnings(manifest.brandLinkId)) return [];
  try {
    const binding = brandPostApprovalBinding(manifest, sourceDirectory);
    const signed = readSuccessfulImageAuditReadinessWarnings(manifest.brandLinkId, binding);
    if (!signed?.length || signed.length > 64) return [];
    const result: MaterialReviewWarning[] = [];
    for (const warning of signed) {
      const node = manifest.composition.renderNodes[warning.nodeIndex];
      if (node?.kind !== "image") return [];
      const assets = manifest.imageAssets?.filter(asset => path.resolve(asset.path) === path.resolve(node.assetPath));
      if (assets?.length !== 1 || assets[0].sha256 !== warning.sha256 || crypto.createHash("sha256").update(fs.readFileSync(node.assetPath)).digest("hex") !== warning.sha256) return [];
      const suspected = warning.kind === "suspected-omission-uncorroborated";
      result.push({ kind: suspected ? "suspected-omission-uncorroborated" : "intrinsic-print-unverified", nodeIndex: warning.nodeIndex, assetSha256: warning.sha256,
        reason: suspected ? "인쇄 누락 의심·미확정: 첫 원본 비교의 누락 의심을 별도 비교로 확정하지 못했습니다. 인쇄의 정확성은 인증하지 않았습니다."
          : "인쇄 미검증: 사진의 제품 자체 인쇄 정확성을 인증하지 않았습니다." });
    }
    // No stale warning may survive a receipt/body/image/source change while read.
    if (brandPostApprovalBinding(manifest, sourceDirectory) !== binding || JSON.stringify(readSuccessfulImageAuditReadinessWarnings(manifest.brandLinkId, binding)) !== JSON.stringify(signed)) return [];
    return result;
  } catch { return []; }
}
